/**
 * What the booking-fee refund page says (SPEC3 §12.6, SPEC3-XI §12.6): the
 * introduction and the refusal as the specification writes them, a reference
 * read the way references are written, the share kept when unpaid tickets were
 * cancelled, and a refund that says it is simulated.
 *
 * @module app/admin/fee-refunds/fee-refund-vocabulary.test
 */

import { describe, expect, it } from 'vitest'

import {
  DISPUTED_NOTE,
  INTRODUCTION,
  MALFORMED_REFERENCE,
  NOT_FOR_THIS_ACCOUNT,
  NO_SUCH_ORDER,
  PAYMENT_METHOD_WORDS,
  keptSentence,
  readReference,
  refundButtonLabel,
  refundOutcome,
  refundableCents,
  refundedSentence,
} from './fee-refund-vocabulary.js'

describe('what the page says', () => {
  it('writes the introduction as the specification does', () => {
    expect(INTRODUCTION).toBe(
      'Refund the booking fee of one order. This refunds only the booking fee and any tax on it. It does not refund the ticket price, does not cancel the tickets and does not change the order’s status.',
    )
  })

  it('tells an account without the capability who refunds booking fees', () => {
    expect(NOT_FOR_THIS_ACCOUNT).toBe(
      'Booking fees are refunded by hand by the Desi-Event team’s platform, finance and super administrators. Nothing on this page can grant it.',
    )
  })

  it('names both ways of paying in words', () => {
    expect(PAYMENT_METHOD_WORDS).toEqual({ CARD: 'Card', AT_VENUE: 'At the venue' })
  })

  it('writes the refund as simulated, and never as money moved or promised for later', () => {
    const preview = { refundableFeeCents: 335, currency: 'USD' }

    expect(refundButtonLabel(preview)).toBe('Refund $3.35 booking fee (simulated)')
    expect(refundedSentence(335, 'USD')).toBe('Booking fee refunded (simulated): $3.35.')

    for (const sentence of [
      INTRODUCTION,
      NOT_FOR_THIS_ACCOUNT,
      MALFORMED_REFERENCE,
      NO_SUCH_ORDER,
      DISPUTED_NOTE,
      refundButtonLabel(preview),
      refundedSentence(335, 'USD'),
    ]) {
      expect(sentence).not.toMatch(/\b(soon|yet|planned)\b/iu)
      expect(sentence).not.toMatch(/\b(money moved|was paid out|sent to your)\b/iu)
    }
  })
})

describe('reading a reference', () => {
  it('trims and upper-cases what was typed', () => {
    expect(readReference('  de-7k2m-9qpx ')).toBe('DE-7K2M-9QPX')
    expect(readReference('ABCD')).toBe('ABCD')
  })

  it('refuses what is not in the form references take', () => {
    expect(readReference('')).toBeNull()
    expect(readReference('ABC')).toBeNull()
    expect(readReference('A'.repeat(33))).toBeNull()
    expect(readReference('DE 7K2M')).toBeNull()
    expect(readReference('DE/7K2M')).toBeNull()
    expect(readReference(null)).toBeNull()
    expect(MALFORMED_REFERENCE).toBe(
      'That order reference is not in the form references take — letters, digits and dashes, 4 to 32 of them.',
    )
  })
})

describe('the share kept when unpaid tickets were cancelled', () => {
  it('says what was kept and that it can’t be refunded', () => {
    expect(keptSentence({ feeKeptCents: 364, currency: 'USD' })).toBe(
      'Kept when unpaid tickets were cancelled: $3.64. It can’t be refunded.',
    )
  })

  it('says nothing when nothing was kept', () => {
    expect(keptSentence({ feeKeptCents: 0, currency: 'USD' })).toBeNull()
  })
})

describe('what can be refunded', () => {
  it('is the fee left and the tax on it together, as the API refunds and checks it', () => {
    const preview = { refundableFeeCents: 600, taxOnFeeCents: 78, currency: 'USD' }

    expect(refundableCents(preview)).toBe(678)
    expect(refundButtonLabel(preview)).toBe('Refund $6.78 booking fee (simulated)')
    expect(refundableCents({ refundableFeeCents: 335, taxOnFeeCents: 0 })).toBe(335)
    expect(refundableCents({ refundableFeeCents: 335 })).toBe(335)
  })
})

describe('what became of a refund that was sent', () => {
  it('says the refund went through only when it settled', () => {
    expect(refundOutcome({ status: 'SUCCEEDED', amountCents: 678 }, 600, 'USD')).toEqual({
      tone: 'success',
      title: null,
      sentence: 'Booking fee refunded (simulated): $6.78.',
    })
    expect(refundOutcome({ status: 'SUCCEEDED' }, 678, 'USD').sentence).toBe(
      'Booking fee refunded (simulated): $6.78.',
    )

    for (const status of [
      'DECLINED',
      'FAILED',
      'CANCELLED',
      'TIMEOUT',
      'RECONCILIATION_REQUIRED',
      'SUBMITTED',
      undefined,
    ]) {
      const said = refundOutcome(status ? { status, amountCents: 678 } : null, 678, 'USD')

      expect(said.tone).not.toBe('success')
      expect(said.sentence).not.toMatch(/Booking fee refunded/u)
    }
  })

  it('says nothing was refunded when the provider refused it or it failed', () => {
    for (const status of ['DECLINED', 'FAILED', 'CANCELLED']) {
      const said = refundOutcome({ status }, 678, 'USD')

      expect(said).toMatchObject({ tone: 'error', title: 'The booking fee was not refunded' })
      expect(said.sentence).toMatch(/nothing was refunded/u)
    }
  })

  it('says a refund the provider has not answered for has not settled, and keeps the fee set aside', () => {
    for (const status of ['TIMEOUT', 'RECONCILIATION_REQUIRED', 'SUBMITTED']) {
      const said = refundOutcome({ status }, 678, 'USD')

      expect(said).toMatchObject({
        tone: 'warning',
        title: 'The booking fee refund has not settled',
      })
      expect(said.sentence).toMatch(/whether the refund went through/u)
      expect(said.sentence).toMatch(/set aside/u)
    }
  })

  it('says every outcome is simulated, and never that money moved or will', () => {
    for (const status of ['SUCCEEDED', 'DECLINED', 'FAILED', 'TIMEOUT', 'SUBMITTED']) {
      const { title, sentence } = refundOutcome({ status, amountCents: 678 }, 678, 'USD')

      expect(sentence).toMatch(/simulated/u)
      expect(`${title ?? ''} ${sentence}`).not.toMatch(/\b(soon|yet|planned)\b/iu)
      expect(sentence).not.toMatch(/\b(money moved|was paid out|sent to your)\b/iu)
    }
  })
})
