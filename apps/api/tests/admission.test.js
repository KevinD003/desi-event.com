/**
 * The admission module's pure parts: the preview reference, the presentation,
 * the closed refusal vocabulary, and the door-authority floor.
 *
 * The workflow itself is exercised through the routes in `tickets.test.js`
 * and against PostgreSQL in `admission-integration.test.js`.
 */

import { ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  PREVIEW_TTL_MS,
  admissionConflict,
  holdsDoorAuthority,
  presentationOf,
  readPreviewReference,
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
        secret: 'a-different-secret-that-is-long-enough',
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

  it('is false for everyone else, including a platform super-administrator', () => {
    for (const role of ['VIEWER', 'EVENT_MANAGER', 'FINANCE']) {
      expect(holdsDoorAuthority({ memberships: [{ role }] }), role).toBe(false)
    }

    expect(holdsDoorAuthority({ role: 'SUPER_ADMIN', memberships: [] })).toBe(false)
    expect(holdsDoorAuthority(null)).toBe(false)
  })
})
