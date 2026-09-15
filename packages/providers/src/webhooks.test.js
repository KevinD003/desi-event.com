import { describe, expect, it } from 'vitest'

import { ProviderError } from './errors.js'
import {
  HANDLED_EVENTS,
  SIGNATURE_HEADER,
  TOLERANCE_SECONDS,
  computeSignature,
  isHandledEvent,
  parseSignatureHeader,
  signPayload,
  verifyWebhook,
} from './webhooks.js'

/** A signing secret. Local to these tests; nothing Stripe ever issued. */
const SECRET = 'whsec_fake_local_secret_for_tests_only'

/** A different one, for the wrong-secret cases. */
const CONNECT_SECRET = 'whsec_fake_local_connect_secret_for_tests'

/** A fixed moment, so timestamp tolerance is not a wall-clock race. */
const NOW = new Date('2026-09-15T12:00:00.000Z')

/** `NOW` as Stripe writes it. */
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

/**
 * A Stripe event body, as bytes.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {Buffer} The exact bytes a delivery would carry.
 */
function body(overrides = {}) {
  return Buffer.from(
    JSON.stringify({
      id: 'evt_test_fixture',
      type: 'payment_intent.succeeded',
      created: NOW_SECONDS,
      api_version: '2025-08-27.basil',
      data: { object: { id: 'pi_test_fixture', amount: 250_000, currency: 'inr' } },
      ...overrides,
    }),
  )
}

/**
 * A signed delivery.
 *
 * @param {object} [options] Options.
 * @param {Buffer} [options.rawBody] The bytes.
 * @param {string} [options.secret] The secret to sign with.
 * @param {number} [options.timestamp] Unix seconds.
 * @returns {object} Arguments for {@link verifyWebhook}.
 */
function delivery({ rawBody = body(), secret = SECRET, timestamp = NOW_SECONDS } = {}) {
  return {
    rawBody,
    signature: signPayload(rawBody, secret, timestamp),
    secret: SECRET,
    now: NOW,
  }
}

describe('verifyWebhook', () => {
  it('accepts a delivery signed with the endpoint secret', () => {
    const result = verifyWebhook(delivery())

    expect(result.event.id).toBe('evt_test_fixture')
    expect(result.event.type).toBe('payment_intent.succeeded')
    expect(result.apiVersion).toBe('2025-08-27.basil')
    expect(result.createdAt.toISOString()).toBe(NOW.toISOString())
  })

  it('reports the connected account an event is about', () => {
    const result = verifyWebhook(delivery({ rawBody: body({ account: 'acct_test_fixture' }) }))

    expect(result.accountContext).toBe('acct_test_fixture')
  })

  it('reports no account for a platform event', () => {
    expect(verifyWebhook(delivery()).accountContext).toBeNull()
  })

  it('refuses a body that changed by one byte', () => {
    // The property the whole module exists for. The signature is over the bytes,
    // so an amount edited in flight does not verify.
    const original = body()
    const tampered = Buffer.from(original.toString('utf8').replace('250000', '250001'))

    expect(() => verifyWebhook({ ...delivery({ rawBody: original }), rawBody: tampered })).toThrow(
      ProviderError,
    )
  })

  it.each([
    ['a string', 'not a buffer'],
    ['a parsed object', { id: 'evt_1', type: 'payment_intent.succeeded' }],
    ['null', null],
    ['undefined', undefined],
    ['a Uint8Array that is not a Buffer', new Uint8Array([1, 2, 3])],
  ])('refuses %s as the raw body', (_label, rawBody) => {
    // Not a convenience check. A body that arrives as anything but bytes has been
    // through a parser, and its bytes are no longer the bytes Stripe signed — so
    // a permissive path here is a path that verifies nothing.
    expect(() => verifyWebhook({ ...delivery(), rawBody })).toThrow(ProviderError)
  })

  it('says, in the log detail, that the body was re-encoded', () => {
    try {
      verifyWebhook({ ...delivery(), rawBody: body().toString('utf8') })
    } catch (error) {
      expect(error.details.reason).toMatch(/parsed or re-encoded/)
    }
  })

  it('refuses a delivery signed with a different secret', () => {
    // The Connect endpoint's secret must not verify a platform delivery: a
    // Connect event names an account, and cross-verifying would let one
    // impersonate the other.
    expect(() =>
      verifyWebhook({ ...delivery({ secret: CONNECT_SECRET }), secret: SECRET }),
    ).toThrow(ProviderError)
  })

  it.each([
    ['no secret', undefined],
    ['an empty secret', ''],
    ['a non-string secret', 12_345],
  ])('refuses a delivery when the endpoint has %s', (_label, secret) => {
    expect(() => verifyWebhook({ ...delivery(), secret })).toThrow(ProviderError)
  })

  it.each([
    ['no signature header', undefined],
    ['an empty signature header', ''],
    ['a header with no timestamp', 'v1=abc'],
    ['a header with no v1 signature', `t=${NOW_SECONDS}`],
    ['a header that is not a signature at all', 'hello'],
    ['a header with a non-numeric timestamp', `t=soon,v1=abc`],
  ])('refuses %s', (_label, signature) => {
    expect(() => verifyWebhook({ ...delivery(), signature })).toThrow(ProviderError)
  })

  it('refuses a timestamp outside the tolerance', () => {
    const stale = NOW_SECONDS - TOLERANCE_SECONDS - 1

    expect(() => verifyWebhook(delivery({ timestamp: stale }))).toThrow(ProviderError)
  })

  it('accepts a timestamp at the edge of the tolerance', () => {
    const edge = NOW_SECONDS - TOLERANCE_SECONDS

    expect(verifyWebhook(delivery({ timestamp: edge })).event.id).toBe('evt_test_fixture')
  })

  it('refuses a timestamp too far in the future as well as too far in the past', () => {
    // Symmetric, because a clock skewed the other way is the same problem and an
    // attacker can choose the direction.
    const ahead = NOW_SECONDS + TOLERANCE_SECONDS + 1

    expect(() => verifyWebhook(delivery({ timestamp: ahead }))).toThrow(ProviderError)
  })

  it('accepts a header carrying more than one v1 signature', () => {
    // What a secret rotation looks like on the wire.
    const raw = body()
    const good = computeSignature(raw, NOW_SECONDS, SECRET)
    const other = computeSignature(raw, NOW_SECONDS, CONNECT_SECRET)

    expect(
      verifyWebhook({
        rawBody: raw,
        signature: `t=${NOW_SECONDS},v1=${other},v1=${good}`,
        secret: SECRET,
        now: NOW,
      }).event.id,
    ).toBe('evt_test_fixture')
  })

  it('refuses a signature of the right length that is simply wrong', () => {
    const raw = body()
    const wrong = computeSignature(raw, NOW_SECONDS, SECRET).replace(/^./, (character) =>
      character === 'a' ? 'b' : 'a',
    )

    expect(() =>
      verifyWebhook({
        rawBody: raw,
        signature: `t=${NOW_SECONDS},v1=${wrong}`,
        secret: SECRET,
        now: NOW,
      }),
    ).toThrow(ProviderError)
  })

  it('refuses a signed payload that is not JSON', () => {
    const raw = Buffer.from('this is signed and is not json')

    expect(() =>
      verifyWebhook({
        rawBody: raw,
        signature: signPayload(raw, SECRET, NOW_SECONDS),
        secret: SECRET,
        now: NOW,
      }),
    ).toThrow(ProviderError)
  })

  it.each([
    ['no id', { id: undefined }],
    ['no type', { type: undefined }],
  ])('refuses a signed payload with %s', (_label, overrides) => {
    const raw = body(overrides)

    expect(() =>
      verifyWebhook({
        rawBody: raw,
        signature: signPayload(raw, SECRET, NOW_SECONDS),
        secret: SECRET,
        now: NOW,
      }),
    ).toThrow(ProviderError)
  })

  it('tells every failed sender the same thing', () => {
    const attempts = [
      { ...delivery(), signature: 'v1=abc' },
      { ...delivery(), signature: `t=${NOW_SECONDS},v1=deadbeef` },
      delivery({ timestamp: NOW_SECONDS - 10_000 }),
      delivery({ secret: CONNECT_SECRET }),
    ]

    const messages = attempts.map((attempt) => {
      try {
        verifyWebhook(attempt)
      } catch (error) {
        return error.message
      }

      return null
    })

    // Which part of a forgery was wrong is a hint about how to fix it.
    expect(new Set(messages).size).toBe(1)
  })

  it('carries no secret and no payload in what it throws', () => {
    try {
      verifyWebhook(delivery({ secret: CONNECT_SECRET }))
    } catch (error) {
      const serialised = JSON.stringify({ message: error.message, details: error.details })

      expect(serialised).not.toContain(SECRET)
      expect(serialised).not.toContain(CONNECT_SECRET)
      expect(serialised).not.toContain('pi_test_fixture')
    }
  })

  it('has no mode that skips verification', () => {
    // Stated as a test because "just for local development" is how this gets
    // removed. There is no flag, and an absent secret is a refusal rather than a
    // bypass.
    expect(() => verifyWebhook({ ...delivery(), secret: '' })).toThrow(ProviderError)
    expect(() => verifyWebhook({ ...delivery(), secret: undefined })).toThrow(ProviderError)
  })
})

describe('parseSignatureHeader', () => {
  it('reads the timestamp and every signature', () => {
    expect(parseSignatureHeader('t=1789,v1=aaa,v1=bbb')).toEqual({
      timestamp: 1789,
      signatures: ['aaa', 'bbb'],
    })
  })

  it('tolerates whitespace, which proxies add', () => {
    expect(parseSignatureHeader(' t=1789 , v1=aaa ')).toEqual({
      timestamp: 1789,
      signatures: ['aaa'],
    })
  })

  it('ignores schemes it does not know', () => {
    // Stripe adds v0 for some event types; a parser that chokes on an unknown
    // scheme rejects valid deliveries.
    expect(parseSignatureHeader('t=1789,v0=zzz,v1=aaa')).toEqual({
      timestamp: 1789,
      signatures: ['aaa'],
    })
  })

  it.each([
    ['an empty header', ''],
    ['null', null],
    ['undefined', undefined],
  ])('returns nothing usable for %s', (_label, header) => {
    expect(parseSignatureHeader(header)).toEqual({ timestamp: null, signatures: [] })
  })
})

describe('computeSignature', () => {
  it('is deterministic', () => {
    expect(computeSignature(body(), NOW_SECONDS, SECRET)).toBe(
      computeSignature(body(), NOW_SECONDS, SECRET),
    )
  })

  it('changes when the timestamp changes', () => {
    expect(computeSignature(body(), NOW_SECONDS, SECRET)).not.toBe(
      computeSignature(body(), NOW_SECONDS + 1, SECRET),
    )
  })

  it('changes when the secret changes', () => {
    expect(computeSignature(body(), NOW_SECONDS, SECRET)).not.toBe(
      computeSignature(body(), NOW_SECONDS, CONNECT_SECRET),
    )
  })

  it('treats a string and its bytes identically', () => {
    const raw = body()

    expect(computeSignature(raw, NOW_SECONDS, SECRET)).toBe(
      computeSignature(raw.toString('utf8'), NOW_SECONDS, SECRET),
    )
  })

  it('separates the timestamp from the payload, so a shift cannot collide', () => {
    // Without the dot, `t=12` + `3{...}` and `t=123` + `{...}` sign identically.
    const twelve = computeSignature(Buffer.from('3{}'), 12, SECRET)
    const oneTwentyThree = computeSignature(Buffer.from('{}'), 123, SECRET)

    expect(twelve).not.toBe(oneTwentyThree)
  })
})

describe('HANDLED_EVENTS', () => {
  it('names the header Stripe signs with', () => {
    expect(SIGNATURE_HEADER).toBe('stripe-signature')
  })

  it('covers payments, refunds, disputes, Connect, transfers and payouts', () => {
    const prefixes = new Set(Object.keys(HANDLED_EVENTS).map((type) => type.split('.')[0]))

    expect([...prefixes].sort()).toEqual([
      'account',
      'charge',
      'payment_intent',
      'payout',
      'transfer',
    ])
  })

  it('maps every type to a distinct internal name', () => {
    const internal = Object.values(HANDLED_EVENTS)

    expect(new Set(internal).size).toBe(internal.length)
  })

  it('uses only types that look like Stripe event names', () => {
    for (const type of Object.keys(HANDLED_EVENTS)) {
      expect(type).toMatch(/^[a-z_]+(\.[a-z_]+)+$/)
    }
  })

  it('does not claim to handle a type it has no handler for', () => {
    expect(isHandledEvent('invoice.paid')).toBe(false)
    expect(isHandledEvent('customer.subscription.created')).toBe(false)
    expect(isHandledEvent('')).toBe(false)
    expect(isHandledEvent(undefined)).toBe(false)
  })

  it('does not match by prefix', () => {
    // A prefix match on `payment_intent.` would silently start handling a type
    // that does not mean what the handler assumes.
    expect(isHandledEvent('payment_intent.partially_funded')).toBe(false)
  })

  it('distinguishes the two 3-D Secure-adjacent states from a failure', () => {
    expect(HANDLED_EVENTS['payment_intent.requires_action']).toBe('payment.requires_action')
    expect(HANDLED_EVENTS['payment_intent.processing']).toBe('payment.processing')
    expect(HANDLED_EVENTS['payment_intent.payment_failed']).toBe('payment.failed')
  })
})
