import { describe, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT, NORMAL_BALANCE, isAccount } from './accounts.js'
import {
  BATCH_KINDS,
  MAX_ENTRY_MINOR,
  composeBatch,
  correctionBatch,
  disputeOpenedBatch,
  disputeResolvedBatch,
  entry,
  orderPaidBatch,
  payoutBatch,
  refundBatch,
  refundSettledBatch,
  transferBatch,
  transferReversalBatch,
} from './batches.js'

/** A representative order: ₹100.00 paid, split into organiser, fee and tax. */
const ORDER = Object.freeze({
  capturedCents: 10_000,
  organizerNetCents: 8_500,
  platformFeeCents: 690,
  taxCents: 810,
  currency: 'INR',
  organizationId: 'org_rangoli',
  reference: 'DE-2026-0001',
})

/**
 * Sum one side of a batch.
 *
 * @param {object} batch A composed batch.
 * @param {string} direction DEBIT or CREDIT.
 * @returns {number} The total in minor units.
 */
function sideTotal(batch, direction) {
  return batch.entries
    .filter((line) => line.direction === direction)
    .reduce((total, line) => total + line.amountCents, 0)
}

describe('the chart of accounts', () => {
  it('gives every account a normal balance', () => {
    for (const code of Object.values(ACCOUNTS)) {
      expect(NORMAL_BALANCE[code], code).toBeDefined()
    }
  })

  it('recognises its own codes and nothing else', () => {
    expect(isAccount(ACCOUNTS.ORGANIZER_PAYABLE)).toBe(true)
    expect(isAccount('organiser_payable')).toBe(false)
    expect(isAccount(null)).toBe(false)
  })

  it('treats what we owe organisers as a liability, not revenue', () => {
    // The single most consequential classification in a marketplace ledger. If
    // the buyer's money were revenue, every report would overstate the business
    // by the whole of the ticket price.
    expect(NORMAL_BALANCE[ACCOUNTS.ORGANIZER_PAYABLE]).toBe(CREDIT)
    expect(NORMAL_BALANCE[ACCOUNTS.PLATFORM_FEE_REVENUE]).toBe(CREDIT)
    expect(NORMAL_BALANCE[ACCOUNTS.TAX_PAYABLE]).toBe(CREDIT)
  })
})

describe('entry', () => {
  it('refuses an account nobody has heard of', () => {
    expect(() => entry('slush_fund', DEBIT, 100, 'x')).toThrow(/No ledger account/)
  })

  it('refuses a direction that is neither side', () => {
    expect(() => entry(ACCOUNTS.TAX_PAYABLE, 'SIDEWAYS', 100, 'x')).toThrow(/DEBIT or CREDIT/)
  })

  it('refuses a fractional amount, because minor units are integers', () => {
    expect(() => entry(ACCOUNTS.TAX_PAYABLE, DEBIT, 10.5, 'x')).toThrow(/integer/)
  })

  it('refuses zero and negative amounts, because direction carries the sign', () => {
    expect(() => entry(ACCOUNTS.TAX_PAYABLE, DEBIT, 0, 'x')).toThrow(/greater than zero/)
    expect(() => entry(ACCOUNTS.TAX_PAYABLE, DEBIT, -1, 'x')).toThrow(/greater than zero/)
  })

  it('refuses an amount past exact integer arithmetic', () => {
    expect(() => entry(ACCOUNTS.TAX_PAYABLE, DEBIT, MAX_ENTRY_MINOR + 2, 'x')).toThrow(/exact/)
  })
})

describe('composeBatch', () => {
  it('refuses a batch that does not balance', () => {
    expect(() =>
      composeBatch({
        kind: BATCH_KINDS.ORDER_PAID,
        currency: 'INR',
        entries: [
          entry(ACCOUNTS.PROCESSOR_CLEARING, DEBIT, 100, 'in'),
          entry(ACCOUNTS.ORGANIZER_PAYABLE, CREDIT, 99, 'out'),
        ],
      }),
    ).toThrow(/does not balance: 100 debit against 99 credit/)
  })

  it('refuses an empty batch', () => {
    expect(() =>
      composeBatch({ kind: BATCH_KINDS.ORDER_PAID, currency: 'INR', entries: [] }),
    ).toThrow(/records nothing/)
  })

  it('refuses a currency that is not ISO 4217 alphabetic', () => {
    expect(() =>
      composeBatch({ kind: BATCH_KINDS.ORDER_PAID, currency: 'inr', entries: [] }),
    ).toThrow(/three-letter/)
  })

  it('refuses a kind the schema does not have', () => {
    expect(() => composeBatch({ kind: 'VIBES', currency: 'INR', entries: [] })).toThrow(
      /No ledger batch kind/,
    )
  })
})

describe('a paid order', () => {
  it('balances', () => {
    const batch = orderPaidBatch(ORDER)

    expect(batch.debitCents).toBe(batch.creditCents)
    expect(batch.debitCents).toBe(ORDER.capturedCents)
  })

  it('debits what the buyer paid into processor clearing, as an asset', () => {
    const batch = orderPaidBatch(ORDER)
    const clearing = batch.entries.find((line) => line.account === ACCOUNTS.PROCESSOR_CLEARING)

    expect(clearing.direction).toBe(DEBIT)
    expect(clearing.amountCents).toBe(ORDER.capturedCents)
  })

  it('credits the organiser a liability, not the platform revenue', () => {
    const batch = orderPaidBatch(ORDER)
    const payable = batch.entries.find((line) => line.account === ACCOUNTS.ORGANIZER_PAYABLE)
    const revenue = batch.entries.find((line) => line.account === ACCOUNTS.PLATFORM_FEE_REVENUE)

    expect(payable.amountCents).toBe(ORDER.organizerNetCents)
    expect(revenue.amountCents).toBe(ORDER.platformFeeCents)
    expect(payable.amountCents).toBeGreaterThan(revenue.amountCents)
  })

  it('carries the organisation on every line, so settlement needs no join', () => {
    for (const line of orderPaidBatch(ORDER).entries) {
      expect(line.organizationId).toBe(ORDER.organizationId)
    }
  })

  it('omits a zero fee and a zero tax rather than posting zero entries', () => {
    const batch = orderPaidBatch({
      ...ORDER,
      organizerNetCents: 10_000,
      platformFeeCents: 0,
      taxCents: 0,
    })

    expect(batch.entries).toHaveLength(2)
  })

  it('carries a discount as contra-revenue on the debit side', () => {
    // The organiser is credited the full face value; the discount is what the
    // business gave away. Netting it off the payable instead would make the
    // giveaway invisible.
    const batch = orderPaidBatch({
      ...ORDER,
      capturedCents: 9_000,
      discountCents: 1_000,
    })

    const discount = batch.entries.find((line) => line.account === ACCOUNTS.PROMOTIONAL_DISCOUNT)

    expect(discount.direction).toBe(DEBIT)
    expect(discount.amountCents).toBe(1_000)
    expect(batch.debitCents).toBe(batch.creditCents)
  })

  it('refuses a split that does not add up to what was captured', () => {
    // The important failure. A wrong split that still balanced would be posted
    // and never questioned; an unbalanced one stops here.
    expect(() => orderPaidBatch({ ...ORDER, organizerNetCents: 8_000 })).toThrow(/does not balance/)
  })
})

describe('a refund', () => {
  const REFUND = Object.freeze({
    refundedCents: 5_000,
    organizerShareCents: 4_250,
    platformFeeRefundCents: 345,
    taxRefundCents: 405,
    currency: 'INR',
    organizationId: 'org_rangoli',
    reference: 'RF-0001',
  })

  it('balances and takes the money back from the organiser', () => {
    const batch = refundBatch(REFUND)
    const payable = batch.entries.find((line) => line.account === ACCOUNTS.ORGANIZER_PAYABLE)

    expect(batch.debitCents).toBe(batch.creditCents)
    expect(payable.direction).toBe(DEBIT)
  })

  it('uses positive amounts on the opposite side, never a negative amount', () => {
    // A negative amount would lose the distinction between "money moved back"
    // and "money never moved", which is the distinction a dispute turns on.
    for (const line of refundBatch(REFUND).entries) {
      expect(line.amountCents).toBeGreaterThan(0)
    }
  })

  it('separates the decision from the settlement', () => {
    const decided = refundBatch(REFUND)
    const settled = refundSettledBatch({
      refundedCents: REFUND.refundedCents,
      currency: 'INR',
      organizationId: REFUND.organizationId,
      reference: REFUND.reference,
    })

    expect(sideTotal(decided, CREDIT)).toBe(REFUND.refundedCents)
    expect(sideTotal(settled, DEBIT)).toBe(REFUND.refundedCents)

    // Together they take the money out of processor clearing exactly once.
    const clearing = settled.entries.find((line) => line.account === ACCOUNTS.PROCESSOR_CLEARING)

    expect(clearing.direction).toBe(CREDIT)
  })
})

describe('a dispute', () => {
  const DISPUTE = Object.freeze({
    disputedCents: 3_000,
    currency: 'INR',
    organizationId: 'org_rangoli',
    reference: 'DP-0001',
  })

  it('holds the money rather than removing it', () => {
    const batch = disputeOpenedBatch(DISPUTE)
    const held = batch.entries.find((line) => line.account === ACCOUNTS.DISPUTE_CLEARING)

    expect(held.direction).toBe(CREDIT)
    expect(batch.debitCents).toBe(DISPUTE.disputedCents)
  })

  it('returns the money to the organiser when it is won', () => {
    const batch = disputeResolvedBatch({ ...DISPUTE, won: true })
    const payable = batch.entries.find((line) => line.account === ACCOUNTS.ORGANIZER_PAYABLE)

    expect(payable.direction).toBe(CREDIT)
  })

  it('takes the money out of processor clearing when it is lost', () => {
    const batch = disputeResolvedBatch({ ...DISPUTE, won: false })
    const clearing = batch.entries.find((line) => line.account === ACCOUNTS.PROCESSOR_CLEARING)

    expect(clearing.direction).toBe(CREDIT)
    expect(batch.entries.some((line) => line.account === ACCOUNTS.ORGANIZER_PAYABLE)).toBe(false)
  })

  it('opening and winning cancel out exactly', () => {
    const opened = disputeOpenedBatch(DISPUTE)
    const won = disputeResolvedBatch({ ...DISPUTE, won: true })

    const net = new Map()

    for (const line of [...opened.entries, ...won.entries]) {
      const signed = line.direction === DEBIT ? line.amountCents : -line.amountCents

      net.set(line.account, (net.get(line.account) ?? 0) + signed)
    }

    for (const [account, amount] of net) expect(amount, account).toBe(0)
  })
})

describe('transfers and payouts', () => {
  const MOVE = Object.freeze({
    amountCents: 8_500,
    currency: 'INR',
    organizationId: 'org_rangoli',
    reference: 'TR-0001',
  })

  it('a transfer settles the payable into clearing', () => {
    const batch = transferBatch(MOVE)

    expect(batch.entries.find((l) => l.account === ACCOUNTS.ORGANIZER_PAYABLE).direction).toBe(
      DEBIT,
    )
    expect(batch.entries.find((l) => l.account === ACCOUNTS.TRANSFER_CLEARING).direction).toBe(
      CREDIT,
    )
  })

  it('a reversal puts it back', () => {
    const batch = transferReversalBatch(MOVE)

    expect(batch.entries.find((l) => l.account === ACCOUNTS.ORGANIZER_PAYABLE).direction).toBe(
      CREDIT,
    )
  })

  it('a payout moves it out of clearing, and a failure moves it back', () => {
    const paid = payoutBatch(MOVE)
    const failed = payoutBatch({ ...MOVE, failed: true })

    expect(paid.entries.find((l) => l.account === ACCOUNTS.PAYOUT_CLEARING).direction).toBe(DEBIT)
    expect(failed.entries.find((l) => l.account === ACCOUNTS.PAYOUT_CLEARING).direction).toBe(
      CREDIT,
    )
  })
})

describe('a correction', () => {
  it('flips every entry of the batch it corrects', () => {
    const original = orderPaidBatch(ORDER)
    const correction = correctionBatch(original, 'duplicate capture')

    expect(correction.kind).toBe(BATCH_KINDS.CORRECTION)
    expect(correction.entries).toHaveLength(original.entries.length)

    for (const [index, line] of correction.entries.entries()) {
      expect(line.account).toBe(original.entries[index].account)
      expect(line.amountCents).toBe(original.entries[index].amountCents)
      expect(line.direction).not.toBe(original.entries[index].direction)
    }
  })

  it('nets the original to nothing', () => {
    const original = orderPaidBatch(ORDER)
    const correction = correctionBatch(original, 'duplicate capture')
    const net = new Map()

    for (const line of [...original.entries, ...correction.entries]) {
      const signed = line.direction === DEBIT ? line.amountCents : -line.amountCents

      net.set(line.account, (net.get(line.account) ?? 0) + signed)
    }

    for (const [account, amount] of net) expect(amount, account).toBe(0)
  })

  it('records the reason on every line, because a correction with no reason is a mystery', () => {
    for (const line of correctionBatch(orderPaidBatch(ORDER), 'duplicate capture').entries) {
      expect(line.memo).toContain('duplicate capture')
    }
  })

  it('refuses to correct a batch with no entries', () => {
    expect(() => correctionBatch({ currency: 'INR', entries: [] }, 'why')).toThrow(
      /nothing to correct/,
    )
  })
})
