/**
 * The outbox worker: claim, send, record.
 *
 * Three steps, and the boundaries between them are the design.
 *
 *   1. **Claim.** A conditional `UPDATE` takes a lease on one due row. Two
 *      workers issuing it for the same row are serialised by PostgreSQL; the
 *      loser updates nothing and moves on. This is a transaction, and it is
 *      short.
 *   2. **Send.** The provider is called with **nothing open**. However long it
 *      takes, no lock is held and no transaction can time out underneath it.
 *   3. **Record.** A second short transaction, conditional on the row still
 *      being claimed *by this worker*, writes what happened.
 *
 * ## The crash this shape survives
 *
 * A worker that dies between step 2 and step 3 has sent a message and recorded
 * nothing. Its lease expires; another worker claims the row and sends again.
 * That is a duplicate, and it is the correct trade: the alternative — recording
 * the send before making it — loses messages, and a lost cancellation notice is
 * worse than a repeated one. Where the provider offers its own idempotency key,
 * the dedupe key is passed as one, which collapses the duplicate at their end.
 *
 * ## What is never logged
 *
 * Not the recipient, not the payload, not the rendered body, not the dedupe key
 * — the key contains the address. A log line carries the row id, the template,
 * the channel, the attempt number and the failure category, which is everything
 * needed to debug a delivery and nothing that identifies who it was for.
 *
 * @module @desi-event/worker/outbox/dispatcher
 */

import {
  DEFAULT_LEASE_MS,
  FAILURE_CATEGORIES,
  OUTBOX_STATES,
  afterFailure,
  claimableWhere,
} from '@desi-event/notifications'
import { PROVIDER_ERROR_CODES, assertEmailProvider } from '@desi-event/providers'

import { renderEmail } from '../email/templates.js'

/**
 * Provider failures that will recur identically however many times they are
 * tried.
 *
 * A malformed message or an unusable address is a bug in the producer or bad
 * data, not a transient condition. Everything not on this list is treated as
 * transient, which is the safer default: a message retried once too often is a
 * nuisance, and a message dropped because nobody classified the error is a
 * broken promise.
 *
 * @type {ReadonlyArray<string>}
 */
export const PERMANENT_PROVIDER_ERROR_CODES = Object.freeze([
  PROVIDER_ERROR_CODES.INVALID_MESSAGE,
  PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
  PROVIDER_ERROR_CODES.INVALID_PROVIDER,
  PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY,
  PROVIDER_ERROR_CODES.INVALID_OPTIONS,
])

/**
 * Classify a failure.
 *
 * @param {unknown} error Whatever the send threw.
 * @returns {string} `PERMANENT` or `TRANSIENT`.
 */
export function classifyFailure(error) {
  const code = error?.code

  if (typeof code === 'string' && PERMANENT_PROVIDER_ERROR_CODES.includes(code)) {
    return FAILURE_CATEGORIES.PERMANENT
  }

  // A template with no renderer is a producer bug: no number of retries invents
  // one, and the operator needs to see it now rather than in twenty minutes.
  if (error?.outboxPermanent === true) return FAILURE_CATEGORIES.PERMANENT

  return FAILURE_CATEGORIES.TRANSIENT
}

/**
 * A short, safe description of a failure.
 *
 * Provider errors can carry request payloads and recipient addresses in their
 * details. `lastError` is read by operators in a queue view, so it gets the
 * code and a truncated message and nothing else.
 *
 * @param {unknown} error Whatever the send threw.
 * @returns {string} At most 300 characters, with no payload in them.
 */
export function redactFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  const message = String(error?.message ?? error ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[address]')
    .slice(0, 240)

  return `${code}: ${message}`
}

/**
 * Take a lease on one due message.
 *
 * `updateMany` rather than `update`, because the condition is the point: it
 * matches only rows that are due and unheld, so a row somebody else just took
 * matches nothing and the count comes back zero. The row is then read back by
 * lease owner, which is how this worker learns *which* row it got without a
 * `RETURNING` clause Prisma does not offer here.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.workerId Who is claiming. Must be unique per worker.
 * @param {Date} options.now The instant.
 * @param {number} [options.leaseMs] How long the claim is good for.
 * @returns {Promise<object|null>} The claimed row, or null when nothing was due.
 */
export async function claimOne(prisma, { workerId, now, leaseMs = DEFAULT_LEASE_MS }) {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs)

  const due = await prisma.notificationOutbox.findFirst({
    where: claimableWhere(now),
    orderBy: { scheduledFor: 'asc' },
    select: { id: true },
  })

  if (!due) return null

  const { count } = await prisma.notificationOutbox.updateMany({
    // Both halves matter. The id narrows it to the row this worker read; the
    // claimable condition is re-evaluated at write time, so a row somebody
    // claimed in between matches nothing and this worker is told it lost.
    where: { id: due.id, ...claimableWhere(now) },
    data: {
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: workerId,
      leaseExpiresAt,
      lastAttemptAt: now,
      attempts: { increment: 1 },
    },
  })

  if (count === 0) return null

  return prisma.notificationOutbox.findUnique({ where: { id: due.id } })
}

/**
 * Send one claimed message through the provider.
 *
 * No transaction may be open when this runs. It never throws for a delivery
 * outcome — a bounce and a timeout are both results the caller has to record —
 * but it does throw for a programming error, which is not one.
 *
 * @param {object} providers The provider registry.
 * @param {object} row A claimed outbox row.
 * @returns {Promise<{sent: boolean, providerMessageId: string|null, error: unknown}>} What happened.
 */
export async function sendOutsideTransaction(providers, row) {
  try {
    const provider = assertEmailProvider(providers?.email ?? providers)

    let rendered
    try {
      rendered = renderEmail({ template: row.template, data: row.payload ?? {} })
    } catch (error) {
      error.outboxPermanent = true
      throw error
    }

    const receipt = await provider.send({
      to: row.recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      // Handed to the provider so a duplicate caused by a crash between the
      // send and the acknowledgement collapses at their end rather than
      // arriving twice in somebody's inbox.
      idempotencyKey: row.dedupeKey,
    })

    return { sent: true, providerMessageId: receipt?.id ?? receipt?.messageId ?? null, error: null }
  } catch (error) {
    return { sent: false, providerMessageId: null, error }
  }
}

/**
 * Record a successful send.
 *
 * Conditional on this worker still holding the lease. A worker whose lease
 * lapsed while it was sending has had the row taken from it, and writing SENT
 * over whatever the new owner is doing would be worse than the duplicate that
 * is already in flight.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.row The claimed row.
 * @param {string} options.workerId The lease owner.
 * @param {string|null} options.providerMessageId The provider's reference.
 * @param {Date} options.now The instant.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 */
export async function recordSent(prisma, { row, workerId, providerMessageId, now }) {
  const { count } = await prisma.notificationOutbox.updateMany({
    where: { id: row.id, status: OUTBOX_STATES.CLAIMED, leaseOwner: workerId },
    data: {
      status: OUTBOX_STATES.SENT,
      sentAt: now,
      providerMessageId,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      failureCategory: null,
    },
  })

  return count === 1
}

/**
 * Record a failed send, and decide what happens next.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.row The claimed row.
 * @param {string} options.workerId The lease owner.
 * @param {unknown} options.error What the send threw.
 * @param {Date} options.now The instant.
 * @param {object} [options.retry] Retry-policy overrides, for tests.
 * @returns {Promise<{applied: boolean, status: string}>} What was written.
 */
export async function recordFailure(prisma, { row, workerId, error, now, retry = {} }) {
  const outcome = afterFailure({
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    category: classifyFailure(error),
    now,
    retry,
  })

  const { count } = await prisma.notificationOutbox.updateMany({
    where: { id: row.id, status: OUTBOX_STATES.CLAIMED, leaseOwner: workerId },
    data: {
      status: outcome.status,
      scheduledFor: outcome.scheduledFor ?? row.scheduledFor,
      failureCategory: outcome.failureCategory,
      lastError: redactFailure(error),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  })

  return { applied: count === 1, status: outcome.status }
}

/**
 * Claim, send and record one message.
 *
 * The unit of work. Returns what it did so a caller can drain the queue by
 * looping until it reports that nothing was due.
 *
 * @param {object} options Options.
 * @param {object} options.prisma A Prisma client.
 * @param {object} options.providers The provider registry.
 * @param {string} options.workerId Who is working.
 * @param {Date} [options.now] The instant; defaults to the current one.
 * @param {number} [options.leaseMs] Lease duration.
 * @param {object} [options.logger] Logger; only non-identifying fields are written.
 * @param {object} [options.retry] Retry-policy overrides, for tests.
 * @returns {Promise<{claimed: boolean, sent: boolean, status: string|null, id: string|null}>} What happened.
 */
export async function dispatchOne({
  prisma,
  providers,
  workerId,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  logger,
  retry = {},
}) {
  const row = await claimOne(prisma, { workerId, now, leaseMs })

  if (!row) return { claimed: false, sent: false, status: null, id: null }

  // ---- No transaction is open from here until the result is recorded -------
  const result = await sendOutsideTransaction(providers, row)

  if (result.sent) {
    const applied = await recordSent(prisma, {
      row,
      workerId,
      providerMessageId: result.providerMessageId,
      now,
    })

    logger?.info?.(
      {
        outboxId: row.id,
        template: row.template,
        channel: row.channel,
        attempts: row.attempts,
        applied,
      },
      'notification sent',
    )

    return { claimed: true, sent: true, status: OUTBOX_STATES.SENT, id: row.id }
  }

  const { status } = await recordFailure(prisma, { row, workerId, error: result.error, now, retry })

  logger?.warn?.(
    {
      outboxId: row.id,
      template: row.template,
      channel: row.channel,
      attempts: row.attempts,
      category: classifyFailure(result.error),
      status,
    },
    'notification not sent',
  )

  return { claimed: true, sent: false, status, id: row.id }
}

/**
 * Drain everything that is due.
 *
 * Bounded by `limit` so one pass cannot run forever against a backlog that is
 * being written to as fast as it is drained.
 *
 * @param {object} options As {@link dispatchOne}, plus a limit.
 * @param {number} [options.limit] How many messages one pass may handle.
 * @returns {Promise<{claimed: number, sent: number, failed: number}>} A summary.
 */
export async function drainOutbox(options) {
  const { limit = 50 } = options
  let claimed = 0
  let sent = 0
  let failed = 0

  for (let index = 0; index < limit; index += 1) {
    const result = await dispatchOne(options)

    if (!result.claimed) break

    claimed += 1
    if (result.sent) sent += 1
    else failed += 1
  }

  return { claimed, sent, failed }
}
