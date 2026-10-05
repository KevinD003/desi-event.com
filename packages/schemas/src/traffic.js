/**
 * What a browser may say about a visit, and how the platform list of every
 * event's visits is asked for.
 *
 * Request schemas only. The answers (`analyticsTrafficSchema`,
 * `trafficEventListResponseSchema`, `trafficBeaconResponseSchema`) live in
 * `responses.js` beside every other response, and this module does not import
 * that one, so the barrel has no cycle through it.
 *
 * The words come from `traffic-vocabulary.js`, which the browser imports on its
 * own; nothing here adds a word of its own.
 *
 * @module @desi-event/schemas/traffic
 */

import { z } from 'zod'

import {
  cuidSchema,
  paginationQuerySchema,
  queryDateTimeSchema,
  withoutControlCharacters,
} from './primitives.js'
import {
  CARD_PLACEMENTS,
  EVENT_ID_PATTERN,
  REFERRER_HOST_PATTERN,
  REFERRER_MARKERS,
  TRAFFIC_BEACON_KINDS,
  TRAFFIC_PLACEMENTS,
} from './traffic-vocabulary.js'

/** A UTC calendar day, `YYYY-MM-DD`. */
export const utcDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a UTC day, YYYY-MM-DD')

/**
 * An event id as a beacon carries it: the shared pattern, and nothing trimmed
 * or folded on the way in, so what is counted is exactly what was sent.
 */
export const trafficEventIdSchema = z
  .string()
  .max(32)
  .regex(EVENT_ID_PATTERN, 'Expected an event reference')

/**
 * A referring site's host name, lower-case, as `new URL(...).hostname` gives
 * it. No scheme, port, path, query or credentials: a beacon that carried any of
 * those would be carrying a URL, which this system promised not to keep.
 */
export const referrerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(REFERRER_HOST_PATTERN, 'Expected a lower-case host name')

/**
 * One beacon from a browser.
 *
 * Strict: an unknown key — `url`, `ip`, `userAgent`, `referrerUrl` — is a 400,
 * so a client can never start sending something this system promised not to
 * keep. `placement` is required: a click with no place is a click nobody can
 * explain.
 */
export const trafficBeaconRequestSchema = z
  .object({
    eventId: trafficEventIdSchema,
    kind: z.enum([...TRAFFIC_BEACON_KINDS]),
    placement: z.enum([...TRAFFIC_PLACEMENTS]),
    /**
     * For a page view only: `null` when there was no referrer, `SAME_SITE` for
     * this site, a host name, or `OTHER_SITE` for anything that is not one.
     */
    referrer: z
      .union([
        z.enum([REFERRER_MARKERS.SAME_SITE, REFERRER_MARKERS.OTHER_SITE]),
        referrerHostSchema,
      ])
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((beacon, ctx) => {
    const onACard = CARD_PLACEMENTS.includes(beacon.placement)
    const fits = beacon.kind === 'CARD_CLICK' ? onACard : beacon.placement === 'EVENT_PAGE'

    if (!fits) {
      ctx.addIssue({
        code: 'custom',
        path: ['placement'],
        message: 'A card is clicked on a listing; everything else happens on the event page.',
      })
    }

    if (beacon.kind !== 'PAGE_VIEW' && beacon.referrer !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['referrer'],
        message: 'Only a page view says where it came from.',
      })
    }
  })

/** Which events the platform list covers. */
export const TRAFFIC_LIST_SCOPES = Object.freeze(['public', 'all'])

/**
 * `GET /v1/traffic/events`: every event's visits, for platform administrators.
 *
 * `scope=public` (the default) lists events the public can see, plus deleted
 * ones, which were seen and sold before they were taken down; `scope=all` adds
 * drafts and those in review. `q` matches the title, the web address or the
 * organiser's name.
 */
export const trafficEventsQuerySchema = paginationQuerySchema.extend({
  q: withoutControlCharacters(z.string().trim().min(1).max(100)).optional(),
  scope: z.enum([...TRAFFIC_LIST_SCOPES]).default('public'),
  organizationId: cuidSchema.optional(),
  from: queryDateTimeSchema.optional(),
  to: queryDateTimeSchema.optional(),
})
