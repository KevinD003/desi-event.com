import { describe, it, expect } from 'vitest'

import { PROVIDER_ERROR_CODES } from './errors.js'
import {
  createClock,
  createIdFactory,
  freezeRecord,
  isPlainObject,
  normaliseMetadata,
  requireText,
} from './internal.js'

describe('isPlainObject', () => {
  it('accepts object literals and null-prototype objects', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
  })

  it('rejects arrays, class instances, functions, null and primitives', () => {
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(new Map())).toBe(false)
    expect(isPlainObject(() => {})).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
  })
})

describe('createIdFactory', () => {
  it('produces zero-padded, monotonic, prefixed ids', () => {
    const nextId = createIdFactory('pi')

    expect(nextId()).toBe('pi_000001')
    expect(nextId()).toBe('pi_000002')
    expect(nextId()).toBe('pi_000003')
  })

  it('gives each factory its own sequence', () => {
    const a = createIdFactory('a')
    const b = createIdFactory('b')

    a()
    a()
    expect(b()).toBe('b_000001')
  })
})

describe('createClock', () => {
  it('reads the wall clock when no instant is given', () => {
    const before = Date.now()
    const value = createClock()().getTime()

    expect(value).toBeGreaterThanOrEqual(before)
  })

  it('freezes time at a fixed Date, number or ISO string', () => {
    const iso = '2026-09-14T10:00:00.000Z'

    expect(createClock(new Date(iso))().toISOString()).toBe(iso)
    expect(createClock(Date.parse(iso))().toISOString()).toBe(iso)
    expect(createClock(iso)().toISOString()).toBe(iso)
  })

  it('hands back a fresh Date each call so a caller cannot mutate the fixed instant', () => {
    const clock = createClock('2026-09-14T10:00:00.000Z')
    const first = clock()
    first.setFullYear(1999)

    expect(clock().toISOString()).toBe('2026-09-14T10:00:00.000Z')
  })

  it('supports an advancing clock function', () => {
    let tick = 0
    const clock = createClock(() => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)))

    expect(clock().toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(clock().toISOString()).toBe('2026-01-01T00:00:01.000Z')
  })

  it('rejects an unusable instant', () => {
    expect(() => createClock('not-a-date')).toThrowError(/Date, epoch milliseconds/)
    expect(() => createClock({})).toThrowError(/Date, epoch milliseconds/)
    expect(() => createClock(() => 'nope')()).toThrowError(/Date, epoch milliseconds/)
  })

  it('treats null and undefined as "use the wall clock"', () => {
    expect(createClock(null)()).toBeInstanceOf(Date)
    expect(createClock(undefined)()).toBeInstanceOf(Date)
  })
})

describe('freezeRecord', () => {
  it('freezes the object and its nested plain objects and arrays', () => {
    const record = freezeRecord({ a: 1, meta: { b: 2 }, list: [1, 2], when: new Date(0) })

    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.meta)).toBe(true)
    expect(Object.isFrozen(record.list)).toBe(true)
    expect(Object.isFrozen(record.when)).toBe(false)
  })
})

describe('normaliseMetadata', () => {
  it('returns a frozen empty object when absent', () => {
    const metadata = normaliseMetadata(undefined, PROVIDER_ERROR_CODES.INVALID_OPTIONS, 'p')

    expect(metadata).toEqual({})
    expect(Object.isFrozen(metadata)).toBe(true)
    expect(normaliseMetadata(null, PROVIDER_ERROR_CODES.INVALID_OPTIONS, 'p')).toEqual({})
  })

  it('copies the caller bag so later mutation cannot reach the stored record', () => {
    const source = { orderId: 'ord_1' }
    const metadata = normaliseMetadata(source, PROVIDER_ERROR_CODES.INVALID_OPTIONS, 'p')
    source.orderId = 'changed'

    expect(metadata.orderId).toBe('ord_1')
  })

  it('rejects non-object metadata with the supplied code', () => {
    expect(() =>
      normaliseMetadata(['a'], PROVIDER_ERROR_CODES.INVALID_MESSAGE, 'p'),
    ).toThrowError(/plain object/)

    try {
      normaliseMetadata('nope', PROVIDER_ERROR_CODES.INVALID_MESSAGE, 'p')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_MESSAGE')
      expect(error.provider).toBe('p')
      expect(error.details.received).toBe('string')
    }
  })
})

describe('requireText', () => {
  const options = { code: PROVIDER_ERROR_CODES.INVALID_MESSAGE, provider: 'p', maxLength: 5 }

  it('trims and returns the value', () => {
    expect(requireText('  hi  ', 'subject', options)).toBe('hi')
  })

  it('rejects empty, whitespace-only and non-string values', () => {
    expect(() => requireText('', 'subject', options)).toThrowError(/non-empty string/)
    expect(() => requireText('   ', 'subject', options)).toThrowError(/non-empty string/)
    expect(() => requireText(undefined, 'subject', options)).toThrowError(/non-empty string/)
    expect(() => requireText(42, 'subject', options)).toThrowError(/non-empty string/)
  })

  it('enforces the maximum length after trimming', () => {
    expect(requireText('  12345  ', 'subject', options)).toBe('12345')
    expect(() => requireText('123456', 'subject', options)).toThrowError(/at most 5 characters/)
  })

  it('defaults the maximum length when none is given', () => {
    expect(requireText('x'.repeat(1000), 'body', { code: 'X' })).toHaveLength(1000)
    expect(() => requireText('x'.repeat(1001), 'body', { code: 'X' })).toThrowError(/at most 1000/)
  })
})
