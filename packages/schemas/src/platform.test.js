/**
 * Platform staff administration: the shapes that carry a super
 * administrator's changes.
 */

import { describe, expect, it } from 'vitest'

import {
  grantMembershipRequestSchema,
  platformOrganizationSearchQuerySchema,
  platformRoleChangedResponseSchema,
  platformUserSearchRequestSchema,
  platformUserSearchResponseSchema,
  setPlatformRoleRequestSchema,
} from './platform.js'
import { assignableOrgRoleSchema } from './teams.js'
import { USER_ROLES } from './enums.js'

const USER_ID = 'ckl1a2b3c4d5e6f7g8h9i0ja'

describe('platformUserSearchRequestSchema', () => {
  it('needs at least three characters, trimmed', () => {
    expect(platformUserSearchRequestSchema.safeParse({ q: 'ab' }).success).toBe(false)
    expect(platformUserSearchRequestSchema.safeParse({ q: '  ab  ' }).success).toBe(false)
    expect(platformUserSearchRequestSchema.parse({ q: ' pri ' })).toEqual({
      q: 'pri',
      page: 1,
      perPage: 20,
    })
  })

  it('caps a page at fifty accounts', () => {
    expect(platformUserSearchRequestSchema.safeParse({ q: 'priya', perPage: 51 }).success).toBe(
      false,
    )
    expect(platformUserSearchRequestSchema.parse({ q: 'priya', perPage: 50 }).perPage).toBe(50)
  })

  it('filters by a platform role it knows, and no other', () => {
    expect(platformUserSearchRequestSchema.parse({ q: 'pri', role: 'MODERATOR' }).role).toBe(
      'MODERATOR',
    )
    expect(platformUserSearchRequestSchema.safeParse({ q: 'pri', role: 'ROOT' }).success).toBe(
      false,
    )
  })
})

describe('platformUserSearchResponseSchema', () => {
  it('carries no credential, hash or factor secret a presenter left on the row', () => {
    const parsed = platformUserSearchResponseSchema.parse({
      data: [
        {
          id: USER_ID,
          email: 'priya@example.com',
          displayName: 'Priya',
          role: 'ATTENDEE',
          suspended: false,
          mfaEnrolled: false,
          self: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          memberships: [],
          passwordHash: 'scrypt$abc',
          secretSealed: 'sealed',
          phone: '+12015550101',
        },
      ],
      pagination: {
        page: 1,
        perPage: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })

    const wire = JSON.stringify(parsed)

    expect(wire).not.toContain('scrypt$')
    expect(wire).not.toContain('sealed')
    expect(wire).not.toContain('+1201')
  })
})

describe('setPlatformRoleRequestSchema', () => {
  it.each(USER_ROLES)('accepts the platform role %s', (role) => {
    expect(
      setPlatformRoleRequestSchema.safeParse({ role, reason: 'Joined the team' }).success,
    ).toBe(true)
  })

  it('requires a reason of 3 to 500 characters', () => {
    expect(setPlatformRoleRequestSchema.safeParse({ role: 'MODERATOR' }).success).toBe(false)
    expect(
      setPlatformRoleRequestSchema.safeParse({ role: 'MODERATOR', reason: '  ab ' }).success,
    ).toBe(false)
    expect(
      setPlatformRoleRequestSchema.safeParse({ role: 'MODERATOR', reason: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })

  it('reports how many sessions ended', () => {
    expect(
      platformRoleChangedResponseSchema.parse({
        data: { userId: USER_ID, from: 'ATTENDEE', role: 'MODERATOR', sessionsRevoked: 2 },
      }).data.sessionsRevoked,
    ).toBe(2)
  })
})

describe('grantMembershipRequestSchema', () => {
  it('accepts OWNER here, and only here', () => {
    expect(
      grantMembershipRequestSchema.safeParse({
        userId: USER_ID,
        role: 'OWNER',
        reason: 'The only owner left the company',
      }).success,
    ).toBe(true)
    // The everyday paths still refuse it.
    expect(assignableOrgRoleSchema.safeParse('OWNER').success).toBe(false)
  })

  it('requires a user, a known role and a reason', () => {
    expect(grantMembershipRequestSchema.safeParse({ role: 'ADMIN', reason: 'why' }).success).toBe(
      false,
    )
    expect(
      grantMembershipRequestSchema.safeParse({ userId: USER_ID, role: 'GOD', reason: 'why' })
        .success,
    ).toBe(false)
    expect(grantMembershipRequestSchema.safeParse({ userId: USER_ID, role: 'ADMIN' }).success).toBe(
      false,
    )
  })
})

describe('platformOrganizationSearchQuerySchema', () => {
  it('needs two characters and paginates', () => {
    expect(platformOrganizationSearchQuerySchema.safeParse({ q: 'b' }).success).toBe(false)
    expect(platformOrganizationSearchQuerySchema.parse({ q: 'ba', page: '2' })).toEqual({
      q: 'ba',
      page: 2,
      perPage: 20,
    })
  })
})
