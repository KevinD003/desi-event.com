/**
 * Who may admit somebody to an event, and on what authority.
 *
 * ## Why this is not just `ticket:check_in`
 *
 * `ticket:check_in` is an organisation capability. Held alone, it would let a
 * door scanner hired for one concert admit people to every event its
 * organisation runs — and for most of this repository's life that is exactly
 * what it did: `ScannerScope` rows were written by the team routes and read by
 * nothing, while the schema comment above the model promised "a scanner with no
 * scope scans nothing".
 *
 * So admission needs two answers, not one: does this person hold the capability
 * in the organisation that owns the event, and is their authority good for
 * *this* event?
 *
 * ## The policy
 *
 * Every organisation role that holds `ticket:check_in` falls into exactly one
 * of two groups, and a module-load assertion below refuses a role table in
 * which that stops being true — so a role added later that gains the capability
 * cannot silently default to either.
 *
 * - **Organisation-wide** — `OWNER` and `ADMIN`. These are precisely the roles
 *   holding `team:role_manage`, the power to grant scopes. A rule scoping them
 *   would be ceremony rather than control: they could assign the scope to an
 *   account they control. This group is defined by that property, and the
 *   assertion checks it, so the bypass cannot drift onto a role that lacks it.
 * - **Event-scoped** — `MANAGER`, `STAFF` and `SCANNER`. Each holds the
 *   capability only by inheritance through `SCANNER`, none can grant scopes, and
 *   each needs an active `ScannerScope` naming the event. No scope, no
 *   admission: the model's comment is now what the code does.
 *
 * ## What is deliberately absent
 *
 * **Platform roles admit nobody.** `SUPER_ADMIN` holds every capability for
 * support and moderation, but admission is a physical-world act performed by the
 * organiser's own staff. A platform administrator who genuinely needs to scan is
 * given a membership — which the team routes audit — rather than a silent
 * override this module would have to remember to record. The API audits a
 * refused platform attempt like any other refusal.
 *
 * **There is no expiry.** A `Membership` has no status or end date in this
 * schema; removing somebody deletes the row and its scopes with it. Because the
 * API rebuilds its view of the caller on every request and re-reads membership
 * and scope inside the admission transaction, a removal takes effect on the
 * next scan rather than at the next sign-in.
 *
 * @module @desi-event/permissions/admission
 */

import { CAPABILITIES, ORG_ROLE_CAPABILITIES } from './capabilities.js'

/**
 * Where an admission's authority came from.
 *
 * Recorded on the admission audit, so a reviewer can tell a scoped door scanner
 * from an owner who happened to be at the door.
 *
 * @type {Readonly<{ORGANIZATION_ROLE: 'ORGANIZATION_ROLE', EVENT_SCOPE: 'EVENT_SCOPE'}>}
 */
export const ADMISSION_AUTHORITIES = Object.freeze({
  ORGANIZATION_ROLE: 'ORGANIZATION_ROLE',
  EVENT_SCOPE: 'EVENT_SCOPE',
})

/**
 * Roles that may admit to any event of their own organisation.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORGANIZATION_WIDE_ADMISSION_ROLES = Object.freeze(['OWNER', 'ADMIN'])

/**
 * Roles that may admit only to events their scopes name.
 *
 * @type {ReadonlyArray<string>}
 */
export const EVENT_SCOPED_ADMISSION_ROLES = Object.freeze(['MANAGER', 'STAFF', 'SCANNER'])

/**
 * Refuse a role table in which the two groups no longer describe the world.
 *
 * Checked when the module loads, so a change to the role graph that breaks the
 * policy fails every test and every process that imports it, rather than
 * shipping a role that admits on a default nobody chose.
 *
 * @param {Record<string, ReadonlyArray<string>>} roleCapabilities Resolved capabilities per org role.
 * @returns {void}
 * @throws {Error} When a door role is unclassified, classified twice, or a
 *   bypass role cannot grant scopes.
 */
export function assertAdmissionPolicy(roleCapabilities) {
  const admitting = Object.entries(roleCapabilities)
    .filter(([, capabilities]) => capabilities.includes(CAPABILITIES.TICKET_CHECK_IN))
    .map(([role]) => role)
    .sort()

  const classified = [...ORGANIZATION_WIDE_ADMISSION_ROLES, ...EVENT_SCOPED_ADMISSION_ROLES].sort()

  if (JSON.stringify(admitting) !== JSON.stringify(classified)) {
    throw new Error(
      `Admission policy out of date: roles holding ${CAPABILITIES.TICKET_CHECK_IN} are ` +
        `[${admitting.join(', ')}] but the policy classifies [${classified.join(', ')}]. ` +
        'Every door role must be organisation-wide or event-scoped, and exactly one of them.',
    )
  }

  for (const role of ORGANIZATION_WIDE_ADMISSION_ROLES) {
    if (!roleCapabilities[role]?.includes(CAPABILITIES.TEAM_ROLE_MANAGE)) {
      throw new Error(
        `Admission policy: ${role} is organisation-wide but cannot grant scopes ` +
          `(${CAPABILITIES.TEAM_ROLE_MANAGE}). The bypass belongs only to roles that could ` +
          'assign themselves any scope anyway.',
      )
    }
  }

  for (const role of EVENT_SCOPED_ADMISSION_ROLES) {
    if (roleCapabilities[role]?.includes(CAPABILITIES.TEAM_ROLE_MANAGE)) {
      throw new Error(
        `Admission policy: ${role} is event-scoped but can grant scopes, so scoping it controls nothing.`,
      )
    }
  }
}

assertAdmissionPolicy(ORG_ROLE_CAPABILITIES)

/**
 * The authority a membership carries for one event, or null when it carries none.
 *
 * Pure. The caller reads the membership — and its scope rows for this event
 * only — from the database, inside the transaction that will act on the
 * answer, and passes them here. Nothing is read from the request.
 *
 * @param {{role: string, scannerScopes?: Array<{eventId: string}>}|null} membership
 *   The caller's membership in the event's organisation, with its scopes.
 * @param {string} eventId The event the ticket belongs to, resolved from the database.
 * @returns {{authority: string, role: string}|null} The authority, or null.
 */
export function admissionAuthorityFor(membership, eventId) {
  if (!membership || typeof eventId !== 'string' || eventId === '') return null

  const capabilities = ORG_ROLE_CAPABILITIES[membership.role] ?? []

  if (!capabilities.includes(CAPABILITIES.TICKET_CHECK_IN)) return null

  if (ORGANIZATION_WIDE_ADMISSION_ROLES.includes(membership.role)) {
    return { authority: ADMISSION_AUTHORITIES.ORGANIZATION_ROLE, role: membership.role }
  }

  if (!EVENT_SCOPED_ADMISSION_ROLES.includes(membership.role)) return null

  const scoped = (membership.scannerScopes ?? []).some((scope) => scope.eventId === eventId)

  return scoped ? { authority: ADMISSION_AUTHORITIES.EVENT_SCOPE, role: membership.role } : null
}

/**
 * Whether a role needs a scope to admit anybody.
 *
 * Used by the team routes to decide which memberships keep scope rows.
 *
 * @param {string} role An organisation role.
 * @returns {boolean} True for the event-scoped door roles.
 */
export function requiresAdmissionScope(role) {
  return EVENT_SCOPED_ADMISSION_ROLES.includes(role)
}
