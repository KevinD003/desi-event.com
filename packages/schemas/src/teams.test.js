/**
 * The team list's two shapes, fed what a careless presenter might send.
 *
 * The masked shape is the one that matters: a full address a handler left in,
 * or put where a masked one belongs, must not survive parsing.
 */

import { describe, expect, it } from 'vitest'

import { memberListResponseSchema, maskedEmailSchema } from './teams.js'

const MEMBER = {
  id: 'ckl1a2b3c4d5e6f7g8h9i0ja',
  userId: 'ckl1a2b3c4d5e6f7g8h9i0jb',
  displayName: 'Meera',
  role: 'OWNER',
  capabilities: ['organization:view_members'],
  scopedEventIds: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  self: false,
}

const INVITATION = {
  id: 'ckl1a2b3c4d5e6f7g8h9i0jc',
  role: 'STAFF',
  status: 'PENDING',
  invitedByName: 'Meera',
  expiresAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** Fields a presenter should never forward, whatever the shape. */
const HOSTILE = {
  passwordHash: 'scrypt$abc',
  phone: '+919999999999',
  platformRole: 'SUPER_ADMIN',
  lastSignInAt: '2026-01-01T00:00:00.000Z',
}

describe('memberListResponseSchema', () => {
  it('strips a full address a presenter left on a masked entry', () => {
    const parsed = memberListResponseSchema.parse({
      data: {
        emailVisibility: 'MASKED',
        members: [
          {
            ...MEMBER,
            ...HOSTILE,
            email: 'meera@rangoli.example',
            emailMasked: 'm***a@rangoli.example',
          },
        ],
        invitations: [
          { ...INVITATION, email: 'new@rangoli.example', emailMasked: 'n*w@rangoli.example' },
        ],
        assignableRoles: [],
      },
    })

    const wire = JSON.stringify(parsed)

    expect(wire).not.toContain('meera@rangoli.example')
    expect(wire).not.toContain('new@rangoli.example')
    expect(wire).not.toContain('scrypt$')
    expect(wire).not.toContain('+9199')
    expect(parsed.data.members[0]).not.toHaveProperty('email')
    expect(parsed.data.members[0].emailMasked).toBe('m***a@rangoli.example')
  })

  it('refuses a full address put where a masked one belongs', () => {
    const result = memberListResponseSchema.safeParse({
      data: {
        emailVisibility: 'MASKED',
        members: [{ ...MEMBER, emailMasked: 'meera@rangoli.example' }],
        invitations: [],
        assignableRoles: [],
      },
    })

    expect(result.success).toBe(false)
  })

  it('refuses a masked list with no masked address, rather than sending nothing silently', () => {
    expect(
      memberListResponseSchema.safeParse({
        data: {
          emailVisibility: 'MASKED',
          members: [{ ...MEMBER, email: 'meera@rangoli.example' }],
          invitations: [],
          assignableRoles: [],
        },
      }).success,
    ).toBe(false)
  })

  it('carries full addresses only under FULL, and strips everything else there too', () => {
    const parsed = memberListResponseSchema.parse({
      data: {
        emailVisibility: 'FULL',
        members: [{ ...MEMBER, ...HOSTILE, email: 'Meera@Rangoli.example' }],
        invitations: [{ ...INVITATION, email: 'new@rangoli.example' }],
        assignableRoles: ['ADMIN'],
      },
    })

    expect(parsed.data.members[0].email).toBe('meera@rangoli.example')
    expect(JSON.stringify(parsed)).not.toContain('scrypt$')
  })

  it('refuses a visibility it does not know', () => {
    expect(
      memberListResponseSchema.safeParse({
        data: { emailVisibility: 'PARTIAL', members: [], invitations: [], assignableRoles: [] },
      }).success,
    ).toBe(false)
  })
})

describe('maskedEmailSchema', () => {
  it.each(['p***a@example.com', '**@example.com', '(none)'])('accepts %s', (value) => {
    expect(maskedEmailSchema.parse(value)).toBe(value)
  })

  it.each(['priya@example.com', 'none', ''])('refuses %s', (value) => {
    expect(maskedEmailSchema.safeParse(value).success).toBe(false)
  })
})
