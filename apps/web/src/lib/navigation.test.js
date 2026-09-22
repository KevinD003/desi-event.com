/**
 * The navigation model, checked.
 *
 * The thing worth testing here is not that a list renders. It is that the
 * offer tracks the capability rather than the role, that an organisation
 * capability held in one organisation is enough to be offered the door, and
 * that active-path matching cannot be fooled by a path that merely shares a
 * prefix. Each of those has a wrong implementation that looks right.
 */

import { describe, expect, it } from 'vitest'

import {
  PUBLIC_ITEMS,
  accountItems,
  canInAnyOrganization,
  isActivePath,
  navigationGroups,
  workspaceItems,
} from './navigation.js'

/**
 * A session payload shaped like `GET /v1/auth/me` returns one.
 *
 * @param {object} [options] Options.
 * @param {string[]} [options.capabilities] Platform capabilities.
 * @param {Array<{organizationId: string, capabilities: string[]}>} [options.memberships] Memberships.
 * @returns {object} The session.
 */
function session({ capabilities = [], memberships = [] } = {}) {
  return { user: { id: 'usr_1' }, capabilities, memberships }
}

describe('navigationGroups', () => {
  it('offers a signed-out visitor discovery and nothing else', () => {
    const groups = navigationGroups(null)

    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('discover')
    expect(groups[0].items).toHaveLength(PUBLIC_ITEMS.length)
  })

  it('offers a signed-in attendee their wallet', () => {
    const groups = navigationGroups(session())

    expect(groups.map((group) => group.id)).toEqual(['discover', 'account'])
    expect(groups[1].items[0].href).toBe('/tickets')
  })

  it('drops an empty group rather than rendering a heading with nothing under it', () => {
    const groups = navigationGroups(session())

    expect(groups.some((group) => group.id === 'workspace')).toBe(false)
    expect(groups.every((group) => group.items.length > 0)).toBe(true)
  })

  it('adds the workspace group once a capability makes it useful', () => {
    const groups = navigationGroups(
      session({ memberships: [{ organizationId: 'org_1', capabilities: ['event:create'] }] }),
    )

    expect(groups.map((group) => group.id)).toEqual(['discover', 'account', 'workspace'])
  })
})

describe('workspaceItems', () => {
  it('offers nothing to a signed-out visitor', () => {
    expect(workspaceItems(null)).toEqual([])
  })

  it('offers only the destinations the capability reaches', () => {
    const items = workspaceItems(
      session({ memberships: [{ organizationId: 'org_1', capabilities: ['finance:view'] }] }),
    )

    expect(items.map((item) => item.href)).toEqual(['/finance'])
  })

  it('offers a destination held in any one organisation, not only the first', () => {
    const items = workspaceItems(
      session({
        memberships: [
          { organizationId: 'org_1', capabilities: [] },
          { organizationId: 'org_2', capabilities: ['privacy:redact'] },
        ],
      }),
    )

    expect(items.map((item) => item.href)).toContain('/privacy')
  })

  it('asks the unscoped question for a platform destination', () => {
    // retention:view and moderation:review are platform capabilities. Holding
    // one inside a membership must not be mistaken for holding it platform-wide.
    const scopedOnly = workspaceItems(
      session({ memberships: [{ organizationId: 'org_1', capabilities: ['retention:view'] }] }),
    )

    expect(scopedOnly.map((item) => item.href)).not.toContain('/retention')

    const platform = workspaceItems(session({ capabilities: ['retention:view'] }))

    expect(platform.map((item) => item.href)).toContain('/retention')
  })

  it('offers every destination to a platform administrator', () => {
    // SUPER_ADMIN is `[...ALL_CAPABILITIES]` (packages/permissions/src/capabilities.js:543),
    // so a real platform administrator arrives with every capability spelled
    // out rather than with `platform:admin` standing in for them. The offer is
    // deliberately not widened to infer the rest from `platform:admin` alone:
    // an actor holding only that string is not one this system issues, and
    // guessing on its behalf would be the one place navigation invented
    // authority it had not been given.
    const items = workspaceItems(
      session({
        capabilities: [
          'platform:admin',
          'reconciliation:manage',
          'retention:view',
          'moderation:review',
        ],
      }),
    )

    expect(items.map((item) => item.href)).toEqual([
      '/organizer/events',
      '/organizer/venues',
      '/analytics',
      '/finance',
      '/operations',
      '/privacy',
      '/retention',
      '/moderation/events',
    ])
  })
})

describe('canInAnyOrganization', () => {
  it('is false without a session', () => {
    expect(canInAnyOrganization(null, 'event:create')).toBe(false)
  })

  it('is true for a platform administrator regardless of membership', () => {
    expect(
      canInAnyOrganization(session({ capabilities: ['platform:admin'] }), 'venue:manage'),
    ).toBe(true)
  })

  it('is false when no membership holds it', () => {
    expect(
      canInAnyOrganization(
        session({ memberships: [{ organizationId: 'org_1', capabilities: ['report:view'] }] }),
        'venue:manage',
      ),
    ).toBe(false)
  })
})

describe('accountItems', () => {
  it('is empty when signed out', () => {
    expect(accountItems(null)).toEqual([])
  })

  it('links the wallet, which nothing in the header reached before', () => {
    expect(accountItems(session()).map((item) => item.href)).toEqual(['/tickets'])
  })
})

describe('isActivePath', () => {
  it('matches exactly', () => {
    expect(isActivePath('/finance', '/finance')).toBe(true)
  })

  it('matches a descendant', () => {
    expect(isActivePath('/organizer/events', '/organizer/events/evt_1')).toBe(true)
  })

  it('does not match a path that merely shares a prefix', () => {
    expect(isActivePath('/privacy', '/privacy-policy')).toBe(false)
  })

  it('compares the root exactly, since every path starts with a slash', () => {
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/', '/events')).toBe(false)
  })

  it('ignores the query string on the entry', () => {
    expect(isActivePath('/events?category=COMEDY', '/events')).toBe(true)
  })

  it('is false when there is no pathname', () => {
    expect(isActivePath('/events', null)).toBe(false)
  })
})
