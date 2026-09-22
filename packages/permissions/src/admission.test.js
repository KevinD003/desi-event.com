/**
 * The admission policy, checked against the role table it describes.
 *
 * Each case fails against a plausible wrong implementation: trusting the
 * organisation capability alone, treating an inherited `ticket:check_in` as a
 * bypass, letting a platform role through, or matching a scope for a different
 * event.
 */

import { describe, expect, it } from 'vitest'

import {
  ADMISSION_AUTHORITIES,
  EVENT_SCOPED_ADMISSION_ROLES,
  ORGANIZATION_WIDE_ADMISSION_ROLES,
  admissionAuthorityFor,
  assertAdmissionPolicy,
  requiresAdmissionScope,
} from './admission.js'
import { CAPABILITIES, ORG_ROLE_CAPABILITIES, ORG_ROLE_ORDER } from './capabilities.js'

const EVENT_A = 'eventaaaaaaaaaa'
const EVENT_B = 'eventbbbbbbbbbb'

describe('the two groups', () => {
  it('classifies every role holding ticket:check_in exactly once', () => {
    const admitting = ORG_ROLE_ORDER.filter((role) =>
      ORG_ROLE_CAPABILITIES[role].includes(CAPABILITIES.TICKET_CHECK_IN),
    )

    expect([...admitting].sort()).toEqual(
      [...ORGANIZATION_WIDE_ADMISSION_ROLES, ...EVENT_SCOPED_ADMISSION_ROLES].sort(),
    )
    expect(
      ORGANIZATION_WIDE_ADMISSION_ROLES.filter((role) =>
        EVENT_SCOPED_ADMISSION_ROLES.includes(role),
      ),
    ).toEqual([])
  })

  it('gives the bypass only to roles that can grant scopes themselves', () => {
    for (const role of ORGANIZATION_WIDE_ADMISSION_ROLES) {
      expect(ORG_ROLE_CAPABILITIES[role], role).toContain(CAPABILITIES.TEAM_ROLE_MANAGE)
    }

    for (const role of EVENT_SCOPED_ADMISSION_ROLES) {
      expect(ORG_ROLE_CAPABILITIES[role], role).not.toContain(CAPABILITIES.TEAM_ROLE_MANAGE)
    }
  })

  it('refuses a role table where a new door role was left unclassified', () => {
    // What the load-time assertion exists for: somebody gives VIEWER the
    // capability and forgets this file. Without the check, VIEWER would admit
    // on whatever the code happened to default to.
    const drifted = {
      ...ORG_ROLE_CAPABILITIES,
      VIEWER: [...ORG_ROLE_CAPABILITIES.VIEWER, CAPABILITIES.TICKET_CHECK_IN],
    }

    expect(() => assertAdmissionPolicy(drifted)).toThrow(/Admission policy out of date/u)
  })

  it('refuses a table where a bypass role lost the power to grant scopes', () => {
    const drifted = {
      ...ORG_ROLE_CAPABILITIES,
      ADMIN: ORG_ROLE_CAPABILITIES.ADMIN.filter((c) => c !== CAPABILITIES.TEAM_ROLE_MANAGE),
    }

    expect(() => assertAdmissionPolicy(drifted)).toThrow(/cannot grant scopes/u)
  })

  it('refuses a table where a scoped role gained the power to grant scopes', () => {
    const drifted = {
      ...ORG_ROLE_CAPABILITIES,
      STAFF: [...ORG_ROLE_CAPABILITIES.STAFF, CAPABILITIES.TEAM_ROLE_MANAGE],
    }

    expect(() => assertAdmissionPolicy(drifted)).toThrow(/scoping it controls nothing/u)
  })
})

describe('admissionAuthorityFor', () => {
  it('lets OWNER and ADMIN admit to any event of their organisation, unscoped', () => {
    for (const role of ['OWNER', 'ADMIN']) {
      expect(admissionAuthorityFor({ role, scannerScopes: [] }, EVENT_B)).toEqual({
        authority: ADMISSION_AUTHORITIES.ORGANIZATION_ROLE,
        role,
      })
    }
  })

  it('lets a scoped role admit only to the event its scope names', () => {
    for (const role of ['MANAGER', 'STAFF', 'SCANNER']) {
      const membership = { role, scannerScopes: [{ eventId: EVENT_A }] }

      expect(admissionAuthorityFor(membership, EVENT_A), role).toEqual({
        authority: ADMISSION_AUTHORITIES.EVENT_SCOPE,
        role,
      })
      expect(admissionAuthorityFor(membership, EVENT_B), role).toBeNull()
    }
  })

  it('gives a scoped role with no scope nothing at all', () => {
    // "A scanner with no scope scans nothing" — the schema comment, which for
    // most of this repository's life nothing enforced.
    for (const role of EVENT_SCOPED_ADMISSION_ROLES) {
      expect(admissionAuthorityFor({ role, scannerScopes: [] }, EVENT_A), role).toBeNull()
      expect(admissionAuthorityFor({ role }, EVENT_A), role).toBeNull()
    }
  })

  it('does not let an inherited capability stand in for a scope', () => {
    // STAFF and MANAGER hold ticket:check_in only through SCANNER. The
    // capability check alone would pass them everywhere.
    expect(ORG_ROLE_CAPABILITIES.STAFF).toContain(CAPABILITIES.TICKET_CHECK_IN)
    expect(ORG_ROLE_CAPABILITIES.MANAGER).toContain(CAPABILITIES.TICKET_CHECK_IN)
    expect(admissionAuthorityFor({ role: 'STAFF', scannerScopes: [] }, EVENT_A)).toBeNull()
    expect(admissionAuthorityFor({ role: 'MANAGER', scannerScopes: [] }, EVENT_A)).toBeNull()
  })

  it('refuses roles without the capability, however scoped', () => {
    for (const role of ['VIEWER', 'EVENT_MANAGER', 'FINANCE']) {
      expect(
        admissionAuthorityFor({ role, scannerScopes: [{ eventId: EVENT_A }] }, EVENT_A),
        role,
      ).toBeNull()
    }
  })

  it('refuses no membership, an unknown role, and a missing event', () => {
    expect(admissionAuthorityFor(null, EVENT_A)).toBeNull()
    expect(admissionAuthorityFor({ role: 'SUPER_ADMIN' }, EVENT_A)).toBeNull()
    expect(admissionAuthorityFor({ role: 'OWNER' }, '')).toBeNull()
    expect(admissionAuthorityFor({ role: 'OWNER' }, undefined)).toBeNull()
  })
})

describe('requiresAdmissionScope', () => {
  it('is true for the scoped door roles and false for everyone else', () => {
    expect(ORG_ROLE_ORDER.filter(requiresAdmissionScope)).toEqual(
      ORG_ROLE_ORDER.filter((role) => EVENT_SCOPED_ADMISSION_ROLES.includes(role)),
    )
    expect(requiresAdmissionScope('OWNER')).toBe(false)
    expect(requiresAdmissionScope('VIEWER')).toBe(false)
  })
})
