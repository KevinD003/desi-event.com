/**
 * A referral code's use count: the only writer of `ReferralCode.useCount` and
 * of an order's referral return marker (`Order.referralUseReturnedAt`,
 * `Order.referralUseReturnCause`), SPEC3 §8.2 as SPEC3-XI XR1-XR6 amend it.
 *
 * A use is taken in the order's first transaction, after the order row is
 * written and under the code's row lock (`evaluateReferral` takes it). It is
 * given back when the order ends without being used (XR2): cancelled, expired
 * or refunded, or paid with nothing admitted, nothing left to refund and
 * nothing standing (or its event cancelled). The owner's answer to open
 * question 3: "a refunded or cancelled order gives its referral code's use
 * back", once, never below zero.
 *
 * Exactly once, under any race (XR5): {@link settleReferralUsesIfEnded} decides
 * under the order's row lock, after the caller's own changes, and sets the
 * order's marker with a conditional update. Two transactions that each finish
 * half of an order's ending both evaluate under that lock; the second sees the
 * first's committed half. A second updater of the marker waits for the row,
 * re-reads it committed, finds the marker set and updates nothing; a set
 * marker never changes (trigger `order_referral_return_once`).
 *
 * Lock position (XR6, SPEC3-XI §2.1 row 10): referral codes are the last row
 * locks of every transaction that takes them, in ascending id order. Every
 * order of a batch is re-locked and marked first; only then is each code
 * locked and lowered once, by the number of uses it gets back. So a
 * transaction holding a code never waits for an order, and two that hold
 * several codes take them in the same order. Callers run it once per
 * transaction, after their last write to an order, line, ticket or seat.
 *
 * Raw statements on purpose. A Prisma `update` would also move the code's
 * `updatedAt`, which is the administrators' compare-and-set on an edit
 * (`expectedUpdatedAt`): every order placed with a code would make the next
 * edit of it look stale. The count is the database's own: the CHECKs
 * `referral_code_use_within_limit` and `referral_code_shape` (`useCount >= 0`)
 * hold whatever happens here.
 *
 * No log call or audit row here takes a code's row or its text: this module
 * sees only ids.
 *
 * @module @desi-event/api/lib/referral-uses
 */

import { Prisma } from '@desi-event/db'
import { REFERRAL_RETURN_CAUSES } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'

/**
 * Check an id before it reaches SQL.
 *
 * @param {unknown} id The id.
 * @param {string} what What the id names, for the error.
 * @returns {string} The id.
 * @throws {TypeError} For anything that is not a non-empty string.
 */
function requireId(id, what) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`A referral code use needs the ${what}’s id`)
  }

  return id
}

/**
 * Check a return cause before it reaches SQL.
 *
 * @param {unknown} cause The cause.
 * @returns {string} One of `REFERRAL_RETURN_CAUSES`.
 * @throws {TypeError} For anything else.
 */
function requireCause(cause) {
  if (!REFERRAL_RETURN_CAUSES.includes(cause)) {
    throw new TypeError(
      `A referral use is given back for one of ${REFERRAL_RETURN_CAUSES.join(', ')}`,
    )
  }

  return cause
}

/**
 * Ascending, as the lock law orders ids.
 *
 * @param {string} a One id.
 * @param {string} b Another.
 * @returns {number} Their order.
 */
function ascending(a, b) {
  if (a === b) return 0

  return a < b ? -1 : 1
}

/**
 * Take one use of a referral code for an order being placed.
 *
 * Call inside the order's first transaction, after the order row is written
 * and while the code's row is locked. Past the code's limit the database
 * refuses (`referral_code_use_within_limit`), rolling the order back.
 *
 * @param {object} tx A transaction client.
 * @param {{referralCodeId: string}} params The code.
 * @returns {Promise<number>} How many rows were counted: 1, or 0 when no such code exists.
 */
export async function consumeReferralUse(tx, { referralCodeId } = {}) {
  const id = requireId(referralCodeId, 'code')

  return tx.$executeRaw`UPDATE "ReferralCode" SET "useCount" = "useCount" + 1 WHERE "id" = ${id}`
}

/**
 * Which of these orders ended without being used (SPEC3-XI XR2), as the
 * calling transaction sees them: one statement for all of them.
 *
 * An order ended when it is CANCELLED, EXPIRED or REFUNDED; or when it is PAID
 * and no ticket of it was ever let in, no refund of it is in flight, nothing
 * of its total is left once the refunded and kept amounts are taken off, and
 * none of its tickets stands (VALID, TRANSFER_PENDING or CHECKED_IN) — or its
 * event is cancelled. The event's status is the transaction's own uncommitted
 * write when it is the one cancelling, else the committed status.
 *
 * For tests and {@link settleReferralUsesIfEnded} only: it decides nothing on
 * its own, so product code calls that instead. Call it under the orders' row
 * locks for the answer to stay true.
 *
 * @param {object} tx A transaction client.
 * @param {string[]} orderIds The orders.
 * @returns {Promise<string[]>} The ended ones, ascending.
 */
export async function orderEndedWithoutUse(tx, orderIds) {
  if (!Array.isArray(orderIds))
    throw new TypeError('orderEndedWithoutUse needs a list of order ids')

  const ids = [...new Set(orderIds.map((id) => requireId(id, 'order')))].sort(ascending)

  if (ids.length === 0) return []

  const rows = await tx.$queryRaw`
    SELECT o."id" /* referral-order-ended */
    FROM "Order" o
    JOIN "Event" e ON e."id" = o."eventId"
    WHERE o."id" IN (${Prisma.join(ids)})
      AND (
        o."status" IN ('CANCELLED', 'EXPIRED', 'REFUNDED')
        OR (
          o."status" = 'PAID'
          AND NOT EXISTS (
            SELECT 1
            FROM "CheckIn" c
            JOIN "Ticket" t ON t."id" = c."ticketId"
            JOIN "OrderItem" i ON i."id" = t."orderItemId"
            WHERE i."orderId" = o."id"
          )
          AND o."refundPendingCents" = 0
          AND o."totalCents" - o."refundedCents" - o."venueFeeKeptCents" <= 0
          AND (
            NOT EXISTS (
              SELECT 1
              FROM "Ticket" t
              JOIN "OrderItem" i ON i."id" = t."orderItemId"
              WHERE i."orderId" = o."id"
                AND t."status" IN ('VALID', 'TRANSFER_PENDING', 'CHECKED_IN')
            )
            OR e."status" = 'CANCELLED'
          )
        )
      )
    ORDER BY o."id"`

  return rows.map((row) => row.id).sort(ascending)
}

/**
 * Set one order's return marker, if it is not set yet (SPEC3-XI XR3 step 4):
 * the exactly-once decision. Under READ COMMITTED a second updater waits for
 * the row, re-reads it committed, finds the marker set and updates nothing.
 *
 * It lowers no count: for tests and {@link settleReferralUsesIfEnded} only.
 *
 * @param {object} tx A transaction client.
 * @param {{orderId: string, cause: string, now?: Date}} params The order, why, and when.
 * @returns {Promise<{returned: boolean, referralCodeId: string|null}>} Whether this call set it, and the order's code when it did.
 */
export async function returnReferralUseOnce(tx, { orderId, cause, now = new Date() } = {}) {
  const id = requireId(orderId, 'order')
  const why = requireCause(cause)

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('A referral use is given back at a real moment')
  }

  const rows = await tx.$queryRaw`
    UPDATE "Order"
    SET "referralUseReturnedAt" = ${now},
        "referralUseReturnCause" = CAST(${why} AS "ReferralUseReturnCause")
    WHERE "id" = ${id}
      AND "referralCodeId" IS NOT NULL
      AND "referralUseReturnedAt" IS NULL
    RETURNING "referralCodeId"`

  if (rows.length === 0) return { returned: false, referralCodeId: null }

  return { returned: true, referralCodeId: rows[0].referralCodeId }
}

/**
 * Give back the referral use of every order among these that ended without
 * being used, once each, never below zero (SPEC3-XI XR3). The only entry point
 * product code calls, for one order or many; run it once per transaction,
 * after the transaction's last write to an order, line, ticket or seat, with
 * orders the transaction already holds locked.
 *
 * 1. Entries are de-duplicated by order (the first entry's cause wins); orders
 *    naming no code are dropped (their code is fixed for the life of the row,
 *    trigger `order_referral_code_fixed`, so an unlocked read is enough).
 * 2. Each remaining order is re-locked, ascending (the caller holds it, so this
 *    never waits).
 * 3. Which of them ended is read in one statement ({@link orderEndedWithoutUse}).
 * 4. Each ended order's marker is set, ascending ({@link returnReferralUseOnce});
 *    an order already marked gives nothing back.
 * 5. Only then, each code that gets uses back, ascending: locked, then lowered
 *    by `min(k, useCount)` for its `k` uses. Less than `k` happens only after a
 *    hand edit of the database; the markers stay set and a warning names the
 *    ids, nothing else.
 * 6. One audit row per order given back: ids and the cause, never a code's
 *    text.
 *
 * @param {object} tx A transaction client.
 * @param {object} params The batch.
 * @param {Array<{orderId: string, cause: string}>} params.entries The orders and why each may have ended.
 * @param {string|null} [params.actorId] Who acted, for the audit rows; null for the system.
 * @param {string|null} [params.requestId] The request, for the audit rows.
 * @param {Date} [params.now] When.
 * @param {{warn?: Function}|null} [params.log] A logger, for a count found lower than the uses given back.
 * @returns {Promise<Array<{orderId: string, referralCodeId: string, cause: string}>>} The uses given back, by order ascending.
 */
export async function settleReferralUsesIfEnded(
  tx,
  { entries, actorId = null, requestId = null, now = new Date(), log = null } = {},
) {
  if (!Array.isArray(entries)) {
    throw new TypeError('settleReferralUsesIfEnded needs a list of entries')
  }

  const causeOf = new Map()

  for (const entry of entries) {
    const orderId = requireId(entry?.orderId, 'order')
    const cause = requireCause(entry?.cause)

    if (!causeOf.has(orderId)) causeOf.set(orderId, cause)
  }

  if (causeOf.size === 0) return []

  // 1. The orders that name a code. Unlocked: the code never changes.
  const named = await tx.order.findMany({
    where: { id: { in: [...causeOf.keys()] }, referralCodeId: { not: null } },
    select: { id: true },
  })
  const orderIds = named.map((row) => row.id).sort(ascending)

  if (orderIds.length === 0) return []

  // 2. Re-lock, ascending. Every caller already holds these rows.
  for (const orderId of orderIds) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
  }

  // 3. Which ended, as this transaction sees them.
  const ended = await orderEndedWithoutUse(tx, orderIds)

  // 4. The exactly-once decision, order by order.
  const returned = []

  for (const orderId of ended) {
    const cause = causeOf.get(orderId)
    const marked = await returnReferralUseOnce(tx, { orderId, cause, now })

    if (marked.returned) returned.push({ orderId, referralCodeId: marked.referralCodeId, cause })
  }

  if (returned.length === 0) return []

  // 5. The codes last, ascending, each lowered once.
  const byCode = new Map()

  for (const use of returned) {
    const orders = byCode.get(use.referralCodeId) ?? []

    orders.push(use.orderId)
    byCode.set(use.referralCodeId, orders)
  }

  for (const referralCodeId of [...byCode.keys()].sort(ascending)) {
    const orders = byCode.get(referralCodeId)
    const [code] =
      await tx.$queryRaw`SELECT "useCount" FROM "ReferralCode" WHERE "id" = ${referralCodeId} FOR UPDATE`
    const held = Number(code?.useCount ?? 0)
    const lowered = Math.min(orders.length, Math.max(held, 0))

    if (lowered > 0) {
      await tx.$executeRaw`UPDATE "ReferralCode" SET "useCount" = "useCount" - ${lowered} WHERE "id" = ${referralCodeId}`
    }

    if (lowered < orders.length) {
      log?.warn?.(
        { referralCodeId, orderIds: [...orders] },
        'a referral code had fewer uses than its orders gave back',
      )
    }
  }

  // 6. One audit row per order given back.
  for (const use of returned) {
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.REFERRAL_USE_RETURNED,
      entityType: 'ReferralCode',
      entityId: use.referralCodeId,
      actorId,
      metadata: {
        referralCodeId: use.referralCodeId,
        orderId: use.orderId,
        cause: use.cause,
        requestId,
      },
    })
  }

  return returned
}
