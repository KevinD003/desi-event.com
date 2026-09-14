import { describe, it, expect } from 'vitest'

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'

describe('InventoryError', () => {
  it('is an Error', () => {
    const error = new InventoryError(INVENTORY_ERROR_CODES.BELOW_MINIMUM, 'too few')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('InventoryError')
    expect(error.message).toBe('too few')
  })

  it('carries the machine-readable code', () => {
    expect(new InventoryError('BELOW_MINIMUM', 'x').code).toBe('BELOW_MINIMUM')
  })

  it.each([
    [INVENTORY_ERROR_CODES.INVALID_QUANTITY, 400],
    [INVENTORY_ERROR_CODES.BELOW_MINIMUM, 422],
    [INVENTORY_ERROR_CODES.ABOVE_MAXIMUM, 422],
    [INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY, 409],
    [INVENTORY_ERROR_CODES.INVALID_INVENTORY, 400],
    [INVENTORY_ERROR_CODES.INVALID_HOLD, 400],
    [INVENTORY_ERROR_CODES.INVALID_STATUS, 400],
    [INVENTORY_ERROR_CODES.INVALID_DATE, 400],
    [INVENTORY_ERROR_CODES.INVALID_TTL, 400],
  ])('maps %s to HTTP %i', (code, statusCode) => {
    expect(new InventoryError(code, 'x').statusCode).toBe(statusCode)
  })

  it('falls back to 400 for an unmapped code', () => {
    expect(new InventoryError('SOMETHING_NEW', 'x').statusCode).toBe(400)
  })

  it('accepts an explicit status override', () => {
    expect(new InventoryError('BELOW_MINIMUM', 'x', { statusCode: 400 }).statusCode).toBe(400)
  })

  it('defaults details to an empty object', () => {
    expect(new InventoryError('BELOW_MINIMUM', 'x').details).toEqual({})
  })

  it('keeps the details it is given', () => {
    const error = new InventoryError('ABOVE_MAXIMUM', 'x', { details: { quantity: 9 } })
    expect(error.details).toEqual({ quantity: 9 })
  })

  it('forwards a cause', () => {
    const cause = new Error('underlying')
    expect(new InventoryError('INVALID_DATE', 'x', { cause }).cause).toBe(cause)
  })

  it('leaves cause undefined when none is given', () => {
    expect(new InventoryError('INVALID_DATE', 'x').cause).toBeUndefined()
  })

  it('serialises to the shared error-response shape', () => {
    const error = new InventoryError('INSUFFICIENT_INVENTORY', 'Only 2 tickets left', {
      details: { availableQuantity: 2 },
    })
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      error: {
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Only 2 tickets left',
        details: { availableQuantity: 2 },
      },
    })
  })

  it('has a stack that does not start inside the constructor', () => {
    expect(new InventoryError('INVALID_DATE', 'x').stack).not.toContain('new InventoryError')
  })
})

describe('INVENTORY_ERROR_CODES', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(INVENTORY_ERROR_CODES)).toBe(true)
  })

  it('maps every key to itself, so the code is readable in logs', () => {
    for (const [key, value] of Object.entries(INVENTORY_ERROR_CODES)) expect(value).toBe(key)
  })

  it('defines the four quantity-validation codes required by the contract', () => {
    expect(Object.keys(INVENTORY_ERROR_CODES)).toEqual(
      expect.arrayContaining([
        'BELOW_MINIMUM',
        'ABOVE_MAXIMUM',
        'INSUFFICIENT_INVENTORY',
        'INVALID_QUANTITY',
      ]),
    )
  })
})
