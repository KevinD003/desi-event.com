import { describe, expect, it } from 'vitest'

import {
  TOKEN_BYTES,
  TOKEN_LIFETIMES,
  hashToken,
  issueToken,
  pseudonymize,
  tokenExpiry,
  tokenUsable,
  tokensMatch,
} from './tokens.js'

const KEY = 'a-pseudonymisation-key-long-enough'

describe('issueToken', () => {
  it('returns a secret and the digest to store for it', () => {
    const { secret, hash } = issueToken()

    expect(hash).toBe(hashToken(secret))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never returns the same secret twice', () => {
    const secrets = new Set()

    for (let index = 0; index < 500; index += 1) secrets.add(issueToken().secret)

    expect(secrets.size).toBe(500)
  })

  it('carries at least 256 bits, so guessing is not a threat model', () => {
    expect(TOKEN_BYTES).toBeGreaterThanOrEqual(32)

    // base64url of 32 bytes is 43 characters with no padding.
    expect(issueToken().secret).toHaveLength(43)
  })

  it('produces a secret that is safe in a URL', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(issueToken().secret).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('cannot be reversed from the digest', () => {
    const { secret, hash } = issueToken()

    expect(hash).not.toContain(secret)
    expect(hash).not.toContain(secret.slice(0, 8))
  })
})

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('changes completely when the input changes by one character', () => {
    const a = hashToken('token-a')
    const b = hashToken('token-b')
    const shared = [...a].filter((character, index) => character === b[index]).length

    // Two independent hex digests share about 1/16 of their positions by chance.
    // Anything close to 64 would mean the digest was carrying the input.
    expect(shared).toBeLessThan(20)
  })

  it('treats a non-string as its string form rather than throwing', () => {
    expect(hashToken(42)).toBe(hashToken('42'))
  })
})

describe('tokensMatch', () => {
  it('accepts identical digests', () => {
    const digest = hashToken('x')

    expect(tokensMatch(digest, digest)).toBe(true)
  })

  it('rejects different digests', () => {
    expect(tokensMatch(hashToken('x'), hashToken('y'))).toBe(false)
  })

  it.each([
    ['one digest missing', null, hashToken('x')],
    ['both missing', null, null],
    ['an empty string', '', ''],
    ['different lengths', 'abc', 'abcd'],
    ['a non-string', 123, '123'],
  ])('rejects %s without throwing', (_label, left, right) => {
    expect(tokensMatch(left, right)).toBe(false)
  })

  it('rejects a digest that differs only in its last character', () => {
    const digest = hashToken('x')
    const nearly = `${digest.slice(0, -1)}${digest.at(-1) === 'a' ? 'b' : 'a'}`

    expect(tokensMatch(digest, nearly)).toBe(false)
  })
})

describe('tokenExpiry', () => {
  const now = new Date('2026-09-15T12:00:00.000Z')

  it.each(Object.keys(TOKEN_LIFETIMES))('gives %s a bounded lifetime', (purpose) => {
    const expiry = tokenExpiry(purpose, now)

    expect(expiry.getTime()).toBe(now.getTime() + TOKEN_LIFETIMES[purpose])
    expect(TOKEN_LIFETIMES[purpose]).toBeGreaterThan(0)
  })

  it('gives a password reset the shortest life of any emailed token', () => {
    expect(TOKEN_LIFETIMES.PASSWORD_RESET).toBeLessThan(TOKEN_LIFETIMES.EMAIL_VERIFICATION)
    expect(TOKEN_LIFETIMES.PASSWORD_RESET).toBeLessThanOrEqual(60 * 60 * 1000)
  })

  it('refuses a purpose with no configured lifetime, rather than meaning forever', () => {
    expect(() => tokenExpiry('SOMETHING_NEW', now)).toThrow(RangeError)
    expect(() => tokenExpiry(undefined, now)).toThrow(RangeError)
  })
})

describe('tokenUsable', () => {
  const now = new Date('2026-09-15T12:00:00.000Z')
  const later = new Date('2026-09-15T13:00:00.000Z')
  const earlier = new Date('2026-09-15T11:00:00.000Z')

  /**
   * A usable token row.
   *
   * @param {object} [overrides] Fields to change.
   * @returns {object} An `AuthToken`-shaped row.
   */
  const token = (overrides = {}) => ({
    purpose: 'PASSWORD_RESET',
    expiresAt: later,
    usedAt: null,
    revokedAt: null,
    ...overrides,
  })

  it('accepts an unused, unexpired, unrevoked token', () => {
    expect(tokenUsable(token(), { purpose: 'PASSWORD_RESET', now })).toEqual({
      usable: true,
      reason: null,
    })
  })

  it.each([
    ['a missing token', null, 'unknown'],
    ['undefined', undefined, 'unknown'],
  ])('refuses %s', (_label, value, reason) => {
    expect(tokenUsable(value, { now })).toEqual({ usable: false, reason })
  })

  it('refuses a token issued for a different purpose', () => {
    // The attack this closes: redeem an email-verification link at the
    // password-reset endpoint, and set a password without knowing the old one.
    const result = tokenUsable(token({ purpose: 'EMAIL_VERIFICATION' }), {
      purpose: 'PASSWORD_RESET',
      now,
    })

    expect(result).toEqual({ usable: false, reason: 'wrong_purpose' })
  })

  it('refuses a token that has already been used', () => {
    expect(tokenUsable(token({ usedAt: earlier }), { now })).toEqual({
      usable: false,
      reason: 'already_used',
    })
  })

  it('refuses a revoked token', () => {
    expect(tokenUsable(token({ revokedAt: earlier }), { now })).toEqual({
      usable: false,
      reason: 'revoked',
    })
  })

  it('refuses an expired token', () => {
    expect(tokenUsable(token({ expiresAt: earlier }), { now })).toEqual({
      usable: false,
      reason: 'expired',
    })
  })

  it('refuses a token expiring exactly now', () => {
    expect(tokenUsable(token({ expiresAt: now }), { now })).toEqual({
      usable: false,
      reason: 'expired',
    })
  })

  it.each([
    ['a string', '2026-09-15T13:00:00.000Z'],
    ['a number', 1_789_000_000_000],
    ['null', null],
  ])('refuses a token whose expiry is %s rather than a Date', (_label, expiresAt) => {
    expect(tokenUsable(token({ expiresAt }), { now })).toEqual({
      usable: false,
      reason: 'malformed',
    })
  })

  it('reports revocation before use, so an administrative revocation is what gets logged', () => {
    const result = tokenUsable(token({ revokedAt: earlier, usedAt: earlier }), { now })

    expect(result.reason).toBe('revoked')
  })
})

describe('pseudonymize', () => {
  it('is deterministic for the same value and key', () => {
    expect(pseudonymize('buyer@example.com', KEY)).toBe(pseudonymize('buyer@example.com', KEY))
  })

  it('differs between keys, so one deployment cannot read another', () => {
    expect(pseudonymize('buyer@example.com', KEY)).not.toBe(
      pseudonymize('buyer@example.com', `${KEY}-other`),
    )
  })

  it('does not contain the value', () => {
    const digest = pseudonymize('buyer@example.com', KEY)

    expect(digest).not.toContain('buyer')
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates the key from the value, so a shift cannot collide', () => {
    // Without a separator, ('ab' + 'c') and ('a' + 'bc') hash identically.
    expect(pseudonymize('c', 'ab-padded-to-sixteen-chars')).not.toBe(
      pseudonymize('bc', 'a-padded-to-sixteen-charsx'),
    )
  })

  it.each([
    ['no key', undefined],
    ['an empty key', ''],
    ['a key too short to be a secret', 'short'],
    ['a non-string key', 1_234_567_890_123],
  ])('refuses %s, because an unkeyed digest of an IP address is reversible', (_label, key) => {
    expect(() => pseudonymize('203.0.113.1', key)).toThrow(TypeError)
  })

  it('treats a missing value as the empty string rather than throwing', () => {
    expect(pseudonymize(null, KEY)).toBe(pseudonymize('', KEY))
    expect(pseudonymize(undefined, KEY)).toBe(pseudonymize('', KEY))
  })

  it('distinguishes addresses that differ in one octet', () => {
    expect(pseudonymize('203.0.113.1', KEY)).not.toBe(pseudonymize('203.0.113.2', KEY))
  })
})
