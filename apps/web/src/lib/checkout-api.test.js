/**
 * Paying at the venue and referral codes in the checkout's API calls and
 * words (SPEC3 §6.5, §12.1; SPEC3-XI §12.1).
 *
 * The bodies carry the payment method only when it is not the default, the
 * referral code only in the body, and the door figure as a precondition only
 * for a pay-at-the-venue order; the Pay button, the announcements and the
 * changed-before-Pay notices say what the specification writes.
 *
 * @module lib/checkout-api.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('./api-fetch.js')
const {
  AT_VENUE,
  CARD,
  REFERRAL_WITHDRAWN_SENTENCE,
  VENUE_REFUSAL_CODES,
  VENUE_SWITCHED_OFF_SENTENCE,
  VENUE_UNAVAILABLE_ANNOUNCEMENT,
  feeTermsChanged,
  payButtonLabel,
  paymentParts,
  placeOrderThroughApi,
  priceChangedNotice,
  quoteThroughApi,
  totalUpdatedAnnouncement,
  venuePaymentOffered,
  venueRefusalSentence,
} = await import('./checkout-api.js')

/**
 * A successful response.
 *
 * @param {object} data The body's `data`.
 * @returns {object} A Response-shaped stub.
 */
function ok(data) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data }) }
}

/**
 * The body the last `apiFetch` call sent.
 *
 * @returns {object} The parsed body.
 */
function sentBody() {
  return JSON.parse(apiFetch.mock.calls.at(-1)[1].body)
}

/**
 * A quote.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The quote.
 */
function quote(overrides = {}) {
  return {
    currency: 'USD',
    subtotalCents: 4000,
    discountCents: 0,
    feesCents: 331,
    taxCents: 0,
    totalCents: 4331,
    paymentMethod: CARD,
    venueDueCents: 0,
    fee: { percentageBps: 450, flatCentsPerTicket: 75 },
    venuePayment: { available: true },
    ...overrides,
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue(ok({}))
})

describe('the quote and order bodies', () => {
  it('sends no payment method for a card quote, and AT_VENUE when the buyer chose it', async () => {
    await quoteThroughApi({ eventId: 'e1', lines: [{ ticketTypeId: 't1', quantity: 2 }] })
    expect(sentBody()).not.toHaveProperty('paymentMethod')
    expect(sentBody()).not.toHaveProperty('referralCode')

    await quoteThroughApi({
      eventId: 'e1',
      lines: [{ ticketTypeId: 't1', quantity: 2 }],
      paymentMethod: AT_VENUE,
      referralCode: 'PARTNER-2026',
    })
    expect(sentBody()).toMatchObject({ paymentMethod: 'AT_VENUE', referralCode: 'PARTNER-2026' })
    // The code travels in the body, never in the address.
    expect(apiFetch.mock.calls.at(-1)[0]).toBe('/v1/orders/quote')
  })

  it('sends the door figure as a precondition only for a pay-at-the-venue order', async () => {
    const base = {
      eventId: 'e1',
      buyer: { name: 'Asha', email: 'asha@example.test' },
      lines: [{ ticketTypeId: 't1', quantity: 1 }],
      holdIds: ['h1'],
      idempotencyKey: 'k1',
      expectedTotalCents: 331,
    }

    await placeOrderThroughApi({ ...base, paymentMethod: CARD, expectedVenueDueCents: 4000 })
    expect(sentBody()).not.toHaveProperty('paymentMethod')
    expect(sentBody()).not.toHaveProperty('expectedVenueDueCents')

    await placeOrderThroughApi({
      ...base,
      paymentMethod: AT_VENUE,
      expectedVenueDueCents: 4000,
      referralCode: 'PARTNER-2026',
    })
    expect(sentBody()).toMatchObject({
      paymentMethod: 'AT_VENUE',
      expectedVenueDueCents: 4000,
      expectedTotalCents: 331,
      referralCode: 'PARTNER-2026',
    })
    expect(apiFetch.mock.calls.at(-1)[0]).toBe('/v1/orders')
  })
})

describe('whether paying at the venue is offered', () => {
  it('follows the latest quote, and the event before anything is held', () => {
    expect(venuePaymentOffered({ quote: quote() })).toBe(true)
    expect(venuePaymentOffered({ quote: quote({ venuePayment: { available: false } }) })).toBe(
      false,
    )
    expect(venuePaymentOffered({ quote: quote({ paymentMethod: AT_VENUE }) })).toBe(true)
    expect(
      venuePaymentOffered({
        quote: null,
        event: { venuePayment: { available: true } },
        estimate: { subtotalCents: 4000, discountCents: 0 },
      }),
    ).toBe(true)
    expect(
      venuePaymentOffered({
        quote: null,
        event: { venuePayment: { available: false } },
        estimate: { subtotalCents: 4000 },
      }),
    ).toBe(false)
  })

  it('is not offered when a promo leaves no ticket price to pay at the door', () => {
    expect(venuePaymentOffered({ quote: quote({ discountCents: 4000 }) })).toBe(false)
    expect(
      venuePaymentOffered({
        quote: null,
        event: { venuePayment: { available: true } },
        estimate: { subtotalCents: 0, discountCents: 0 },
      }),
    ).toBe(false)
  })
})

describe('the Pay button', () => {
  it('reads each way of paying as SPEC3 §12.1 writes it', () => {
    expect(payButtonLabel(null)).toBe('Pay (simulated)')
    expect(payButtonLabel(quote())).toBe('Pay $43.31 (simulated)')
    expect(
      payButtonLabel(quote({ paymentMethod: AT_VENUE, totalCents: 331, venueDueCents: 4000 })),
    ).toBe('Pay booking fee $3.31 (simulated)')
    expect(
      payButtonLabel(quote({ paymentMethod: AT_VENUE, totalCents: 0, venueDueCents: 4000 })),
    ).toBe('Book now — pay $40.00 at the door')
  })

  it('splits what is paid online from what is paid at the door', () => {
    expect(paymentParts(quote())).toEqual({ atVenue: false, online: 4331, due: 0 })
    expect(
      paymentParts(quote({ paymentMethod: AT_VENUE, totalCents: 331, venueDueCents: 4000 })),
    ).toEqual({ atVenue: true, online: 331, due: 4000 })
  })

  it('announces a pay-at-the-venue total, and nothing for a card one', () => {
    expect(totalUpdatedAnnouncement(quote())).toBe('')
    expect(
      totalUpdatedAnnouncement(
        quote({ paymentMethod: AT_VENUE, totalCents: 331, venueDueCents: 4000 }),
      ),
    ).toBe('Total updated: pay now $3.31, at the door $40.00.')
  })
})

describe('a price that changed before Pay', () => {
  it('is urgent when the administrators changed the booking fee', () => {
    const before = quote()
    const after = quote({ fee: { percentageBps: 500, flatCentsPerTicket: 75 }, feesCents: 350 })

    expect(feeTermsChanged(before, after)).toBe(true)
    expect(priceChangedNotice(before, after)).toEqual({
      urgent: true,
      title: 'The booking fee changed',
      sentence:
        'The booking fee for this event changed while you were booking. It is now $3.50. Nothing has been charged. Check the new total, then pay.',
    })
    expect(
      priceChangedNotice(before, {
        ...after,
        paymentMethod: AT_VENUE,
        totalCents: 350,
        venueDueCents: 4000,
      }).sentence,
    ).toBe(
      'The booking fee for this event changed while you were booking. Pay now $3.50, at the door $40.00. Nothing has been charged. Check the summary, then confirm.',
    )
  })

  it('is today’s polite notice when the price moved for another reason', () => {
    const before = quote()
    const after = quote({ totalCents: 4500 })

    expect(feeTermsChanged(before, after)).toBe(false)
    expect(priceChangedNotice(before, after)).toEqual({
      urgent: false,
      title: 'The total changed',
      sentence: 'The total is now $45.00. Nothing was charged. Check the summary and pay again.',
    })
  })
})

describe('paying at the venue refused at Pay', () => {
  it('says the switch’s own sentence, and the API’s for the others', () => {
    expect([...VENUE_REFUSAL_CODES].sort()).toEqual([
      'NOTHING_TO_PAY_AT_VENUE',
      'VENUE_PAYMENT_FULL',
      'VENUE_PAYMENT_OFF',
      'VENUE_PAYMENT_UNAVAILABLE',
    ])
    expect(venueRefusalSentence({ code: 'VENUE_PAYMENT_OFF', message: 'whatever' })).toBe(
      VENUE_SWITCHED_OFF_SENTENCE,
    )
    expect(
      venueRefusalSentence({
        code: 'VENUE_PAYMENT_FULL',
        message: 'Paying at the venue is full for this event. You can still pay by card.',
      }),
    ).toBe('Paying at the venue is full for this event. You can still pay by card.')
    expect(
      venueRefusalSentence({ code: 'VENUE_PAYMENT_FULL', message: 'The API answered 409.' }),
    ).toBe(
      'Paying at the venue is not available for this booking now. Nothing has been charged. The total is now for paying by card.',
    )
  })

  it('writes every sentence without promising later or moving money', () => {
    for (const sentence of [
      VENUE_UNAVAILABLE_ANNOUNCEMENT,
      VENUE_SWITCHED_OFF_SENTENCE,
      REFERRAL_WITHDRAWN_SENTENCE,
    ]) {
      expect(sentence).not.toMatch(/\b(soon|yet|planned)\b/iu)
      expect(sentence).not.toMatch(/\b(charged you|was paid|money moved)\b/iu)
    }
  })
})
