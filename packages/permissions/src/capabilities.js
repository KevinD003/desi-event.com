/**
 * Capability vocabulary and the role tables that grant it.
 *
 * Authorization is expressed as capabilities rather than roles so that call
 * sites read as `can(actor, 'ticket:check_in', { organizationId })` instead of
 * re-deriving role comparisons everywhere. Roles exist only here, where the
 * mapping from role to capability set is defined once.
 *
 * The role names mirror the Prisma `OrgRole` and `UserRole` enums. They are
 * duplicated as plain strings on purpose: this package is pure logic with no
 * database dependency, so it must not import `@desi-event/db` (and therefore
 * `@prisma/client`) just to read five string literals.
 *
 * @module @desi-event/permissions/capabilities
 */

/**
 * Recursively freeze an object and its array/object values.
 *
 * Capability tables are module-level singletons handed to every caller in the
 * process; a single stray `push` would silently widen everybody's permissions.
 *
 * @param {object|Array} value The value to freeze in place.
 * @returns {object|Array} The same value, frozen.
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const entry of Object.values(value)) deepFreeze(entry)
  }

  return value
}

/**
 * Every capability the platform understands, keyed by a screaming-snake alias.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CAPABILITIES = deepFreeze({
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_PUBLISH: 'event:publish',
  EVENT_DELETE: 'event:delete',
  EVENT_VIEW_DRAFT: 'event:view_draft',
  TICKET_TYPE_MANAGE: 'ticketType:manage',
  ORDER_VIEW: 'order:view',
  ORDER_REFUND: 'order:refund',
  TICKET_CHECK_IN: 'ticket:check_in',
  // Releasing a hold belonging to somebody else is a support action, kept
  // separate from ticketType:manage: freeing another buyer's reservation is
  // not part of running an event day to day.
  HOLD_RELEASE_ANY: 'hold:release_any',
  ORGANIZATION_MANAGE: 'organization:manage',
  ORGANIZATION_VIEW_MEMBERS: 'organization:view_members',
  PROMO_MANAGE: 'promo:manage',
  REPORT_VIEW: 'report:view',
  PLATFORM_ADMIN: 'platform:admin',
})

/**
 * All capability strings, sorted for stable output.
 *
 * @type {ReadonlyArray<string>}
 */
export const ALL_CAPABILITIES = deepFreeze([...Object.values(CAPABILITIES)].sort())

const CAPABILITY_LOOKUP = new Set(ALL_CAPABILITIES)

/**
 * Organisation roles from least to most privileged.
 *
 * The order is load-bearing: {@link ORG_ROLE_CAPABILITIES} is built by
 * accumulating grants along this array, which makes the inheritance rule
 * (`OWNER > ADMIN > MANAGER > STAFF > VIEWER`) structural rather than a
 * property that has to be maintained by hand in five parallel lists.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORG_ROLE_ORDER = deepFreeze(['VIEWER', 'STAFF', 'MANAGER', 'ADMIN', 'OWNER'])

/**
 * Platform-wide user roles, mirroring the Prisma `UserRole` enum.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ROLE_ORDER = deepFreeze(['ATTENDEE', 'ORGANIZER', 'ADMIN'])

/**
 * Capabilities introduced by each organisation role, excluding anything it
 * inherits from the role beneath it.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const ORG_ROLE_GRANTS = {
  // Read-only staff: can see unpublished events, orders and reports.
  VIEWER: [
    CAPABILITIES.EVENT_VIEW_DRAFT,
    CAPABILITIES.ORDER_VIEW,
    CAPABILITIES.ORGANIZATION_VIEW_MEMBERS,
    CAPABILITIES.REPORT_VIEW,
  ],
  // Door staff: scans tickets at the venue, edits nothing.
  STAFF: [CAPABILITIES.TICKET_CHECK_IN],
  // Runs the event day to day: content, inventory and promotions.
  MANAGER: [
    CAPABILITIES.EVENT_CREATE,
    CAPABILITIES.EVENT_UPDATE,
    CAPABILITIES.EVENT_PUBLISH,
    CAPABILITIES.TICKET_TYPE_MANAGE,
    CAPABILITIES.PROMO_MANAGE,
  ],
  // Destructive and money-moving actions.
  ADMIN: [CAPABILITIES.EVENT_DELETE, CAPABILITIES.ORDER_REFUND, CAPABILITIES.HOLD_RELEASE_ANY],
  // Owns the organisation record itself, including its membership list.
  OWNER: [CAPABILITIES.ORGANIZATION_MANAGE],
}

/**
 * Build the cumulative role table by folding grants along a role order.
 *
 * @param {ReadonlyArray<string>} order Roles from least to most privileged.
 * @param {Record<string, ReadonlyArray<string>>} grants Per-role incremental grants.
 * @returns {Record<string, string[]>} Role to full, sorted capability list.
 */
function accumulate(order, grants) {
  const table = {}
  const inherited = []

  for (const role of order) {
    inherited.push(...(grants[role] ?? []))
    table[role] = [...new Set(inherited)].sort()
  }

  return table
}

/**
 * Full capability set for each organisation role, including inherited grants.
 *
 * Membership in the organisation named by the check's context is required
 * before any of these apply — see {@link can}.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ORG_ROLE_CAPABILITIES = deepFreeze(accumulate(ORG_ROLE_ORDER, ORG_ROLE_GRANTS))

/**
 * Capabilities granted by the platform-wide `User.role`, independent of any
 * organisation membership.
 *
 * `ORGANIZER` is deliberately empty. An organiser's authority comes entirely
 * from their memberships; granting anything here would apply to *every*
 * organisation on the platform, which is exactly the cross-tenant leak this
 * module exists to prevent. `ADMIN` is platform support and does pass
 * everything.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PLATFORM_ROLE_CAPABILITIES = deepFreeze({
  ATTENDEE: [],
  ORGANIZER: [],
  ADMIN: [...ALL_CAPABILITIES],
})

/**
 * Report whether a value is a capability this package knows about.
 *
 * Checks fail closed on unknown strings, so a typo denies rather than grants.
 * Callers that build capability names dynamically should validate with this
 * first to turn the typo into a loud error instead of a silent denial.
 *
 * @param {unknown} value The candidate capability string.
 * @returns {boolean} `true` when `value` is a known capability.
 */
export function isCapability(value) {
  return typeof value === 'string' && CAPABILITY_LOOKUP.has(value)
}

/**
 * Rank an organisation role within {@link ORG_ROLE_ORDER}.
 *
 * @param {unknown} role The role name to rank.
 * @returns {number} The role's index, or `-1` if it is not a known org role.
 */
export function orgRoleRank(role) {
  return typeof role === 'string' ? ORG_ROLE_ORDER.indexOf(role) : -1
}
