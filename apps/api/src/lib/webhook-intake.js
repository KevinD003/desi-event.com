/**
 * Taking a webhook in, and doing nothing else.
 *
 * The endpoint's job is narrow and the narrowness is the design: **verify,
 * persist, acknowledge.** Processing happens afterwards, from the stored row.
 *
 * Why that split, stated plainly because the obvious alternative is to just do
 * the work in the handler:
 *
 *   - **A provider that does not get a 2xx retries.** If the handler issues
 *     tickets and then times out on the way back, Stripe retries, and the second
 *     delivery does it again. Acknowledging a *durable receipt* rather than a
 *     completed action turns that from a correctness problem into a scheduling
 *     one.
 *   - **Processing can fail for reasons the provider cannot fix.** A missing
 *     order, a database blip, a bug. Retrying the *delivery* for those is
 *     pointless; retrying the *stored row* is exactly right, and can be done with
 *     backoff and a dead letter.
 *   - **Duplicates and out-of-order arrivals are normal.** Stripe guarantees
 *     at-least-once and does not guarantee order. The unique index on
 *     `(provider, accountContext, providerEventId)` makes the first a no-op, and
 *     processing from stored rows makes the second visible instead of surprising.
 *
 * @module @desi-event/api/lib/webhook-intake
 */

import { createHash } from 'node:crypto'

/**
 * A digest of the exact bytes received.
 *
 * Stored alongside the payload so that a payload somebody later edits in the
 * database is detectable. The payload itself is stored too — it is the evidence
 * — but a stored payload with no digest is evidence nobody can check.
 *
 * @param {Buffer} rawBody The exact bytes.
 * @returns {string} Lower-case hex SHA-256.
 */
export function payloadDigest(rawBody) {
  return createHash('sha256').update(rawBody).digest('hex')
}

/**
 * Fields that must never reach a stored payload.
 *
 * Stripe does not send card numbers, so this is not about PAN. It is about the
 * things Stripe *does* send that this system has no reason to keep: a billing
 * address, an email, a phone number, a name. A webhook payload is stored
 * indefinitely and read by support; it should carry identifiers and amounts.
 *
 * @type {Set<string>}
 */
export const REDACTED_KEYS = new Set([
  'email',
  'name',
  'phone',
  'address',
  'billing_details',
  'shipping',
  'receipt_email',
  'customer_details',
  'payment_method_details',
  'client_secret',
])

/**
 * A payload with the personal fields taken out.
 *
 * Recursive, because Stripe nests. Keys are removed rather than blanked, so a
 * reader cannot mistake an empty string for "the buyer left it blank".
 *
 * @param {unknown} value The payload, or part of it.
 * @returns {unknown} The same shape, minus the redacted keys.
 */
export function redactPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactPayload(item))

  if (!value || typeof value !== 'object') return value

  const result = {}

  for (const [key, nested] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key)) continue
    result[key] = redactPayload(nested)
  }

  return result
}

/**
 * Store a verified delivery, or recognise that it has been stored before.
 *
 * The duplicate check is the unique index, not a `findFirst`: two deliveries of
 * the same event arriving at the same moment both look new to a read, and only
 * one of them can insert. So the insert is attempted and the violation is the
 * answer.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} delivery The verified delivery.
 * @param {object} delivery.event The parsed Stripe event.
 * @param {string|null} delivery.accountContext The connected account, or null.
 * @param {string|null} delivery.apiVersion The API version that produced it.
 * @param {Date|null} delivery.createdAt When the provider created it.
 * @param {Buffer} delivery.rawBody The exact bytes, for the digest.
 * @param {string} [delivery.provider] Which provider.
 * @returns {Promise<{row: object, duplicate: boolean}>} The stored row, and whether it was already there.
 */
export async function storeDelivery(
  prisma,
  { event, accountContext, apiVersion, createdAt, rawBody, provider = 'stripe' },
) {
  const identity = {
    provider,
    // Empty string rather than null: the unique index has to treat "the platform
    // account" as a value, and in PostgreSQL two NULLs are not equal, so a null
    // here would let the same platform event be stored any number of times.
    accountContext: accountContext ?? '',
    providerEventId: event.id,
  }

  try {
    const row = await prisma.webhookEvent.create({
      data: {
        ...identity,
        eventType: event.type,
        apiVersion,
        providerCreatedAt: createdAt,
        payload: redactPayload(event),
        payloadHash: payloadDigest(rawBody),
        state: 'RECEIVED',
      },
    })

    return { row, duplicate: false }
  } catch (error) {
    if (/** @type {{code?: string}} */ (error)?.code !== 'P2002') throw error

    // Already stored. The right answer is the row that is there, and a 2xx: the
    // provider has done its job and should stop retrying.
    const row = await prisma.webhookEvent.findUnique({
      where: {
        provider_accountContext_providerEventId: identity,
      },
    })

    return { row, duplicate: true }
  }
}

/**
 * How long to wait before attempt *n*, with jitter.
 *
 * Exponential from thirty seconds, capped at an hour, and jittered because a
 * hundred rows scheduled for the same second retry in the same second and fall
 * over together. The jitter is deterministic given an index rather than random,
 * so a test can assert the spread.
 *
 * @param {number} attempt Which attempt is next, starting at 1.
 * @param {number} [spread] A number in [0, 1) to spread within the window.
 * @returns {number} Milliseconds to wait.
 */
export function backoffMs(attempt, spread = 0.5) {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000)

  // Full jitter within the window, which is what stops a thundering herd. The
  // floor keeps a retry from being effectively immediate.
  return Math.max(1000, Math.floor(base * (0.5 + spread * 0.5)))
}

/**
 * How many times a delivery is retried before it is set aside.
 *
 * Nine attempts spans roughly a day under the backoff above, which is longer
 * than most incidents and shorter than a week of silently retrying something
 * that will never work. After that the row is `DEAD_LETTER`: visible, replayable
 * by hand, and no longer consuming a worker.
 *
 * @type {number}
 */
export const MAX_ATTEMPTS = 9

/**
 * Claim a stored delivery for processing.
 *
 * Conditional on the state and the attempt count, so two workers cannot both
 * claim the same row: the second one's update matches nothing and it moves on.
 * This is the same shape as the seat claim, for the same reason.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} row The `WebhookEvent` row.
 * @returns {Promise<boolean>} True when this caller has the row.
 */
export async function claimDelivery(prisma, row) {
  const { count } = await prisma.webhookEvent.updateMany({
    where: {
      id: row.id,
      // FAILED with a `nextAttemptAt` is how a scheduled retry is spelled:
      // there is no separate RETRY_SCHEDULED state, and the composite index on
      // `(state, nextAttemptAt)` is shaped for exactly this query.
      state: { in: ['RECEIVED', 'FAILED'] },
      attemptCount: row.attemptCount,
    },
    data: { state: 'PROCESSING', attemptCount: row.attemptCount + 1, nextAttemptAt: null },
  })

  return count === 1
}

/**
 * Record that a delivery was processed.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} id The row id.
 * @param {object} [options] Options.
 * @param {string|null} [options.orderId] The order it turned out to concern.
 * @param {string|null} [options.paymentId] The payment it turned out to concern.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<void>} Resolves once recorded.
 */
export async function markProcessed(prisma, id, { orderId, paymentId, now = new Date() } = {}) {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      state: 'PROCESSED',
      processedAt: now,
      processingError: null,
      ...(orderId ? { orderId } : {}),
      ...(paymentId ? { paymentId } : {}),
    },
  })
}

/**
 * Record that a delivery was recognised and deliberately not acted on.
 *
 * Distinct from processed, because "we do not handle `invoice.paid`" and "we
 * handled it" are different answers to give somebody asking why nothing
 * happened.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} id The row id.
 * @param {Date} [now] The current time.
 * @returns {Promise<void>} Resolves once recorded.
 */
export async function markIgnored(prisma, id, now = new Date()) {
  await prisma.webhookEvent.update({
    where: { id },
    data: { state: 'IGNORED', processedAt: now, processingError: null },
  })
}

/**
 * Record that processing failed, and schedule a retry or give up.
 *
 * `FAILED` with a `nextAttemptAt` means "will be tried again"; `DEAD_LETTER` with
 * none means "waiting for a person". Two states rather than three, because a
 * third would have to be kept in step with the presence of a timestamp and the
 * timestamp is the fact that matters.
 *
 * The error message is truncated and carries no payload: a processing error is
 * read by whoever is on call, and it should tell them what broke without
 * reproducing the event.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} row The row, with its already-incremented attempt count.
 * @param {unknown} error What went wrong.
 * @param {object} [options] Options.
 * @param {number} [options.spread] Jitter spread.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<{state: string, nextAttemptAt: Date|null}>} What was recorded.
 */
export async function markFailed(
  prisma,
  row,
  error,
  { spread = Math.random(), now = new Date() } = {},
) {
  const attempts = row.attemptCount ?? 0
  const exhausted = attempts >= MAX_ATTEMPTS
  const nextAttemptAt = exhausted ? null : new Date(now.getTime() + backoffMs(attempts, spread))
  const state = exhausted ? 'DEAD_LETTER' : 'FAILED'

  await prisma.webhookEvent.update({
    where: { id: row.id },
    data: {
      state,
      nextAttemptAt,
      processingError: String(error?.message ?? error)
        .replace(/\s+/g, ' ')
        .slice(0, 500),
    },
  })

  return { state, nextAttemptAt }
}

/**
 * Deliveries that are due for another attempt.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} [options] Options.
 * @param {number} [options.limit] How many to take.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<object[]>} Rows to process, oldest first.
 */
export function dueDeliveries(prisma, { limit = 20, now = new Date() } = {}) {
  return prisma.webhookEvent.findMany({
    where: {
      OR: [
        { state: 'RECEIVED' },
        // A FAILED row with its next attempt due. DEAD_LETTER rows have no
        // `nextAttemptAt` and are deliberately never picked up here: they wait
        // for somebody to look at them.
        { state: 'FAILED', nextAttemptAt: { lte: now } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })
}
