import { describe, expect, it } from 'vitest'

import {
  HASH_PREFIX,
  LEGACY_BCRYPT,
  SCRYPT_PARAMETERS,
  decodePasswordHash,
  decoyHash,
  hashPassword,
  hashPasswordSync,
  needsRehash,
  verifyPassword,
} from './password.js'

/**
 * Parameters weak enough to run hundreds of times in a test suite.
 *
 * The real ones cost ~100ms and 32 MiB each, which is the point of them and also
 * ten seconds of test time per hundred hashes. Every behavioural property below
 * is independent of the cost, so the cost is turned down — except where the test
 * is specifically about the cost, which says so.
 */
const FAST = { ...SCRYPT_PARAMETERS, N: 1024, r: 8, p: 1 }

describe('hashPassword', () => {
  it('produces a versioned, self-describing hash', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST)

    expect(hash.startsWith(`${HASH_PREFIX}$`)).toBe(true)
    expect(hash.split('$')).toHaveLength(7)
  })

  it('records the parameters it used, so they can be raised later', async () => {
    const hash = await hashPassword('a password', FAST)
    const decoded = decodePasswordHash(hash)

    expect(decoded).toMatchObject({ N: FAST.N, r: FAST.r, p: FAST.p })
  })

  it('salts, so the same password twice is two different hashes', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same password', FAST),
      hashPassword('same password', FAST),
    ])

    expect(first).not.toBe(second)
    await expect(verifyPassword('same password', first)).resolves.toMatchObject({ valid: true })
    await expect(verifyPassword('same password', second)).resolves.toMatchObject({ valid: true })
  })

  it('never contains the password', async () => {
    const hash = await hashPassword('a-very-distinctive-password', FAST)

    expect(hash).not.toContain('distinctive')
  })

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['a number', 12_345_678],
    ['undefined', undefined],
  ])('refuses %s', async (_label, value) => {
    await expect(hashPassword(value, FAST)).rejects.toThrow(TypeError)
  })

  it('handles a password with every awkward byte in it', async () => {
    // Built rather than written as a literal, so the NUL byte is visible in the
    // source: a password field is a place a NUL genuinely arrives, and a hash
    // function that truncates at one is a hash function that accepts every
    // password sharing a prefix.
    const awkward = `pÄssword 😀 \t\n ${String.fromCharCode(0)} ümlaut "quotes" $dollar$ \\backslash`
    const hash = await hashPassword(awkward, FAST)

    await expect(verifyPassword(awkward, hash)).resolves.toMatchObject({ valid: true })
    await expect(verifyPassword(awkward.slice(0, -1), hash)).resolves.toMatchObject({
      valid: false,
    })
  })

  it('handles a password at the length a form would allow', async () => {
    const long = 'x'.repeat(128)
    const hash = await hashPassword(long, FAST)

    await expect(verifyPassword(long, hash)).resolves.toMatchObject({ valid: true })
    await expect(verifyPassword(`${long}x`, hash)).resolves.toMatchObject({ valid: false })
  })
})

describe('hashPasswordSync', () => {
  it('produces a hash the asynchronous verifier accepts', async () => {
    const hash = hashPasswordSync('sync then async', FAST)

    await expect(verifyPassword('sync then async', hash)).resolves.toMatchObject({ valid: true })
    await expect(verifyPassword('wrong', hash)).resolves.toMatchObject({ valid: false })
  })

  it('writes the same format as the asynchronous one', async () => {
    const synchronous = decodePasswordHash(hashPasswordSync('x', FAST))
    const asynchronous = decodePasswordHash(await hashPassword('x', FAST))

    expect(synchronous.N).toBe(asynchronous.N)
    expect(synchronous.salt).toHaveLength(asynchronous.salt.length)
    expect(synchronous.derived).toHaveLength(asynchronous.derived.length)
  })

  it('salts, like the asynchronous one', () => {
    expect(hashPasswordSync('same', FAST)).not.toBe(hashPasswordSync('same', FAST))
  })

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_label, value) => {
    expect(() => hashPasswordSync(value, FAST)).toThrow(TypeError)
  })
})

describe('the default parameters', () => {
  it('is memory-hard: the cost is memory as well as time', () => {
    // 128 * N * r bytes is scrypt's working set. This asserts the parameters are
    // in the tens of megabytes, which is the property bcrypt's fixed 4 KiB does
    // not have and the reason this module exists.
    const workingSetBytes = 128 * SCRYPT_PARAMETERS.N * SCRYPT_PARAMETERS.r

    expect(workingSetBytes).toBeGreaterThanOrEqual(32 * 1024 * 1024)
    expect(SCRYPT_PARAMETERS.maxmem).toBeGreaterThan(workingSetBytes)
  })

  it('actually derives a key at those parameters', async () => {
    // The one test that pays the real cost, because a maxmem set below the
    // working set would fail only here — and would fail every login.
    const hash = await hashPassword('real parameters')

    await expect(verifyPassword('real parameters', hash)).resolves.toMatchObject({ valid: true })
  })
})

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword('right')

    await expect(verifyPassword('right', hash)).resolves.toEqual({
      valid: true,
      rehash: false,
      legacy: false,
      unusable: false,
    })
  })

  it('asks for a rehash when the right password is stored at weaker parameters', async () => {
    const hash = await hashPassword('right', FAST)

    await expect(verifyPassword('right', hash)).resolves.toEqual({
      valid: true,
      rehash: true,
      legacy: false,
      unusable: false,
    })
  })

  it('never asks for a rehash on a failed attempt, because there is nothing to rehash', async () => {
    const weak = await hashPassword('right', FAST)

    await expect(verifyPassword('wrong', weak)).resolves.toMatchObject({
      valid: false,
      rehash: false,
    })
  })

  it.each([
    ['a different password', 'wrong'],
    ['the password with one byte changed', 'righU'],
    ['a prefix of the password', 'righ'],
    ['the password with trailing space', 'right '],
    ['an empty string', ''],
  ])('rejects %s', async (_label, attempt) => {
    const hash = await hashPassword('right', FAST)

    await expect(verifyPassword(attempt, hash)).resolves.toMatchObject({ valid: false })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a value from another system', 'not-a-hash'],
    ['a hash with a missing field', 'scrypt$1$1024$8$salt$derived'],
    ['a hash with a non-numeric cost', 'scrypt$1$abc$8$1$c2FsdA$ZGVyaXZlZA'],
    ['a hash with a zero cost', 'scrypt$1$0$8$1$c2FsdA$ZGVyaXZlZA'],
    ['a hash with an empty salt', 'scrypt$1$1024$8$1$$ZGVyaXZlZA'],
    ['a hash from a future version', 'scrypt$2$1024$8$1$c2FsdA$ZGVyaXZlZA'],
  ])(
    'refuses to authenticate against %s, and reports the row as unusable',
    async (_label, stored) => {
      const result = await verifyPassword('any password', stored)

      expect(result.valid).toBe(false)
      expect(result.unusable).toBe(true)
      expect(result.rehash).toBe(false)
    },
  )

  it('does not call a good hash unusable just because the password was wrong', async () => {
    const hash = await hashPassword('right', FAST)

    await expect(verifyPassword('wrong', hash)).resolves.toMatchObject({ unusable: false })
  })

  it('spends time on an unknown account, so timing does not enumerate emails', async () => {
    // Not a wall-clock assertion — those are flaky on shared hardware. The claim
    // is structural: the decoy is a real hash at real parameters, so verifying
    // against it does the same derivation a real account does.
    const decoy = await decoyHash()
    const decoded = decodePasswordHash(decoy)

    expect(decoded).toMatchObject({ N: SCRYPT_PARAMETERS.N, r: SCRYPT_PARAMETERS.r })
  })

  it('has no password that matches the decoy', async () => {
    const decoy = await decoyHash()

    for (const guess of ['', 'decoy', 'password', 'desi-event', HASH_PREFIX]) {
      await expect(verifyPassword(guess, decoy)).resolves.toMatchObject({ valid: false })
    }
  })

  it('returns the same decoy every time, rather than one per call', async () => {
    await expect(decoyHash()).resolves.toBe(await decoyHash())
  })
})

describe('Phase 1 bcrypt hashes', () => {
  const BCRYPT = '$2b$10$ZqBKkLSqSsKxpy98eAsJ/uSKZ9oxWCHVmlEoxYrmU8iG.ukUu.kj2'

  it.each([
    ['$2a$', '$2a$10$abcdefghijklmnopqrstuv'],
    ['$2b$', BCRYPT],
    ['$2y$', '$2y$10$abcdefghijklmnopqrstuv'],
  ])('recognises a %s hash', (_label, hash) => {
    expect(LEGACY_BCRYPT.test(hash)).toBe(true)
  })

  it('does not mistake one of ours for bcrypt', async () => {
    expect(LEGACY_BCRYPT.test(await hashPassword('x', FAST))).toBe(false)
  })

  it('cannot authenticate one without a verifier, and says so', async () => {
    const result = await verifyPassword('anything', BCRYPT)

    expect(result).toEqual({ valid: false, rehash: false, legacy: true, unusable: true })
  })

  it('accepts one when the caller supplies a verifier, and asks for a rehash', async () => {
    const result = await verifyPassword('the old password', BCRYPT, {
      verifyLegacy: async (password, stored) =>
        password === 'the old password' && stored === BCRYPT,
    })

    expect(result).toEqual({ valid: true, rehash: true, legacy: true, unusable: false })
  })

  it('does not ask for a rehash when the legacy password was wrong', async () => {
    const result = await verifyPassword('wrong', BCRYPT, { verifyLegacy: async () => false })

    expect(result).toEqual({ valid: false, rehash: false, legacy: true, unusable: false })
  })
})

describe('needsRehash', () => {
  it('is false for a hash at current strength', async () => {
    expect(needsRehash(await hashPassword('x'))).toBe(false)
  })

  it('is true for a hash weaker than current strength', async () => {
    expect(needsRehash(await hashPassword('x', FAST))).toBe(true)
  })

  it('is true for a bcrypt hash', () => {
    expect(needsRehash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['nonsense', 'nonsense'],
  ])('is true for %s', (_label, value) => {
    expect(needsRehash(value)).toBe(true)
  })

  it('is false when the stored hash is stronger than current', async () => {
    // Lowering the parameters is a deliberate act; it must not trigger a
    // downgrade of everybody's stored hash on their next sign-in.
    const strong = await hashPassword('x', { ...FAST, N: 4096 })

    expect(needsRehash(strong, { ...FAST, N: 1024 })).toBe(false)
  })

  it('notices each parameter independently', async () => {
    const hash = await hashPassword('x', FAST)

    expect(needsRehash(hash, { ...FAST, N: FAST.N * 2 })).toBe(true)
    expect(needsRehash(hash, { ...FAST, r: FAST.r + 1 })).toBe(true)
    expect(needsRehash(hash, { ...FAST, p: FAST.p + 1 })).toBe(true)
  })
})

describe('decodePasswordHash', () => {
  it('round-trips what hashPassword wrote', async () => {
    const hash = await hashPassword('round trip', FAST)
    const decoded = decodePasswordHash(hash)

    expect(decoded.salt).toHaveLength(SCRYPT_PARAMETERS.saltLength)
    expect(decoded.derived).toHaveLength(SCRYPT_PARAMETERS.keyLength)
  })

  it.each([
    ['a non-string', 42],
    ['too few fields', 'scrypt$1$1024$8$1$salt'],
    ['too many fields', 'scrypt$1$1024$8$1$c2FsdA$ZGVyaXZlZA$extra'],
    ['the wrong prefix', 'argon2$1$1024$8$1$c2FsdA$ZGVyaXZlZA'],
    ['a negative cost', 'scrypt$1$-1$8$1$c2FsdA$ZGVyaXZlZA'],
    ['a fractional cost', 'scrypt$1$10.5$8$1$c2FsdA$ZGVyaXZlZA'],
  ])('returns null for %s', (_label, value) => {
    expect(decodePasswordHash(value)).toBeNull()
  })
})
