/**
 * The navigation model, checked.
 *
 * The thing worth testing here is not that a list renders. It is that the
 * offer tracks the capability rather than the role, that an organisation
 * capability held in one organisation is enough to be offered the door, and —
 * new in Phase 4 — that the navigation offers exactly what the area layouts
 * admit, so nobody is offered a door that refuses them.
 *
 * Sessions are built from the real role tables in `@desi-event/permissions`,
 * the same ones the API resolves `GET /v1/auth/me` from, so a change to what a
 * role holds shows up here as a change to what that role is offered.
 */

import { ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import { AREAS, admits } from './areas.js'
import {
  PUBLIC_ITEMS,
  WORKSPACE_GROUPS,
  accountItems,
  canInAnyOrganization,
  isActivePath,
  navigationGroups,
  workspaceGroups,
  workspaceHome,
  workspaceItems,
} from './navigation.js'

/**
 * A session payload shaped like `GET /v1/auth/me` returns one.
 *
 * @param {object} [options] Options.
 * @param {string[]} [options.capabilities] Platform capabilities.
 * @param {Array<{organizationId: string, capabilities: string[], role?: string}>} [options.memberships] Memberships.
 * @returns {object} The session.
 */
function session({ capabilities = [], memberships = [] } = {}) {
  return { user: { id: 'usr_1', displayName: 'Meera' }, capabilities, memberships }
}

/**
 * A session holding one organisation role, as the API would resolve it.
 *
 * @param {string} role An organisation role.
 * @returns {object} The session.
 */
function member(role) {
  return session({
    memberships: [
      { organizationId: 'org_1', role, capabilities: [...ORG_ROLE_CAPABILITIES[role]] },
    ],
  })
}

/**
 * A session holding one platform role and no memberships.
 *
 * @param {string} role A platform role.
 * @returns {object} The session.
 */
function platform(role) {
  return session({ capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]] })
}

/**
 * The hrefs a session is offered in the workspace.
 *
 * @param {object|null} value The session.
 * @returns {string[]} The hrefs.
 */
function offered(value) {
  return workspaceItems(value).map((item) => item.href)
}

/** Which area each workspace destination sits in, for the agreement check. */
const AREA_OF = Object.freeze({
  '/organizer': 'organizer',
  '/organizer/events': 'organizer',
  '/organizer/venues': 'organizer',
  '/organizer/check-in': 'organizer',
  '/organizer/organization': 'organizer',
  '/organizer/team': 'organizer',
  '/organizer/promo-codes': 'organizer',
  '/analytics': 'analytics',
  '/analytics/events': 'analytics',
  '/finance': 'finance',
  '/operations': 'operations',
  '/operations/notifications': 'operations',
  '/moderation/events': 'moderation',
  '/moderation/organizations': 'moderation',
  '/moderation/pictures': 'moderation',
  '/moderation/websites': 'moderation',
  '/privacy': 'privacy',
  '/retention': 'retention',
  '/admin/organizer-invitations': 'admin',
  '/admin/events': 'admin',
  '/admin/imports': 'admin',
  '/admin/users': 'admin',
})

describe('navigationGroups', () => {
  it('offers a signed-out visitor discovery and nothing else', () => {
    const groups = navigationGroups(null)

    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('discover')
    expect(groups[0].items).toHaveLength(PUBLIC_ITEMS.length)
  })

  it('offers a signed-in attendee their account, and no workspace', () => {
    const groups = navigationGroups(session())

    expect(groups.map((group) => group.id)).toEqual(['discover', 'account'])
    expect(groups[1].items.map((item) => item.href)).toContain('/tickets')
  })

  it('offers the workspace as one way in, not as every destination in it', () => {
    // Before Phase 4 the header listed every workspace destination — eleven
    // entries for an owner. The rail lists them now; the header offers the door.
    const groups = navigationGroups(member('OWNER'))
    const workspace = groups.find((group) => group.id === 'workspace')

    expect(workspace.items).toEqual([{ href: '/organizer', label: 'Workspace' }])
  })

  it('drops an empty group rather than rendering a heading with nothing under it', () => {
    expect(navigationGroups(session()).every((group) => group.items.length > 0)).toBe(true)
    expect(workspaceGroups(member('SCANNER')).every((group) => group.items.length > 0)).toBe(true)
  })
})

describe('accountItems', () => {
  it('is empty when signed out', () => {
    expect(accountItems(null)).toEqual([])
  })

  it('offers every signed-in person their own pages, whatever their roles', () => {
    expect(accountItems(session()).map((item) => item.href)).toEqual([
      '/account',
      '/tickets',
      '/account/orders',
      '/account/transfers',
      '/account/security',
      '/account/privacy',
    ])
    expect(accountItems(member('OWNER'))).toEqual(accountItems(session()))
  })
})

describe('workspace offers, by role', () => {
  it('offers nothing to a signed-out visitor, or to an attendee', () => {
    expect(offered(null)).toEqual([])
    expect(offered(session())).toEqual([])
    expect(workspaceHome(session())).toBeNull()
  })

  it('offers an owner everything an organisation holds, and nothing platform-wide', () => {
    expect(offered(member('OWNER'))).toEqual([
      '/organizer',
      '/organizer/events',
      '/organizer/venues',
      '/organizer/check-in',
      '/organizer/organization',
      '/organizer/team',
      '/organizer/promo-codes',
      '/analytics',
      '/finance',
      '/operations',
      '/privacy',
    ])
  })

  it('offers a scanner the door and the workspace front page, and nothing else', () => {
    expect(offered(member('SCANNER'))).toEqual(['/organizer', '/organizer/check-in'])
  })

  it('offers promo codes only to a member holding promo:manage there', () => {
    expect(offered(member('EVENT_MANAGER'))).toContain('/organizer/promo-codes')
    expect(offered(member('MANAGER'))).toContain('/organizer/promo-codes')

    for (const role of ['VIEWER', 'FINANCE', 'SCANNER', 'STAFF']) {
      expect(offered(member(role)), role).not.toContain('/organizer/promo-codes')
    }

    // The codes are an organisation's: a platform role is not offered them.
    expect(offered(platform('SUPER_ADMIN'))).not.toContain('/organizer/promo-codes')
  })

  it('offers the team to a member who may see it, and never to a platform role', () => {
    expect(offered(member('OWNER'))).toContain('/organizer/team')
    expect(offered(platform('SUPER_ADMIN'))).not.toContain('/organizer/team')
  })

  it('offers a finance member the money, which the old header never offered Operations for', () => {
    const items = offered(member('FINANCE'))

    expect(items).toContain('/finance')
    expect(items).toContain('/operations')
    expect(items).not.toContain('/privacy')
  })

  it('offers a platform moderator moderation, and no organisation door', () => {
    expect(offered(platform('MODERATOR'))).toEqual([
      '/moderation/events',
      '/moderation/organizations',
      '/moderation/pictures',
    ])
    expect(workspaceHome(platform('MODERATOR'))).toBe('/moderation/events')
  })

  it('offers a platform finance administrator Finance, which it was admitted to and never offered', () => {
    const items = offered(platform('FINANCE_ADMIN'))

    expect(items).toContain('/finance')
    expect(items).toContain('/operations')
  })

  it('offers the outbox only on the platform capability that reads it', () => {
    const holders = Object.keys(PLATFORM_ROLE_CAPABILITIES).filter((role) =>
      PLATFORM_ROLE_CAPABILITIES[role].includes('reconciliation:manage'),
    )

    expect(holders.length).toBeGreaterThan(0)

    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/operations/notifications'), role).toBe(
        holders.includes(role) && admits(platform(role), 'operations'),
      )
    }

    // No organisation role carries it, however senior.
    expect(offered(member('OWNER'))).not.toContain('/operations/notifications')
  })

  it('offers check-in to a platform super-administrator, and to no other platform role', () => {
    // ADR 0007: the super administrator admits on its own authority; every
    // other platform role is refused at the door, so is never offered it.
    expect(offered(platform('SUPER_ADMIN'))).toContain('/organizer/check-in')

    for (const role of ['SUPPORT', 'MODERATOR', 'FINANCE_ADMIN', 'ORGANIZER', 'ATTENDEE']) {
      expect(offered(platform(role)), role).not.toContain('/organizer/check-in')
    }
  })

  it('offers a destination held in any one organisation, not only the first', () => {
    const items = offered(
      session({
        memberships: [
          { organizationId: 'org_1', capabilities: [] },
          { organizationId: 'org_2', capabilities: ['privacy:redact'] },
        ],
      }),
    )

    expect(items).toContain('/privacy')
  })

  it('asks the unscoped question for a platform destination', () => {
    // retention:view and moderation:review are platform capabilities. Holding
    // one inside a membership must not be mistaken for holding it platform-wide.
    const scopedOnly = offered(
      session({ memberships: [{ organizationId: 'org_1', capabilities: ['retention:view'] }] }),
    )

    expect(scopedOnly).not.toContain('/retention')
    expect(offered(session({ capabilities: ['retention:view'] }))).toContain('/retention')
  })

  it('no longer offers a membership-less administrator the areas that then refused them', () => {
    // An actor holding `platform:admin` and three platform capabilities, and
    // no memberships. The old header offered it Analytics, Finance and Privacy
    // through the `platform:admin` shortcut; each of those layouts then said
    // "Not for you". The offer now comes from the layouts' own rules.
    const items = offered(
      session({
        capabilities: [
          'platform:admin',
          'reconciliation:manage',
          'retention:view',
          'moderation:review',
        ],
      }),
    )

    expect(items).toEqual([
      '/organizer',
      '/organizer/events',
      '/organizer/venues',
      '/moderation/events',
      '/retention',
      '/moderation/organizations',
      '/moderation/pictures',
      '/admin/users',
    ])
  })

  it('offers the organisation page to a member who may see it, and never to a platform role', () => {
    expect(offered(member('VIEWER'))).toContain('/organizer/organization')
    expect(offered(member('SCANNER'))).not.toContain('/organizer/organization')
    expect(offered(platform('SUPER_ADMIN'))).not.toContain('/organizer/organization')
  })

  it('offers organisation checks to whoever moderation admits, and to nobody else', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/moderation/organizations'), role).toBe(
        admits(platform(role), 'moderation'),
      )
    }

    expect(offered(member('OWNER'))).not.toContain('/moderation/organizations')
  })

  it('offers people and roles to a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/admin/users'), role).toBe(role === 'SUPER_ADMIN')
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/admin/users')
    }
  })

  it('offers organiser invitations to a platform administrator and a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/admin/organizer-invitations'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN',
      )
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/admin/organizer-invitations')
    }
  })

  it('lists organiser invitations before people and roles, in trust and safety', () => {
    const trust = workspaceGroups(platform('SUPER_ADMIN')).find((group) => group.id === 'trust')
    const hrefs = trust.items.map((item) => item.href)

    expect(hrefs.indexOf('/admin/organizer-invitations')).toBeGreaterThan(-1)
    expect(hrefs.indexOf('/admin/organizer-invitations')).toBeLessThan(
      hrefs.indexOf('/admin/users'),
    )
    expect(trust.items.find((item) => item.href === '/admin/organizer-invitations').label).toBe(
      'Organiser invitations',
    )
  })

  it('offers website links to a platform administrator and a super administrator, never a moderator', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/moderation/websites'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN',
      )
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/moderation/websites')
    }

    const trust = workspaceGroups(platform('ADMIN')).find((group) => group.id === 'trust')

    expect(trust.items.find((item) => item.href === '/moderation/websites').label).toBe(
      'Website links',
    )
  })

  it('offers analytics and every event’s visits to a platform administrator and a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      const items = offered(platform(role))
      const platformViewer = role === 'ADMIN' || role === 'SUPER_ADMIN'

      expect(items.includes('/analytics'), role).toBe(platformViewer)
      expect(items.includes('/analytics/events'), role).toBe(platformViewer)
    }

    // An organisation's people see their own analytics and never the platform list.
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/analytics/events')
    }

    expect(offered(member('VIEWER'))).toContain('/analytics')
  })

  it('lists every event’s visits right after analytics, by its name', () => {
    const events = workspaceGroups(platform('ADMIN')).find((group) => group.id === 'events')
    const hrefs = events.items.map((item) => item.href)

    expect(hrefs.indexOf('/analytics/events')).toBe(hrefs.indexOf('/analytics') + 1)
    expect(events.items.find((item) => item.href === '/analytics/events').label).toBe(
      'Every event’s visits',
    )
  })

  it('offers all events to a platform administrator and a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/admin/events'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN',
      )
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/admin/events')
    }

    const trust = workspaceGroups(platform('ADMIN')).find((group) => group.id === 'trust')

    expect(trust.items.find((item) => item.href === '/admin/events').label).toBe('All events')
  })

  it('offers the imports to a platform administrator and a super administrator alone', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/admin/imports'), role).toBe(
        role === 'ADMIN' || role === 'SUPER_ADMIN',
      )
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(offered(member(role)), role).not.toContain('/admin/imports')
    }

    expect(offered(platform('MODERATOR'))).not.toContain('/admin/imports')

    const trust = workspaceGroups(platform('ADMIN')).find((group) => group.id === 'trust')

    expect(trust.items.find((item) => item.href === '/admin/imports').label).toBe('Imports')
  })

  it('offers the pictures waiting to whoever moderation admits, and to nobody else', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(offered(platform(role)).includes('/moderation/pictures'), role).toBe(
        admits(platform(role), 'moderation'),
      )
    }

    expect(offered(member('OWNER'))).not.toContain('/moderation/pictures')

    const trust = workspaceGroups(platform('MODERATOR')).find((group) => group.id === 'trust')

    expect(trust.items.find((item) => item.href === '/moderation/pictures').label).toBe(
      'Pictures waiting',
    )
  })

  it('offers a platform administrator invitations and never people and roles', () => {
    const items = offered(platform('ADMIN'))

    expect(items).toContain('/admin/organizer-invitations')
    expect(items).not.toContain('/admin/users')
  })
})

describe('the rail offers exactly what the layouts admit', () => {
  const PEOPLE = {
    attendee: session(),
    ...Object.fromEntries(
      Object.keys(ORG_ROLE_CAPABILITIES).map((role) => [`org ${role}`, member(role)]),
    ),
    ...Object.fromEntries(
      Object.keys(PLATFORM_ROLE_CAPABILITIES).map((role) => [`platform ${role}`, platform(role)]),
    ),
  }

  it('knows the area of every destination it offers', () => {
    const destinations = WORKSPACE_GROUPS.flatMap((group) => group.destinations.map((d) => d.href))

    expect(destinations.filter((href) => !AREA_OF[href])).toEqual([])
  })

  it.each(Object.entries(PEOPLE))(
    '%s: every destination offered is in an area that admits them',
    (_name, person) => {
      for (const href of offered(person)) {
        expect(admits(person, AREA_OF[href]), `${href} is offered but its area refuses`).toBe(true)
      }
    },
  )

  it.each(Object.entries(PEOPLE))(
    '%s: every admitting area whose front door is in the rail is offered',
    (_name, person) => {
      for (const [key, area] of Object.entries(AREAS)) {
        if (!Object.values(AREA_OF).includes(key)) continue
        if (!admits(person, key)) continue

        const home = key === 'organizer' ? '/organizer' : area.href

        expect(offered(person), `${key} admits but ${home} is not offered`).toContain(home)
      }
    },
  )
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

describe('isActivePath', () => {
  it('matches exactly', () => {
    expect(isActivePath('/finance', '/finance')).toBe(true)
  })

  it('matches a descendant', () => {
    expect(isActivePath('/organizer/events', '/organizer/events/evt_1')).toBe(true)
  })

  it('does not match a path that merely shares a prefix', () => {
    expect(isActivePath('/privacy', '/privacy-policy')).toBe(false)
    expect(isActivePath('/organizer', '/organizers/rangoli')).toBe(false)
  })

  it('compares the root exactly, since every path starts with a slash', () => {
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/', '/events')).toBe(false)
  })

  it('is false when there is no pathname', () => {
    expect(isActivePath('/events', null)).toBe(false)
  })
})
