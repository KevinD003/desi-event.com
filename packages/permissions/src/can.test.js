import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_INHERITS,
  ORG_ROLE_ORDER,
  PLATFORM_ROLE_ORDER,
  canAssignOrgRole,
} from './capabilities.js'
import {
  can,
  assertCan,
  assertCanGrantOrgRole,
  canGrantOrgRole,
  capabilitiesFor,
  orgCapabilitiesFor,
  orgRoleFor,
} from './can.js'
import { PermissionError } from './errors.js'

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'

/**
 * The authoritative expectation, written out by hand rather than derived from
 * the implementation: what a member of ORG_A may do in ORG_A.
 */
const EXPECTED_ORG_MATRIX = {
  // Read-only.
  VIEWER: ['event:view_draft', 'order:view', 'organization:view_members', 'report:view'],
  // A door device and nothing else. Deliberately cannot read the order list:
  // a scanner credential is the one most likely to be shared or lost.
  SCANNER: ['ticket:check_in'],
  // Venue staff: scans, and can see what they are scanning against.
  STAFF: [
    'event:view_draft',
    'order:view',
    'organization:view_members',
    'report:view',
    'ticket:check_in',
  ],
  // Runs the event. No money, and no door: an event manager is not on shift.
  EVENT_MANAGER: [
    'attendee:export',
    'event:create',
    'event:pause_sales',
    'event:publish',
    'event:submit_review',
    'event:update',
    'event:view_draft',
    'inventory:manage',
    'order:view',
    'organization:view_members',
    'promo:manage',
    'report:view',
    'ticket:revoke',
    'ticketType:manage',
    'venue:manage',
    'venueMap:manage',
  ],
  // Handles money. Cannot publish, cannot edit, cannot approve its own refund
  // request — that is what order:refund_approve is for and FINANCE lacks it.
  FINANCE: [
    'connect:manage',
    'event:view_draft',
    'finance:view',
    'order:refund_request',
    'order:view',
    'organization:view_members',
    'payout:manage',
    'report:view',
  ],
  // Operations: the door and the event, plus inviting people. Still no money.
  MANAGER: [
    'attendee:export',
    'event:create',
    'event:pause_sales',
    'event:publish',
    'event:submit_review',
    'event:update',
    'event:view_draft',
    'inventory:manage',
    'order:view',
    'organization:view_members',
    'promo:manage',
    'report:view',
    'team:invite',
    'ticket:check_in',
    'ticket:revoke',
    'ticketType:manage',
    'venue:manage',
    'venueMap:manage',
  ],
  // Operations and money, plus the destructive actions.
  ADMIN: [
    'attendee:export',
    'connect:manage',
    'event:cancel',
    'event:create',
    'event:delete',
    'event:pause_sales',
    'event:publish',
    'event:submit_review',
    'event:update',
    'event:view_draft',
    'finance:view',
    'hold:release_any',
    'inventory:manage',
    'order:refund',
    'order:refund_approve',
    'order:refund_request',
    'order:view',
    'organization:submit_verification',
    'organization:view_members',
    'payout:manage',
    'promo:manage',
    'report:view',
    'team:invite',
    'team:remove',
    'team:role_manage',
    'ticket:check_in',
    'ticket:revoke',
    'ticketType:manage',
    'venue:manage',
    'venueMap:manage',
  ],
  // Everything ADMIN has, plus the organisation record itself and the one
  // action in this table that cannot be undone.
  OWNER: [
    'attendee:export',
    'connect:manage',
    'event:cancel',
    'event:create',
    'event:delete',
    'event:pause_sales',
    'event:publish',
    'event:submit_review',
    'event:update',
    'event:view_draft',
    'finance:view',
    'hold:release_any',
    'inventory:manage',
    'order:refund',
    'order:refund_approve',
    'order:refund_request',
    'order:view',
    'organization:manage',
    'organization:submit_verification',
    'organization:view_members',
    'payout:manage',
    'privacy:redact',
    'promo:manage',
    'report:view',
    'team:invite',
    'team:remove',
    'team:role_manage',
    'ticket:check_in',
    'ticket:revoke',
    'ticketType:manage',
    'venue:manage',
    'venueMap:manage',
  ],
}

/**
 * The same double entry for the platform-wide roles: what somebody with this
 * `UserRole` and no membership anywhere may do.
 *
 * The narrow staff roles exist so that the common platform jobs do not need
 * SUPER_ADMIN, and the interesting assertions are the absences — a moderator
 * cannot refund, a finance administrator cannot approve an event.
 */
const EXPECTED_PLATFORM_MATRIX = {
  ATTENDEE: [],
  ORGANIZER: [],
  SUPPORT: ['order:view', 'support:view_order'],
  MODERATOR: ['event:view_draft', 'moderation:review', 'venue:manage'],
  FINANCE_ADMIN: [
    'finance:view',
    'ledger:manage',
    'order:refund',
    'order:refund_approve',
    'order:view',
    'payout:manage',
    'reconciliation:manage',
    'support:view_order',
  ],
  SUPER_ADMIN: null, // everything; asserted separately
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
  const platformAdmin = { id: 'usr_admin', role: 'SUPER_ADMIN', memberships: [] }

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
    expect(capabilitiesFor({ id: 'a', role: 'SUPER_ADMIN', memberships: [] })).toEqual([
      ...ALL_CAPABILITIES,
    ])
  })

  it('reflects the platform admin override in every organisation', () => {
    const admin = { id: 'usr_admin', role: 'SUPER_ADMIN', memberships: [] }
    expect(capabilitiesFor(admin, ORG_B)).toEqual([...ALL_CAPABILITIES])
  })

  it('unions platform and membership capabilities without duplicates', () => {
    // A finance administrator who is also an event manager somewhere holds both
    // sets at once, and the union is strictly larger than either — which is the
    // property that would break if the two sources were read one instead of both.
    const actor = {
      id: 'usr_both_hats',
      role: 'FINANCE_ADMIN',
      memberships: [{ organizationId: ORG_A, role: 'EVENT_MANAGER' }],
    }
    const result = capabilitiesFor(actor, ORG_A)

    expect(result).toContain('reconciliation:manage')
    expect(result).toContain('event:publish')
    expect(result.length).toBeGreaterThan(ORG_ROLE_CAPABILITIES.EVENT_MANAGER.length)
    expect(new Set(result).size).toBe(result.length)
    expect([...result]).toEqual([...result].sort())
  })

  it('gives a super administrator with a membership exactly everything, once', () => {
    const root = {
      id: 'usr_root',
      role: 'SUPER_ADMIN',
      memberships: [{ organizationId: ORG_A, role: 'OWNER' }],
    }
    const result = capabilitiesFor(root, ORG_A)

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
    const admin = { id: 'usr_admin', role: 'SUPER_ADMIN', memberships: [] }
    for (const capability of ALL_CAPABILITIES) {
      expect(() => assertCan(admin, capability, { organizationId: ORG_B })).not.toThrow()
    }
  })
})

describe('the platform role matrix', () => {
  for (const platformRole of PLATFORM_ROLE_ORDER) {
    const expectedList = EXPECTED_PLATFORM_MATRIX[platformRole]
    if (expectedList === null) continue

    for (const capability of ALL_CAPABILITIES) {
      const expected = expectedList.includes(capability)

      it(`${platformRole} ${expected ? 'may' : 'may not'} ${capability} with no membership`, () => {
        const actor = { id: 'usr_staff', role: platformRole, memberships: [] }
        expect(can(actor, capability, { organizationId: ORG_A })).toBe(expected)
      })
    }
  }

  it('gives SUPER_ADMIN every capability, everywhere', () => {
    const actor = { id: 'usr_root', role: 'SUPER_ADMIN', memberships: [] }
    for (const capability of ALL_CAPABILITIES) {
      expect(can(actor, capability, { organizationId: ORG_B })).toBe(true)
    }
  })
})

describe('separation of duties', () => {
  it('does not let whoever can publish an event also move money', () => {
    const manager = memberOfA('EVENT_MANAGER')

    expect(can(manager, 'event:publish', { organizationId: ORG_A })).toBe(true)
    expect(can(manager, 'order:refund', { organizationId: ORG_A })).toBe(false)
    expect(can(manager, 'order:refund_approve', { organizationId: ORG_A })).toBe(false)
    expect(can(manager, 'payout:manage', { organizationId: ORG_A })).toBe(false)
    expect(can(manager, 'finance:view', { organizationId: ORG_A })).toBe(false)
  })

  it('does not let whoever moves money also publish an event', () => {
    const finance = memberOfA('FINANCE')

    expect(can(finance, 'payout:manage', { organizationId: ORG_A })).toBe(true)
    expect(can(finance, 'event:publish', { organizationId: ORG_A })).toBe(false)
    expect(can(finance, 'event:update', { organizationId: ORG_A })).toBe(false)
    expect(can(finance, 'event:cancel', { organizationId: ORG_A })).toBe(false)
  })

  it('does not let the person who requested a refund approve it', () => {
    const finance = memberOfA('FINANCE')

    expect(can(finance, 'order:refund_request', { organizationId: ORG_A })).toBe(true)
    expect(can(finance, 'order:refund_approve', { organizationId: ORG_A })).toBe(false)
  })

  it('keeps a door scanner away from the attendee list and the order list', () => {
    const scanner = memberOfA('SCANNER')

    expect(can(scanner, 'ticket:check_in', { organizationId: ORG_A })).toBe(true)
    expect(can(scanner, 'order:view', { organizationId: ORG_A })).toBe(false)
    expect(can(scanner, 'attendee:export', { organizationId: ORG_A })).toBe(false)
    expect(can(scanner, 'report:view', { organizationId: ORG_A })).toBe(false)
  })

  it('does not let a moderator refund or a finance administrator approve events', () => {
    const moderator = { id: 'usr_mod', role: 'MODERATOR', memberships: [] }
    const financeAdmin = { id: 'usr_fin', role: 'FINANCE_ADMIN', memberships: [] }

    expect(can(moderator, 'moderation:review', { organizationId: ORG_A })).toBe(true)
    expect(can(moderator, 'order:refund', { organizationId: ORG_A })).toBe(false)

    expect(can(financeAdmin, 'order:refund', { organizationId: ORG_A })).toBe(true)
    expect(can(financeAdmin, 'moderation:review', { organizationId: ORG_A })).toBe(false)
    expect(can(financeAdmin, 'event:publish', { organizationId: ORG_A })).toBe(false)
  })

  it('never grants a platform-only capability through a membership', () => {
    for (const orgRole of ORG_ROLE_ORDER) {
      const actor = memberOfA(orgRole, 'ATTENDEE')
      for (const capability of [
        'platform:admin',
        'moderation:review',
        'reconciliation:manage',
        'ledger:manage',
        'support:view_order',
      ]) {
        expect(
          can(actor, capability, { organizationId: ORG_A }),
          `${orgRole} must not hold ${capability}`,
        ).toBe(false)
      }
    }
  })
})

describe('role inheritance is a graph, and it holds', () => {
  it('makes every role a superset of the roles it inherits from', () => {
    for (const [role, parents] of Object.entries(ORG_ROLE_INHERITS)) {
      for (const parent of parents) {
        for (const capability of ORG_ROLE_CAPABILITIES[parent]) {
          expect(
            ORG_ROLE_CAPABILITIES[role],
            `${role} inherits ${parent} but is missing ${capability}`,
          ).toContain(capability)
        }
      }
    }
  })

  it('does not make unrelated roles supersets of each other', () => {
    // The point of the graph: neither of these contains the other, so neither
    // can stand in for it.
    const eventManager = ORG_ROLE_CAPABILITIES.EVENT_MANAGER
    const finance = ORG_ROLE_CAPABILITIES.FINANCE

    expect(finance.every((c) => eventManager.includes(c))).toBe(false)
    expect(eventManager.every((c) => finance.includes(c))).toBe(false)
  })
})

describe('granting a role', () => {
  it('lets an owner grant anything, including another owner', () => {
    const owner = memberOfA('OWNER')
    for (const role of ORG_ROLE_ORDER) {
      expect(canGrantOrgRole(owner, role, { organizationId: ORG_A })).toBe(true)
    }
  })

  it('does not let an admin mint an owner', () => {
    expect(canGrantOrgRole(memberOfA('ADMIN'), 'OWNER', { organizationId: ORG_A })).toBe(false)
    expect(canAssignOrgRole('ADMIN', 'OWNER')).toBe(false)
  })

  it('does not let an event manager mint a finance user', () => {
    // Self-escalation by the side door: FINANCE holds capabilities
    // EVENT_MANAGER does not, so granting it would be granting authority the
    // granter never had.
    expect(canGrantOrgRole(memberOfA('EVENT_MANAGER'), 'FINANCE', { organizationId: ORG_A })).toBe(
      false,
    )
  })

  it('does not let a viewer grant anything at all', () => {
    for (const role of ORG_ROLE_ORDER) {
      expect(canGrantOrgRole(memberOfA('VIEWER'), role, { organizationId: ORG_A })).toBe(false)
    }
  })

  it('does not let a manager grant a role into another organisation', () => {
    expect(canGrantOrgRole(memberOfA('MANAGER'), 'VIEWER', { organizationId: ORG_B })).toBe(false)
  })

  it('lets a platform administrator grant anything', () => {
    const root = { id: 'usr_root', role: 'SUPER_ADMIN', memberships: [] }
    expect(canGrantOrgRole(root, 'OWNER', { organizationId: ORG_B })).toBe(true)
  })

  it('throws a PermissionError naming the escalation', () => {
    expect(() =>
      assertCanGrantOrgRole(memberOfA('EVENT_MANAGER'), 'OWNER', { organizationId: ORG_A }),
    ).toThrow(PermissionError)

    try {
      assertCanGrantOrgRole(memberOfA('EVENT_MANAGER'), 'OWNER', { organizationId: ORG_A })
    } catch (error) {
      expect(error.details?.reason ?? error.reason).toBe('role_escalation')
    }
  })
})

describe('orgCapabilitiesFor', () => {
  it('unions every membership naming the organisation', () => {
    // Defensive: a unique constraint means one membership per organisation, but
    // with roles that no longer nest, picking "the most senior" could drop a
    // capability the actor really holds.
    const actor = {
      id: 'usr_two_hats',
      role: 'ORGANIZER',
      memberships: [
        { organizationId: ORG_A, role: 'EVENT_MANAGER' },
        { organizationId: ORG_A, role: 'FINANCE' },
      ],
    }

    const capabilities = orgCapabilitiesFor(actor, ORG_A)

    expect(capabilities).toContain('event:publish')
    expect(capabilities).toContain('payout:manage')
  })

  it('returns nothing for an organisation the actor is not in', () => {
    expect(orgCapabilitiesFor(memberOfA('OWNER'), ORG_B)).toEqual([])
  })

  it('returns nothing without an organisation', () => {
    expect(orgCapabilitiesFor(memberOfA('OWNER'), undefined)).toEqual([])
  })
})
