/**
 * The chart of accounts, as codes.
 *
 * Every account is created by the Phase 2 migration and referenced from code by
 * its `code` rather than its id, so a fixture, a disposable test database and a
 * deployed one all name the same thing. The ids in the migration are literal and
 * stable for the same reason; nothing here depends on them.
 *
 * Normal balances are recorded because a double-entry system that does not say
 * which side increases an account invites entries that balance arithmetically
 * and mean the opposite of what was intended.
 *
 * @module @desi-event/ledger/accounts
 */

/** Debits increase an asset or an expense. */
export const DEBIT = 'DEBIT'

/** Credits increase a liability, revenue, or equity. */
export const CREDIT = 'CREDIT'

/**
 * Account codes, by role in the flow of money.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ACCOUNTS = Object.freeze({
  /**
   * Money the processor is holding for us. An asset: it is ours, it is just not
   * in our bank yet. Debited when a payment succeeds, credited when the money
   * leaves — to the organiser, back to a buyer, or to a disputed-funds hold.
   */
  PROCESSOR_CLEARING: 'processor_clearing',

  /**
   * What we owe organisers. A liability: the buyer's money is not Desi-Event's
   * revenue, and treating it as such is the single most consequential mistake a
   * marketplace ledger can make.
   */
  ORGANIZER_PAYABLE: 'organizer_payable',

  /** Desi-Event's fee. The only part of an order that is our revenue. */
  PLATFORM_FEE_REVENUE: 'platform_fee_revenue',

  /** Tax collected on behalf of an authority. A liability, never revenue. */
  TAX_PAYABLE: 'tax_payable',

  /** A refund that has been decided but not yet settled by the processor. */
  REFUND_CLEARING: 'refund_clearing',

  /** Funds held back while a dispute is open. */
  DISPUTE_CLEARING: 'dispute_clearing',

  /** A transfer to a connected account, in flight. */
  TRANSFER_CLEARING: 'transfer_clearing',

  /** A payout to an organiser's bank, in flight. */
  PAYOUT_CLEARING: 'payout_clearing',

  /**
   * Discounts given. Contra-revenue rather than an expense: a discount reduces
   * what was earned, it does not cost anything.
   */
  PROMOTIONAL_DISCOUNT: 'promotional_discount',

  /** What the processor charges us. An expense. */
  PAYMENT_FEE_EXPENSE: 'payment_fee_expense',
})

/**
 * The side that increases each account.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const NORMAL_BALANCE = Object.freeze({
  [ACCOUNTS.PROCESSOR_CLEARING]: DEBIT,
  [ACCOUNTS.ORGANIZER_PAYABLE]: CREDIT,
  [ACCOUNTS.PLATFORM_FEE_REVENUE]: CREDIT,
  [ACCOUNTS.TAX_PAYABLE]: CREDIT,
  [ACCOUNTS.REFUND_CLEARING]: CREDIT,
  [ACCOUNTS.DISPUTE_CLEARING]: CREDIT,
  [ACCOUNTS.TRANSFER_CLEARING]: DEBIT,
  [ACCOUNTS.PAYOUT_CLEARING]: DEBIT,
  [ACCOUNTS.PROMOTIONAL_DISCOUNT]: DEBIT,
  [ACCOUNTS.PAYMENT_FEE_EXPENSE]: DEBIT,
})

/** Every account code, for validation. */
export const ALL_ACCOUNTS = Object.freeze(Object.values(ACCOUNTS))

/**
 * Whether a string names an account this system knows.
 *
 * @param {unknown} code A candidate account code.
 * @returns {boolean} True when it is one of `ALL_ACCOUNTS`.
 */
export function isAccount(code) {
  return typeof code === 'string' && ALL_ACCOUNTS.includes(code)
}
