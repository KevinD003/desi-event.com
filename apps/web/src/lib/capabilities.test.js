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

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  SUPER_ADMIN_ONLY_CAPABILITIES as PERMISSIONS_SUPER_ADMIN_ONLY,
  can,
  orgCapabilitiesFor,
} from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import {
  SUPER_ADMIN_ONLY_CAPABILITIES,
  connectOrganizations,
  membershipCan,
  membershipsWith,
  privacyOrganizations,
  sessionCan,
} from './capabilities.js'

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
    // A moderator who is a door scanner somewhere publishes nothing there:
    // neither grant holds event:publish.
    const { session } = person('MODERATOR', [[ORG_A, 'SCANNER']])

    expect(sessionCan(session, 'event:publish', ORG_A)).toBe(false)
    expect(sessionCan(session, 'finance:view', ORG_A)).toBe(false)
    expect(sessionCan(session, 'ticket:check_in', ORG_A)).toBe(true)
  })

  it('gives a platform administrator everything but platform:role_manage, everywhere (ADR 0018)', () => {
    const { session } = person('ADMIN')

    for (const capability of ALL_CAPABILITIES) {
      const expected = capability !== 'platform:role_manage'

      expect(sessionCan(session, capability, ORG_A), capability).toBe(expected)
      expect(sessionCan(session, capability), capability).toBe(expected)
    }
  })

  it('never lets platform:admin stand in for platform:role_manage, even as an owner', () => {
    const { session } = person('ADMIN', [[ORG_A, 'OWNER']])

    expect(sessionCan(session, 'platform:role_manage')).toBe(false)
    expect(sessionCan(session, 'platform:role_manage', ORG_A)).toBe(false)
    expect(sessionCan(session, 'platform:role_manage', ORG_B)).toBe(false)
    expect(sessionCan(person('SUPER_ADMIN').session, 'platform:role_manage')).toBe(true)
  })

  it('mirrors the permissions package’s super-admin-only list', () => {
    expect([...SUPER_ADMIN_ONLY_CAPABILITIES]).toEqual([...PERMISSIONS_SUPER_ADMIN_ONLY])
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

describe('membershipCan', () => {
  it('answers from the membership alone, as the API’s orgCapabilitiesFor does', () => {
    const memberships = [[ORG_A, 'OWNER'], [ORG_A, 'EVENT_MANAGER'], [ORG_A, 'VIEWER'], []]

    for (const platformRole of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      for (const pair of memberships) {
        const { session, actor } = person(platformRole, pair.length ? [pair] : [])

        for (const capability of ALL_CAPABILITIES) {
          for (const organizationId of [ORG_A, ORG_B]) {
            expect(
              membershipCan(session, capability, organizationId),
              `${platformRole} ${pair.join(' ')} ${capability} in ${organizationId}`,
            ).toBe(orgCapabilitiesFor(actor, organizationId).includes(capability))
          }
        }
      }
    }
  })

  it('ignores the platform role: a super administrator who is not a member acts as nobody there', () => {
    const { session } = person('SUPER_ADMIN')

    expect(sessionCan(session, 'event:update', ORG_A)).toBe(true)
    expect(membershipCan(session, 'event:update', ORG_A)).toBe(false)
    expect(membershipCan(session, 'event:delete_unsold', ORG_A)).toBe(false)
    expect(membershipCan(session, 'platform:admin', ORG_A)).toBe(false)
  })

  it('never counts a platform event capability, not even for the team at The Desi Events', () => {
    for (const platformRole of ['ADMIN', 'SUPER_ADMIN']) {
      const { session } = person(platformRole, [[ORG_A, 'OWNER']])

      for (const capability of ['event:platform_edit', 'event:platform_delete', 'event:import']) {
        expect(sessionCan(session, capability, ORG_A), `${platformRole} ${capability}`).toBe(true)
        expect(membershipCan(session, capability, ORG_A), `${platformRole} ${capability}`).toBe(
          false,
        )
      }
    }
  })

  it('lets a member super administrator act as the member, with that role’s capabilities only', () => {
    const { session } = person('SUPER_ADMIN', [[ORG_A, 'EVENT_MANAGER']])

    expect(membershipCan(session, 'event:delete_unsold', ORG_A)).toBe(true)
    expect(membershipCan(session, 'event:delete', ORG_A)).toBe(false)
    expect(membershipCan(session, 'event:cancel', ORG_A)).toBe(false)
    expect(membershipCan(session, 'event:update', ORG_B)).toBe(false)
  })

  it('refuses without a session or an organisation', () => {
    const { session } = person('ORGANIZER', [[ORG_A, 'OWNER']])

    expect(membershipCan(null, 'event:update', ORG_A)).toBe(false)
    expect(membershipCan(session, 'event:update')).toBe(false)
    expect(membershipCan(session, 'event:update', '')).toBe(false)
  })

  it('is asked only on the server: no client module imports it', () => {
    /** @type {string[]} */
    const offenders = []
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(?:js|jsx|mjs)$/u.test(entry.name) || /\.test\.(?:js|jsx)$/u.test(entry.name)) {
          continue
        }

        const source = readFileSync(full, 'utf8')

        if (/^\s*['"]use client['"]/mu.test(source) && /\bmembershipCan\b/u.test(source)) {
          offenders.push(path.relative(SOURCE_ROOT, full))
        }
      }
    }

    walk(SOURCE_ROOT)

    expect(offenders).toEqual([])
  })
})
