/**
 * The words the team screen uses for roles and door scopes.
 *
 * Pure and import-free, because two sides need them: the server page that
 * draws the table and the client controls that change a role. A vocabulary
 * shipped to the browser must not drag the schemas barrel in behind it (see
 * `lib/browser-bundle.js`), so the lists below are written out rather than
 * imported.
 *
 * ## Door scopes, as the API enforces them
 *
 * From `@desi-event/permissions/admission` and the `setScannerScopes` comment
 * in `apps/api/src/routes/teams.js`:
 *
 *   - OWNER and ADMIN admit to **any** event of their organisation and carry no
 *     scope; they are the roles that grant scopes, so scoping them would be
 *     ceremony.
 *   - MANAGER, STAFF and SCANNER admit **only** to the events their scope
 *     names. No scope admits nobody — not "every door the role allows".
 *   - Every other role cannot admit anybody, and a change to one clears any
 *     scope left behind.
 *
 * A role change replaces the scope whether or not `eventIds` is sent: an
 * omitted list is an empty one. So the change form always sends the whole set.
 *
 * @module app/organizer/team/team-vocabulary
 */

/**
 * Each organisation role in words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ROLE_LABELS = Object.freeze({
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  EVENT_MANAGER: 'Event manager',
  FINANCE: 'Finance',
  STAFF: 'Staff',
  SCANNER: 'Door scanner',
  VIEWER: 'Viewer',
})

/**
 * What each role may do, in a sentence, read from the role table in
 * `packages/permissions/src/capabilities.js`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ROLE_DESCRIPTIONS = Object.freeze({
  OWNER:
    'Everything an administrator can do, and the organisation’s own record and privacy erasures.',
  ADMIN:
    'Runs the organisation: cancels events, approves refunds, and decides who is on the team and in which role.',
  MANAGER:
    'Runs events and works doors, and can invite people. Admits only to the events named below.',
  EVENT_MANAGER: 'Creates and edits events, tickets, seating and venues. Does not work a door.',
  FINANCE: 'Sees the money, asks for refunds and manages payout setup. Does not work a door.',
  STAFF:
    'Reads the organisation’s events, orders and reports, and works doors. Admits only to the events named below.',
  SCANNER: 'Works a door and nothing else. Admits only to the events named below.',
  VIEWER: 'Reads unpublished events, orders and reports, and changes nothing.',
})

/**
 * Roles that admit to any event of their organisation, with no scope.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORGANIZATION_WIDE_ROLES = Object.freeze(['OWNER', 'ADMIN'])

/**
 * Roles that admit only to the events a scope names.
 *
 * @type {ReadonlyArray<string>}
 */
export const EVENT_SCOPED_ROLES = Object.freeze(['MANAGER', 'STAFF', 'SCANNER'])

/** The shortest removal reason the screen accepts. */
export const REASON_MIN = 4

/** The longest removal reason the API accepts. */
export const REASON_MAX = 200

/**
 * A role in words, or the code itself for a role this screen has not met.
 *
 * @param {string} role An organisation role.
 * @returns {string} Its label.
 */
export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role
}

/**
 * Whether a role's door authority comes from a scope.
 *
 * @param {string} role An organisation role.
 * @returns {boolean} True for MANAGER, STAFF and SCANNER.
 */
export function isEventScoped(role) {
  return EVENT_SCOPED_ROLES.includes(role)
}

/**
 * Whether a role admits to every event without a scope.
 *
 * @param {string} role An organisation role.
 * @returns {boolean} True for OWNER and ADMIN.
 */
export function isOrganizationWide(role) {
  return ORGANIZATION_WIDE_ROLES.includes(role)
}
