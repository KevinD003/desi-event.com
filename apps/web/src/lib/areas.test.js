/**
 * The platform administration area admits the Desi-Event team's platform
 * administrators and super administrators, and finance administrators for
 * the booking-fee refund page alone (SPEC3 §12.11), and nobody else.
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
  it('admits a platform administrator, a super administrator and a finance administrator, and no other platform role', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(admits(platform(role), 'admin'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'FINANCE_ADMIN',
      )
    }
  })

  it('admits a finance administrator on refunding one order’s booking fee alone', () => {
    const finance = platform('FINANCE_ADMIN')

    expect(finance.capabilities).toContain('platform_fee:refund')
    expect(admits(finance, 'admin')).toBe(true)
    expect(
      admits(
        {
          ...finance,
          capabilities: finance.capabilities.filter((c) => c !== 'platform_fee:refund'),
        },
        'admin',
      ),
    ).toBe(false)
  })

  it('refuses a moderator, the platform role closest to it', () => {
    expect(admits(platform('MODERATOR'), 'admin')).toBe(false)
  })

  it('admits on inviting organisers alone, or on platform administration alone', () => {
    const only = (capability) => ({
      user: { id: 'u3' },
      capabilities: [capability],
      memberships: [],
    })

    expect(admits(only('organizer:invite'), 'admin')).toBe(true)
    expect(admits(only('platform:admin'), 'admin')).toBe(true)
    expect(admits(only('event:platform_edit'), 'admin')).toBe(true)
    expect(admits(only('event:import'), 'admin')).toBe(true)
    expect(admits(only('payment_terms:manage'), 'admin')).toBe(true)
    expect(admits(only('referral_code:manage'), 'admin')).toBe(true)
    expect(admits(only('platform_fee:refund'), 'admin')).toBe(true)
    expect(admits(only('venue_booking:cancel'), 'admin')).toBe(true)
    expect(admits(only('moderation:review'), 'admin')).toBe(false)
  })

  it('admits no organisation role, however senior', () => {
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(admits(member(role), 'admin'), role).toBe(false)
    }

    expect(admits(null, 'admin')).toBe(false)
  })

  it('does not take a membership’s claim to either capability', () => {
    const claimed = {
      user: { id: 'u4' },
      capabilities: [],
      memberships: [
        {
          organizationId: 'org_1',
          role: 'OWNER',
          capabilities: [
            'organizer:invite',
            'platform:admin',
            'event:platform_edit',
            'event:import',
            'payment_terms:manage',
            'referral_code:manage',
            'platform_fee:refund',
            'venue_booking:cancel',
          ],
        },
      ],
    }

    expect(admits(claimed, 'admin')).toBe(false)
  })

  it('begins at organiser invitations, says who it is for, and says nothing can grant it', () => {
    expect(AREAS.admin.href).toBe('/admin/organizer-invitations')
    expect(AREAS.admin.refusal).toBe(
      'This area is for the Desi-Event team’s platform administrators: inviting organisers, and changing who can do what across the platform. Nothing on this page can grant it.',
    )
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

  it('names the organiser alternatives as invitations, never as making an organisation', () => {
    // Organisations are not made from an account: organisers join by an
    // invitation from the Desi-Event team.
    expect(AREAS.organizer.alternatives.map((alternative) => alternative.label)).toEqual([
      'Accept an organiser invitation',
      'Join a team with an invitation code',
    ])
    expect(JSON.stringify(AREAS.organizer.alternatives)).not.toMatch(/create an organisation/iu)
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

  it('admits a platform administrator to analytics through the platform list, not through a scanner membership', () => {
    // ADMIN holds report:view platform-wide; a SCANNER membership does not.
    // The membership question is unchanged: it still says no for the scanner
    // membership. ADMIN is admitted by the platform list's own capability,
    // `analytics:view_all`, which no organisation role carries.
    expect(admits(both('ADMIN', 'SCANNER'), 'analytics')).toBe(true)
    expect(admits(both('ADMIN', 'VIEWER'), 'analytics')).toBe(true)

    // A moderator who scans tickets somewhere holds neither question's answer.
    expect(admits(both('MODERATOR', 'SCANNER'), 'analytics')).toBe(false)

    // The membership rule alone, without the platform list: still refused.
    const scannerWithReportViewPlatformOnly = {
      ...member('SCANNER'),
      capabilities: ['report:view'],
    }

    expect(admits(scannerWithReportViewPlatformOnly, 'analytics')).toBe(false)
  })

  it('still lets a super administrator in wherever it belongs, as before', () => {
    expect(canInAnyOrganization(both('SUPER_ADMIN', 'SCANNER'), 'venue:manage')).toBe(true)
    expect(admits(both('SUPER_ADMIN', 'SCANNER'), 'analytics')).toBe(true)
  })
})

describe('the analytics area', () => {
  it('admits, without any membership, a platform administrator and a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(admits(platform(role), 'analytics'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN',
      )
    }
  })

  it('admits every organisation role that holds report:view, and not a scanner', () => {
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(admits(member(role), 'analytics'), role).toBe(
        ORG_ROLE_CAPABILITIES[role].includes('report:view'),
      )
    }

    expect(admits(member('SCANNER'), 'analytics')).toBe(false)
  })

  it('does not take the platform list’s capability from inside a membership', () => {
    const scoped = {
      user: { id: 'u4' },
      capabilities: [],
      memberships: [
        { organizationId: 'org_1', role: 'SCANNER', capabilities: ['analytics:view_all'] },
      ],
    }

    expect(admits(scoped, 'analytics')).toBe(false)
  })
})
