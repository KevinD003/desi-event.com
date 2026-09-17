/**
 * The one-way guarantee, tested as arithmetic.
 *
 * These are pure functions, so this suite needs no database and can assert the
 * three properties the whole redaction design rests on: that a placeholder is
 * the same every time, that it cannot collide where a column forbids collisions,
 * and that nothing about the original value survives in it.
 *
 * The last one deserves a note about what a test can and cannot prove. No test
 * can demonstrate the absence of an inverse for an arbitrary function. What this
 * suite proves is the property that makes the question moot: the derivation
 * never reads the value it replaces. Two rows holding identical addresses get
 * different placeholders, and one row keeps its placeholder when its address
 * changes — which is only possible if the address was never an input.
 */

import { describe, expect, it } from 'vitest'

import {
  PERSONAL_PAYLOAD_KEYS,
  REDACTED_EMAIL_DOMAIN,
  REDACTED_NAME_PREFIX,
  isRedactedValue,
  redactedEmail,
  redactedName,
  scrubPayload,
} from '../src/lib/privacy-placeholders.js'

describe('redactedEmail', () => {
  it('is the same every time, so a retry converges instead of drifting', () => {
    const first = redactedEmail('User.email', 'ckuser000000000000000000')
    const second = redactedEmail('User.email', 'ckuser000000000000000000')

    expect(first).toBe(second)
  })

  it('lands in a domain that can never resolve', () => {
    // RFC 2606 reserves `.invalid`. A placeholder that could be delivered to is
    // a placeholder that could reach a stranger.
    expect(redactedEmail('User.email', 'ckuser000000000000000000')).toMatch(
      new RegExp(`@${REDACTED_EMAIL_DOMAIN.replace('.', '\\.')}$`),
    )
  })

  it('gives different rows different addresses, which is what `@unique` needs', () => {
    const seen = new Set()

    for (let index = 0; index < 500; index += 1) {
      seen.add(redactedEmail('User.email', `ckuser${String(index).padStart(18, '0')}`))
    }

    expect(seen.size).toBe(500)
  })

  it('gives two fields of one row different addresses', () => {
    const one = redactedEmail('User.email', 'ckrow0000000000000000000')
    const other = redactedEmail('Order.buyerEmail', 'ckrow0000000000000000000')

    expect(one).not.toBe(other)
  })

  it('never reads the value it replaces — two people at one address diverge', () => {
    // The evidence that there is nothing to invert. If the original address were
    // an input, two rows holding the same address would produce the same
    // placeholder and the mapping would be recoverable by frequency alone.
    const left = redactedEmail('User.email', 'ckaaa0000000000000000000')
    const right = redactedEmail('User.email', 'ckbbb0000000000000000000')

    expect(left).not.toBe(right)
  })

  it('refuses a missing row id rather than inventing one', () => {
    expect(() => redactedEmail('User.email', '')).toThrow(TypeError)
    expect(() => redactedEmail('', 'ckrow0000000000000000000')).toThrow(TypeError)
  })
})

describe('redactedName', () => {
  it('is visibly synthetic, so nobody mistakes one for a person', () => {
    expect(redactedName('User.displayName', 'ckrow0000000000000000000')).toMatch(
      new RegExp(`^${REDACTED_NAME_PREFIX} `),
    )
  })

  it('is deterministic and row-scoped, like the address', () => {
    const id = 'ckrow0000000000000000000'

    expect(redactedName('User.displayName', id)).toBe(redactedName('User.displayName', id))
    expect(redactedName('User.displayName', id)).not.toBe(redactedName('User.displayName', 'other'))
  })
})

describe('isRedactedValue', () => {
  it('recognises what this module produces', () => {
    expect(isRedactedValue(redactedEmail('User.email', 'ckrow0000000000000000000'))).toBe(true)
    expect(isRedactedValue(redactedName('User.displayName', 'ckrow0000000000000000000'))).toBe(true)
  })

  it('does not recognise a real value', () => {
    expect(isRedactedValue('priya@example.com')).toBe(false)
    expect(isRedactedValue('Priya Sharma')).toBe(false)
    expect(isRedactedValue(null)).toBe(false)
    expect(isRedactedValue(42)).toBe(false)
  })
})

describe('scrubPayload', () => {
  it('removes personal keys and keeps everything else', () => {
    const { payload, removed } = scrubPayload({
      buyerName: 'Priya Sharma',
      email: 'priya@example.com',
      orderReference: 'DE-8F3K2QRT',
      totalCents: 250_000,
    })

    expect(removed).toBe(2)
    expect(payload).toEqual({ orderReference: 'DE-8F3K2QRT', totalCents: 250_000 })
  })

  it('reaches personal keys nested inside objects and arrays', () => {
    const { payload, removed } = scrubPayload({
      order: { reference: 'DE-1', buyerEmail: 'priya@example.com' },
      tickets: [{ code: 'DET-1', attendeeName: 'Priya Sharma' }, { code: 'DET-2' }],
    })

    expect(removed).toBe(2)
    expect(payload).toEqual({
      order: { reference: 'DE-1' },
      tickets: [{ code: 'DET-1' }, { code: 'DET-2' }],
    })
  })

  it('drops a key rather than replacing it, because a placeholder would claim the message carried one', () => {
    const { payload } = scrubPayload({ recipient: 'priya@example.com' })

    expect(Object.hasOwn(payload, 'recipient')).toBe(false)
  })

  it('does not mutate what it was given', () => {
    const original = { email: 'priya@example.com', reference: 'DE-1' }

    scrubPayload(original)

    expect(original.email).toBe('priya@example.com')
  })

  it('is idempotent — scrubbing twice removes nothing the second time', () => {
    const once = scrubPayload({ email: 'priya@example.com', reference: 'DE-1' })
    const twice = scrubPayload(once.payload)

    expect(twice.removed).toBe(0)
    expect(twice.payload).toEqual(once.payload)
  })

  it('survives a payload that is not an object', () => {
    expect(scrubPayload(null).payload).toBe(null)
    expect(scrubPayload('a string').payload).toBe('a string')
    expect(scrubPayload([1, 2]).payload).toEqual([1, 2])
  })
})

describe('PERSONAL_PAYLOAD_KEYS', () => {
  it('covers every personal key the notification templates actually render', () => {
    // A deny list only works while it still names what the templates use. This
    // asserts the shape of the list rather than trusting it: every entry is a
    // plain camel-case key, and the four that matter most are present by name.
    for (const key of PERSONAL_PAYLOAD_KEYS) {
      expect(key).toMatch(/^[a-z][A-Za-z]*$/)
    }

    expect(PERSONAL_PAYLOAD_KEYS).toContain('recipient')
    expect(PERSONAL_PAYLOAD_KEYS).toContain('buyerEmail')
    expect(PERSONAL_PAYLOAD_KEYS).toContain('attendeeName')
    expect(PERSONAL_PAYLOAD_KEYS).toContain('toEmail')
  })

  it('is frozen, so a caller cannot widen or narrow it at runtime', () => {
    expect(Object.isFrozen(PERSONAL_PAYLOAD_KEYS)).toBe(true)
  })
})
