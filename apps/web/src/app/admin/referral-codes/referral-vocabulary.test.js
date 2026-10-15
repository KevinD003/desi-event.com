/**
 * The referral-code pages' words and their form's rules (SPEC3 §12.5,
 * SPEC3-XI §12.5): every column reads as the specification writes it, every
 * cause of a use given back has its words, the list's filters never carry a
 * code's text, and a change sends only what differs.
 *
 * @module app/admin/referral-codes/referral-vocabulary.test
 */

import { REFERRAL_RETURN_CAUSES } from '@desi-event/schemas/payment-terms'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_LIST,
  INTRODUCTION,
  LIST_NOTE,
  RETURN_CAUSE_WORDS,
  STATUS_FILTERS,
  copyLabel,
  makerName,
  readListFilters,
  referralFormRequest,
  returnedText,
  usesDetail,
  usesText,
  waivedText,
  worksForText,
} from './referral-vocabulary.js'

/** A moment to read "after now" against. */
const NOW = new Date('2026-10-12T12:00:00.000Z')

/**
 * Empty form values.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The values.
 */
function values(overrides = {}) {
  return {
    codeMode: 'GENERATE',
    referralCode: '',
    label: '',
    scope: 'ALL_EVENTS',
    events: [],
    eventsTouched: false,
    expires: '',
    maxUses: '',
    ...overrides,
  }
}

/** A code as `referralCodes.get` reads it. */
const CODE = Object.freeze({
  id: 'cref00000000000000000001',
  referralCode: 'PARTNER-2026',
  label: 'Rangoli partners',
  scope: 'SELECTED_EVENTS',
  events: [{ id: 'cevent0000000000000000001', title: 'Diwali Mela' }],
  eventCount: 1,
  expiresAt: '2026-12-31T23:00:00.000Z',
  maxUses: 100,
  updatedAt: '2026-10-10T09:00:00.000Z',
})

describe('what the pages say', () => {
  it('writes the introduction, the note and the empty list as the specification does', () => {
    expect(INTRODUCTION).toBe(
      'A referral code removes the whole booking fee from one order, and any tax charged on that fee. It never changes the ticket price or the tax on it. Anyone who has the code can use it.',
    )
    expect(LIST_NOTE).toBe(
      'Uses count orders placed with the code. When an order is refunded in full or cancelled, its use is given back, once. Nobody is paid for referrals.',
    )
    expect(EMPTY_LIST).toBe(
      'There are no referral codes. Make one to hand to a partner or a guest.',
    )
  })

  it('offers every status as a filter, in words', () => {
    expect(STATUS_FILTERS.map((each) => each.label)).toEqual([
      'Any status',
      'On',
      'Off',
      'Expired',
      'Used up',
    ])
  })

  it('says which events a code works for', () => {
    expect(worksForText({ scope: 'ALL_EVENTS' })).toBe('All events')
    expect(worksForText(CODE)).toBe('Diwali Mela')
    expect(worksForText({ scope: 'SELECTED_EVENTS', events: [], eventCount: 12 })).toBe('12 events')
  })

  it('writes the uses, and how many were placed and given back once any were', () => {
    expect(usesText({ useCount: 3, maxUses: 10 })).toBe('3 of 10')
    expect(usesText({ useCount: 1250, maxUses: null })).toBe('1,250')
    expect(usesDetail({ usesPlaced: 5, usesReturned: 0 })).toBeNull()
    expect(usesDetail({ usesPlaced: 5, usesReturned: 2 })).toBe('5 placed, 2 given back')
  })

  it('writes the fees waived per currency, and none', () => {
    expect(waivedText([])).toBe('None')
    expect(
      waivedText([
        { currency: 'USD', cents: 1240 },
        { currency: 'CAD', cents: 300 },
      ]),
    ).toBe('$12.40 USD and $3.00 CAD')
    expect(waivedText([{ currency: 'USD', cents: 331 }])).toBe('$3.31')
  })

  it('names a maker whose account is gone as a former administrator', () => {
    expect(makerName(null)).toBe('A former administrator')
    expect(makerName({ displayName: 'Anil' })).toBe('Anil')
  })

  it('names the copy button without the code itself', () => {
    expect(copyLabel({ label: 'Rangoli partners', referralCode: 'PARTNER-2026' })).toBe(
      'Copy code for Rangoli partners',
    )
    expect(copyLabel({ label: null, referralCode: 'PARTNER-2026' })).toBe('Copy referral code')
  })

  it('has words for every cause of a use given back, and a dash for a use that counts', () => {
    expect(Object.keys(RETURN_CAUSE_WORDS).sort()).toEqual([...REFERRAL_RETURN_CAUSES].sort())
    expect(RETURN_CAUSE_WORDS).toEqual({
      PAYMENT_FAILED: 'Payment did not go through',
      NOT_COMPLETED: 'Booking could not be completed',
      UNPAID_ORDER_CANCELLED: 'Not paid; cancelled',
      REFUNDED: 'Refunded in full',
      VENUE_UNPAID_CANCELLED: 'Unpaid tickets cancelled',
      EVENT_CANCELLED: 'Event cancelled',
      EVENT_DELETED: 'Event deleted',
      SESSION_CANCELLED: 'Night cancelled',
      TICKETS_REVOKED: 'Tickets withdrawn',
    })
    expect(returnedText({ useReturned: null })).toBe('—')
    expect(
      returnedText({ useReturned: { at: '2026-10-08T15:00:00.000Z', cause: 'REFUNDED' } }),
    ).toBe('Oct 8, 2026: Refunded in full')
  })
})

describe('the list’s filters', () => {
  it('keeps the filters the API takes, and drops anything else', () => {
    expect(
      readListFilters({
        status: 'USED_UP',
        creatorId: 'cuser0000000001',
        eventId: 'cevent000000001',
        page: '3',
        referralCode: 'PARTNER-2026',
      }),
    ).toEqual({
      status: 'USED_UP',
      creatorId: 'cuser0000000001',
      eventId: 'cevent000000001',
      page: 3,
    })
    expect(readListFilters({ status: 'MAYBE', creatorId: 'x', page: '-1' })).toEqual({
      status: undefined,
      creatorId: undefined,
      eventId: undefined,
      page: 1,
    })
  })
})

describe('making a code', () => {
  it('asks for a generated code for all events by default', () => {
    expect(referralFormRequest(values(), { mode: 'create', timeZone: 'UTC', now: NOW })).toEqual({
      errors: {},
      body: { generate: true, scope: 'ALL_EVENTS' },
    })
  })

  it('sends a typed code upper-cased, chosen events, an expiry in the zone and a limit', () => {
    const { body } = referralFormRequest(
      values({
        codeMode: 'TYPED',
        referralCode: ' partner-2026 ',
        label: ' Rangoli partners ',
        scope: 'SELECTED_EVENTS',
        events: [{ id: 'cevent0000000000000000001', title: 'Diwali Mela' }],
        expires: '2026-12-31T18:00',
        maxUses: '1,000',
      }),
      { mode: 'create', timeZone: 'America/Chicago', now: NOW },
    )

    expect(body).toEqual({
      referralCode: 'PARTNER-2026',
      label: 'Rangoli partners',
      scope: 'SELECTED_EVENTS',
      eventIds: ['cevent0000000000000000001'],
      expiresAt: '2027-01-01T00:00:00.000Z',
      maxUses: 1000,
    })
  })

  it('says what is wrong with each field, in the specification’s words', () => {
    const { errors, body } = referralFormRequest(
      values({
        codeMode: 'TYPED',
        referralCode: 'ab--cd',
        label: 'x'.repeat(121),
        scope: 'SELECTED_EVENTS',
        expires: '2026-10-01T10:00',
        maxUses: '0',
      }),
      { mode: 'create', timeZone: 'UTC', now: NOW },
    )

    expect(body).toBeNull()
    expect(errors).toEqual({
      referralCode:
        '6 to 32 letters, numbers or single hyphens, starting and ending with a letter or number.',
      label: '120 characters at most.',
      expires: 'Choose a time after now.',
      maxUses: 'From 1 to 1,000,000.',
      events: 'Choose at least one event.',
    })
  })

  it('refuses more than fifty events', () => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      id: `cevent${String(index).padStart(19, '0')}`,
      title: `Night ${index}`,
    }))

    expect(
      referralFormRequest(values({ scope: 'SELECTED_EVENTS', events }), {
        mode: 'create',
        timeZone: 'UTC',
        now: NOW,
      }).errors,
    ).toEqual({ events: 'Choose 50 events at most.' })
  })
})

describe('changing a code', () => {
  /**
   * The form as it starts for {@link CODE}.
   *
   * @param {object} [overrides] Fields to change.
   * @returns {object} The values.
   */
  function asRead(overrides = {}) {
    return values({
      label: CODE.label,
      scope: CODE.scope,
      events: CODE.events,
      expires: '2026-12-31T23:00',
      maxUses: '100',
      ...overrides,
    })
  }

  it('sends only what changed, with when the code was read', () => {
    expect(
      referralFormRequest(asRead({ maxUses: '250' }), {
        mode: 'edit',
        timeZone: 'UTC',
        now: NOW,
        code: CODE,
      }),
    ).toEqual({
      errors: {},
      body: { maxUses: 250, expectedUpdatedAt: CODE.updatedAt },
    })
  })

  it('removes a label, an expiry and a limit by sending null', () => {
    expect(
      referralFormRequest(asRead({ label: '', expires: '', maxUses: '' }), {
        mode: 'edit',
        timeZone: 'UTC',
        now: NOW,
        code: CODE,
      }).body,
    ).toEqual({
      label: null,
      expiresAt: null,
      maxUses: null,
      expectedUpdatedAt: CODE.updatedAt,
    })
  })

  it('sends the chosen events only when they were changed, and a switch to all events', () => {
    expect(
      referralFormRequest(
        asRead({
          events: [{ id: 'cevent0000000000000000002', title: 'Navratri' }],
          eventsTouched: true,
        }),
        { mode: 'edit', timeZone: 'UTC', now: NOW, code: CODE },
      ).body,
    ).toEqual({
      scope: 'SELECTED_EVENTS',
      eventIds: ['cevent0000000000000000002'],
      expectedUpdatedAt: CODE.updatedAt,
    })
    expect(
      referralFormRequest(asRead({ scope: 'ALL_EVENTS' }), {
        mode: 'edit',
        timeZone: 'UTC',
        now: NOW,
        code: CODE,
      }).body,
    ).toEqual({ scope: 'ALL_EVENTS', expectedUpdatedAt: CODE.updatedAt })
  })

  it('keeps an expiry already past when it was not touched, and says when nothing changed', () => {
    const expired = { ...CODE, expiresAt: '2026-10-01T10:00:00.000Z' }

    expect(
      referralFormRequest(asRead({ expires: '2026-10-01T10:00' }), {
        mode: 'edit',
        timeZone: 'UTC',
        now: NOW,
        code: expired,
      }),
    ).toEqual({
      errors: { form: 'Nothing has changed. Change something, then save.' },
      body: null,
    })
  })
})
