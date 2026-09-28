/**
 * The admission module's pure parts: the preview reference, the presentation,
 * the closed refusal vocabulary, and the door-authority floor.
 *
 * The workflow itself is exercised through the routes in `tickets.test.js`
 * and against PostgreSQL in `admission-integration.test.js`.
 */

import { ADMISSION_AUTHORITIES as PERMISSION_AUTHORITIES } from '@desi-event/permissions'
import { ADMISSION_AUTHORITIES, ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  PREVIEW_TTL_MS,
  admissionConflict,
  holdsDoorAuthority,
  presentationOf,
  readGroupPreviewReference,
  readPreviewReference,
  signGroupPreviewReference,
  signPreviewReference,
} from '../src/lib/admission.js'
import { ADMISSION_REFUSAL_SENTENCES } from '../src/lib/tickets.js'

const SECRET = 'test-only-secret-that-is-long-enough-32'
const NOW = new Date('2026-10-01T13:00:00.000Z')

/**
 * A reference with sensible defaults.
 *
 * @param {object} [overrides] Claims to change.
 * @returns {string} The reference.
 */
function reference(overrides = {}) {
  return signPreviewReference({
    secret: SECRET,
    ticketId: 'ticketaaaaaaaaaa',
    eventId: 'eventaaaaaaaaaaa',
    organizationId: 'orgaaaaaaaaaaaaa',
    actorId: 'actoraaaaaaaaaaa',
    method: 'QR_SCAN',
    expiresAt: new Date(NOW.getTime() + PREVIEW_TTL_MS),
    ...overrides,
  })
}

describe('the preview reference', () => {
  it('round-trips the claims it was signed with', () => {
    const read = readPreviewReference({ secret: SECRET, reference: reference(), now: NOW })

    expect(read).toEqual({
      ok: true,
      claims: expect.objectContaining({
        v: 1,
        t: 'ticketaaaaaaaaaa',
        e: 'eventaaaaaaaaaaa',
        o: 'orgaaaaaaaaaaaaa',
        a: 'actoraaaaaaaaaaa',
        m: 'QR_SCAN',
      }),
    })
  })

  it('matches the request schema’s shape, so a real one is never refused as malformed', () => {
    const value = reference()

    expect(value).toMatch(/^[A-Za-z0-9_.-]+$/u)
    expect(value.length).toBeGreaterThanOrEqual(20)
    expect(value.length).toBeLessThanOrEqual(600)
  })

  it('carries nothing secret: no credential, no code, no email', () => {
    const body = Buffer.from(reference().split('.')[0], 'base64url').toString('utf8')

    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['a', 'e', 'm', 'o', 't', 'v', 'x'])
  })

  it('is refused under another deployment’s secret', () => {
    expect(
      readPreviewReference({
        secret: 'test-only-a-different-deployment-secret-32',
        reference: reference(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'PREVIEW_INVALID' })
  })

  it('is refused when any claim is edited, however the MAC is left', () => {
    const [body, mac] = reference().split('.')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const edited = Buffer.from(JSON.stringify({ ...claims, t: 'ticketbbbbbbbbbb' })).toString(
      'base64url',
    )

    expect(
      readPreviewReference({ secret: SECRET, reference: `${edited}.${mac}`, now: NOW }),
    ).toEqual({
      ok: false,
      reason: 'PREVIEW_INVALID',
    })
  })

  it.each([
    ['empty', ''],
    ['no separator', 'abc'],
    ['three parts', 'a.b.c'],
    ['an empty MAC', 'abc.'],
    ['a short MAC', 'abc.def'],
    ['not a string', 42],
  ])('is refused when %s', (_label, value) => {
    expect(readPreviewReference({ secret: SECRET, reference: value, now: NOW })).toEqual({
      ok: false,
      reason: 'PREVIEW_INVALID',
    })
  })

  it('expires, and says so only once the MAC has verified', () => {
    const lapsed = new Date(NOW.getTime() + PREVIEW_TTL_MS + 1)

    expect(readPreviewReference({ secret: SECRET, reference: reference(), now: lapsed })).toEqual({
      ok: false,
      reason: 'PREVIEW_EXPIRED',
    })
    // A forged reference whose claimed expiry is past is still just invalid:
    // a forger learns nothing from the difference.
    const [body] = reference().split('.')

    expect(
      readPreviewReference({ secret: SECRET, reference: `${body}.${'A'.repeat(43)}`, now: lapsed }),
    ).toEqual({ ok: false, reason: 'PREVIEW_INVALID' })
  })
})

describe('presentationOf', () => {
  it('derives the method from which secret was presented', () => {
    expect(presentationOf({ credential: 'x'.repeat(43) })).toEqual({
      credential: 'x'.repeat(43),
      code: null,
      method: 'QR_SCAN',
    })
    expect(presentationOf({ code: 'DET-ABC123' })).toEqual({
      credential: null,
      code: 'DET-ABC123',
      method: 'MANUAL_CODE',
    })
  })

  it('ignores a method the body carries', () => {
    // The schema refuses one before this runs; this is the second line.
    expect(presentationOf({ code: 'DET-ABC123', method: 'QR_SCAN' }).method).toBe('MANUAL_CODE')
  })
})

describe('admissionConflict', () => {
  it('builds a 409 for every reason in the vocabulary, each with a sentence', () => {
    for (const reason of ADMISSION_REFUSAL_REASONS) {
      const error = admissionConflict(reason)

      expect(error.statusCode, reason).toBe(409)
      expect(error.details, reason).toEqual({ reason })
      expect(ADMISSION_REFUSAL_SENTENCES[reason], reason).toEqual(expect.any(String))
      expect(error.message, reason).toBe(ADMISSION_REFUSAL_SENTENCES[reason])
    }
  })

  it('refuses to build one from anything else', () => {
    expect(() => admissionConflict('Refunded, sorry')).toThrow(TypeError)
    expect(() => admissionConflict('FORCED')).toThrow(TypeError)
  })
})

describe('holdsDoorAuthority', () => {
  it('is true for a membership whose role carries ticket:check_in', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'SCANNER']) {
      expect(holdsDoorAuthority({ memberships: [{ role }] }), role).toBe(true)
    }
  })

  it('is true for a platform super-administrator with no membership', () => {
    // ADR 0007: the platform super administrator admits on its own authority.
    expect(holdsDoorAuthority({ role: 'SUPER_ADMIN', memberships: [] })).toBe(true)
    expect(holdsDoorAuthority({ role: 'SUPER_ADMIN' })).toBe(true)
  })

  it('is false for every other role, platform or organisation', () => {
    for (const role of ['VIEWER', 'EVENT_MANAGER', 'FINANCE']) {
      expect(holdsDoorAuthority({ memberships: [{ role }] }), role).toBe(false)
    }

    for (const role of ['SUPPORT', 'MODERATOR', 'FINANCE_ADMIN', 'ORGANIZER', 'ATTENDEE']) {
      expect(holdsDoorAuthority({ role, memberships: [] }), role).toBe(false)
    }

    expect(holdsDoorAuthority(null)).toBe(false)
  })
})

describe('the group preview reference', () => {
  const claims = {
    secret: SECRET,
    groupPassId: 'groupaaaaaaaaaaa',
    groupPassVersion: 2,
    eventId: 'eventaaaaaaaaaaa',
    organizationId: 'orgaaaaaaaaaaaaa',
    actorId: 'actoraaaaaaaaaaa',
    method: 'MANUAL_CODE',
    ticketIds: ['ticketaaaaaaaaaa', 'ticketbbbbbbbbbb'],
    expiresAt: new Date(NOW.getTime() + PREVIEW_TTL_MS),
  }

  it('round-trips the pass, its version and the admissible tickets', () => {
    const read = readGroupPreviewReference({
      secret: SECRET,
      reference: signGroupPreviewReference(claims),
      now: NOW,
    })

    expect(read).toEqual({
      ok: true,
      claims: expect.objectContaining({
        v: 1,
        g: 'groupaaaaaaaaaaa',
        gv: 2,
        e: 'eventaaaaaaaaaaa',
        o: 'orgaaaaaaaaaaaaa',
        a: 'actoraaaaaaaaaaa',
        m: 'MANUAL_CODE',
        ts: ['ticketaaaaaaaaaa', 'ticketbbbbbbbbbb'],
      }),
    })
  })

  it('is refused when its MAC is tampered with', () => {
    const signed = signGroupPreviewReference(claims)
    const [body, mac] = signed.split('.')
    const flipped = `${body}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}`
    const widened = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
        ts: ['ticketaaaaaaaaaa', 'ticketbbbbbbbbbb', 'ticketcccccccccc'],
      }),
    ).toString('base64url')

    expect(readGroupPreviewReference({ secret: SECRET, reference: flipped, now: NOW })).toEqual({
      ok: false,
      reason: 'PREVIEW_INVALID',
    })
    expect(
      readGroupPreviewReference({ secret: SECRET, reference: `${widened}.${mac}`, now: NOW }),
    ).toEqual({ ok: false, reason: 'PREVIEW_INVALID' })
  })

  it('expires', () => {
    const reference = signGroupPreviewReference(claims)
    const later = new Date(NOW.getTime() + PREVIEW_TTL_MS + 1)

    expect(readGroupPreviewReference({ secret: SECRET, reference, now: later })).toEqual({
      ok: false,
      reason: 'PREVIEW_EXPIRED',
    })
  })

  it('is never read as a single ticket’s reference, nor the other way round', () => {
    // Distinct HKDF purposes: the MAC one was signed with never verifies as
    // the other, so a single ticket's lookup cannot confirm a group and a
    // group's cannot confirm one ticket.
    const group = signGroupPreviewReference(claims)
    const single = reference()

    expect(readPreviewReference({ secret: SECRET, reference: group, now: NOW })).toEqual({
      ok: false,
      reason: 'PREVIEW_INVALID',
    })
    expect(readGroupPreviewReference({ secret: SECRET, reference: single, now: NOW })).toEqual({
      ok: false,
      reason: 'PREVIEW_INVALID',
    })
  })

  it('carries no credential, code or address', () => {
    const body = signGroupPreviewReference(claims).split('.')[0]
    const decoded = Buffer.from(body, 'base64url').toString('utf8')

    expect(decoded).not.toMatch(/G1\.|DEG-|@/u)
  })
})

describe('GROUP_CHANGED', () => {
  it('builds a 409 with its own sentence', () => {
    expect(admissionConflict('GROUP_CHANGED')).toMatchObject({
      statusCode: 409,
      details: { reason: 'GROUP_CHANGED' },
      message: ADMISSION_REFUSAL_SENTENCES.GROUP_CHANGED,
    })
  })
})

describe('the authority vocabulary', () => {
  it('is the same in the permissions package and the schemas', () => {
    expect(Object.values(PERMISSION_AUTHORITIES).sort()).toEqual([...ADMISSION_AUTHORITIES].sort())
    expect(ADMISSION_AUTHORITIES).toContain('PLATFORM_ROLE')
  })
})
