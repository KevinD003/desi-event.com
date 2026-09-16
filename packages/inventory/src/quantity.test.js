import { describe, it, expect } from 'vitest'

import { validateQuantityRequest } from './quantity.js'
import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'

/**
 * Capture the error a call throws, so assertions can inspect code and details.
 *
 * @param {object} request Argument for validateQuantityRequest.
 * @returns {InventoryError} The thrown error.
 */
function catchError(request) {
  try {
    validateQuantityRequest(request)
  } catch (error) {
    return error
  }
  throw new Error('expected validateQuantityRequest to throw, but it returned')
}

describe('validateQuantityRequest — accepting', () => {
  it('accepts a quantity inside every limit', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 2,
        minPerOrder: 1,
        maxPerOrder: 6,
        availableQuantity: 50,
      }),
    ).not.toThrow()
  })

  it('returns undefined rather than a result object', () => {
    expect(validateQuantityRequest({ quantity: 1, availableQuantity: 1 })).toBeUndefined()
  })

  it('accepts exactly the minimum', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 2,
        minPerOrder: 2,
        maxPerOrder: 6,
        availableQuantity: 10,
      }),
    ).not.toThrow()
  })

  it('accepts exactly the maximum', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 6,
        minPerOrder: 1,
        maxPerOrder: 6,
        availableQuantity: 10,
      }),
    ).not.toThrow()
  })

  it('accepts exactly the remaining stock', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 4,
        minPerOrder: 1,
        maxPerOrder: 10,
        availableQuantity: 4,
      }),
    ).not.toThrow()
  })

  it('accepts the last ticket', () => {
    expect(() => validateQuantityRequest({ quantity: 1, availableQuantity: 1 })).not.toThrow()
  })

  it('defaults minPerOrder to 1 and maxPerOrder to unlimited', () => {
    expect(() => validateQuantityRequest({ quantity: 999, availableQuantity: 1000 })).not.toThrow()
  })

  it('treats a null maxPerOrder as unlimited', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 500,
        minPerOrder: 1,
        maxPerOrder: null,
        availableQuantity: 500,
      }),
    ).not.toThrow()
  })

  it('treats a null minPerOrder as 1', () => {
    expect(() =>
      validateQuantityRequest({ quantity: 1, minPerOrder: null, availableQuantity: 5 }),
    ).not.toThrow()
  })

  it('accepts a min equal to the max', () => {
    expect(() =>
      validateQuantityRequest({
        quantity: 4,
        minPerOrder: 4,
        maxPerOrder: 4,
        availableQuantity: 4,
      }),
    ).not.toThrow()
  })
})

describe('validateQuantityRequest — INVALID_QUANTITY', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '2'],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
  ])('rejects %s', (_label, quantity) => {
    const error = catchError({ quantity, minPerOrder: 1, maxPerOrder: 10, availableQuantity: 10 })
    expect(error).toBeInstanceOf(InventoryError)
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INVALID_QUANTITY)
    expect(error.statusCode).toBe(400)
  })

  it('checks shape before the per-order floor, so 0 is not "below minimum"', () => {
    const error = catchError({ quantity: 0, minPerOrder: 2, availableQuantity: 10 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INVALID_QUANTITY)
  })

  it('rejects being called with no argument at all', () => {
    expect(() => validateQuantityRequest()).toThrow(InventoryError)
  })
})

describe('validateQuantityRequest — BELOW_MINIMUM', () => {
  it('rejects one under the minimum', () => {
    const error = catchError({ quantity: 1, minPerOrder: 2, maxPerOrder: 8, availableQuantity: 50 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.BELOW_MINIMUM)
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual({ quantity: 1, minPerOrder: 2 })
  })

  it('names the minimum in the message', () => {
    const error = catchError({ quantity: 1, minPerOrder: 4, availableQuantity: 50 })
    expect(error.message).toBe('At least 4 tickets must be bought at a time')
  })

  it('reports the minimum before the maximum when both are impossible to satisfy at once', () => {
    // A table of 4 has min 4; asking for 1 is a floor problem, not a stock one.
    const error = catchError({ quantity: 1, minPerOrder: 4, maxPerOrder: 4, availableQuantity: 0 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.BELOW_MINIMUM)
  })
})

describe('validateQuantityRequest — ABOVE_MAXIMUM', () => {
  it('rejects one over the maximum', () => {
    const error = catchError({
      quantity: 7,
      minPerOrder: 1,
      maxPerOrder: 6,
      availableQuantity: 500,
    })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.ABOVE_MAXIMUM)
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual({ quantity: 7, maxPerOrder: 6 })
  })

  it('reports the per-order ceiling before the stock level', () => {
    // Plenty are unsold, but nobody may take 20 in one order.
    const error = catchError({ quantity: 20, minPerOrder: 1, maxPerOrder: 6, availableQuantity: 8 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.ABOVE_MAXIMUM)
  })

  it('pluralises the limit correctly for a maximum of one', () => {
    const error = catchError({ quantity: 2, maxPerOrder: 1, availableQuantity: 10 })
    expect(error.message).toBe('At most 1 ticket may be bought at a time')
  })
})

describe('validateQuantityRequest — INSUFFICIENT_INVENTORY', () => {
  it('rejects one more than remains', () => {
    const error = catchError({ quantity: 5, minPerOrder: 1, maxPerOrder: 10, availableQuantity: 4 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY)
    expect(error.statusCode).toBe(409)
    expect(error.details).toEqual({ quantity: 5, availableQuantity: 4 })
  })

  it('rejects any quantity when nothing is available', () => {
    const error = catchError({ quantity: 1, minPerOrder: 1, maxPerOrder: 10, availableQuantity: 0 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY)
    expect(error.message).toBe('These tickets are sold out')
  })

  it('names the remaining count so the buyer can retry smaller', () => {
    const error = catchError({ quantity: 4, availableQuantity: 1 })
    expect(error.message).toBe('Only 1 ticket left')
  })

  it('pluralises the remaining count', () => {
    const error = catchError({ quantity: 9, availableQuantity: 3 })
    expect(error.message).toBe('Only 3 tickets left')
  })
})

describe('validateQuantityRequest — malformed rules', () => {
  it('rejects a minimum greater than the maximum', () => {
    const error = catchError({ quantity: 5, minPerOrder: 6, maxPerOrder: 4, availableQuantity: 10 })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INVALID_INVENTORY)
  })

  it.each([
    ['a negative minimum', { minPerOrder: -1 }],
    ['a fractional minimum', { minPerOrder: 1.5 }],
    ['a negative maximum', { maxPerOrder: -4 }],
    ['a negative available count', { availableQuantity: -1 }],
    ['a fractional available count', { availableQuantity: 2.5 }],
    ['a string available count', { availableQuantity: '10' }],
    ['an object available count', { availableQuantity: { count: 10 } }],
    ['a Date available count', { availableQuantity: new Date() }],
    ['a missing available count', { availableQuantity: undefined }],
  ])('rejects %s', (_label, overrides) => {
    const error = catchError({ quantity: 2, availableQuantity: 10, ...overrides })
    expect(error.code).toBe(INVENTORY_ERROR_CODES.INVALID_INVENTORY)
  })
})
