/**
 * The platform administration area admits a super administrator alone.
 *
 * Sessions are built from the real role tables, the same ones the API
 * resolves `GET /v1/auth/me` from.
 *
 * @module lib/areas.test
 */

import { ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import { AREAS, admits, canInAnyOrganization } from './areas.js'

/**
 * A session holding one platform role and no memberships.
 *
 * @param {string} role A platform role.
 * @returns {object} The session.
 */
function platform(role) {
  return {
    user: { id: 'u1' },
    capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]],
    memberships: [],
  }
}

/**
 * A session holding one organisation role.
 *
 * @param {string} role An organisation role.
 * @returns {object} The session.
 */
function member(role) {
  return {
    user: { id: 'u2' },
    capabilities: [],
    memberships: [
      { organizationId: 'org_1', role, capabilities: [...ORG_ROLE_CAPABILITIES[role]] },
    ],
  }
}

describe('the admin area', () => {
  it('admits a super administrator and no other platform role', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(admits(platform(role), 'admin'), role).toBe(role === 'SUPER_ADMIN')
    }
  })

  it('admits no organisation role, however senior', () => {
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(admits(member(role), 'admin'), role).toBe(false)
    }

    expect(admits(null, 'admin')).toBe(false)
  })

  it('begins at the people and roles screen, and says nothing can grant it', () => {
    expect(AREAS.admin.href).toBe('/admin/users')
    expect(AREAS.admin.refusal).toMatch(/nothing on this page can grant it/u)
  })

  it('offers alternatives only where they are the person’s own to take', () => {
    const withAlternatives = Object.values(AREAS)
      .filter((area) => area.alternatives?.length)
      .map((area) => area.key)

    expect(withAlternatives).toEqual(['organizer'])
    expect(AREAS.organizer.alternatives.map((alternative) => alternative.href)).toEqual([
      '/account/organizations/new',
      '/account/invitations',
    ])
  })
})

describe('membership questions are not answered by a platform role', () => {
  /**
   * A session holding a platform role and one organisation role.
   *
   * @param {string} platformRole A platform role.
   * @param {string} orgRole An organisation role.
   * @returns {object} The session.
   */
  function both(platformRole, orgRole) {
    return {
      ...member(orgRole),
      capabilities: [...PLATFORM_ROLE_CAPABILITIES[platformRole]],
    }
  }

  it('does not count a moderator’s platform venue:manage as a membership’s', () => {
    // `sessionCan` counts a platform capability in every organisation, as the
    // API does. "Can I do this in one of my organisations" is a different
    // question, and a moderator who scans tickets somewhere manages no venue
    // there.
    const session = both('MODERATOR', 'SCANNER')

    expect(canInAnyOrganization(session, 'venue:manage')).toBe(false)
    expect(canInAnyOrganization(session, 'ticket:check_in')).toBe(true)
  })

  it('admits a platform administrator who scans tickets somewhere to analytics only through its own rule', () => {
    // ADMIN holds report:view platform-wide; a SCANNER membership does not.
    // The analytics area asks per membership, and that answer is unchanged.
    expect(admits(both('ADMIN', 'SCANNER'), 'analytics')).toBe(false)
    expect(admits(both('ADMIN', 'VIEWER'), 'analytics')).toBe(true)
  })

  it('still lets a super administrator in wherever it belongs, as before', () => {
    expect(canInAnyOrganization(both('SUPER_ADMIN', 'SCANNER'), 'venue:manage')).toBe(true)
    expect(admits(both('SUPER_ADMIN', 'SCANNER'), 'analytics')).toBe(true)
  })
})
