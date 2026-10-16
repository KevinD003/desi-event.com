/**
 * The finance and operations shells offer each section to somebody its page
 * will serve, and to nobody it will refuse.
 *
 * @module lib/area-tabs.test
 */

import { describe, expect, it } from 'vitest'

import { ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'

import {
  adminTabs,
  analyticsTabs,
  financeTabs,
  moderationTabs,
  operationsTabs,
} from './area-tabs.js'

/**
 * A session holding one organisation role.
 *
 * @param {string} role An organisation role.
 * @returns {object} The session.
 */
function member(role) {
  return {
    user: { id: 'u1' },
    capabilities: [],
    memberships: [
      { organizationId: 'org_1', role, capabilities: [...ORG_ROLE_CAPABILITIES[role]] },
    ],
  }
}

/**
 * A session holding one platform role and no membership.
 *
 * @param {string} role A platform role.
 * @returns {object} The session.
 */
function platform(role) {
  return {
    user: { id: 'u2' },
    capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]],
    memberships: [],
  }
}

const hrefs = (tabs) => tabs.map((tab) => tab.href)

describe('financeTabs', () => {
  it('offers an owner the refunds and payout setup of their organisation', () => {
    expect(hrefs(financeTabs(member('OWNER')))).toEqual([
      '/finance',
      '/finance/refunds',
      '/finance/connect',
    ])
  })

  it('offers the refund list to an organisation’s finance member', () => {
    expect(hrefs(financeTabs(member('FINANCE')))).toContain('/finance/refunds')
  })

  it('offers a platform role no organisation’s refunds and no payout setup', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(hrefs(financeTabs(platform(role))), role).toEqual(['/finance'])
    }
  })
})

describe('operationsTabs', () => {
  it('offers an organisation’s finance member their reconciliation items, and no outbox', () => {
    expect(hrefs(operationsTabs(member('FINANCE')))).toEqual([
      '/operations',
      '/operations/reconciliation',
    ])
  })

  it('offers the outbox only on reconciliation:manage, which no organisation role carries', () => {
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(hrefs(operationsTabs(member(role))), role).not.toContain('/operations/notifications')
    }

    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      const offered = hrefs(operationsTabs(platform(role)))
      const holds = capabilities.includes('reconciliation:manage')

      expect(offered.includes('/operations/notifications'), role).toBe(holds)
      expect(offered.includes('/operations/reconciliation'), role).toBe(holds)
    }
  })
})

describe('moderationTabs', () => {
  it('offers a moderator events, pictures and organisations, and not the website links', () => {
    expect(moderationTabs(platform('MODERATOR'))).toEqual([
      { href: '/moderation/events', label: 'Events' },
      { href: '/moderation/pictures', label: 'Pictures' },
      { href: '/moderation/organizations', label: 'Organisations' },
    ])
  })

  it('offers platform administrators and super administrators the website links as well', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      expect(moderationTabs(platform(role)), role).toEqual([
        { href: '/moderation/events', label: 'Events' },
        { href: '/moderation/pictures', label: 'Pictures' },
        { href: '/moderation/organizations', label: 'Organisations' },
        { href: '/moderation/websites', label: 'Website links' },
      ])
    }
  })

  it('offers the website links to exactly the platform roles that may turn a link on or off', () => {
    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      const offered = hrefs(moderationTabs(platform(role))).includes('/moderation/websites')

      expect(offered, role).toBe(
        capabilities.includes('website_redirect:manage') &&
          capabilities.includes('moderation:review'),
      )
    }
  })

  it('offers an organisation owner neither, since moderation is platform-held', () => {
    expect(moderationTabs(member('OWNER'))).toEqual([])
  })
})

describe('adminTabs', () => {
  // SPEC3 §12.11: "Referral codes" and "Booking fee refunds", after "Events".
  it('offers a super administrator every section, invitations first', () => {
    expect(adminTabs(platform('SUPER_ADMIN'))).toEqual([
      { href: '/admin/organizer-invitations', label: 'Organiser invitations' },
      { href: '/admin/events', label: 'Events' },
      { href: '/admin/referral-codes', label: 'Referral codes' },
      { href: '/admin/fee-refunds', label: 'Booking fee refunds' },
      { href: '/admin/imports', label: 'Imports' },
      { href: '/admin/users', label: 'People and roles' },
    ])
  })

  it('offers a platform administrator every section a super administrator has, people and roles included (ADR 0018)', () => {
    expect(adminTabs(platform('ADMIN'))).toEqual(adminTabs(platform('SUPER_ADMIN')))
    expect(hrefs(adminTabs(platform('ADMIN')))).toContain('/admin/users')
  })

  it('offers people and roles to exactly the platform roles holding platform:admin', () => {
    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      expect(hrefs(adminTabs(platform(role))).includes('/admin/users'), role).toBe(
        capabilities.includes('platform:admin'),
      )
    }
  })

  it('offers a finance administrator the booking fee refunds and nothing else (SPEC3 §12.11)', () => {
    expect(adminTabs(platform('FINANCE_ADMIN'))).toEqual([
      { href: '/admin/fee-refunds', label: 'Booking fee refunds' },
    ])
  })

  it('offers the referral codes and the booking fee refunds to exactly the platform roles that hold them', () => {
    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      const offered = hrefs(adminTabs(platform(role)))

      expect(offered.includes('/admin/referral-codes'), role).toBe(
        capabilities.includes('referral_code:manage'),
      )
      expect(offered.includes('/admin/fee-refunds'), role).toBe(
        capabilities.includes('platform_fee:refund'),
      )
    }
  })

  it('offers the imports to exactly the platform roles that import, and never a moderator', () => {
    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      expect(hrefs(adminTabs(platform(role))).includes('/admin/imports'), role).toBe(
        capabilities.includes('event:import'),
      )
    }

    expect(hrefs(adminTabs(platform('MODERATOR')))).not.toContain('/admin/imports')
  })

  it('offers the events to exactly the platform roles that edit posted events', () => {
    for (const [role, capabilities] of Object.entries(PLATFORM_ROLE_CAPABILITIES)) {
      expect(hrefs(adminTabs(platform(role))).includes('/admin/events'), role).toBe(
        capabilities.includes('event:platform_edit'),
      )
    }
  })

  it('offers every other platform role, and every organisation role, nothing', () => {
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      // A finance administrator is offered the booking fee refunds alone,
      // asserted above.
      if (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'FINANCE_ADMIN') continue

      expect(adminTabs(platform(role)), role).toEqual([])
    }

    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(adminTabs(member(role)), role).toEqual([])
    }

    expect(adminTabs(null)).toEqual([])
  })
})

describe('analyticsTabs', () => {
  const BOTH = [
    { href: '/analytics', label: 'Your organisations' },
    { href: '/analytics/events', label: 'Every event' },
  ]

  it('offers both sections to a platform administrator who also belongs to an organisation', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const session = { ...member('VIEWER'), capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]] }

      expect(analyticsTabs(session), role).toEqual(BOTH)
    }
  })

  it('offers no tab bar to somebody with only one of the two', () => {
    // An organiser has only their own figures.
    for (const role of Object.keys(ORG_ROLE_CAPABILITIES)) {
      expect(analyticsTabs(member(role)), role).toEqual([])
    }

    // A platform administrator with no organisation has only the platform list.
    for (const role of Object.keys(PLATFORM_ROLE_CAPABILITIES)) {
      expect(analyticsTabs(platform(role)), role).toEqual([])
    }

    expect(analyticsTabs(null)).toEqual([])
  })

  it('counts an organisation the page would list, as the page’s picker does', () => {
    // A platform administrator's report:view holds in every organisation, so a
    // scanner membership is one whose figures the page lists for them.
    const adminScanner = {
      ...member('SCANNER'),
      capabilities: [...PLATFORM_ROLE_CAPABILITIES.ADMIN],
    }
    // A moderator holds neither.
    const moderatorScanner = {
      ...member('SCANNER'),
      capabilities: [...PLATFORM_ROLE_CAPABILITIES.MODERATOR],
    }

    expect(analyticsTabs(adminScanner)).toEqual(BOTH)
    expect(analyticsTabs(moderatorScanner)).toEqual([])
  })
})
