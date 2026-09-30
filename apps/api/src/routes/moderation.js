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

import { httpError } from '../lib/errors.js'
import { loadForTransition, transitionEvent } from '../lib/event-lifecycle.js'
import { EVENT_MEDIA_INCLUDE, approvePendingEventMedia, decideMedia } from '../lib/event-media.js'
import { EVENT_SUMMARY_SELECT, toEventDetail, toEventSummary } from '../lib/presenters.js'
import { feeConfigFor } from './orders.js'
import { defineRoute } from '../lib/register.js'

/** Relations an event payload carries out of these routes. */
const EVENT_INCLUDE = Object.freeze({
  venue: true,
  organization: true,
  ticketTypes: true,
  ...EVENT_MEDIA_INCLUDE,
})

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
 * Refuse a decision on a version of the event the moderator did not review.
 *
 * @param {{revision: number}} event The event as it is now.
 * @param {number} reviewed The revision the moderator's page showed.
 * @returns {void}
 * @throws {Error} A 409 `STALE_REVISION` when the event has changed since.
 */
function assertReviewedRevision(event, reviewed) {
  if (event.revision === reviewed) return

  throw httpError(
    409,
    'STALE_REVISION',
    'The organiser changed this event after you opened it. Reload to review it as it is now. Nothing was decided.',
    { expectedRevision: reviewed, currentRevision: event.revision },
  )
}

/**
 * Register the moderation routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.env] The parsed API environment, for the fee terms checkout charges with.
 * @returns {void} Nothing.
 */
export function registerModerationRoutes(app, { prisma, env }) {
  const pricing = env ? { feeConfigFor: (currency) => feeConfigFor(env, currency) } : {}

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
          // A queue row is a card: the summary's columns and the approved cover.
          select: EVENT_SUMMARY_SELECT,
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
      const { decision, reason = null, requestedChanges = null, revision } = request.body
      const event = await loadForTransition(prisma, request.params.id)

      // Cheap first: a page that is already out of date is told so before any
      // gate runs. Checked again inside the transaction below.
      if (revision !== undefined) assertReviewedRevision(event, revision)

      /** @type {number} */
      let picturesApproved = 0

      const updated = await transitionEvent(prisma, {
        event,
        to: DECISIONS[decision],
        actor: request.actor,
        reason,
        requestedChanges,
        onCommit: async (tx, decided) => {
          // The status write above holds the event row, so no organiser write
          // can land between this check and the commit. Every organiser write
          // — text, a picture added, one removed — bumps the revision, and a
          // withdraw-edit-resubmit brings the event back to REVIEW_PENDING
          // with a higher one; the status alone cannot tell those apart.
          if (revision !== undefined) assertReviewedRevision(decided, revision)

          // Approving the event approves the pictures still waiting, in the
          // same transaction. With `revision` pinned they are exactly the ones
          // the review page listed. A request for changes or a rejection
          // leaves them waiting.
          if (decision === 'approve') {
            picturesApproved = await approvePendingEventMedia(tx, decided, request.actor)
          }
        },
      })

      request.log.info(
        {
          eventId: event.id,
          from: event.status,
          to: updated.status,
          decision,
          picturesApproved,
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
      return {
        data: toEventDetail(full, { includeDraftTiers: true, includeOnlineUrl: true, ...pricing }),
      }
    },
  })

  defineRoute(app, 'moderation.decideMedia', {
    handler: async (request) => {
      const { decision, reason = null } = request.body
      const { asset, event } = await decideMedia(prisma, {
        mediaId: request.params.id,
        decision,
        reason,
        actor: request.actor,
      })

      request.log.info(
        { mediaId: asset.id, eventId: event.id, decision, actorId: request.actor?.id },
        'picture moderation decision',
      )

      // The event revision is unchanged on purpose: a per-picture decision
      // must not turn an organiser's open editor stale.
      return { data: asset, meta: { revision: event.revision } }
    },
  })
}
