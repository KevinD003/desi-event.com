/**
 * Moderation: the queue, and the decision.
 *
 * Two routes, both gated on `moderation:review` — a **platform** capability,
 * which no organisation role can carry. That is the property that matters here
 * and it is worth stating plainly: there is no seniority inside an organisation
 * that lets somebody approve their own event. An owner, an admin, a manager —
 * none of them can reach these routes, because the capability is not in any
 * organisation role's grant.
 *
 * The three outcomes share one route because they share every precondition and
 * differ only in what they write. Three routes would mean three places to
 * forget the audit record.
 *
 * @module @desi-event/api/routes/moderation
 */

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { loadForTransition, transitionEvent } from '../lib/event-lifecycle.js'
import { toEventDetail, toEventSummary } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'

/** Relations an event payload carries out of these routes. */
const EVENT_INCLUDE = Object.freeze({ venue: true, organization: true, ticketTypes: true })

/**
 * What each decision means as a lifecycle move.
 *
 * @type {Readonly<Record<string, string>>}
 */
const DECISIONS = Object.freeze({
  approve: 'APPROVED',
  request_changes: 'CHANGES_REQUIRED',
  reject: 'REJECTED',
})

/**
 * Register the moderation routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerModerationRoutes(app, { prisma }) {
  defineRoute(app, 'moderation.queue', {
    handler: async (request) => {
      const { page, perPage, status } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      // Oldest submission first. A queue that shows the newest first leaves the
      // oldest submission waiting longest, which is the opposite of a queue.
      const where = { status: status ?? 'REVIEW_PENDING' }

      const [rows, total] = await Promise.all([
        prisma.event.findMany({
          where,
          include: EVENT_INCLUDE,
          orderBy: [{ reviewSubmittedAt: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
        prisma.event.count({ where }),
      ])

      // `pagination`, not `meta`: this route answers with
      // `eventListResponseSchema`, the same envelope `GET /events` uses, and
      // that schema names the field. Under `meta` the counters were simply
      // absent from the payload and the response serialiser refused the whole
      // thing — which is the contract working, and it went unnoticed because
      // nothing had called this route yet.
      return {
        data: rows.map(toEventSummary),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'moderation.decide', {
    handler: async (request) => {
      const { decision, reason = null, requestedChanges = null } = request.body
      const event = await loadForTransition(prisma, request.params.id)

      const updated = await transitionEvent(prisma, {
        event,
        to: DECISIONS[decision],
        actor: request.actor,
        reason,
        requestedChanges,
      })

      request.log.info(
        {
          eventId: event.id,
          from: event.status,
          to: updated.status,
          decision,
          actorId: request.actor?.id,
        },
        'moderation decision',
      )

      const full = await prisma.event.findUnique({
        where: { id: updated.id },
        include: EVENT_INCLUDE,
      })

      // A moderator sees everything, including the tiers not on sale yet:
      // deciding whether a listing is fit to be public means seeing all of it.
      return { data: toEventDetail(full, { includeDraftTiers: true }) }
    },
  })
}
