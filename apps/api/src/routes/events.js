/**
 * Event discovery and organiser event management.
 *
 * @module @desi-event/api/routes/events
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { organizationsWhere } from '../lib/actor.js'
import { conflict, notFound, unprocessable } from '../lib/errors.js'
import { disambiguateSlug, slugify } from '../lib/identifiers.js'
import { toEventDetail, toEventSummary } from '../lib/presenters.js'
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

  const publicFilter = publishedOnly ? { status: 'PUBLISHED' } : { status: { not: 'DRAFT' } }
  const organizationIds = organizationsWhere(actor, can, CAPABILITIES.EVENT_VIEW_DRAFT)

  if (organizationIds.length === 0) return publicFilter

  return { OR: [publicFilter, { organizationId: { in: organizationIds } }] }
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

  if (query.q) {
    conditions.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { summary: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
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

  if (event.status === 'DRAFT') {
    const visible =
      can(actor, CAPABILITIES.PLATFORM_ADMIN) ||
      can(actor, CAPABILITIES.EVENT_VIEW_DRAFT, { organizationId: event.organizationId })

    if (!visible) throw notFound('No such event.')
  }

  return event
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
 * Register the `/v1/events` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerEventRoutes(app, { prisma }) {
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
        data: events.map(toEventSummary),
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
      const event = await prisma.event.findUnique({
        where: { slug: request.params.slug },
        include: EVENT_INCLUDE,
      })

      if (!event) throw notFound('No such event.')

      if (event.status === 'DRAFT') {
        const visible =
          can(request.actor, CAPABILITIES.PLATFORM_ADMIN) ||
          can(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
            organizationId: event.organizationId,
          })

        if (!visible) throw notFound('No such event.')
      }

      return { data: toEventDetail(event) }
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

      const slug = await resolveSlug(prisma, body.slug, body.title)
      const data = withEventDates({ ...body, slug })

      const event = await prisma.event.create({
        data: {
          ...data,
          publishedAt: data.status === 'PUBLISHED' ? new Date() : null,
        },
        include: EVENT_INCLUDE,
      })

      request.log.info({ eventId: event.id, actorId: request.actor.id }, 'event created')

      return { data: toEventDetail(event) }
    },
  })

  defineRoute(app, 'events.update', {
    handler: async (request) => {
      const existing = await prisma.event.findUnique({ where: { id: request.params.id } })
      if (!existing) throw notFound('No such event.')

      assertCan(request.actor, CAPABILITIES.EVENT_UPDATE, {
        organizationId: existing.organizationId,
      })

      const body = request.body

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

      const event = await prisma.event.update({
        where: { id: existing.id },
        data: withEventDates(body),
        include: EVENT_INCLUDE,
      })

      return { data: toEventDetail(event) }
    },
  })

  defineRoute(app, 'events.publish', {
    handler: async (request) => {
      const existing = await prisma.event.findUnique({ where: { id: request.params.id } })
      if (!existing) throw notFound('No such event.')

      assertCan(request.actor, CAPABILITIES.EVENT_PUBLISH, {
        organizationId: existing.organizationId,
      })

      const { status, publishedAt } = request.body

      if (status === 'PUBLISHED') {
        // Publishing an event nobody can buy into is almost always a mistake
        // made one step too early, and it is cheap to catch here.
        const sellable = await prisma.ticketType.count({
          where: { eventId: existing.id, status: 'ON_SALE' },
        })

        if (sellable === 0) {
          throw unprocessable('Publish at least one ON_SALE ticket type before publishing the event.')
        }
      }

      const event = await prisma.event.update({
        where: { id: existing.id },
        data: {
          status,
          publishedAt:
            status === 'PUBLISHED'
              ? (publishedAt ? new Date(publishedAt) : (existing.publishedAt ?? new Date()))
              : existing.publishedAt,
        },
        include: EVENT_INCLUDE,
      })

      request.log.info({ eventId: event.id, status }, 'event status changed')

      return { data: toEventDetail(event) }
    },
  })
}

export { loadVisibleEvent }
