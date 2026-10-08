/**
 * Full control of posted events (SPEC2-XI area X): deleting an event and
 * sending what it owes, cancelling one night, the Desi-Event team's editing
 * sittings and its list of every organisation's events, and restoring a
 * deleted event.
 *
 * Every answer here is `no-store`, previews included: each carries counts of
 * somebody's orders or a decision about to be made from them.
 *
 * Thin handlers over `lib/event-deletion.js`, `lib/session-cancellation.js`,
 * `lib/event-refunds.js` and `lib/event-authority.js`, which own the rules.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/routes/event-control
 */

import { CAPABILITIES, can } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import {
  DELETION_OUTCOME_COLUMN,
  PLATFORM_EDITABLE_STATUSES,
  restoreTarget,
} from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { loadZonesByVersion } from '../lib/event-authoring.js'
import {
  NOT_POSTED_SENTENCE,
  PLATFORM_EDIT_NOT_OPEN_SENTENCE,
  PLATFORM_EDIT_WINDOW_MS,
  memberHolds,
  openSittingOf,
  platformHolds,
  resolveEventAuthority,
} from '../lib/event-authority.js'
import {
  deleteEvent,
  deletionAuthority,
  deletionPreview,
  mayAskToDelete,
  restoreEvent,
} from '../lib/event-deletion.js'
import { EVENT_MEDIA_INCLUDE } from '../lib/event-media.js'
import { countDisputedRefunds, countOwedRefunds, refundOwed } from '../lib/event-refunds.js'
import { databaseErrorCode, forbidden, httpError, notFound } from '../lib/errors.js'
import { likeLiteral } from '../lib/like-pattern.js'
import { toEventDetail } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { cancelSession, sessionCancellationPreview } from '../lib/session-cancellation.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from '../lib/transaction-budget.js'
import { WEBSITE_REDIRECT_INCLUDE, websiteViewFor } from '../lib/website-redirect.js'
import { platformEditRateLimit } from '../plugins/rate-limit.js'
import { toSession } from './event-authoring.js'
import { feeConfigFor } from './orders.js'

/**
 * What is still owed when the refund pass after a deletion or a night's
 * cancellation did not run to the end: nothing sent by it, every sendable
 * refund waiting for `events.finishRefunds`, and the disputed ones counted
 * apart. Never null, so a client is never told nothing is owed when the
 * refunds are merely waiting.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} event The event, with `id` and `sessions`.
 * @param {string|null} [sessionId] One night only.
 * @returns {Promise<object>} A summary satisfying `refundDriveSummarySchema`.
 */
async function waitingRefunds(prisma, event, sessionId = null) {
  const owed = await countOwedRefunds(prisma, event, sessionId)
  const disputed = await countDisputedRefunds(prisma, event, sessionId)

  return {
    owed: owed + disputed,
    settled: 0,
    waiting: owed,
    failed: 0,
    disputed,
    amountCents: 0,
    currency: null,
  }
}

/**
 * An administrator's editing sitting, opened or closed: a row or two and an
 * audit row, which can wait behind a write under the sitting (`FOR SHARE` on
 * it) or a deletion ending it. One that runs out answers 503 and changes
 * nothing (`lib/transaction-budget.js`).
 */
const SITTING_OPEN_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event was being saved at the same moment, and opening your editing sitting could not wait for it, so nothing was changed. Try again in a moment.',
})

/** The same, for closing one. */
const SITTING_CLOSE_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event was being saved at the same moment, and closing your editing sitting could not wait for it, so nothing was changed: it is still open. Try again in a moment.',
})

/** What deleting and restoring read about an event. */
const CONTROL_INCLUDE = Object.freeze({
  organization: true,
  sessions: true,
  ticketTypes: true,
})

/** What an event payload out of these routes carries. */
const DETAIL_INCLUDE = Object.freeze({
  venue: true,
  organization: true,
  ticketTypes: true,
  sessions: { orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }] },
  ...EVENT_MEDIA_INCLUDE,
  ...WEBSITE_REDIRECT_INCLUDE,
  deletedBy: { select: { displayName: true } },
})

/** `GET /v1/platform/events` sort orders. */
const PLATFORM_SORT = Object.freeze({
  'updatedAt:desc': [{ updatedAt: 'desc' }, { id: 'asc' }],
  'startsAt:asc': [{ startsAt: 'asc' }, { id: 'asc' }],
  'createdAt:desc': [{ createdAt: 'desc' }, { id: 'asc' }],
})

/** Each stored deletion outcome by its wire name. */
const OUTCOME_WIRE = Object.freeze(
  Object.fromEntries(
    Object.entries(DELETION_OUTCOME_COLUMN).map(([wire, column]) => [column, wire]),
  ),
)

/**
 * Whether a reader is on the Desi-Event team.
 *
 * @param {object|null} actor The request actor.
 * @returns {boolean} True for a moderator or a platform administrator.
 */
function isPlatformReader(actor) {
  return (
    can(actor, CAPABILITIES.MODERATION_REVIEW) ||
    platformHolds(actor, CAPABILITIES.EVENT_PLATFORM_EDIT) ||
    platformHolds(actor, CAPABILITIES.PLATFORM_ADMIN)
  )
}

/**
 * A sitting as its reader may see it.
 *
 * @param {object} row An `EventPlatformEdit` row, with `actor` when named.
 * @param {object} options Options.
 * @param {object|null} options.actor The reader.
 * @param {boolean} options.platformReader Whether the reader may see the administrator's name.
 * @param {Array<{action: string, fields: string[], at: string}>} [options.changes] What it changed.
 * @param {Date} options.now The instant.
 * @returns {object} A payload satisfying `platformEditSchema`.
 */
function toPlatformEdit(row, { actor, platformReader, changes = [], now }) {
  const expired = new Date(row.expiresAt).getTime() <= now.getTime()
  const open = !row.closedAt && !expired

  return {
    id: row.id,
    openedAt: new Date(row.openedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    endedBy: row.endedBy ?? (open ? null : 'EXPIRED'),
    open,
    mine: Boolean(actor?.id) && row.actorId === actor.id,
    reason: row.reason,
    administratorName: platformReader ? (row.actor?.displayName ?? null) : null,
    changes,
  }
}

/**
 * Register the full-control routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry, for the refunds.
 * @param {object} [deps.env] The parsed API environment, for the fee terms an event payload quotes.
 * @param {object} [deps.payments] The resolved payment mode.
 * @param {{max?: number, timeWindow?: string|number}} [deps.platformEditLimit] Overrides for the sitting budget.
 * @returns {void} Nothing.
 */
export function registerEventControlRoutes(
  app,
  { prisma, providers, env, payments, platformEditLimit },
) {
  const paymentMode = payments?.mode ?? 'MOCK'
  const pricing = env ? { feeConfigFor: (currency) => feeConfigFor(env, currency) } : {}
  const editBudget = platformEditRateLimit(platformEditLimit ?? {})

  /**
   * The event as its team or the Desi-Event team reads it.
   *
   * @param {string} eventId The event.
   * @param {object} actor The reader.
   * @returns {Promise<object>} An `eventWithRelationsSchema` payload.
   */
  async function detailFor(eventId, actor) {
    const full = await prisma.event.findUnique({ where: { id: eventId }, include: DETAIL_INCLUDE })

    return toEventDetail(full, {
      includeDraftTiers: true,
      includeOnlineUrl: true,
      website: websiteViewFor(actor, full),
      deletion: { platformReader: isPlatformReader(actor) },
      ...pricing,
    })
  }

  /**
   * Whether this reader may see the event's internals at all: a member of its
   * organisation who reads drafts, or the Desi-Event team.
   *
   * @param {object} actor The reader.
   * @param {object} event The event.
   * @returns {boolean} True for an insider.
   */
  function insider(actor, event) {
    return (
      memberHolds(actor, CAPABILITIES.EVENT_VIEW_DRAFT, event.organizationId) ||
      isPlatformReader(actor)
    )
  }

  /**
   * Load an event for deleting. Anybody who may not ask is answered as if it did
   * not exist; for a write, an insider who may not delete is told so (403).
   *
   * @param {object} request The request.
   * @param {object} [options] Options.
   * @param {boolean} [options.write] Whether this is the write rather than the preview.
   * @returns {Promise<object>} The event, with `organization`, `sessions` and `ticketTypes`.
   */
  async function deletable(request, { write = false } = {}) {
    const event = await prisma.event.findUnique({
      where: { id: request.params.id },
      include: CONTROL_INCLUDE,
    })

    if (!event) throw notFound('No such event.')
    if (mayAskToDelete(request.actor, event)) return event
    if (write && insider(request.actor, event)) {
      throw forbidden('Deleting this event is for the people who run it, or the Desi-Event team.')
    }

    throw notFound('No such event.')
  }

  /**
   * Load an event and one of its nights for cancelling. Anybody who may not ask
   * is answered as if it did not exist; for a write, an insider meets the
   * authority check (403).
   *
   * @param {object} request The request.
   * @param {object} [options] Options.
   * @param {boolean} [options.write] Whether this is the write rather than the preview.
   * @returns {Promise<object>} `{ event, session }`: the event and the night.
   */
  async function cancellable(request, { write = false } = {}) {
    const event = await prisma.event.findUnique({
      where: { id: request.params.id },
      include: CONTROL_INCLUDE,
    })
    const allowed =
      event &&
      (memberHolds(request.actor, CAPABILITIES.EVENT_CANCEL, event.organizationId) ||
        platformHolds(request.actor, CAPABILITIES.EVENT_PLATFORM_DELETE) ||
        (write && insider(request.actor, event)))

    if (!allowed) throw notFound('No such event.')

    const session = event.sessions.find((candidate) => candidate.id === request.params.sessionId)

    if (!session) throw notFound('No such session on this event.')

    return { event, session }
  }

  defineRoute(app, 'events.deletionPreview', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await deletable(request)

      return {
        data: await deletionPreview(prisma, { event, actor: request.actor, paymentMode }),
      }
    },
  })

  defineRoute(app, 'events.delete', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await deletable(request, { write: true })
      const result = await deleteEvent(prisma, {
        event,
        actor: request.actor,
        body: request.body,
        providers,
        paymentMode,
        requestId: request.id,
      })

      let refunds = result.refunds

      if (result.refundError) {
        // The deletion stands; the refunds left are sent by `events.finishRefunds`.
        request.log.error(
          { eventId: event.id, err: result.refundError },
          'refunds after deletion did not all go through',
        )

        // Null means an outcome that refunds nobody, so a pass that broke off
        // says what is waiting instead.
        refunds = await waitingRefunds(
          prisma,
          await prisma.event.findUnique({ where: { id: event.id }, include: { sessions: true } }),
        )
      }

      request.log.info(
        { eventId: event.id, outcome: result.outcome, actorId: request.actor?.id },
        'event deleted',
      )

      return {
        data: {
          event: await detailFor(event.id, request.actor),
          refunds,
        },
      }
    },
  })

  defineRoute(app, 'events.finishRefunds', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await deletable(request, { write: true })

      if (event.status !== 'CANCELLED' && event.status !== 'DELETED') {
        throw httpError(
          409,
          'NOT_CANCELLED',
          'Only a cancelled or deleted event has refunds to send from here.',
          { status: event.status },
        )
      }

      const answer = deletionAuthority(request.actor, event, 'CANCEL_AND_REFUND')

      if (!answer.permitted) throw forbidden(answer.missing, 'REFUND_AUTHORITY_REQUIRED')

      if ((await countOwedRefunds(prisma, event)) === 0) {
        // Refunds a dispute holds back are the finance team's to settle, not
        // sendable from here, and the answer says so rather than "all sent".
        const disputed = await countDisputedRefunds(prisma, event)

        throw httpError(
          409,
          'NOTHING_OWED',
          disputed > 0
            ? `Every refund this event owes that can be sent from here has been sent. ${disputed === 1 ? 'One is' : `${disputed} are`} held by a payment dispute, which the finance team settles.`
            : 'Every refund this event owes has been sent.',
          { disputed },
        )
      }

      const summary = await refundOwed(prisma, {
        event,
        actor: request.actor,
        providers,
        via: 'finish_refunds',
        paymentMode,
        requestId: request.id,
      })

      return { data: summary }
    },
  })

  defineRoute(app, 'events.sessionCancellationPreview', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const { event, session } = await cancellable(request)
      let access = { permitted: true, missing: null }

      if (!memberHolds(request.actor, CAPABILITIES.EVENT_CANCEL, event.organizationId)) {
        const sitting = await openSittingOf(prisma, {
          eventId: event.id,
          actorId: request.actor.id,
          now: new Date(),
        })

        if (!PLATFORM_EDITABLE_STATUSES.has(event.status)) {
          access = { permitted: false, missing: NOT_POSTED_SENTENCE }
        } else if (!sitting || sitting.sessionId !== request.session?.id) {
          access = { permitted: false, missing: PLATFORM_EDIT_NOT_OPEN_SENTENCE }
        }
      }

      return {
        data: await sessionCancellationPreview(prisma, { event, session, access, paymentMode }),
      }
    },
  })

  defineRoute(app, 'events.cancelSession', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const { event, session } = await cancellable(request, { write: true })
      const authority = await resolveEventAuthority(prisma, {
        event,
        actor: request.actor,
        session: request.session,
        orgCapability: CAPABILITIES.EVENT_CANCEL,
        platformCapability: CAPABILITIES.EVENT_PLATFORM_DELETE,
      })

      const result = await cancelSession(prisma, {
        event,
        session,
        actor: request.actor,
        authority,
        sessionId: request.session?.id ?? null,
        body: request.body,
        providers,
        paymentMode,
        requestId: request.id,
      })

      let refunds = result.refunds

      if (!refunds) {
        request.log.error(
          { eventId: event.id, sessionId: session.id, err: result.refundError },
          'refunds after a night was cancelled did not all go through',
        )

        refunds = await waitingRefunds(prisma, event, session.id)
      }

      const zones = await loadZonesByVersion(prisma, [result.session.venueMapVersionId])

      return { data: { session: toSession(result.session, zones), refunds } }
    },
  })

  defineRoute(app, 'events.platformEdits', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, organizationId: true },
      })
      const platformReader =
        platformHolds(request.actor, CAPABILITIES.EVENT_PLATFORM_EDIT) ||
        can(request.actor, CAPABILITIES.MODERATION_REVIEW)
      const allowed =
        event &&
        (platformReader ||
          memberHolds(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, event.organizationId))

      if (!allowed) throw notFound('No such event.')

      const sittings = await prisma.eventPlatformEdit.findMany({
        where: { eventId: event.id },
        include: { actor: { select: { displayName: true } } },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      })

      /** @type {Map<string, Array<{action: string, fields: string[], at: string}>>} */
      const changes = new Map(sittings.map((row) => [row.id, []]))

      if (sittings.length > 0) {
        const since = sittings.reduce(
          (earliest, row) => (row.openedAt < earliest ? row.openedAt : earliest),
          sittings[0].openedAt,
        )
        const audits = await prisma.auditLog.findMany({
          where: { entityType: 'Event', entityId: event.id, createdAt: { gte: since } },
          select: { action: true, metadata: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 2000,
        })

        for (const audit of audits) {
          // The sitting's own opening and closing are not changes to the event.
          if (
            audit.action === AUDIT_ACTIONS.EVENT_PLATFORM_EDIT_OPENED ||
            audit.action === AUDIT_ACTIONS.EVENT_PLATFORM_EDIT_CLOSED
          ) {
            continue
          }

          const list = changes.get(audit.metadata?.platformEditId)

          // The action and the field names: never the values.
          if (list && list.length < 200) {
            list.push({
              action: audit.action,
              fields: Array.isArray(audit.metadata?.fields)
                ? audit.metadata.fields.map(String).slice(0, 40)
                : [],
              at: new Date(audit.createdAt).toISOString(),
            })
          }
        }
      }

      const now = new Date()

      return {
        data: sittings.map((row) =>
          toPlatformEdit(row, {
            actor: request.actor,
            platformReader,
            changes: changes.get(row.id),
            now,
          }),
        ),
      }
    },
  })

  defineRoute(app, 'platformEvents.list', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const query = request.query
      /** @type {object[]} */
      const conditions = []

      if (query.deleted === 'exclude') conditions.push({ status: { not: 'DELETED' } })
      if (query.deleted === 'only') conditions.push({ status: 'DELETED' })
      if (query.status) conditions.push({ status: query.status })
      if (query.organizationId) conditions.push({ organizationId: query.organizationId })

      if (query.q) {
        const contains = { contains: likeLiteral(query.q), mode: 'insensitive' }

        conditions.push({
          OR: [{ title: contains }, { slug: contains }, { organization: { name: contains } }],
        })
      }

      // Whether an event came from an import is its one import record.
      if (query.imported === 'only') conditions.push({ importItem: { isNot: null } })
      if (query.imported === 'exclude') conditions.push({ importItem: { is: null } })

      const where = { AND: conditions }
      const { skip, take } = toSkipTake(query)
      const [events, total] = await Promise.all([
        prisma.event.findMany({
          where,
          orderBy: PLATFORM_SORT[query.sort] ?? PLATFORM_SORT['updatedAt:desc'],
          skip,
          take,
          include: { organization: { select: { id: true, name: true } } },
        }),
        prisma.event.count({ where }),
      ])

      // One grouped count each for the page, not two counts per row.
      const pageIds = events.map((event) => event.id)
      const [paidGroups, waitingGroups, importRows] =
        pageIds.length === 0
          ? [[], [], []]
          : await Promise.all([
              prisma.order.groupBy({
                by: ['eventId'],
                where: { eventId: { in: pageIds }, status: 'PAID' },
                _count: { _all: true },
              }),
              prisma.mediaAsset.groupBy({
                by: ['eventId'],
                where: { eventId: { in: pageIds }, moderationStatus: 'PENDING' },
                _count: { _all: true },
              }),
              prisma.eventImportItem.findMany({
                where: { eventId: { in: pageIds } },
                select: { eventId: true },
              }),
            ])
      const countsBy = (groups) =>
        new Map(groups.map((group) => [group.eventId, group._count?._all ?? 0]))
      const paidBy = countsBy(paidGroups)
      const waitingBy = countsBy(waitingGroups)
      const importedIds = new Set(importRows.map((row) => row.eventId))

      const rows = await Promise.all(
        events.map(async (event) => {
          const paidOrders = paidBy.get(event.id) ?? 0
          const picturesWaiting = waitingBy.get(event.id) ?? 0

          return {
            id: event.id,
            title: event.title,
            slug: event.slug,
            status: event.status,
            startsAt: new Date(event.startsAt).toISOString(),
            updatedAt: new Date(event.updatedAt).toISOString(),
            organization: { id: event.organization.id, name: event.organization.name },
            paidOrders,
            picturesWaiting,
            imported: importedIds.has(event.id),
            deletion:
              event.status === 'DELETED'
                ? {
                    deletedAt: new Date(event.deletedAt).toISOString(),
                    outcome: OUTCOME_WIRE[event.deletionOutcome] ?? 'REMOVE',
                    authority: event.deletionAuthority ?? 'ORGANIZATION',
                    statusBefore: event.statusBeforeDeletion,
                    restoreTo: restoreTarget(event.statusBeforeDeletion),
                  }
                : null,
          }
        }),
      )

      return {
        data: rows,
        pagination: buildPaginationMeta({ page: query.page, perPage: query.perPage, total }),
      }
    },
  })

  defineRoute(app, 'platformEvents.openEdit', {
    // After the session, capability and step-up guards: a refused caller
    // spends nothing of the budget.
    preHandler: [editBudget],
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, organizationId: true, status: true },
      })

      if (!event) throw notFound('No such event.')

      if (!PLATFORM_EDITABLE_STATUSES.has(event.status)) {
        throw httpError(409, 'NOT_POSTED', NOT_POSTED_SENTENCE, { status: event.status })
      }

      const now = new Date()
      const actorId = request.actor.id
      const reason = request.body.reason

      /**
       * The sitting this administrator has open on the event now, if any.
       *
       * @returns {Promise<object|null>} The row.
       */
      const openRow = () =>
        prisma.eventPlatformEdit.findFirst({
          where: { eventId: event.id, actorId, closedAt: null },
          orderBy: { openedAt: 'desc' },
          include: { actor: { select: { displayName: true } } },
        })

      let row

      try {
        row = await budgetedTransaction(prisma, SITTING_OPEN_BUDGET, async (tx) => {
          // An earlier sitting of this administrator on the event ends here:
          // SUPERSEDED while it was still running, EXPIRED once it had run out.
          const superseded = await tx.eventPlatformEdit.updateMany({
            where: { eventId: event.id, actorId, closedAt: null, expiresAt: { gt: now } },
            data: { closedAt: now, endedBy: 'SUPERSEDED' },
          })
          const lapsed = await tx.eventPlatformEdit.updateMany({
            where: { eventId: event.id, actorId, closedAt: null },
            data: { closedAt: now, endedBy: 'EXPIRED' },
          })

          const created = await tx.eventPlatformEdit.create({
            data: {
              eventId: event.id,
              actorId,
              sessionId: request.session?.id ?? null,
              reason,
              openedAt: now,
              expiresAt: new Date(now.getTime() + PLATFORM_EDIT_WINDOW_MS),
            },
            include: { actor: { select: { displayName: true } } },
          })

          await recordAudit(tx, {
            action: AUDIT_ACTIONS.EVENT_PLATFORM_EDIT_OPENED,
            entityType: 'Event',
            entityId: event.id,
            actorId,
            metadata: {
              requestId: request.id,
              organizationId: event.organizationId,
              platformEditId: created.id,
              reason,
              expiresAt: created.expiresAt.toISOString(),
              superseded: superseded.count,
              expired: lapsed.count,
            },
          })

          return created
        })
      } catch (error) {
        // A double click: the partial unique index lets one open sitting per
        // administrator per event exist, and the other click gets that one.
        if (databaseErrorCode(error) !== 'P2002' && databaseErrorCode(error) !== '23505') {
          throw error
        }

        row = await openRow()

        if (!row) throw error
      }

      return {
        data: toPlatformEdit(row, { actor: request.actor, platformReader: true, now }),
      }
    },
  })

  defineRoute(app, 'platformEvents.closeEdit', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, organizationId: true },
      })

      if (!event) throw notFound('No such event.')

      const now = new Date()
      const actorId = request.actor.id

      const closed = await budgetedTransaction(prisma, SITTING_CLOSE_BUDGET, async (tx) => {
        const open = await tx.eventPlatformEdit.findFirst({
          where: { eventId: event.id, actorId, closedAt: null },
          orderBy: { openedAt: 'desc' },
        })

        if (!open) return null

        const endedBy = new Date(open.expiresAt).getTime() <= now.getTime() ? 'EXPIRED' : 'CLOSED'
        const { count } = await tx.eventPlatformEdit.updateMany({
          where: { id: open.id, closedAt: null },
          data: { closedAt: now, endedBy },
        })

        if (count !== 1) return null

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.EVENT_PLATFORM_EDIT_CLOSED,
          entityType: 'Event',
          entityId: event.id,
          actorId,
          metadata: {
            requestId: request.id,
            organizationId: event.organizationId,
            platformEditId: open.id,
            endedBy,
          },
        })

        return open.id
      })

      // Idempotent: with none open, the latest sitting as it stands.
      const row = await prisma.eventPlatformEdit.findFirst({
        where: closed ? { id: closed } : { eventId: event.id, actorId },
        orderBy: { openedAt: 'desc' },
        include: { actor: { select: { displayName: true } } },
      })

      if (!row) throw notFound('You have no editing sitting on this event.')

      return { data: toPlatformEdit(row, { actor: request.actor, platformReader: true, now }) }
    },
  })

  defineRoute(app, 'platformEvents.restore', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        include: { organization: true },
      })

      if (!event) throw notFound('No such event.')

      const result = await restoreEvent(prisma, {
        event,
        actor: request.actor,
        reason: request.body.reason,
        revision: request.body.revision,
        requestId: request.id,
      })

      request.log.info(
        { eventId: event.id, to: result.to, actorId: request.actor?.id },
        'event restored',
      )

      return { data: await detailFor(event.id, request.actor) }
    },
  })
}
