import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_INHERITS,
  ORG_ROLE_ORDER,
  PLATFORM_ONLY_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
  canAssignOrgRole,
  isCapability,
  orgRoleRank,
} from './capabilities.js'

/** The capability vocabulary the cross-package contract requires. */
const REQUIRED_CAPABILITIES = [
  // Event content and lifecycle
  'event:create',
  'event:update',
  'event:submit_review',
  'event:publish',
  'event:pause_sales',
  'event:cancel',
  'event:delete',
  'event:view_draft',
  // Venues and seating
  'venue:manage',
  'venueMap:manage',
  // Inventory
  'ticketType:manage',
  'inventory:manage',
  'hold:release_any',
  // Orders, attendees and the door
  'order:view',
  'attendee:export',
  'ticket:check_in',
  // Money
  'order:refund_request',
  'order:refund_approve',
  'order:refund',
  'finance:view',
  'connect:manage',
  'payout:manage',
  // Team
  'team:invite',
  'team:remove',
  'team:role_manage',
  'organization:manage',
  'organization:view_members',
  // Promotions and reporting
  'promo:manage',
  'report:view',
  // Platform scope
  'support:view_order',
  'moderation:review',
  'reconciliation:manage',
  'ledger:manage',
  'platform:admin',
]

describe('CAPABILITIES', () => {
  it('defines every capability named in the contract', () => {
    for (const capability of REQUIRED_CAPABILITIES) {
      expect(Object.values(CAPABILITIES)).toContain(capability)
    }
  })

  it('has no duplicate capability strings', () => {
    const values = Object.values(CAPABILITIES)
    expect(new Set(values).size).toBe(values.length)
  })

  it('exposes ALL_CAPABILITIES sorted and complete', () => {
    expect([...ALL_CAPABILITIES]).toEqual([...REQUIRED_CAPABILITIES].sort())
    expect([...ALL_CAPABILITIES]).toEqual([...ALL_CAPABILITIES].sort())
  })

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true)
    expect(() => {
      CAPABILITIES.EVENT_CREATE = 'event:hijacked'
    }).toThrow(TypeError)
    expect(() => {
      CAPABILITIES.NEW_ONE = 'x:y'
    }).toThrow(TypeError)
    expect(CAPABILITIES.EVENT_CREATE).toBe('event:create')
  })

  it('freezes ALL_CAPABILITIES so callers cannot append', () => {
    expect(Object.isFrozen(ALL_CAPABILITIES)).toBe(true)
    expect(() => ALL_CAPABILITIES.push('event:hijacked')).toThrow(TypeError)
  })
})

describe('ORG_ROLE_CAPABILITIES', () => {
  it('covers exactly the eight OrgRole values', () => {
    const expected = [
      'ADMIN',
      'EVENT_MANAGER',
      'FINANCE',
      'MANAGER',
      'OWNER',
      'SCANNER',
      'STAFF',
      'VIEWER',
    ]

    expect(Object.keys(ORG_ROLE_CAPABILITIES).sort()).toEqual(expected)
    expect([...ORG_ROLE_ORDER].sort()).toEqual(expected)
    expect([...ORG_ROLE_ORDER]).toEqual([
      'VIEWER',
      'SCANNER',
      'STAFF',
      'EVENT_MANAGER',
      'FINANCE',
      'MANAGER',
      'ADMIN',
      'OWNER',
    ])
  })

  it('makes each role a superset of every role it inherits from', () => {
    // Phase 1's roles nested in one chain, so this was "a superset of the role
    // below". Phase 2's do not — finance and event management are siblings —
    // so the property is stated against the inheritance graph instead. Asserting
    // it against ORG_ROLE_ORDER would be asserting something untrue.
    for (const [role, parents] of Object.entries(ORG_ROLE_INHERITS)) {
      for (const parent of parents) {
        for (const capability of ORG_ROLE_CAPABILITIES[parent]) {
          expect(
            ORG_ROLE_CAPABILITIES[role],
            `${role} inherits ${parent} but lacks ${capability}`,
          ).toContain(capability)
        }
        expect(ORG_ROLE_CAPABILITIES[role].length).toBeGreaterThanOrEqual(
          ORG_ROLE_CAPABILITIES[parent].length,
        )
      }
    }
  })

  it('has an acyclic inheritance graph naming only known roles', () => {
    for (const [role, parents] of Object.entries(ORG_ROLE_INHERITS)) {
      expect(Object.keys(ORG_ROLE_CAPABILITIES)).toContain(role)
      for (const parent of parents) {
        expect(Object.keys(ORG_ROLE_CAPABILITIES)).toContain(parent)
        expect(ORG_ROLE_INHERITS[parent]).not.toContain(role)
      }
    }
  })

  it('keeps event management and finance apart', () => {
    expect(ORG_ROLE_CAPABILITIES.EVENT_MANAGER).not.toContain('order:refund')
    expect(ORG_ROLE_CAPABILITIES.EVENT_MANAGER).not.toContain('payout:manage')
    expect(ORG_ROLE_CAPABILITIES.EVENT_MANAGER).not.toContain('finance:view')
    expect(ORG_ROLE_CAPABILITIES.FINANCE).not.toContain('event:publish')
    expect(ORG_ROLE_CAPABILITIES.FINANCE).not.toContain('event:update')
  })

  it('gives a scanner exactly one capability', () => {
    expect([...ORG_ROLE_CAPABILITIES.SCANNER]).toEqual(['ticket:check_in'])
  })

  it('gives STAFF check-in but not event editing', () => {
    expect(ORG_ROLE_CAPABILITIES.STAFF).toContain('ticket:check_in')
    expect(ORG_ROLE_CAPABILITIES.STAFF).not.toContain('event:update')
    expect(ORG_ROLE_CAPABILITIES.VIEWER).not.toContain('ticket:check_in')
  })

  it('reserves organization:manage for OWNER', () => {
    expect(ORG_ROLE_CAPABILITIES.OWNER).toContain('organization:manage')
    expect(ORG_ROLE_CAPABILITIES.ADMIN).not.toContain('organization:manage')
  })

  it('reserves refunds and deletion for ADMIN and above', () => {
    expect(ORG_ROLE_CAPABILITIES.MANAGER).not.toContain('order:refund')
    expect(ORG_ROLE_CAPABILITIES.MANAGER).not.toContain('event:delete')
    expect(ORG_ROLE_CAPABILITIES.ADMIN).toContain('order:refund')
    expect(ORG_ROLE_CAPABILITIES.ADMIN).toContain('event:delete')
  })

  it('never grants platform:admin to an organisation role', () => {
    for (const role of ORG_ROLE_ORDER) {
      expect(ORG_ROLE_CAPABILITIES[role]).not.toContain('platform:admin')
    }
  })

  it('freezes the table and every list inside it', () => {
    expect(Object.isFrozen(ORG_ROLE_CAPABILITIES)).toBe(true)
    expect(() => ORG_ROLE_CAPABILITIES.VIEWER.push('organization:manage')).toThrow(TypeError)
    expect(() => {
      ORG_ROLE_CAPABILITIES.STAFF = [...ALL_CAPABILITIES]
    }).toThrow(TypeError)
    expect(ORG_ROLE_CAPABILITIES.VIEWER).not.toContain('organization:manage')
  })
})

describe('PLATFORM_ROLE_CAPABILITIES', () => {
  it('covers exactly the six UserRole values', () => {
    const expected = [
      'ATTENDEE',
      'FINANCE_ADMIN',
      'MODERATOR',
      'ORGANIZER',
      'SUPER_ADMIN',
      'SUPPORT',
    ]

    expect(Object.keys(PLATFORM_ROLE_CAPABILITIES).sort()).toEqual(expected)
    expect([...PLATFORM_ROLE_ORDER].sort()).toEqual(expected)
  })

  it('grants SUPER_ADMIN every capability', () => {
    expect([...PLATFORM_ROLE_CAPABILITIES.SUPER_ADMIN]).toEqual([...ALL_CAPABILITIES])
  })

  it('keeps the narrow staff roles narrow', () => {
    // The reason they exist: the ordinary platform jobs must not need the key
    // to everything.
    expect(PLATFORM_ROLE_CAPABILITIES.SUPPORT).not.toContain('order:refund')
    expect(PLATFORM_ROLE_CAPABILITIES.SUPPORT).not.toContain('moderation:review')
    expect(PLATFORM_ROLE_CAPABILITIES.MODERATOR).not.toContain('order:refund')
    expect(PLATFORM_ROLE_CAPABILITIES.MODERATOR).not.toContain('finance:view')
    expect(PLATFORM_ROLE_CAPABILITIES.FINANCE_ADMIN).not.toContain('moderation:review')
    expect(PLATFORM_ROLE_CAPABILITIES.FINANCE_ADMIN).not.toContain('event:publish')

    for (const role of ['SUPPORT', 'MODERATOR', 'FINANCE_ADMIN']) {
      expect(PLATFORM_ROLE_CAPABILITIES[role]).not.toContain('platform:admin')
    }
  })

  it('grants ATTENDEE and ORGANIZER nothing platform-wide', () => {
    expect([...PLATFORM_ROLE_CAPABILITIES.ATTENDEE]).toEqual([])
    expect([...PLATFORM_ROLE_CAPABILITIES.ORGANIZER]).toEqual([])
  })

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(PLATFORM_ROLE_CAPABILITIES)).toBe(true)
    expect(() => PLATFORM_ROLE_CAPABILITIES.ATTENDEE.push('platform:admin')).toThrow(TypeError)
  })
})

describe('isCapability', () => {
  it('accepts every known capability', () => {
    for (const capability of ALL_CAPABILITIES) expect(isCapability(capability)).toBe(true)
  })

  it('rejects unknown strings and non-strings', () => {
    expect(isCapability('event:hijack')).toBe(false)
    expect(isCapability('EVENT_CREATE')).toBe(false)
    expect(isCapability('')).toBe(false)
    expect(isCapability(null)).toBe(false)
    expect(isCapability(undefined)).toBe(false)
    expect(isCapability(42)).toBe(false)
    expect(isCapability(['event:create'])).toBe(false)
    expect(isCapability('toString')).toBe(false)
  })
})

describe('orgRoleRank', () => {
  it('orders roles from VIEWER to OWNER', () => {
    expect(orgRoleRank('VIEWER')).toBeLessThan(orgRoleRank('STAFF'))
    expect(orgRoleRank('STAFF')).toBeLessThan(orgRoleRank('MANAGER'))
    expect(orgRoleRank('MANAGER')).toBeLessThan(orgRoleRank('ADMIN'))
    expect(orgRoleRank('ADMIN')).toBeLessThan(orgRoleRank('OWNER'))
  })

  it('returns -1 for unknown and non-string roles', () => {
    expect(orgRoleRank('SUPERUSER')).toBe(-1)
    expect(orgRoleRank('owner')).toBe(-1)
    expect(orgRoleRank(null)).toBe(-1)
    expect(orgRoleRank(undefined)).toBe(-1)
    expect(orgRoleRank(3)).toBe(-1)
  })
})

describe('PLATFORM_ONLY_CAPABILITIES', () => {
  it('names capabilities that exist', () => {
    for (const capability of PLATFORM_ONLY_CAPABILITIES) {
      expect(ALL_CAPABILITIES).toContain(capability)
    }
  })

  it('is never granted by an organisation role', () => {
    // Also asserted at module load, so a bad edit fails the import rather than
    // only this suite. Kept here so the intent is visible in the tests too.
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      for (const capability of PLATFORM_ONLY_CAPABILITIES) {
        expect(ORG_ROLE_CAPABILITIES[role]).not.toContain(capability)
      }
    }
  })
})

describe('canAssignOrgRole', () => {
  it('is reflexive except for OWNER, which only an OWNER may grant', () => {
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(canAssignOrgRole(role, role)).toBe(true)
    }
  })

  it('refuses unknown roles in either position', () => {
    expect(canAssignOrgRole('OWNER', 'NOT_A_ROLE')).toBe(false)
    expect(canAssignOrgRole('NOT_A_ROLE', 'VIEWER')).toBe(false)
    expect(canAssignOrgRole(undefined, 'VIEWER')).toBe(false)
  })

  it('never lets a role grant authority it does not hold', () => {
    for (const assigner of Object.keys(ORG_ROLE_CAPABILITIES)) {
      for (const target of Object.keys(ORG_ROLE_CAPABILITIES)) {
        if (!canAssignOrgRole(assigner, target)) continue

        for (const capability of ORG_ROLE_CAPABILITIES[target]) {
          expect(
            ORG_ROLE_CAPABILITIES[assigner],
            `${assigner} may grant ${target} but lacks ${capability}`,
          ).toContain(capability)
        }
      }
    }
  })
})
