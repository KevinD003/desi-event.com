/**
 * Who each signed-in area admits, in one place.
 *
 * Every area layout refuses a session it does not admit, and the navigation
 * offers an area only to a session it admits. Before Phase 4 those were two
 * separate pieces of code, and they disagreed in four places: a platform
 * finance administrator was admitted to Finance and never offered it; an
 * organisation's finance lead was admitted to Operations and never offered it;
 * a platform administrator with no memberships was offered Analytics and then
 * refused; and the organiser area admitted anybody signed in, so an attendee
 * who typed its address was shown "Your events" listing the public catalogue.
 *
 * Here each rule is written once. The layout and the navigation both call it,
 * so "offered" and "let in" cannot drift apart again.
 *
 * ## None of this is authorisation
 *
 * The API authorises every request again, per organisation, with step-up
 * windows on top. An area admitting somebody means only that the shell will
 * draw; a page inside can still find nothing it may show them, and the API
 * will still refuse what they may not do.
 *
 * ## The rules are the layouts' rules, unchanged
 *
 * Each predicate below is the check its layout already made, moved rather than
 * rewritten — including where that check deliberately asks the platform
 * question second (see `app/privacy/layout.jsx`). The one new rule is the
 * organiser area's, which had none.
 *
 * @module lib/areas
 */

import { sessionCan } from './capabilities.js'

/**
 * Whether any of this session's memberships holds a capability, asked the way
 * `sessionCan` asks it per organisation (a platform administrator holds it in
 * every organisation they belong to).
 *
 * @param {object|null} session The session payload.
 * @param {string} capability The capability name.
 * @returns {boolean} True when some membership holds it.
 */
function inSomeMembership(session, capability) {
  return (session?.memberships ?? []).some((membership) =>
    sessionCan(session, capability, membership.organizationId),
  )
}

/**
 * Whether this session holds a capability in any organisation, or is a
 * platform administrator — the question the organiser destinations ask.
 *
 * @param {object|null} session The session payload.
 * @param {string} capability The capability name.
 * @returns {boolean} True when the session can use it somewhere.
 */
export function canInAnyOrganization(session, capability) {
  if (!session) return false
  if ((session.capabilities ?? []).includes('platform:admin')) return true

  return inSomeMembership(session, capability)
}

/**
 * The capabilities that make the organiser workspace worth opening. Holding
 * any one of them, in any organisation, admits a session to `/organizer`.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORGANIZER_CAPABILITIES = Object.freeze([
  'event:create',
  'venue:manage',
  'ticket:check_in',
  'organization:view_members',
  'report:view',
])

/**
 * @typedef {object} Area
 * @property {string} key A stable name.
 * @property {string} label What the area is called.
 * @property {string} href Where the area begins.
 * @property {function(object|null): boolean} admits Whether the shell draws for this session.
 * @property {string} refusal What a session it does not admit is told — the words each layout
 *   already used, kept verbatim because people and tests both read them.
 */

/** @type {Readonly<Record<string, Area>>} */
export const AREAS = Object.freeze({
  account: {
    key: 'account',
    label: 'Your account',
    href: '/account',
    admits: (session) => Boolean(session),
    refusal: '',
  },
  tickets: {
    key: 'tickets',
    label: 'My tickets',
    href: '/tickets',
    admits: (session) => Boolean(session),
    refusal: '',
  },
  organizer: {
    key: 'organizer',
    label: 'Organiser workspace',
    href: '/organizer',
    admits: (session) =>
      ORGANIZER_CAPABILITIES.some((capability) => canInAnyOrganization(session, capability)),
    refusal:
      'This workspace is for people who run events: organisers, their staff and the people on their doors. Your account is not a member of any organisation that puts events on here. If you should be, ask whoever runs the organisation to add you — nothing on this page can grant it.',
  },
  analytics: {
    key: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    // `report:view` asked per membership. The unscoped question consults the
    // platform list, and `report:view` is an organisation capability.
    admits: (session) => inSomeMembership(session, 'report:view'),
    refusal:
      'Analytics is not something this account can open. If you think it should be, ask whoever runs the organisation — nothing on this page can grant it to you.',
  },
  finance: {
    key: 'finance',
    label: 'Finance',
    href: '/finance',
    admits: (session) =>
      sessionCan(session, 'finance:view') || inSomeMembership(session, 'finance:view'),
    refusal:
      'This area shows what an organisation is owed and what has been paid out. If you think you should have access, ask whoever runs the organisation — nothing here can grant it to you.',
  },
  operations: {
    key: 'operations',
    label: 'Operations',
    href: '/operations',
    admits: (session) =>
      sessionCan(session, 'finance:view') || inSomeMembership(session, 'finance:view'),
    refusal:
      'This area shows the work the machine could not finish: unresolved payments, messages that did not go, refunds waiting. If you think you should have access, ask whoever runs the organisation — nothing here can grant it to you.',
  },
  moderation: {
    key: 'moderation',
    label: 'Moderation',
    href: '/moderation/events',
    admits: (session) => sessionCan(session, 'moderation:review'),
    refusal:
      'This area is for platform moderators. If you think you should have access, ask an administrator — nothing here can grant it to you.',
  },
  privacy: {
    key: 'privacy',
    label: 'Privacy',
    href: '/privacy',
    // Memberships first; the platform question second, on purpose — see
    // `app/privacy/layout.jsx` for why both are asked and in this order.
    admits: (session) =>
      inSomeMembership(session, 'privacy:redact') || sessionCan(session, 'privacy:redact'),
    refusal:
      'This area erases people from an organisation’s records, which is not something that can be undone. It is held by organisation owners alone. If you think you should have access, ask whoever runs the organisation — nothing on this page can grant it to you.',
  },
  retention: {
    key: 'retention',
    label: 'Retention',
    href: '/retention',
    admits: (session) => sessionCan(session, 'retention:view'),
    refusal:
      'This area shows what a retention rehearsal counted across the whole platform. It is not held by any role inside an organisation, and nothing on this page can grant it to you.',
  },
})

/**
 * Whether a session is admitted to an area.
 *
 * @param {object|null} session The session payload.
 * @param {string} key The area's key.
 * @returns {boolean} True when the area's shell will draw for this session.
 */
export function admits(session, key) {
  const area = AREAS[key]

  if (!area) throw new Error(`Unknown area: ${key}`)

  return area.admits(session)
}
