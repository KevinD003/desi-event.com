import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  ORG_ROLE_ORDER,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
  isCapability,
  orgRoleRank,
} from './capabilities.js'

/** The capability vocabulary the cross-package contract requires. */
const REQUIRED_CAPABILITIES = [
  'event:create',
  'event:update',
  'event:publish',
  'event:delete',
  'event:view_draft',
  'ticketType:manage',
  'order:view',
  'order:refund',
  'ticket:check_in',
  'organization:manage',
  'organization:view_members',
  'promo:manage',
  'report:view',
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
  it('covers exactly the five OrgRole values', () => {
    expect(Object.keys(ORG_ROLE_CAPABILITIES).sort()).toEqual(
      ['ADMIN', 'MANAGER', 'OWNER', 'STAFF', 'VIEWER'].sort(),
    )
    expect([...ORG_ROLE_ORDER]).toEqual(['VIEWER', 'STAFF', 'MANAGER', 'ADMIN', 'OWNER'])
  })

  it('makes each role a strict superset of the role below it', () => {
    for (let index = 1; index < ORG_ROLE_ORDER.length; index += 1) {
      const lower = ORG_ROLE_CAPABILITIES[ORG_ROLE_ORDER[index - 1]]
      const higher = ORG_ROLE_CAPABILITIES[ORG_ROLE_ORDER[index]]

      for (const capability of lower) expect(higher).toContain(capability)
      expect(higher.length).toBeGreaterThan(lower.length)
    }
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
  it('covers exactly the three UserRole values', () => {
    expect(Object.keys(PLATFORM_ROLE_CAPABILITIES).sort()).toEqual(
      ['ADMIN', 'ATTENDEE', 'ORGANIZER'].sort(),
    )
    expect([...PLATFORM_ROLE_ORDER]).toEqual(['ATTENDEE', 'ORGANIZER', 'ADMIN'])
  })

  it('grants platform ADMIN every capability', () => {
    expect([...PLATFORM_ROLE_CAPABILITIES.ADMIN]).toEqual([...ALL_CAPABILITIES])
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
