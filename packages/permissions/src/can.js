/**
 * Authorization checks.
 *
 * Two independent grants can satisfy a check:
 *
 * 1. the actor's platform role ({@link PLATFORM_ROLE_CAPABILITIES}), which
 *    applies everywhere and is reserved for platform staff, and
 * 2. the actor's membership role in the organisation named by the check's
 *    context ({@link ORG_ROLE_CAPABILITIES}).
 *
 * The second is the important one: an organisation grant is only ever read
 * from the membership matching `context.organizationId`, so a MANAGER of one
 * organisation has no rights at all over another.
 *
 * @module @desi-event/permissions/can
 */

import {
  ALL_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  isCapability,
  orgRoleRank,
} from './capabilities.js'
import { PermissionError } from './errors.js'

/**
 * @typedef {object} Membership
 * @property {string} organizationId The organisation this membership belongs to.
 * @property {string} role An `OrgRole` value: OWNER, ADMIN, MANAGER, STAFF or VIEWER.
 */

/**
 * @typedef {object} Actor
 * @property {string} id The user's id.
 * @property {string} [role] The platform-wide `UserRole`: ATTENDEE, ORGANIZER or ADMIN.
 * @property {Membership[]} [memberships] Organisation memberships held by the user.
 */

/**
 * @typedef {object} PermissionContext
 * @property {string} [organizationId] Organisation the action targets.
 */

/**
 * Read an actor's memberships defensively.
 *
 * Actors are assembled from a JWT or a database row, so `memberships` may be
 * absent (a token minted before the claim existed) rather than an empty array.
 *
 * @param {Actor|null|undefined} actor The actor to inspect.
 * @returns {Membership[]} The memberships, or an empty array.
 */
function membershipsOf(actor) {
  return Array.isArray(actor?.memberships) ? actor.memberships : []
}

/**
 * Find the actor's effective role in one organisation.
 *
 * If several memberships name the same organisation — which a bad join or a
 * partially applied migration can produce — the most privileged one wins, so
 * the answer never depends on array order.
 *
 * @param {Actor|null|undefined} actor The actor to inspect.
 * @param {string|null|undefined} organizationId The organisation to look up.
 * @returns {string|null} The `OrgRole`, or `null` when the actor is not a member.
 */
export function orgRoleFor(actor, organizationId) {
  if (!actor || !organizationId) return null

  let best = null

  for (const membership of membershipsOf(actor)) {
    if (membership?.organizationId !== organizationId) continue
    if (orgRoleRank(membership.role) < 0) continue
    if (best === null || orgRoleRank(membership.role) > orgRoleRank(best)) best = membership.role
  }

  return best
}

/**
 * Decide the outcome of a check and, when it fails, why.
 *
 * @param {Actor|null|undefined} actor The actor being checked.
 * @param {unknown} capability The capability being requested.
 * @param {PermissionContext} [context] Scope of the check.
 * @returns {{allowed: boolean, reason: string|null}} The decision.
 */
function decide(actor, capability, context = {}) {
  if (!actor || typeof actor !== 'object') return { allowed: false, reason: 'unauthenticated' }

  // Fail closed: an unrecognised capability is never granted, not even to a
  // platform admin, so that a typo denies instead of quietly allowing.
  if (!isCapability(capability)) return { allowed: false, reason: 'unknown_capability' }

  const platformCapabilities = PLATFORM_ROLE_CAPABILITIES[actor.role] ?? []
  if (platformCapabilities.includes(capability)) return { allowed: true, reason: null }

  const organizationId = context?.organizationId
  if (!organizationId) return { allowed: false, reason: 'missing_capability' }

  const orgRole = orgRoleFor(actor, organizationId)
  if (!orgRole) return { allowed: false, reason: 'missing_capability' }

  const orgCapabilities = ORG_ROLE_CAPABILITIES[orgRole] ?? []

  return orgCapabilities.includes(capability)
    ? { allowed: true, reason: null }
    : { allowed: false, reason: 'missing_capability' }
}

/**
 * Test whether an actor holds a capability.
 *
 * @param {Actor|null|undefined} actor The actor, or `null`/`undefined` when unauthenticated.
 * @param {string} capability The capability string, e.g. `'ticket:check_in'`.
 * @param {PermissionContext} [context] Scope of the check; `organizationId` is
 *   required for every organisation-scoped capability.
 * @returns {boolean} `true` only when the actor is permitted.
 */
export function can(actor, capability, context = {}) {
  return decide(actor, capability, context).allowed
}

/**
 * Assert that an actor holds a capability, throwing if they do not.
 *
 * @param {Actor|null|undefined} actor The actor, or `null`/`undefined` when unauthenticated.
 * @param {string} capability The capability string, e.g. `'event:publish'`.
 * @param {PermissionContext} [context] Scope of the check.
 * @returns {void} Nothing, when the actor is permitted.
 * @throws {PermissionError} With `statusCode` 403 when the actor is not permitted.
 */
export function assertCan(actor, capability, context = {}) {
  const { allowed, reason } = decide(actor, capability, context)
  if (allowed) return

  const name = typeof capability === 'string' ? capability : String(capability)
  const scope = context?.organizationId ? ` in organization ${context.organizationId}` : ''

  const message =
    reason === 'unauthenticated'
      ? `Authentication is required for ${name}.`
      : `Actor is not permitted to ${name}${scope}.`

  throw new PermissionError(message, {
    capability: typeof capability === 'string' ? capability : null,
    organizationId: context?.organizationId ?? null,
    actorId: actor?.id ?? null,
    reason,
  })
}

/**
 * List every capability an actor holds, optionally within one organisation.
 *
 * The result is the union of the actor's platform capabilities and — when
 * `organizationId` is supplied and the actor is a member there — that
 * membership's capabilities. Omitting `organizationId` therefore returns only
 * the platform-wide set, which is empty for everyone but platform admins.
 *
 * @param {Actor|null|undefined} actor The actor, or `null`/`undefined` when unauthenticated.
 * @param {string} [organizationId] Organisation to include membership capabilities for.
 * @returns {string[]} A fresh, sorted, de-duplicated array of capability strings.
 */
export function capabilitiesFor(actor, organizationId) {
  if (!actor || typeof actor !== 'object') return []

  const granted = new Set(PLATFORM_ROLE_CAPABILITIES[actor.role] ?? [])

  const orgRole = orgRoleFor(actor, organizationId)
  if (orgRole) {
    for (const capability of ORG_ROLE_CAPABILITIES[orgRole] ?? []) granted.add(capability)
  }

  // Guard against a role table drifting ahead of the capability vocabulary.
  return ALL_CAPABILITIES.filter((capability) => granted.has(capability))
}
