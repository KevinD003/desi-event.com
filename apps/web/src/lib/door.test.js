import { ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  ANOTHER_STEWARD_PAID,
  LOOK_AGAIN,
  PAYMENT_NO_ANSWER,
  PAYMENT_REFUSALS,
  REFUSAL_HEADINGS,
  REFUSAL_SENTENCES,
  admitWithPaymentLabel,
  atVenueSentences,
  authorityLabel,
  bookingOwesSentence,
  confirmFailure,
  doorEventLabel,
  groupLookupSentence,
  groupResultSentence,
  groupPaymentLine,
  groupSessionName,
  handedOnUnpaidSentence,
  lookupFailure,
  paymentRecordedSentence,
  refusalHeading,
  refusalSentence,
  seatWords,
  takePaymentSentence,
  tonightOf,
} from './door.js'

describe('the refusal vocabulary', () => {
  it('has a sentence for every code the API can send, and no others', () => {
    // The mirror of a closed list is only as good as this assertion.
    expect(Object.keys(REFUSAL_SENTENCES).sort()).toEqual([...ADMISSION_REFUSAL_REASONS].sort())
  })

  it('falls back to a refusal, never to admission, for a code it does not know', () => {
    expect(refusalSentence('SOMETHING_NEW')).toMatch(/cannot be admitted/iu)
  })

  it('offers a fresh lookup only where one fixes it', () => {
    expect(confirmFailure(409, 'PREVIEW_EXPIRED').lookAgain).toBe(true)
    expect(confirmFailure(409, 'REFUNDED').lookAgain).toBe(false)
    expect(LOOK_AGAIN.every((code) => code in REFUSAL_SENTENCES)).toBe(true)
  })
})

describe('what a steward is told', () => {
  it('says an unanswered confirmation may or may not have admitted, and that retrying is safe', () => {
    const told = confirmFailure(0)

    expect(told.uncertain).toBe(true)
    expect(told.sentence).toMatch(/may or may not/iu)
    expect(told.sentence).toMatch(/cannot be admitted twice/iu)
  })

  it('tells a 404 apart from nothing: it does not say which of the two it was', () => {
    expect(lookupFailure(404)).toMatch(/no ticket matches/iu)
    expect(lookupFailure(404)).not.toMatch(/another organi[sz]ation|not assigned to this/iu)
  })

  it('names the authority a door rests on', () => {
    expect(
      authorityLabel({
        authority: 'ORGANIZATION_ROLE',
        role: 'OWNER',
        organization: { name: 'Rangoli' },
      }),
    ).toBe('Every event of Rangoli (owner)')
    expect(authorityLabel({ authority: 'EVENT_SCOPE', role: 'SCANNER' })).toBe(
      'Assigned to this event (scanner)',
    )
  })

  it('puts a seat into words, and says nothing for general admission', () => {
    expect(seatWords({ section: 'Stalls', row: 'C', label: 'C12' })).toBe('Stalls, row C, seat C12')
    expect(seatWords(null)).toBeNull()
  })
})

describe('the group door', () => {
  it('offers a fresh lookup when a group changed under the confirmation', () => {
    expect(LOOK_AGAIN).toContain('GROUP_CHANGED')
    expect(confirmFailure(409, 'GROUP_CHANGED')).toMatchObject({ lookAgain: true })
    expect(refusalSentence('GROUP_CHANGED')).toMatch(/look it up again before admitting anyone/iu)
  })

  it('names platform authority plainly', () => {
    expect(authorityLabel({ authority: 'PLATFORM_ROLE', role: 'SUPER_ADMIN' })).toBe(
      'Any event on the platform (platform administrator)',
    )
  })

  it('says what a group lookup found, in the singular and the plural', () => {
    expect(
      groupLookupSentence({ counts: { admissible: 3, alreadyIn: 0, refused: 0 }, handedOn: 0 }),
    ).toBe('3 tickets can be admitted.')
    expect(
      groupLookupSentence({ counts: { admissible: 1, alreadyIn: 2, refused: 1 }, handedOn: 1 }),
    ).toBe(
      '1 ticket can be admitted, 2 already in, 1 refused. 1 ticket from this order was handed to somebody else; they have their own pass.',
    )
    expect(
      groupLookupSentence({ counts: { admissible: 0, alreadyIn: 0, refused: 0 }, handedOn: 2 }),
    ).toBe(
      '0 tickets can be admitted. 2 tickets from this order were handed to other people; they have their own passes.',
    )
  })

  it('says what a group admission did', () => {
    expect(groupResultSentence({ admitted: 2, alreadyIn: 0 })).toBe('Admitted 2.')
    expect(groupResultSentence({ admitted: 1, alreadyIn: 1 })).toBe('Admitted 1. 1 was already in.')
    expect(groupResultSentence({ admitted: 0, alreadyIn: 3 })).toBe(
      'Admitted 0. 3 were already in.',
    )
  })

  it('names a group in the session list by the people on it, never as a ticket with no name', () => {
    expect(groupSessionName([{ attendeeName: 'Asha' }])).toBe('Asha')
    expect(
      groupSessionName([
        { attendeeName: 'Asha' },
        { attendeeName: 'Ravi' },
        { attendeeName: null },
      ]),
    ).toBe('Asha and 2 more')
    expect(groupSessionName([{ attendeeName: null }, { attendeeName: 'Ravi' }])).toBe(
      'Ravi and 1 more',
    )
    expect(groupSessionName([{ attendeeName: null }, { attendeeName: null }])).toBe('Group pass')
    expect(groupSessionName([])).toBe('Group pass')
  })

  it('names the organisation beside an event only when asked to', () => {
    const entry = {
      event: {
        title: 'Garba Night',
        startsAt: '2026-10-01T13:30:00.000Z',
        timezone: 'America/New_York',
      },
      organization: { name: 'Rangoli' },
    }

    expect(doorEventLabel(entry)).toMatch(/^Garba Night — Oct 1, 2026/u)
    expect(doorEventLabel(entry, { withOrganization: true })).toMatch(
      /^Garba Night — Rangoli — Oct 1, 2026/u,
    )
  })
})

describe('the night a door starts on', () => {
  const night = (id, day, status = 'ON_SALE') => ({
    id,
    startsAt: `2026-10-0${day}T13:30:00.000Z`,
    endsAt: `2026-10-0${day}T18:30:00.000Z`,
    status,
  })
  const NIGHTS = [night('one', 1), night('two', 2), night('three', 3)]

  it('is the night running now, else the next one, else the last', () => {
    expect(tonightOf(NIGHTS, new Date('2026-10-01T15:00:00.000Z'))).toBe('one')
    expect(tonightOf(NIGHTS, new Date('2026-10-01T20:00:00.000Z'))).toBe('two')
    expect(tonightOf(NIGHTS, new Date('2026-09-20T00:00:00.000Z'))).toBe('one')
    expect(tonightOf(NIGHTS, new Date('2026-10-09T00:00:00.000Z'))).toBe('three')
  })

  it('passes over a cancelled night, and is nothing when there are no nights', () => {
    const withCancelled = [night('one', 1, 'CANCELLED'), night('two', 2)]

    expect(tonightOf(withCancelled, new Date('2026-10-01T15:00:00.000Z'))).toBe('two')
    expect(tonightOf([], new Date())).toBe('')
  })

  it('tells a steward what a night refusal means', () => {
    expect(refusalSentence('WRONG_NIGHT')).toMatch(/different night\. Do not admit/u)
    expect(refusalSentence('NIGHT_REQUIRED')).toMatch(/Choose the night you are admitting to/u)
    expect(confirmFailure(409, 'NIGHT_REQUIRED').lookAgain).toBe(false)
  })
})

describe('money at the door (SPEC3 §12.8, SPEC3-XI §12.8)', () => {
  it('names a ticket cancelled unpaid, in a heading and a sentence of its own', () => {
    expect(refusalHeading('UNPAID_CANCELLED')).toBe('Cancelled — not paid')
    expect(refusalSentence('UNPAID_CANCELLED')).toBe(
      "This ticket was cancelled because it had not been paid for. Don't let it in.",
    )
    expect(refusalHeading('REFUNDED')).toBeNull()
    expect(Object.keys(REFUSAL_HEADINGS).every((code) => code in REFUSAL_SENTENCES)).toBe(true)
  })

  it('says what to take, in the order’s currency', () => {
    expect(takePaymentSentence(4000, 'USD')).toBe(
      'Take $40.00 for this ticket before letting them in.',
    )
  })

  it('counts the same holder’s other unpaid tickets, and suggests the group pass only when it covers them', () => {
    expect(
      bookingOwesSentence(
        { otherUnpaidTickets: 2, otherUnpaidCents: 8000, groupPass: true },
        'USD',
      ),
    ).toBe(
      'This booking has 2 more tickets to pay at the door ($80.00). Use the group pass to take payment for several at once.',
    )
    expect(
      bookingOwesSentence(
        { otherUnpaidTickets: 1, otherUnpaidCents: 4000, groupPass: false },
        'USD',
      ),
    ).toBe('This booking has 1 more ticket to pay at the door ($40.00).')
    expect(
      bookingOwesSentence({ otherUnpaidTickets: 0, otherUnpaidCents: 0, groupPass: true }, 'USD'),
    ).toBeNull()
    expect(bookingOwesSentence(null, 'USD')).toBeNull()
  })

  it('says how many of the booking’s tickets other people pay for with their own', () => {
    expect(handedOnUnpaidSentence(1)).toBe(
      '1 more ticket of this booking was passed on to other people, who pay at the door with their own ticket.',
    )
    expect(handedOnUnpaidSentence(3)).toBe(
      '3 more tickets of this booking were passed on to other people, who pay at the door with their own tickets.',
    )
    expect(handedOnUnpaidSentence(0)).toBeNull()
  })

  it('labels the one step that takes the payment and admits, and its retry', () => {
    expect(admitWithPaymentLabel('$40.00')).toBe('Payment taken: $40.00 — admit')
    expect(admitWithPaymentLabel('$40.00', { retry: true })).toBe(
      'Retry: payment taken $40.00 — admit',
    )
    expect(admitWithPaymentLabel('$80.00', { count: 2 })).toBe('Payment taken: $80.00 — admit 2')
    expect(groupPaymentLine('$80.00')).toBe('Payment to take for the ticked tickets: $80.00')
    expect(paymentRecordedSentence('$40.00')).toBe('Admitted. Payment recorded: $40.00.')
    expect(paymentRecordedSentence('$40.00', { retried: true })).toBe(
      'Admitted (confirmed on retry). Payment recorded: $40.00.',
    )
    expect(ANOTHER_STEWARD_PAID).toBe(
      'Already admitted by another steward. Their payment record covers this ticket; do not take the money again.',
    )
  })

  it('says an unanswered payment as money that may or may not be recorded, and that a retry cannot record it twice', () => {
    const told = confirmFailure(0, null, { payment: true })

    expect(told.uncertain).toBe(true)
    expect(told.sentence).toBe(PAYMENT_NO_ANSWER)
    expect(told.sentence).toMatch(/Keep the money in hand/u)
    expect(told.sentence).toMatch(/cannot record the payment twice/u)
    // Without a payment, the sentence is the admission's.
    expect(confirmFailure(0).sentence).toMatch(/cannot be admitted twice/u)
  })

  it('says a payment refusal in the API’s own words and offers a fresh lookup', () => {
    for (const code of PAYMENT_REFUSALS) {
      const told = confirmFailure(code === 'PAYMENT_AMOUNT_MISMATCH' ? 422 : 409, null, {
        code,
        message: `The API said ${code}.`,
      })

      expect(told).toEqual({
        sentence: `The API said ${code}.`,
        lookAgain: true,
        uncertain: false,
        reason: code,
      })
    }

    // No sentence arrived: still a refusal, never an admission.
    expect(confirmFailure(409, null, { code: 'PAYMENT_DUE' }).sentence).toMatch(
      /before letting it in/u,
    )
  })

  it('keeps the refused admission’s reason, so the card can name it', () => {
    expect(confirmFailure(409, 'UNPAID_CANCELLED')).toMatchObject({
      reason: 'UNPAID_CANCELLED',
      lookAgain: false,
    })
  })

  it('says what cancelling or deleting means for bookings paid at the venue', () => {
    expect(atVenueSentences({ orders: 0, ticketsPaidAtDoor: 0, paidAtDoorCents: 0 })).toEqual([])
    expect(atVenueSentences(undefined)).toEqual([])
    expect(atVenueSentences({ orders: 2, ticketsPaidAtDoor: 0, paidAtDoorCents: 0 })).toEqual([
      'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
    ])
    expect(
      atVenueSentences({ orders: 2, ticketsPaidAtDoor: 3, paidAtDoorCents: 12000 }, 'USD'),
    ).toEqual([
      'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
      'Payment taken at the door for 3 of these tickets ($120.00) is held by the organiser. Desi-Event does not hold it and cannot refund it.',
    ])
    // Where nothing is refunded, only the door money is said.
    expect(
      atVenueSentences({ orders: 2, ticketsPaidAtDoor: 3, paidAtDoorCents: 12000 }, 'USD', {
        refunds: false,
      }),
    ).toEqual([
      'Payment taken at the door for 3 of these tickets ($120.00) is held by the organiser. Desi-Event does not hold it and cannot refund it.',
    ])
  })
})
