/**
 * What a session may be offered, asked the way the API decides it.
 *
 * Sessions are built from the real role tables, the same ones the API resolves
 * `GET /v1/auth/me` from, and each answer is held to `can()` from
 * `@desi-event/permissions` itself: a screen that offers what the API would
 * refuse, or hides what it would allow, is the drift this file exists to catch.
 *
 * @module lib/capabilities.test
 */

import {
  ALL_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  can,
} from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import {
  connectOrganizations,
  membershipsWith,
  privacyOrganizations,
  sessionCan,
} from './capabilities.js'

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'

/**
 * A session as `auth.me` returns it, and the actor `can()` would see.
 *
 * @param {string} platformRole The platform role.
 * @param {Array<Array<string>>} [memberships] Organisation id and role pairs.
 * @returns {{session: object, actor: object}} Both shapes of one person.
 */
function person(platformRole, memberships = []) {
  return {
    session: {
      user: { id: 'u1', role: platformRole },
      capabilities: [...PLATFORM_ROLE_CAPABILITIES[platformRole]],
      memberships: memberships.map(([organizationId, role]) => ({
        organizationId,
        organizationName: `Organisation ${organizationId}`,
        role,
        capabilities: [...ORG_ROLE_CAPABILITIES[role]],
      })),
    },
    actor: {
      id: 'u1',
      role: platformRole,
      memberships: memberships.map(([organizationId, role]) => ({ organizationId, role })),
    },
  }
}

describe('sessionCan', () => {
  it('counts a platform capability in every organisation, as can() does', () => {
    // The platform administrator reads every organisation's reports.
    const { session } = person('ADMIN')

    expect(sessionCan(session, 'report:view', ORG_A)).toBe(true)
    expect(sessionCan(session, 'report:view', ORG_B)).toBe(true)
    expect(sessionCan(session, 'report:view')).toBe(true)
  })

  it('counts a finance administrator’s platform money capabilities in every organisation', () => {
    const { session } = person('FINANCE_ADMIN', [[ORG_A, 'VIEWER']])

    expect(sessionCan(session, 'finance:view', ORG_A)).toBe(true)
    expect(sessionCan(session, 'order:refund_approve', ORG_B)).toBe(true)
  })

  it('counts a membership capability only in its own organisation', () => {
    const { session } = person('ORGANIZER', [[ORG_A, 'EVENT_MANAGER']])

    expect(sessionCan(session, 'event:publish', ORG_A)).toBe(true)
    expect(sessionCan(session, 'event:publish', ORG_B)).toBe(false)
    expect(sessionCan(session, 'event:publish')).toBe(false)
  })

  it('does not lend a platform role what neither it nor the membership holds', () => {
    // A platform administrator who is a door scanner somewhere publishes
    // nothing there: neither grant holds event:publish.
    const { session } = person('ADMIN', [[ORG_A, 'SCANNER']])

    expect(sessionCan(session, 'event:publish', ORG_A)).toBe(false)
    expect(sessionCan(session, 'finance:view', ORG_A)).toBe(false)
    expect(sessionCan(session, 'ticket:check_in', ORG_A)).toBe(true)
  })

  it('gives a super administrator everything, everywhere', () => {
    const { session } = person('SUPER_ADMIN')

    for (const capability of ALL_CAPABILITIES) {
      expect(sessionCan(session, capability, ORG_A), capability).toBe(true)
    }
  })

  it('agrees with can() for every platform role, organisation role and capability', () => {
    const memberships = [[ORG_A, 'OWNER'], [ORG_A, 'SCANNER'], [ORG_A, 'FINANCE'], []]

    for (const platformRole of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      for (const pair of memberships) {
        const { session, actor } = person(platformRole, pair.length ? [pair] : [])

        for (const capability of ALL_CAPABILITIES) {
          for (const organizationId of [ORG_A, ORG_B]) {
            expect(
              sessionCan(session, capability, organizationId),
              `${platformRole} ${pair.join(' ')} ${capability} in ${organizationId}`,
            ).toBe(can(actor, capability, { organizationId }))
          }
        }
      }
    }
  })

  it('refuses everything without a session', () => {
    expect(sessionCan(null, 'report:view', ORG_A)).toBe(false)
    expect(sessionCan(undefined, 'report:view')).toBe(false)
  })
})

describe('the membership-scoped lists, which ignore platform capabilities', () => {
  it('names only the organisations whose membership holds the capability', () => {
    // A super administrator holds privacy:redact and connect:manage platform
    // wide; these lists are about the person's own organisations.
    const { session } = person('SUPER_ADMIN', [
      [ORG_A, 'OWNER'],
      [ORG_B, 'VIEWER'],
    ])

    expect(privacyOrganizations(session).map((row) => row.organizationId)).toEqual([ORG_A])
    expect(connectOrganizations(session).map((row) => row.organizationId)).toEqual([ORG_A])
    expect(membershipsWith(session, 'report:view').map((row) => row.organizationId)).toEqual([
      ORG_A,
      ORG_B,
    ])
  })
})
