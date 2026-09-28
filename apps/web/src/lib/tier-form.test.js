import { describe, expect, it } from 'vitest'

import { EVENT_CONTENT_LIMITS } from '@desi-event/schemas/event-content'

import {
  TIER_LIMITS,
  blankTierForm,
  diffTierBody,
  sessionLabel,
  tierFormProblems,
  toTierBody,
  toTierForm,
} from './tier-form.js'

const GA = {
  id: 'sga',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
  timezone: 'America/New_York',
  venueMapVersionId: null,
  priceZones: [],
}
const SEATED = {
  id: 'sseat',
  startsAt: '2027-10-05T23:00:00.000Z',
  endsAt: '2027-10-06T03:00:00.000Z',
  timezone: 'America/Chicago',
  venueMapVersionId: 'v1',
  priceZones: [{ id: 'z1', name: 'Stalls' }],
}

/**
 * A valid general-admission form.
 *
 * @param {object} [overrides] Values to change.
 * @returns {object} Form values.
 */
const valid = (overrides = {}) => ({
  ...blankTierForm(),
  name: 'General',
  price: '35.00',
  quantityTotal: '100',
  ...overrides,
})

/**
 * The fields a set of values is refused on.
 *
 * @param {object} values Form values.
 * @param {object} [context] The context.
 * @returns {string[]} Field names.
 */
const fields = (values, context) => tierFormProblems(values, context).map((entry) => entry.field)

describe('the limits', () => {
  it('match the ones the API holds a ticket type to', () => {
    expect(TIER_LIMITS.tierName).toBe(EVENT_CONTENT_LIMITS.tierName)
    expect(TIER_LIMITS.tierDescription).toBe(EVENT_CONTENT_LIMITS.tierDescription)
    expect(TIER_LIMITS.perOrderMax).toBe(EVENT_CONTENT_LIMITS.perOrderMax)
  })
})

describe('what the form refuses, as the server would', () => {
  it('passes a coherent tier', () => {
    expect(tierFormProblems(valid())).toEqual([])
  })

  it('refuses a missing or long name and a long description', () => {
    expect(fields(valid({ name: ' ' }))).toEqual(['name'])
    expect(fields(valid({ name: 'n'.repeat(121) }))).toEqual(['name'])
    expect(fields(valid({ description: 'd'.repeat(501) }))).toEqual(['description'])
  })

  it('refuses a price it cannot read', () => {
    expect(fields(valid({ price: '35.505' }))).toEqual(['price'])
    expect(fields(valid({ price: '-1' }))).toEqual(['price'])
  })

  it('holds per order to 1-50, least not above most', () => {
    expect(fields(valid({ maxPerOrder: '51' }))).toEqual(['maxPerOrder'])
    expect(fields(valid({ minPerOrder: '0' }))).toEqual(['minPerOrder'])
    expect(fields(valid({ minPerOrder: '6', maxPerOrder: '4' }))).toEqual(['minPerOrder'])
  })

  it('needs a quantity for general admission, and on a live event at least what is used', () => {
    expect(fields(valid({ quantityTotal: '' }))).toEqual(['quantityTotal'])
    expect(
      tierFormProblems(valid({ quantityTotal: '5' }), {
        mode: 'live',
        usage: { sold: 4, held: 3 },
      })[0].message,
    ).toMatch(/At least 7/)
    expect(
      fields(valid({ quantityTotal: '7' }), { mode: 'live', usage: { sold: 4, held: 3 } }),
    ).toEqual([])
  })

  it('needs a mapped session and a zone for reserved seating, and no quantity', () => {
    expect(
      fields(valid({ reserved: true, quantityTotal: '' }), { sessions: [GA, SEATED] }),
    ).toEqual(['eventSessionId', 'priceZoneId'])
    expect(
      fields(valid({ reserved: true, eventSessionId: 'sga' }), { sessions: [GA, SEATED] }),
    ).toEqual(['eventSessionId', 'priceZoneId'])
    expect(
      fields(
        valid({ reserved: true, eventSessionId: 'sseat', priceZoneId: 'z1', quantityTotal: '' }),
        {
          sessions: [GA, SEATED],
        },
      ),
    ).toEqual([])
  })

  it('orders the sales window and closes it before the session ends', () => {
    expect(
      fields(
        valid({ salesStartAt: '2027-09-02T00:00:00.000Z', salesEndAt: '2027-09-01T00:00:00.000Z' }),
      ),
    ).toEqual(['salesEndAt'])
    expect(
      fields(valid({ eventSessionId: 'sga', salesEndAt: '2027-10-06T00:00:00.000Z' }), {
        sessions: [GA],
      }),
    ).toEqual(['salesEndAt'])
  })

  it('keeps a complimentary tier hidden', () => {
    expect(fields(valid({ complimentary: true, visibility: 'PUBLIC' }))).toEqual(['visibility'])
    expect(fields(valid({ complimentary: true, visibility: 'HIDDEN', price: 'nonsense' }))).toEqual(
      [],
    )
  })
})

describe('the body it sends', () => {
  it('sends minor units, a null blank description, and no quantity for seats', () => {
    expect(toTierBody(valid({ price: '35.5', description: '  ' }))).toMatchObject({
      name: 'General',
      priceCents: 3550,
      description: null,
      quantityTotal: 100,
      visibility: 'PUBLIC',
      status: 'DRAFT',
    })
    expect(
      toTierBody(valid({ reserved: true, eventSessionId: 'sseat', priceZoneId: 'z1' })),
    ).toMatchObject({ reserved: true, quantityTotal: 0, priceZoneId: 'z1' })
    expect(toTierBody(valid({ complimentary: true, price: '12' }))).toMatchObject({
      priceCents: 0,
      visibility: 'HIDDEN',
      complimentary: true,
    })
  })

  it('reads a stored tier back into the same body', () => {
    const tier = {
      name: 'VIP',
      description: null,
      priceCents: 12_500,
      currency: 'USD',
      quantityTotal: 20,
      minPerOrder: 1,
      maxPerOrder: 4,
      eventSessionId: null,
      priceZoneId: null,
      reserved: false,
      complimentary: false,
      visibility: 'PUBLIC',
      salesStartAt: null,
      salesEndAt: '2027-09-30T03:59:00.000Z',
      sortOrder: 2,
      status: 'ON_SALE',
    }

    expect(toTierForm(tier).price).toBe('125.00')
    expect(diffTierBody(toTierForm(tier), toTierForm(tier))).toEqual({})
  })

  it('sends only what an edit changed', () => {
    const original = valid({ salesEndAt: '2027-09-30T03:59:00.000Z' })

    expect(diffTierBody(original, { ...original, name: 'General (standing)' })).toEqual({
      name: 'General (standing)',
    })
    expect(diffTierBody(original, { ...original, price: '32.50' })).toEqual({ priceCents: 3250 })
    // The same instant written differently is not a change.
    expect(diffTierBody(original, { ...original, salesEndAt: '2027-09-30T03:59:00Z' })).toEqual({})
  })
})

describe('a session in a select', () => {
  it('reads as a day and a time where it is held', () => {
    expect(sessionLabel(SEATED, 1)).toBe('Session 2 — Tue, Oct 5, 6:00 PM CDT')
    expect(sessionLabel({ ...GA, label: 'Night 1' }, 0)).toBe('Night 1 — Mon, Oct 4, 7:00 PM EDT')
  })
})
