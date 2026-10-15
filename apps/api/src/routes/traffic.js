/**
 * Counting visits, and the platform's view of every event's visits.
 *
 * ## The beacon
 *
 * `POST /v1/traffic/beacons` takes no session — the browser sends it with
 * `credentials: 'omit'` and the web tier strips the cookie anyway — and answers
 * the same 202 whether the visit was counted, a robot, a repeat, an event that
 * is not public or an id that does not exist, so it is no way to discover an
 * unannounced event. The only other answers are 400 for a malformed body, 403
 * for a foreign `Origin` and 429 from its own per-visitor limiter.
 *
 * Three ceilings bound what one process writes: the per-visitor limiter, a
 * per-event ceiling a minute ({@link EVENT_CEILING_PER_MINUTE}) and a
 * process-wide token bucket ({@link PROCESS_BEACONS_PER_MINUTE}). Past either
 * ceiling a beacon is answered and not counted, with one warning a minute. A
 * beacon the database could not store is answered the same way; its warning
 * is given once a minute per error code, carrying how many were held back
 * since the last one, so an outage is a line a minute and not one a beacon.
 *
 * ## The platform list
 *
 * `GET /v1/traffic/events` is held by `analytics:view_all` (ADMIN and
 * SUPER_ADMIN): counts only, no money, no buyer, no visitor code.
 *
 * Nothing here is audited: a row per visit would itself be a log of visits,
 * and a read of counts is not a privileged act.
 *
 * @module @desi-event/api/routes/traffic
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'

import { defineRoute } from '../lib/register.js'
import {
  EVENT_CEILING_PER_MINUTE,
  createTokenBucket,
  recordTrafficEvent,
  visitorFromRequest,
} from '../lib/traffic.js'
import { classifyReferrer } from '../lib/traffic-sources.js'
import { platformTraffic } from '../lib/traffic-report.js'
import { trafficBeaconRateLimit } from '../plugins/rate-limit.js'

/** The most beacons one process counts a minute, whoever sends them. */
export const PROCESS_BEACONS_PER_MINUTE = 6000

const MINUTE_MS = 60_000

/**
 * Register the traffic routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number, processMax?: number}} [deps.trafficBeaconLimit] Overrides for the beacon limits.
 * @returns {void} Nothing.
 */
export function registerTrafficRoutes(app, { prisma, trafficBeaconLimit = {} }) {
  const { processMax = PROCESS_BEACONS_PER_MINUTE, ...visitorLimit } = trafficBeaconLimit
  const processBucket = createTokenBucket({ capacity: processMax })
  /** eventId → the minute its ceiling was last reported. */
  const ceilingWarnings = new Map()
  /** error code → the minute it was last reported, and the faults held back since. */
  const faultWarnings = new Map()

  /**
   * Whether this event's ceiling has not been reported this minute.
   *
   * @param {string} eventId The event.
   * @param {number} nowMs The current instant.
   * @returns {boolean} True once per event per minute.
   */
  function ceilingWarningDue(eventId, nowMs) {
    const minute = Math.floor(nowMs / MINUTE_MS)

    for (const [id, warnedAt] of ceilingWarnings) {
      if (warnedAt !== minute) ceilingWarnings.delete(id)
    }

    if (ceilingWarnings.has(eventId)) return false

    ceilingWarnings.set(eventId, minute)

    return true
  }

  /**
   * Whether a beacon that could not be stored is due a warning: once a minute
   * for each error code.
   *
   * @param {string|null} code The error's code.
   * @param {number} nowMs The current instant.
   * @returns {number|null} When a warning is due, how many faults with this
   *   code were held back since its last one; null when it is not due.
   */
  function faultWarningDue(code, nowMs) {
    const minute = Math.floor(nowMs / MINUTE_MS)
    const key = String(code)
    const entry = faultWarnings.get(key)

    if (entry?.minute === minute) {
      entry.heldBack += 1

      return null
    }

    // Codes reported in an earlier minute with nothing held back since have
    // nothing left to say; the map stays as small as the set of codes seen.
    for (const [other, warned] of faultWarnings) {
      if (warned.minute !== minute && warned.heldBack === 0) faultWarnings.delete(other)
    }

    faultWarnings.set(key, { minute, heldBack: 0 })

    return entry?.heldBack ?? 0
  }

  defineRoute(app, 'traffic.beacon', {
    config: { rateLimit: trafficBeaconRateLimit(visitorLimit) },
    // Before the body is read: an `Origin` that is not ours is refused. No
    // session is attached on this route, so nothing else is checked.
    onRequest: [async (request) => app.assertNotForged(request)],
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache')

      const accepted = { data: { accepted: true } }
      const now = new Date()
      const nowMs = now.getTime()
      const { eventId, kind, placement, referrer } = request.body

      if (!processBucket.take(nowMs)) {
        if (processBucket.warnDue(nowMs)) {
          request.log.warn(
            { ceiling: processMax },
            'visit beacons are over this process’s ceiling; the rest of this minute’s are answered and not counted',
          )
        }

        return accepted
      }

      try {
        const result = await recordTrafficEvent(prisma, {
          eventId,
          kind,
          placement,
          source: kind === 'PAGE_VIEW' ? classifyReferrer(referrer ?? null) : null,
          visitor: visitorFromRequest(request),
          occurredAt: now,
        })

        if (result.reason === 'CEILING' && ceilingWarningDue(eventId, nowMs)) {
          request.log.warn(
            { eventId, ceiling: EVENT_CEILING_PER_MINUTE },
            'an event’s visits are over the ceiling a minute; the rest of this minute’s are not counted',
          )
        }
      } catch (error) {
        // Counted or not, the visitor gets the same answer: a visit that could
        // not be stored is not the visitor's problem, and a different answer
        // would say something about the event.
        const code = error?.code ?? null
        const heldBack = faultWarningDue(code, nowMs)

        if (heldBack !== null) {
          request.log.warn({ eventId, kind, code, heldBack }, 'traffic beacon not counted')
        }
      }

      return accepted
    },
  })

  defineRoute(app, 'traffic.events', {
    handler: async (request, reply) => {
      // Declared on the route as well: the contract's guard is what a test
      // walks, this is what runs.
      assertCan(request.actor, CAPABILITIES.ANALYTICS_VIEW_ALL)

      reply.header('cache-control', 'no-store, private')

      return platformTraffic(prisma, { ...request.query, now: new Date() })
    },
  })
}
