import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ADMISSION_REFUSAL_REASONS,
  ORDER_PAYMENT_METHODS,
  REFERRAL_USE_RETURN_CAUSES,
} from './enums.js'
import {
  FEE_LIMITS,
  GENERATED_REFERRAL_CODE_PATTERN,
  PAYMENT_METHODS,
  PAYMENT_TERMS_MESSAGES,
  PLACES_ON_SALE,
  REASON_DESCRIPTION,
  REASON_LIMITS,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_PATTERN,
  REFERRAL_LIMITS,
  REFERRAL_QUOTE_REASONS,
  REFERRAL_RETURN_CAUSES,
  REFERRAL_STATUSES,
  VENUE_CANCELLED_BY,
  VENUE_CANCEL_LIMITS,
  VENUE_CANCEL_REASON_DESCRIPTION,
  VENUE_PAYMENT_LIMITS,
  VENUE_PAYMENT_STATES,
  admissionPaymentSchema,
  cancelUnpaidVenueTicketsRequestSchema,
  createReferralCodeRequestSchema,
  doorPaymentRequestSchema,
  feeTermsViewSchema,
  groupAdmissionPaymentSchema,
  listReferralCodesQuerySchema,
  orderTaxViewSchema,
  orderVenueCancellationSchema,
  orderVenuePaymentSchema,
  paymentMethodSchema,
  paymentTermsQuerySchema,
  paymentTermsViewSchema,
  platformFeeRefundRequestSchema,
  quoteReferralSchema,
  reasonSchema,
  referralCodeEntrySchema,
  referralCodeStringSchema,
  setPlatformFeeRequestSchema,
  setVenuePaymentRequestSchema,
  switchOffReferralCodeRequestSchema,
  ticketVenuePaymentSchema,
  updateReferralCodeRequestSchema,
  venueBookingTicketSchema,
  venueBookingsQuerySchema,
} from './payment-terms.js'

const here = path.dirname(fileURLToPath(import.meta.url))

/** A cuid-shaped id, distinct per seed. */
const id = (seed) => `c${String(seed).padStart(24, '0')}`

/** A reason that passes: ten characters exactly. */
const REASON = 'Partner rt'

/**
 * The messages a failed parse reported.
 *
 * @param {object} result A failed `safeParse` result.
 * @returns {string[]} The messages.
 */
const messages = (result) => result.error.issues.map((issue) => issue.message)

describe('the limits SPEC3 §4.6 names', () => {
  it('holds the fee, the venue, the referral and the reason bounds exactly', () => {
    expect(FEE_LIMITS).toEqual({ maxPercentageBps: 3000, maxFlatCentsPerTicket: 10000 })
    // No per-account limit (open question 1): only the event's own.
    expect(VENUE_PAYMENT_LIMITS).toEqual({ maxEventLimit: 100000, suggestedEventLimit: 50 })
    expect(REFERRAL_LIMITS).toEqual({
      minLength: 6,
      maxLength: 32,
      maxEvents: 50,
      maxUses: 1000000,
      labelMax: 120,
    })
    expect(REASON_LIMITS).toEqual({ min: 10, max: 500 })
    expect(REFERRAL_QUOTE_REASONS).toEqual(['NOT_ACCEPTED', 'NOTHING_TO_WAIVE'])
    expect(REFERRAL_STATUSES).toEqual(['ON', 'OFF', 'EXPIRED', 'USED_UP'])
  })

  it('has no per-account key in the venue limits (the owner’s answer to open question 1)', () => {
    expect(Object.keys(VENUE_PAYMENT_LIMITS).sort()).toEqual([
      'maxEventLimit',
      'suggestedEventLimit',
    ])
    expect(Object.keys(VENUE_PAYMENT_LIMITS).some((key) => /buyer|account|user/i.test(key))).toBe(
      false,
    )
  })
})

describe('the vocabulary SPEC3-XI §4.6 names', () => {
  it('caps a cancellation at 100 tickets', () => {
    expect(VENUE_CANCEL_LIMITS).toEqual({ maxTickets: 100 })
    expect(Object.isFrozen(VENUE_CANCEL_LIMITS)).toBe(true)
  })

  it('reads a booking in five states, by precedence', () => {
    expect(VENUE_PAYMENT_STATES).toEqual(['TO_PAY', 'PAID', 'PASSED_ON', 'CANCELLED', 'NONE'])
  })

  it('gives every cause a use can come back for, NOT_COMPLETED included, as the database names them', () => {
    expect(REFERRAL_RETURN_CAUSES).toEqual([
      'PAYMENT_FAILED',
      'NOT_COMPLETED',
      'UNPAID_ORDER_CANCELLED',
      'REFUNDED',
      'VENUE_UNPAID_CANCELLED',
      'EVENT_CANCELLED',
      'EVENT_DELETED',
      'SESSION_CANCELLED',
      'TICKETS_REVOKED',
    ])
    expect([...REFERRAL_RETURN_CAUSES]).toEqual([...REFERRAL_USE_RETURN_CAUSES])
  })

  it('says all, some or none of the freed places are on sale, never a yes or no', () => {
    expect(PLACES_ON_SALE).toEqual(['ALL', 'SOME', 'NONE'])
    expect(VENUE_CANCELLED_BY).toEqual(['ORGANISER', 'DESI_EVENT'])
  })

  it('refuses a ticket cancelled unpaid at the door with its own reason', () => {
    expect(ADMISSION_REFUSAL_REASONS).toContain('UNPAID_CANCELLED')
  })

  it('names the payment methods the database enum does, and nothing else', () => {
    expect(Object.values(PAYMENT_METHODS)).toEqual([...ORDER_PAYMENT_METHODS])
    expect(paymentMethodSchema.options).toEqual([...ORDER_PAYMENT_METHODS])
    expect(Object.isFrozen(PAYMENT_METHODS)).toBe(true)
  })

  it('carries the free-text reason description word for word (SPEC2-XI §0.8)', () => {
    expect(REASON_DESCRIPTION).toBe(
      "Shown with the event's history. Do not include anybody's personal details.",
    )
  })
})

describe('the referral alphabet', () => {
  it('leaves out every letter or digit a code read aloud is mistyped as', () => {
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(REFERRAL_ALPHABET).not.toContain(confusable)
    }

    expect(new Set(REFERRAL_ALPHABET).size).toBe(REFERRAL_ALPHABET.length)
    expect(REFERRAL_ALPHABET).toMatch(/^[A-Z2-9]+$/u)
  })

  it('describes a generated code as two groups of five from that alphabet', () => {
    expect(GENERATED_REFERRAL_CODE_PATTERN.test('ABCDE-23456')).toBe(true)
    expect(GENERATED_REFERRAL_CODE_PATTERN.test('ABCDE-2345O')).toBe(false)
    expect(GENERATED_REFERRAL_CODE_PATTERN.test('ABCDE23456')).toBe(false)

    // Every letter of the alphabet is admitted by the pattern, and only those.
    for (const letter of REFERRAL_ALPHABET) {
      expect(GENERATED_REFERRAL_CODE_PATTERN.test(`${letter.repeat(5)}-AAAAA`), letter).toBe(true)
    }

    for (const letter of ['0', 'O', '1', 'I', 'L']) {
      expect(GENERATED_REFERRAL_CODE_PATTERN.test(`${letter.repeat(5)}-AAAAA`), letter).toBe(false)
    }

    // A generated code is also a stored code.
    expect(REFERRAL_CODE_PATTERN.test('ABCDE-23456')).toBe(true)
  })
})

describe('reasonSchema', () => {
  it('takes 10 to 500 characters once trimmed', () => {
    expect(reasonSchema.parse(`  ${REASON}  `)).toBe(REASON)
    expect(reasonSchema.safeParse('x'.repeat(500)).success).toBe(true)

    const short = reasonSchema.safeParse('  123456789  ')

    expect(short.success).toBe(false)
    expect(messages(short)).toContain(PAYMENT_TERMS_MESSAGES.reasonShort)

    const long = reasonSchema.safeParse('x'.repeat(501))

    expect(long.success).toBe(false)
    expect(messages(long)).toContain(PAYMENT_TERMS_MESSAGES.reasonLong)
  })

  it('refuses a control character', () => {
    expect(reasonSchema.safeParse(`Partner\u0000 rate`).success).toBe(false)
    expect(reasonSchema.safeParse(`Partner\u0085 rate`).success).toBe(false)
  })
})

describe('setPlatformFeeRequestSchema', () => {
  it('returns an event to the site default with a reason and the sequence read', () => {
    expect(
      setPlatformFeeRequestSchema.parse({
        source: 'SITE_DEFAULT',
        reason: REASON,
        expectedSequence: 0,
      }),
    ).toEqual({ source: 'SITE_DEFAULT', reason: REASON, expectedSequence: 0 })
  })

  it('sets an event its own percentage and amount, either of which may be 0', () => {
    for (const [percentageBps, flatCentsPerTicket] of [
      [0, 0],
      [3000, 10000],
      [250, 0],
      [0, 149],
    ]) {
      expect(
        setPlatformFeeRequestSchema.safeParse({
          source: 'EVENT',
          percentageBps,
          flatCentsPerTicket,
          reason: REASON,
          expectedSequence: 4,
        }).success,
      ).toBe(true)
    }
  })

  it('refuses numbers past the bounds, fractions and negatives with the form sentence', () => {
    const body = { source: 'EVENT', reason: REASON, expectedSequence: 0 }

    for (const [percentageBps, flatCentsPerTicket, message] of [
      [3001, 0, PAYMENT_TERMS_MESSAGES.percentage],
      [-1, 0, PAYMENT_TERMS_MESSAGES.percentage],
      [12.5, 0, PAYMENT_TERMS_MESSAGES.percentage],
      [0, 10001, PAYMENT_TERMS_MESSAGES.amount],
      [0, -1, PAYMENT_TERMS_MESSAGES.amount],
      [0, 1.5, PAYMENT_TERMS_MESSAGES.amount],
    ]) {
      const result = setPlatformFeeRequestSchema.safeParse({
        ...body,
        percentageBps,
        flatCentsPerTicket,
      })

      expect(result.success, `${percentageBps}/${flatCentsPerTicket}`).toBe(false)
      expect(messages(result)).toContain(message)
    }
  })

  it('takes no currency: an event’s own fee is in the currency it sells in (DF3)', () => {
    expect(
      setPlatformFeeRequestSchema.safeParse({
        source: 'EVENT',
        percentageBps: 300,
        flatCentsPerTicket: 149,
        currency: 'USD',
        reason: REASON,
        expectedSequence: 0,
      }).success,
    ).toBe(false)
  })

  it('needs the reason and the sequence read, and refuses numbers on a site-default body', () => {
    expect(
      setPlatformFeeRequestSchema.safeParse({ source: 'SITE_DEFAULT', reason: REASON }).success,
    ).toBe(false)
    expect(
      setPlatformFeeRequestSchema.safeParse({ source: 'SITE_DEFAULT', expectedSequence: 0 })
        .success,
    ).toBe(false)
    expect(
      setPlatformFeeRequestSchema.safeParse({
        source: 'SITE_DEFAULT',
        percentageBps: 0,
        reason: REASON,
        expectedSequence: 0,
      }).success,
    ).toBe(false)
    expect(
      setPlatformFeeRequestSchema.safeParse({
        source: 'SITE_DEFAULT',
        reason: REASON,
        expectedSequence: 2_147_483_648,
      }).success,
    ).toBe(false)
    expect(
      setPlatformFeeRequestSchema.safeParse({ source: 'PARTNER', reason: REASON }).success,
    ).toBe(false)
  })
})

describe('setVenuePaymentRequestSchema', () => {
  const seen = { enabled: false, limit: null }

  it('needs a limit to switch paying at the venue on', () => {
    const result = setVenuePaymentRequestSchema.safeParse({ enabled: true, seen, reason: REASON })

    expect(result.success).toBe(false)
    expect(result.error.issues[0].path).toEqual(['limit'])
    expect(messages(result)).toContain(PAYMENT_TERMS_MESSAGES.limitRequired)

    expect(
      setVenuePaymentRequestSchema.safeParse({ enabled: true, limit: 50, seen, reason: REASON })
        .success,
    ).toBe(true)
  })

  it('switches it off without a limit, keeping the one it had', () => {
    expect(
      setVenuePaymentRequestSchema.safeParse({
        enabled: false,
        seen: { enabled: true, limit: 50 },
        reason: REASON,
      }).success,
    ).toBe(true)
  })

  it('holds the limit to 1 to 100,000 whole tickets', () => {
    for (const limit of [0, 100001, 2.5]) {
      const result = setVenuePaymentRequestSchema.safeParse({
        enabled: true,
        limit,
        seen,
        reason: REASON,
      })

      expect(result.success, String(limit)).toBe(false)
      expect(messages(result)).toContain(PAYMENT_TERMS_MESSAGES.limit)
    }

    expect(
      setVenuePaymentRequestSchema.safeParse({ enabled: true, limit: 100000, seen, reason: REASON })
        .success,
    ).toBe(true)
  })

  it('needs what the administrator saw, and a reason of 10 characters', () => {
    expect(
      setVenuePaymentRequestSchema.safeParse({ enabled: true, limit: 5, reason: REASON }).success,
    ).toBe(false)
    expect(
      setVenuePaymentRequestSchema.safeParse({ enabled: true, limit: 5, seen, reason: 'short' })
        .success,
    ).toBe(false)
    expect(
      setVenuePaymentRequestSchema.safeParse({
        enabled: true,
        limit: 5,
        seen,
        reason: REASON,
        cash: true,
      }).success,
    ).toBe(false)
  })
})

describe('referralCodeStringSchema', () => {
  it('trims and upper-cases what an administrator types', () => {
    expect(referralCodeStringSchema.parse('  garba-2026  ')).toBe('GARBA-2026')
    expect(referralCodeStringSchema.parse('abcdef')).toBe('ABCDEF')
  })

  it('takes 6 to 32 characters, beginning and ending with a letter or digit', () => {
    expect(referralCodeStringSchema.safeParse('ABCDE').success).toBe(false)
    expect(referralCodeStringSchema.safeParse('ABCDEF').success).toBe(true)
    expect(referralCodeStringSchema.safeParse('A'.repeat(32)).success).toBe(true)
    expect(referralCodeStringSchema.safeParse('A'.repeat(33)).success).toBe(false)
    expect(referralCodeStringSchema.safeParse('-ABCDEF').success).toBe(false)
    expect(referralCodeStringSchema.safeParse('ABCDEF-').success).toBe(false)
  })

  it('refuses a double hyphen, a space and punctuation, with the form sentence', () => {
    for (const value of ['GARBA--2026', 'GARBA 2026', 'GARBA_2026', 'GARBA.2026']) {
      const result = referralCodeStringSchema.safeParse(value)

      expect(result.success, value).toBe(false)
      expect(messages(result)).toContain(PAYMENT_TERMS_MESSAGES.referralCode)
    }
  })

  it('refuses rather than folds a character outside ASCII', () => {
    // `ı`.toUpperCase() is `I` and `ß` becomes `SS`: folded, either would pass.
    expect(referralCodeStringSchema.safeParse('garbaı2026').success).toBe(false)
    expect(referralCodeStringSchema.safeParse('straße26').success).toBe(false)
    expect(referralCodeStringSchema.safeParse('ＧＡＲＢＡ２６').success).toBe(false)
  })

  it('refuses something that is not a string', () => {
    expect(referralCodeStringSchema.safeParse(123456).success).toBe(false)
  })
})

describe('referralCodeEntrySchema', () => {
  it('takes any 1 to 64 characters, so a malformed code is not a 400 of its own', () => {
    expect(referralCodeEntrySchema.parse('  !!  ')).toBe('!!')
    expect(referralCodeEntrySchema.safeParse('a--b').success).toBe(true)
    expect(referralCodeEntrySchema.safeParse('x'.repeat(64)).success).toBe(true)
    expect(referralCodeEntrySchema.safeParse('x'.repeat(65)).success).toBe(false)
    expect(referralCodeEntrySchema.safeParse('   ').success).toBe(false)
  })

  it('refuses a control character', () => {
    expect(referralCodeEntrySchema.safeParse('GARBA\n2026').success).toBe(false)
  })
})

describe('createReferralCodeRequestSchema', () => {
  const allEvents = { referralCode: 'garba-2026', scope: 'ALL_EVENTS' }

  it('takes a typed code for every event, normalised', () => {
    expect(createReferralCodeRequestSchema.parse(allEvents)).toEqual({
      referralCode: 'GARBA-2026',
      scope: 'ALL_EVENTS',
    })
  })

  it('takes exactly one of a typed code or generate: true', () => {
    expect(
      createReferralCodeRequestSchema.safeParse({ generate: true, scope: 'ALL_EVENTS' }).success,
    ).toBe(true)
    expect(createReferralCodeRequestSchema.safeParse({ scope: 'ALL_EVENTS' }).success).toBe(false)
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, generate: true }).success,
    ).toBe(false)
    expect(
      createReferralCodeRequestSchema.safeParse({ generate: false, scope: 'ALL_EVENTS' }).success,
    ).toBe(false)
  })

  it('names 1 to 50 distinct events for, and only for, a code for selected events', () => {
    const selected = { generate: true, scope: 'SELECTED_EVENTS' }

    expect(createReferralCodeRequestSchema.safeParse(selected).success).toBe(false)
    expect(createReferralCodeRequestSchema.safeParse({ ...selected, eventIds: [] }).success).toBe(
      false,
    )
    expect(
      createReferralCodeRequestSchema.safeParse({ ...selected, eventIds: [id(1)] }).success,
    ).toBe(true)
    expect(
      createReferralCodeRequestSchema.safeParse({
        ...selected,
        eventIds: Array.from({ length: 50 }, (_, index) => id(index)),
      }).success,
    ).toBe(true)

    const tooMany = createReferralCodeRequestSchema.safeParse({
      ...selected,
      eventIds: Array.from({ length: 51 }, (_, index) => id(index)),
    })

    expect(tooMany.success).toBe(false)
    expect(messages(tooMany)).toContain(PAYMENT_TERMS_MESSAGES.eventsTooMany)

    expect(
      createReferralCodeRequestSchema.safeParse({ ...selected, eventIds: [id(1), id(1)] }).success,
    ).toBe(false)
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, eventIds: [id(1)] }).success,
    ).toBe(false)
  })

  it('bounds the label and the limit, and refuses what it does not know', () => {
    expect(
      createReferralCodeRequestSchema.safeParse({
        ...allEvents,
        label: 'Partner: Dallas Garba Society',
        maxUses: 1_000_000,
        expiresAt: '2027-01-01T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, label: 'x'.repeat(121) }).success,
    ).toBe(false)
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, label: 'a\u0007b' }).success,
    ).toBe(false)
    expect(createReferralCodeRequestSchema.safeParse({ ...allEvents, maxUses: 0 }).success).toBe(
      false,
    )
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, maxUses: 1_000_001 }).success,
    ).toBe(false)
    expect(
      createReferralCodeRequestSchema.safeParse({ ...allEvents, percentOff: 100 }).success,
    ).toBe(false)
    expect(createReferralCodeRequestSchema.safeParse({ ...allEvents, code: 'X' }).success).toBe(
      false,
    )
  })
})

describe('updateReferralCodeRequestSchema', () => {
  const expectedUpdatedAt = '2026-10-01T10:00:00.000Z'

  it('changes the label, the expiry or the limit, and null removes each', () => {
    expect(
      updateReferralCodeRequestSchema.safeParse({ label: null, expectedUpdatedAt }).success,
    ).toBe(true)
    expect(
      updateReferralCodeRequestSchema.safeParse({ expiresAt: null, expectedUpdatedAt }).success,
    ).toBe(true)
    expect(
      updateReferralCodeRequestSchema.safeParse({ maxUses: null, expectedUpdatedAt }).success,
    ).toBe(true)
  })

  it('needs at least one change and when the code was read', () => {
    expect(updateReferralCodeRequestSchema.safeParse({ expectedUpdatedAt }).success).toBe(false)
    expect(updateReferralCodeRequestSchema.safeParse({ label: 'Campaign' }).success).toBe(false)
  })

  it('never changes the text', () => {
    expect(
      updateReferralCodeRequestSchema.safeParse({ referralCode: 'OTHER-CODE', expectedUpdatedAt })
        .success,
    ).toBe(false)
  })

  it('keeps the scope and its events consistent', () => {
    expect(
      updateReferralCodeRequestSchema.safeParse({ scope: 'SELECTED_EVENTS', expectedUpdatedAt })
        .success,
    ).toBe(false)
    expect(
      updateReferralCodeRequestSchema.safeParse({
        scope: 'SELECTED_EVENTS',
        eventIds: [id(1), id(2)],
        expectedUpdatedAt,
      }).success,
    ).toBe(true)
    expect(
      updateReferralCodeRequestSchema.safeParse({
        scope: 'ALL_EVENTS',
        eventIds: [id(1)],
        expectedUpdatedAt,
      }).success,
    ).toBe(false)
    expect(
      updateReferralCodeRequestSchema.safeParse({ eventIds: [id(1)], expectedUpdatedAt }).success,
    ).toBe(true)
    expect(
      updateReferralCodeRequestSchema.safeParse({ eventIds: [id(1), id(1)], expectedUpdatedAt })
        .success,
    ).toBe(false)
  })
})

describe('switching a code off', () => {
  it('takes an optional reason of 10 to 500 characters to switch off', () => {
    expect(switchOffReferralCodeRequestSchema.safeParse({}).success).toBe(true)
    expect(switchOffReferralCodeRequestSchema.safeParse({ reason: REASON }).success).toBe(true)
    expect(switchOffReferralCodeRequestSchema.safeParse({ reason: 'leaked' }).success).toBe(false)
  })
})

describe('listReferralCodesQuerySchema', () => {
  it('filters by status, maker and event', () => {
    expect(
      listReferralCodesQuerySchema.parse({
        status: 'USED_UP',
        creatorId: id(1),
        eventId: id(2),
        page: '2',
      }),
    ).toMatchObject({ status: 'USED_UP', creatorId: id(1), eventId: id(2), page: 2 })
    expect(listReferralCodesQuerySchema.safeParse({ status: 'ACTIVE' }).success).toBe(false)
  })

  it('never carries a code’s text, which stays out of every URL', () => {
    const parsed = listReferralCodesQuerySchema.parse({ referralCode: 'GARBA-2026', q: 'GARBA' })

    expect(parsed).not.toHaveProperty('referralCode')
    expect(parsed).not.toHaveProperty('q')
  })
})

describe('platformFeeRefundRequestSchema', () => {
  it('needs a reason and the refundable amount the administrator was shown', () => {
    expect(
      platformFeeRefundRequestSchema.safeParse({ reason: REASON, expectedRefundableCents: 335 })
        .success,
    ).toBe(true)
    expect(platformFeeRefundRequestSchema.safeParse({ reason: REASON }).success).toBe(false)
    expect(
      platformFeeRefundRequestSchema.safeParse({ reason: 'oops', expectedRefundableCents: 335 })
        .success,
    ).toBe(false)
    expect(
      platformFeeRefundRequestSchema.safeParse({
        reason: REASON,
        expectedRefundableCents: 335,
        amountCents: 100,
      }).success,
    ).toBe(false)
  })
})

describe('paymentTermsQuerySchema', () => {
  it('takes an instant to read older history before, and nothing else', () => {
    expect(paymentTermsQuerySchema.parse({ before: '2026-10-01T10:00:00Z' })).toEqual({
      before: '2026-10-01T10:00:00Z',
    })
    expect(paymentTermsQuerySchema.parse({})).toEqual({})
    expect(paymentTermsQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false)
    expect(paymentTermsQuerySchema.safeParse({ before: '0000-01-01T00:00:00Z' }).success).toBe(
      false,
    )
    expect(paymentTermsQuerySchema.safeParse({ limit: '500' }).success).toBe(false)
  })
})

describe('doorPaymentRequestSchema', () => {
  it('takes a whole positive amount and nothing else', () => {
    expect(doorPaymentRequestSchema.parse({ amountCents: 2500 })).toEqual({ amountCents: 2500 })
    expect(doorPaymentRequestSchema.safeParse({ amountCents: 0 }).success).toBe(false)
    expect(doorPaymentRequestSchema.safeParse({ amountCents: 25.5 }).success).toBe(false)
    expect(doorPaymentRequestSchema.safeParse({ amountCents: 2500, method: 'CASH' }).success).toBe(
      false,
    )
  })
})

describe('the views responses are built from', () => {
  const fee = {
    source: 'EVENT',
    percentageBps: 300,
    flatCentsPerTicket: 149,
    currency: 'USD',
    sequence: 2,
    changedAt: '2026-10-01T10:00:00.000Z',
    changedByName: 'Anil',
    reason: REASON,
  }
  const venuePayment = {
    enabled: true,
    limit: 50,
    offered: true,
    changedAt: null,
    changedByName: null,
    reason: null,
    hasOrders: false,
    unpaidTickets: 0,
    paidAtDoorTickets: 0,
    paidAtDoorCents: 0,
  }

  it('reads an event’s terms with the site default beside them', () => {
    expect(feeTermsViewSchema.safeParse(fee).success).toBe(true)
    expect(
      paymentTermsViewSchema.safeParse({
        fee,
        siteDefault: { currency: 'USD', percentageBps: 250, flatCentsPerTicket: 99 },
        venuePayment,
      }).success,
    ).toBe(true)
    expect(feeTermsViewSchema.safeParse({ ...fee, source: 'PARTNER' }).success).toBe(false)
  })

  it('tells the door what to take, or that it was paid on an earlier night', () => {
    expect(
      admissionPaymentSchema.safeParse({
        dueCents: 2500,
        currency: 'USD',
        paid: false,
        booking: { otherUnpaidTickets: 1, otherUnpaidCents: 2500, groupPass: true },
      }).success,
    ).toBe(true)
    // The same holder's other tickets and whether the group pass covers them
    // (SPEC3-XI §9.3): a booking without `groupPass` is not a shape the door acts on.
    expect(
      admissionPaymentSchema.safeParse({
        dueCents: 2500,
        currency: 'USD',
        paid: false,
        booking: { otherUnpaidTickets: 1, otherUnpaidCents: 2500 },
      }).success,
    ).toBe(false)
    expect(
      admissionPaymentSchema.safeParse({ dueCents: 2500, currency: 'USD', paid: true }).success,
    ).toBe(true)
    // Unpaid without the rest of the booking is not a shape the door can act on.
    expect(
      admissionPaymentSchema.safeParse({ dueCents: 2500, currency: 'USD', paid: false }).success,
    ).toBe(false)
    expect(
      admissionPaymentSchema.safeParse({ dueCents: 0, currency: 'USD', paid: true }).success,
    ).toBe(false)
  })

  it('says why tax was not charged only with a reason it knows', () => {
    expect(
      orderTaxViewSchema.safeParse({
        applied: false,
        appliedTo: 'NOTHING',
        notAppliedReason: 'PAID_AT_VENUE',
      }).success,
    ).toBe(true)
    expect(
      orderTaxViewSchema.safeParse({
        applied: true,
        appliedTo: 'TICKETS_AND_FEE',
        notAppliedReason: null,
      }).success,
    ).toBe(true)
    expect(
      orderTaxViewSchema.safeParse({ applied: false, appliedTo: 'NOTHING', notAppliedReason: 'X' })
        .success,
    ).toBe(false)
  })

  it('answers a referral code with applied and a reason, never the code', () => {
    expect(quoteReferralSchema.parse({ applied: false, reason: 'NOT_ACCEPTED' })).toEqual({
      applied: false,
      reason: 'NOT_ACCEPTED',
    })
    expect(
      quoteReferralSchema.parse({ applied: true, reason: null, referralCode: 'GARBA-2026' }),
    ).not.toHaveProperty('referralCode')
    expect(quoteReferralSchema.safeParse({ applied: false, reason: 'EXPIRED' }).success).toBe(false)
  })

  it('reads a pay-at-the-venue order’s state in the five words the buyer is shown', () => {
    const state = {
      dueCents: 5000,
      paidCents: 2500,
      unpaidTickets: 1,
      unpaidCents: 2500,
      paidTickets: 1,
      paidByOthersTickets: 0,
      paidByOthersCents: 0,
      passedOnUnpaidTickets: 0,
      passedOnUnpaidCents: 0,
      cancelledTickets: 0,
      cancelledCents: 0,
      feeKeptCents: 0,
    }

    for (const word of ['TO_PAY', 'PAID', 'PASSED_ON', 'CANCELLED', 'NONE']) {
      expect(orderVenuePaymentSchema.safeParse({ ...state, state: word }).success).toBe(true)
    }

    expect(orderVenuePaymentSchema.safeParse({ ...state, state: 'CASH' }).success).toBe(false)
    expect(Object.keys(orderVenuePaymentSchema.shape).some((key) => /tax/i.test(key))).toBe(false)
  })

  it('tells the buyer who cancelled, never by name unless an organisation reads it', () => {
    const cancellation = {
      at: '2026-10-09T10:00:00.000Z',
      by: 'ORGANISER',
      ticketCount: 2,
      basisCents: 9000,
      feeKeptCents: 729,
      reason: 'Not paid before the doors opened.',
    }

    expect(orderVenueCancellationSchema.parse(cancellation)).toEqual(cancellation)
    expect(orderVenueCancellationSchema.safeParse({ ...cancellation, by: 'FINANCE' }).success).toBe(
      false,
    )
    expect(
      orderVenueCancellationSchema.safeParse({ ...cancellation, ticketCount: 101 }).success,
    ).toBe(false)
  })

  it('tells a ticket’s holder it was cancelled and why, and whether they paid it at the door', () => {
    const view = {
      dueCents: 4500,
      paid: false,
      currency: 'USD',
      cancelled: {
        at: '2026-10-09T10:00:00.000Z',
        by: 'DESI_EVENT',
        reason: 'Not paid for at the door by the end of the night.',
      },
      paidAtDoorByYou: false,
    }

    expect(ticketVenuePaymentSchema.parse(view)).toEqual(view)
    expect(ticketVenuePaymentSchema.safeParse({ ...view, cancelled: null }).success).toBe(true)
    // The reason travels with every cancellation a holder reads: somebody the
    // ticket was passed to has no order page to read it on (SPEC3-XI XU10).
    expect(
      ticketVenuePaymentSchema.safeParse({
        ...view,
        cancelled: { at: view.cancelled.at, by: view.cancelled.by },
      }).success,
    ).toBe(false)
    expect(
      ticketVenuePaymentSchema.safeParse({ ...view, paidAtDoorByYou: undefined }).success,
    ).toBe(false)
  })

  it('lists a booking’s ticket for the cancel dialog, cancellable or over', () => {
    const ticket = {
      ticketId: id(1),
      label: 'Ticket 2 of 3',
      attendeeName: 'Guest Two',
      nightLabel: 'Night 2',
      everyNight: false,
      dueCents: 4000,
      heldBy: 'SOMEONE_ELSE',
      offerPending: true,
      cancellable: false,
      notCancellable: 'NIGHT_OVER',
    }

    expect(venueBookingTicketSchema.safeParse(ticket).success).toBe(true)
    expect(venueBookingTicketSchema.safeParse({ ...ticket, dueCents: 0 }).success).toBe(false)
    expect(venueBookingTicketSchema.safeParse({ ...ticket, notCancellable: 'PAID' }).success).toBe(
      false,
    )
  })

  it('counts, at a group door, the booking’s tickets other people hold that still owe', () => {
    expect(
      groupAdmissionPaymentSchema.safeParse({
        dueCents: 4000,
        currency: 'USD',
        handedOnUnpaidTickets: 1,
      }).success,
    ).toBe(true)
    expect(groupAdmissionPaymentSchema.safeParse({ dueCents: 4000, currency: 'USD' }).success).toBe(
      false,
    )
  })
})

describe('cancelUnpaidVenueTicketsRequestSchema (SPEC3-XI XU10)', () => {
  const ids = (count, start = 1) => Array.from({ length: count }, (_, index) => id(start + index))
  const REASON_TEN = 'Never paid'

  it('takes 1 to 100 distinct tickets and a reason of 10 to 500 characters', () => {
    expect(
      cancelUnpaidVenueTicketsRequestSchema.safeParse({ ticketIds: ids(1), reason: REASON_TEN })
        .success,
    ).toBe(true)
    expect(
      cancelUnpaidVenueTicketsRequestSchema.safeParse({ ticketIds: ids(100), reason: REASON_TEN })
        .success,
    ).toBe(true)
  })

  it('refuses no tickets, 101 tickets and a ticket named twice', () => {
    const none = cancelUnpaidVenueTicketsRequestSchema.safeParse({
      ticketIds: [],
      reason: REASON_TEN,
    })

    expect(none.success).toBe(false)
    expect(messages(none)).toContain('Choose at least one ticket.')
    expect(
      cancelUnpaidVenueTicketsRequestSchema.safeParse({ ticketIds: ids(101), reason: REASON_TEN })
        .success,
    ).toBe(false)

    const twice = cancelUnpaidVenueTicketsRequestSchema.safeParse({
      ticketIds: [id(1), id(2), id(1)],
      reason: REASON_TEN,
    })

    expect(twice.success).toBe(false)
    expect(messages(twice)).toContain('Name each ticket once.')
  })

  it('takes a reason of 10 and 500 characters and refuses 9 and 501', () => {
    for (const [reason, ok] of [
      ['x'.repeat(9), false],
      ['x'.repeat(10), true],
      ['x'.repeat(500), true],
      ['x'.repeat(501), false],
    ]) {
      expect(
        cancelUnpaidVenueTicketsRequestSchema.safeParse({ ticketIds: ids(1), reason }).success,
        `${reason.length} characters`,
      ).toBe(ok)
    }
  })

  it('refuses any other field, and a reason with a control character', () => {
    expect(
      cancelUnpaidVenueTicketsRequestSchema.safeParse({
        ticketIds: ids(1),
        reason: REASON_TEN,
        orderId: id(9),
      }).success,
    ).toBe(false)
    expect(
      cancelUnpaidVenueTicketsRequestSchema.safeParse({
        ticketIds: ids(1),
        reason: 'Not paid\u0000 at all',
      }).success,
    ).toBe(false)
  })

  it('describes the reason as shown to the buyer and the holders', () => {
    expect(VENUE_CANCEL_REASON_DESCRIPTION).toBe(
      "Shown to the buyer and to anybody holding these tickets. Do not include anybody's personal details. At least 10 characters.",
    )
  })
})

describe('venueBookingsQuerySchema', () => {
  it('takes a page and, for the cancel dialog, one booking by its reference', () => {
    expect(venueBookingsQuerySchema.parse({}).page).toBe(1)
    expect(venueBookingsQuerySchema.parse({ order: 'de-abcdefgh' }).order).toBe('DE-ABCDEFGH')
    expect(venueBookingsQuerySchema.safeParse({ order: 'not a reference' }).success).toBe(false)
  })
})

describe('the browser subpath', () => {
  it('imports only zod and primitives.js, so a client form may use it', () => {
    const source = readFileSync(path.join(here, 'payment-terms.js'), 'utf8')
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(imports.sort()).toEqual(['./primitives.js', 'zod'])
  })

  it('is exported as @desi-event/schemas/payment-terms', () => {
    const manifest = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))

    expect(manifest.exports['./payment-terms']).toBe('./src/payment-terms.js')
  })

  it('never names a field `code`: a referral code’s text travels as `referralCode`', () => {
    const source = readFileSync(path.join(here, 'payment-terms.js'), 'utf8')

    expect(source).not.toMatch(/^\s+code:\s*(?:z\.|[a-z]+Schema)/mu)
  })
})
