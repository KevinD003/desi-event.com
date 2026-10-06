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
import { membershipsWith, sessionCan } from './capabilities.js'

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
 * The four ways into the catalogue: the listing itself, and the three
 * directories — categories, venues, organisers — that each lead back into it.
 * Four entries, because this row has to survive a 320px viewport alongside the
 * brand and the account control. A category used to be a header entry of its
 * own; with a directory of all of them, three picked favourites said less.
 *
 * @type {NavItem[]}
 */
export const PUBLIC_ITEMS = Object.freeze([
  { href: '/events', label: 'Discover events' },
  { href: '/categories', label: 'Categories' },
  { href: '/venues', label: 'Venues' },
  { href: '/organizers', label: 'Organisers' },
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

  // Accepting a ticket is reached from Transfers, where an offer is explained;
  // on its own in the rail it was a door with no context behind it.
  return [
    { href: '/account', label: 'Overview' },
    { href: '/tickets', label: 'My tickets' },
    { href: '/account/orders', label: 'Orders' },
    { href: '/account/transfers', label: 'Transfers' },
    { href: '/account/security', label: 'Security' },
    { href: '/account/privacy', label: 'Privacy' },
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
        // Door authority comes from a membership, or from the platform role
        // that holds `ticket:check_in` itself. The unscoped question consults
        // the platform capability list, and the permissions package refuses at
        // load any table in which a platform role other than the super
        // administrator holds it — so no other platform role is offered a door
        // the API would refuse (ADR 0007).
        offered: (session) =>
          membershipsWith(session, 'ticket:check_in').length > 0 ||
          sessionCan(session, 'ticket:check_in'),
      },
      {
        href: '/organizer/organization',
        label: 'Organisation',
        // Membership only, as the page's picker is: the API reads an
        // organisation's profile to somebody inside it.
        offered: (session) => membershipsWith(session, 'organization:view_members').length > 0,
      },
      {
        href: '/organizer/team',
        label: 'Team',
        // Membership only, as the page's picker is: a platform role is not a
        // team, and the API lists members only to somebody inside it.
        offered: (session) => membershipsWith(session, 'organization:view_members').length > 0,
      },
      {
        href: '/organizer/promo-codes',
        label: 'Promo codes',
        // Membership only, like Team: the codes are an organisation's, and the
        // API answers them only to a member holding `promo:manage` there.
        offered: (session) => membershipsWith(session, 'promo:manage').length > 0,
      },
      {
        href: '/analytics',
        label: 'Analytics',
        offered: (session) => admits(session, 'analytics'),
      },
      {
        href: '/analytics/events',
        label: 'Every event’s visits',
        // Platform administrators and super administrators: the list of every
        // event's visits on the platform, inside the analytics area.
        offered: (session) =>
          sessionCan(session, 'analytics:view_all') && admits(session, 'analytics'),
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
      {
        href: '/operations/notifications',
        label: 'Notifications',
        // The outbox is platform-scoped: `reconciliation:manage`, which no
        // organisation role carries, inside an area that admits the session.
        offered: (session) =>
          sessionCan(session, 'reconciliation:manage') && admits(session, 'operations'),
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
      {
        href: '/moderation/organizations',
        label: 'Organisation checks',
        offered: (session) => admits(session, 'moderation'),
      },
      {
        href: '/moderation/pictures',
        label: 'Pictures waiting',
        // New pictures and replacement covers on posted events, each approved
        // by somebody other than its uploader.
        offered: (session) => admits(session, 'moderation'),
      },
      {
        href: '/moderation/websites',
        label: 'Website links',
        // Platform administrators and super administrators turn an event's
        // website link on or off; a moderator does not.
        offered: (session) =>
          admits(session, 'moderation') && sessionCan(session, 'website_redirect:manage'),
      },
      {
        href: '/admin/organizer-invitations',
        label: 'Organiser invitations',
        // Platform administrators and super administrators: the Desi-Event
        // team is who invites organisers.
        offered: (session) => sessionCan(session, 'organizer:invite') && admits(session, 'admin'),
      },
      {
        href: '/admin/events',
        label: 'All events',
        // Platform administrators and super administrators: every
        // organisation's events, to edit once posted, delete or restore.
        offered: (session) =>
          sessionCan(session, 'event:platform_edit') && admits(session, 'admin'),
      },
      {
        href: '/admin/imports',
        label: 'Imports',
        // Platform administrators and super administrators: events listed on
        // Sulekha, brought here for review.
        offered: (session) => sessionCan(session, 'event:import') && admits(session, 'admin'),
      },
      {
        href: '/admin/users',
        label: 'People and roles',
        // The area admits platform administrators too; this page is the
        // super administrators' alone.
        offered: (session) => sessionCan(session, 'platform:admin') && admits(session, 'admin'),
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
