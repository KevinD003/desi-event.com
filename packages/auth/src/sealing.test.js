import { describe, expect, it } from 'vitest'

import {
  MINIMUM_SEALING_SECRET_LENGTH,
  SEAL_PREFIX,
  deriveSealingKey,
  seal,
  sealsMatch,
  unseal,
} from './sealing.js'

const SECRET = 'fake-sealing-secret-for-tests-not-a-real-one'
const OPTIONS = { secret: SECRET, purpose: 'mfa-totp' }

describe('seal and unseal', () => {
  it('round-trips a value', () => {
    expect(unseal(seal('JBSWY3DPEHPK3PXP', OPTIONS), OPTIONS)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('produces a different ciphertext every time, because the nonce is fresh', () => {
    const first = seal('same secret', OPTIONS)
    const second = seal('same secret', OPTIONS)

    expect(first).not.toBe(second)
    expect(unseal(first, OPTIONS)).toBe(unseal(second, OPTIONS))
  })

  it('never contains the plaintext', () => {
    const sealed = seal('DISTINCTIVEPLAINTEXT', OPTIONS)

    expect(sealed).not.toContain('DISTINCTIVE')
    expect(sealed).not.toContain('PLAINTEXT')
  })

  it('is versioned, so a future format is a new prefix rather than a guess', () => {
    expect(seal('x', OPTIONS).startsWith(`${SEAL_PREFIX}$`)).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['a long value', 'x'.repeat(4096)],
    ['every awkward byte', 'ünï😀 "quotes" $dollar$ \\backslash'],
  ])('round-trips %s', (_label, value) => {
    expect(unseal(seal(value, OPTIONS), OPTIONS)).toBe(value)
  })
})

describe('unseal refuses', () => {
  it('a value sealed with a different secret', () => {
    const sealed = seal('secret', OPTIONS)

    expect(() => unseal(sealed, { secret: `${SECRET}-different`, purpose: 'mfa-totp' })).toThrow(
      /did not authenticate/,
    )
  })

  it('a value sealed for a different purpose', () => {
    // The property that makes one deployment secret safe to reuse: a value
    // sealed for MFA cannot be opened by code that seals onboarding links.
    const sealed = seal('secret', OPTIONS)

    expect(() => unseal(sealed, { secret: SECRET, purpose: 'connect-onboarding' })).toThrow(
      /did not authenticate/,
    )
  })

  it('a tampered ciphertext', () => {
    const parts = seal('secret', OPTIONS).split('$')
    const flipped = `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`

    expect(() => unseal([...parts.slice(0, 4), flipped].join('$'), OPTIONS)).toThrow(
      /did not authenticate/,
    )
  })

  it('a tampered authentication tag', () => {
    // The *first* character, not the last: base64url of sixteen bytes is
    // twenty-two characters, and the last one carries four bits of padding that
    // decoding discards — so changing it can leave the same bytes behind.
    const parts = seal('secret', OPTIONS).split('$')
    const flipped = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`

    expect(() => unseal([...parts.slice(0, 3), flipped, parts[4]].join('$'), OPTIONS)).toThrow(
      /did not authenticate/,
    )
  })

  it('a swapped nonce from another sealed value', () => {
    const mine = seal('mine', OPTIONS).split('$')
    const theirs = seal('theirs', OPTIONS).split('$')

    expect(() =>
      unseal([...mine.slice(0, 2), theirs[2], mine[3], mine[4]].join('$'), OPTIONS),
    ).toThrow()
  })

  it.each([
    ['a plain string', 'not-sealed'],
    ['an empty string', ''],
    ['null', null],
    ['too few fields', 'aesgcm$1$nonce$tag'],
    ['an unknown version', 'aesgcm$9$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA$AAAA'],
  ])('%s', (_label, value) => {
    expect(() => unseal(value, OPTIONS)).toThrow()
  })

  it.each([
    ['a short nonce', 2],
    ['a short tag', 3],
  ])('a value with %s', (_label, index) => {
    const parts = seal('secret', OPTIONS).split('$')
    parts[index] = 'AAAA'

    expect(() => unseal(parts.join('$'), OPTIONS)).toThrow(/malformed/)
  })

  it('says the same thing whether the key was wrong or the bytes were changed', () => {
    const sealed = seal('secret', OPTIONS)
    const parts = sealed.split('$')
    const flipped = `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`

    const wrongKey = (() => {
      try {
        unseal(sealed, { secret: `${SECRET}x`, purpose: 'mfa-totp' })
      } catch (error) {
        return error.message
      }
    })()
    const tampered = (() => {
      try {
        unseal([...parts.slice(0, 4), flipped].join('$'), OPTIONS)
      } catch (error) {
        return error.message
      }
    })()

    expect(wrongKey).toBe(tampered)
  })
})

describe('deriveSealingKey', () => {
  it('gives a 256-bit key', () => {
    expect(deriveSealingKey(SECRET, 'mfa-totp')).toHaveLength(32)
  })

  it('gives different keys for different purposes', () => {
    expect(deriveSealingKey(SECRET, 'a').equals(deriveSealingKey(SECRET, 'b'))).toBe(false)
  })

  it('is deterministic', () => {
    expect(deriveSealingKey(SECRET, 'x').equals(deriveSealingKey(SECRET, 'x'))).toBe(true)
  })

  it.each([
    ['no secret', undefined],
    ['an empty secret', ''],
    ['a secret one character too short', 'x'.repeat(MINIMUM_SEALING_SECRET_LENGTH - 1)],
    ['a non-string secret', 1234],
  ])('refuses %s', (_label, secret) => {
    expect(() => deriveSealingKey(secret, 'mfa-totp')).toThrow(TypeError)
  })

  it('accepts a secret at exactly the minimum length', () => {
    expect(() => deriveSealingKey('x'.repeat(MINIMUM_SEALING_SECRET_LENGTH), 'p')).not.toThrow()
  })

  it.each([
    ['no purpose', undefined],
    ['an empty purpose', ''],
  ])('refuses %s, so two uses cannot share a key', (_label, purpose) => {
    expect(() => deriveSealingKey(SECRET, purpose)).toThrow(TypeError)
  })
})

describe('sealsMatch', () => {
  it('is true for two sealings of the same plaintext', () => {
    expect(sealsMatch(seal('same', OPTIONS), seal('same', OPTIONS), OPTIONS)).toBe(true)
  })

  it('is false for different plaintexts', () => {
    expect(sealsMatch(seal('one', OPTIONS), seal('two', OPTIONS), OPTIONS)).toBe(false)
  })

  it('is false for plaintexts where one is a prefix of the other', () => {
    expect(sealsMatch(seal('secret', OPTIONS), seal('secretx', OPTIONS), OPTIONS)).toBe(false)
  })

  it('is false rather than throwing when a value cannot be opened', () => {
    expect(sealsMatch(seal('x', OPTIONS), 'not-sealed', OPTIONS)).toBe(false)
    expect(sealsMatch(null, null, OPTIONS)).toBe(false)
  })
})
