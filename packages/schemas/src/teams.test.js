/**
 * The team list's three shapes, fed what a careless presenter might send.
 *
 * The two without addresses are the ones that matter. A full address a handler
 * left in, a stand-in from the old masked form, or an address typed into a
 * name must not survive parsing.
 */

import { describe, expect, it } from 'vitest'

import { EMAIL_VISIBILITIES, memberListResponseSchema } from './teams.js'

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

/** The two shapes that carry no address. */
const WITHOUT_ADDRESSES = ['STEP_UP_REQUIRED', 'HIDDEN']

describe('memberListResponseSchema', () => {
  it('knows exactly three visibilities, and MASKED is no longer one of them', () => {
    expect(EMAIL_VISIBILITIES).toEqual(['FULL', 'STEP_UP_REQUIRED', 'HIDDEN'])
    expect(
      memberListResponseSchema.safeParse({
        data: { emailVisibility: 'MASKED', members: [], invitations: [], assignableRoles: [] },
      }).success,
    ).toBe(false)
  })

  it.each(WITHOUT_ADDRESSES)(
    'strips a full address, and any stand-in, a presenter left on a %s entry',
    (emailVisibility) => {
      const parsed = memberListResponseSchema.parse({
        data: {
          emailVisibility,
          members: [
            {
              ...MEMBER,
              ...HOSTILE,
              email: 'meera@rangoli.example',
              emailMasked: 'm***a@rangoli.example',
              toEmailMasked: '••••@rangoli.example',
            },
          ],
          invitations: [
            { ...INVITATION, email: 'new@rangoli.example', emailMasked: 'n*w@rangoli.example' },
          ],
          assignableRoles: [],
        },
      })

      const wire = JSON.stringify(parsed)

      // Nothing of any address: not the address, not the old mask, not even
      // the domain, which this list has no use for.
      expect(wire).not.toContain('@')
      expect(wire).not.toContain('rangoli.example')
      expect(wire).not.toContain('scrypt$')
      expect(wire).not.toContain('+9199')
      expect(parsed.data.members[0]).not.toHaveProperty('email')
      expect(parsed.data.members[0]).not.toHaveProperty('emailMasked')
      expect(parsed.data.invitations[0]).not.toHaveProperty('email')
      expect(parsed.data.invitations[0]).not.toHaveProperty('emailMasked')
    },
  )

  it.each(WITHOUT_ADDRESSES)(
    'accepts a %s entry with no address field at all',
    (emailVisibility) => {
      const parsed = memberListResponseSchema.parse({
        data: {
          emailVisibility,
          members: [MEMBER],
          invitations: [INVITATION],
          assignableRoles: [],
        },
      })

      expect(parsed.data.members[0].displayName).toBe('Meera')
    },
  )

  it.each(WITHOUT_ADDRESSES)(
    'refuses a %s entry whose name carries an address, rather than send it',
    (emailVisibility) => {
      for (const displayName of ['meera@rangoli.example', 'Meera (meera.k+team@rangoli.example)']) {
        expect(
          memberListResponseSchema.safeParse({
            data: {
              emailVisibility,
              members: [{ ...MEMBER, displayName }],
              invitations: [],
              assignableRoles: [],
            },
          }).success,
          displayName,
        ).toBe(false)
      }

      expect(
        memberListResponseSchema.safeParse({
          data: {
            emailVisibility,
            members: [],
            invitations: [{ ...INVITATION, invitedByName: '<meera@rangoli.example>' }],
            assignableRoles: [],
          },
        }).success,
      ).toBe(false)
    },
  )

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

  it('refuses a FULL entry with no address, rather than send a list that looks complete', () => {
    expect(
      memberListResponseSchema.safeParse({
        data: {
          emailVisibility: 'FULL',
          members: [MEMBER],
          invitations: [],
          assignableRoles: [],
        },
      }).success,
    ).toBe(false)
  })

  it('refuses a visibility it does not know', () => {
    expect(
      memberListResponseSchema.safeParse({
        data: { emailVisibility: 'PARTIAL', members: [], invitations: [], assignableRoles: [] },
      }).success,
    ).toBe(false)
  })
})
