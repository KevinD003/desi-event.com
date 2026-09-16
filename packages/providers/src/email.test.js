import { describe, it, expect } from 'vitest'

import { createInMemoryEmailProvider, EMAIL_BOUNCE_ADDRESS, DEFAULT_EMAIL_FROM } from './email.js'
import { assertEmailProvider } from './interfaces.js'

const NOW = '2026-09-14T10:00:00.000Z'

/**
 * A provider with a frozen clock.
 *
 * @param {object} [options] Extra construction options.
 * @returns {object} A fresh in-memory email provider.
 */
function makeProvider(options = {}) {
  return createInMemoryEmailProvider({ now: NOW, ...options })
}

/** A minimal message that every validation rule accepts. */
const VALID = { to: 'buyer@example.com', subject: 'Your tickets', text: 'Enjoy the show' }

describe('createInMemoryEmailProvider', () => {
  it('satisfies the email provider interface', () => {
    const provider = makeProvider()

    expect(() => assertEmailProvider(provider)).not.toThrow()
    expect(provider.name).toBe('in-memory-email')
    expect(provider.from).toBe(DEFAULT_EMAIL_FROM)
    expect(provider.sent).toEqual([])
  })

  it('rejects a default sender that is not an address', () => {
    expect(() => createInMemoryEmailProvider({ from: 'not-an-address' })).toThrowError(
      /valid email address/,
    )
  })

  it('accepts a custom name, sender and bounce address', () => {
    const provider = makeProvider({
      name: 'ses',
      from: 'Tickets@Desi-Event.com',
      bounceAddress: 'fail@desi-event.test',
    })

    expect(provider.name).toBe('ses')
    expect(provider.from).toBe('tickets@desi-event.com')
    expect(() => provider.send({ ...VALID, to: 'fail@desi-event.test' })).toThrowError(
      /Delivery to fail@desi-event.test failed/,
    )
  })
})

describe('send', () => {
  it('records the message and returns a receipt', () => {
    const provider = makeProvider()
    const receipt = provider.send(VALID)

    expect(receipt).toEqual({
      id: 'email_000001',
      providerRef: 'email_000001',
      accepted: ['buyer@example.com'],
      status: 'SENT',
      sentAt: NOW,
    })
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0]).toMatchObject({
      id: 'email_000001',
      from: DEFAULT_EMAIL_FROM,
      to: ['buyer@example.com'],
      cc: [],
      bcc: [],
      subject: 'Your tickets',
      text: 'Enjoy the show',
      html: null,
      sentAt: NOW,
    })
  })

  it('normalises recipients: trimmed, lower-cased and de-duplicated', () => {
    const provider = makeProvider()
    provider.send({ ...VALID, to: ['  Buyer@Example.com ', 'BUYER@example.com', 'b@example.com'] })

    expect(provider.sent[0].to).toEqual(['buyer@example.com', 'b@example.com'])
  })

  it('accepts cc, bcc, replyTo and a per-message sender', () => {
    const provider = makeProvider()
    provider.send({
      ...VALID,
      from: 'organiser@example.com',
      replyTo: 'support@example.com',
      cc: 'manager@example.com',
      bcc: ['audit@example.com'],
      html: '<p>Enjoy</p>',
      metadata: { orderId: 'ord_1' },
    })

    expect(provider.sent[0]).toMatchObject({
      from: 'organiser@example.com',
      replyTo: 'support@example.com',
      cc: ['manager@example.com'],
      bcc: ['audit@example.com'],
      html: '<p>Enjoy</p>',
      metadata: { orderId: 'ord_1' },
    })
  })

  it('accepts an HTML-only message', () => {
    const provider = makeProvider()
    provider.send({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' })

    expect(provider.sent[0].text).toBeNull()
    expect(provider.sent[0].html).toBe('<p>Hi</p>')
  })

  it('freezes each record so a test cannot corrupt the history it is asserting on', () => {
    const provider = makeProvider()
    const receipt = provider.send(VALID)

    expect(Object.isFrozen(provider.sent[0])).toBe(true)
    expect(Object.isFrozen(provider.sent[0].to)).toBe(true)
    expect(Object.isFrozen(receipt)).toBe(true)
  })

  it('keeps messages in send order with sequential ids', () => {
    const provider = makeProvider()
    provider.send({ ...VALID, subject: 'First' })
    provider.send({ ...VALID, subject: 'Second' })

    expect(provider.sent.map((message) => [message.id, message.subject])).toEqual([
      ['email_000001', 'First'],
      ['email_000002', 'Second'],
    ])
  })

  it('rejects a non-object message', () => {
    const provider = makeProvider()

    expect(() => provider.send()).toThrowError(/send expects a message object/)
    expect(() => provider.send(null)).toThrowError(/send expects a message object/)
    expect(() => provider.send('hello')).toThrowError(/send expects a message object/)
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty array', []],
    ['an unusable address', 'not-an-address'],
    ['an array holding an unusable address', ['ok@example.com', 'nope']],
    ['a number', 42],
  ])('rejects the recipient list when it is %s', (_label, to) => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, to })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_RECIPIENT')
      expect(error.statusCode).toBe(400)
      expect(error.details.field).toBe('to')
    }

    expect(provider.sent).toHaveLength(0)
  })

  it('names the offending addresses', () => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, to: ['ok@example.com', 'nope', 'also bad'] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.details.invalid).toEqual(['nope', 'also bad'])
      expect(error.message).toMatch(/2 unusable address/)
    }
  })

  it('caps the number of recipients', () => {
    const provider = makeProvider()
    const to = Array.from({ length: 51 }, (_unused, index) => `a${index}@example.com`)

    try {
      provider.send({ ...VALID, to })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_RECIPIENT')
      expect(error.details).toMatchObject({ count: 51, maxRecipients: 50 })
    }
  })

  it('validates cc and bcc as strictly as to', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, cc: 'nope' })).toThrowError(/cc/)
    expect(() => provider.send({ ...VALID, bcc: ['nope'] })).toThrowError(/bcc/)
    expect(() => provider.send({ ...VALID, cc: null })).not.toThrow()
  })

  it('rejects an unusable from or replyTo', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, from: 'nope' })).toThrowError(/`from`/)
    expect(() => provider.send({ ...VALID, replyTo: 'nope' })).toThrowError(/`replyTo`/)
  })

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['not a string', 7],
  ])('rejects a subject that is %s', (_label, subject) => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, subject })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_MESSAGE')
    }
  })

  it('caps the subject length', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, subject: 'x'.repeat(201) })).toThrowError(
      /at most 200 characters/,
    )
    expect(() => provider.send({ ...VALID, subject: 'x'.repeat(200) })).not.toThrow()
  })

  it('requires a non-empty text or html body', () => {
    const provider = makeProvider()

    try {
      provider.send({ to: 'a@example.com', subject: 'Hi' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_MESSAGE')
      expect(error.message).toMatch(/`text` or `html` body/)
    }

    expect(() => provider.send({ to: 'a@example.com', subject: 'Hi', text: '  ' })).toThrowError(
      /`text` or `html` body/,
    )
  })

  it('caps the body length', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, text: 'x'.repeat(200_001) })).toThrowError(
      /at most 200000 characters/,
    )
    expect(() =>
      provider.send({ to: 'a@example.com', subject: 'Hi', html: 'x'.repeat(200_001) }),
    ).toThrowError(/at most 200000 characters/)
  })

  it('rejects non-object metadata', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, metadata: 'nope' })).toThrowError(/plain object/)
  })
})

describe('the deterministic failure trigger', () => {
  it('fails delivery to the bounce address and records nothing', () => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, to: EMAIL_BOUNCE_ADDRESS })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('SEND_FAILED')
      expect(error.statusCode).toBe(502)
      expect(error.details.bounced).toEqual([EMAIL_BOUNCE_ADDRESS])
    }

    expect(provider.sent).toHaveLength(0)
  })

  it('fails when the bounce address hides among cc recipients', () => {
    const provider = makeProvider()

    expect(() => provider.send({ ...VALID, cc: EMAIL_BOUNCE_ADDRESS })).toThrowError(/failed/)
  })

  it('fails on forceFailure regardless of recipient', () => {
    const provider = makeProvider()

    try {
      provider.send({ ...VALID, forceFailure: true })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('SEND_FAILED')
      expect(error.message).toMatch(/forceFailure/)
    }
  })

  it('validates the message before deciding to fail, so a bad message is reported as such', () => {
    const provider = makeProvider()

    try {
      provider.send({ to: EMAIL_BOUNCE_ADDRESS, subject: '', text: 'x' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_MESSAGE')
    }
  })
})

describe('lastSent and reset', () => {
  it('reports the most recent message', () => {
    const provider = makeProvider()

    expect(provider.lastSent()).toBeUndefined()
    provider.send({ ...VALID, subject: 'First' })
    provider.send({ ...VALID, subject: 'Second' })
    expect(provider.lastSent().subject).toBe('Second')
  })

  it('empties the log while keeping the array identity a test may hold', () => {
    const provider = makeProvider()
    const log = provider.sent
    provider.send(VALID)
    provider.reset()

    expect(log).toBe(provider.sent)
    expect(log).toHaveLength(0)
    expect(provider.send(VALID).id).toBe('email_000002')
  })
})
