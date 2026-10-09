import { describe, it, expect } from 'vitest'

import {
  REDACTION_CENSOR,
  REDACT_PATHS,
  SENSITIVE_HEADER_KEYS,
  SENSITIVE_FIELD_KEYS,
  WILDCARD_KEYS,
  HEADER_CONTAINERS,
  FIELD_CONTAINERS,
  redactPath,
  buildRedactPaths,
  buildRedactOptions,
} from './redaction.js'
import { createLogger } from './create-logger.js'

describe('redactPath', () => {
  it('uses dot notation for identifier-safe keys', () => {
    expect(redactPath('', 'password')).toBe('password')
    expect(redactPath('req.headers', 'authorization')).toBe('req.headers.authorization')
    expect(redactPath('*', 'token')).toBe('*.token')
  })

  it('quotes keys that are not valid identifiers', () => {
    expect(redactPath('', 'set-cookie')).toBe('["set-cookie"]')
    expect(redactPath('req.headers', 'set-cookie')).toBe('req.headers["set-cookie"]')
    expect(redactPath('*', 'stripe-signature')).toBe('*["stripe-signature"]')
  })
})

describe('buildRedactPaths', () => {
  it('covers every sensitive key at the log root', () => {
    for (const key of [...SENSITIVE_HEADER_KEYS, ...SENSITIVE_FIELD_KEYS]) {
      expect(REDACT_PATHS).toContain(redactPath('', key))
    }
  })

  it('covers every declared container', () => {
    for (const container of HEADER_CONTAINERS) {
      for (const key of SENSITIVE_HEADER_KEYS) {
        expect(REDACT_PATHS).toContain(redactPath(container, key))
      }
    }
    for (const container of FIELD_CONTAINERS) {
      for (const key of SENSITIVE_FIELD_KEYS) {
        expect(REDACT_PATHS).toContain(redactPath(container, key))
      }
    }
  })

  it('covers the wildcard keys one level down', () => {
    for (const key of WILDCARD_KEYS) expect(REDACT_PATHS).toContain(redactPath('*', key))
  })

  it('keeps the wildcard set small, because each entry is re-checked per top-level key', () => {
    const wildcards = REDACT_PATHS.filter((path) => path.startsWith('*'))
    expect(wildcards).toHaveLength(WILDCARD_KEYS.length)
  })

  it('returns no duplicates', () => {
    const paths = buildRedactPaths({ extraPaths: ['password', 'custom.secretHandshake'] })
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('custom.secretHandshake')
  })

  it('does not mutate the frozen default set', () => {
    const before = REDACT_PATHS.length
    buildRedactPaths({ extraPaths: ['another.one'] })
    expect(REDACT_PATHS).toHaveLength(before)
    expect(REDACT_PATHS).not.toContain('another.one')
  })
})

describe('buildRedactOptions', () => {
  it('censors rather than removes, so redaction is visible in the log', () => {
    const options = buildRedactOptions()
    expect(options.censor).toBe(REDACTION_CENSOR)
    expect(options.remove).toBe(false)
    expect(options.paths).toEqual([...REDACT_PATHS])
  })

  it('accepts a custom censor and extra paths', () => {
    const options = buildRedactOptions({ censor: '***', extraPaths: ['gateway.pin'] })
    expect(options.censor).toBe('***')
    expect(options.paths).toContain('gateway.pin')
  })

  it('hands pino a mutable copy', () => {
    const options = buildRedactOptions()
    expect(Object.isFrozen(options.paths)).toBe(false)
  })
})

describe('the admission pass', () => {
  it('is redacted by name, so a handler logging a whole ticket row cannot leak it', () => {
    // This net exists because a handler eventually logs a row rather than a
    // field. Every other bearer secret in the system was already named here;
    // the ticket credential was not, and it is the one a QR code carries.
    expect(SENSITIVE_FIELD_KEYS).toContain('credential')
    expect(SENSITIVE_FIELD_KEYS).toContain('credentialHash')
  })

  it('is redacted one level down as well, which is the shape a scan produces', () => {
    // `{ ticket: { credential } }`, and the check-in route takes the credential
    // as a body field — `req.body.credential`.
    expect(WILDCARD_KEYS).toContain('credential')
  })

  it('takes the door’s preview reference with it, by name and one level down', () => {
    // The check-in route takes the reference in its body next to the
    // credential, so a handler that logs one logs the other.
    expect(SENSITIVE_FIELD_KEYS).toContain('previewReference')
    expect(WILDCARD_KEYS).toContain('previewReference')
    expect(REDACT_PATHS).toContain('req.body.previewReference')
    expect(REDACT_PATHS).toContain('*.previewReference')
  })
})

describe('the show-once invitation code', () => {
  /**
   * Log one object through a real logger and return what was written.
   *
   * @param {object} fields The fields to log.
   * @returns {Promise<string>} The raw output.
   */
  async function written(fields) {
    const chunks = []
    const logger = createLogger({
      name: 'redaction-test',
      level: 'info',
      pretty: false,
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })

    logger.info(fields, 'issued')
    logger.flush?.()

    return chunks.join('')
  }

  const CODE = 'Q2hvb3NlIGEgY29kZSB0aGF0IGlzIGZvcnR5LXRocmVlAA'

  it('is on the lists by name, at the root and one level down', () => {
    expect(SENSITIVE_FIELD_KEYS).toContain('invitationCode')
    expect(WILDCARD_KEYS).toContain('invitationCode')
    expect(REDACT_PATHS).toContain('invitationCode')
    expect(REDACT_PATHS).toContain('*.invitationCode')
  })

  it('is censored at the top level of a log line', async () => {
    const output = await written({ invitationCode: CODE })

    expect(output).not.toContain(CODE)
    expect(output).toContain(REDACTION_CENSOR)
  })

  it('is censored one level down, the shape of the response that carries it', async () => {
    const output = await written({ delivery: { mode: 'MANUAL', invitationCode: CODE } })

    expect(output).not.toContain(CODE)
    expect(output).toContain('MANUAL')
  })
})

describe('the group pass code and its digests', () => {
  /**
   * Log one object through a real logger and return what was written.
   *
   * @param {object} fields The fields to log.
   * @returns {Promise<string>} The raw output.
   */
  async function written(fields) {
    const chunks = []
    const logger = createLogger({
      name: 'redaction-test',
      level: 'info',
      pretty: false,
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })

    logger.info(fields, 'group pass')
    logger.flush?.()

    return chunks.join('')
  }

  const GROUP_CODE = 'DEG-ABCDEFGH2345'
  const DIGEST = 'c0ffee'.repeat(10) + 'beef'
  const INVITATION_CODE = 'U2VuZCB0aGlzIGNvZGUgdG8gdGhlbSB5b3Vyc2VsZgAA'

  it('is on the lists by name, at the root and one level down', () => {
    for (const key of ['groupCode', 'codeHash', 'invitationCode']) {
      expect(SENSITIVE_FIELD_KEYS, key).toContain(key)
      expect(WILDCARD_KEYS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(`*.${key}`)
      expect(REDACT_PATHS, key).toContain(`req.body.${key}`)
    }
  })

  it('is censored at the top level of a log line', async () => {
    const output = await written({
      groupCode: GROUP_CODE,
      codeHash: DIGEST,
      invitationCode: INVITATION_CODE,
    })

    for (const secret of [GROUP_CODE, DIGEST, INVITATION_CODE]) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain(REDACTION_CENSOR)
  })

  it('is censored one level down, the shapes a pass response or a pass row takes', async () => {
    const output = await written({
      data: { groupCode: GROUP_CODE, admits: 3 },
      groupPass: { codeHash: DIGEST, credentialVersion: 2 },
      delivery: { mode: 'MANUAL', invitationCode: INVITATION_CODE },
    })

    for (const secret of [GROUP_CODE, DIGEST, INVITATION_CODE]) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain('"admits":3')
    expect(output).toContain('"credentialVersion":2')
  })
})

describe('promo codes and guests’ names', () => {
  /**
   * What a logger writes for one object.
   *
   * @param {object} fields The log object.
   * @returns {Promise<string>} The serialised line.
   */
  async function line(fields) {
    const chunks = []
    const logger = createLogger({
      name: 'commerce-redaction',
      level: 'info',
      pretty: false,
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    logger.info(fields, 'checkout')
    logger.flush?.()
    return chunks.join('')
  }

  it('is on the lists by name, at the root, one level down and in a request body', () => {
    for (const key of ['promoCode', 'attendees', 'attendeeName', 'attendeeNames']) {
      expect(SENSITIVE_FIELD_KEYS, key).toContain(key)
      expect(WILDCARD_KEYS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(`*.${key}`)
      expect(REDACT_PATHS, key).toContain(`req.body.${key}`)
    }
  })

  it('never writes the code or a guest’s name, wherever a handler puts them', async () => {
    const output = await line({
      promoCode: 'FRIENDS50',
      req: { body: { promoCode: 'FRIENDS50', attendees: [{ name: 'Meera Iyer' }] } },
      ticket: { attendeeName: 'Ravi Patel', status: 'VALID' },
      orderItem: { attendeeNames: ['Asha Rao'], quantity: 2 },
    })

    for (const secret of ['FRIENDS50', 'Meera Iyer', 'Ravi Patel', 'Asha Rao']) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain('"status":"VALID"')
    expect(output).toContain('"quantity":2')
  })
})

describe('SMTP credentials and visit-counting values', () => {
  /**
   * What a logger writes for one object.
   *
   * @param {object} fields The log object.
   * @returns {Promise<string>} The serialised line.
   */
  async function line(fields) {
    const chunks = []
    const logger = createLogger({
      name: 'traffic-redaction',
      level: 'info',
      pretty: false,
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    logger.info(fields, 'counted')
    logger.flush?.()
    return chunks.join('')
  }

  const FIELDS = [
    'pass',
    'smtpPassword',
    'SMTP_PASSWORD',
    'visitorHash',
    'dedupeKey',
    'fingerprint',
    'clientAddress',
    'referrerHost',
    'salt',
  ]

  it('names each field at the root and one level down, and both headers', () => {
    for (const key of FIELDS) {
      expect(SENSITIVE_FIELD_KEYS, key).toContain(key)
      expect(WILDCARD_KEYS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(key)
      expect(REDACT_PATHS, key).toContain(`*.${key}`)
    }

    for (const header of ['x-desi-client-address', 'x-forwarded-for']) {
      expect(SENSITIVE_HEADER_KEYS, header).toContain(header)
      expect(REDACT_PATHS, header).toContain(`req.headers["${header}"]`)
    }
  })

  it('never writes an SMTP password, at the top level or one level down', async () => {
    const output = await line({
      SMTP_PASSWORD: 'smtp-secret-one',
      smtpPassword: 'smtp-secret-two',
      auth: { user: 'mailer', pass: 'smtp-secret-three' },
    })

    for (const secret of ['smtp-secret-one', 'smtp-secret-two', 'smtp-secret-three']) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain('"user":"mailer"')
  })

  it('never writes a visitor code, a digest, an address, a referring host or a salt', async () => {
    const output = await line({
      salt: 'f'.repeat(64),
      visitor: { fingerprint: 'fp-203.0.113.9', clientAddress: '203.0.113.9' },
      row: { visitorHash: 'a'.repeat(32), dedupeKey: 'b'.repeat(64), kind: 'PAGE_VIEW' },
      beacon: { referrerHost: 'www.google.com' },
      req: { headers: { 'x-desi-client-address': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' } },
    })

    for (const secret of [
      'f'.repeat(64),
      'fp-203.0.113.9',
      '203.0.113.9',
      'a'.repeat(32),
      'b'.repeat(64),
      'www.google.com',
      '198.51.100.7',
      '192.0.2.1',
    ]) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain('"kind":"PAGE_VIEW"')
  })
})

describe('referral codes (SPEC3 §13)', () => {
  const CODE = 'WAIVE-12345'

  /**
   * What a logger writes for one object.
   *
   * @param {object} fields The log object.
   * @returns {Promise<string>} The serialised line.
   */
  async function line(fields) {
    const chunks = []
    const logger = createLogger({
      name: 'referral-redaction',
      level: 'info',
      pretty: false,
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    logger.info(fields, 'referral')
    logger.flush?.()
    return chunks.join('')
  }

  it('is on both lists by name, at the root, one level down and in a request body', () => {
    expect(SENSITIVE_FIELD_KEYS).toContain('referralCode')
    expect(WILDCARD_KEYS).toContain('referralCode')
    expect(REDACT_PATHS).toContain('referralCode')
    expect(REDACT_PATHS).toContain('*.referralCode')
    expect(REDACT_PATHS).toContain('req.body.referralCode')
  })

  it('never writes the text, wherever a handler puts it', async () => {
    const output = await line({
      referralCode: CODE,
      data: { referralCode: CODE, useCount: 4 },
      req: { body: { referralCode: CODE, paymentMethod: 'AT_VENUE' } },
    })

    expect(output).not.toContain(CODE)
    expect(output).toContain('"useCount":4')
    expect(output).toContain('"paymentMethod":"AT_VENUE"')
  })

  it('leaves an error code alone: only the name referralCode is redacted, not code', async () => {
    const output = await line({ code: 'REFERRAL_NOT_ACCEPTED', statusCode: 409 })

    expect(output).toContain('"code":"REFERRAL_NOT_ACCEPTED"')
  })
})
