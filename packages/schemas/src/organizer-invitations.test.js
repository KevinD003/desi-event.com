/**
 * Organiser invitations: what an administrator may send, what the list
 * carries, and what may never arrive from anybody.
 */

import { describe, expect, it } from 'vitest'

import * as barrel from './index.js'

import {
  ORGANIZER_INVITATION_LIFETIME_DAYS,
  ORGANIZER_INVITATION_STATUSES,
  createOrganizerInvitationRequestSchema,
  organizerInvitationIssuedResponseSchema,
  organizerInvitationListQuerySchema,
  organizerInvitationListResponseSchema,
  organizerInvitationNoteSchema,
  organizerInvitationResponseSchema,
} from './organizer-invitations.js'

/** A code shaped exactly as `issueToken` mints one: 43 url-safe characters. */
const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

const SUMMARY = {
  id: 'ckl1a2b3c4d5e6f7g8h9i0ja',
  email: 'new-organiser@example.com',
  organizationName: 'Kathiawar Folk Nights',
  organizationDescription: null,
  organizationWebsiteUrl: null,
  organization: null,
  note: null,
  status: 'PENDING',
  deliveryMode: 'MANUAL',
  invitedByName: 'Anil Administrator',
  acceptedByName: null,
  revokedByName: null,
  supersedesId: null,
  createdAt: '2026-09-30T10:00:00.000Z',
  expiresAt: '2026-10-14T10:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
}

describe('the barrel', () => {
  it('exports the organiser invitation shapes for the contract and the API', () => {
    for (const name of [
      'createOrganizerInvitationRequestSchema',
      'organizerInvitationListQuerySchema',
      'organizerInvitationListResponseSchema',
      'organizerInvitationIssuedResponseSchema',
      'organizerInvitationResponseSchema',
      'acceptOrganizerInvitationRequestSchema',
      'acceptedOrganizerInvitationResponseSchema',
    ]) {
      expect(barrel[name], name).toBeDefined()
    }
  })
})

describe('organiser invitation vocabulary', () => {
  it('has four states and lasts fourteen days', () => {
    expect(ORGANIZER_INVITATION_STATUSES).toEqual(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'])
    expect(ORGANIZER_INVITATION_LIFETIME_DAYS).toBe(14)
  })
})

describe('createOrganizerInvitationRequestSchema', () => {
  it('needs an address and an organisation name, and lower-cases the address', () => {
    expect(
      createOrganizerInvitationRequestSchema.parse({
        email: ' New-Organiser@Example.COM ',
        organizationName: '  Kathiawar Folk Nights ',
      }),
    ).toEqual({ email: 'new-organiser@example.com', organizationName: 'Kathiawar Folk Nights' })

    expect(
      createOrganizerInvitationRequestSchema.safeParse({ organizationName: 'Kathiawar' }).success,
    ).toBe(false)
    expect(
      createOrganizerInvitationRequestSchema.safeParse({ email: 'a@example.com' }).success,
    ).toBe(false)
  })

  it('strips a planted kind, role, status, digest, organisation and verification state', () => {
    const parsed = createOrganizerInvitationRequestSchema.parse({
      email: 'a@example.com',
      organizationName: 'Kathiawar Folk Nights',
      kind: 'EXISTING_ORGANIZATION',
      role: 'ADMIN',
      status: 'ACCEPTED',
      tokenHash: 'f'.repeat(64),
      organizationId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
      verificationStatus: 'VERIFIED',
      invitedById: 'ckl1a2b3c4d5e6f7g8h9i0jb',
    })

    expect(Object.keys(parsed).sort()).toEqual(['email', 'organizationName'])
  })

  it('stores the website normalised, and refuses what the website rules refuse', () => {
    expect(
      createOrganizerInvitationRequestSchema.parse({
        email: 'a@example.com',
        organizationName: 'Kathiawar',
        organizationWebsiteUrl: '  https://Kathiawar.Example ',
      }).organizationWebsiteUrl,
    ).toBe('https://kathiawar.example/')

    for (const website of [
      'http://kathiawar.example/',
      'https://user:pass@kathiawar.example/',
      'https://kathiawar.example:8443/',
      'javascript:alert(1)',
      'https://desi-event.com/',
    ]) {
      expect(
        createOrganizerInvitationRequestSchema.safeParse({
          email: 'a@example.com',
          organizationName: 'Kathiawar',
          organizationWebsiteUrl: website,
        }).success,
        website,
      ).toBe(false)
    }
  })

  it('treats a blank description or website as nothing, and bounds the description', () => {
    const parsed = createOrganizerInvitationRequestSchema.parse({
      email: 'a@example.com',
      organizationName: 'Kathiawar',
      organizationDescription: '   ',
      organizationWebsiteUrl: '',
    })

    expect(parsed.organizationDescription).toBeUndefined()
    expect(parsed.organizationWebsiteUrl).toBeNull()
    expect(
      createOrganizerInvitationRequestSchema.safeParse({
        email: 'a@example.com',
        organizationName: 'Kathiawar',
        organizationDescription: 'x'.repeat(2001),
      }).success,
    ).toBe(false)
    expect(
      createOrganizerInvitationRequestSchema.parse({
        email: 'a@example.com',
        organizationName: 'Kathiawar',
        organizationDescription: 'Garba and dandiya.\r\nEvery autumn.',
      }).organizationDescription,
    ).toBe('Garba and dandiya.\nEvery autumn.')
  })
})

describe('organizerInvitationNoteSchema', () => {
  it('allows line breaks and any script, up to 1000 characters', () => {
    expect(organizerInvitationNoteSchema.parse('  Welcome!\r\nआपका स्वागत है  ')).toBe(
      'Welcome!\nआपका स्वागत है',
    )
    expect(organizerInvitationNoteSchema.parse('x'.repeat(1000))).toHaveLength(1000)
    expect(organizerInvitationNoteSchema.safeParse('x'.repeat(1001)).success).toBe(false)
    expect(organizerInvitationNoteSchema.parse('   ')).toBeUndefined()
  })

  it('refuses every other control character', () => {
    for (const character of ['\u0007', '\u0000', '\u001b', '\u007f', '\u0085', '\t']) {
      expect(organizerInvitationNoteSchema.safeParse(`Hello${character}there`).success).toBe(false)
    }
  })
})

describe('organizerInvitationListQuerySchema', () => {
  it('opens on the waiting invitations, twenty a page', () => {
    expect(organizerInvitationListQuerySchema.parse({})).toEqual({
      page: 1,
      perPage: 20,
      status: 'PENDING',
    })
    expect(
      organizerInvitationListQuerySchema.parse({ status: 'ALL', perPage: '50' }),
    ).toMatchObject({ status: 'ALL', perPage: 50 })
    expect(organizerInvitationListQuerySchema.safeParse({ perPage: '51' }).success).toBe(false)
    expect(organizerInvitationListQuerySchema.safeParse({ status: 'WAITING' }).success).toBe(false)
  })

  it('searches by a name of at least two characters, with no control characters', () => {
    expect(organizerInvitationListQuerySchema.parse({ q: '  Kathi ' }).q).toBe('Kathi')
    expect(organizerInvitationListQuerySchema.parse({ q: '   ' }).q).toBeUndefined()
    expect(organizerInvitationListQuerySchema.safeParse({ q: 'K' }).success).toBe(false)
    expect(organizerInvitationListQuerySchema.safeParse({ q: 'Ka\u0000thi' }).success).toBe(false)
  })
})

describe('organiser invitation responses', () => {
  it('never carry the digest, whatever a presenter leaves in', () => {
    const parsed = organizerInvitationResponseSchema.parse({
      data: { ...SUMMARY, tokenHash: 'f'.repeat(64), token: CODE, invitedById: 'x' },
    })
    const wire = JSON.stringify(parsed)

    expect(wire).not.toContain('tokenHash')
    expect(wire).not.toContain('f'.repeat(64))
    expect(wire).not.toContain(CODE)
    expect(wire).not.toContain('invitedById')
  })

  it('carries a 43-character code once in MANUAL, and none in EMAIL', () => {
    const manual = organizerInvitationIssuedResponseSchema.parse({
      data: { ...SUMMARY, delivery: { mode: 'MANUAL', invitationCode: CODE } },
    })

    expect(manual.data.delivery.invitationCode).toBe(CODE)
    expect(
      organizerInvitationIssuedResponseSchema.safeParse({
        data: { ...SUMMARY, delivery: { mode: 'MANUAL', invitationCode: 'f'.repeat(64) } },
      }).success,
    ).toBe(false)

    expect(
      organizerInvitationIssuedResponseSchema.parse({
        data: {
          ...SUMMARY,
          deliveryMode: 'EMAIL',
          delivery: { mode: 'EMAIL', invitationCode: null },
        },
      }).data.delivery,
    ).toEqual({ mode: 'EMAIL', invitationCode: null })
    // A presenter that put the code on the EMAIL branch fails its contract
    // rather than leaking it.
    expect(
      organizerInvitationIssuedResponseSchema.safeParse({
        data: { ...SUMMARY, delivery: { mode: 'EMAIL', invitationCode: CODE } },
      }).success,
    ).toBe(false)
  })

  it('reports only the four states and lists with the delivery mode', () => {
    expect(
      organizerInvitationResponseSchema.safeParse({ data: { ...SUMMARY, status: 'WAITING' } })
        .success,
    ).toBe(false)
    expect(
      organizerInvitationListResponseSchema.parse({
        data: [SUMMARY],
        pagination: {
          page: 1,
          perPage: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        meta: { deliveryMode: 'MANUAL' },
      }).meta,
    ).toEqual({ deliveryMode: 'MANUAL' })
  })
})
