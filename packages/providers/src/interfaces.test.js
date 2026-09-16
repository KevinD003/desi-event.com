import { describe, it, expect } from 'vitest'

import {
  PROVIDER_KINDS,
  PROVIDER_METHODS,
  paymentProviderSchema,
  emailProviderSchema,
  smsProviderSchema,
  storageProviderSchema,
  assertPaymentProvider,
  assertEmailProvider,
  assertSmsProvider,
  assertStorageProvider,
  inspectProvider,
} from './interfaces.js'
import { createInMemoryPaymentProvider } from './payments.js'
import { createInMemoryEmailProvider } from './email.js'
import { createInMemorySmsProvider } from './sms.js'
import { createInMemoryStorageProvider } from './storage.js'

/** A minimal object satisfying a kind's interface. */
const STUBS = {
  payments: {
    name: 'stub-payments',
    createIntent: () => ({}),
    capture: () => ({}),
    refund: () => ({}),
    getStatus: () => ({}),
  },
  email: { name: 'stub-email', send: () => ({}) },
  sms: { name: 'stub-sms', send: () => ({}) },
  storage: { name: 'stub-storage', put: () => ({}), getUrl: () => '', delete: () => true },
}

const ASSERTERS = {
  payments: assertPaymentProvider,
  email: assertEmailProvider,
  sms: assertSmsProvider,
  storage: assertStorageProvider,
}

describe('the interface constants', () => {
  it('names four frozen kinds', () => {
    expect([...PROVIDER_KINDS]).toEqual(['payments', 'email', 'sms', 'storage'])
    expect(Object.isFrozen(PROVIDER_KINDS)).toBe(true)
  })

  it('lists the required methods per kind', () => {
    expect([...PROVIDER_METHODS.payments]).toEqual([
      'createIntent',
      'capture',
      'refund',
      'getStatus',
    ])
    expect([...PROVIDER_METHODS.email]).toEqual(['send'])
    expect([...PROVIDER_METHODS.sms]).toEqual(['send'])
    expect([...PROVIDER_METHODS.storage]).toEqual(['put', 'getUrl', 'delete'])
    expect(Object.isFrozen(PROVIDER_METHODS)).toBe(true)
  })

  it('matches the contract the in-memory providers actually implement', () => {
    const providers = {
      payments: createInMemoryPaymentProvider(),
      email: createInMemoryEmailProvider(),
      sms: createInMemorySmsProvider(),
      storage: createInMemoryStorageProvider(),
    }

    for (const kind of PROVIDER_KINDS) {
      for (const method of PROVIDER_METHODS[kind]) {
        expect(typeof providers[kind][method]).toBe('function')
      }
      expect(() => ASSERTERS[kind](providers[kind])).not.toThrow()
    }
  })
})

describe('the structural schemas', () => {
  it('accept a conforming implementation', () => {
    expect(paymentProviderSchema.safeParse(STUBS.payments).success).toBe(true)
    expect(emailProviderSchema.safeParse(STUBS.email).success).toBe(true)
    expect(smsProviderSchema.safeParse(STUBS.sms).success).toBe(true)
    expect(storageProviderSchema.safeParse(STUBS.storage).success).toBe(true)
  })

  it('are loose, so a real adapter may carry extra members', () => {
    const richer = { ...STUBS.payments, verifyWebhook: () => true, apiVersion: '2026-01-01' }

    expect(paymentProviderSchema.safeParse(richer).success).toBe(true)
  })

  it('require a non-empty name', () => {
    expect(paymentProviderSchema.safeParse({ ...STUBS.payments, name: '' }).success).toBe(false)
    expect(paymentProviderSchema.safeParse({ ...STUBS.payments, name: 42 }).success).toBe(false)
  })

  it('treat `sent` as optional but typed on messaging providers', () => {
    expect(emailProviderSchema.safeParse({ ...STUBS.email, sent: [] }).success).toBe(true)
    expect(emailProviderSchema.safeParse({ ...STUBS.email, sent: 'nope' }).success).toBe(false)
    expect(smsProviderSchema.safeParse({ ...STUBS.sms, sent: {} }).success).toBe(false)
  })
})

describe.each(PROVIDER_KINDS)('assert for the %s provider', (kind) => {
  const assert = ASSERTERS[kind]
  const stub = STUBS[kind]

  it('returns the implementation untouched so the call can be inlined', () => {
    expect(assert(stub)).toBe(stub)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'provider'],
    ['a number', 7],
  ])('rejects %s with INVALID_PROVIDER', (_label, value) => {
    try {
      assert(value)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_PROVIDER')
      expect(error.statusCode).toBe(500)
      expect(error.provider).toBe(kind)
      expect(error.issues).toEqual([
        {
          path: '',
          code: 'invalid_type',
          message: `Expected an object implementing the ${kind} provider interface`,
        },
      ])
    }
  })

  it.each(PROVIDER_METHODS[kind])('reports %s when it is missing', (method) => {
    const broken = { ...stub }
    delete broken[method]

    try {
      assert(broken)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_PROVIDER')
      expect(error.issues).toEqual([
        { path: method, code: 'missing_method', message: `${method}() is missing` },
      ])
      expect(error.message).toContain(`${method}() is missing`)
      expect(error.details.members).toEqual([method])
    }
  })

  it.each(PROVIDER_METHODS[kind])('reports %s when it is present but not callable', (method) => {
    try {
      assert({ ...stub, [method]: 'not a function' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.issues).toEqual([
        {
          path: method,
          code: 'invalid_method',
          message: `${method} must be a function, received string`,
        },
      ])
    }
  })

  it('reports a missing name', () => {
    const broken = { ...stub }
    delete broken.name

    try {
      assert(broken)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.issues.map((issue) => issue.path)).toEqual(['name'])
      expect(error.issues[0].code).not.toBe('missing_method')
    }
  })
})

describe('assertPaymentProvider', () => {
  it('lists every broken member at once, not just the first', () => {
    try {
      assertPaymentProvider({ name: 'half-built', createIntent: () => ({}), capture: 42 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.issues).toEqual([
        {
          path: 'capture',
          code: 'invalid_method',
          message: 'capture must be a function, received number',
        },
        { path: 'refund', code: 'missing_method', message: 'refund() is missing' },
        { path: 'getStatus', code: 'missing_method', message: 'getStatus() is missing' },
      ])
      expect(error.message).toBe(
        'Invalid payments provider: capture must be a function, received number; refund() is missing; getStatus() is missing',
      )
    }
  })

  it('treats a null method as missing rather than as the wrong type', () => {
    try {
      assertPaymentProvider({ ...STUBS.payments, refund: null })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.issues[0].code).toBe('missing_method')
    }
  })

  it('accepts a class-based adapter, not only object literals', () => {
    class StripeishAdapter {
      /** @returns {string} The adapter name. */
      get name() {
        return 'stripeish'
      }

      /** @returns {object} A fake intent. */
      createIntent() {
        return {}
      }

      /** @returns {object} A fake intent. */
      capture() {
        return {}
      }

      /** @returns {object} A fake intent. */
      refund() {
        return {}
      }

      /** @returns {object} A fake intent. */
      getStatus() {
        return {}
      }
    }

    const adapter = new StripeishAdapter()
    expect(assertPaymentProvider(adapter)).toBe(adapter)
  })
})

describe('inspectProvider', () => {
  it('reports validity without throwing', () => {
    expect(inspectProvider('payments', STUBS.payments)).toEqual({ valid: true, issues: [] })
  })

  it('returns the issues instead of throwing them', () => {
    const result = inspectProvider('storage', { name: 'x', put: () => ({}) })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toEqual(['getUrl', 'delete'])
  })

  it('rejects an unknown kind', () => {
    try {
      inspectProvider('search', STUBS.payments)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_OPTIONS')
      expect(error.message).toMatch(/Unknown provider kind "search"/)
    }
  })
})
