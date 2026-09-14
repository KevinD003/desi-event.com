import { describe, it, expect } from 'vitest'

import {
  createProviderRegistry,
  createInMemoryProviderRegistry,
  resetProviderRegistry,
} from './registry.js'
import { PROVIDER_KINDS } from './interfaces.js'

/**
 * A complete set of stub adapters, so a test can knock out exactly one slot.
 *
 * @returns {object} Four conforming stubs keyed by provider kind.
 */
function stubs() {
  return {
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
}

describe('createProviderRegistry', () => {
  it('returns a frozen registry carrying exactly the four slots', () => {
    const registry = createProviderRegistry(stubs())

    expect(Object.keys(registry)).toEqual(['payments', 'email', 'sms', 'storage'])
    expect(Object.isFrozen(registry)).toBe(true)
  })

  it('keeps the adapter identities, so a test can hold its own reference', () => {
    const provided = stubs()
    const registry = createProviderRegistry(provided)

    for (const kind of PROVIDER_KINDS) expect(registry[kind]).toBe(provided[kind])
  })

  it('ignores extra keys rather than smuggling them into the registry', () => {
    const registry = createProviderRegistry({ ...stubs(), search: { name: 'algolia' } })

    expect(registry).not.toHaveProperty('search')
  })

  it('refuses writes once frozen', () => {
    const registry = createProviderRegistry(stubs())

    expect(() => {
      'use strict'
      registry.payments = null
    }).toThrow()
  })

  it.each(PROVIDER_KINDS)('throws immediately when %s is missing', (kind) => {
    const partial = stubs()
    delete partial[kind]

    try {
      createProviderRegistry(partial)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INCOMPLETE_REGISTRY')
      expect(error.statusCode).toBe(500)
      expect(error.details.missing).toEqual([kind])
      expect(error.issues).toEqual([
        { path: kind, code: 'missing_provider', message: `${kind} provider is missing` },
      ])
    }
  })

  it('treats an explicit null slot as missing', () => {
    try {
      createProviderRegistry({ ...stubs(), sms: null })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.details.missing).toEqual(['sms'])
    }
  })

  it('lists every missing slot at once', () => {
    try {
      createProviderRegistry({ payments: stubs().payments })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.details.missing).toEqual(['email', 'sms', 'storage'])
      expect(error.message).toBe('Provider registry is missing: email, sms, storage')
    }
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'providers'],
  ])('rejects %s as the argument', (_label, value) => {
    try {
      createProviderRegistry(value)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INCOMPLETE_REGISTRY')
      expect(error.details.missing).toEqual(['payments', 'email', 'sms', 'storage'])
      expect(error.issues).toHaveLength(4)
    }
  })

  it('rejects a slot that is present but does not implement its interface', () => {
    const broken = stubs()
    broken.storage = { name: 'half-storage', put: () => ({}) }

    try {
      createProviderRegistry(broken)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_PROVIDER')
      expect(error.provider).toBe('storage')
      expect(error.issues.map((issue) => issue.path)).toEqual(['getUrl', 'delete'])
    }
  })

  it('validates the payment slot before the later ones, naming the first broken kind', () => {
    const broken = stubs()
    broken.payments = { name: 'half-payments', createIntent: () => ({}) }
    broken.email = { name: 'half-email' }

    try {
      createProviderRegistry(broken)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.provider).toBe('payments')
    }
  })
})

describe('createInMemoryProviderRegistry', () => {
  it('wires four working in-memory adapters', () => {
    const registry = createInMemoryProviderRegistry()

    expect(registry.payments.name).toBe('in-memory-payments')
    expect(registry.email.name).toBe('in-memory-email')
    expect(registry.sms.name).toBe('in-memory-sms')
    expect(registry.storage.name).toBe('in-memory-storage')
    expect(Object.isFrozen(registry)).toBe(true)
  })

  it('supports a full checkout round trip', () => {
    const registry = createInMemoryProviderRegistry({ now: '2026-09-14T10:00:00.000Z' })
    const intent = registry.payments.createIntent({
      amountCents: 150_000,
      currency: 'INR',
      orderId: 'ord_1',
    })

    expect(registry.payments.capture(intent.id).status).toBe('SUCCEEDED')

    registry.email.send({
      to: 'buyer@example.com',
      subject: 'Order confirmed',
      text: `Paid ${intent.amountCents} cents`,
    })
    registry.sms.send({ to: '+919876543210', body: 'Your tickets are confirmed' })
    const asset = registry.storage.put({ key: 'tickets/ord_1.pdf', body: 'PDF' })

    expect(registry.email.sent[0].text).toBe('Paid 150000 cents')
    expect(registry.sms.sent).toHaveLength(1)
    expect(registry.storage.getUrl('tickets/ord_1.pdf')).toBe(asset.url)
    expect(registry.payments.refund(intent.id).status).toBe('REFUNDED')
  })

  it('shares the clock across all four providers', () => {
    const now = '2026-09-14T10:00:00.000Z'
    const registry = createInMemoryProviderRegistry({ now })

    const intent = registry.payments.createIntent({ amountCents: 100, currency: 'INR' })
    const receipt = registry.email.send({ to: 'a@example.com', subject: 'Hi', text: 'Hi' })
    const sms = registry.sms.send({ to: '+919876543210', body: 'Hi' })
    const object = registry.storage.put({ key: 'a.txt', body: 'x' })

    expect([intent.createdAt, receipt.sentAt, sms.sentAt, object.uploadedAt]).toEqual([
      now,
      now,
      now,
      now,
    ])
  })

  it('lets per-kind options override the shared clock', () => {
    const registry = createInMemoryProviderRegistry({
      now: '2026-09-14T10:00:00.000Z',
      email: { now: '2020-01-01T00:00:00.000Z', name: 'ses' },
    })

    const receipt = registry.email.send({ to: 'a@example.com', subject: 'Hi', text: 'Hi' })
    expect(receipt.sentAt).toBe('2020-01-01T00:00:00.000Z')
    expect(registry.email.name).toBe('ses')
  })

  it('forwards per-kind options', () => {
    const registry = createInMemoryProviderRegistry({
      payments: { name: 'razorpay-fake', declineAmountCents: 4242 },
      storage: { baseUrl: 'https://cdn.example.com', bucket: 'media' },
    })

    expect(registry.payments.name).toBe('razorpay-fake')
    expect(() =>
      registry.payments.createIntent({ amountCents: 4242, currency: 'INR' }),
    ).toThrowError(/declined/)
    expect(registry.storage.put({ key: 'a.txt', body: 'x' }).url).toBe(
      'https://cdn.example.com/media/a.txt',
    )
  })

  it('gives every registry its own state', () => {
    const first = createInMemoryProviderRegistry()
    const second = createInMemoryProviderRegistry()
    first.email.send({ to: 'a@example.com', subject: 'Hi', text: 'Hi' })

    expect(second.email.sent).toHaveLength(0)
  })

  it('surfaces a malformed forwarded option', () => {
    expect(() => createInMemoryProviderRegistry({ now: 'yesterday' })).toThrowError(
      /Date, epoch milliseconds/,
    )
  })
})

describe('resetProviderRegistry', () => {
  it('clears every in-memory provider in one call', () => {
    const registry = createInMemoryProviderRegistry()
    const intent = registry.payments.createIntent({ amountCents: 100, currency: 'INR' })
    registry.email.send({ to: 'a@example.com', subject: 'Hi', text: 'Hi' })
    registry.sms.send({ to: '+919876543210', body: 'Hi' })
    registry.storage.put({ key: 'a.txt', body: 'x' })

    expect(resetProviderRegistry(registry)).toEqual(['payments', 'email', 'sms', 'storage'])
    expect(registry.payments.listIntents()).toEqual([])
    expect(() => registry.payments.getStatus(intent.id)).toThrowError(/No payment intent/)
    expect(registry.email.sent).toHaveLength(0)
    expect(registry.sms.sent).toHaveLength(0)
    expect(registry.storage.list()).toEqual([])
  })

  it('skips adapters that do not expose reset', () => {
    const registry = createProviderRegistry(stubs())

    expect(resetProviderRegistry(registry)).toEqual([])
  })

  it('rejects a non-registry argument', () => {
    try {
      resetProviderRegistry(null)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_OPTIONS')
    }
    expect(() => resetProviderRegistry('registry')).toThrowError(/expects a provider registry/)
  })
})
