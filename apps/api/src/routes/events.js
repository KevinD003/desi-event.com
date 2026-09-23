/**
 * Event discovery and organiser event management.
 *
 * @module @desi-event/api/routes/events
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import {
  EDITABLE_STATUSES,
  INDEXABLE_STATUSES,
  PUBLICLY_VISIBLE_STATUSES,
} from '@desi-event/schemas/lifecycle'

import { organizationsWhere } from '../lib/actor.js'
import { availableTransitions, loadForTransition, transitionEvent } from '../lib/event-lifecycle.js'
import { authorChange } from '../lib/event-authoring.js'
import { cancellationWork } from '../lib/event-cancellation.js'
import {
  LIVE_STATUSES,
  classifyChanges,
  materialChangeWork,
  refuseUnconfirmed,
} from '../lib/event-material-change.js'
import { recordAudit } from '../lib/audit.js'
import { conflict, notFound, unprocessable } from '../lib/errors.js'
import { disambiguateSlug, slugify } from '../lib/identifiers.js'
import { toEventDetail, toEventSummary } from '../lib/presenters.js'
import { feeConfigFor } from './orders.js'
import { loadEventFacets } from '../lib/facets.js'
import { defineRoute } from '../lib/register.js'

/** Relations every event payload carries. */
const EVENT_INCLUDE = Object.freeze({ venue: true, organization: true, ticketTypes: true })

/** Query `sort` value to a Prisma `orderBy`. */
const ORDER_BY = Object.freeze({
  'startsAt:asc': [{ startsAt: 'asc' }, { id: 'asc' }],
  'startsAt:desc': [{ startsAt: 'desc' }, { id: 'asc' }],
  'createdAt:desc': [{ createdAt: 'desc' }, { id: 'asc' }],
  'title:asc': [{ title: 'asc' }, { id: 'asc' }],
})

/**
 * The Prisma filter describing which events this caller may see at all.
 *
 * Draft visibility is a permission question, so it is answered by
 * `@desi-event/permissions` and then *translated* into a filter: the caller's
 * organisations are collected once and become an `organizationId IN (...)`
 * clause. Filtering in the database rather than in memory is what stops a
 * draft from being counted in `pagination.total` for somebody who may not see
 * it.
 *
 * @param {object|null} actor The request actor, or `null` when anonymous.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.publishedOnly] When true, non-members see only `PUBLISHED`; otherwise they see everything except `DRAFT`.
 * @returns {object} A Prisma `where` fragment; `{}` for a platform administrator.
 */
export function visibilityFilter(actor, options = {}) {
  const { publishedOnly = true } = options

  if (actor && can(actor, CAPABILITIES.PLATFORM_ADMIN)) return {}

  // Finding NF-19. This used to read `{ status: 'PUBLISHED' }` or, worse,
  // `{ status: { not: 'DRAFT' } }` — the second of which showed a stranger every
  // submission, every rejection and every archived event, because DRAFT was the
  // only state anybody had thought to exclude.
  //
  // A *listing* uses the narrower set: a cancelled or finished show has a page
  // but does not belong in "what is on". `events.get` uses the wider one, so
  // the page still resolves for the person holding a ticket to it.
  const publicFilter = publishedOnly
    ? { status: { in: [...INDEXABLE_STATUSES] } }
    : { status: { in: [...PUBLICLY_VISIBLE_STATUSES] } }
  const organizationIds = organizationsWhere(actor, can, CAPABILITIES.EVENT_VIEW_DRAFT)

  if (organizationIds.length === 0) return publicFilter

  return { OR: [publicFilter, { organizationId: { in: organizationIds } }] }
}

/**
 * The most words a search is split into. The query is capped at 120
 * characters already; this bounds the conditions one request can add.
 */
const MAX_SEARCH_TERMS = 8

/**
 * Split a free-text search into the words that must each match.
 *
 * @param {string|undefined} q The validated, trimmed query.
 * @returns {string[]} Distinct lower-cased words, at most {@link MAX_SEARCH_TERMS}.
 */
export function searchTerms(q) {
  if (!q) return []

  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS)
}

/**
 * Translate a validated list query into Prisma arguments.
 *
 * @param {object} query The parsed `listEventsQuerySchema` value.
 * @param {object|null} actor The request actor.
 * @returns {{where: object, orderBy: object[], skip: number, take: number}} Prisma query arguments.
 */
export function buildEventQuery(query, actor) {
  /** @type {object[]} */
  const conditions = [visibilityFilter(actor)]

  if (query.status) conditions.push({ status: query.status })
  if (query.category) conditions.push({ category: query.category })
  if (query.organizationId) conditions.push({ organizationId: query.organizationId })
  if (query.isOnline !== undefined) conditions.push({ isOnline: query.isOnline })
  if (query.city) conditions.push({ venue: { city: { equals: query.city, mode: 'insensitive' } } })

  // Every word has to turn up somewhere a visitor would describe the event
  // by: its own text, its venue, the venue's city or its organiser. So
  // "garba houston" finds a garba night in Houston, and a search for an
  // organiser's name finds their events.
  for (const term of searchTerms(query.q)) {
    const contains = { contains: term, mode: 'insensitive' }

    conditions.push({
      OR: [
        { title: contains },
        { summary: contains },
        { description: contains },
        { venue: { name: contains } },
        { venue: { city: contains } },
        { organization: { name: contains } },
      ],
    })
  }

  /** @type {Record<string, Date>} */
  const startsAt = {}
  if (query.startsAfter) startsAt.gte = new Date(query.startsAfter)
  if (query.startsBefore) startsAt.lte = new Date(query.startsBefore)
  if (Object.keys(startsAt).length > 0) conditions.push({ startsAt })

  return {
    where: { AND: conditions },
    orderBy: ORDER_BY[query.sort] ?? ORDER_BY['startsAt:asc'],
    ...toSkipTake(query),
  }
}

/**
 * Convert the timestamp fields of an event payload into `Date` objects.
 *
 * The schemas normalise every instant to an ISO string on the way in, which is
 * right for a JSON boundary and wrong for Prisma, which wants `Date`.
 *
 * @param {object} body A validated create/update payload.
 * @returns {object} The same fields with `startsAt`/`endsAt` as dates.
 */
function withEventDates(body) {
  const data = { ...body }
  if (data.startsAt) data.startsAt = new Date(data.startsAt)
  if (data.endsAt) data.endsAt = new Date(data.endsAt)
  return data
}

/**
 * Load an event the caller is allowed to see, or throw a 404.
 *
 * "Not found" and "not yours" answer identically on purpose: distinguishing
 * them would let anyone enumerate an organiser's unannounced events by slug.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} where A Prisma unique selector, e.g. `{ slug }`.
 * @param {object|null} actor The request actor.
 * @returns {Promise<object>} The event row with its relations.
 * @throws {Error} A 404 when the event is absent or is a draft the caller may not see.
 */
async function loadVisibleEvent(prisma, where, actor) {
  const event = await prisma.event.findUnique({ where, include: EVENT_INCLUDE })

  if (!event) throw notFound('No such event.')

  assertVisibleTo(event, actor)

  return event
}

/**
 * Refuse an event this caller has no business seeing.
 *
 * A 404 rather than a 403, deliberately: a 403 confirms the slug names
 * something, and "does this organiser have an unannounced event called X" is
 * not a question a stranger gets to ask.
 *
 * @param {object} event The event row.
 * @param {object|null} actor The request actor.
 * @returns {void}
 * @throws {Error} A 404 when the caller may not see it.
 */
function assertVisibleTo(event, actor) {
  if (PUBLICLY_VISIBLE_STATUSES.has(event.status)) return
  if (maySeeDrafts(event, actor)) return

  throw notFound('No such event.')
}

/**
 * Whether this caller may see what the organiser has not announced.
 *
 * The same question twice over: whether an unpublished *event* resolves at all,
 * and whether an unpublished *ticket type* appears in the payload of one that
 * does. Both are "is this person on the inside", so both ask it here rather
 * than each growing its own version of the answer.
 *
 * @param {object} event The event row.
 * @param {object|null} actor The request actor.
 * @returns {boolean} True when the caller is staff or a member of the organisation.
 */
function maySeeDrafts(event, actor) {
  return (
    can(actor, CAPABILITIES.MODERATION_REVIEW) ||
    can(actor, CAPABILITIES.PLATFORM_ADMIN) ||
    can(actor, CAPABILITIES.EVENT_VIEW_DRAFT, { organizationId: event.organizationId })
  )
}

/**
 * Reserve a unique slug, retrying once with a random suffix on collision.
 *
 * @param {object} prisma The Prisma client.
 * @param {string|undefined} requested The slug the caller asked for, if any.
 * @param {string} title The event title, used to derive a slug when none was given.
 * @returns {Promise<string>} A slug no other event currently holds.
 * @throws {Error} A 409 when the caller asked for a slug that is already taken.
 */
async function resolveSlug(prisma, requested, title) {
  if (requested) {
    const taken = await prisma.event.findUnique({ where: { slug: requested } })
    if (taken) throw conflict(`The slug "${requested}" is already in use.`)
    return requested
  }

  const base = slugify(title)
  const taken = await prisma.event.findUnique({ where: { slug: base } })

  return taken ? disambiguateSlug(base) : base
}

/**
 * Check that a caller-supplied venue exists before it reaches the database.
 *
 * A `venueId` arrives in the request body, so it is caller-controlled. Passing
 * an unknown one straight through turns a foreign key violation into a 500 —
 * a bad request reported as a server fault, with a database error message
 * attached. Resolving it first gives the caller a 422 that names the problem.
 *
 * @param {object} prisma A Prisma client.
 * @param {string|null|undefined} venueId The venue id from the request body.
 * @returns {Promise<void>} Resolves when the venue exists or none was supplied.
 * @throws {Error} A 422 when the venue does not exist.
 */
async function assertVenueExists(prisma, venueId) {
  if (venueId === undefined || venueId === null) return

  const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } })

  if (!venue) throw unprocessable(`No such venue: ${venueId}.`, { field: 'venueId' })
}

/**
 * Register the `/v1/events` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.env] The parsed API environment, for the fee terms a card's price is quoted with.
 * @returns {void} Nothing.
 */
export function registerEventRoutes(app, { prisma, env }) {
  // One ticket of the cheapest tier, priced with checkout's own fee terms, so a
  // card's "from" price is the price and not the face value.
  const pricing = env ? { feeConfigFor: (currency) => feeConfigFor(env, currency) } : {}
  const summaryOptions = pricing

  defineRoute(app, 'events.facets', {
    handler: async () => ({ data: await loadEventFacets(prisma) }),
  })

  defineRoute(app, 'events.list', {
    handler: async (request) => {
      const { where, orderBy, skip, take } = buildEventQuery(request.query, request.actor)

      const [events, total] = await Promise.all([
        prisma.event.findMany({ where, orderBy, skip, take, include: EVENT_INCLUDE }),
        prisma.event.count({ where }),
      ])

      return {
        data: events.map((event) => toEventSummary(event, summaryOptions)),
        pagination: buildPaginationMeta({
          page: request.query.page,
          perPage: request.query.perPage,
          total,
        }),
      }
    },
  })

  defineRoute(app, 'events.get', {
    handler: async (request) => {
      const key = request.params.slug

      // Slug first, then id. An organiser's editor is keyed by id — the slug
      // is one of the things being edited, so a URL built from it breaks the
      // moment somebody renames their event — but a slug that happens to look
      // like a cuid must still resolve to the event that owns it. Trying the
      // slug first makes that deterministic rather than a race between two
      // interpretations of the same string.
      const event =
        (await prisma.event.findUnique({ where: { slug: key }, include: EVENT_INCLUDE })) ??
        (await prisma.event.findUnique({ where: { id: key }, include: EVENT_INCLUDE }))

      if (!event) throw notFound('No such event.')

      assertVisibleTo(event, request.actor)

      return {
        data: toEventDetail(event, {
          includeDraftTiers: maySeeDrafts(event, request.actor),
          ...pricing,
        }),
      }
    },
  })

  defineRoute(app, 'events.create', {
    handler: async (request) => {
      const body = request.body
      assertCan(request.actor, CAPABILITIES.EVENT_CREATE, { organizationId: body.organizationId })

      const organization = await prisma.organization.findUnique({
        where: { id: body.organizationId },
      })
      if (!organization) throw notFound('No such organisation.')

      await assertVenueExists(prisma, body.venueId)

      const slug = await resolveSlug(prisma, body.slug, body.title)

      // Finding NF-17. `status` carried a DRAFT *default*, which is not a DRAFT
      // *guarantee*: a caller holding only `event:create` could post
      // `status: 'PUBLISHED'` — or `'APPROVED'`, forging a moderator's decision
      // — and have the row written that way. A new event is a draft. There is
      // no other way to make one, and the status field is ignored rather than
      // rejected so an old client keeps working and simply does not get its way.
      const { status: _ignored, ...writable } = body
      const data = withEventDates({ ...writable, slug })

      const event = await prisma.event.create({
        data: { ...data, status: 'DRAFT', publishedAt: null },
        include: EVENT_INCLUDE,
      })

      request.log.info({ eventId: event.id, actorId: request.actor.id }, 'event created')

      // Every route below `events.get` is already gated on holding something
      // in this organisation, so the caller is on the inside and sees the
      // tiers they are still holding back. Said explicitly rather than left to
      // the default: an organiser's own editor going blank after a save is not
      // a bug anybody would guess at.
      return { data: toEventDetail(event, { includeDraftTiers: true, ...pricing }) }
    },
  })

  defineRoute(app, 'events.update', {
    handler: async (request) => {
      const existing = await prisma.event.findUnique({ where: { id: request.params.id } })
      if (!existing) throw notFound('No such event.')

      assertCan(request.actor, CAPABILITIES.EVENT_UPDATE, {
        organizationId: existing.organizationId,
      })

      const { revision, confirmMaterialChange = false, changeReason = null, ...body } = request.body

      if (body.slug && body.slug !== existing.slug) {
        const taken = await prisma.event.findUnique({ where: { slug: body.slug } })
        if (taken) throw conflict(`The slug "${body.slug}" is already in use.`)
      }

      // A window is only valid as a whole, so a partial update that moves one
      // end must be checked against the end it did not move.
      const startsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt
      const endsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt

      if (endsAt.getTime() <= startsAt.getTime()) {
        throw unprocessable('endsAt must be strictly after startsAt.')
      }

      await assertVenueExists(prisma, body.venueId)

      const data = withEventDates(body)
      const { material, before, after } = classifyChanges(existing, data)
      const live = LIVE_STATUSES.has(existing.status)

      // Three worlds, and they are genuinely different rather than three
      // branches of one rule.
      //
      //   - A draft is somebody's private working copy: edit it.
      //   - A live event has an audience, so a material change is a change to
      //     the deal and needs confirming, a reason, and people told.
      //   - Anything else — under review, approved, cancelled, rejected,
      //     archived, finished — is not the organiser's to edit at all. Editing
      //     a version a moderator is holding invalidates the decision rather
      //     than amending it.
      if (!EDITABLE_STATUSES.has(existing.status) && !live) {
        throw conflict(
          `This event is ${existing.status} and its content cannot be edited. ` +
            (existing.status === 'REVIEW_PENDING'
              ? 'Withdraw it from review first.'
              : 'A moderator holds this version; it cannot be changed from here.'),
          { status: existing.status, code: 'NOT_EDITABLE' },
        )
      }

      if (live && material.length > 0 && !confirmMaterialChange) {
        refuseUnconfirmed(material, existing.status)
      }

      if (live && material.length > 0 && !changeReason) {
        throw unprocessable(
          'A confirmed material change needs a reason, because it is sent to everybody holding a ticket.',
          { problems: ['Give a reason for the change.'], fields: material },
        )
      }

      // The revision precondition is optional on this route and mandatory in
      // practice for the editor, which always sends one. Omitting it is for a
      // script making a single deliberate change; an editor that autosaves
      // without one is an editor where the last writer silently wins.
      const expected = Number.isInteger(revision) ? revision : existing.revision

      const updated = await authorChange(prisma, {
        event: existing,
        revision: expected,
        actor: request.actor,
        action: material.length > 0 ? 'event.material_change' : 'event.updated',
        write: async (tx) => {
          await tx.event.update({ where: { id: existing.id }, data })

          if (!live || material.length === 0) return

          const work = await materialChangeWork(tx, {
            event: existing,
            revision: expected + 1,
            material,
            before,
            after,
            reason: changeReason,
          })

          // Recorded separately from the audit row `authorChange` writes, so
          // the before/after of a change to the deal is a first-class record
          // rather than a line item. Historical snapshots on the orders
          // themselves are never touched: that is what makes them snapshots.
          await recordAudit(tx, {
            action: 'event.material_change.notified',
            entityType: 'Event',
            entityId: existing.id,
            actorId: request.actor?.id ?? null,
            metadata: {
              fields: material,
              before,
              after,
              reason: changeReason,
              ordersAffected: work.orders,
              // Created, not delivered. No outbox worker exists yet.
              notificationsQueued: work.notifications,
            },
          })
        },
      })

      const event = await prisma.event.findUnique({
        where: { id: updated.id },
        include: EVENT_INCLUDE,
      })

      return { data: toEventDetail(event, { includeDraftTiers: true, ...pricing }) }
    },
  })

  /**
   * Run one lifecycle command.
   *
   * Every command is the same four steps in the same order, so they share one
   * body and differ only in the destination and what they carry. Writing them
   * out five times would mean five places for the audit record to be forgotten.
   *
   * @param {object} request The Fastify request.
   * @param {string} to The destination status.
   * @param {object} [extra] `reason`, `requestedChanges`, `onCommit`.
   * @returns {Promise<object>} The response body.
   */
  async function command(request, to, extra = {}) {
    const event = await loadForTransition(prisma, request.params.id)

    const updated = await transitionEvent(prisma, {
      event,
      to,
      actor: request.actor,
      ...extra,
    })

    request.log.info(
      { eventId: event.id, from: event.status, to, actorId: request.actor?.id },
      'event lifecycle transition',
    )

    const full = await prisma.event.findUnique({
      where: { id: updated.id },
      include: EVENT_INCLUDE,
    })

    return { data: toEventDetail(full, { includeDraftTiers: true, ...pricing }) }
  }

  defineRoute(app, 'events.transitions', {
    handler: async (request) => {
      const event = await loadForTransition(prisma, request.params.id)

      assertVisibleTo(event, request.actor)
      assertCan(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
        organizationId: event.organizationId,
      })

      return {
        data: {
          status: event.status,
          transitions: await availableTransitions(prisma, event, request.actor),
        },
      }
    },
  })

  defineRoute(app, 'events.moderationHistory', {
    handler: async (request) => {
      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, organizationId: true, status: true },
      })

      if (!event) throw notFound('No such event.')

      // The history of a negotiation belongs to the two parties to it: the
      // organisation that owns the event, and the moderators who ruled on it.
      const permitted =
        can(request.actor, CAPABILITIES.MODERATION_REVIEW) ||
        can(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
          organizationId: event.organizationId,
        })

      if (!permitted) throw notFound('No such event.')

      const history = await prisma.eventModerationAction.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'desc' },
      })

      return {
        data: history.map((action) => ({
          id: action.id,
          fromStatus: action.fromStatus,
          toStatus: action.toStatus,
          reason: action.reason,
          requestedChanges: action.requestedChanges ?? null,
          actorId: action.actorId,
          createdAt: action.createdAt.toISOString(),
        })),
      }
    },
  })

  defineRoute(app, 'events.submitReview', {
    handler: (request) =>
      command(request, 'REVIEW_PENDING', { reason: request.body?.note ?? null }),
  })

  defineRoute(app, 'events.withdrawReview', {
    handler: (request) => command(request, 'DRAFT'),
  })

  defineRoute(app, 'events.publish', {
    handler: (request) => command(request, 'PUBLISHED'),
  })

  defineRoute(app, 'events.openSales', {
    handler: (request) => command(request, 'ON_SALE'),
  })

  defineRoute(app, 'events.pauseSales', {
    handler: (request) =>
      command(request, 'SALES_PAUSED', { reason: request.body?.reason ?? null }),
  })

  defineRoute(app, 'events.postpone', {
    handler: async (request) => {
      const { reasonCode, reason, newStartsAt, newEndsAt } = request.body

      return command(request, 'POSTPONED', {
        reason: `${reasonCode}: ${reason}`,
        /**
         * Move the dates and raise the notice in the same transaction.
         *
         * @param {object} tx The transaction client.
         * @param {object} updated The event after the status write.
         * @returns {Promise<void>} Resolves when done.
         */
        onCommit: async (tx, updated) => {
          if (newStartsAt && newEndsAt) {
            await tx.event.update({
              where: { id: updated.id },
              data: { startsAt: new Date(newStartsAt), endsAt: new Date(newEndsAt) },
            })
          }

          await cancellationWork(tx, {
            event: updated,
            kind: 'POSTPONED',
            reasonCode,
            reason,
            actorId: request.actor?.id ?? null,
          })
        },
      })
    },
  })

  defineRoute(app, 'events.cancel', {
    handler: async (request) => {
      const { reasonCode, reason } = request.body

      return command(request, 'CANCELLED', {
        reason: `${reasonCode}: ${reason}`,
        /**
         * Raise the notification and refund work with the cancellation.
         *
         * Inside the transaction because the work and the status must commit
         * together: an event cancelled with no refund work owed is worse than
         * one that is not cancelled at all.
         *
         * @param {object} tx The transaction client.
         * @param {object} updated The cancelled event.
         * @returns {Promise<void>} Resolves when done.
         */
        onCommit: async (tx, updated) => {
          await cancellationWork(tx, {
            event: updated,
            kind: 'CANCELLED',
            reasonCode,
            reason,
            actorId: request.actor?.id ?? null,
          })
        },
      })
    },
  })
}

export { loadVisibleEvent }
