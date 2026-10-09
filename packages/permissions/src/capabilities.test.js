import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  EVENT_AUTHORITY_CAPABILITIES,
  EVENT_POSTING_CAPABILITIES,
  EVENT_POSTING_ORG_ROLES,
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_INHERITS,
  ORG_ROLE_ORDER,
  OWNER_GRANTABLE_ORG_ROLES,
  PLATFORM_ADMINISTRATOR_CAPABILITIES,
  PLATFORM_ONLY_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
  assertAcyclic,
  assertPlatformAdministratorBounds,
  assertPostingPolicy,
  canAssignOrgRole,
  canIssueOrgRole,
  canMoveOrgRole,
  findRoleCycle,
  isCapability,
  orgRoleRank,
  platformRoleRank,
  postsEvents,
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
  'event:delete_unsold',
  'event:view_draft',
  'event:platform_edit',
  'event:platform_delete',
  'event:import',
  // Venues and seating
  'venue:manage',
  'venueMap:manage',
  // Inventory
  'ticket:revoke',
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
  'organization:submit_verification',
  'organization:view_members',
  // Promotions and reporting
  'promo:manage',
  'report:view',
  'analytics:view_all',
  // Personal data
  'privacy:redact',
  // Platform scope
  'support:view_order',
  'moderation:review',
  'reconciliation:manage',
  'ledger:manage',
  'retention:view',
  'organizer:invite',
  'website_redirect:manage',
  // Booking fees, referral codes and paying at the venue (SPEC3 §4.1)
  'payment_terms:manage',
  'referral_code:manage',
  'platform_fee:refund',
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

  it('has an inheritance graph naming only known roles', () => {
    for (const [role, parents] of Object.entries(ORG_ROLE_INHERITS)) {
      expect(Object.keys(ORG_ROLE_CAPABILITIES)).toContain(role)
      for (const parent of parents) {
        expect(Object.keys(ORG_ROLE_CAPABILITIES)).toContain(parent)
      }
    }
  })

  it('has an acyclic inheritance graph', () => {
    // The previous version of this test only rejected directly reciprocal
    // edges, so a three-role cycle would have passed it — while still failing at
    // import time, which is a confusing way to find out. `findRoleCycle` is the
    // check, and the cases below prove the check itself works.
    expect(findRoleCycle(ORG_ROLE_INHERITS)).toBeNull()
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
  it('covers exactly the seven UserRole values, ADMIN just below SUPER_ADMIN', () => {
    const expected = [
      'ADMIN',
      'ATTENDEE',
      'FINANCE_ADMIN',
      'MODERATOR',
      'ORGANIZER',
      'SUPER_ADMIN',
      'SUPPORT',
    ]

    expect(Object.keys(PLATFORM_ROLE_CAPABILITIES).sort()).toEqual(expected)
    expect([...PLATFORM_ROLE_ORDER].sort()).toEqual(expected)
    expect(platformRoleRank('ADMIN')).toBe(platformRoleRank('SUPER_ADMIN') - 1)
    expect(platformRoleRank('FINANCE_ADMIN')).toBeLessThan(platformRoleRank('ADMIN'))
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

    for (const role of ['SUPPORT', 'MODERATOR', 'FINANCE_ADMIN', 'ADMIN']) {
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

describe('findRoleCycle', () => {
  // Finding NF-13. The resolver already refused a cyclic graph — it walks with a
  // per-path `seen` set — but the refusal was not reusable and the test that
  // claimed to prove acyclicity only rejected directly reciprocal edges. These
  // cases prove the check itself, so that the production assertion above means
  // something.

  it('finds a self-cycle', () => {
    expect(findRoleCycle({ A: ['A'] })).toEqual(['A', 'A'])
  })

  it('finds a two-role cycle', () => {
    expect(findRoleCycle({ A: ['B'], B: ['A'] })).toEqual(['A', 'B', 'A'])
  })

  it('finds a three-role cycle, which the old check missed', () => {
    // The specific gap: no pair of these roles points directly at each other, so
    // a reciprocal-edge test sees nothing wrong.
    expect(findRoleCycle({ A: ['B'], B: ['C'], C: ['A'] })).toEqual(['A', 'B', 'C', 'A'])
  })

  it('finds a longer cycle', () => {
    const cycle = findRoleCycle({ A: ['B'], B: ['C'], C: ['D'], D: ['E'], E: ['B'] })

    expect(cycle).toEqual(['B', 'C', 'D', 'E', 'B'])
  })

  it('finds a cycle that only exists in a disconnected component', () => {
    // Nothing reaches X from A, so a walk that started only from the roles a
    // caller happened to ask about would never see it.
    const cycle = findRoleCycle({ A: ['B'], B: [], X: ['Y'], Y: ['X'] })

    expect(cycle).toEqual(['X', 'Y', 'X'])
  })

  it('accepts a diamond, which is inheritance rather than a loop', () => {
    // The false positive worth guarding against: D is reached twice, by two
    // different routes, and that is exactly what the production graph does with
    // VIEWER under ADMIN.
    expect(findRoleCycle({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] })).toBeNull()
  })

  it('accepts a deep chain', () => {
    expect(findRoleCycle({ A: ['B'], B: ['C'], C: ['D'], D: ['E'], E: [] })).toBeNull()
  })

  it('accepts an empty graph and a graph of isolated roles', () => {
    expect(findRoleCycle({})).toBeNull()
    expect(findRoleCycle({ A: [], B: [], C: [] })).toBeNull()
  })

  it('tolerates an edge to a role with no entry of its own', () => {
    // Not this function's job to complain about — `resolveRole` reports an
    // unknown parent with a better message — but it must not crash or invent a
    // cycle.
    expect(findRoleCycle({ A: ['B'] })).toBeNull()
  })

  it('proves the production graph is acyclic', () => {
    expect(findRoleCycle(ORG_ROLE_INHERITS)).toBeNull()
  })
})

describe('assertAcyclic', () => {
  it('names the whole cycle rather than one role on it', () => {
    expect(() => assertAcyclic({ A: ['B'], B: ['C'], C: ['A'] })).toThrow(
      /Role inheritance cycle: A -> B -> C -> A/,
    )
  })

  it('returns the graph unchanged when it is acyclic', () => {
    const graph = { A: ['B'], B: [] }

    expect(assertAcyclic(graph)).toBe(graph)
  })

  it('passes the production graph', () => {
    expect(() => assertAcyclic(ORG_ROLE_INHERITS)).not.toThrow()
  })
})

describe('privacy:redact', () => {
  it('is granted by exactly one organisation role', () => {
    const holders = Object.entries(ORG_ROLE_CAPABILITIES)
      .filter(([, capabilities]) => capabilities.includes(CAPABILITIES.PRIVACY_REDACT))
      .map(([role]) => role)

    // Not a restatement of the table: this is the assertion that catches a
    // future edit widening an irreversible authority. Granting it to ADMIN
    // would hand it to MANAGER's superset by inheritance; granting it to
    // FINANCE would hand it to ADMIN and OWNER as well.
    expect(holders).toEqual(['OWNER'])
  })

  it('is not granted by any platform role except SUPER_ADMIN', () => {
    const holders = Object.entries(PLATFORM_ROLE_CAPABILITIES)
      .filter(([, capabilities]) => capabilities.includes(CAPABILITIES.PRIVACY_REDACT))
      .map(([role]) => role)

    // SUPER_ADMIN holds every capability by construction (it is
    // `[...ALL_CAPABILITIES]`), so it is not an exception this table can make.
    // What matters is that no narrow staff role — SUPPORT, MODERATOR,
    // FINANCE_ADMIN — picks it up, and that organisation scope is still
    // enforced below the capability check for the role that does.
    expect(holders).toEqual(['SUPER_ADMIN'])
  })

  it('is organisation-scoped, so every route asserting it must name one', () => {
    // Platform-only capabilities take no `capabilityScope`, and a route that
    // asserted this one unscoped would refuse every organiser and pass every
    // platform admin — finding NF-05, the authorization inversion.
    expect(PLATFORM_ONLY_CAPABILITIES).not.toContain(CAPABILITIES.PRIVACY_REDACT)
  })

  it('is not implied by any other capability an organisation role already held', () => {
    // The point of a separate name: nothing that used to be granted now grants
    // redaction as a side effect.
    for (const [role, capabilities] of Object.entries(ORG_ROLE_CAPABILITIES)) {
      if (role === 'OWNER') continue

      expect(capabilities).not.toContain(CAPABILITIES.PRIVACY_REDACT)
    }
  })
})

describe('the platform administrator (ADMIN)', () => {
  it('holds exactly the thirteen of the allow-list: review, drafts, venues, invitations, reports, website links, visits, editing and deleting posted events, imports, payment terms, referral codes and booking-fee refunds', () => {
    expect([...PLATFORM_ADMINISTRATOR_CAPABILITIES]).toEqual(
      [
        'analytics:view_all',
        'event:import',
        'event:platform_delete',
        'event:platform_edit',
        'event:view_draft',
        'moderation:review',
        'organizer:invite',
        'payment_terms:manage',
        'platform_fee:refund',
        'referral_code:manage',
        'report:view',
        'venue:manage',
        'website_redirect:manage',
      ].sort(),
    )
    expect(PLATFORM_ADMINISTRATOR_CAPABILITIES).toHaveLength(13)
    expect([...PLATFORM_ROLE_CAPABILITIES.ADMIN]).toEqual([...PLATFORM_ADMINISTRATOR_CAPABILITIES])
  })

  it("is a superset of the moderator and holds nothing that posts events, moves an organiser's money or admits", () => {
    for (const capability of PLATFORM_ROLE_CAPABILITIES.MODERATOR) {
      expect(PLATFORM_ROLE_CAPABILITIES.ADMIN).toContain(capability)
    }

    // The one money capability it holds is Desi-Event's own: one order's
    // booking fee, refunded by hand (SPEC3 §7.4, A4).
    expect(PLATFORM_ROLE_CAPABILITIES.ADMIN).toContain('platform_fee:refund')

    for (const capability of [
      'platform:admin',
      'ticket:check_in',
      ...EVENT_POSTING_CAPABILITIES,
      'finance:view',
      'order:refund',
      'order:refund_approve',
      'order:refund_request',
      'payout:manage',
      'connect:manage',
      'ledger:manage',
      'reconciliation:manage',
      'privacy:redact',
      'retention:view',
      'attendee:export',
      'promo:manage',
      'team:invite',
      // Deleting an organisation's unsold event as a member, or a sold one
      // through `event:delete`, is the organisation's own authority; ADMIN
      // deletes through `event:platform_delete`, in no organisation.
      'event:delete',
      'event:delete_unsold',
      'event:cancel',
    ]) {
      expect(PLATFORM_ROLE_CAPABILITIES.ADMIN, capability).not.toContain(capability)
    }
  })

  it('passes the load-time bound on the shipped table', () => {
    expect(assertPlatformAdministratorBounds(PLATFORM_ROLE_CAPABILITIES)).toBe(
      PLATFORM_ROLE_CAPABILITIES,
    )
  })

  it.each(['platform:admin', 'event:publish', 'attendee:export', 'promo:manage', 'order:refund'])(
    'refuses a doctored table that gives ADMIN %s',
    (capability) => {
      const doctored = {
        ...PLATFORM_ROLE_CAPABILITIES,
        ADMIN: [...PLATFORM_ROLE_CAPABILITIES.ADMIN, capability],
      }

      expect(() => assertPlatformAdministratorBounds(doctored)).toThrow(capability)
    },
  )

  it('refuses a doctored table that takes a capability away, so the bound is an equality', () => {
    const doctored = {
      ...PLATFORM_ROLE_CAPABILITIES,
      ADMIN: PLATFORM_ROLE_CAPABILITIES.ADMIN.filter((c) => c !== 'organizer:invite'),
    }

    expect(() => assertPlatformAdministratorBounds(doctored)).toThrow('organizer:invite')
  })

  it.each(['event:platform_edit', 'event:platform_delete', 'event:import'])(
    'refuses a doctored table that takes away %s',
    (capability) => {
      const doctored = {
        ...PLATFORM_ROLE_CAPABILITIES,
        ADMIN: PLATFORM_ROLE_CAPABILITIES.ADMIN.filter((c) => c !== capability),
      }

      expect(() => assertPlatformAdministratorBounds(doctored)).toThrow(capability)
    },
  )
})

describe('the three platform event capabilities: editing, deleting and importing', () => {
  const PLATFORM_EVENT = ['event:platform_edit', 'event:platform_delete', 'event:import']

  it.each(PLATFORM_EVENT)(
    '%s is platform-only and held by ADMIN and SUPER_ADMIN alone',
    (capability) => {
      expect(PLATFORM_ONLY_CAPABILITIES).toContain(capability)

      const holders = Object.entries(PLATFORM_ROLE_CAPABILITIES)
        .filter(([, capabilities]) => capabilities.includes(capability))
        .map(([role]) => role)
        .sort()

      expect(holders).toEqual(['ADMIN', 'SUPER_ADMIN'])

      for (const [role, capabilities] of Object.entries(ORG_ROLE_CAPABILITIES)) {
        expect(capabilities, role).not.toContain(capability)
      }
    },
  )

  it.each(['MODERATOR', 'SUPPORT', 'FINANCE_ADMIN', 'ORGANIZER', 'ATTENDEE'])(
    '%s holds none of the three',
    (role) => {
      for (const capability of PLATFORM_EVENT) {
        expect(PLATFORM_ROLE_CAPABILITIES[role], `${role} holds ${capability}`).not.toContain(
          capability,
        )
      }
    },
  )

  it('names them by their constants', () => {
    expect(CAPABILITIES.EVENT_PLATFORM_EDIT).toBe('event:platform_edit')
    expect(CAPABILITIES.EVENT_PLATFORM_DELETE).toBe('event:platform_delete')
    expect(CAPABILITIES.EVENT_IMPORT).toBe('event:import')
  })
})

describe('event:delete_unsold', () => {
  it('is held from EVENT_MANAGER up: EVENT_MANAGER, MANAGER, ADMIN and OWNER, and nobody else', () => {
    const holders = ORG_ROLE_ORDER.filter((role) =>
      ORG_ROLE_CAPABILITIES[role].includes('event:delete_unsold'),
    )

    expect(holders).toEqual(['EVENT_MANAGER', 'MANAGER', 'ADMIN', 'OWNER'])
    expect(CAPABILITIES.EVENT_DELETE_UNSOLD).toBe('event:delete_unsold')
  })

  it('is event authority, so no role an owner may hand out ever holds it', () => {
    expect(EVENT_AUTHORITY_CAPABILITIES).toContain('event:delete_unsold')

    for (const role of OWNER_GRANTABLE_ORG_ROLES) {
      expect(ORG_ROLE_CAPABILITIES[role], role).not.toContain('event:delete_unsold')
    }

    const doctored = {
      ...ORG_ROLE_CAPABILITIES,
      FINANCE: [...ORG_ROLE_CAPABILITIES.FINANCE, 'event:delete_unsold'],
    }

    expect(() => assertPostingPolicy(doctored)).toThrow(/FINANCE.*event:delete_unsold/)
  })

  it('is an organisation capability, granted by no platform role but SUPER_ADMIN', () => {
    expect(PLATFORM_ONLY_CAPABILITIES).not.toContain('event:delete_unsold')

    const holders = Object.entries(PLATFORM_ROLE_CAPABILITIES)
      .filter(([, capabilities]) => capabilities.includes('event:delete_unsold'))
      .map(([role]) => role)

    expect(holders).toEqual(['SUPER_ADMIN'])
  })

  it('leaves event:delete where it was: ADMIN and OWNER only', () => {
    const holders = ORG_ROLE_ORDER.filter((role) =>
      ORG_ROLE_CAPABILITIES[role].includes('event:delete'),
    )

    expect(holders).toEqual(['ADMIN', 'OWNER'])
  })
})

describe('the three platform capabilities of invitations, website links and visits', () => {
  const NEW = ['organizer:invite', 'website_redirect:manage', 'analytics:view_all']

  it.each(NEW)('%s is platform-only and held by ADMIN and SUPER_ADMIN alone', (capability) => {
    expect(PLATFORM_ONLY_CAPABILITIES).toContain(capability)

    const holders = Object.entries(PLATFORM_ROLE_CAPABILITIES)
      .filter(([, capabilities]) => capabilities.includes(capability))
      .map(([role]) => role)
      .sort()

    expect(holders).toEqual(['ADMIN', 'SUPER_ADMIN'])

    for (const [role, capabilities] of Object.entries(ORG_ROLE_CAPABILITIES)) {
      expect(capabilities, role).not.toContain(capability)
    }
  })

  it('names them by their constants', () => {
    expect(CAPABILITIES.ORGANIZER_INVITE).toBe('organizer:invite')
    expect(CAPABILITIES.WEBSITE_REDIRECT_MANAGE).toBe('website_redirect:manage')
    expect(CAPABILITIES.ANALYTICS_VIEW_ALL).toBe('analytics:view_all')
  })
})

describe('roles that post events', () => {
  it('are event manager, manager, administrator and owner; the rest are the owner-grantable ones', () => {
    expect([...EVENT_POSTING_ORG_ROLES]).toEqual(['EVENT_MANAGER', 'MANAGER', 'ADMIN', 'OWNER'])
    expect([...OWNER_GRANTABLE_ORG_ROLES]).toEqual(['VIEWER', 'SCANNER', 'STAFF', 'FINANCE'])

    for (const role of ORG_ROLE_ORDER) {
      expect(postsEvents(role), role).toBe(EVENT_POSTING_ORG_ROLES.includes(role))
    }
    expect(postsEvents('NOT_A_ROLE')).toBe(false)
    expect(postsEvents(undefined)).toBe(false)
  })

  it('keep all event authority away from the owner-grantable roles', () => {
    for (const role of OWNER_GRANTABLE_ORG_ROLES) {
      for (const capability of EVENT_AUTHORITY_CAPABILITIES) {
        expect(ORG_ROLE_CAPABILITIES[role], `${role} holds ${capability}`).not.toContain(capability)
      }
    }
  })

  it('pass the load-time posting policy on the shipped table', () => {
    expect(assertPostingPolicy(ORG_ROLE_CAPABILITIES)).toBe(ORG_ROLE_CAPABILITIES)
  })

  it('refuse a doctored table where FINANCE holds promo:manage', () => {
    const doctored = {
      ...ORG_ROLE_CAPABILITIES,
      FINANCE: [...ORG_ROLE_CAPABILITIES.FINANCE, 'promo:manage'],
    }

    expect(() => assertPostingPolicy(doctored)).toThrow(/FINANCE.*promo:manage/)
  })

  it('refuse a doctored table where VIEWER gains event:create', () => {
    const doctored = {
      ...ORG_ROLE_CAPABILITIES,
      VIEWER: [...ORG_ROLE_CAPABILITIES.VIEWER, 'event:create'],
    }

    expect(() => assertPostingPolicy(doctored)).toThrow(/FINANCE, SCANNER, STAFF and VIEWER/)
  })
})

describe('canIssueOrgRole', () => {
  it('lets an owner offer exactly the roles that do not post events', () => {
    expect(ORG_ROLE_ORDER.filter((role) => canIssueOrgRole('OWNER', role))).toEqual([
      ...OWNER_GRANTABLE_ORG_ROLES,
    ])
    expect(canIssueOrgRole('OWNER', 'EVENT_MANAGER')).toBe(false)
    expect(canIssueOrgRole('OWNER', 'FINANCE')).toBe(true)
  })

  it('still refuses what the assigner does not hold', () => {
    expect(canIssueOrgRole('MANAGER', 'FINANCE')).toBe(false)
    expect(canIssueOrgRole('MANAGER', 'STAFF')).toBe(true)
  })
})

describe('canMoveOrgRole', () => {
  it.each([
    ['OWNER', 'ADMIN', 'EVENT_MANAGER', true, 'a poster moved down'],
    ['OWNER', 'MANAGER', 'EVENT_MANAGER', true, 'a poster moved down'],
    ['OWNER', 'ADMIN', 'VIEWER', true, 'a poster moved to a non-posting role'],
    ['OWNER', 'VIEWER', 'FINANCE', true, 'between non-posting roles'],
    ['OWNER', 'EVENT_MANAGER', 'ADMIN', false, 'an upward posting move'],
    ['OWNER', 'EVENT_MANAGER', 'MANAGER', false, 'an upward posting move'],
    ['OWNER', 'VIEWER', 'EVENT_MANAGER', false, 'a non-poster made a poster'],
    ['OWNER', 'FINANCE', 'MANAGER', false, 'a non-poster made a poster'],
    ['ADMIN', 'EVENT_MANAGER', 'OWNER', false, 'ownership is handed over, never assigned'],
    ['OWNER', 'ADMIN', 'OWNER', false, 'ownership is handed over, never assigned'],
    ['MANAGER', 'EVENT_MANAGER', 'FINANCE', false, 'a role the assigner does not hold'],
  ])('%s moving %s to %s is %s (%s)', (assigner, from, to, expected) => {
    expect(canMoveOrgRole(assigner, from, to)).toBe(expected)
  })

  it('allows a posting move only to a subset of the capabilities the member holds', () => {
    for (const from of EVENT_POSTING_ORG_ROLES) {
      for (const to of EVENT_POSTING_ORG_ROLES) {
        if (!canMoveOrgRole('OWNER', from, to)) continue

        for (const capability of ORG_ROLE_CAPABILITIES[to]) {
          expect(ORG_ROLE_CAPABILITIES[from], `${from} to ${to} adds ${capability}`).toContain(
            capability,
          )
        }
      }
    }
  })
})

describe('booking fees, referral codes and paying at the venue (SPEC3 §4.1)', () => {
  const SPEC3 = ['payment_terms:manage', 'referral_code:manage', 'platform_fee:refund']

  it('names the three capabilities as constants', () => {
    expect(CAPABILITIES.PAYMENT_TERMS_MANAGE).toBe('payment_terms:manage')
    expect(CAPABILITIES.REFERRAL_CODE_MANAGE).toBe('referral_code:manage')
    expect(CAPABILITIES.PLATFORM_FEE_REFUND).toBe('platform_fee:refund')
  })

  it('makes all three platform-only', () => {
    for (const capability of SPEC3) {
      expect(PLATFORM_ONLY_CAPABILITIES, capability).toContain(capability)
    }
  })

  it('grants none of them through any organisation role', () => {
    for (const [role, capabilities] of Object.entries(ORG_ROLE_CAPABILITIES)) {
      for (const capability of SPEC3) {
        expect(capabilities, `${role} ${capability}`).not.toContain(capability)
      }
    }
  })

  it('gives ADMIN all three and SUPER_ADMIN all three through ALL_CAPABILITIES', () => {
    for (const capability of SPEC3) {
      expect(PLATFORM_ROLE_CAPABILITIES.ADMIN, capability).toContain(capability)
      expect(PLATFORM_ROLE_CAPABILITIES.SUPER_ADMIN, capability).toContain(capability)
    }
  })

  it('gives FINANCE_ADMIN the booking-fee refund and neither of the other two', () => {
    expect(PLATFORM_ROLE_CAPABILITIES.FINANCE_ADMIN).toContain('platform_fee:refund')
    expect(PLATFORM_ROLE_CAPABILITIES.FINANCE_ADMIN).not.toContain('payment_terms:manage')
    expect(PLATFORM_ROLE_CAPABILITIES.FINANCE_ADMIN).not.toContain('referral_code:manage')
  })

  it('gives MODERATOR, SUPPORT, ORGANIZER and ATTENDEE none of them', () => {
    for (const role of ['MODERATOR', 'SUPPORT', 'ORGANIZER', 'ATTENDEE']) {
      for (const capability of SPEC3) {
        expect(PLATFORM_ROLE_CAPABILITIES[role], `${role} ${capability}`).not.toContain(capability)
      }
    }
  })

  it.each(SPEC3)('refuses a doctored table that takes %s away from ADMIN', (capability) => {
    const doctored = {
      ...PLATFORM_ROLE_CAPABILITIES,
      ADMIN: PLATFORM_ROLE_CAPABILITIES.ADMIN.filter((held) => held !== capability),
    }

    expect(() => assertPlatformAdministratorBounds(doctored)).toThrow(capability)
  })
})
