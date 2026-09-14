import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES, ORG_ROLE_ORDER } from './capabilities.js'
import { can, assertCan, capabilitiesFor, orgRoleFor } from './can.js'
import { PermissionError } from './errors.js'

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'

/**
 * The authoritative expectation, written out by hand rather than derived from
 * the implementation: what a member of ORG_A may do in ORG_A.
 */
const EXPECTED_ORG_MATRIX = {
  VIEWER: ['event:view_draft', 'order:view', 'organization:view_members', 'report:view'],
  STAFF: [
    'event:view_draft',
    'order:view',
    'organization:view_members',
    'report:view',
    'ticket:check_in',
  ],
  MANAGER: [
    'event:create',
    'event:publish',
    'event:update',
    'event:view_draft',
    'order:view',
    'organization:view_members',
    'promo:manage',
    'report:view',
    'ticketType:manage',
    'ticket:check_in',
  ],
  ADMIN: [
    'event:create',
    'event:delete',
    'event:publish',
    'event:update',
    'event:view_draft',
    'order:refund',
    'order:view',
    'organization:view_members',
    'promo:manage',
    'report:view',
    'ticketType:manage',
    'ticket:check_in',
  ],
  OWNER: [
    'event:create',
    'event:delete',
    'event:publish',
    'event:update',
    'event:view_draft',
    'order:refund',
    'order:view',
    'organization:manage',
    'organization:view_members',
    'promo:manage',
    'report:view',
    'ticketType:manage',
    'ticket:check_in',
  ],
}

/**
 * Build an actor holding a single membership in ORG_A.
 *
 * @param {string} orgRole Membership role.
 * @param {string} [platformRole] Platform-wide role.
 * @returns {object} An actor.
 */
function memberOfA(orgRole, platformRole = 'ORGANIZER') {
  return {
    id: 'usr_1',
    role: platformRole,
    memberships: [{ organizationId: ORG_A, role: orgRole }],
  }
}

describe('can — the full role/capability matrix', () => {
  for (const orgRole of ORG_ROLE_ORDER) {
    for (const capability of ALL_CAPABILITIES) {
      const expected = EXPECTED_ORG_MATRIX[orgRole].includes(capability)

      it(`${orgRole} ${expected ? 'may' : 'may not'} ${capability} in their own org`, () => {
        expect(can(memberOfA(orgRole), capability, { organizationId: ORG_A })).toBe(expected)
      })
    }
  }

  it('produces the same matrix whether the platform role is ATTENDEE or ORGANIZER', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      for (const capability of ALL_CAPABILITIES) {
        const context = { organizationId: ORG_A }
        expect(can(memberOfA(orgRole, 'ATTENDEE'), capability, context)).toBe(
          can(memberOfA(orgRole, 'ORGANIZER'), capability, context),
        )
      }
    }
  })

  it('never grants platform:admin through an organisation membership', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      expect(can(memberOfA(orgRole), 'platform:admin', { organizationId: ORG_A })).toBe(false)
    }
  })

  it('gives STAFF check-in but not event editing', () => {
    const staff = memberOfA('STAFF')
    expect(can(staff, 'ticket:check_in', { organizationId: ORG_A })).toBe(true)
    expect(can(staff, 'event:update', { organizationId: ORG_A })).toBe(false)
    expect(can(staff, 'event:publish', { organizationId: ORG_A })).toBe(false)
  })
})

describe('can — cross-organisation isolation', () => {
  it('denies every capability in an organisation the actor does not belong to', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      for (const capability of ALL_CAPABILITIES) {
        expect(can(memberOfA(orgRole), capability, { organizationId: ORG_B })).toBe(false)
      }
    }
  })

  it('does not let a MANAGER of org A manage org B', () => {
    const manager = memberOfA('MANAGER')

    expect(can(manager, 'event:update', { organizationId: ORG_A })).toBe(true)
    expect(can(manager, 'event:update', { organizationId: ORG_B })).toBe(false)
    expect(can(manager, 'ticketType:manage', { organizationId: ORG_B })).toBe(false)
    expect(can(manager, 'event:view_draft', { organizationId: ORG_B })).toBe(false)
  })

  it('applies each membership only to its own organisation', () => {
    const actor = {
      id: 'usr_2',
      role: 'ORGANIZER',
      memberships: [
        { organizationId: ORG_A, role: 'OWNER' },
        { organizationId: ORG_B, role: 'VIEWER' },
      ],
    }

    expect(can(actor, 'organization:manage', { organizationId: ORG_A })).toBe(true)
    expect(can(actor, 'organization:manage', { organizationId: ORG_B })).toBe(false)
    expect(can(actor, 'report:view', { organizationId: ORG_B })).toBe(true)
    expect(can(actor, 'ticket:check_in', { organizationId: ORG_B })).toBe(false)
  })

  it('denies org-scoped capabilities when no organizationId is supplied', () => {
    const owner = memberOfA('OWNER')

    expect(can(owner, 'event:update')).toBe(false)
    expect(can(owner, 'event:update', {})).toBe(false)
    expect(can(owner, 'event:update', { organizationId: null })).toBe(false)
    expect(can(owner, 'event:update', { organizationId: '' })).toBe(false)
  })

  it('does not match organisations by prefix or loose equality', () => {
    const owner = memberOfA('OWNER')

    expect(can(owner, 'event:update', { organizationId: ORG_A.slice(0, -1) })).toBe(false)
    expect(can(owner, 'event:update', { organizationId: `${ORG_A} ` })).toBe(false)
    expect(can(owner, 'event:update', { organizationId: ORG_A.toUpperCase() })).toBe(false)
  })
})

describe('can — platform admin override', () => {
  const platformAdmin = { id: 'usr_admin', role: 'ADMIN', memberships: [] }

  it('grants every known capability in any organisation, with no membership', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can(platformAdmin, capability, { organizationId: ORG_B })).toBe(true)
      expect(can(platformAdmin, capability)).toBe(true)
    }
  })

  it('still fails closed on an unknown capability', () => {
    expect(can(platformAdmin, 'event:hijack', { organizationId: ORG_A })).toBe(false)
  })
})

describe('can — unauthenticated and malformed input', () => {
  it('denies a missing actor', () => {
    for (const actor of [null, undefined]) {
      for (const capability of ALL_CAPABILITIES) {
        expect(can(actor, capability, { organizationId: ORG_A })).toBe(false)
      }
    }
  })

  it('denies a non-object actor', () => {
    expect(can('usr_1', 'event:update', { organizationId: ORG_A })).toBe(false)
    expect(can(7, 'event:update', { organizationId: ORG_A })).toBe(false)
  })

  it('denies unknown capabilities for every role', () => {
    const unknowns = ['', 'event', 'EVENT_CREATE', 'event:hijack', 'platform:root', null, undefined]

    for (const orgRole of ORG_ROLE_ORDER) {
      for (const capability of unknowns) {
        expect(can(memberOfA(orgRole), capability, { organizationId: ORG_A })).toBe(false)
      }
    }
  })

  it('tolerates an actor with no memberships array', () => {
    const actor = { id: 'usr_3', role: 'ORGANIZER' }
    expect(can(actor, 'event:update', { organizationId: ORG_A })).toBe(false)
    expect(capabilitiesFor(actor, ORG_A)).toEqual([])
  })

  it('ignores malformed membership entries', () => {
    const actor = {
      id: 'usr_4',
      role: 'ORGANIZER',
      memberships: [null, { organizationId: ORG_A }, { organizationId: ORG_A, role: 'GOD' }],
    }

    expect(can(actor, 'event:view_draft', { organizationId: ORG_A })).toBe(false)
    expect(orgRoleFor(actor, ORG_A)).toBe(null)
  })

  it('treats an unknown platform role as granting nothing', () => {
    const actor = { id: 'usr_5', role: 'SUPERUSER', memberships: [] }
    expect(can(actor, 'platform:admin')).toBe(false)
    expect(capabilitiesFor(actor)).toEqual([])
  })
})

describe('orgRoleFor', () => {
  it('returns the membership role for a matching organisation', () => {
    expect(orgRoleFor(memberOfA('MANAGER'), ORG_A)).toBe('MANAGER')
  })

  it('returns null for a non-member, a missing actor or a missing organisation', () => {
    expect(orgRoleFor(memberOfA('OWNER'), ORG_B)).toBe(null)
    expect(orgRoleFor(null, ORG_A)).toBe(null)
    expect(orgRoleFor(memberOfA('OWNER'), undefined)).toBe(null)
  })

  it('picks the most privileged membership when an organisation appears twice', () => {
    const lowFirst = {
      id: 'usr_6',
      role: 'ORGANIZER',
      memberships: [
        { organizationId: ORG_A, role: 'VIEWER' },
        { organizationId: ORG_A, role: 'ADMIN' },
      ],
    }
    const highFirst = { ...lowFirst, memberships: [...lowFirst.memberships].reverse() }

    expect(orgRoleFor(lowFirst, ORG_A)).toBe('ADMIN')
    expect(orgRoleFor(highFirst, ORG_A)).toBe('ADMIN')
    expect(can(lowFirst, 'order:refund', { organizationId: ORG_A })).toBe(true)
  })
})

describe('capabilitiesFor', () => {
  it('returns the exact capability list for each org role', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      expect(capabilitiesFor(memberOfA(orgRole), ORG_A)).toEqual(
        [...EXPECTED_ORG_MATRIX[orgRole]].sort(),
      )
    }
  })

  it('returns nothing for an organisation the actor does not belong to', () => {
    expect(capabilitiesFor(memberOfA('OWNER'), ORG_B)).toEqual([])
  })

  it('returns only platform capabilities when no organisation is given', () => {
    expect(capabilitiesFor(memberOfA('OWNER'))).toEqual([])
    expect(capabilitiesFor({ id: 'a', role: 'ADMIN', memberships: [] })).toEqual([
      ...ALL_CAPABILITIES,
    ])
  })

  it('reflects the platform admin override in every organisation', () => {
    const admin = { id: 'usr_admin', role: 'ADMIN', memberships: [] }
    expect(capabilitiesFor(admin, ORG_B)).toEqual([...ALL_CAPABILITIES])
  })

  it('unions platform and membership capabilities without duplicates', () => {
    const admin = { id: 'usr_admin', role: 'ADMIN', memberships: [{ organizationId: ORG_A, role: 'OWNER' }] }
    const result = capabilitiesFor(admin, ORG_A)

    expect(result).toEqual([...ALL_CAPABILITIES])
    expect(new Set(result).size).toBe(result.length)
  })

  it('returns an empty list for a missing actor', () => {
    expect(capabilitiesFor(null, ORG_A)).toEqual([])
    expect(capabilitiesFor(undefined)).toEqual([])
  })

  it('returns a fresh mutable array that does not affect later calls', () => {
    const first = capabilitiesFor(memberOfA('VIEWER'), ORG_A)
    first.push('organization:manage')

    expect(capabilitiesFor(memberOfA('VIEWER'), ORG_A)).not.toContain('organization:manage')
  })

  it('agrees with can() for every role and capability', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      const actor = memberOfA(orgRole)
      const granted = capabilitiesFor(actor, ORG_A)

      for (const capability of ALL_CAPABILITIES) {
        expect(granted.includes(capability)).toBe(can(actor, capability, { organizationId: ORG_A }))
      }
    }
  })
})

describe('assertCan', () => {
  it('returns undefined when the actor is permitted', () => {
    expect(assertCan(memberOfA('OWNER'), 'event:update', { organizationId: ORG_A })).toBeUndefined()
  })

  it('throws a 403 PermissionError carrying the capability and organisation', () => {
    let thrown = null

    try {
      assertCan(memberOfA('STAFF'), 'event:update', { organizationId: ORG_A })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PermissionError)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.name).toBe('PermissionError')
    expect(thrown.statusCode).toBe(403)
    expect(thrown.code).toBe('FORBIDDEN')
    expect(thrown.capability).toBe('event:update')
    expect(thrown.organizationId).toBe(ORG_A)
    expect(thrown.actorId).toBe('usr_1')
    expect(thrown.reason).toBe('missing_capability')
    expect(thrown.message).toContain('event:update')
    expect(thrown.message).toContain(ORG_A)
  })

  it('throws for a cross-organisation attempt', () => {
    expect(() =>
      assertCan(memberOfA('MANAGER'), 'event:update', { organizationId: ORG_B }),
    ).toThrow(PermissionError)
  })

  it('throws with reason unauthenticated for a missing actor', () => {
    let thrown = null

    try {
      assertCan(null, 'order:view', { organizationId: ORG_A })
    } catch (error) {
      thrown = error
    }

    expect(thrown.statusCode).toBe(403)
    expect(thrown.reason).toBe('unauthenticated')
    expect(thrown.actorId).toBe(null)
    expect(thrown.message).toMatch(/Authentication is required/)
  })

  it('throws with reason unknown_capability, echoing the string that was asked for', () => {
    let thrown = null

    try {
      assertCan(memberOfA('OWNER'), 'event:hijack', { organizationId: ORG_A })
    } catch (error) {
      thrown = error
    }

    expect(thrown.reason).toBe('unknown_capability')
    expect(thrown.capability).toBe('event:hijack')
    expect(thrown.message).toContain('event:hijack')
  })

  it('stringifies a non-string capability in the message without claiming it as a capability', () => {
    let thrown = null

    try {
      assertCan(memberOfA('OWNER'), undefined, { organizationId: ORG_A })
    } catch (error) {
      thrown = error
    }

    expect(thrown.capability).toBe(null)
    expect(thrown.message).toContain('undefined')
  })

  it('omits the organisation clause when the check is unscoped', () => {
    let thrown = null

    try {
      assertCan(memberOfA('OWNER'), 'platform:admin')
    } catch (error) {
      thrown = error
    }

    expect(thrown.organizationId).toBe(null)
    expect(thrown.message).not.toContain('in organization')
  })

  it('does not throw for a platform admin on any known capability', () => {
    const admin = { id: 'usr_admin', role: 'ADMIN', memberships: [] }
    for (const capability of ALL_CAPABILITIES) {
      expect(() => assertCan(admin, capability, { organizationId: ORG_B })).not.toThrow()
    }
  })
})
