/**
 * A referral code's use count: the only writer of `ReferralCode.useCount`
 * (SPEC3 §4.6, §8.2).
 *
 * A use is taken in the order's first transaction, after the order row is
 * written and under the code's row lock (`evaluateReferral` takes it), and is
 * given back wherever a promo code's use is: a declined payment, a free order
 * whose settlement failed, an unpaid order cancelled. Both are single
 * statements on the database's own count rather than a read and a write, so
 * two orders racing for the last use cannot both see it free: the CHECK
 * `referral_code_use_within_limit` refuses a count past the code's limit
 * whatever happens here, and its refusal reaches the buyer as 409
 * `REFERRAL_NOT_ACCEPTED` (`lib/errors.js`).
 *
 * Raw statements on purpose. A Prisma `update` would also move the row's
 * `updatedAt`, which is the administrators' compare-and-set on an edit
 * (`expectedUpdatedAt`): every order placed with a code would make the next
 * edit of it look stale.
 *
 * No log call here takes a code's row or its text: this module sees only ids.
 *
 * @module @desi-event/api/lib/referral-uses
 */

/**
 * Check a referral code's id before it reaches SQL.
 *
 * @param {unknown} referralCodeId The id.
 * @returns {string} The id.
 * @throws {TypeError} For anything that is not a non-empty string.
 */
function requireCodeId(referralCodeId) {
  if (typeof referralCodeId !== 'string' || referralCodeId.length === 0) {
    throw new TypeError('A referral code use needs the code’s id')
  }

  return referralCodeId
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
export async function consumeReferralUse(tx, { referralCodeId }) {
  const id = requireCodeId(referralCodeId)

  return tx.$executeRaw`UPDATE "ReferralCode" SET "useCount" = "useCount" + 1 WHERE "id" = ${id}`
}

/**
 * Give one use of a referral code back, for an order that never completed.
 *
 * Conditional on a use being there to give back, so the count never goes
 * below 0. It does not know which order a use belongs to, so it does not stop
 * one order's use being given back twice: a second call for the same order
 * gives back a use another order holds. Callers must make it happen once per
 * order.
 *
 * @param {object} tx A transaction client.
 * @param {{referralCodeId: string}} params The code.
 * @returns {Promise<number>} 1 when a use was given back, 0 when there was none to give.
 */
export async function returnReferralUse(tx, { referralCodeId }) {
  const id = requireCodeId(referralCodeId)

  return tx.$executeRaw`UPDATE "ReferralCode" SET "useCount" = "useCount" - 1 WHERE "id" = ${id} AND "useCount" > 0`
}
