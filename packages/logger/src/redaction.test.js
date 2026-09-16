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
