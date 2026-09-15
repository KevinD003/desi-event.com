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
 * `@prisma/client`) just to read a handful of string literals.
 *
 * ## Why the roles stopped being a chain
 *
 * Phase 1 had five organisation roles and they nested neatly: OWNER did
 * everything ADMIN did, ADMIN everything MANAGER did, and so on down to
 * VIEWER. The table was therefore built by accumulating grants along one
 * array, which made inheritance structural rather than hand-maintained.
 *
 * Phase 2's roles do not nest. A finance user approves refunds and must not be
 * able to publish an event; an event manager publishes events and must not be
 * able to move money; a door scanner must not be able to read the attendee
 * list. Forcing those onto a single chain would mean either granting refunds to
 * whoever can publish, or granting publishing to whoever can refund — and
 * separation of duties is the point of naming them separately.
 *
 * So inheritance is now a small directed graph, {@link ORG_ROLE_INHERITS}, and
 * a role's capabilities are the transitive closure of its own grants and those
 * of the roles it inherits. {@link ORG_ROLE_ORDER} survives as a seniority
 * order for display and tie-breaking; it is deliberately *not* what decides
 * who may do what, and it is not what decides who may hand out which role —
 * see {@link canAssignOrgRole}, which compares capability sets instead.
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
 * Organisation-scoped capabilities require a membership in the organisation
 * named by the check's context. Platform-scoped ones (the `platform:`,
 * `moderation:` and `finance:` families) apply everywhere and are reserved for
 * platform staff, which is why they are granted only by
 * {@link PLATFORM_ROLE_CAPABILITIES}.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CAPABILITIES = deepFreeze({
  // --- Event content and lifecycle -----------------------------------------
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  /** Submit a draft for moderation. Distinct from publishing it. */
  EVENT_SUBMIT_REVIEW: 'event:submit_review',
  /** Make an approved event public. Deliberately separate from editing it. */
  EVENT_PUBLISH: 'event:publish',
  /** Pause and resume sales without unpublishing. */
  EVENT_PAUSE_SALES: 'event:pause_sales',
  /** Cancel or postpone a published event, which affects people who paid. */
  EVENT_CANCEL: 'event:cancel',
  EVENT_DELETE: 'event:delete',
  EVENT_VIEW_DRAFT: 'event:view_draft',

  // --- Venues and seating ---------------------------------------------------
  VENUE_MANAGE: 'venue:manage',
  /** Draw and publish seating layouts. Separate from editing venue details. */
  VENUE_MAP_MANAGE: 'venueMap:manage',

  // --- Inventory ------------------------------------------------------------
  TICKET_TYPE_MANAGE: 'ticketType:manage',
  /** Block, unblock, comp and kill individual seats; adjust capacity. */
  INVENTORY_MANAGE: 'inventory:manage',
  /**
   * Releasing a hold belonging to somebody else is a support action, kept
   * separate from `inventory:manage`: freeing another buyer's reservation is
   * not part of running an event day to day.
   */
  HOLD_RELEASE_ANY: 'hold:release_any',

  // --- Orders, attendees and the door ---------------------------------------
  ORDER_VIEW: 'order:view',
  /** Download the attendee list. A privacy-sensitive bulk read, on its own. */
  ATTENDEE_EXPORT: 'attendee:export',
  TICKET_CHECK_IN: 'ticket:check_in',

  // --- Money ---------------------------------------------------------------
  /** Ask for a refund. Under a policy that requires approval, this is all it does. */
  ORDER_REFUND_REQUEST: 'order:refund_request',
  /** Approve somebody else's refund request. */
  ORDER_REFUND_APPROVE: 'order:refund_approve',
  /** Execute a refund directly, where policy allows one actor to do both. */
  ORDER_REFUND: 'order:refund',
  /** Read the finance view: gross, fees, tax, refunds, disputes, net. */
  FINANCE_VIEW: 'finance:view',
  /** Start provider onboarding and read the connected account's state. */
  CONNECT_MANAGE: 'connect:manage',
  /** Act on transfers and payouts. */
  PAYOUT_MANAGE: 'payout:manage',

  // --- Team -----------------------------------------------------------------
  TEAM_INVITE: 'team:invite',
  TEAM_REMOVE: 'team:remove',
  /**
   * Change somebody else's role.
   *
   * Separate from removal because they are different mistakes. Removing somebody
   * is visible to them immediately; quietly making them a `FINANCE` member is
   * not, and the person who notices is whoever reconciles the payouts.
   */
  TEAM_ROLE_MANAGE: 'team:role_manage',
  ORGANIZATION_MANAGE: 'organization:manage',
  ORGANIZATION_VIEW_MEMBERS: 'organization:view_members',

  // --- Promotions and reporting --------------------------------------------
  PROMO_MANAGE: 'promo:manage',
  REPORT_VIEW: 'report:view',

  // --- Platform scope -------------------------------------------------------
  /** Read a customer's order across tenants to answer a support request. */
  SUPPORT_VIEW_ORDER: 'support:view_order',
  /** Approve, reject or suspend events, venues and organisations. */
  MODERATION_REVIEW: 'moderation:review',
  /** Resolve reconciliation tasks. Requires step-up authentication as well. */
  RECONCILIATION_MANAGE: 'reconciliation:manage',
  /** Read and post ledger corrections. */
  LEDGER_MANAGE: 'ledger:manage',
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
 * Capabilities that only ever make sense platform-wide.
 *
 * Granting one of these through an organisation membership would give an
 * organiser authority over other tenants, so {@link ORG_ROLE_CAPABILITIES} is
 * asserted at module load never to contain them.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ONLY_CAPABILITIES = deepFreeze([
  CAPABILITIES.SUPPORT_VIEW_ORDER,
  CAPABILITIES.MODERATION_REVIEW,
  CAPABILITIES.RECONCILIATION_MANAGE,
  CAPABILITIES.LEDGER_MANAGE,
  CAPABILITIES.PLATFORM_ADMIN,
])

/**
 * Organisation roles in seniority order, least to most senior.
 *
 * Used for display and for breaking ties when a user somehow holds two
 * memberships in one organisation. It is **not** the inheritance structure —
 * see {@link ORG_ROLE_INHERITS} — and it is **not** what decides which roles an
 * actor may hand out, which is a capability-subset question rather than a
 * seniority one.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORG_ROLE_ORDER = deepFreeze([
  'VIEWER',
  'SCANNER',
  'STAFF',
  'EVENT_MANAGER',
  'FINANCE',
  'MANAGER',
  'ADMIN',
  'OWNER',
])

/**
 * Platform-wide user roles, least to most senior, mirroring `UserRole`.
 *
 * Phase 1's single `ADMIN` became `SUPER_ADMIN`, and the three narrower roles
 * exist so that support, moderation and finance work does not require the key
 * to everything.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ROLE_ORDER = deepFreeze([
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'SUPER_ADMIN',
])

/**
 * Which roles each organisation role inherits from.
 *
 * Read as "EVENT_MANAGER can do everything VIEWER can, plus its own grants".
 * The graph is acyclic and resolved transitively at module load.
 *
 * Two absences are deliberate. SCANNER inherits nothing: a door device is the
 * credential most likely to be lost or shared, so it gets exactly one
 * capability and no read access to orders. FINANCE does not inherit
 * EVENT_MANAGER, and EVENT_MANAGER does not inherit FINANCE, because keeping
 * "can publish" and "can move money" apart is the whole reason both exist.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ORG_ROLE_INHERITS = deepFreeze({
  VIEWER: [],
  SCANNER: [],
  STAFF: ['VIEWER', 'SCANNER'],
  EVENT_MANAGER: ['VIEWER'],
  FINANCE: ['VIEWER'],
  MANAGER: ['STAFF', 'EVENT_MANAGER'],
  ADMIN: ['MANAGER', 'FINANCE'],
  OWNER: ['ADMIN'],
})

/**
 * Capabilities introduced by each organisation role, excluding anything it
 * inherits.
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
  // A door device, and nothing else. No order list, no attendee export.
  SCANNER: [CAPABILITIES.TICKET_CHECK_IN],
  // Venue staff: scans, and can see what they are scanning against.
  STAFF: [],
  // Runs the event: content, inventory, promotions, seating.
  EVENT_MANAGER: [
    CAPABILITIES.EVENT_CREATE,
    CAPABILITIES.EVENT_UPDATE,
    CAPABILITIES.EVENT_SUBMIT_REVIEW,
    CAPABILITIES.EVENT_PUBLISH,
    CAPABILITIES.EVENT_PAUSE_SALES,
    CAPABILITIES.TICKET_TYPE_MANAGE,
    CAPABILITIES.INVENTORY_MANAGE,
    CAPABILITIES.VENUE_MANAGE,
    CAPABILITIES.VENUE_MAP_MANAGE,
    CAPABILITIES.PROMO_MANAGE,
    CAPABILITIES.ATTENDEE_EXPORT,
  ],
  // Handles money, and cannot publish or edit an event.
  FINANCE: [
    CAPABILITIES.FINANCE_VIEW,
    CAPABILITIES.ORDER_REFUND_REQUEST,
    CAPABILITIES.CONNECT_MANAGE,
    CAPABILITIES.PAYOUT_MANAGE,
  ],
  // Both halves of running the organisation day to day.
  MANAGER: [CAPABILITIES.TEAM_INVITE],
  // Destructive actions, and approving somebody else's refund request.
  ADMIN: [
    CAPABILITIES.EVENT_CANCEL,
    CAPABILITIES.EVENT_DELETE,
    CAPABILITIES.ORDER_REFUND,
    CAPABILITIES.ORDER_REFUND_APPROVE,
    CAPABILITIES.HOLD_RELEASE_ANY,
    CAPABILITIES.TEAM_REMOVE,
    CAPABILITIES.TEAM_ROLE_MANAGE,
  ],
  // Owns the organisation record itself, including its membership list.
  OWNER: [CAPABILITIES.ORGANIZATION_MANAGE],
}

/**
 * Resolve a role's full capability set by walking its inheritance graph.
 *
 * @param {string} role The role to resolve.
 * @param {Record<string, ReadonlyArray<string>>} grants Per-role own grants.
 * @param {Record<string, ReadonlyArray<string>>} inherits Inheritance edges.
 * @param {Set<string>} [seen] Roles already on the current path, for cycle detection.
 * @returns {string[]} Every capability the role holds, unsorted.
 * @throws {Error} When the inheritance graph contains a cycle or an unknown role.
 */
function resolveRole(role, grants, inherits, seen = new Set()) {
  if (seen.has(role)) {
    throw new Error(`Role inheritance cycle through "${role}"`)
  }
  if (!(role in grants)) {
    throw new Error(`Role "${role}" inherits from a role that has no grants entry`)
  }

  const path = new Set(seen)
  path.add(role)

  const capabilities = [...(grants[role] ?? [])]
  for (const parent of inherits[role] ?? []) {
    capabilities.push(...resolveRole(parent, grants, inherits, path))
  }

  return capabilities
}

/**
 * Build the cumulative role table from an inheritance graph.
 *
 * @param {Record<string, ReadonlyArray<string>>} grants Per-role own grants.
 * @param {Record<string, ReadonlyArray<string>>} inherits Inheritance edges.
 * @returns {Record<string, string[]>} Role to full, sorted capability list.
 */
function resolveAll(grants, inherits) {
  const table = {}

  for (const role of Object.keys(grants)) {
    table[role] = [...new Set(resolveRole(role, grants, inherits))].sort()
  }

  return table
}

/**
 * Full capability set for each organisation role, including inherited grants.
 *
 * Membership in the organisation named by the check's context is required
 * before any of these apply — see `can`.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ORG_ROLE_CAPABILITIES = deepFreeze(resolveAll(ORG_ROLE_GRANTS, ORG_ROLE_INHERITS))

/**
 * Capabilities granted by the platform-wide `User.role`, independent of any
 * organisation membership.
 *
 * `ORGANIZER` is deliberately empty. An organiser's authority comes entirely
 * from their memberships; granting anything here would apply to *every*
 * organisation on the platform, which is exactly the cross-tenant leak this
 * module exists to prevent.
 *
 * The three narrow staff roles exist so that the common platform jobs do not
 * need `SUPER_ADMIN`. A moderator cannot refund; a finance administrator
 * cannot approve an event; support can read an order and change nothing.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PLATFORM_ROLE_CAPABILITIES = deepFreeze({
  ATTENDEE: [],
  ORGANIZER: [],
  SUPPORT: [CAPABILITIES.SUPPORT_VIEW_ORDER, CAPABILITIES.ORDER_VIEW].sort(),
  MODERATOR: [
    CAPABILITIES.MODERATION_REVIEW,
    CAPABILITIES.EVENT_VIEW_DRAFT,
    CAPABILITIES.VENUE_MANAGE,
  ].sort(),
  FINANCE_ADMIN: [
    CAPABILITIES.FINANCE_VIEW,
    CAPABILITIES.ORDER_VIEW,
    CAPABILITIES.ORDER_REFUND,
    CAPABILITIES.ORDER_REFUND_APPROVE,
    CAPABILITIES.PAYOUT_MANAGE,
    CAPABILITIES.RECONCILIATION_MANAGE,
    CAPABILITIES.LEDGER_MANAGE,
    CAPABILITIES.SUPPORT_VIEW_ORDER,
  ].sort(),
  SUPER_ADMIN: [...ALL_CAPABILITIES],
})

// An organisation membership must never be able to grant platform-wide
// authority. Asserted at load rather than tested only, so a bad edit fails the
// process that imports it rather than one suite that might be skipped.
for (const [role, capabilities] of Object.entries(ORG_ROLE_CAPABILITIES)) {
  for (const capability of PLATFORM_ONLY_CAPABILITIES) {
    if (capabilities.includes(capability)) {
      throw new Error(
        `Organisation role "${role}" grants the platform-only capability "${capability}"`,
      )
    }
  }
}

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
 * Seniority, for display and tie-breaking. Not an authorization decision.
 *
 * @param {unknown} role The role name to rank.
 * @returns {number} The role's index, or `-1` if it is not a known org role.
 */
export function orgRoleRank(role) {
  return typeof role === 'string' ? ORG_ROLE_ORDER.indexOf(role) : -1
}

/**
 * Rank a platform role within {@link PLATFORM_ROLE_ORDER}.
 *
 * @param {unknown} role The role name to rank.
 * @returns {number} The role's index, or `-1` if it is not a known platform role.
 */
export function platformRoleRank(role) {
  return typeof role === 'string' ? PLATFORM_ROLE_ORDER.indexOf(role) : -1
}

/**
 * May an actor holding `assignerRole` hand out `targetRole`?
 *
 * The rule is capability containment, not seniority: you may only grant
 * authority you already hold. That closes self-escalation without depending on
 * a total order that no longer reflects how the roles relate — an EVENT_MANAGER
 * cannot mint a FINANCE user even though neither is "above" the other, because
 * FINANCE holds capabilities EVENT_MANAGER does not.
 *
 * OWNER is additionally special-cased: only an OWNER may create another, so a
 * MANAGER who happens to accumulate a wide capability set can never promote
 * themselves past the organisation's actual owner.
 *
 * @param {string} assignerRole The granting actor's organisation role.
 * @param {string} targetRole The role being granted.
 * @returns {boolean} `true` when the grant is permitted.
 */
export function canAssignOrgRole(assignerRole, targetRole) {
  const assignerCapabilities = ORG_ROLE_CAPABILITIES[assignerRole]
  const targetCapabilities = ORG_ROLE_CAPABILITIES[targetRole]

  if (!assignerCapabilities || !targetCapabilities) return false
  if (targetRole === 'OWNER') return assignerRole === 'OWNER'

  return targetCapabilities.every((capability) => assignerCapabilities.includes(capability))
}
