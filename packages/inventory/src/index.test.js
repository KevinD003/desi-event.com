import { describe, it, expect } from 'vitest'

import * as inventory from './index.js'
import {
  activeHeldQuantity,
  computeAvailability,
  holdExpiresAt,
  isHoldExpired,
  partitionExpiredHolds,
  salesWindowState,
  validateQuantityRequest,
  InventoryError,
  INVENTORY_ERROR_CODES,
  HOLD_STATUS,
  SALES_WINDOW_STATE,
  TICKET_TYPE_STATUS,
} from './index.js'

describe('public surface', () => {
  it('exports every name in the cross-package contract', () => {
    for (const name of [
      'computeAvailability', 'salesWindowState', 'validateQuantityRequest', 'holdExpiresAt',
      'isHoldExpired', 'partitionExpiredHolds', 'activeHeldQuantity', 'InventoryError',
    ]) {
      expect(inventory[name], name).toBeTypeOf('function')
    }
  })

  it('exports the frozen enum mirrors', () => {
    expect(Object.isFrozen(HOLD_STATUS)).toBe(true)
    expect(Object.isFrozen(TICKET_TYPE_STATUS)).toBe(true)
    expect(Object.isFrozen(SALES_WINDOW_STATE)).toBe(true)
  })

  it('mirrors the Prisma HoldStatus enum exactly', () => {
    expect(Object.keys(HOLD_STATUS)).toEqual(['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'])
  })

  it('mirrors the Prisma TicketTypeStatus enum exactly', () => {
    expect(Object.keys(TICKET_TYPE_STATUS))
      .toEqual(['DRAFT', 'ON_SALE', 'PAUSED', 'SOLD_OUT', 'CLOSED'])
  })

  it('returns only the six documented sales-window states', () => {
    expect(Object.keys(SALES_WINDOW_STATE))
      .toEqual(['ON_SALE', 'NOT_STARTED', 'ENDED', 'PAUSED', 'CLOSED', 'DRAFT'])
  })
})

describe('checkout, end to end against a fixed clock', () => {
  const now = new Date('2026-07-04T18:00:00.000Z')

  /** A garba night: 200 seats, 180 issued, one live hold and one stale one. */
  const ticketType = {
    status: TICKET_TYPE_STATUS.ON_SALE,
    quantityTotal: 200,
    quantitySold: 180,
    salesStartAt: new Date('2026-06-01T00:00:00.000Z'),
    salesEndAt: new Date('2026-07-04T20:00:00.000Z'),
    minPerOrder: 1,
    maxPerOrder: 8,
  }

  const holds = [
    { id: 'live', status: HOLD_STATUS.ACTIVE, quantity: 4, expiresAt: new Date('2026-07-04T18:05:00.000Z') },
    // The sweeper has not run, so this lapsed hold is still marked ACTIVE.
    { id: 'stale', status: HOLD_STATUS.ACTIVE, quantity: 12, expiresAt: new Date('2026-07-04T17:50:00.000Z') },
    { id: 'paid', status: HOLD_STATUS.CONVERTED, quantity: 2, expiresAt: new Date('2026-07-04T17:00:00.000Z') },
  ]

  it('releases the stale hold back into availability', () => {
    const heldQuantity = activeHeldQuantity(holds, now)
    expect(heldQuantity).toBe(4)

    const availability = computeAvailability({ ...ticketType, heldQuantity })
    expect(availability).toEqual({ availableQuantity: 16, isSoldOut: false, heldQuantity: 4 })
  })

  it('would wrongly show 4 seats if stale holds were counted — the regression this guards', () => {
    const naiveHeld = holds
      .filter((h) => h.status === HOLD_STATUS.ACTIVE)
      .reduce((sum, h) => sum + h.quantity, 0)

    expect(naiveHeld).toBe(16)
    expect(computeAvailability({ ...ticketType, heldQuantity: naiveHeld }).availableQuantity).toBe(4)
    expect(activeHeldQuantity(holds, now)).toBe(4)
  })

  it('lets a buyer take the full remaining stock and refuses one more', () => {
    const { availableQuantity } = computeAvailability({
      ...ticketType,
      heldQuantity: activeHeldQuantity(holds, now),
    })

    expect(salesWindowState({ ...ticketType, now })).toBe(SALES_WINDOW_STATE.ON_SALE)

    expect(() => validateQuantityRequest({ ...ticketType, quantity: 8, availableQuantity }))
      .not.toThrow()
    expect(() => validateQuantityRequest({ ...ticketType, quantity: 9, availableQuantity }))
      .toThrow(expect.objectContaining({ code: INVENTORY_ERROR_CODES.ABOVE_MAXIMUM }))
  })

  it('refuses everything once the window closes, whatever the stock says', () => {
    const afterClose = new Date('2026-07-04T20:00:00.000Z')
    expect(salesWindowState({ ...ticketType, now: afterClose })).toBe(SALES_WINDOW_STATE.ENDED)
  })

  it('walks a hold from creation to sweep', () => {
    const expiresAt = holdExpiresAt(now, 600)
    const newHold = { id: 'fresh', status: HOLD_STATUS.ACTIVE, quantity: 2, expiresAt }

    expect(isHoldExpired(newHold, now)).toBe(false)
    expect(activeHeldQuantity([newHold], now)).toBe(2)

    const later = new Date(now.getTime() + 600_000)
    expect(isHoldExpired(newHold, later)).toBe(true)
    expect(activeHeldQuantity([newHold], later)).toBe(0)
    expect(partitionExpiredHolds([newHold], later).expired).toEqual([newHold])
  })

  it('sells out only when live holds plus sales cover the total', () => {
    const heavyHolds = [
      { id: 'a', status: HOLD_STATUS.ACTIVE, quantity: 20, expiresAt: new Date('2026-07-04T18:05:00.000Z') },
    ]
    const availability = computeAvailability({
      ...ticketType,
      heldQuantity: activeHeldQuantity(heavyHolds, now),
    })

    expect(availability.isSoldOut).toBe(true)
    const error = (() => {
      try {
        validateQuantityRequest({ ...ticketType, quantity: 1, availableQuantity: availability.availableQuantity })
        return null
      } catch (caught) {
        return caught
      }
    })()

    expect(error).toBeInstanceOf(InventoryError)
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY)
    expect(error.statusCode).toBe(409)
  })
})
