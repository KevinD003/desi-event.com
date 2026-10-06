/**
 * Request rate limiting.
 *
 * Two budgets: a generous global one that exists to blunt scraping and
 * accidental client loops, and a much tighter one applied per route to the
 * credential endpoints, where the thing being rationed is password guesses
 * rather than bandwidth.
 *
 * @module @desi-event/api/plugins/rate-limit
 */

import rateLimit from '@fastify/rate-limit'

import { visitorRateKey } from '../lib/traffic.js'

/** Global budget: enough for a busy browsing session, far below a scraper. */
export const DEFAULT_GLOBAL_LIMIT = Object.freeze({ max: 300, timeWindow: '1 minute' })

/** Credential-endpoint budget, sized for a human who mistypes a password. */
export const DEFAULT_AUTH_LIMIT = Object.freeze({ max: 10, timeWindow: '1 minute' })

/**
 * Admission-pass budget.
 *
 * What is being rationed here is neither bandwidth nor password guesses: it is
 * how fast somebody who has taken over a session can harvest passes. A holder
 * opening their own ticket does it a handful of times before a door; thirty a
 * minute is far above that and far below useful for a scraper.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_PASS_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' })

/**
 * Door budget: previews and confirmations, per scanner.
 *
 * Keyed on the signed-in account rather than the address. A venue's scanners
 * usually share one uplink, so an address key would make every steward at a
 * door draw on one budget — and would give a single misbehaving device the
 * power to throttle all of them. Run at `preHandler`, after the session guard,
 * so the actor is known; an unauthenticated request is refused before it
 * spends anything.
 *
 * Two requests per attendee, one every couple of seconds at a busy door, is
 * about sixty a minute per steward. A hundred and twenty leaves room for
 * re-scans and is far below what probing printed codes would need.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_ADMISSION_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' })

/**
 * Build the per-route `config.rateLimit` object for the door routes.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests and the load suite.
 * @returns {object} The effective admission limit.
 */
export function admissionRateLimit(overrides = {}) {
  return {
    ...DEFAULT_ADMISSION_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id ? `actor:${request.actor.id}` : `ip:${request.ip}`,
  }
}

/**
 * Build the per-route `config.rateLimit` object for admission-pass retrieval.
 *
 * Keyed on the signed-in holder, like the door budget, and for the same
 * reason. Every browser request reaches the API through the web app's
 * same-origin proxy, so keyed by address the whole audience shared one budget
 * of thirty passes a minute — the web server's — and one holder refreshing
 * their pass could spend everybody's.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {object} The effective pass limit.
 */
export function passRateLimit(overrides = {}) {
  return {
    ...DEFAULT_PASS_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id ? `actor:${request.actor.id}` : `ip:${request.ip}`,
  }
}

/**
 * Picture-upload budget, per account.
 *
 * An organiser filling a gallery uploads nine pictures and retries a few; twenty
 * in ten minutes is well above that and far below what would make the database
 * a file store for somebody's bulk upload. Run at `onRequest` — after the
 * session guard, before the body is read — so a refused upload costs the server
 * nothing but the refusal.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_MEDIA_UPLOAD_LIMIT = Object.freeze({ max: 20, timeWindow: '10 minutes' })

/**
 * Picture-read budget.
 *
 * Its own budget rather than the global one, because every browser request
 * reaches the API through the web app's proxy and the image optimiser, so they
 * all share the web server's address; a page with a cover and eight gallery
 * pictures would otherwise spend the global budget of everybody browsing.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_MEDIA_READ_LIMIT = Object.freeze({ max: 1200, timeWindow: '1 minute' })

/**
 * Build the per-route `config.rateLimit` object for picture uploads.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {object} The effective upload limit.
 */
export function mediaUploadRateLimit(overrides = {}) {
  return {
    ...DEFAULT_MEDIA_UPLOAD_LIMIT,
    ...overrides,
    hook: 'onRequest',
    keyGenerator: (request) =>
      request.actor?.id
        ? `media-upload:actor:${request.actor.id}`
        : `media-upload:ip:${request.ip}`,
  }
}

/**
 * Build the per-route `config.rateLimit` object for picture reads.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {object} The effective read limit.
 */
export function mediaReadRateLimit(overrides = {}) {
  return {
    ...DEFAULT_MEDIA_READ_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id ? `media-read:actor:${request.actor.id}` : `media-read:ip:${request.ip}`,
  }
}

/**
 * Checkout-quote budget, per account.
 *
 * A quote answers whether a promo code exists for an event, so it is a way to
 * try codes. A buyer applies a code or two and changes a quantity a few times;
 * thirty a minute is far above that and far below what guessing codes needs.
 * Keyed on the signed-in account for the same reason as the pass budget: every
 * browser request arrives from the web server's address.
 *
 * The charge is the other way to try codes — an unknown code is refused, and a
 * known one moves the total — so `POST /v1/orders` carrying a code draws on a
 * budget of the same size ({@link promoAttemptRateLimit}).
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_QUOTE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' })

/**
 * Build the per-route `config.rateLimit` object for checkouts that name a promo code.
 *
 * `POST /v1/orders` answers an unknown code with a 422 and a known one with a
 * different total (a 409 `PRICE_CHANGED` against a deliberately wrong
 * `expectedTotalCents`), both before anything is written, and it takes guests.
 * Unmetered, that was a way to test codes with no account and no side effects
 * at ten times the quote's rate. So a checkout carrying a code spends from its
 * own budget of the quote's size, keyed on the signed-in account or, for a
 * guest, on the address — a hold token is no key, since anybody can mint
 * another. A checkout with no code is never counted: the web's guests reach
 * the API through one address, and buying must not be rationed.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {object} The effective promo-attempt limit.
 */
export function promoAttemptRateLimit(overrides = {}) {
  return {
    ...DEFAULT_QUOTE_LIMIT,
    ...overrides,
    hook: 'preHandler',
    allowList: (request) => !request.body?.promoCode,
    keyGenerator: (request) =>
      request.actor?.id ? `promo:actor:${request.actor.id}` : `promo:ip:${request.ip}`,
  }
}

/**
 * Build the per-route `config.rateLimit` object for checkout quotes.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {object} The effective quote limit.
 */
export function quoteRateLimit(overrides = {}) {
  return {
    ...DEFAULT_QUOTE_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id ? `quote:actor:${request.actor.id}` : `quote:ip:${request.ip}`,
  }
}

/**
 * Visit-beacon budget.
 *
 * A page view and a few clicks a page, so sixty a minute per visitor is ample;
 * the deployment sets it with `TRAFFIC_BEACON_MAX_PER_MINUTE`. When a trusted
 * web server forwarded no address, every such request would share one key, so
 * that bucket gets the shared ceiling instead of refusing a busy event page
 * wholesale.
 *
 * @type {Readonly<{max: number, sharedMax: number, timeWindow: string}>}
 */
export const DEFAULT_TRAFFIC_BEACON_LIMIT = Object.freeze({
  max: 60,
  sharedMax: 3000,
  timeWindow: '1 minute',
})

/**
 * Build the per-route `config.rateLimit` object for visit beacons.
 *
 * Its own budget, off the global one: every browser request arrives from the
 * web server's address, so beacons riding the global budget would spend the
 * whole site's. Keyed on the visitor as `lib/traffic.js` identifies them — a
 * process-local digest of the address and the browser, never stored — and run
 * at `onRequest`, before the body is read.
 *
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number}} [overrides] Limit overrides: the deployment's per-visitor maximum, or a test's.
 * @returns {object} The effective beacon limit.
 */
export function trafficBeaconRateLimit(overrides = {}) {
  const limit = { ...DEFAULT_TRAFFIC_BEACON_LIMIT, ...overrides }

  return {
    timeWindow: limit.timeWindow,
    hook: 'onRequest',
    keyGenerator: (request) => {
      const key = visitorRateKey(request)

      return key ? `traffic:client:${key}` : `traffic:shared:${request.ip}`
    },
    max: (_request, key) => (key.startsWith('traffic:client:') ? limit.max : limit.sharedMax),
  }
}

/**
 * Website-link budget: an abuse ceiling only.
 *
 * Somebody follows an event's website link a few times a minute at most, so
 * 120 a minute per visitor never refuses a person; it bounds a script that
 * hammers the lookup. When no visitor address arrived every such request
 * shares one key, which gets the shared ceiling instead. Counting has budgets
 * of its own (the per-event ceiling and the dedupe), so this one never decides
 * whether a visit counts.
 *
 * @type {Readonly<{max: number, sharedMax: number, timeWindow: string}>}
 */
export const DEFAULT_WEBSITE_VISIT_LIMIT = Object.freeze({
  max: 120,
  sharedMax: 6000,
  timeWindow: '1 minute',
})

/**
 * Build the per-route `config.rateLimit` object for `traffic.websiteVisit`.
 *
 * Its own budget, off the global one (every request arrives from the web
 * server), keyed on the visitor as `lib/traffic.js` identifies them and run at
 * `onRequest`, before the body is read.
 *
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number}} [overrides] Limit overrides, for a test.
 * @returns {object} The effective limit.
 */
export function websiteVisitRateLimit(overrides = {}) {
  const limit = { ...DEFAULT_WEBSITE_VISIT_LIMIT, ...overrides }

  return {
    timeWindow: limit.timeWindow,
    hook: 'onRequest',
    keyGenerator: (request) => {
      const key = visitorRateKey(request)

      return key ? `website-visit:client:${key}` : `website-visit:shared:${request.ip}`
    },
    max: (_request, key) => (key.startsWith('website-visit:client:') ? limit.max : limit.sharedMax),
  }
}

/**
 * Organiser-invitation budget, per administrator: thirty invitations and new
 * codes an hour, together.
 *
 * Issuing and reissuing draw on **one** bucket. `@fastify/rate-limit` keeps a
 * separate store per route, so two routes naming the same key would still
 * count apart; this budget is therefore a small fixed-window counter shared by
 * the two handlers, run as a `preHandler` after the session, capability and
 * step-up guards, so a caller who is about to be refused spends nothing.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_ORGANIZER_INVITE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 hour' })

/**
 * Milliseconds in a `timeWindow` written the way `@fastify/rate-limit` takes it.
 *
 * @param {string|number} window A number of milliseconds, or "N second(s)|minute(s)|hour(s)".
 * @returns {number} Milliseconds.
 * @throws {TypeError} For a window it cannot read.
 */
function windowMs(window) {
  if (typeof window === 'number' && window > 0) return window

  const match = /^(\d+)\s*(second|minute|hour)s?$/u.exec(String(window).trim())

  if (!match) throw new TypeError(`Unreadable rate-limit window ${JSON.stringify(window)}`)

  const unit = { second: 1000, minute: 60_000, hour: 3_600_000 }[match[2]]

  return Number(match[1]) * unit
}

/**
 * Build the organiser-invitation budget: one `preHandler`, shared by
 * `organizerInvitations.create` and `.reissue`, keyed
 * `organizer-invite:actor:<id>`.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @returns {function(object): Promise<void>} The hook. Throws a 429 with `Retry-After` past the budget.
 */
export function organizerInviteRateLimit(overrides = {}) {
  const limit = { ...DEFAULT_ORGANIZER_INVITE_LIMIT, ...overrides }
  const span = windowMs(limit.timeWindow)
  /** @type {Map<string, {count: number, startedAt: number}>} */
  const buckets = new Map()

  return async function organizerInviteBudget(request) {
    const now = Date.now()
    const key = `organizer-invite:actor:${request.actor?.id ?? `ip:${request.ip}`}`

    // Windows that have ended are dropped as they are passed, so the map holds
    // only the administrators active in the last window.
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.startedAt + span <= now) buckets.delete(bucketKey)
    }

    const bucket = buckets.get(key) ?? { count: 0, startedAt: now }

    if (bucket.count >= limit.max) {
      const retryInSeconds = Math.max(1, Math.ceil((bucket.startedAt + span - now) / 1000))
      const error = new Error(`Too many requests. Retry in ${retryInSeconds} seconds.`)

      throw Object.assign(error, {
        statusCode: 429,
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryInSeconds,
      })
    }

    bucket.count += 1
    buckets.set(key, bucket)
  }
}

/**
 * Platform editing budget, per administrator: thirty sittings opened an hour
 * (SPEC2-XI §4.4, `platform-edit:actor:<id>`).
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_PLATFORM_EDIT_LIMIT = Object.freeze({ max: 30, timeWindow: '1 hour' })

/**
 * Build the platform editing budget: a `preHandler` for `platformEvents.openEdit`,
 * keyed `platform-edit:actor:<id>`, run after the session, capability and
 * step-up guards so a caller about to be refused spends nothing.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @returns {function(object): Promise<void>} The hook. Throws a 429 past the budget.
 */
export function platformEditRateLimit(overrides = {}) {
  const limit = { ...DEFAULT_PLATFORM_EDIT_LIMIT, ...overrides }
  const span = windowMs(limit.timeWindow)
  /** @type {Map<string, {count: number, startedAt: number}>} */
  const buckets = new Map()

  return async function platformEditBudget(request) {
    const now = Date.now()
    const key = `platform-edit:actor:${request.actor?.id ?? `ip:${request.ip}`}`

    for (const [bucketKey, bucket] of buckets) {
      if (bucket.startedAt + span <= now) buckets.delete(bucketKey)
    }

    const bucket = buckets.get(key) ?? { count: 0, startedAt: now }

    if (bucket.count >= limit.max) {
      const retryInSeconds = Math.max(1, Math.ceil((bucket.startedAt + span - now) / 1000))
      const error = new Error(`Too many requests. Retry in ${retryInSeconds} seconds.`)

      throw Object.assign(error, {
        statusCode: 429,
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryInSeconds,
      })
    }

    bucket.count += 1
    buckets.set(key, bucket)
  }
}

/**
 * Import budget, per administrator: twenty previews, applies and picture
 * retries an hour between them (SPEC2-XI §4.4, `event-import:actor:<id>`).
 * Each one reads a file of up to 2 MiB or reaches out for pictures.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_EVENT_IMPORT_LIMIT = Object.freeze({ max: 20, timeWindow: '1 hour' })

/**
 * Build the import budget: one `preHandler`, shared by `eventImports.preview`,
 * `.apply` and `.retryImages`, keyed `event-import:actor:<id>`, run after the
 * session, capability and step-up guards so a caller about to be refused
 * spends nothing.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @returns {function(object): Promise<void>} The hook. Throws a 429 past the budget.
 */
export function eventImportRateLimit(overrides = {}) {
  const limit = { ...DEFAULT_EVENT_IMPORT_LIMIT, ...overrides }
  const span = windowMs(limit.timeWindow)
  /** @type {Map<string, {count: number, startedAt: number}>} */
  const buckets = new Map()

  return async function eventImportBudget(request) {
    const now = Date.now()
    const key = `event-import:actor:${request.actor?.id ?? `ip:${request.ip}`}`

    for (const [bucketKey, bucket] of buckets) {
      if (bucket.startedAt + span <= now) buckets.delete(bucketKey)
    }

    const bucket = buckets.get(key) ?? { count: 0, startedAt: now }

    if (bucket.count >= limit.max) {
      const retryInSeconds = Math.max(1, Math.ceil((bucket.startedAt + span - now) / 1000))
      const error = new Error(`Too many requests. Retry in ${retryInSeconds} seconds.`)

      throw Object.assign(error, {
        statusCode: 429,
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryInSeconds,
      })
    }

    bucket.count += 1
    buckets.set(key, bucket)
  }
}

/**
 * Build the per-route `config.rateLimit` object for accepting an organiser
 * invitation: the credential budget, keyed `organizer-accept:actor:<id>`.
 *
 * Keyed on the signed-in account for the same reason as the team routes:
 * every browser request arrives from the web server's address.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @returns {object} The effective limit.
 */
export function organizerAcceptRateLimit(overrides = {}) {
  return {
    ...DEFAULT_AUTH_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id
        ? `organizer-accept:actor:${request.actor.id}`
        : `organizer-accept:ip:${request.ip}`,
  }
}

/**
 * Ticket-transfer mail budget, per sender: five an hour, in `EMAIL` mode only.
 *
 * A transfer code goes to whatever address the holder types. With a mail
 * server wired in, that is a way to send Desi-Event email to strangers, so a
 * sender may email five an hour. In `MANUAL` nothing is emailed and the
 * budget does not apply.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_TRANSFER_MAIL_LIMIT = Object.freeze({ max: 5, timeWindow: '1 hour' })

/**
 * Build the per-route `config.rateLimit` object for `tickets.startTransfer`.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, for tests.
 * @param {object} [options] Inputs.
 * @param {'MANUAL'|'EMAIL'} [options.deliveryMode] The resolved delivery mode; anything but EMAIL allows every request.
 * @returns {object} The effective limit.
 */
export function transferMailRateLimit(overrides = {}, { deliveryMode = 'MANUAL' } = {}) {
  return {
    ...DEFAULT_TRANSFER_MAIL_LIMIT,
    ...overrides,
    hook: 'preHandler',
    allowList: () => deliveryMode !== 'EMAIL',
    keyGenerator: (request) =>
      request.actor?.id
        ? `transfer-mail:actor:${request.actor.id}`
        : `transfer-mail:ip:${request.ip}`,
  }
}

/**
 * Build the per-route `config.rateLimit` object for the auth endpoints.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {{max: number, timeWindow: string|number}} The effective auth limit.
 */
export function authRateLimit(overrides = {}) {
  return { ...DEFAULT_AUTH_LIMIT, ...overrides }
}

/**
 * Register the global rate limiter.
 *
 * `errorResponseBuilder` returns an `Error` rather than a body: the plugin
 * *throws* whatever it is given, so returning a plain object produces a 500.
 * Returning a properly coded error routes the rejection through the shared
 * error handler instead, which means a throttled caller gets exactly the same
 * envelope as every other failure.
 *
 * @param {object} app The Fastify instance.
 * @param {object} [options] Limiter options.
 * @param {{max?: number, timeWindow?: string|number}} [options.global] Overrides for the global budget.
 * @returns {Promise<void>} Resolves once the limiter is registered.
 */
export async function registerRateLimit(app, options = {}) {
  const global = { ...DEFAULT_GLOBAL_LIMIT, ...(options.global ?? {}) }

  await app.register(rateLimit, {
    global: true,
    max: global.max,
    timeWindow: global.timeWindow,
    // Documentation is static and cheap; throttling it only makes the API
    // look broken to somebody reading about it.
    allowList: (request) => request.url.startsWith('/docs'),
    errorResponseBuilder: (_request, context) => {
      const retryInSeconds = Math.ceil(Number(context.ttl ?? 0) / 1000)
      const error = new Error(`Too many requests. Retry in ${retryInSeconds} seconds.`)

      Object.assign(error, { statusCode: context.statusCode ?? 429, code: 'RATE_LIMITED' })

      return error
    },
  })
}
