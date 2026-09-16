/**
 * What each commerce event posts to the ledger.
 *
 * Pure: every function here takes amounts and returns a batch description. No
 * database, no clock, no ids. That split is deliberate and matches the seating
 * module — deciding what should happen and finding out whether it did are
 * different problems, and only the second one needs a transaction.
 *
 * The rule every batch obeys is that **debits equal credits, in one currency**.
 * `composeBatch` refuses anything else, so an unbalanced batch cannot be built,
 * let alone posted. The database refuses it again at posting time
 * (`desi_ledger_batch_balance`), which is not redundancy for its own sake: this
 * check gives a caller a useful error, and that one is true for every writer
 * including a migration and a `psql` prompt.
 *
 * Amounts are integer minor units throughout. A float in a ledger is a bug with
 * a delay on it.
 *
 * @module @desi-event/ledger/batches
 */

import { ACCOUNTS, CREDIT, DEBIT, isAccount } from './accounts.js'
import { LedgerError } from './errors.js'

/** The batch kinds the schema permits, mirrored here so a typo fails loudly. */
export const BATCH_KINDS = Object.freeze({
  ORDER_PAID: 'ORDER_PAID',
  REFUND: 'REFUND',
  DISPUTE_OPENED: 'DISPUTE_OPENED',
  DISPUTE_RESOLVED: 'DISPUTE_RESOLVED',
  TRANSFER: 'TRANSFER',
  TRANSFER_REVERSAL: 'TRANSFER_REVERSAL',
  PAYOUT: 'PAYOUT',
  PLATFORM_FEE: 'PLATFORM_FEE',
  CORRECTION: 'CORRECTION',
})

/**
 * The largest amount any single entry may carry.
 *
 * `Number.MAX_SAFE_INTEGER` minor units is far beyond any real order, so this is
 * not a business limit — it is the boundary past which integer arithmetic stops
 * being exact, and a ledger that has crossed it is producing numbers that look
 * right and are not.
 *
 * @type {number}
 */
export const MAX_ENTRY_MINOR = Number.MAX_SAFE_INTEGER

/**
 * Check that a value is a usable minor-unit amount.
 *
 * @param {unknown} value The candidate.
 * @param {string} label What it is, for the error message.
 * @returns {number} The value, when it is usable.
 * @throws {LedgerError} When it is not a positive safe integer.
 */
function requireAmount(value, label) {
  if (!Number.isInteger(value)) {
    throw new LedgerError('AMOUNT_NOT_INTEGER', `${label} must be an integer number of minor units`)
  }

  if (value <= 0) {
    throw new LedgerError('AMOUNT_NOT_POSITIVE', `${label} must be greater than zero`)
  }

  if (value > MAX_ENTRY_MINOR) {
    throw new LedgerError('AMOUNT_TOO_LARGE', `${label} exceeds exact integer arithmetic`)
  }

  return value
}

/**
 * Build one entry.
 *
 * @param {string} account The account code.
 * @param {string} direction `DEBIT` or `CREDIT`.
 * @param {number} amountCents The amount in minor units.
 * @param {string} memo A line description for reports.
 * @param {string|null} [organizationId] Denormalised so settlement reports need no join.
 * @returns {{account: string, direction: string, amountCents: number, memo: string, organizationId: string|null}} The entry.
 */
export function entry(account, direction, amountCents, memo, organizationId = null) {
  if (!isAccount(account)) {
    throw new LedgerError('UNKNOWN_ACCOUNT', `No ledger account is called "${account}"`)
  }

  if (direction !== DEBIT && direction !== CREDIT) {
    throw new LedgerError('BAD_DIRECTION', `An entry is DEBIT or CREDIT, not "${direction}"`)
  }

  return {
    account,
    direction,
    amountCents: requireAmount(amountCents, `The ${account} entry`),
    memo,
    organizationId,
  }
}

/**
 * Assemble entries into a batch, refusing one that does not balance.
 *
 * @param {object} batch The batch.
 * @param {string} batch.kind One of `BATCH_KINDS`.
 * @param {string} batch.currency ISO 4217 alphabetic code.
 * @param {Array<object>} batch.entries The entries.
 * @returns {{kind: string, currency: string, debitCents: number, creditCents: number, entries: Array<object>}} The composed batch.
 * @throws {LedgerError} When it does not balance, is empty, or names an unknown kind.
 */
export function composeBatch({ kind, currency, entries }) {
  if (!Object.values(BATCH_KINDS).includes(kind)) {
    throw new LedgerError('UNKNOWN_KIND', `No ledger batch kind is called "${kind}"`)
  }

  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new LedgerError('BAD_CURRENCY', 'A batch currency is a three-letter ISO 4217 code')
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new LedgerError('EMPTY_BATCH', 'A ledger batch with no entries records nothing')
  }

  let debitCents = 0
  let creditCents = 0

  for (const line of entries) {
    if (line.direction === DEBIT) debitCents += line.amountCents
    else creditCents += line.amountCents
  }

  if (debitCents !== creditCents) {
    throw new LedgerError(
      'UNBALANCED',
      `A ${kind} batch does not balance: ${debitCents} debit against ${creditCents} credit`,
      { debitCents, creditCents },
    )
  }

  return { kind, currency, debitCents, creditCents, entries }
}

/**
 * The batch a successful order payment posts.
 *
 * The shape says what a marketplace is. The buyer's money arrives as an asset in
 * processor clearing; almost all of it is a **liability to the organiser**, not
 * revenue; only the platform fee is revenue; tax is a liability to an authority;
 * and a discount is contra-revenue, reducing what was earned rather than costing
 * anything.
 *
 * `capturedCents` is what the buyer actually paid, so it is the debit. The
 * credits are what that payment is made of, and they have to add up to it — if
 * they do not, the split is wrong and posting a balanced-but-wrong batch would
 * bury the error. `composeBatch` refuses instead.
 *
 * @param {object} input The order's money, in minor units.
 * @param {number} input.capturedCents What the buyer paid.
 * @param {number} input.organizerNetCents What the organiser is owed.
 * @param {number} input.platformFeeCents Desi-Event's fee.
 * @param {number} [input.taxCents] Tax collected on behalf of an authority.
 * @param {number} [input.discountCents] Discount given, as contra-revenue.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose payable this is.
 * @param {string} input.reference A human-readable order reference for the memos.
 * @returns {object} A composed batch.
 */
export function orderPaidBatch({
  capturedCents,
  organizerNetCents,
  platformFeeCents,
  taxCents = 0,
  discountCents = 0,
  currency,
  organizationId,
  reference,
}) {
  const entries = [
    entry(
      ACCOUNTS.PROCESSOR_CLEARING,
      DEBIT,
      capturedCents,
      `Order ${reference} captured`,
      organizationId,
    ),
  ]

  // A discount is debited alongside the capture: the organiser is credited the
  // full face value and the discount is carried as a reduction of revenue, so a
  // report can answer "what did we give away" without reconstructing it.
  if (discountCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.PROMOTIONAL_DISCOUNT,
        DEBIT,
        discountCents,
        `Order ${reference} discount`,
        organizationId,
      ),
    )
  }

  entries.push(
    entry(
      ACCOUNTS.ORGANIZER_PAYABLE,
      CREDIT,
      organizerNetCents,
      `Order ${reference} owed to organiser`,
      organizationId,
    ),
  )

  if (platformFeeCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.PLATFORM_FEE_REVENUE,
        CREDIT,
        platformFeeCents,
        `Order ${reference} platform fee`,
        organizationId,
      ),
    )
  }

  if (taxCents > 0) {
    entries.push(
      entry(ACCOUNTS.TAX_PAYABLE, CREDIT, taxCents, `Order ${reference} tax`, organizationId),
    )
  }

  return composeBatch({ kind: BATCH_KINDS.ORDER_PAID, currency, entries })
}

/**
 * The batch a refund posts.
 *
 * The mirror of a payment, and deliberately not a negative one: a ledger with
 * negative amounts loses the distinction between "money moved back" and "money
 * never moved", which is exactly the distinction a dispute turns on. The
 * organiser's payable is reduced, the platform fee is given back to the extent
 * it is being refunded, and the money leaves through refund clearing until the
 * processor confirms it.
 *
 * @param {object} input The refund's money, in minor units.
 * @param {number} input.refundedCents The total going back to the buyer.
 * @param {number} input.organizerShareCents Taken back from the organiser's payable.
 * @param {number} [input.platformFeeRefundCents] Fee given back.
 * @param {number} [input.taxRefundCents] Tax given back.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose payable is reduced.
 * @param {string} input.reference A human-readable reference for the memos.
 * @returns {object} A composed batch.
 */
export function refundBatch({
  refundedCents,
  organizerShareCents,
  platformFeeRefundCents = 0,
  taxRefundCents = 0,
  currency,
  organizationId,
  reference,
}) {
  const entries = [
    entry(
      ACCOUNTS.ORGANIZER_PAYABLE,
      DEBIT,
      organizerShareCents,
      `Refund ${reference} taken from organiser`,
      organizationId,
    ),
  ]

  if (platformFeeRefundCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.PLATFORM_FEE_REVENUE,
        DEBIT,
        platformFeeRefundCents,
        `Refund ${reference} fee returned`,
        organizationId,
      ),
    )
  }

  if (taxRefundCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.TAX_PAYABLE,
        DEBIT,
        taxRefundCents,
        `Refund ${reference} tax returned`,
        organizationId,
      ),
    )
  }

  entries.push(
    entry(
      ACCOUNTS.REFUND_CLEARING,
      CREDIT,
      refundedCents,
      `Refund ${reference} owed to buyer`,
      organizationId,
    ),
  )

  return composeBatch({ kind: BATCH_KINDS.REFUND, currency, entries })
}

/**
 * The batch a refund posts once the processor has settled it.
 *
 * Separate from `refundBatch` because "we decided to refund" and "the money has
 * gone" are different facts, and a report that conflates them overstates what has
 * left the account.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.refundedCents The settled amount.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose refund it was.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function refundSettledBatch({ refundedCents, currency, organizationId, reference }) {
  return composeBatch({
    kind: BATCH_KINDS.REFUND,
    currency,
    entries: [
      entry(
        ACCOUNTS.REFUND_CLEARING,
        DEBIT,
        refundedCents,
        `Refund ${reference} settled`,
        organizationId,
      ),
      entry(
        ACCOUNTS.PROCESSOR_CLEARING,
        CREDIT,
        refundedCents,
        `Refund ${reference} left processor`,
        organizationId,
      ),
    ],
  })
}

/**
 * The batch an opened dispute posts.
 *
 * The money is not gone — it is held. Moving it into dispute clearing is what
 * stops a payout from treating contested funds as available, which is the
 * failure this account exists to prevent.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.disputedCents The amount under dispute.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose funds are held.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function disputeOpenedBatch({ disputedCents, currency, organizationId, reference }) {
  return composeBatch({
    kind: BATCH_KINDS.DISPUTE_OPENED,
    currency,
    entries: [
      entry(
        ACCOUNTS.ORGANIZER_PAYABLE,
        DEBIT,
        disputedCents,
        `Dispute ${reference} held from organiser`,
        organizationId,
      ),
      entry(
        ACCOUNTS.DISPUTE_CLEARING,
        CREDIT,
        disputedCents,
        `Dispute ${reference} funds held`,
        organizationId,
      ),
    ],
  })
}

/**
 * The batch a resolved dispute posts.
 *
 * Won and lost are the same movement in opposite directions, so they are one
 * function with a flag rather than two that could drift apart.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.disputedCents The amount that was held.
 * @param {boolean} input.won True when the dispute was won and the money returns to the organiser.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose funds were held.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function disputeResolvedBatch({ disputedCents, won, currency, organizationId, reference }) {
  const entries = won
    ? [
        entry(
          ACCOUNTS.DISPUTE_CLEARING,
          DEBIT,
          disputedCents,
          `Dispute ${reference} released`,
          organizationId,
        ),
        entry(
          ACCOUNTS.ORGANIZER_PAYABLE,
          CREDIT,
          disputedCents,
          `Dispute ${reference} returned to organiser`,
          organizationId,
        ),
      ]
    : [
        entry(
          ACCOUNTS.DISPUTE_CLEARING,
          DEBIT,
          disputedCents,
          `Dispute ${reference} lost`,
          organizationId,
        ),
        entry(
          ACCOUNTS.PROCESSOR_CLEARING,
          CREDIT,
          disputedCents,
          `Dispute ${reference} charged back`,
          organizationId,
        ),
      ]

  return composeBatch({ kind: BATCH_KINDS.DISPUTE_RESOLVED, currency, entries })
}

/**
 * The batch a transfer to a connected account posts.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.amountCents The amount transferred.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId The recipient organisation.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function transferBatch({ amountCents, currency, organizationId, reference }) {
  return composeBatch({
    kind: BATCH_KINDS.TRANSFER,
    currency,
    entries: [
      entry(
        ACCOUNTS.ORGANIZER_PAYABLE,
        DEBIT,
        amountCents,
        `Transfer ${reference} settles payable`,
        organizationId,
      ),
      entry(
        ACCOUNTS.TRANSFER_CLEARING,
        CREDIT,
        amountCents,
        `Transfer ${reference} in flight`,
        organizationId,
      ),
    ],
  })
}

/**
 * The batch a reversed transfer posts.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.amountCents The amount reversed.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId The organisation whose transfer reversed.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function transferReversalBatch({ amountCents, currency, organizationId, reference }) {
  return composeBatch({
    kind: BATCH_KINDS.TRANSFER_REVERSAL,
    currency,
    entries: [
      entry(
        ACCOUNTS.TRANSFER_CLEARING,
        DEBIT,
        amountCents,
        `Transfer ${reference} reversed`,
        organizationId,
      ),
      entry(
        ACCOUNTS.ORGANIZER_PAYABLE,
        CREDIT,
        amountCents,
        `Transfer ${reference} returns to payable`,
        organizationId,
      ),
    ],
  })
}

/**
 * The batch a payout posts.
 *
 * @param {object} input Amounts and identifiers.
 * @param {number} input.amountCents The amount paid out.
 * @param {boolean} [input.failed] True when the payout failed and the money returns.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId The organisation paid.
 * @param {string} input.reference A reference for the memos.
 * @returns {object} A composed batch.
 */
export function payoutBatch({ amountCents, failed = false, currency, organizationId, reference }) {
  const entries = failed
    ? [
        entry(
          ACCOUNTS.TRANSFER_CLEARING,
          DEBIT,
          amountCents,
          `Payout ${reference} failed`,
          organizationId,
        ),
        entry(
          ACCOUNTS.PAYOUT_CLEARING,
          CREDIT,
          amountCents,
          `Payout ${reference} returned`,
          organizationId,
        ),
      ]
    : [
        entry(
          ACCOUNTS.PAYOUT_CLEARING,
          DEBIT,
          amountCents,
          `Payout ${reference} paid`,
          organizationId,
        ),
        entry(
          ACCOUNTS.TRANSFER_CLEARING,
          CREDIT,
          amountCents,
          `Payout ${reference} left clearing`,
          organizationId,
        ),
      ]

  return composeBatch({ kind: BATCH_KINDS.PAYOUT, currency, entries })
}

/**
 * The batch that corrects another.
 *
 * Every entry of the original, with its direction flipped. A posted batch cannot
 * be edited — the database refuses it — so this is the only way history is
 * changed, and it changes history by adding to it.
 *
 * @param {object} original The posted batch to reverse, with its entries.
 * @param {string} reason Why, recorded in every memo.
 * @returns {object} A composed `CORRECTION` batch.
 */
export function correctionBatch(original, reason) {
  if (!original?.entries?.length) {
    throw new LedgerError('EMPTY_BATCH', 'There is nothing to correct in a batch with no entries')
  }

  return composeBatch({
    kind: BATCH_KINDS.CORRECTION,
    currency: original.currency,
    entries: original.entries.map((line) =>
      entry(
        line.account,
        line.direction === DEBIT ? CREDIT : DEBIT,
        line.amountCents,
        `Correction: ${reason}`,
        line.organizationId ?? null,
      ),
    ),
  })
}
