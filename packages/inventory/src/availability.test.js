import { describe, it, expect } from 'vitest'

import { computeAvailability } from './availability.js'
import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'

describe('computeAvailability', () => {
  it('subtracts sold and held tickets from the total', () => {
    expect(computeAvailability({ quantityTotal: 100, quantitySold: 30, heldQuantity: 5 })).toEqual({
      availableQuantity: 65,
      isSoldOut: false,
      heldQuantity: 5,
    })
  })

  it('defaults sold and held to zero', () => {
    expect(computeAvailability({ quantityTotal: 12 })).toEqual({
      availableQuantity: 12,
      isSoldOut: false,
      heldQuantity: 0,
    })
  })

  it('reports sold out at exactly zero available', () => {
    const result = computeAvailability({ quantityTotal: 10, quantitySold: 8, heldQuantity: 2 })
    expect(result.availableQuantity).toBe(0)
    expect(result.isSoldOut).toBe(true)
  })

  it('is not sold out with one ticket left', () => {
    const result = computeAvailability({ quantityTotal: 10, quantitySold: 8, heldQuantity: 1 })
    expect(result.availableQuantity).toBe(1)
    expect(result.isSoldOut).toBe(false)
  })

  it('treats holds alone as enough to sell out', () => {
    expect(computeAvailability({ quantityTotal: 4, quantitySold: 0, heldQuantity: 4 })).toEqual({
      availableQuantity: 0,
      isSoldOut: true,
      heldQuantity: 4,
    })
  })

  it('floors at zero rather than returning a negative count', () => {
    // An upstream race left the counters oversold; refusing sales is the only
    // safe reading.
    const result = computeAvailability({ quantityTotal: 10, quantitySold: 9, heldQuantity: 5 })
    expect(result.availableQuantity).toBe(0)
    expect(result.isSoldOut).toBe(true)
  })

  it('treats a zero-total ticket type as sold out', () => {
    expect(computeAvailability({ quantityTotal: 0 })).toEqual({
      availableQuantity: 0,
      isSoldOut: true,
      heldQuantity: 0,
    })
  })

  it('echoes the held quantity back to the caller', () => {
    expect(
      computeAvailability({ quantityTotal: 50, quantitySold: 1, heldQuantity: 7 }).heldQuantity,
    ).toBe(7)
  })

  it.each([
    ['a missing total', {}],
    ['a negative total', { quantityTotal: -1 }],
    ['a fractional total', { quantityTotal: 10.5 }],
    ['a negative sold count', { quantityTotal: 10, quantitySold: -2 }],
    ['a fractional sold count', { quantityTotal: 10, quantitySold: 1.2 }],
    ['a negative held count', { quantityTotal: 10, heldQuantity: -3 }],
    ['a string total', { quantityTotal: '10' }],
    ['NaN', { quantityTotal: Number.NaN }],
    ['Infinity', { quantityTotal: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, input) => {
    expect(() => computeAvailability(input)).toThrow(InventoryError)
    expect(() => computeAvailability(input)).toThrow(
      expect.objectContaining({ code: INVENTORY_ERROR_CODES.INVALID_INVENTORY }),
    )
  })

  it('rejects being called with no argument at all', () => {
    expect(() => computeAvailability()).toThrow(InventoryError)
  })

  it('names the offending argument in the error details', () => {
    try {
      computeAvailability({ quantityTotal: 10, quantitySold: -1 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.details.argument).toBe('quantitySold')
      expect(error.statusCode).toBe(400)
    }
  })
})
