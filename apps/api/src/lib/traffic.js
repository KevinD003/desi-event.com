/**
 * Counting visits to event pages: who the visitor is for one day and one event,
 * and the one place a counted moment is written.
 *
 * ## What is kept, and what is not
 *
 * A counted moment (`TrafficEvent`) holds the event, the kind, the place, a
 * source category for a page view, the UTC day, a visitor code and a dedupe
 * digest. It holds no time of day, no address, no browser string, no URL, no
 * referring site and no account, and its id is a random UUID because a cuid
 * carries its creation time.
 *
 * The visitor code is `HMAC(daySalt, event ␟ fingerprint)`, truncated to 128
 * bits, where the fingerprint is `sha256(address ␟ userAgent)` made in memory
 * for this request and never stored or logged. The day's salt is 32 random
 * bytes, deleted from the live database once the day is over (by the API when
 * it makes the next day's, and by every roll-up), after which nobody holding
 * the database can rebuild a code from an address. Backups taken during the
 * day keep that salt for as long as they are kept. The code includes the
 * event, so one person's visits to two events cannot be linked.
 *
 * The dedupe digest is keyed by the day's salt too, so the slot it folds over
 * (a time of day) cannot be recomputed from a row's columns.
 *
 * ## What is not counted
 *
 * - Robots ({@link isAutomatedAgent}): answered like everyone else, not stored.
 * - A request with no usable address (`NO_ADDRESS`): with nothing to fold
 *   repeats on, one browser could be counted any number of times, so it is not
 *   stored at all. The web tier always forwards the address it computed.
 * - An event that is not publicly visible (`NOT_PUBLIC`), deleted ones
 *   included.
 * - Repeats in the same slot (`DUPLICATE`): half an hour for a page view, ten
 *   minutes for a click or a website visit.
 * - More than {@link EVENT_CEILING_PER_MINUTE} moments for one event in one
 *   minute in this process (`CEILING`), which bounds what a forged address can
 *   inflate.
 *
 * A browser that sends Global Privacy Control or Do Not Track gets no code at
 * all: its page view is counted as a view, never as a visitor, and its repeats
 * are folded in memory only, under a key made with a secret this process
 * forgets when it stops.
 *
 * ## Where the address comes from
 *
 * Every browser request reaches the API through the web tier's same-origin
 * proxy, so the socket address is the web server's. The web tier sends the
 * visitor's address as `x-desi-client-address`, and the API believes it only
 * when the socket address is one of `TRAFFIC_TRUSTED_FORWARDERS`. Anybody else
 * who connects is counted as their own address. `trustProxy` stays off for
 * everything else.
 *
 * Nothing here is audited: an audit row per visit would itself be a log of
 * visits. Nothing here logs an address, an agent, a code or a salt.
 *
 * @module @desi-event/api/lib/traffic
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { DEFAULT_TRAFFIC_TRUSTED_FORWARDERS } from '@desi-event/schemas/env'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { CARD_PLACEMENTS, TRAFFIC_EVENT_KINDS } from '@desi-event/schemas/traffic-vocabulary'

export { TRAFFIC_EVENT_KINDS }

/** The header the web tier carries the visitor's address in. */
export const CLIENT_ADDRESS_HEADER = 'x-desi-client-address'

/** A longer user agent is not a browser's. */
export const MAX_USER_AGENT_LENGTH = 512

/** How long one visitor's repeats fold into one, per kind, in minutes of the UTC day. */
export const DEDUPE_SLOT_MINUTES = Object.freeze({
  PAGE_VIEW: 30,
  CARD_CLICK: 10,
  TICKETS_CLICK: 10,
  SEATS_CLICK: 10,
  WEBSITE_REDIRECT: 10,
})

/** The most moments one event may have counted in one minute, in this process. */
export const EVENT_CEILING_PER_MINUTE = 3000

/** How many events' public status this process remembers. */
export const PUBLIC_STATUS_CACHE_SIZE = 10_000

/** How long a remembered public status is believed. */
export const PUBLIC_STATUS_TTL_MS = 60_000

/** How many repeats without a visitor code this process remembers, to fold them. */
export const ANONYMOUS_FOLD_LIMIT = 50_000

/**
 * User agents that are not a person reading a page.
 *
 * Word-boundary forms, so a phone whose model name ends in "bot" (a Cubot) is
 * a person, while `Googlebot/2.1`, `HeadlessChrome` and a crawler that calls
 * itself "compatible; PetalBot" are not. No bare "monitor": that word is in
 * ordinary browsers' device names.
 *
 * @type {RegExp}
 */
export const AUTOMATED_AGENT_PATTERN =
  /\bbot\b|bot\/|\(compatible;[^)]*(?:bot|crawl|spider)|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|\bcurl\b|wget|python|httpclient|okhttp|go-http|java\/|node-fetch|axios|undici|facebookexternalhit|embedly|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|bingpreview|googleother|uptime-?robot|pingdom/iu

/** U+001F, the separator the session code uses between hashed parts. */
const SEPARATOR = String.fromCharCode(31)

/** Where a visitor object keeps its fingerprint: not enumerable, never serialised. */
const FINGERPRINT = Symbol('fingerprint')

/** Made when the process starts and never persisted: keys the limiter and the fold. */
const PROCESS_KEY = randomBytes(32)

const MINUTE_MS = 60_000

/**
 * @param {string} value Input.
 * @returns {string} Lower-case hex SHA-256.
 */
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * @param {Buffer|string} key The HMAC key.
 * @param {string} value Input.
 * @returns {string} Lower-case hex HMAC-SHA256.
 */
function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

/**
 * One header value as a string, or the empty string.
 *
 * A repeated header arrives as an array; a visitor's agent and address are
 * single values, so a repeat is treated as absent rather than guessed at.
 *
 * @param {unknown} value A header value.
 * @returns {string} The value, or ''.
 */
function headerText(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Whether a user agent belongs to a robot, or is no browser's at all.
 *
 * @param {unknown} userAgent The `user-agent` header.
 * @returns {boolean} True when it is missing, empty, too long or automated.
 */
export function isAutomatedAgent(userAgent) {
  if (typeof userAgent !== 'string' || userAgent.trim().length === 0) return true
  if (userAgent.length > MAX_USER_AGENT_LENGTH) return true

  return AUTOMATED_AGENT_PATTERN.test(userAgent)
}

/**
 * Whether the browser asked not to be tracked.
 *
 * @param {object} headers Request headers, lower-case names.
 * @returns {boolean} True for `Sec-GPC: 1` or `DNT: 1`.
 */
export function privacySignal(headers = {}) {
  return headerText(headers['sec-gpc']).trim() === '1' || headerText(headers.dnt).trim() === '1'
}

/**
 * The visitor's address, as far as this API can believe one.
 *
 * @param {object} request A Fastify request.
 * @returns {string|null} An IP literal, or null when none can be believed.
 */
export function clientAddressOf(request) {
  const forwarders = request.server?.env?.TRAFFIC_TRUSTED_FORWARDERS ?? [
    ...DEFAULT_TRAFFIC_TRUSTED_FORWARDERS,
  ]
  const peer = typeof request.ip === 'string' ? request.ip : ''

  if (forwarders.includes(peer)) {
    // A web server speaking for a visitor. Only a single, well-formed literal
    // is believed; a list or a word means the forwarder sent nothing usable.
    const forwarded = headerText(request.headers?.[CLIENT_ADDRESS_HEADER]).trim()

    return isIP(forwarded) === 0 ? null : forwarded.toLowerCase()
  }

  // Anybody else is speaking for themselves.
  return isIP(peer) === 0 ? null : peer.toLowerCase()
}

/**
 * Who is visiting, for this request only.
 *
 * The fingerprint is kept on a symbol, and `toJSON` prints two booleans, so a
 * visitor that reaches a logger or a response by accident says nothing about
 * the person.
 *
 * @param {object} request A Fastify request.
 * @returns {{bot: boolean, identifiable: boolean, privacySignal: boolean, rateKey: string|null, toJSON: function(): object}} The visitor.
 */
export function visitorFromRequest(request) {
  const headers = request.headers ?? {}
  const userAgent = headerText(headers['user-agent'])
  const address = clientAddressOf(request)
  const bot = isAutomatedAgent(headers['user-agent'])
  const signal = privacySignal(headers)
  const identifiable = !bot && !signal && address !== null
  const rateKey = address
    ? hmacHex(PROCESS_KEY, address + SEPARATOR + sha256Hex(userAgent)).slice(0, 32)
    : null

  const visitor = {
    bot,
    identifiable,
    privacySignal: signal,
    rateKey,
    toJSON() {
      return { bot, identifiable }
    },
  }

  Object.defineProperty(visitor, 'toJSON', { enumerable: false })
  Object.defineProperty(visitor, FINGERPRINT, {
    value: address ? sha256Hex(address + SEPARATOR + userAgent) : null,
    enumerable: false,
  })

  return visitor
}

/**
 * The rate-limit key for this request's visitor: a process-local digest of the
 * address and the browser, or null when no address arrived.
 *
 * @param {object} request A Fastify request.
 * @returns {string|null} 32 hex characters, or null.
 */
export function visitorRateKey(request) {
  return visitorFromRequest(request).rateKey
}

/**
 * @param {Date} date An instant.
 * @returns {string} Its UTC day, `YYYY-MM-DD`.
 */
export function utcDay(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * @param {string} day `YYYY-MM-DD`.
 * @returns {Date} Midnight UTC that day.
 */
export function dayDate(day) {
  return new Date(`${day}T00:00:00.000Z`)
}

/**
 * The minute of the UTC day the instant's dedupe slot starts at.
 *
 * @param {Date} date An instant.
 * @param {string} kind A traffic kind.
 * @returns {number} Minutes since midnight UTC, a multiple of the kind's slot.
 */
export function slotOf(date, kind) {
  const size = DEDUPE_SLOT_MINUTES[kind]

  return Math.floor((date.getUTCHours() * 60 + date.getUTCMinutes()) / size) * size
}

/** The day's salt, remembered for the day it belongs to. */
const saltMemory = new Map()

/** eventId → { publicNow, expiresAt }, oldest first. */
const statusMemory = new Map()

/** `${eventId}:${minute}` → moments counted. */
const ceilingMemory = new Map()

/** Fold key → expiry instant, oldest first. */
const foldMemory = new Map()

let ceilingMinute = -1

/**
 * Forget everything this process remembers about visits. Tests only.
 *
 * @returns {void}
 */
export function resetTrafficMemory() {
  saltMemory.clear()
  statusMemory.clear()
  ceilingMemory.clear()
  foldMemory.clear()
  ceilingMinute = -1
}

/**
 * The day's salt: made by the first counted request of the day.
 *
 * Concurrent API instances converge, because the insert skips a duplicate and
 * everybody then reads the one row. The instance that made a new day's row
 * deletes the salts of earlier days; the roll-up deletes them too, so a failure
 * here leaves nothing behind for long.
 *
 * @param {object} db A Prisma client.
 * @param {string} day `YYYY-MM-DD`.
 * @returns {Promise<string>} 64 hex characters.
 */
export async function daySalt(db, day) {
  const remembered = saltMemory.get(day)

  if (remembered) return remembered

  const { count } = await db.trafficSalt.createMany({
    data: [{ day: dayDate(day), salt: randomBytes(32).toString('hex') }],
    skipDuplicates: true,
  })

  if (count === 1) {
    // Best effort: the roll-up deletes earlier salts on every run anyway.
    await db.trafficSalt.deleteMany({ where: { day: { lt: dayDate(day) } } }).catch(() => {})
  }

  const row = await db.trafficSalt.findUnique({ where: { day: dayDate(day) } })

  if (!row?.salt) {
    throw Object.assign(new Error('the day’s salt could not be read'), { code: 'TRAFFIC_SALT' })
  }

  saltMemory.clear()
  saltMemory.set(day, row.salt)

  return row.salt
}

/**
 * Whether an event is publicly visible, remembered for a minute.
 *
 * Unknown ids are remembered too, so an id that does not exist costs one query
 * a minute at most, however often it is sent.
 *
 * @param {object} db A Prisma client.
 * @param {string} eventId The event.
 * @param {number} nowMs The current instant.
 * @returns {Promise<boolean>} Whether its page is public.
 */
async function isPubliclyVisible(db, eventId, nowMs) {
  const remembered = statusMemory.get(eventId)

  if (remembered && remembered.expiresAt > nowMs) {
    statusMemory.delete(eventId)
    statusMemory.set(eventId, remembered)

    return remembered.publicNow
  }

  const event = await db.event.findUnique({ where: { id: eventId }, select: { status: true } })
  const publicNow = Boolean(event) && PUBLICLY_VISIBLE_STATUSES.has(event.status)

  statusMemory.delete(eventId)
  statusMemory.set(eventId, { publicNow, expiresAt: nowMs + PUBLIC_STATUS_TTL_MS })

  while (statusMemory.size > PUBLIC_STATUS_CACHE_SIZE) {
    statusMemory.delete(statusMemory.keys().next().value)
  }

  return publicNow
}

/**
 * How many moments this event has had counted this minute, in this process.
 *
 * @param {string} eventId The event.
 * @param {number} nowMs The current instant.
 * @returns {{key: string, count: number}} The counter.
 */
function ceilingCounter(eventId, nowMs) {
  const minute = Math.floor(nowMs / MINUTE_MS)

  // Only a later minute clears: a beacon still finishing from the minute
  // before must not wipe the counts already taken in this one.
  if (minute > ceilingMinute) {
    ceilingMemory.clear()
    ceilingMinute = minute
  }

  const key = `${eventId}:${minute}`

  return { key, count: ceilingMemory.get(key) ?? 0 }
}

/**
 * Whether a moment without a visitor code repeats one already counted in its
 * slot, remembering it if not.
 *
 * @param {string} key The fold key.
 * @param {number} nowMs The current instant.
 * @param {number} expiresAt When the slot ends.
 * @returns {boolean} True for a repeat.
 */
function foldedRepeat(key, nowMs, expiresAt) {
  const seen = foldMemory.get(key)

  if (seen !== undefined && seen > nowMs) return true

  foldMemory.delete(key)
  foldMemory.set(key, expiresAt)

  while (foldMemory.size > ANONYMOUS_FOLD_LIMIT) {
    foldMemory.delete(foldMemory.keys().next().value)
  }

  return false
}

/**
 * Check what a caller asked to record, before anything is read.
 *
 * @param {object} params The moment.
 * @param {string} params.eventId The event.
 * @param {string} params.kind The kind.
 * @param {string} params.placement Where it happened.
 * @param {string|null} params.source The source category, for a page view.
 * @returns {string|null} The source to store.
 * @throws {TypeError} When the kind, place or source cannot be stored.
 */
function assertMoment({ eventId, kind, placement, source }) {
  if (typeof eventId !== 'string' || eventId.length === 0) {
    throw new TypeError('recordTrafficEvent needs an eventId.')
  }
  if (!Object.hasOwn(DEDUPE_SLOT_MINUTES, kind)) {
    throw new TypeError(`recordTrafficEvent does not know the kind ${String(kind)}.`)
  }

  const fits =
    kind === 'CARD_CLICK' ? CARD_PLACEMENTS.includes(placement) : placement === 'EVENT_PAGE'

  if (!fits) {
    throw new TypeError(`A ${kind} cannot happen at ${String(placement)}.`)
  }

  if (kind !== 'PAGE_VIEW') return null

  if (!['DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'OTHER'].includes(source)) {
    throw new TypeError('A page view needs a source category.')
  }

  return source
}

/**
 * Record one counted moment, or say why it was not recorded.
 *
 * @param {object} db A Prisma client.
 * @param {object} params The moment.
 * @param {string} params.eventId The event.
 * @param {string} params.kind One of {@link TRAFFIC_EVENT_KINDS}.
 * @param {string} params.placement Where it happened; required.
 * @param {string|null} [params.source] The source category, for a page view only.
 * @param {object} params.visitor From {@link visitorFromRequest}.
 * @param {Date} [params.occurredAt] When it happened.
 * @returns {Promise<{recorded: boolean, reason: null|'BOT'|'NO_ADDRESS'|'CEILING'|'NOT_PUBLIC'|'DUPLICATE'}>} The outcome.
 * @throws {Error} Only on a database fault, or a TypeError for a moment that cannot exist.
 */
export async function recordTrafficEvent(
  db,
  { eventId, kind, placement, source = null, visitor, occurredAt = new Date() },
) {
  const storedSource = assertMoment({ eventId, kind, placement, source })
  const fingerprint = visitor?.[FINGERPRINT] ?? null

  if (!visitor || visitor.bot) return { recorded: false, reason: 'BOT' }
  if (fingerprint === null) return { recorded: false, reason: 'NO_ADDRESS' }

  const nowMs = occurredAt.getTime()
  const ceiling = ceilingCounter(eventId, nowMs)

  // Refused before the status read, so a flood costs no query once over it.
  if (ceiling.count >= EVENT_CEILING_PER_MINUTE) return { recorded: false, reason: 'CEILING' }
  if (!(await isPubliclyVisible(db, eventId, nowMs))) {
    return { recorded: false, reason: 'NOT_PUBLIC' }
  }

  // Read again after the await, and nothing awaits from here to taking the
  // place: beacons for one event that arrive together cannot all take the
  // last place under the ceiling.
  const place = ceilingCounter(eventId, nowMs)

  if (place.count >= EVENT_CEILING_PER_MINUTE) return { recorded: false, reason: 'CEILING' }

  const day = utcDay(occurredAt)
  const slot = slotOf(occurredAt, kind)

  if (!visitor.identifiable) {
    const foldKey = hmacHex(
      PROCESS_KEY,
      [eventId, day, kind, placement, slot, fingerprint].join(SEPARATOR),
    )
    const slotEnds = dayDate(day).getTime() + (slot + DEDUPE_SLOT_MINUTES[kind]) * MINUTE_MS

    if (foldedRepeat(foldKey, nowMs, slotEnds)) return { recorded: false, reason: 'DUPLICATE' }
  }

  ceilingMemory.set(place.key, place.count + 1)

  let visitorHash = null
  let dedupeKey = null

  if (visitor.identifiable) {
    const salt = await daySalt(db, day)

    visitorHash = hmacHex(salt, eventId + SEPARATOR + fingerprint).slice(0, 32)
    dedupeKey = hmacHex(salt, [eventId, day, kind, placement, slot, visitorHash].join(SEPARATOR))
  }

  const { count } = await db.trafficEvent.createMany({
    data: [
      {
        eventId,
        kind,
        placement,
        source: storedSource,
        day: dayDate(day),
        visitorHash,
        dedupeKey,
      },
    ],
    skipDuplicates: true,
  })

  return count === 1 ? { recorded: true, reason: null } : { recorded: false, reason: 'DUPLICATE' }
}

/**
 * A token bucket: `capacity` tokens, refilled evenly over `windowMs`.
 *
 * The beacon route keeps one per process, so a flood that passes every
 * per-visitor limit (one forged address after another) still cannot make this
 * process write more than its share of rows.
 *
 * @param {object} options Inputs.
 * @param {number} options.capacity Tokens in a full bucket.
 * @param {number} [options.windowMs] How long a full refill takes.
 * @returns {{take: function(number): boolean, warnDue: function(number): boolean}} The bucket.
 */
export function createTokenBucket({ capacity, windowMs = MINUTE_MS }) {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new TypeError('A token bucket needs a positive whole capacity.')
  }

  let tokens = capacity
  let refilledAt = null
  let lastWarnedMinute = null

  return {
    /**
     * Spend one token, if there is one.
     *
     * @param {number} nowMs The current instant.
     * @returns {boolean} Whether a token was spent.
     */
    take(nowMs) {
      if (refilledAt === null) refilledAt = nowMs

      tokens = Math.min(capacity, tokens + ((nowMs - refilledAt) * capacity) / windowMs)
      refilledAt = nowMs

      if (tokens < 1) return false

      tokens -= 1

      return true
    },
    /**
     * Whether the empty bucket has not been reported this minute; true once a minute.
     *
     * @param {number} nowMs The current instant.
     * @returns {boolean} Whether to warn now.
     */
    warnDue(nowMs) {
      const minute = Math.floor(nowMs / MINUTE_MS)

      if (minute === lastWarnedMinute) return false

      lastWarnedMinute = minute

      return true
    },
  }
}
