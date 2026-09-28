/**
 * Creating an organisation: what a request may say, and what it may not.
 *
 * The request is the attack surface. Everything that makes a new organisation
 * safe — unverified, unbadged, paid in the platform's currency, reachable at
 * the creator's own address — is set by the server, so each test here feeds
 * the schema a field somebody would like to set and checks it does not arrive.
 */

import { describe, expect, it } from 'vitest'

import {
  ORGANIZATIONS_PER_ACCOUNT_PER_DAY,
  US_ORGANIZATION_TIMEZONES,
  createOrganizationRequestSchema,
  organizationCreatedResponseSchema,
  organizationProfileResponseSchema,
} from './organizations.js'

const PROFILE = {
  id: 'ckl1a2b3c4d5e6f7g8h9i0ja',
  name: 'Bay Lights Garba Co.',
  slug: 'bay-lights-garba-co',
  description: null,
  websiteUrl: null,
  timezone: 'America/Los_Angeles',
  legalName: null,
  verificationStatus: 'UNVERIFIED',
  eligible: false,
  createdAt: '2026-09-01T00:00:00.000Z',
}

describe('createOrganizationRequestSchema', () => {
  it('needs only a name, and fills the time zone', () => {
    expect(createOrganizationRequestSchema.parse({ name: '  Bay Lights Garba Co. ' })).toEqual({
      name: 'Bay Lights Garba Co.',
      timezone: 'America/New_York',
    })
  })

  it('strips every field the server sets, whatever the request says', () => {
    const parsed = createOrganizationRequestSchema.parse({
      name: 'Bay Lights',
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

    expect(Object.keys(parsed).sort()).toEqual(['name', 'timezone'])
  })

  it('bounds the name at 2 to 120 characters', () => {
    expect(createOrganizationRequestSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(createOrganizationRequestSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false)
    expect(createOrganizationRequestSchema.safeParse({ name: 'xy' }).success).toBe(true)
    expect(createOrganizationRequestSchema.safeParse({ name: 'x'.repeat(120) }).success).toBe(true)
  })

  it('refuses a name that is an email address', () => {
    // An organisation's name is published on its organiser page.
    expect(createOrganizationRequestSchema.safeParse({ name: 'x@y.com' }).success).toBe(false)
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Garba (book at me@example.com)' }).success,
    ).toBe(false)
  })

  it('accepts only the US time zones', () => {
    for (const timezone of US_ORGANIZATION_TIMEZONES) {
      expect(createOrganizationRequestSchema.safeParse({ name: 'Bay', timezone }).success).toBe(
        true,
      )
    }

    for (const timezone of ['Asia/Kolkata', 'Europe/London', 'Mars/Olympus']) {
      expect(createOrganizationRequestSchema.safeParse({ name: 'Bay', timezone }).success).toBe(
        false,
      )
    }
  })

  it('treats a blank optional field as absent, and bounds the ones given', () => {
    expect(
      createOrganizationRequestSchema.parse({
        name: 'Bay',
        description: '   ',
        websiteUrl: '',
        slug: '',
      }),
    ).toEqual({ name: 'Bay', timezone: 'America/New_York' })

    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Bay', description: 'x'.repeat(2001) })
        .success,
    ).toBe(false)
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Bay', websiteUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false)
    expect(
      createOrganizationRequestSchema.parse({ name: 'Bay', websiteUrl: 'https://bay.example' })
        .websiteUrl,
    ).toBe('https://bay.example')
  })

  it('takes a slug only in slug form', () => {
    expect(createOrganizationRequestSchema.parse({ name: 'Bay', slug: 'Bay-Lights' }).slug).toBe(
      'bay-lights',
    )
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Bay', slug: 'bay lights' }).success,
    ).toBe(false)
  })

  it('caps creation at three a day per account', () => {
    expect(ORGANIZATIONS_PER_ACCOUNT_PER_DAY).toBe(3)
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
      organizationCreatedResponseSchema.parse({
        data: { ...planted, role: 'OWNER', session: { mfaRequired: true, mfaEnrolled: false } },
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

  it('reports the creator as OWNER and nothing else', () => {
    const session = { mfaRequired: true, mfaEnrolled: true }

    expect(
      organizationCreatedResponseSchema.safeParse({ data: { ...PROFILE, role: 'ADMIN', session } })
        .success,
    ).toBe(false)
    expect(
      organizationCreatedResponseSchema.safeParse({ data: { ...PROFILE, role: 'OWNER', session } })
        .success,
    ).toBe(true)
  })
})
