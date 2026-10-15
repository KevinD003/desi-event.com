/**
 * What an operator may do to a message in the outbox: put it back in the
 * queue, or withdraw it.
 *
 * ## A leased message belongs to the worker holding it
 *
 * A `CLAIMED` row is one a worker is sending, or was sending until its lease
 * lapsed and another worker picks it up. Neither is the operator's to touch.
 * Retry used to accept one: its transition check allowed `CLAIMED → QUEUED`
 * and its update was conditional on the status alone, so pressing retry while
 * a worker was inside the provider call wiped the lease, put the row back in
 * the pool, and let a second worker send it again. The worker's own completion
 * then matched nothing and its provider message id was lost.
 *
 * Now each operation names the states it may start from, and the conditions go
 * **into the `UPDATE`'s `WHERE` clause**, not into a JavaScript check before
 * it. A check before the write is a check against a row that may already have
 * changed: a worker can claim a `RETRY_SCHEDULED` row between the read and the
 * write. Under PostgreSQL's read-committed isolation a conditional `UPDATE`
 * re-evaluates its `WHERE` against the row version it finally locks, so a row
 * a worker claimed a moment ago no longer matches and the operator is told
 * somebody else changed it.
 *
 * | Operation | May start from                                       | Never from                          |
 * | --------- | ---------------------------------------------------- | ----------------------------------- |
 * | retry     | `DEAD_LETTER`, `FAILED`, `RETRY_SCHEDULED`           | `CLAIMED` (live or lapsed), terminal |
 * | cancel    | `QUEUED`, `RETRY_SCHEDULED`, `DEAD_LETTER`, `FAILED`, and `CLAIMED` whose lease has lapsed | `CLAIMED` with a live lease, terminal |
 *
 * Retrying a lapsed lease is refused rather than allowed because the worker
 * already re-claims one on its own (`claimableWhere`), and an operator retry
 * racing that re-claim is exactly the double send this module exists to stop.
 *
 * ## A redacted message stays dead
 *
 * Privacy redaction rewrites a settled message's recipient to a
 * `@redacted.invalid` placeholder and scrubs its payload. Requeuing one would
 * "send" a gutted message to nobody and record it as delivered. Refused, and
 * the refusal is in the `WHERE` clause too.
 *
 * ## What the audit row says
 *
 * Who, when, why (the operator's reason), from which status to which, and
 * which template. Never the recipient, the payload or the dedupe key. The
 * lease owner and expiry it overrode, for a cancel of a lapsed lease, so a
 * reviewer can see which worker's claim was withdrawn.
 *
 * ## Known limits, recorded rather than fixed here
 *
 * - Lease expiry is judged by this host's clock against an instant the worker
 *   computed on its own clock. Skew between the two shifts the boundary.
 * - A worker's completion is conditional on its ownership and the `CLAIMED`
 *   status but not on its lease still being live, and `sentAt` is the claim
 *   instant rather than the send instant. Both are in the worker.
 * - Leases are not renewed during a send.
 *
 * @module @desi-event/api/lib/notification-operations
 */

import { OUTBOX_STATES } from '@desi-event/notifications'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, notFound } from './errors.js'
import { REDACTED_EMAIL_DOMAIN } from './privacy-placeholders.js'

/**
 * The states a message may be put back in the queue from.
 *
 * @type {ReadonlyArray<string>}
 */
export const RETRYABLE_STATES = Object.freeze([
  OUTBOX_STATES.DEAD_LETTER,
  OUTBOX_STATES.FAILED,
  OUTBOX_STATES.RETRY_SCHEDULED,
])

/**
 * The states a message may be withdrawn from without a lease in the way.
 *
 * `CLAIMED` is handled separately, because it is cancellable only once its
 * lease has lapsed.
 *
 * @type {ReadonlyArray<string>}
 */
export const CANCELLABLE_STATES = Object.freeze([
  OUTBOX_STATES.QUEUED,
  OUTBOX_STATES.RETRY_SCHEDULED,
  OUTBOX_STATES.DEAD_LETTER,
  OUTBOX_STATES.FAILED,
])

/**
 * The `WHERE` fragment that excludes a redacted message.
 *
 * @type {Readonly<object>}
 */
const NOT_REDACTED = Object.freeze({
  NOT: { recipient: { endsWith: `@${REDACTED_EMAIL_DOMAIN}` } },
})

/**
 * A status in words, for a refusal.
 *
 * @param {string} status An outbox status.
 * @returns {string} Lower case, spaced.
 */
function inWords(status) {
  return status.toLowerCase().replaceAll('_', ' ')
}

/**
 * Whether a stored recipient is a redaction placeholder.
 *
 * @param {object} row An outbox row.
 * @returns {boolean} True when redacted.
 */
function isRedacted(row) {
  return typeof row.recipient === 'string' && row.recipient.endsWith(`@${REDACTED_EMAIL_DOMAIN}`)
}

/**
 * Put a message back in the queue.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.id The outbox row.
 * @param {string|null} options.actorId Who.
 * @param {string} options.reason Why, in the operator's words.
 * @param {string|null} [options.requestId] For the audit row.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} The row after the change.
 * @throws {Error} 404 for no such message; 409 when it may not be retried or changed underneath.
 */
export async function retryNotification(
  prisma,
  { id, actorId, reason, requestId = null, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.notificationOutbox.findUnique({ where: { id } })

    if (!row) throw notFound('No such notification.')

    if (row.status === OUTBOX_STATES.CLAIMED) {
      throw conflict(
        'A worker holds this message. It will be sent, retried or dead-lettered without you; retry it if it dead-letters.',
        { reason: 'LEASED', status: row.status },
      )
    }

    if (!RETRYABLE_STATES.includes(row.status)) {
      throw conflict(`A ${inWords(row.status)} message cannot be put back in the queue.`, {
        reason: 'NOT_RETRYABLE',
        status: row.status,
      })
    }

    if (isRedacted(row)) {
      throw conflict('This message was redacted for privacy. There is nobody left to send it to.', {
        reason: 'REDACTED',
      })
    }

    // Every condition in the WHERE clause, so the database re-checks them
    // against the row it locks. A worker that claimed a RETRY_SCHEDULED row a
    // moment ago has made it CLAIMED, and this matches nothing.
    const { count } = await tx.notificationOutbox.updateMany({
      where: {
        id: row.id,
        status: row.status,
        leaseOwner: null,
        ...NOT_REDACTED,
      },
      data: {
        status: OUTBOX_STATES.QUEUED,
        // Due now, and the attempts start again: an operator requeuing a dead
        // letter has decided the cause is fixed, and leaving the counter spent
        // would dead-letter it again on the first hiccup.
        scheduledFor: now,
        attempts: 0,
        failureCategory: null,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    })

    if (count === 0) {
      throw conflict('Somebody else changed this message while you were looking at it.', {
        reason: 'CHANGED',
      })
    }

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.NOTIFICATION_REQUEUED,
      entityType: 'NotificationOutbox',
      entityId: row.id,
      actorId,
      metadata: {
        requestId,
        at: now.toISOString(),
        previousStatus: row.status,
        newStatus: OUTBOX_STATES.QUEUED,
        attemptsBefore: row.attempts,
        template: row.template,
        reason,
      },
    })

    return tx.notificationOutbox.findUnique({ where: { id: row.id } })
  })
}

/**
 * Withdraw a message that has not gone out.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.id The outbox row.
 * @param {string|null} options.actorId Who.
 * @param {string} options.reason Why, in the operator's words.
 * @param {string|null} [options.requestId] For the audit row.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} The row after the change.
 * @throws {Error} 404 for no such message; 409 when it may not be withdrawn or changed underneath.
 */
export async function cancelNotification(
  prisma,
  { id, actorId, reason, requestId = null, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.notificationOutbox.findUnique({ where: { id } })

    if (!row) throw notFound('No such notification.')

    const leased = row.status === OUTBOX_STATES.CLAIMED
    const lapsed = leased && row.leaseExpiresAt instanceof Date && row.leaseExpiresAt <= now

    // A live lease means a worker may be mid-send. Cancelling now would leave
    // the row saying one thing and the provider having done another.
    if (leased && !lapsed) {
      throw conflict('A worker is sending this message. Try again in a moment.', {
        reason: 'LEASED',
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      })
    }

    if (!leased && !CANCELLABLE_STATES.includes(row.status)) {
      throw conflict(`A ${inWords(row.status)} message cannot be withdrawn.`, {
        reason: 'NOT_CANCELLABLE',
        status: row.status,
      })
    }

    // For a lapsed lease, the owner and the expiry that were read are part of
    // the condition: a worker that re-claimed the row in between has a new
    // expiry in the future, and this matches nothing rather than withdrawing a
    // message somebody is sending right now.
    const { count } = await tx.notificationOutbox.updateMany({
      where: leased
        ? {
            id: row.id,
            status: OUTBOX_STATES.CLAIMED,
            leaseOwner: row.leaseOwner,
            leaseExpiresAt: { lte: now },
          }
        : { id: row.id, status: row.status },
      data: {
        status: OUTBOX_STATES.CANCELLED,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    })

    if (count === 0) {
      throw conflict('Somebody else changed this message while you were looking at it.', {
        reason: 'CHANGED',
      })
    }

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.NOTIFICATION_CANCELLED,
      entityType: 'NotificationOutbox',
      entityId: row.id,
      actorId,
      metadata: {
        requestId,
        at: now.toISOString(),
        previousStatus: row.status,
        newStatus: OUTBOX_STATES.CANCELLED,
        template: row.template,
        reason,
        ...(leased
          ? {
              lapsedLeaseOwner: row.leaseOwner,
              lapsedLeaseExpiresAt: row.leaseExpiresAt.toISOString(),
            }
          : {}),
      },
    })

    return tx.notificationOutbox.findUnique({ where: { id: row.id } })
  })
}
