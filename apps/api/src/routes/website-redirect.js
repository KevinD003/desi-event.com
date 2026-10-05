/**
 * The organiser's website link: the administrators' switch and list, and the
 * lookup behind the tracked redirect.
 *
 * ## The switch
 *
 * `moderation.setWebsiteRedirect` and `moderation.websiteLinks` are held by
 * `website_redirect:manage` — ADMIN and SUPER_ADMIN, never a moderator and
 * never an organiser — and the decision also needs a MODERATION step-up. Both
 * are declared on the contract, so the guards run before these handlers; the
 * decision itself, its compare-and-set and its audit row are
 * `lib/website-redirect.js`'s, in one transaction.
 *
 * ## The lookup
 *
 * `traffic.websiteVisit` is server to server: the web tier calls it from
 * `GET /events/{slug}/website` and builds the 302 itself (the contract has no
 * 3xx, and the web's proxy refuses this path). It answers the address an
 * administrator approved, only while the link shows, or one 404 for every
 * other case. The address never comes from the request. Counting never blocks
 * the answer: a visit that cannot be counted is still sent on.
 *
 * @module @desi-event/api/routes/website-redirect
 */

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { websiteHost } from '@desi-event/schemas/website'

import { notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { recordTrafficEvent, visitorFromRequest } from '../lib/traffic.js'
import { BADGED_STATES } from '../lib/verification.js'
import {
  WEBSITE_LINK_ROW_SELECT,
  decideWebsiteRedirect,
  publicWebsiteLink,
  websiteLinkOrder,
  websiteLinkWhere,
  websiteRedirectState,
  websiteRedirectTarget,
} from '../lib/website-redirect.js'
import { websiteVisitRateLimit } from '../plugins/rate-limit.js'

/** The most visits through one event's link this process counts a minute. */
export const WEBSITE_VISITS_PER_EVENT_PER_MINUTE = 300

const MINUTE_MS = 60_000

/** Headers on every answer of the lookup: never stored, never indexed. */
const LOOKUP_HEADERS = Object.freeze({
  'cache-control': 'no-store, private',
  pragma: 'no-cache',
  'x-robots-tag': 'noindex, nofollow',
})

/**
 * One row of the administrators' list.
 *
 * @param {object} event An event row read with `WEBSITE_LINK_ROW_SELECT`.
 * @returns {object} A `websiteLinkRowSchema` object.
 */
export function toWebsiteLinkRow(event) {
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    organizationName: event.organization?.name ?? null,
    organizationVerified: BADGED_STATES.has(event.organization?.verificationStatus),
    websiteUrl: event.websiteUrl ?? null,
    websiteHost: websiteHost(event.websiteUrl),
    websiteDecidedUrl: event.websiteDecidedUrl ?? null,
    websiteSubmittedAt: event.websiteSubmittedAt ?? null,
    pagePublic: PUBLICLY_VISIBLE_STATUSES.has(event.status),
    redirect: websiteRedirectState(event, { administrator: true }),
  }
}

/**
 * Register the website link routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number, eventMax?: number}} [deps.websiteVisitLimit] Overrides for the lookup's limits.
 * @returns {void} Nothing.
 */
export function registerWebsiteRedirectRoutes(app, { prisma, websiteVisitLimit = {} }) {
  const { eventMax = WEBSITE_VISITS_PER_EVENT_PER_MINUTE, ...visitorLimit } = websiteVisitLimit
  /** eventId → visits counted this minute, in this process. */
  const countedThisMinute = new Map()
  let countingMinute = null

  /**
   * Take a place under the per-event ceiling, if one is left this minute.
   *
   * Synchronous from the read to the write, so visits that arrive together
   * cannot all take the last place.
   *
   * @param {string} eventId The event.
   * @param {number} nowMs The current instant.
   * @returns {boolean} Whether this visit may be counted.
   */
  function takeCountingPlace(eventId, nowMs) {
    const minute = Math.floor(nowMs / MINUTE_MS)

    if (minute !== countingMinute) {
      countedThisMinute.clear()
      countingMinute = minute
    }

    const taken = countedThisMinute.get(eventId) ?? 0

    if (taken >= eventMax) return false

    countedThisMinute.set(eventId, taken + 1)

    return true
  }

  defineRoute(app, 'traffic.websiteVisit', {
    config: { rateLimit: websiteVisitRateLimit(visitorLimit) },
    // Before the body is read: an `Origin` that is not ours is refused. The web
    // tier calls this from the server and sends none.
    onRequest: [async (request) => app.assertNotForged(request)],
    handler: async (request, reply) => {
      reply.headers(LOOKUP_HEADERS)

      const { slug, counted } = request.body
      const event = await prisma.event.findUnique({
        where: { slug },
        select: {
          id: true,
          status: true,
          websiteRedirectEnabled: true,
          websiteDecidedUrl: true,
        },
      })
      const url = websiteRedirectTarget(event)

      // One answer for no such event, a draft, the link off and an address that
      // no longer passes: nothing here says an unannounced event exists.
      if (!url) throw notFound('This event has no website link.')

      const now = new Date()
      let outcome = 'NOT_ASKED'

      if (counted) {
        const visitor = visitorFromRequest(request)

        // A robot, or a request with no visitor address, is never counted and
        // costs no query, so it takes no place under the ceiling either.
        if (visitor.bot) {
          outcome = 'BOT'
        } else if (visitor.rateKey === null) {
          outcome = 'NO_ADDRESS'
        } else if (!takeCountingPlace(event.id, now.getTime())) {
          outcome = 'CEILING'
        } else {
          try {
            const result = await recordTrafficEvent(prisma, {
              eventId: event.id,
              kind: 'WEBSITE_REDIRECT',
              placement: 'EVENT_PAGE',
              source: null,
              visitor,
              occurredAt: now,
            })

            outcome = result.recorded ? 'RECORDED' : result.reason
          } catch (error) {
            // Counting is best effort; the visitor still goes where they asked.
            outcome = 'FAILED'
            request.log.warn(
              { eventId: event.id, code: error?.code ?? null },
              'website visit not counted',
            )
          }
        }
      }

      // The host only: never the address, never the visitor.
      request.log.info(
        { eventId: event.id, host: websiteHost(url), counted, outcome },
        'website visit',
      )

      return { data: { url } }
    },
  })

  defineRoute(app, 'moderation.setWebsiteRedirect', {
    handler: async (request, reply) => {
      const { enabled, reason, websiteUrl } = request.body
      const event = await decideWebsiteRedirect(prisma, {
        eventId: request.params.id,
        enabled,
        reason,
        seenUrl: websiteUrl,
        actor: request.actor,
        now: new Date(),
      })

      request.log.info(
        { eventId: event.id, enabled, actorId: request.actor?.id },
        'website link decided',
      )

      reply.header('cache-control', 'no-store, private')

      return {
        data: {
          eventId: event.id,
          websiteUrl: event.websiteUrl ?? null,
          websiteLink: publicWebsiteLink(event),
          redirect: websiteRedirectState(event, { administrator: true }),
        },
      }
    },
  })

  defineRoute(app, 'moderation.websiteLinks', {
    handler: async (request, reply) => {
      const { page, perPage, state, q } = request.query
      const { skip, take } = toSkipTake({ page, perPage })
      const where = websiteLinkWhere({ state, q })

      const [rows, total] = await Promise.all([
        prisma.event.findMany({
          where,
          select: WEBSITE_LINK_ROW_SELECT,
          orderBy: websiteLinkOrder(state),
          skip,
          take,
        }),
        prisma.event.count({ where }),
      ])

      reply.header('cache-control', 'no-store, private')

      return {
        data: rows.map(toWebsiteLinkRow),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })
}
