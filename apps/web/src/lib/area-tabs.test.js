/**
 * The finance and operations shells offer each section to somebody its page
 * will serve, and to nobody it will refuse.
 *
 * @module lib/area-tabs.test
 */

import { describe, expect, it } from 'vitest'

import { ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'

import { financeTabs, operationsTabs } from './area-tabs.js'

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
