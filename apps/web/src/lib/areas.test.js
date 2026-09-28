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

import { AREAS, admits } from './areas.js'

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
