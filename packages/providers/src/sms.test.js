import { describe, it, expect } from 'vitest'

import { createInMemorySmsProvider, SMS_FAILURE_NUMBER, DEFAULT_SMS_SENDER } from './sms.js'
import { assertSmsProvider } from './interfaces.js'

const NOW = '2026-09-14T10:00:00.000Z'

/**
 * A provider with a frozen clock.
 *
 * @param {object} [options] Extra construction options.
 * @returns {object} A fresh in-memory SMS provider.
 */
function makeProvider(options = {}) {
  return createInMemorySmsProvider({ now: NOW, ...options })
}

/** A minimal message every validation rule accepts. */
const VALID = { to: '+919876543210', body: 'Your Garba tickets are confirmed.' }

describe('createInMemorySmsProvider', () => {
  it('satisfies the SMS provider interface', () => {
    const provider = makeProvider()

    expect(() => assertSmsProvider(provider)).not.toThrow()
    expect(provider.name).toBe('in-memory-sms')
    expect(provider.from).toBe(DEFAULT_SMS_SENDER)
    expect(provider.sent).toEqual([])
  })

  it('rejects an unusable default sender or failure number', () => {
    expect(() => createInMemorySmsProvider({ from: '   ' })).toThrowError(/non-empty string/)
    expect(() => createInMemorySmsProvider({ failureNumber: 'nope' })).toThrowError(
      /international format/,
    )
  })

  it('accepts a custom failure number', () => {
    const provider = makeProvider({ failureNumber: '+15550100111' })

    expect(() => provider.send({ ...VALID, to: '+15550100111' })).toThrowError(/failed/)
    expect(() => provider.send({ ...VALID, to: SMS_FAILURE_NUMBER })).not.toThrow()
  })
})

describe('send', () => {
  it('records the message and returns a receipt', () => {
    const provider = makeProvider()
    const receipt = provider.send(VALID)

    expect(receipt).toEqual({
      id: 'sms_000001',
      providerRef: 'sms_000001',
      to: '+919876543210',
      segments: 1,
      status: 'SENT',
      sentAt: NOW,
    })
    expect(provider.sent[0]).toMatchObject({
      from: DEFAULT_SMS_SENDER,
      to: '+919876543210',
      body: VALID.body,
      segments: 1,
      metadata: {},
      sentAt: NOW,
    })
  })

  it('compacts formatting so the same number is recorded one way', () => {
    const provider = makeProvider()
    provider.send({ ...VALID, to: '+1 (555) 234-5678' })

    expect(provider.sent[0].to).toBe('+15552345678')
  })

  it('counts billed segments in 160-character blocks', () => {
    const provider = makeProvider()

    expect(provider.send({ ...VALID, body: 'x' }).segments).toBe(1)
    expect(provider.send({ ...VALID, body: 'x'.repeat(160) }).segments).toBe(1)
    expect(provider.send({ ...VALID, body: 'x'.repeat(161) }).segments).toBe(2)
    expect(provider.send({ ...VALID, body: 'x'.repeat(320) }).segments).toBe(2)
    expect(provider.send({ ...VALID, body: 'x'.repeat(321) }).segments).toBe(3)
  })

  it('accepts a per-message sender and metadata', () => {
    const provider = makeProvider()
    provider.send({ ...VALID, from: 'DESIORG', metadata: { orderId: 'ord_1' } })

    expect(provider.sent[0]).toMatchObject({ from: 'DESIORG', metadata: { orderId: 'ord_1' } })
  })

  it('freezes each record and receipt', () => {
    const provider = makeProvider()
    const receipt = provider.send(VALID)

    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(provider.sent[0])).toBe(true)
  })

  it('rejects a non-object message', () => {
    const provider = makeProvider()

    expect(() => provider.send()).toThrowError(/send expects a message object/)
    expect(() => provider.send(null)).toThrowError(/send expects a message object/)
    expect(() => provider.send(['+919876543210'])).toThrowError(/send expects a message object/)
  })

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['too short', '+12'],
    ['alphabetic', 'call-me'],
    ['a number rather than a string', 919876543210],
  ])('rejects a recipient that is %s', (_label, to) => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, to })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_RECIPIENT')
      expect(error.details.field).toBe('to')
    }

    expect(provider.sent).toHaveLength(0)
  })

  it.each([
    ['absent', undefined],
    ['blank', '  '],
    ['not a string', 42],
  ])('rejects a body that is %s', (_label, body) => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, body })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_MESSAGE')
    }
  })

  it('caps the body at 1600 characters', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, body: 'x'.repeat(1601) })).toThrowError(
      /at most 1600 characters/,
    )
    expect(() => provider.send({ ...VALID, body: 'x'.repeat(1600) })).not.toThrow()
  })

  it('rejects an empty per-message sender and non-object metadata', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, from: '   ' })).toThrowError(/non-empty string/)
    expect(() => provider.send({ ...VALID, metadata: 7 })).toThrowError(/plain object/)
  })

  it('falls back to the default sender when from is null', () => {
    const provider = makeProvider()
    provider.send({ ...VALID, from: null })

    expect(provider.sent[0].from).toBe(DEFAULT_SMS_SENDER)
  })
})

describe('the deterministic failure trigger', () => {
  it('fails delivery to the reserved failure number', () => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, to: SMS_FAILURE_NUMBER })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('SEND_FAILED')
      expect(error.statusCode).toBe(502)
      expect(error.details.to).toBe(SMS_FAILURE_NUMBER)
    }

    expect(provider.sent).toHaveLength(0)
  })

  it('recognises the failure number however it is formatted', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, to: '+1 (555) 010-0199' })).toThrowError(/failed/)
  })

  it('fails on forceFailure', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, forceFailure: true })).toThrowError(/failed/)
  })
})

describe('lastSent and reset', () => {
  it('reports the most recent message and clears the log in place', () => {
    const provider = makeProvider()
    const log = provider.sent

    expect(provider.lastSent()).toBeUndefined()
    provider.send({ ...VALID, body: 'First' })
    provider.send({ ...VALID, body: 'Second' })
    expect(provider.lastSent().body).toBe('Second')

    provider.reset()
    expect(log).toBe(provider.sent)
    expect(provider.sent).toHaveLength(0)
  })
})
