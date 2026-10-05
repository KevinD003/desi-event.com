/**
 * Organisations: what the organiser chooses when an invitation starts one, and
 * what may never arrive from them.
 *
 * Nobody creates an organisation for themselves any more. The request that
 * matters is the acceptance of an organiser invitation, and it is the attack
 * surface: the name, description and website come from the invitation, and the
 * verification state, badge, payout currency and contact address are the
 * server's. Each test feeds a schema a field somebody would like to set and
 * checks it does not arrive.
 */

import { describe, expect, it } from 'vitest'

import * as organizations from './organizations.js'
import {
  US_ORGANIZATION_TIMEZONES,
  organizationNameSchema,
  organizationProfileInputSchema,
  organizationProfileResponseSchema,
} from './organizations.js'
import {
  acceptOrganizerInvitationRequestSchema,
  acceptedOrganizerInvitationResponseSchema,
} from './organizer-invitations.js'

/** A code shaped exactly as `issueToken` mints one: 43 url-safe characters. */
const TOKEN = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

const PROFILE = {
  id: 'ckl1a2b3c4d5e6f7g8h9i0ja',
  name: 'Bay Lights Garba Co.',
  slug: 'bay-lights-garba-co',
  description: null,
  websiteUrl: null,
  timezone: 'America/Los_Angeles',
  legalName: null,
  verificationStatus: 'VERIFIED',
  eligible: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

describe('self-service creation is gone', () => {
  it('exports no create schema, no daily cap and no create response', () => {
    expect(organizations.createOrganizationRequestSchema).toBeUndefined()
    expect(organizations.ORGANIZATIONS_PER_ACCOUNT_PER_DAY).toBeUndefined()
    expect(organizations.organizationCreatedResponseSchema).toBeUndefined()
  })
})

describe('organizationNameSchema', () => {
  it('trims, and bounds the name at 2 to 120 characters', () => {
    expect(organizationNameSchema.parse('  Bay Lights Garba Co. ')).toBe('Bay Lights Garba Co.')
    expect(organizationNameSchema.safeParse('x').success).toBe(false)
    expect(organizationNameSchema.safeParse('x'.repeat(121)).success).toBe(false)
    expect(organizationNameSchema.safeParse('xy').success).toBe(true)
    expect(organizationNameSchema.safeParse('x'.repeat(120)).success).toBe(true)
  })

  it('refuses a name that is an email address', () => {
    // An organisation's name is published on its organiser page.
    expect(organizationNameSchema.safeParse('x@y.com').success).toBe(false)
    expect(organizationNameSchema.safeParse('Garba (book at me@example.com)').success).toBe(false)
  })

  it('keeps a name in any script', () => {
    expect(organizationNameSchema.parse('કાઠિયાવાડ ફોક નાઇટ્સ')).toBe('કાઠિયાવાડ ફોક નાઇટ્સ')
  })
})

describe('acceptOrganizerInvitationRequestSchema', () => {
  it('needs only the code, and fills the time zone', () => {
    expect(acceptOrganizerInvitationRequestSchema.parse({ token: TOKEN })).toEqual({
      token: TOKEN,
      timezone: 'America/New_York',
    })
  })

  it('strips every field the server or the invitation sets, whatever the request says', () => {
    const parsed = acceptOrganizerInvitationRequestSchema.parse({
      token: TOKEN,
      name: 'Renamed By Recipient',
      description: 'Unreviewed words for the public page',
      websiteUrl: 'https://unreviewed.example/',
      verificationStatus: 'VERIFIED',
      verified: true,
      payoutCurrency: 'INR',
      contactEmail: 'attacker@example.com',
      legalName: 'Registered Name LLC',
      suspendedAt: null,
      suspendedReason: 'x',
      createdById: 'ckl1a2b3c4d5e6f7g8h9i0ja',
      ownerUserId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
    })

    expect(Object.keys(parsed).sort()).toEqual(['timezone', 'token'])
  })

  it('accepts only the US time zones', () => {
    for (const timezone of US_ORGANIZATION_TIMEZONES) {
      expect(
        acceptOrganizerInvitationRequestSchema.safeParse({ token: TOKEN, timezone }).success,
      ).toBe(true)
    }

    for (const timezone of ['Asia/Kolkata', 'Europe/London', 'Mars/Olympus']) {
      expect(
        acceptOrganizerInvitationRequestSchema.safeParse({ token: TOKEN, timezone }).success,
      ).toBe(false)
    }
  })

  it('treats a blank slug as absent, and takes one only in slug form', () => {
    expect(acceptOrganizerInvitationRequestSchema.parse({ token: TOKEN, slug: '   ' })).toEqual({
      token: TOKEN,
      timezone: 'America/New_York',
    })
    expect(
      acceptOrganizerInvitationRequestSchema.parse({ token: TOKEN, slug: 'Bay-Lights' }).slug,
    ).toBe('bay-lights')
    expect(
      acceptOrganizerInvitationRequestSchema.safeParse({ token: TOKEN, slug: 'bay lights' })
        .success,
    ).toBe(false)
  })

  it('refuses a missing or malformed code', () => {
    expect(acceptOrganizerInvitationRequestSchema.safeParse({}).success).toBe(false)
    expect(acceptOrganizerInvitationRequestSchema.safeParse({ token: 'short' }).success).toBe(false)
    expect(
      acceptOrganizerInvitationRequestSchema.safeParse({ token: `${TOKEN}?x=1` }).success,
    ).toBe(false)
  })

  it('shares its profile fields with organizationProfileInputSchema', () => {
    expect(Object.keys(organizationProfileInputSchema.shape).sort()).toEqual(['slug', 'timezone'])
  })
})

describe('organisation responses', () => {
  it('never carry the contact address, the payout currency or who created it', () => {
    const planted = {
      ...PROFILE,
      contactEmail: 'owner@example.com',
      payoutCurrency: 'USD',
      createdById: 'ckl1a2b3c4d5e6f7g8h9i0jb',
      suspendedReason: 'internal',
    }

    for (const parsed of [
      organizationProfileResponseSchema.parse({ data: planted }),
      acceptedOrganizerInvitationResponseSchema.parse({
        data: {
          organization: planted,
          role: 'OWNER',
          session: { mfaRequired: true, mfaEnrolled: false },
        },
      }),
    ]) {
      const wire = JSON.stringify(parsed)

      expect(wire).not.toContain('contactEmail')
      expect(wire).not.toContain('owner@example.com')
      expect(wire).not.toContain('payoutCurrency')
      expect(wire).not.toContain('createdById')
      expect(wire).not.toContain('internal')
    }
  })

  it('reports the accepting account as OWNER and nothing else', () => {
    const session = { mfaRequired: true, mfaEnrolled: true }

    for (const role of ['ADMIN', 'EVENT_MANAGER', 'VIEWER']) {
      expect(
        acceptedOrganizerInvitationResponseSchema.safeParse({
          data: { organization: PROFILE, role, session },
        }).success,
      ).toBe(false)
    }
    expect(
      acceptedOrganizerInvitationResponseSchema.safeParse({
        data: { organization: PROFILE, role: 'OWNER', session },
      }).success,
    ).toBe(true)
  })
})
