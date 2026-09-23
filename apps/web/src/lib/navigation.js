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

import { currentHref, isActivePath } from './active-path.js'
import { admits, canInAnyOrganization } from './areas.js'
import { membershipsWith } from './capabilities.js'
import { buildEventsHref } from './search-params.js'

export { canInAnyOrganization, currentHref, isActivePath }

/**
 * @typedef {object} NavItem
 * @property {string} href Where it goes.
 * @property {string} label What it says.
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
 * The attendee's own pages, for somebody who is signed in.
 *
 * Everything here is about the person themselves, so it is offered to every
 * session: nobody needs a capability to see their own tickets.
 *
 * @param {object|null} session The session payload.
 * @returns {NavItem[]} The entries, empty when signed out.
 */
export function accountItems(session) {
  if (!session) return []

  return [
    { href: '/account', label: 'Overview' },
    { href: '/tickets', label: 'My tickets' },
    { href: '/tickets/accept', label: 'Accept a ticket' },
  ]
}

/**
 * The workspace, grouped the way the work divides.
 *
 * Every entry is offered by the same predicate its area's layout admits with
 * (see `lib/areas.js`), or by the capability its page asks for, so the rail
 * never offers a door the shell will then refuse.
 *
 * @type {ReadonlyArray<{id: string, label: string, destinations: ReadonlyArray<{href: string, label: string, offered: function(object|null): boolean}>}>}
 */
export const WORKSPACE_GROUPS = Object.freeze([
  {
    id: 'events',
    label: 'Events and venues',
    destinations: [
      { href: '/organizer', label: 'Overview', offered: (session) => admits(session, 'organizer') },
      {
        href: '/organizer/events',
        label: 'Events',
        offered: (session) => canInAnyOrganization(session, 'event:create'),
      },
      {
        href: '/organizer/venues',
        label: 'Venues',
        offered: (session) => canInAnyOrganization(session, 'venue:manage'),
      },
      {
        href: '/organizer/check-in',
        label: 'Check-in',
        // Door authority comes only from a membership: the API refuses a
        // platform role at the door, so a platform-administrator shortcut
        // would offer a door that does not open.
        offered: (session) => membershipsWith(session, 'ticket:check_in').length > 0,
      },
      {
        href: '/analytics',
        label: 'Analytics',
        offered: (session) => admits(session, 'analytics'),
      },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    destinations: [
      { href: '/finance', label: 'Finance', offered: (session) => admits(session, 'finance') },
      {
        href: '/operations',
        label: 'Operations',
        offered: (session) => admits(session, 'operations'),
      },
    ],
  },
  {
    id: 'trust',
    label: 'Trust and safety',
    destinations: [
      {
        href: '/moderation/events',
        label: 'Moderation',
        offered: (session) => admits(session, 'moderation'),
      },
      { href: '/privacy', label: 'Privacy', offered: (session) => admits(session, 'privacy') },
      {
        href: '/retention',
        label: 'Retention',
        offered: (session) => admits(session, 'retention'),
      },
    ],
  },
])

/**
 * The workspace groups this session is offered, empty ones dropped.
 *
 * @param {object|null} session The session payload.
 * @returns {NavGroup[]} The groups for the workspace rail.
 */
export function workspaceGroups(session) {
  if (!session) return []

  return WORKSPACE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.destinations
      .filter((destination) => destination.offered(session))
      .map(({ href, label }) => ({ href, label })),
  })).filter((group) => group.items.length > 0)
}

/**
 * Every workspace entry this session is offered, in order.
 *
 * @param {object|null} session The session payload.
 * @returns {NavItem[]} The entries.
 */
export function workspaceItems(session) {
  return workspaceGroups(session).flatMap((group) => group.items)
}

/**
 * Where "Workspace" should take this session: the first thing it is offered.
 *
 * @param {object|null} session The session payload.
 * @returns {string|null} A path, or null when the session has no workspace.
 */
export function workspaceHome(session) {
  return workspaceItems(session)[0]?.href ?? null
}

/**
 * The header's navigation, grouped for the narrow-viewport sheet.
 *
 * The header no longer lists every workspace destination. It used to — an
 * owner was offered eleven entries in one row — and that is what the
 * workspace rail is for. The header offers the way in.
 *
 * @param {object|null} session The session payload from `readSession`.
 * @returns {NavGroup[]} The groups to render.
 */
export function navigationGroups(session) {
  const groups = [{ id: 'discover', label: 'Discover', items: [...PUBLIC_ITEMS] }]

  const account = accountItems(session)
  if (account.length > 0) groups.push({ id: 'account', label: 'Your account', items: account })

  const home = workspaceHome(session)
  if (home)
    groups.push({
      id: 'workspace',
      label: 'Workspace',
      items: [{ href: home, label: 'Workspace' }],
    })

  return groups
}
