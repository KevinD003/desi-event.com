/**
 * What the navigation offers, derived from the session.
 *
 * ## This is not an authorisation mechanism
 *
 * Every entry below is decided from `GET /v1/auth/me`, and every destination it
 * names is a route the API guards independently. Hiding a link does not protect
 * anything: the same-origin proxy at `app/api/v1/[...path]` forwards any `/v1`
 * path a browser asks for, so a person who types the URL reaches exactly the
 * same guard as a person who clicks. What this module decides is whether
 * somebody is *offered* a door, not whether it opens.
 *
 * The distinction matters in both directions. Showing a link somebody cannot
 * use wastes their time and teaches them to distrust the interface; hiding one
 * they can use makes the product look smaller than it is. Neither is a security
 * property.
 *
 * ## Why capabilities rather than roles
 *
 * Roles inherit — ADMIN and OWNER both reach `connect:manage` through FINANCE —
 * so a role test would have to restate the inheritance graph and would drift
 * from it. Asking for the capability asks the question the API will ask.
 *
 * Organisation capabilities are asked per membership, because holding
 * `privacy:redact` in one organisation says nothing about another. Platform
 * capabilities are asked unscoped.
 *
 * @module lib/navigation
 */

import { isActivePath } from './active-path.js'
import { buildEventsHref } from './search-params.js'
import { sessionCan } from './session.js'

export { isActivePath }

/**
 * @typedef {object} NavItem
 * @property {string} href Where it goes.
 * @property {string} label What it says.
 * @property {string} [description] A short gloss, used by the mobile sheet where there is room for one.
 */

/**
 * @typedef {object} NavGroup
 * @property {string} id A stable key, also used as the heading's id.
 * @property {string} label The group heading.
 * @property {NavItem[]} items Its entries, already filtered to what this session is offered.
 */

/**
 * Public discovery. Offered to everybody, signed in or not.
 *
 * Four entries, because this row has to survive a 320px viewport alongside the
 * brand and the account control.
 *
 * @type {NavItem[]}
 */
export const PUBLIC_ITEMS = Object.freeze([
  { href: '/events', label: 'All events' },
  { href: buildEventsHref({ category: 'GARBA_DANDIYA' }), label: 'Garba' },
  { href: buildEventsHref({ category: 'MUSIC_CONCERT' }), label: 'Live music' },
  { href: buildEventsHref({ category: 'COMEDY' }), label: 'Comedy' },
])

/**
 * Workspace destinations, each with the capability that makes it useful.
 *
 * `scope` says which question to ask. `organization` means "in any organisation
 * this person belongs to" — the natural reading of an organiser capability, and
 * the one that keeps an owner of one organisation and a finance lead of another
 * both seeing the door they can actually walk through. `platform` means the
 * unscoped question.
 *
 * Every capability named here is one the API declares or asserts; none is
 * invented for the navigation's convenience.
 *
 * @type {ReadonlyArray<{href: string, label: string, description: string, capability: string, scope: string, membershipOnly?: boolean}>}
 */
const WORKSPACE_DESTINATIONS = Object.freeze([
  {
    href: '/organizer/events',
    label: 'Events',
    description: 'Create, edit and publish what you are putting on',
    capability: 'event:create',
    scope: 'organization',
  },
  {
    href: '/organizer/check-in',
    label: 'Check-in',
    description: 'Look tickets up and admit people at the door',
    capability: 'ticket:check_in',
    scope: 'organization',
    // Door authority comes only from a membership: the API refuses a platform
    // role at the door, so the platform-administrator shortcut in
    // `canInAnyOrganization` would offer a door that does not open.
    membershipOnly: true,
  },
  {
    href: '/organizer/venues',
    label: 'Venues',
    description: 'Halls, seat maps and accessibility details',
    capability: 'venue:manage',
    scope: 'organization',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    description: 'How an event is selling',
    capability: 'report:view',
    scope: 'organization',
  },
  {
    href: '/finance',
    label: 'Finance',
    description: 'Orders, refunds, transfers and payouts',
    capability: 'finance:view',
    scope: 'organization',
  },
  {
    href: '/operations',
    label: 'Operations',
    description: 'Reconciliation and the notification queue',
    capability: 'reconciliation:manage',
    scope: 'platform',
  },
  {
    href: '/privacy',
    label: 'Privacy',
    description: 'Erasure requests, holds and export evidence',
    capability: 'privacy:redact',
    scope: 'organization',
  },
  {
    href: '/retention',
    label: 'Retention',
    description: 'Dry-run rehearsal evidence. Nothing here deletes anything',
    capability: 'retention:view',
    scope: 'platform',
  },
  {
    href: '/moderation/events',
    label: 'Moderation',
    description: 'The review queue',
    capability: 'moderation:review',
    scope: 'platform',
  },
])

/**
 * Whether a session holds a capability in *any* organisation it belongs to.
 *
 * `sessionCan` answers per organisation by design, because that is the question
 * an action has to ask. A navigation entry asks a weaker one — is there
 * anywhere this door leads — so it folds over the memberships rather than
 * requiring a caller to pick an organisation it does not yet know.
 *
 * @param {object|null} session The session payload.
 * @param {string} capability The capability name.
 * @returns {boolean} True when any membership holds it, or the session is a platform administrator.
 */
export function canInAnyOrganization(session, capability) {
  if (!session) return false

  if ((session.capabilities ?? []).includes('platform:admin')) return true

  return (session.memberships ?? []).some((membership) =>
    sessionCan(session, capability, membership.organizationId),
  )
}

/**
 * The account entries, for somebody who is signed in.
 *
 * `/tickets` is first because it is the reason most people have an account at
 * all, and because it was unreachable from the header before this — the wallet
 * existed and nothing linked to it.
 *
 * @param {object|null} session The session payload.
 * @returns {NavItem[]} The entries, empty when signed out.
 */
export function accountItems(session) {
  if (!session) return []

  return [
    { href: '/tickets', label: 'My tickets', description: 'Passes for what you are going to' },
  ]
}

/**
 * The workspace entries this session is offered.
 *
 * @param {object|null} session The session payload.
 * @returns {NavItem[]} The entries, in the declared order, empty when signed out.
 */
export function workspaceItems(session) {
  if (!session) return []

  return WORKSPACE_DESTINATIONS.filter((destination) => {
    if (destination.scope === 'platform') return sessionCan(session, destination.capability)

    if (destination.membershipOnly) {
      return (session.memberships ?? []).some((membership) =>
        (membership.capabilities ?? []).includes(destination.capability),
      )
    }

    return canInAnyOrganization(session, destination.capability)
  }).map(({ href, label, description }) => ({ href, label, description }))
}

/**
 * The whole navigation, grouped.
 *
 * Groups with no entries are dropped rather than rendered empty, so a signed-out
 * visitor sees one row and an owner sees three without either being told about
 * the other.
 *
 * @param {object|null} session The session payload from `readSession`.
 * @returns {NavGroup[]} The groups to render.
 */
export function navigationGroups(session) {
  const groups = [{ id: 'discover', label: 'Discover', items: [...PUBLIC_ITEMS] }]

  const account = accountItems(session)
  if (account.length > 0) groups.push({ id: 'account', label: 'Your account', items: account })

  const workspace = workspaceItems(session)
  if (workspace.length > 0) groups.push({ id: 'workspace', label: 'Workspace', items: workspace })

  return groups
}
