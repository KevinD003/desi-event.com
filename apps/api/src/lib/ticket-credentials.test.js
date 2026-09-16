/**
 * The pass that opens the door.
 *
 * @file lib/ticket-credentials.test
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  TICKET_CREDENTIAL_PURPOSE,
  credentialDigest,
  credentialMatches,
  issueTicketCredential,
  mintTicketCredential,
} from './ticket-credentials.js'

const SECRET = 'test-only-fake-deployment-value-long-enough-0123'
const OTHER_SECRET = 'test-only-fake-value-from-another-deployment-987'

describe('minting a credential', () => {
  it('is deterministic for one ticket at one version', () => {
    const first = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 1 })
    const second = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 1 })

    expect(first).toBe(second)
  })

  it('is what lets a buyer reopen a pass on a new device', () => {
    // The property above, stated as the reason it exists: nothing about the
    // pass is stored, so re-deriving it is the only way to show it twice.
    const issued = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })
    const later = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 1 })

    expect(credentialDigest(later)).toBe(issued.credentialHash)
  })

  it('differs between two tickets', () => {
    const left = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })
    const right = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-2' })

    expect(left).not.toBe(right)
  })

  it('changes when the version is bumped, which is what kills an old screenshot', () => {
    const before = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 1 })
    const after = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 2 })

    expect(after).not.toBe(before)
  })

  it('differs between two deployments holding the same rows', () => {
    const here = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })
    const there = mintTicketCredential({ secret: OTHER_SECRET, ticketId: 'ticket-1' })

    expect(there).not.toBe(here)
  })

  it('is 256 bits of base64url, so it is not guessable', () => {
    const credential = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })

    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('refuses a secret too short to be one', () => {
    expect(() => mintTicketCredential({ secret: 'short', ticketId: 'ticket-1' })).toThrow(
      /at least 32 characters/,
    )
  })

  it('refuses a missing ticket id rather than minting a shared credential', () => {
    expect(() => mintTicketCredential({ secret: SECRET, ticketId: '' })).toThrow(/ticket id/)
  })

  it('refuses a version that is not a positive integer', () => {
    expect(() => mintTicketCredential({ secret: SECRET, ticketId: 't', version: 0 })).toThrow(
      /positive integer/,
    )
    expect(() => mintTicketCredential({ secret: SECRET, ticketId: 't', version: 1.5 })).toThrow(
      /positive integer/,
    )
  })

  it('names its purpose, so another use of the same secret cannot produce it', () => {
    expect(TICKET_CREDENTIAL_PURPOSE).toBe('ticket-pass-v1')
  })
})

describe('the digest that is stored', () => {
  it('is the SHA-256 of the credential and nothing else', () => {
    const credential = mintTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })
    const expected = createHash('sha256').update(credential).digest('hex')

    expect(credentialDigest(credential)).toBe(expected)
  })

  it('is not the credential', () => {
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId: 'ticket-1',
    })

    expect(credentialHash).not.toContain(credential)
    expect(credentialHash).toHaveLength(64)
  })

  it('refuses to digest nothing', () => {
    expect(() => credentialDigest('')).toThrow(/credential is required/)
    expect(() => credentialDigest(null)).toThrow(/credential is required/)
  })
})

describe('checking a presented credential', () => {
  it('accepts the one this ticket was issued with', () => {
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId: 'ticket-1',
    })

    expect(credentialMatches(credential, credentialHash)).toBe(true)
  })

  it('rejects another ticket’s credential', () => {
    const mine = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })
    const yours = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-2' })

    expect(credentialMatches(yours.credential, mine.credentialHash)).toBe(false)
  })

  it('rejects a superseded credential once the version moves', () => {
    const old = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 1 })
    const rotated = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-1', version: 2 })

    expect(credentialMatches(old.credential, rotated.credentialHash)).toBe(false)
  })

  it('rejects anything malformed without throwing at the gate', () => {
    const { credentialHash } = issueTicketCredential({ secret: SECRET, ticketId: 'ticket-1' })

    expect(credentialMatches('', credentialHash)).toBe(false)
    expect(credentialMatches(null, credentialHash)).toBe(false)
    expect(credentialMatches(undefined, credentialHash)).toBe(false)
    expect(credentialMatches('anything', null)).toBe(false)
    expect(credentialMatches('anything', 'too-short')).toBe(false)
  })
})
