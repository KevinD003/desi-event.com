/**
 * The team list's three shapes, fed what a careless presenter might send.
 *
 * The two without addresses are the ones that matter. A full address a handler
 * left in, a stand-in from the old masked form, or an address typed into a
 * name must not survive parsing.
 */

import { describe, expect, it } from 'vitest'

import {
  EMAIL_VISIBILITIES,
  acceptedInvitationResponseSchema,
  assignableOrgRoleSchema,
  invitationResponseSchema,
  memberListResponseSchema,
  ownershipTransferredResponseSchema,
  transferOwnershipRequestSchema,
} from './teams.js'

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
  deliveryMode: 'MANUAL',
}

/** A code shaped exactly as `issueToken` mints one: 43 url-safe characters. */
const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

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

describe('invitation delivery', () => {
  const ISSUED = { ...INVITATION, email: 'new@rangoli.example' }

  it('carries the code on the MANUAL branch, exactly as issued', () => {
    expect(CODE).toHaveLength(43)

    const parsed = invitationResponseSchema.parse({
      data: { ...ISSUED, delivery: { mode: 'MANUAL', invitationCode: CODE } },
    })

    expect(parsed.data.delivery).toEqual({ mode: 'MANUAL', invitationCode: CODE })
  })

  it('refuses a MANUAL response with no code, or with anything but a 43-character code', () => {
    for (const invitationCode of [
      undefined,
      null,
      '',
      CODE.slice(1),
      `${CODE}x`,
      `${CODE.slice(1)}=`,
    ]) {
      expect(
        invitationResponseSchema.safeParse({
          data: { ...ISSUED, delivery: { mode: 'MANUAL', invitationCode } },
        }).success,
        String(invitationCode),
      ).toBe(false)
    }
  })

  it('refuses an EMAIL response that carries a code, rather than send it', () => {
    // The provider delivered it; handing it to the inviter too would make them
    // a second holder. A presenter that planted one fails the contract.
    expect(
      invitationResponseSchema.safeParse({
        data: { ...ISSUED, delivery: { mode: 'EMAIL', invitationCode: CODE } },
      }).success,
    ).toBe(false)

    expect(
      invitationResponseSchema.parse({
        data: { ...ISSUED, delivery: { mode: 'EMAIL', invitationCode: null } },
      }).data.delivery,
    ).toEqual({ mode: 'EMAIL', invitationCode: null })
  })

  it('strips a planted code or digest from anywhere else in the invitation', () => {
    const parsed = invitationResponseSchema.parse({
      data: {
        ...ISSUED,
        tokenHash: 'f'.repeat(64),
        token: CODE,
        invitationCode: CODE,
        delivery: { mode: 'EMAIL', invitationCode: null, token: CODE },
      },
    })

    expect(JSON.stringify(parsed)).not.toContain(CODE)
    expect(JSON.stringify(parsed)).not.toContain('f'.repeat(64))
  })

  it('accepts an invitation issued before delivery modes existed, and no other mode', () => {
    expect(invitationResponseSchema.shape.data.shape.deliveryMode.safeParse(null).success).toBe(
      true,
    )
    expect(invitationResponseSchema.shape.data.shape.deliveryMode.safeParse('SMS').success).toBe(
      false,
    )
  })

  it.each(EMAIL_VISIBILITIES)(
    'never lets a team list under %s carry a code or a digest planted in an invitation',
    (emailVisibility) => {
      const parsed = memberListResponseSchema.parse({
        data: {
          emailVisibility,
          members: [],
          invitations: [
            {
              ...INVITATION,
              ...(emailVisibility === 'FULL' ? { email: 'new@rangoli.example' } : {}),
              invitationCode: CODE,
              tokenHash: 'f'.repeat(64),
              delivery: { mode: 'MANUAL', invitationCode: CODE },
            },
          ],
          assignableRoles: [],
        },
      })

      const wire = JSON.stringify(parsed)

      expect(wire).not.toContain(CODE)
      expect(wire).not.toContain('f'.repeat(64))
      expect(parsed.data.invitations[0].deliveryMode).toBe('MANUAL')
    },
  )
})

describe('accepting an invitation', () => {
  it('says what the session now needs', () => {
    const parsed = acceptedInvitationResponseSchema.parse({
      data: {
        organizationId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
        organizationName: 'Rangoli Collective',
        role: 'ADMIN',
        joined: true,
        session: { mfaRequired: true, mfaEnrolled: false },
      },
    })

    expect(parsed.data.session).toEqual({ mfaRequired: true, mfaEnrolled: false })
    expect(parsed.data.joined).toBe(true)
  })

  it('says whether anything was joined, so a screen never claims sessions ended for nothing', () => {
    const base = {
      organizationId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
      organizationName: 'Rangoli Collective',
      role: 'STAFF',
      session: { mfaRequired: false, mfaEnrolled: false },
    }

    expect(acceptedInvitationResponseSchema.safeParse({ data: base }).success).toBe(false)
    expect(
      acceptedInvitationResponseSchema.parse({ data: { ...base, joined: false } }).data.joined,
    ).toBe(false)
  })
})

describe('ownership transfer', () => {
  it('names one membership, and nothing else', () => {
    expect(
      transferOwnershipRequestSchema.parse({ toMemberId: 'ckl1a2b3c4d5e6f7g8h9i0ja' }),
    ).toEqual({ toMemberId: 'ckl1a2b3c4d5e6f7g8h9i0ja' })
    expect(transferOwnershipRequestSchema.safeParse({}).success).toBe(false)
    expect(transferOwnershipRequestSchema.safeParse({ toMemberId: 'not an id' }).success).toBe(
      false,
    )
    // A role cannot be chosen: the previous owner always becomes an administrator.
    expect(
      transferOwnershipRequestSchema.parse({
        toMemberId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
        keepRole: 'OWNER',
      }),
    ).not.toHaveProperty('keepRole')
  })

  it('leaves the previous owner an administrator and nothing else', () => {
    const data = {
      organizationId: 'ckl1a2b3c4d5e6f7g8h9i0ja',
      ownerMembershipId: 'ckl1a2b3c4d5e6f7g8h9i0jb',
      previousOwnerMembershipId: 'ckl1a2b3c4d5e6f7g8h9i0jc',
    }

    expect(
      ownershipTransferredResponseSchema.safeParse({
        data: { ...data, previousOwnerRole: 'ADMIN' },
      }).success,
    ).toBe(true)
    expect(
      ownershipTransferredResponseSchema.safeParse({
        data: { ...data, previousOwnerRole: 'OWNER' },
      }).success,
    ).toBe(false)
  })

  it('still keeps OWNER out of every invite and role change', () => {
    expect(assignableOrgRoleSchema.safeParse('OWNER').success).toBe(false)
    expect(assignableOrgRoleSchema.safeParse('ADMIN').success).toBe(true)
  })
})
