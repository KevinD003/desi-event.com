import { describe, it, expect } from 'vitest'

import { salesWindowState } from './sales-window.js'
import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
import { TICKET_TYPE_STATUS } from './constants.js'

const START = new Date('2026-03-01T10:00:00.000Z')
const END = new Date('2026-03-31T23:00:00.000Z')

/**
 * @param {object} overrides Fields to change.
 * @returns {object} A window input defaulting to an open ON_SALE window.
 */
function input(overrides = {}) {
  return {
    status: TICKET_TYPE_STATUS.ON_SALE,
    salesStartAt: START,
    salesEndAt: END,
    now: new Date('2026-03-15T12:00:00.000Z'),
    ...overrides,
  }
}

describe('salesWindowState — explicit status precedence', () => {
  it('returns DRAFT for a draft ticket type even inside its window', () => {
    expect(salesWindowState(input({ status: TICKET_TYPE_STATUS.DRAFT }))).toBe('DRAFT')
  })

  it('returns PAUSED for a paused ticket type even inside its window', () => {
    expect(salesWindowState(input({ status: TICKET_TYPE_STATUS.PAUSED }))).toBe('PAUSED')
  })

  it('returns CLOSED for a closed ticket type even inside its window', () => {
    expect(salesWindowState(input({ status: TICKET_TYPE_STATUS.CLOSED }))).toBe('CLOSED')
  })

  it('collapses SOLD_OUT to CLOSED', () => {
    expect(salesWindowState(input({ status: TICKET_TYPE_STATUS.SOLD_OUT }))).toBe('CLOSED')
  })

  it.each([
    TICKET_TYPE_STATUS.DRAFT,
    TICKET_TYPE_STATUS.PAUSED,
    TICKET_TYPE_STATUS.CLOSED,
    TICKET_TYPE_STATUS.SOLD_OUT,
  ])('%s outranks a window that has not started', (status) => {
    const state = salesWindowState(input({ status, now: new Date('2026-01-01T00:00:00.000Z') }))
    expect(state).not.toBe('NOT_STARTED')
  })

  it.each([
    TICKET_TYPE_STATUS.DRAFT,
    TICKET_TYPE_STATUS.PAUSED,
    TICKET_TYPE_STATUS.CLOSED,
    TICKET_TYPE_STATUS.SOLD_OUT,
  ])('%s outranks a window that has ended', (status) => {
    const state = salesWindowState(input({ status, now: new Date('2027-01-01T00:00:00.000Z') }))
    expect(state).not.toBe('ENDED')
  })
})

describe('salesWindowState — the clock, for ON_SALE ticket types', () => {
  it('is NOT_STARTED before the window opens', () => {
    expect(salesWindowState(input({ now: new Date('2026-02-28T09:59:59.999Z') }))).toBe(
      'NOT_STARTED',
    )
  })

  it('is NOT_STARTED one millisecond before the start', () => {
    expect(salesWindowState(input({ now: new Date(START.getTime() - 1) }))).toBe('NOT_STARTED')
  })

  it('is ON_SALE at exactly the start instant — the window includes its start', () => {
    expect(salesWindowState(input({ now: new Date(START.getTime()) }))).toBe('ON_SALE')
  })

  it('is ON_SALE one millisecond after the start', () => {
    expect(salesWindowState(input({ now: new Date(START.getTime() + 1) }))).toBe('ON_SALE')
  })

  it('is ON_SALE one millisecond before the end', () => {
    expect(salesWindowState(input({ now: new Date(END.getTime() - 1) }))).toBe('ON_SALE')
  })

  it('is ENDED at exactly the end instant — the window excludes its end', () => {
    expect(salesWindowState(input({ now: new Date(END.getTime()) }))).toBe('ENDED')
  })

  it('is ENDED after the window closes', () => {
    expect(salesWindowState(input({ now: new Date(END.getTime() + 1) }))).toBe('ENDED')
  })

  it('is ON_SALE with no window at all', () => {
    expect(salesWindowState(input({ salesStartAt: null, salesEndAt: null }))).toBe('ON_SALE')
  })

  it('treats a missing start as "open from the beginning"', () => {
    expect(
      salesWindowState(input({ salesStartAt: null, now: new Date('2020-01-01T00:00:00.000Z') })),
    ).toBe('ON_SALE')
  })

  it('treats a missing end as "never closes"', () => {
    expect(
      salesWindowState(input({ salesEndAt: null, now: new Date('2099-01-01T00:00:00.000Z') })),
    ).toBe('ON_SALE')
  })

  it('treats undefined bounds like null', () => {
    expect(salesWindowState({ status: 'ON_SALE', now: START })).toBe('ON_SALE')
  })

  it('reports NOT_STARTED, not ENDED, for a future window', () => {
    expect(
      salesWindowState(
        input({
          salesStartAt: new Date('2027-01-01T00:00:00.000Z'),
          salesEndAt: new Date('2027-02-01T00:00:00.000Z'),
        }),
      ),
    ).toBe('NOT_STARTED')
  })

  it('handles a zero-length window as permanently ENDED once reached', () => {
    const instant = new Date('2026-03-10T00:00:00.000Z')
    expect(
      salesWindowState(input({ salesStartAt: instant, salesEndAt: instant, now: instant })),
    ).toBe('ENDED')
  })
})

describe('salesWindowState — accepted instant formats', () => {
  it('accepts ISO strings', () => {
    expect(
      salesWindowState({
        status: 'ON_SALE',
        salesStartAt: '2026-03-01T10:00:00.000Z',
        salesEndAt: '2026-03-31T23:00:00.000Z',
        now: '2026-03-02T00:00:00.000Z',
      }),
    ).toBe('ON_SALE')
  })

  it('accepts epoch milliseconds', () => {
    expect(
      salesWindowState({
        status: 'ON_SALE',
        salesStartAt: START.getTime(),
        salesEndAt: END.getTime(),
        now: START.getTime(),
      }),
    ).toBe('ON_SALE')
  })

  it('compares absolute instants, so a non-UTC offset resolves correctly', () => {
    // 2026-03-01T11:00:00+02:00 is 09:00Z — an hour before the window opens.
    expect(salesWindowState(input({ now: '2026-03-01T11:00:00+02:00' }))).toBe('NOT_STARTED')
    // The same wall-clock reading in UTC is inside the window.
    expect(salesWindowState(input({ now: '2026-03-01T11:00:00Z' }))).toBe('ON_SALE')
  })
})

describe('salesWindowState — rejections', () => {
  it('rejects an unknown status', () => {
    expect(() => salesWindowState(input({ status: 'ON_SALE_SOON' }))).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_STATUS }),
    )
  })

  it('rejects a missing status', () => {
    expect(() => salesWindowState({ now: START })).toThrow(InventoryError)
  })

  it('rejects a lower-case status — enum values are exact', () => {
    expect(() => salesWindowState(input({ status: 'on_sale' }))).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_STATUS }),
    )
  })

  it('rejects a missing now', () => {
    expect(() => salesWindowState({ status: 'ON_SALE' })).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }),
    )
  })

  it('rejects an invalid Date for now', () => {
    expect(() => salesWindowState(input({ now: new Date('not a date') }))).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }),
    )
  })

  it('rejects an unparseable start', () => {
    expect(() => salesWindowState(input({ salesStartAt: 'next Tuesday' }))).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }),
    )
  })

  it('rejects a window that ends before it starts', () => {
    expect(() => salesWindowState(input({ salesStartAt: END, salesEndAt: START }))).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_DATE }),
    )
  })

  it('rejects being called with no argument at all', () => {
    expect(() => salesWindowState()).toThrow(InventoryError)
  })
})
