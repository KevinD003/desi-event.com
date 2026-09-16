import { describe, it, expect } from 'vitest'

import * as providers from './index.js'

/** Everything the cross-package contract promises this module exports. */
const CONTRACT_EXPORTS = [
  'createInMemoryPaymentProvider',
  'createInMemoryEmailProvider',
  'createInMemorySmsProvider',
  'createInMemoryStorageProvider',
  'createProviderRegistry',
  'assertPaymentProvider',
  'assertEmailProvider',
  'assertSmsProvider',
  'assertStorageProvider',
  'ProviderError',
]

describe('the package entry point', () => {
  it.each(CONTRACT_EXPORTS)('exports %s', (name) => {
    expect(providers[name]).toBeDefined()
  })

  it('exports the four factories and four validators as functions', () => {
    for (const name of CONTRACT_EXPORTS.filter((entry) => entry !== 'ProviderError')) {
      expect(typeof providers[name]).toBe('function')
    }
  })

  it('exports ProviderError as a constructible Error subclass', () => {
    const error = new providers.ProviderError(providers.PROVIDER_ERROR_CODES.SEND_FAILED, 'x')

    expect(error).toBeInstanceOf(Error)
    expect(providers.isProviderError(error)).toBe(true)
  })

  it('exports the constants callers branch on', () => {
    expect(providers.PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE).toBe('REQUIRES_CAPTURE')
    expect(providers.PAYMENT_DECLINE_AMOUNT_CENTS).toBe(999_999)
    expect(providers.EMAIL_BOUNCE_ADDRESS).toContain('@')
    expect(providers.SMS_FAILURE_NUMBER.startsWith('+')).toBe(true)
    expect([...providers.PROVIDER_KINDS]).toHaveLength(4)
  })
})

describe('the documented quick start', () => {
  it('behaves exactly as the module docblock claims', () => {
    const registry = providers.createInMemoryProviderRegistry()
    const intent = registry.payments.createIntent({ amountCents: 2500, currency: 'INR' })

    expect(intent.status).toBe(providers.PAYMENT_INTENT_STATUS.REQUIRES_CAPTURE)
    expect(registry.payments.capture(intent.id).status).toBe(
      providers.PAYMENT_INTENT_STATUS.SUCCEEDED,
    )
    expect(registry.email.sent).toEqual([])
  })
})

describe('a hand-written adapter', () => {
  it('can be validated and registered alongside the fakes', () => {
    const calls = []
    const payments = {
      name: 'recording-payments',
      createIntent: (input) => {
        calls.push(['createIntent', input])
        return { id: 'ext_1', status: 'REQUIRES_CAPTURE', ...input }
      },
      capture: (id) => {
        calls.push(['capture', id])
        return { id, status: 'SUCCEEDED' }
      },
      refund: (id) => ({ id, status: 'REFUNDED' }),
      getStatus: (id) => ({ id, status: 'SUCCEEDED' }),
    }

    expect(providers.assertPaymentProvider(payments)).toBe(payments)

    const inMemory = providers.createInMemoryProviderRegistry()
    const registry = providers.createProviderRegistry({
      payments,
      email: inMemory.email,
      sms: inMemory.sms,
      storage: inMemory.storage,
    })

    const intent = registry.payments.createIntent({ amountCents: 100, currency: 'INR' })
    registry.payments.capture(intent.id)

    expect(calls).toEqual([
      ['createIntent', { amountCents: 100, currency: 'INR' }],
      ['capture', 'ext_1'],
    ])
  })

  it('is rejected at wiring time when it is incomplete', () => {
    expect(() =>
      providers.createProviderRegistry({
        payments: { name: 'broken', createIntent: () => ({}) },
        email: { name: 'e', send: () => ({}) },
        sms: { name: 's', send: () => ({}) },
        storage: { name: 'st', put: () => ({}), getUrl: () => '', delete: () => true },
      }),
    ).toThrowError(/capture\(\) is missing/)
  })
})
