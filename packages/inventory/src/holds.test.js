import { describe, it, expect } from 'vitest'

import {
  holdExpiresAt,
  isHoldExpired,
  partitionExpiredHolds,
  activeHeldQuantity,
} from './holds.js'
import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
import { HOLD_STATUS } from './constants.js'

const NOW = new Date('2026-05-01T12:00:00.000Z')

/**
 * @param {string} status Hold status.
 * @param {number} quantity Tickets reserved.
 * @param {number} offsetMs Milliseconds from NOW at which the hold expires.
 * @returns {object} A hold fixture.
 */
function hold(status, quantity, offsetMs) {
  return { id: `h-${status}-${offsetMs}`, status, quantity, expiresAt: new Date(NOW.getTime() + offsetMs) }
}

describe('holdExpiresAt', () => {
  it('adds the TTL to now', () => {
    expect(holdExpiresAt(NOW, 900).toISOString()).toBe('2026-05-01T12:15:00.000Z')
  })

  it('returns a Date', () => {
    expect(holdExpiresAt(NOW, 60)).toBeInstanceOf(Date)
  })

  it('does not mutate the Date it was given', () => {
    const now = new Date(NOW.getTime())
    holdExpiresAt(now, 600)
    expect(now.toISOString()).toBe(NOW.toISOString())
  })

  it('accepts epoch milliseconds', () => {
    expect(holdExpiresAt(NOW.getTime(), 1).getTime()).toBe(NOW.getTime() + 1000)
  })

  it('accepts an ISO string', () => {
    expect(holdExpiresAt('2026-05-01T12:00:00.000Z', 30).toISOString())
      .toBe('2026-05-01T12:00:30.000Z')
  })

  it('rounds a fractional TTL to the nearest millisecond', () => {
    expect(holdExpiresAt(NOW, 0.0015).getTime()).toBe(NOW.getTime() + 2)
  })

  it('accepts a one-second TTL', () => {
    expect(holdExpiresAt(NOW, 1).getTime()).toBe(NOW.getTime() + 1000)
  })

  it.each([
    ['zero', 0],
    ['negative', -60],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '900'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects a %s TTL', (_label, ttl) => {
    expect(() => holdExpiresAt(NOW, ttl))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_TTL }))
  })

  it('rejects an unusable now', () => {
    expect(() => holdExpiresAt('whenever', 900))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }))
  })
})

describe('isHoldExpired', () => {
  it('is false a millisecond before expiry', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, 1), NOW)).toBe(false)
  })

  it('is true at exactly the expiry instant', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, 0), NOW)).toBe(true)
  })

  it('is true a millisecond after expiry', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, -1), NOW)).toBe(true)
  })

  it('is true long after expiry', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, -86_400_000), NOW)).toBe(true)
  })

  it('reports a hold already recorded EXPIRED as expired whatever its timestamp says', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.EXPIRED, 1, 60_000), NOW)).toBe(true)
  })

  it('never expires a hold with no expiresAt', () => {
    expect(isHoldExpired({ status: HOLD_STATUS.ACTIVE, quantity: 1, expiresAt: null }, NOW))
      .toBe(false)
  })

  it('never expires a hold whose expiresAt is absent', () => {
    expect(isHoldExpired({ status: HOLD_STATUS.ACTIVE, quantity: 1 }, NOW)).toBe(false)
  })

  it('accepts an ISO string expiresAt', () => {
    expect(isHoldExpired({ status: HOLD_STATUS.ACTIVE, expiresAt: '2026-05-01T11:59:59.999Z' }, NOW))
      .toBe(true)
  })

  it('accepts epoch milliseconds for now', () => {
    expect(isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, -1), NOW.getTime())).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'hold-1'],
    ['an array', []],
  ])('rejects %s as a hold', (_label, value) => {
    expect(() => isHoldExpired(value, NOW))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_HOLD }))
  })

  it('rejects an unparseable expiresAt', () => {
    expect(() => isHoldExpired({ status: HOLD_STATUS.ACTIVE, expiresAt: 'soon' }, NOW))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }))
  })

  it('rejects a missing now', () => {
    expect(() => isHoldExpired(hold(HOLD_STATUS.ACTIVE, 1, 60_000)))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }))
  })
})

describe('partitionExpiredHolds', () => {
  it('returns three empty buckets for an empty list', () => {
    expect(partitionExpiredHolds([], NOW)).toEqual({ expired: [], active: [], inactive: [] })
  })

  it('splits live ACTIVE holds from lapsed ACTIVE holds', () => {
    const live = hold(HOLD_STATUS.ACTIVE, 2, 60_000)
    const lapsed = hold(HOLD_STATUS.ACTIVE, 3, -60_000)

    const { expired, active, inactive } = partitionExpiredHolds([live, lapsed], NOW)

    expect(active).toEqual([live])
    expect(expired).toEqual([lapsed])
    expect(inactive).toEqual([])
  })

  it('puts a hold expiring exactly now in the expired bucket', () => {
    const due = hold(HOLD_STATUS.ACTIVE, 1, 0)
    expect(partitionExpiredHolds([due], NOW).expired).toEqual([due])
  })

  it.each([HOLD_STATUS.CONVERTED, HOLD_STATUS.RELEASED, HOLD_STATUS.EXPIRED])(
    'never sweeps a %s hold, even one long past its expiresAt',
    (status) => {
      // Expiring a converted hold would rewrite a paid order's history.
      const settled = hold(status, 5, -86_400_000)
      const { expired, active, inactive } = partitionExpiredHolds([settled], NOW)

      expect(expired).toEqual([])
      expect(active).toEqual([])
      expect(inactive).toEqual([settled])
    },
  )

  it.each([HOLD_STATUS.CONVERTED, HOLD_STATUS.RELEASED, HOLD_STATUS.EXPIRED])(
    'treats a %s hold with a future expiresAt as inactive too',
    (status) => {
      const settled = hold(status, 5, 600_000)
      expect(partitionExpiredHolds([settled], NOW).inactive).toEqual([settled])
    },
  )

  it('treats an unrecognised status as inactive rather than as stock-holding', () => {
    const odd = { id: 'h-odd', status: 'PENDING_REVIEW', quantity: 4, expiresAt: null }
    expect(partitionExpiredHolds([odd], NOW).inactive).toEqual([odd])
  })

  it('handles every status at once', () => {
    const holds = [
      hold(HOLD_STATUS.ACTIVE, 1, 60_000),
      hold(HOLD_STATUS.ACTIVE, 2, -60_000),
      hold(HOLD_STATUS.CONVERTED, 4, -60_000),
      hold(HOLD_STATUS.RELEASED, 8, -60_000),
      hold(HOLD_STATUS.EXPIRED, 16, -60_000),
    ]

    const { expired, active, inactive } = partitionExpiredHolds(holds, NOW)

    expect(active.map((h) => h.quantity)).toEqual([1])
    expect(expired.map((h) => h.quantity)).toEqual([2])
    expect(inactive.map((h) => h.quantity)).toEqual([4, 8, 16])
  })

  it('preserves input order within each bucket', () => {
    const holds = [
      hold(HOLD_STATUS.ACTIVE, 1, 10_000),
      hold(HOLD_STATUS.ACTIVE, 2, 20_000),
      hold(HOLD_STATUS.ACTIVE, 3, 30_000),
    ]
    expect(partitionExpiredHolds(holds, NOW).active.map((h) => h.quantity)).toEqual([1, 2, 3])
  })

  it('does not mutate the input array', () => {
    const holds = [hold(HOLD_STATUS.ACTIVE, 1, 60_000), hold(HOLD_STATUS.ACTIVE, 2, -1)]
    const snapshot = [...holds]
    partitionExpiredHolds(holds, NOW)
    expect(holds).toEqual(snapshot)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', { 0: hold(HOLD_STATUS.ACTIVE, 1, 1) }],
    ['a string', 'holds'],
  ])('rejects %s instead of an array', (_label, value) => {
    expect(() => partitionExpiredHolds(value, NOW))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_HOLD }))
  })

  it('rejects an array containing a non-object', () => {
    expect(() => partitionExpiredHolds([hold(HOLD_STATUS.ACTIVE, 1, 1), null], NOW))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_HOLD }))
  })

  it('rejects a missing now', () => {
    expect(() => partitionExpiredHolds([])).toThrow(InventoryError)
  })
})

describe('activeHeldQuantity', () => {
  it('is zero for an empty list', () => {
    expect(activeHeldQuantity([], NOW)).toBe(0)
  })

  it('sums live ACTIVE holds', () => {
    const holds = [
      hold(HOLD_STATUS.ACTIVE, 2, 60_000),
      hold(HOLD_STATUS.ACTIVE, 3, 120_000),
    ]
    expect(activeHeldQuantity(holds, NOW)).toBe(5)
  })

  it('IGNORES an expired ACTIVE hold — the bug this module exists to prevent', () => {
    // The row still says ACTIVE because the sweeper has not run yet. Counting
    // it would keep 10 tickets off sale that nobody is buying.
    const stale = hold(HOLD_STATUS.ACTIVE, 10, -1)
    expect(activeHeldQuantity([stale], NOW)).toBe(0)
  })

  it('counts a hold expiring one millisecond from now', () => {
    expect(activeHeldQuantity([hold(HOLD_STATUS.ACTIVE, 10, 1)], NOW)).toBe(10)
  })

  it('does not count a hold expiring exactly now', () => {
    expect(activeHeldQuantity([hold(HOLD_STATUS.ACTIVE, 10, 0)], NOW)).toBe(0)
  })

  it('counts only the live part of a mixed list', () => {
    const holds = [
      hold(HOLD_STATUS.ACTIVE, 2, 60_000),
      hold(HOLD_STATUS.ACTIVE, 4, -60_000),
      hold(HOLD_STATUS.CONVERTED, 8, 60_000),
      hold(HOLD_STATUS.RELEASED, 16, 60_000),
      hold(HOLD_STATUS.EXPIRED, 32, 60_000),
    ]
    expect(activeHeldQuantity(holds, NOW)).toBe(2)
  })

  it.each([HOLD_STATUS.CONVERTED, HOLD_STATUS.RELEASED, HOLD_STATUS.EXPIRED])(
    'ignores %s holds entirely',
    (status) => {
      expect(activeHeldQuantity([hold(status, 7, 600_000)], NOW)).toBe(0)
    },
  )

  it('counts an ACTIVE hold with no expiresAt, failing towards refusing sales', () => {
    expect(activeHeldQuantity([{ status: HOLD_STATUS.ACTIVE, quantity: 6, expiresAt: null }], NOW))
      .toBe(6)
  })

  it('sees the same list differently as the clock moves past an expiry', () => {
    const holds = [hold(HOLD_STATUS.ACTIVE, 5, 60_000)]
    expect(activeHeldQuantity(holds, NOW)).toBe(5)
    expect(activeHeldQuantity(holds, new Date(NOW.getTime() + 59_999))).toBe(5)
    expect(activeHeldQuantity(holds, new Date(NOW.getTime() + 60_000))).toBe(0)
  })

  it('tolerates a zero-quantity hold', () => {
    expect(activeHeldQuantity([hold(HOLD_STATUS.ACTIVE, 0, 60_000)], NOW)).toBe(0)
  })

  it.each([
    ['a negative quantity', -2],
    ['a fractional quantity', 1.5],
    ['a string quantity', '3'],
    ['a missing quantity', undefined],
  ])('rejects a live hold with %s', (_label, quantity) => {
    const bad = { status: HOLD_STATUS.ACTIVE, quantity, expiresAt: new Date(NOW.getTime() + 1000) }
    expect(() => activeHeldQuantity([bad], NOW))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_HOLD }))
  })

  it('does not care about the quantity of holds it is ignoring', () => {
    const lapsed = { status: HOLD_STATUS.ACTIVE, quantity: null, expiresAt: new Date(NOW.getTime() - 1) }
    expect(activeHeldQuantity([lapsed], NOW)).toBe(0)
  })

  it('rejects a non-array', () => {
    expect(() => activeHeldQuantity(null, NOW)).toThrow(InventoryError)
  })
})
