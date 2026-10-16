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
 * Whether any of this session's memberships holds a capability, or the session
 * holds `platform:admin` and belongs to some organisation.
 *
 * Membership-first on purpose, and not `sessionCan` per organisation: since
 * `sessionCan` counts every platform capability in every organisation, asking it
 * here would admit a platform role that holds the capability as soon as its
 * account belonged to any organisation at all, which is a different question
 * from "is one of my organisations' roles allowed this". The platform question
 * is asked separately where an area wants it.
 *
 * @param {object|null} session The session payload.
 * @param {string} capability The capability name.
 * @returns {boolean} True when some membership holds it.
 */
function inSomeMembership(session, capability) {
  const platformAdmin = (session?.capabilities ?? []).includes('platform:admin')

  return (session?.memberships ?? []).some(
    (membership) => platformAdmin || (membership.capabilities ?? []).includes(capability),
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
 * @property {ReadonlyArray<{href: string, label: string}>} [alternatives] Honest ways forward
 *   that are the person's own to take — never a way round somebody else's decision.
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
    // Organisations are not made from an account here: organisers join by an
    // invitation from the team at The Desi Events. Accepting that invitation, or
    // joining a team with a code somebody in it gave you, is not a way round
    // anybody's decision: each code was issued by somebody entitled to, works
    // only for the address it names, and is checked by the API.
    alternatives: Object.freeze([
      { href: '/account/organizations/new', label: 'Accept an organiser invitation' },
      { href: '/account/invitations', label: 'Join a team with an invitation code' },
    ]),
  },
  analytics: {
    key: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    // `report:view` asked per membership (an organisation capability: the
    // unscoped question consults the platform list), or the platform list of
    // every event's visits, whose own capability only platform administrators
    // and super administrators hold.
    admits: (session) =>
      inSomeMembership(session, 'report:view') || sessionCan(session, 'analytics:view_all'),
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
  admin: {
    key: 'admin',
    label: 'Platform administration',
    // The area's overview: what is waiting for the team, queue by queue.
    href: '/admin',
    // Platform-held and unscoped: no organisation role carries either. A
    // platform administrator (`organizer:invite`) comes in to invite
    // organisers; a super administrator (`platform:admin`, and every other
    // capability) to that and to changing who can do what. Editing and
    // deleting any organisation's posted events (`event:platform_edit`) belongs
    // to the team at The Desi Events too, held by the same two roles, and so is importing
    // events from source listings (`event:import`). Each page inside asks its own
    // question again. `href` stays the invitations: the area's index page
    // sends a session to the first tab it is offered, so one holding only the
    // editing capability lands on All events. The booking fee and paying at
    // the venue (`payment_terms:manage`), referral codes
    // (`referral_code:manage`) and cancelling unpaid pay-at-the-venue tickets
    // (`venue_booking:cancel`) are the same two roles'; refunding one order's
    // booking fee by hand (`platform_fee:refund`) is finance administrators'
    // too, who are admitted for that page alone (SPEC3 §12.11, SPEC3-XI §12.11).
    admits: (session) =>
      sessionCan(session, 'organizer:invite') ||
      sessionCan(session, 'platform:admin') ||
      sessionCan(session, 'event:platform_edit') ||
      sessionCan(session, 'event:import') ||
      sessionCan(session, 'payment_terms:manage') ||
      sessionCan(session, 'referral_code:manage') ||
      sessionCan(session, 'platform_fee:refund') ||
      sessionCan(session, 'venue_booking:cancel'),
    refusal:
      'This area is for the platform administrators at The Desi Events: inviting organisers, and changing who can do what across the platform. Nothing on this page can grant it.',
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
