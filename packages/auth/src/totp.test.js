import { describe, expect, it } from 'vitest'

import {
  RECOVERY_CODE_COUNT,
  TOTP_PARAMETERS,
  base32Decode,
  base32Encode,
  counterAt,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  totp,
  totpUri,
  verifyTotp,
} from './totp.js'

/** The RFC 6238 reference secret: the ASCII digits 1 to 0, twice. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii')

/** RFC 6238 specifies its vectors with eight digits. */
const RFC = { ...TOTP_PARAMETERS, digits: 8 }

describe('RFC 6238 test vectors (SHA-1)', () => {
  // Appendix B of the RFC. If any of these change, this is not TOTP any more and
  // no authenticator app will agree with it.
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('at T=%i produces %s', (seconds, expected) => {
    expect(totp(RFC_SECRET, { at: new Date(seconds * 1000), parameters: RFC })).toBe(expected)
  })
})

describe('the chosen parameters', () => {
  it('are the ones every authenticator app implements', () => {
    // Deliberate, and worth a test: SHA-256 would be tidier and would not work
    // in Google Authenticator, which is the wrong trade for an enrolment step.
    expect(TOTP_PARAMETERS).toMatchObject({ algorithm: 'sha1', digits: 6, stepSeconds: 30 })
  })

  it('accept one step either side of now, and no more', () => {
    expect(TOTP_PARAMETERS.window).toBe(1)
  })

  it('use a secret of at least the 128 bits RFC 4226 requires', () => {
    expect(TOTP_PARAMETERS.secretBytes * 8).toBeGreaterThanOrEqual(128)
  })
})

describe('base32', () => {
  it.each([
    ['empty', ''],
    ['one byte', '00'],
    ['two bytes', '0001'],
    ['three bytes', '000102'],
    ['four bytes', '00010203'],
    ['five bytes, an exact group', '0001020304'],
    ['twenty bytes, a TOTP secret', '000102030405060708090a0b0c0d0e0f10111213'],
    ['high bytes', 'fffefdfcfb'],
  ])('round-trips %s', (_label, hex) => {
    const bytes = Buffer.from(hex, 'hex')

    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true)
  })

  it('uses only the RFC 4648 alphabet', () => {
    expect(base32Encode(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'))).toMatch(
      /^[A-Z2-7]+$/,
    )
  })

  it('has no padding, which is what authenticator apps expect', () => {
    expect(base32Encode(Buffer.from([1]))).not.toContain('=')
  })

  it.each([
    ['lower case', 'jbswy3dpehpk3pxp'],
    ['spaces, as apps display it', 'JBSW Y3DP EHPK 3PXP'],
    ['padding some apps add', 'JBSWY3DPEHPK3PXP===='],
  ])('decodes a secret typed with %s', (_label, typed) => {
    expect(base32Decode(typed).equals(base32Decode('JBSWY3DPEHPK3PXP'))).toBe(true)
  })

  it.each([
    ['a digit outside the alphabet', 'JBSW0DPE'],
    ['a letter outside the alphabet', 'JBSW1DPE'],
    ['punctuation', 'JBSW-DPE!'],
  ])('refuses %s', (_label, invalid) => {
    expect(() => base32Decode(invalid)).toThrow(TypeError)
  })

  it('decodes the RFC secret to the RFC bytes', () => {
    expect(base32Decode(base32Encode(RFC_SECRET)).equals(RFC_SECRET)).toBe(true)
  })
})

describe('counterAt', () => {
  it('advances once per step', () => {
    const base = new Date('2026-09-15T12:00:00.000Z')
    const next = new Date(base.getTime() + TOTP_PARAMETERS.stepSeconds * 1000)

    expect(counterAt(next) - counterAt(base)).toBe(1)
  })

  it('does not advance within a step', () => {
    const base = new Date('2026-09-15T12:00:00.000Z')
    const within = new Date(base.getTime() + (TOTP_PARAMETERS.stepSeconds - 1) * 1000)

    expect(counterAt(within)).toBe(counterAt(base))
  })

  it('accepts a timestamp as well as a Date', () => {
    expect(counterAt(1_789_000_000_000)).toBe(counterAt(new Date(1_789_000_000_000)))
  })
})

describe('hotp', () => {
  it('handles a counter above 2^32, where a 32-bit shift would wrap', () => {
    // The counter is a 64-bit field. Writing it with a bitwise shift silently
    // truncates past 2^32, and the codes would be wrong for a couple of
    // thousand years' worth of counters rather than obviously broken.
    const high = 2 ** 33 + 7

    expect(hotp(RFC_SECRET, high)).not.toBe(hotp(RFC_SECRET, high % 2 ** 32))
  })

  it('pads a short code to the full digit count', () => {
    // A truncated value below 100000 must render as 0xxxxx, not xxxxx.
    const codes = Array.from({ length: 200 }, (_, index) => hotp(RFC_SECRET, index))

    expect(codes.every((code) => code.length === TOTP_PARAMETERS.digits)).toBe(true)
    expect(codes.some((code) => code.startsWith('0'))).toBe(true)
  })

  it('accepts the secret as base32 or as bytes, identically', () => {
    expect(hotp(base32Encode(RFC_SECRET), 1)).toBe(hotp(RFC_SECRET, 1))
  })
})

describe('verifyTotp', () => {
  const now = new Date('2026-09-15T12:00:30.000Z')
  const secret = base32Encode(RFC_SECRET)

  it('accepts the current code', () => {
    const result = verifyTotp(secret, totp(secret, { at: now }), { at: now })

    expect(result).toMatchObject({ valid: true, counter: counterAt(now) })
  })

  it.each([
    ['one step ago', -1],
    ['one step ahead', 1],
  ])('accepts a code from %s, for clock drift', (_label, offset) => {
    const at = new Date(now.getTime() + offset * TOTP_PARAMETERS.stepSeconds * 1000)

    expect(verifyTotp(secret, totp(secret, { at }), { at: now })).toMatchObject({ valid: true })
  })

  it.each([
    ['two steps ago', -2],
    ['two steps ahead', 2],
    ['an hour ago', -120],
  ])('refuses a code from %s', (_label, offset) => {
    const at = new Date(now.getTime() + offset * TOTP_PARAMETERS.stepSeconds * 1000)

    expect(verifyTotp(secret, totp(secret, { at }), { at: now })).toEqual({
      valid: false,
      counter: null,
      reason: 'mismatch',
    })
  })

  it('refuses a code from a different secret', () => {
    const other = generateTotpSecret().secret

    expect(verifyTotp(secret, totp(other, { at: now }), { at: now })).toMatchObject({
      valid: false,
      reason: 'mismatch',
    })
  })

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['non-numeric', '12345a'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['a code with a minus sign', '-12345'],
    ['a code in scientific notation', '1.2e+5'],
  ])('refuses a %s code without checking the secret', (_label, code) => {
    expect(verifyTotp(secret, code, { at: now })).toEqual({
      valid: false,
      counter: null,
      reason: 'malformed',
    })
  })

  it('accepts a code typed with spaces, as apps display it', () => {
    const code = totp(secret, { at: now })
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

    expect(verifyTotp(secret, spaced, { at: now })).toMatchObject({ valid: true })
  })

  it('refuses a code already used, which verification alone would not catch', () => {
    // The replay this closes: a code is valid for its whole window, so somebody
    // who reads it off a screen can use it again until the window passes. The
    // counter is returned precisely so the caller can store it and refuse this.
    const code = totp(secret, { at: now })
    const first = verifyTotp(secret, code, { at: now })

    expect(first.valid).toBe(true)

    const second = verifyTotp(secret, code, { at: now, lastCounter: first.counter })

    expect(second).toEqual({ valid: false, counter: first.counter, reason: 'replayed' })
  })

  it('refuses a code from before the last one accepted, even though it verifies', () => {
    const previous = new Date(now.getTime() - TOTP_PARAMETERS.stepSeconds * 1000)
    const code = totp(secret, { at: previous })

    expect(verifyTotp(secret, code, { at: now, lastCounter: counterAt(now) })).toMatchObject({
      valid: false,
      reason: 'replayed',
    })
  })

  it('accepts the next code after one was used', () => {
    const next = new Date(now.getTime() + TOTP_PARAMETERS.stepSeconds * 1000)
    const code = totp(secret, { at: next })

    expect(verifyTotp(secret, code, { at: next, lastCounter: counterAt(now) })).toMatchObject({
      valid: true,
    })
  })
})

describe('generateTotpSecret', () => {
  it('produces a base32 secret of the configured length', () => {
    const { secret, bytes } = generateTotpSecret()

    expect(bytes).toHaveLength(TOTP_PARAMETERS.secretBytes)
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(base32Decode(secret).equals(bytes)).toBe(true)
  })

  it('never produces the same secret twice', () => {
    const secrets = new Set(Array.from({ length: 300 }, () => generateTotpSecret().secret))

    expect(secrets.size).toBe(300)
  })
})

describe('totpUri', () => {
  const uri = totpUri({
    secret: 'JBSWY3DPEHPK3PXP',
    account: 'buyer@example.com',
    issuer: 'Desi-Event',
  })

  it('is an otpauth URI an authenticator app can scan', () => {
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
  })

  it('states the parameters rather than relying on the app to assume them', () => {
    const query = new URL(uri).searchParams

    expect(query.get('algorithm')).toBe('SHA1')
    expect(query.get('digits')).toBe('6')
    expect(query.get('period')).toBe('30')
    expect(query.get('issuer')).toBe('Desi-Event')
  })

  it('escapes an account that contains a URI separator', () => {
    const awkward = totpUri({
      secret: 'JBSWY3DPEHPK3PXP',
      account: 'a:b/c?d@example.com',
      issuer: 'Desi/Event',
    })

    expect(() => new URL(awkward)).not.toThrow()
    expect(awkward).toContain('Desi%2FEvent:a%3Ab%2Fc%3Fd%40example.com')
  })
})

describe('recovery codes', () => {
  it('produces the configured number', () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT)
  })

  it('produces codes that are readable off paper', () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    }
  })

  it('excludes the characters people mistake for each other', () => {
    const codes = generateRecoveryCodes(200).join('')

    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(codes).not.toContain(confusable)
    }
  })

  it('does not repeat within a set', () => {
    const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT)

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('carries enough entropy to be worth storing hashed', () => {
    // 12 characters from a 31-character alphabet is about 59 bits, which is
    // more than a password and the reason these are digested rather than hashed
    // with a work factor.
    const bits = Math.log2(31 ** 12)

    expect(bits).toBeGreaterThan(50)
  })

  it.each([
    ['as generated', 'J9CS-M3XV-QBFP', 'J9CSM3XVQBFP'],
    ['in lower case', 'j9cs-m3xv-qbfp', 'J9CSM3XVQBFP'],
    ['with spaces', 'J9CS M3XV QBFP', 'J9CSM3XVQBFP'],
    ['with no separators', 'J9CSM3XVQBFP', 'J9CSM3XVQBFP'],
    ['with stray punctuation', 'J9CS_M3XV.QBFP', 'J9CSM3XVQBFP'],
  ])('normalises a code typed %s', (_label, typed, expected) => {
    expect(normalizeRecoveryCode(typed)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('normalises %s to an empty string rather than throwing', (_label, value) => {
    expect(normalizeRecoveryCode(value)).toBe('')
  })
})
