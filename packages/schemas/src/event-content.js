/**
 * The public content an organiser adds to an event page beyond the listing.
 *
 * Questions people ask, the line-up with roles and short bios, a running
 * order, sponsors, links to the organiser's social accounts, a dress code,
 * parking and arrival notes, and a public contact. Every one of these is shown
 * to strangers on the event page, so every one is bounded here and again in
 * the database, and every link is `https:` — an `http:` or `javascript:`
 * address in a sponsor's name is a phishing link with an event's reputation
 * behind it.
 *
 * ## Social links name the network they point at
 *
 * A link labelled "Instagram" goes to Instagram. Each network has a short list
 * of hosts, and an address on any other host is refused for that key, so an
 * "Instagram" label can never point at a look-alike domain. The organiser's own
 * website is not a social link: it has its own field, `websiteUrl`
 * (`@desi-event/schemas/website`), behind a switch only the team at The Desi Events
 * turns, and a `website` key here is refused with a sentence saying so.
 *
 * ## Public contact is not the account contact
 *
 * `publicEmail` and `publicPhone` are what the organiser chose to publish; the
 * database keeps them in their own columns (`Event.publicContactEmail` and
 * `Event.publicContactPhone`). The private account contact on the event and on
 * the organisation stays out of every public payload (finding NF-14).
 *
 * The wire names deliberately do not contain the private column's name. The
 * browser-bundle scan and the public-payload tests look for that name as a
 * substring, and a public field that contained it would make both checks match
 * every page and prove nothing.
 *
 * Imported as `@desi-event/schemas/event-content`, a subpath, so the browser can
 * mirror the limits without taking the schemas barrel (finding NF-16).
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/schemas/event-content
 */

import { z } from 'zod'

import { emailSchema, phoneSchema } from './primitives.js'

/**
 * Every bound on the event content, in one place.
 *
 * The web mirrors these (`apps/web/src/lib/event-content.js`) and a test holds
 * the two copies equal, so a form's counter and the server's refusal agree.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const EVENT_CONTENT_LIMITS = Object.freeze({
  faqItems: 30,
  faqQuestion: 200,
  faqAnswer: 2000,
  performers: 64,
  performerName: 500,
  performerRole: 80,
  performerBio: 600,
  runningOrderItems: 40,
  runningOrderTitle: 160,
  runningOrderNote: 300,
  sponsors: 30,
  sponsorName: 120,
  sponsorLevel: 60,
  dressCode: 500,
  directions: 2000,
  url: 2048,
  tierName: 120,
  tierDescription: 500,
  perOrderMax: 50,
})

/** The social networks an event page links to, in the order the page lists them. */
export const SOCIAL_NETWORKS = Object.freeze(['instagram', 'facebook', 'youtube', 'x', 'whatsapp'])

/** How each network is named to a person. */
export const SOCIAL_NETWORK_LABELS = Object.freeze({
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  whatsapp: 'WhatsApp',
})

/**
 * The hosts each network's link may point at.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SOCIAL_HOSTS = Object.freeze({
  instagram: Object.freeze(['instagram.com', 'www.instagram.com']),
  facebook: Object.freeze([
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'fb.com',
    'www.fb.com',
  ]),
  youtube: Object.freeze(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']),
  x: Object.freeze(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
  whatsapp: Object.freeze([
    'wa.me',
    'chat.whatsapp.com',
    'api.whatsapp.com',
    'whatsapp.com',
    'www.whatsapp.com',
  ]),
})

/** A running-order time: local 24-hour `HH:mm`, 00:00 to 23:59. */
export const RUNNING_ORDER_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Trim a string, leaving any other value for the wrapped schema to refuse.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} The trimmed string, or `value` unchanged.
 */
function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value
}

/**
 * Trim a string and turn a blank one into null, so an emptied optional box
 * clears the field rather than storing whitespace.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} The trimmed string, null for a blank one, or `value` unchanged.
 */
function blankToNull(value) {
  if (typeof value !== 'string') return value

  const text = value.trim()

  return text.length === 0 ? null : text
}

/**
 * Whether a string is an absolute `https:` address.
 *
 * `new URL()` is the parser, not a pattern: a pattern is how `https:evil` or a
 * protocol-relative `//evil` slip through.
 *
 * @param {string} value The candidate.
 * @returns {boolean} True for an `https:` URL with a host.
 */
export function isHttpsUrl(value) {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)

    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

/** An absolute `https:` address, at most 2,048 characters. */
export const httpsUrlSchema = z.preprocess(
  trimmed,
  z
    .string()
    .min(1)
    .max(EVENT_CONTENT_LIMITS.url)
    .refine(isHttpsUrl, 'Use a full https:// address.'),
)

/**
 * A trimmed string between one character and `max`.
 *
 * @param {number} max The upper bound.
 * @returns {z.ZodType} The schema.
 */
function text(max) {
  return z.preprocess(trimmed, z.string().min(1).max(max))
}

/**
 * An optional trimmed string of at most `max`; blank reads as null.
 *
 * @param {number} max The upper bound.
 * @returns {z.ZodType} The schema.
 */
function optionalText(max) {
  return z.preprocess(blankToNull, z.string().max(max).nullish())
}

/** One question people ask, with its answer. */
export const eventFaqItemSchema = z
  .object({
    question: text(EVENT_CONTENT_LIMITS.faqQuestion),
    answer: text(EVENT_CONTENT_LIMITS.faqAnswer),
  })
  .strict()

/** The event's questions and answers, in the organiser's order. */
export const eventFaqSchema = z.array(eventFaqItemSchema).max(EVENT_CONTENT_LIMITS.faqItems)

/** One performer: a name, and optionally a role ("Lead vocals") and a short bio. */
export const eventPerformerSchema = z
  .object({
    name: text(EVENT_CONTENT_LIMITS.performerName),
    role: optionalText(EVENT_CONTENT_LIMITS.performerRole),
    bio: optionalText(EVENT_CONTENT_LIMITS.performerBio),
  })
  .strict()

/**
 * The line-up, in billing order.
 *
 * The source of truth for who is playing. `Event.artists`, the names alone, is
 * kept in step by the server, because structured data and older clients read it.
 */
export const eventPerformersSchema = z
  .array(eventPerformerSchema)
  .max(EVENT_CONTENT_LIMITS.performers)

/** One running-order slot: a local time, what happens, and an optional note. */
export const eventRunningOrderItemSchema = z
  .object({
    time: z.preprocess(
      trimmed,
      z.string().regex(RUNNING_ORDER_TIME, 'Use a 24-hour time such as 19:30.'),
    ),
    title: text(EVENT_CONTENT_LIMITS.runningOrderTitle),
    note: optionalText(EVENT_CONTENT_LIMITS.runningOrderNote),
  })
  .strict()

/**
 * The running order, one for the whole event.
 *
 * Times are local to the event's time zone. A run of several nights shows the
 * same running order for each.
 */
export const eventRunningOrderSchema = z
  .array(eventRunningOrderItemSchema)
  .max(EVENT_CONTENT_LIMITS.runningOrderItems)

/** One sponsor: a name, optionally an https website and a level ("Gold"). */
export const eventSponsorSchema = z
  .object({
    name: text(EVENT_CONTENT_LIMITS.sponsorName),
    url: z.preprocess(blankToNull, httpsUrlSchema.nullish()),
    level: optionalText(EVENT_CONTENT_LIMITS.sponsorLevel),
  })
  .strict()

/** The event's sponsors, in the organiser's order. */
export const eventSponsorsSchema = z.array(eventSponsorSchema).max(EVENT_CONTENT_LIMITS.sponsors)

/**
 * Whether an address is on a host the named network owns.
 *
 * @param {string} network One of {@link SOCIAL_NETWORKS}.
 * @param {string} href The address.
 * @returns {boolean} True when the host belongs to the network.
 */
export function isAllowedSocialHost(network, href) {
  if (!isHttpsUrl(href)) return false

  const hosts = SOCIAL_HOSTS[network]

  if (!hosts) return false

  return hosts.includes(new URL(href).hostname.toLowerCase())
}

const socialLinkSchema = z.preprocess(blankToNull, httpsUrlSchema.nullish())

/**
 * Why a `website` key in the social links is refused.
 *
 * It used to be one: a direct link to any https address, with no switch and no
 * count. The organiser's website now has its own field, shown only while the team
 * at The Desi Events has the link on, so the old key is refused by name rather
 * than dropped, and an old client is told where it went.
 */
export const SOCIAL_WEBSITE_MOVED_MESSAGE =
  'Your website has its own field: send it as websiteUrl. It appears on the event page only while the team at The Desi Events has the website link on.'

/**
 * Links to the organiser's accounts, one per network.
 *
 * Strict: an unknown key is refused, not dropped, so a misspelt network is an
 * error the organiser sees rather than a link that silently vanishes. The
 * former `website` key is refused with {@link SOCIAL_WEBSITE_MOVED_MESSAGE}.
 */
export const eventSocialLinksSchema = z
  .object({
    ...Object.fromEntries(SOCIAL_NETWORKS.map((network) => [network, socialLinkSchema])),
    website: z.never({ error: SOCIAL_WEBSITE_MOVED_MESSAGE }).optional(),
  })
  .strict()
  .superRefine((links, ctx) => {
    for (const network of SOCIAL_NETWORKS) {
      const href = links[network]

      // A malformed or non-https address has already been refused by the
      // field's own schema; saying so twice is noise.
      if (typeof href !== 'string' || !isHttpsUrl(href)) continue

      if (!isAllowedSocialHost(network, href)) {
        ctx.addIssue({
          code: 'custom',
          path: [network],
          message: `That address is not on ${SOCIAL_NETWORK_LABELS[network]}. Use a link that starts https://${SOCIAL_HOSTS[network][0]}/.`,
        })
      }
    }
  })

/** What to wear, as one short paragraph. Blank clears it. */
export const dressCodeSchema = z.preprocess(
  blankToNull,
  z.string().max(EVENT_CONTENT_LIMITS.dressCode).nullable(),
)

/**
 * This event's parking and arrival notes, layered over the venue's own
 * directions. Blank clears it.
 */
export const eventDirectionsSchema = z.preprocess(
  blankToNull,
  z.string().max(EVENT_CONTENT_LIMITS.directions).nullable(),
)

/** The public contact email: an address the organiser chose to publish. Blank clears it. */
export const publicEmailSchema = z.preprocess(blankToNull, emailSchema.nullable())

/** The public contact phone number. Blank clears it. */
export const publicPhoneSchema = z.preprocess(blankToNull, phoneSchema.nullable())
