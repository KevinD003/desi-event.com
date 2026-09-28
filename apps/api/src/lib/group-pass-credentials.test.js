/**
 * The group pass's QR content and printed code: derived, separated from every
 * other secret, and stored only as digests.
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  GROUP_CODE_PREFIX,
  GROUP_CREDENTIAL_PREFIX,
  groupCodeDigest,
  issueGroupPass,
  mintGroupCode,
  mintGroupPassCredential,
} from './group-pass-credentials.js'
import { mintTicketCredential } from './ticket-credentials.js'

const SECRET = 'test-only-secret-that-is-long-enough-32'
const ID = 'cgrouppass000000000000001'

describe('mintGroupPassCredential', () => {
  it('is deterministic for one pass at one version', () => {
    expect(mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 1 })).toBe(
      mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 1 }),
    )
  })

  it('is G1. and 43 url-safe characters, 46 in all', () => {
    const credential = mintGroupPassCredential({ secret: SECRET, groupPassId: ID })

    expect(credential.startsWith(GROUP_CREDENTIAL_PREFIX)).toBe(true)
    expect(credential).toHaveLength(46)
    expect(credential).toMatch(/^G1\.[A-Za-z0-9_-]{43}$/u)
  })

  it('never equals a ticket credential for the same id and version', () => {
    const group = mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 1 })
    const ticket = mintTicketCredential({ secret: SECRET, ticketId: ID, version: 1 })

    expect(group.slice(GROUP_CREDENTIAL_PREFIX.length)).not.toBe(ticket)
    // And the `.` keeps the two shapes apart for a scanner, whatever the MAC.
    expect(ticket).not.toContain('.')
  })

  it('changes with the version and with the secret', () => {
    const one = mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 1 })

    expect(mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 2 })).not.toBe(one)
    expect(
      mintGroupPassCredential({ secret: `${SECRET}-other`, groupPassId: ID, version: 1 }),
    ).not.toBe(one)
  })

  it('refuses an empty id and a version below one', () => {
    expect(() => mintGroupPassCredential({ secret: SECRET, groupPassId: '' })).toThrow(TypeError)
    expect(() => mintGroupPassCredential({ secret: SECRET, groupPassId: ID, version: 0 })).toThrow(
      TypeError,
    )
  })
})

describe('mintGroupCode', () => {
  it('is DEG- and twelve characters from the ticket-code alphabet', () => {
    const code = mintGroupCode({ secret: SECRET, groupPassId: ID })

    expect(code.startsWith(GROUP_CODE_PREFIX)).toBe(true)
    expect(code).toMatch(/^DEG-[2-9A-HJ-NP-Z]{12}$/u)
  })

  it('changes with the version, as the QR does', () => {
    expect(mintGroupCode({ secret: SECRET, groupPassId: ID, version: 1 })).not.toBe(
      mintGroupCode({ secret: SECRET, groupPassId: ID, version: 2 }),
    )
  })

  it('is not taken from the QR content', () => {
    const credential = mintGroupPassCredential({ secret: SECRET, groupPassId: ID })
    const code = mintGroupCode({ secret: SECRET, groupPassId: ID })

    expect(credential).not.toContain(code.slice(GROUP_CODE_PREFIX.length))
  })
})

describe('groupCodeDigest', () => {
  it('is 64 hex characters, and the same however the code was typed', () => {
    const code = mintGroupCode({ secret: SECRET, groupPassId: ID })
    const digest = groupCodeDigest(code)

    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(groupCodeDigest(code.toLowerCase())).toBe(digest)
    expect(groupCodeDigest(`  ${code.toLowerCase()} `)).toBe(digest)
    expect(digest).toBe(createHash('sha256').update(code).digest('hex'))
  })

  it('refuses an empty code', () => {
    expect(() => groupCodeDigest('')).toThrow(TypeError)
    expect(() => groupCodeDigest('   ')).toThrow(TypeError)
  })
})

describe('issueGroupPass', () => {
  it('returns both values with digests that match them, and a version bump changes all four', () => {
    const first = issueGroupPass({ secret: SECRET, groupPassId: ID, version: 1 })
    const second = issueGroupPass({ secret: SECRET, groupPassId: ID, version: 2 })

    expect(first.credentialHash).toBe(createHash('sha256').update(first.credential).digest('hex'))
    expect(first.codeHash).toBe(createHash('sha256').update(first.code).digest('hex'))

    for (const key of ['credential', 'credentialHash', 'code', 'codeHash']) {
      expect(second[key], key).not.toBe(first[key])
    }
  })
})
