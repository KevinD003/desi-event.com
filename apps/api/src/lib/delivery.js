/**
 * How a single-use code reaches the person it is for.
 *
 * Two modes, and the difference is who holds the code on its way:
 *
 *   - `EMAIL` — a delivery provider sends it. Nobody at the API boundary ever
 *     sees it again; the response carries no code.
 *   - `MANUAL` — there is no provider, so the code is returned exactly once to
 *     whoever issued it, in the 201 that created it, and they hand it over
 *     themselves. The database keeps only its digest, so it cannot be shown a
 *     second time.
 *
 * `EMAIL` is switched on by `DELIVERY_MODE=EMAIL` together with an SMTP server
 * (`SMTP_HOST`, `SMTP_FROM`, `WEB_ORIGIN`); `buildApp` builds the mailer
 * (`lib/code-mailer.js`). Without both, the deployment runs `MANUAL`. Before
 * this module existed the same build issued team invitations whose code went
 * to a log line saying nobody could receive it — every invitation was
 * unusable, and nothing said so to the person who sent it.
 *
 * The mode is decided once, at boot. Naming `EMAIL` without a provider refuses
 * to start: an invitation silently dropped is worse than a deployment that
 * will not boot until somebody fixes its configuration.
 *
 * Two rules hold in `EMAIL` mode only:
 *
 *   - **A failed send withdraws what it issued** ({@link deliverOrWithdraw}).
 *     The row commits before the mail server is asked, so a refusal would
 *     otherwise leave a live invitation whose code nobody holds.
 *   - **One address is sent at most three codes a day**
 *     ({@link assertRecipientDailyCap}), so the team invitation and ticket
 *     transfer forms cannot be used to fill a stranger's inbox. It is decided
 *     inside the transaction that writes the code's row, under a lock on the
 *     address, so requests arriving together are counted one after another.
 *
 * @module @desi-event/api/lib/delivery
 */

import { exposedServerError, httpError } from './errors.js'
import { isTransactionClient } from './transaction-client.js'

/**
 * The delivery modes, mirroring the Prisma `InvitationDelivery` enum.
 *
 * @type {Readonly<{MANUAL: 'MANUAL', EMAIL: 'EMAIL'}>}
 */
export const DELIVERY_MODES = Object.freeze({ MANUAL: 'MANUAL', EMAIL: 'EMAIL' })

/**
 * Decide the delivery mode for this process.
 *
 * | `DELIVERY_MODE` | provider | result |
 * |---|---|---|
 * | unset | none | `MANUAL` |
 * | unset | wired | `EMAIL` |
 * | `MANUAL` | either | `MANUAL` |
 * | `EMAIL` | wired | `EMAIL` |
 * | `EMAIL` | none | throws |
 *
 * @param {object} options Inputs.
 * @param {{DELIVERY_MODE?: string}} [options.env] The parsed API environment.
 * @param {unknown} [options.deliver] The delivery hook, when a provider is wired in.
 * @returns {'MANUAL'|'EMAIL'} The mode.
 * @throws {TypeError} When `EMAIL` is named and there is no provider to send with, or the mode is unknown.
 */
export function resolveDeliveryMode({ env = {}, deliver } = {}) {
  const requested = env?.DELIVERY_MODE
  const hasProvider = typeof deliver === 'function'

  if (requested === undefined || requested === null || requested === '') {
    return hasProvider ? DELIVERY_MODES.EMAIL : DELIVERY_MODES.MANUAL
  }

  if (requested === DELIVERY_MODES.MANUAL) return DELIVERY_MODES.MANUAL

  if (requested === DELIVERY_MODES.EMAIL) {
    if (!hasProvider) {
      throw new TypeError(
        'DELIVERY_MODE is EMAIL but no delivery provider is configured, so invitation codes ' +
          'could not reach anybody. Set SMTP_HOST and SMTP_FROM (with WEB_ORIGIN) to email them, ' +
          'or set DELIVERY_MODE=MANUAL so each code is shown once to whoever issues it.',
      )
    }

    return DELIVERY_MODES.EMAIL
  }

  throw new TypeError(`DELIVERY_MODE must be MANUAL or EMAIL, not ${JSON.stringify(requested)}.`)
}

/**
 * Mark a response as one no cache may keep.
 *
 * `private` as well as `no-store`, so a shared cache between the browser and
 * the API has two reasons to refuse it, and `pragma` for the HTTP/1.0 caches
 * that read nothing else. Used on every response that carries a show-once
 * code, and on the account search, whose results are personal data.
 *
 * @param {object} reply The Fastify reply.
 * @returns {object} The same reply.
 */
export function noStore(reply) {
  reply.header('cache-control', 'no-store, private')
  reply.header('pragma', 'no-cache')

  return reply
}

/**
 * The `delivery` block for a response, and the provider hand-off for `EMAIL`.
 *
 * The one place a route turns a freshly minted secret into what the caller
 * sees. In `MANUAL` the secret goes into the response; in `EMAIL` it goes to
 * the provider and the response carries `null`. Both are marked `no-store`,
 * and either way the caller logs and audits only the mode.
 *
 * @param {object} options Inputs.
 * @param {'MANUAL'|'EMAIL'} options.mode The resolved delivery mode.
 * @param {string} options.secret The code, which exists only in memory.
 * @param {object} options.reply The Fastify reply, for the cache headers.
 * @param {function(object): Promise<void>} [options.deliver] The provider hook, for `EMAIL`.
 * @param {object} [options.message] What the provider is told besides the code.
 * @returns {Promise<{mode: 'MANUAL'|'EMAIL', invitationCode: string|null}>} The block.
 */
export async function deliverCode({ mode, secret, reply, deliver, message = {} }) {
  // Both modes: an EMAIL response carries no code, but it is still the answer
  // to a request that minted one, and there is nothing in it worth caching.
  noStore(reply)

  if (mode === DELIVERY_MODES.EMAIL) {
    await deliver({ ...message, token: secret })

    return { mode: DELIVERY_MODES.EMAIL, invitationCode: null }
  }

  return { mode: DELIVERY_MODES.MANUAL, invitationCode: secret }
}

/**
 * What the caller is told when an invitation's code could not be emailed.
 *
 * @type {string}
 */
export const DELIVERY_FAILED_SENTENCE =
  'The email could not be sent, so the invitation was withdrawn and nothing reached them. Try again in a few minutes.'

/**
 * What the sender of a ticket is told when the transfer code could not be emailed.
 *
 * @type {string}
 */
export const TRANSFER_DELIVERY_FAILED_SENTENCE =
  'The email could not be sent, so the offer was withdrawn and nothing reached them. The ticket is still yours. Try again in a few minutes.'

/**
 * A failure code safe to log: a bare upper-case identifier, or nothing.
 *
 * @param {unknown} error What the provider threw.
 * @returns {string} The code, or `SEND_FAILED`.
 */
function failureReason(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code

  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/u.test(code) ? code : 'SEND_FAILED'
}

/**
 * {@link deliverCode}, and in `EMAIL` mode the undoing of whatever was issued
 * when the mail server does not take the message.
 *
 * The row behind the code has committed before this runs, so a send that
 * fails would otherwise leave a live invitation, or a ticket waiting on a
 * transfer, whose code nobody holds. `withdraw` takes it back (a conditional
 * update and its `*.delivery_failed` audit, in one transaction), and the caller
 * is told plainly with a 503 `DELIVERY_FAILED` whose sentence reaches them in
 * production too.
 *
 * If `withdraw` itself fails, that is logged and the 503 still goes out: the
 * row then stays waiting with nobody holding its code, which is no worse than
 * before. Log lines carry the purpose, the mode and a failure code, never the
 * message, the code or the address.
 *
 * `MANUAL` never sends anything, so it never withdraws.
 *
 * @param {object} options Inputs.
 * @param {'MANUAL'|'EMAIL'} options.mode The resolved delivery mode.
 * @param {string} options.secret The code, which exists only in memory.
 * @param {object} options.reply The Fastify reply, for the cache headers.
 * @param {function(object): Promise<void>} [options.deliver] The provider hook, for `EMAIL`.
 * @param {object} [options.message] What the provider is told besides the code.
 * @param {function(): Promise<void>} options.withdraw Takes back what was issued.
 * @param {object} [options.log] A pino-style logger.
 * @param {string} [options.failureMessage] The sentence for the 503.
 * @returns {Promise<{mode: 'MANUAL'|'EMAIL', invitationCode: string|null}>} The `delivery` block.
 * @throws {Error} 503 `DELIVERY_FAILED` when an EMAIL send fails.
 */
export async function deliverOrWithdraw({
  mode,
  secret,
  reply,
  deliver,
  message = {},
  withdraw,
  log,
  failureMessage = DELIVERY_FAILED_SENTENCE,
}) {
  try {
    return await deliverCode({ mode, secret, reply, deliver, message })
  } catch (error) {
    if (mode !== DELIVERY_MODES.EMAIL) throw error

    const context = { purpose: message.purpose ?? null, deliveryMode: mode }

    try {
      await withdraw()
    } catch (withdrawError) {
      log?.error(
        { ...context, reason: failureReason(withdrawError) },
        'a code could not be emailed, and what was issued could not be withdrawn',
      )
    }

    log?.warn(
      { ...context, reason: failureReason(error) },
      'a code could not be emailed; what was issued has been withdrawn',
    )

    throw exposedServerError(503, 'DELIVERY_FAILED', failureMessage)
  }
}

/**
 * A Prisma filter for the rows that may hold an address, in any case.
 *
 * It only narrows the rows: {@link isSameAddress} decides which of them are
 * the address. On PostgreSQL Prisma runs `equals` with `mode: 'insensitive'`
 * as an `ILIKE` whose value it does not escape, so an `_` in the address
 * matches any one character there — `j_doe@example.com` also finds
 * `jxdoe@example.com`. Case-insensitive rather than exact because the unique
 * indexes on these addresses are on `lower(email)`, so a row written in
 * another case is still the same address.
 *
 * @param {string} email The address.
 * @returns {{equals: string, mode: 'insensitive'}} The filter.
 */
export function addressCandidates(email) {
  return { equals: email, mode: 'insensitive' }
}

/**
 * Whether two addresses are the same address: equal once lower-cased, and
 * nothing looser.
 *
 * @param {unknown} a One address.
 * @param {unknown} b The other.
 * @returns {boolean} True when they are the same.
 */
export function isSameAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

/** How many codes one address may be emailed in {@link RECIPIENT_CAP_WINDOW_MS}. */
export const RECIPIENT_DAILY_CAP = 3

/** The window the recipient cap counts over: a day. */
export const RECIPIENT_CAP_WINDOW_MS = 24 * 60 * 60 * 1000

/** What a sender is told when the address has had its codes for the day. */
export const RECIPIENT_DAILY_LIMIT_SENTENCE =
  'This address has already been sent three codes from The Desi Events today. Try again tomorrow.'

/**
 * The advisory-lock class the recipient cap locks addresses in: `RCAP` in
 * ASCII. PostgreSQL keeps two-key advisory locks apart from single-key ones,
 * and the class keeps them apart from any other two-key lock.
 */
export const RECIPIENT_LOCK_CLASS = 0x52434150

/**
 * Hold one address until the transaction ends.
 *
 * A transaction-scoped advisory lock on the lower-cased address (the same
 * comparison {@link isSameAddress} makes), so every issuing transaction for
 * that address waits for the one before it to commit or roll back. The key is
 * a 32-bit hash: two addresses that collide only queue behind each other.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} email The address.
 * @returns {Promise<void>} Resolves once the lock is held.
 */
async function lockRecipient(tx, email) {
  // `$executeRaw`, not `$queryRaw`: the lock function returns `void`, which
  // Prisma cannot read back as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECIPIENT_LOCK_CLASS}::int4, hashtext(${email.toLowerCase()}))`
}

/**
 * Refuse to email a fourth code to an address within a day.
 *
 * Counted from the database, not a limiter, so it holds across processes and
 * restarts: team invitations sent by email and ticket transfers offered to
 * the address in the last twenty-four hours, whoever sent them. The caller
 * runs this in `EMAIL` mode only; `MANUAL` emails nobody.
 *
 * It runs inside the transaction that then writes the code's row, and first
 * locks the address ({@link lockRecipient}). Counted outside it, requests
 * arriving together would each read fewer than three and each send one; with
 * the lock, the next request's count waits for the last one's row to commit.
 * Given anything but a transaction client it refuses to run, because the lock
 * would be released before the row was written.
 *
 * The 429 carries `Retry-After`: the seconds until enough of those codes are
 * a day old for one more to go. Thrown inside the transaction, it rolls the
 * transaction back with nothing written.
 *
 * @param {object} tx The Prisma transaction client of the issuing transaction.
 * @param {object} options Inputs.
 * @param {string} options.email The recipient's address.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<void>} Resolves when another code may go.
 * @throws {Error} 429 `RECIPIENT_DAILY_LIMIT` when it may not.
 * @throws {TypeError} When `tx` is not a transaction client.
 */
export async function assertRecipientDailyCap(tx, { email, now = new Date() }) {
  if (!isTransactionClient(tx)) {
    throw new TypeError(
      'assertRecipientDailyCap must run inside the transaction that writes the code, so the address lock is held until that row commits.',
    )
  }

  await lockRecipient(tx, email)

  const since = new Date(now.getTime() - RECIPIENT_CAP_WINDOW_MS)
  const address = addressCandidates(email)

  // One after the other: a transaction client runs one statement at a time.
  const invitations = await tx.invitation.findMany({
    where: { email: address, deliveryMode: DELIVERY_MODES.EMAIL, createdAt: { gte: since } },
    select: { createdAt: true, email: true },
  })
  const transfers = await tx.ticketTransfer.findMany({
    where: { toEmail: address, createdAt: { gte: since } },
    select: { createdAt: true, toEmail: true },
  })

  // Only codes sent to this very address count: a look-alike the filter also
  // found (`jxdoe` for `j_doe`) is somebody else's inbox.
  const sent = [
    ...invitations.filter((row) => isSameAddress(row.email, email)),
    ...transfers.filter((row) => isSameAddress(row.toEmail, email)),
  ]
    .map((row) => new Date(row.createdAt).getTime())
    .sort((a, b) => a - b)

  if (sent.length < RECIPIENT_DAILY_CAP) return

  // The code whose first birthday brings the count back under the cap: the
  // oldest, when there are exactly three. Never more than a day: a request
  // that waited on the lock can count a row written after its own `now`, and
  // no code takes longer than a day to stop counting.
  const freesUp = sent[sent.length - RECIPIENT_DAILY_CAP]
  const retryAfterSeconds = Math.min(
    RECIPIENT_CAP_WINDOW_MS / 1000,
    Math.max(1, Math.ceil((freesUp + RECIPIENT_CAP_WINDOW_MS - now.getTime()) / 1000)),
  )

  throw Object.assign(httpError(429, 'RECIPIENT_DAILY_LIMIT', RECIPIENT_DAILY_LIMIT_SENTENCE), {
    retryAfterSeconds,
  })
}
