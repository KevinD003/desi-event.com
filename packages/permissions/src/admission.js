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
 * ## Two platform roles, and only two
 *
 * **`SUPER_ADMIN` and the platform administrator `ADMIN` admit at any event,
 * on their own authority.** It is a third authority, `PLATFORM_ROLE`, and it
 * rests on the same argument as the OWNER/ADMIN bypass: both hold
 * `platform:admin` and can grant themselves any membership (the platform
 * routes let them), so refusing them at the door would be ceremony rather than
 * control. Unlike the membership path, it is recorded distinctly: the API
 * writes a `ticket.admission_platform_authority` row on the event for every
 * platform lookup and admission, naming the platform role that acted, so the
 * organisation can see that somebody outside it stood at its door. (ADR 0007
 * reversed the earlier rule that platform roles admit nobody; ADR 0018 adds
 * ADMIN beside SUPER_ADMIN.)
 *
 * Membership wins. A platform administrator who is also a member of the
 * event's organisation is recorded on the membership's authority; the platform
 * authority is the fallback, never the first answer.
 *
 * **Every other platform role admits nobody.** `SUPPORT`, `MODERATOR` and
 * `FINANCE_ADMIN` hold capabilities, but not `ticket:check_in`, and a
 * module-load assertion below refuses a platform role table in which that
 * stops being true — so granting the capability to one of them later fails
 * every process rather than silently opening doors. The API audits a refused
 * attempt from one of them against the account.
 *
 * ## What is deliberately absent
 *
 * **There is no expiry.** A `Membership` has no status or end date in this
 * schema; removing somebody deletes the row and its scopes with it. Because the
 * API rebuilds its view of the caller on every request and re-reads membership
 * and scope inside the admission transaction, a removal takes effect on the
 * next scan rather than at the next sign-in.
 *
 * @module @desi-event/permissions/admission
 */

import { CAPABILITIES, ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from './capabilities.js'

/**
 * Where an admission's authority came from.
 *
 * Recorded on the admission audit, so a reviewer can tell a scoped door scanner
 * from an owner who happened to be at the door.
 *
 * @type {Readonly<{ORGANIZATION_ROLE: 'ORGANIZATION_ROLE', EVENT_SCOPE: 'EVENT_SCOPE', PLATFORM_ROLE: 'PLATFORM_ROLE'}>}
 */
export const ADMISSION_AUTHORITIES = Object.freeze({
  ORGANIZATION_ROLE: 'ORGANIZATION_ROLE',
  EVENT_SCOPE: 'EVENT_SCOPE',
  PLATFORM_ROLE: 'PLATFORM_ROLE',
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
 * Platform roles that may admit at any event, on platform authority.
 *
 * SUPER_ADMIN and, since ADR 0018 (amending ADR 0007), the platform
 * administrator ADMIN, which holds everything SUPER_ADMIN does except changing
 * platform roles. Both hold `platform:admin`. The audit row records which of
 * the two admitted.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ADMISSION_ROLES = Object.freeze(['ADMIN', 'SUPER_ADMIN'])

/**
 * Platform roles that hold some capability but may not admit anybody.
 *
 * Derived rather than listed, so a platform role added later with any
 * capability lands here by default — refused, and audited when it tries —
 * until somebody decides otherwise in this file.
 *
 * @type {ReadonlyArray<string>}
 */
export const REFUSED_PLATFORM_ADMISSION_ROLES = Object.freeze(
  Object.entries(PLATFORM_ROLE_CAPABILITIES)
    .filter(
      ([role, capabilities]) => capabilities.length > 0 && !PLATFORM_ADMISSION_ROLES.includes(role),
    )
    .map(([role]) => role),
)

/**
 * Refuse a platform role table in which door authority drifted.
 *
 * The platform roles holding `ticket:check_in` must be exactly
 * {@link PLATFORM_ADMISSION_ROLES}, and each of those must hold
 * `platform:admin` — the power to grant itself any membership, which is what
 * makes the bypass honest.
 *
 * @param {Record<string, ReadonlyArray<string>>} platformCapabilities Capabilities per platform role.
 * @returns {void}
 * @throws {Error} When another platform role gained the capability, or a door role lost `platform:admin`.
 */
export function assertPlatformAdmissionPolicy(platformCapabilities) {
  const admitting = Object.entries(platformCapabilities)
    .filter(([, capabilities]) => capabilities.includes(CAPABILITIES.TICKET_CHECK_IN))
    .map(([role]) => role)
    .sort()

  const expected = [...PLATFORM_ADMISSION_ROLES].sort()

  if (JSON.stringify(admitting) !== JSON.stringify(expected)) {
    throw new Error(
      `Platform admission policy out of date: platform roles holding ${CAPABILITIES.TICKET_CHECK_IN} ` +
        `are [${admitting.join(', ')}] but only [${expected.join(', ')}] may admit on platform authority.`,
    )
  }

  for (const role of PLATFORM_ADMISSION_ROLES) {
    if (!platformCapabilities[role]?.includes(CAPABILITIES.PLATFORM_ADMIN)) {
      throw new Error(
        `Platform admission policy: ${role} admits on platform authority but does not hold ` +
          `${CAPABILITIES.PLATFORM_ADMIN}. The bypass belongs only to a role that could grant ` +
          'itself any membership anyway.',
      )
    }
  }
}

assertPlatformAdmissionPolicy(PLATFORM_ROLE_CAPABILITIES)

/**
 * The authority a platform role carries at the door, or null.
 *
 * Pure. The caller reads the role from the database — never from a claim the
 * browser made — and consults this only when the membership path gave nothing.
 *
 * @param {string|null|undefined} platformRole The caller's platform role.
 * @returns {{authority: 'PLATFORM_ROLE', role: string}|null} The authority, or null.
 */
export function platformAdmissionAuthorityFor(platformRole) {
  if (typeof platformRole !== 'string' || !PLATFORM_ADMISSION_ROLES.includes(platformRole)) {
    return null
  }

  if (!(PLATFORM_ROLE_CAPABILITIES[platformRole] ?? []).includes(CAPABILITIES.TICKET_CHECK_IN)) {
    return null
  }

  return { authority: ADMISSION_AUTHORITIES.PLATFORM_ROLE, role: platformRole }
}

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
