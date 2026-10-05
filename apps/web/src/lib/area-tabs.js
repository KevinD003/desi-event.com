/**
 * The sections an area's shell offers, derived from the session.
 *
 * Kept out of the layouts so the rule each tab is offered by can be tested
 * without rendering a server component, and so the rule sits beside the page
 * it leads to rather than inside a layout nobody reads for it. As everywhere
 * in the navigation, this decides what is offered, not what is allowed: every
 * page behind a tab is authorised again by the API.
 *
 * @module lib/area-tabs
 */

import { connectOrganizations, membershipsWith, sessionCan } from './capabilities.js'

/**
 * @typedef {object} Tab
 * @property {string} href Where it goes.
 * @property {string} label What it says.
 */

/**
 * The finance area's sections.
 *
 * Refunds are listed per organisation, so the list is offered to somebody who
 * holds `finance:view` inside one; a platform role is not an organisation's
 * finance team. Payout setup is offered only to somebody who can use it: it
 * used to be offered to everybody, and a platform finance administrator, who
 * holds no organisation's `connect:manage`, followed it into a refusal.
 *
 * @param {object|null} session The session payload.
 * @returns {Tab[]} The tabs, the overview first.
 */
export function financeTabs(session) {
  return [
    { href: '/finance', label: 'Overview' },
    ...(membershipsWith(session, 'finance:view').length > 0
      ? [{ href: '/finance/refunds', label: 'Refunds' }]
      : []),
    ...(connectOrganizations(session).length > 0
      ? [{ href: '/finance/connect', label: 'Payout setup' }]
      : []),
  ]
}

/**
 * The operations area's sections.
 *
 * The reconciliation list serves two readers: an organisation's finance team,
 * scoped to their own organisation, and a platform operator holding
 * `reconciliation:manage`, who sees every organisation's. The notification
 * outbox is platform-only, on the same capability.
 *
 * @param {object|null} session The session payload.
 * @returns {Tab[]} The tabs, the board first.
 */
export function operationsTabs(session) {
  const platform = sessionCan(session, 'reconciliation:manage')

  return [
    { href: '/operations', label: 'Board' },
    ...(platform || membershipsWith(session, 'finance:view').length > 0
      ? [{ href: '/operations/reconciliation', label: 'Reconciliation' }]
      : []),
    ...(platform ? [{ href: '/operations/notifications', label: 'Notifications' }] : []),
  ]
}

/**
 * The moderation area's sections: events waiting for review, and
 * organisations waiting to be verified. Both are held by `moderation:review`,
 * which admits the area, so both are offered to everybody it admits. Website
 * links are decided by platform administrators alone
 * (`website_redirect:manage`), so a moderator is not offered them.
 *
 * @param {object|null} session The session payload.
 * @returns {Tab[]} The tabs, events first.
 */
export function moderationTabs(session) {
  if (!sessionCan(session, 'moderation:review')) return []

  return [
    { href: '/moderation/events', label: 'Events' },
    { href: '/moderation/organizations', label: 'Organisations' },
    ...(sessionCan(session, 'website_redirect:manage')
      ? [{ href: '/moderation/websites', label: 'Website links' }]
      : []),
  ]
}

/**
 * The platform administration area's sections.
 *
 * Inviting organisers is held by `organizer:invite` (platform administrators
 * and super administrators); changing platform roles and putting people into
 * organisations directly by `platform:admin` (super administrators alone).
 * Each tab is offered only to somebody its page serves. The literals stay in
 * this server module; no client component imports it.
 *
 * @param {object|null} session The session payload.
 * @returns {Tab[]} The tabs, invitations first.
 */
export function adminTabs(session) {
  return [
    ...(sessionCan(session, 'organizer:invite')
      ? [{ href: '/admin/organizer-invitations', label: 'Organiser invitations' }]
      : []),
    ...(sessionCan(session, 'platform:admin')
      ? [{ href: '/admin/users', label: 'People and roles' }]
      : []),
  ]
}
