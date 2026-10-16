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
  /**
   * Delete an event nobody holds a paid order for. Held from EVENT_MANAGER up,
   * so whoever posts an event can take it down again. Deleting one with paid
   * orders refunds them, which is `event:delete` and `event:cancel` (ADMIN,
   * OWNER). Moves no money. In {@link EVENT_AUTHORITY_CAPABILITIES}, so no role
   * an owner may hand out ever holds it.
   */
  EVENT_DELETE_UNSOLD: 'event:delete_unsold',
  EVENT_VIEW_DRAFT: 'event:view_draft',
  /**
   * Edit any organisation's published event as the team at The Desi Events, in a
   * sitting opened with a reason and a second factor, every write audited with
   * both. Platform-only. Never a draft or a version under review.
   */
  EVENT_PLATFORM_EDIT: 'event:platform_edit',
  /**
   * Delete any organisation's event, cancel one of its nights, and restore a
   * deleted event. Where tickets were sold this refunds every affected order in
   * full to the payment it came from — no amount, recipient or order is chosen,
   * which is why it is not a money capability. Platform-only.
   */
  EVENT_PLATFORM_DELETE: 'event:platform_delete',
  /**
   * Bring events listed on another site onto The Desi Events: upload a file,
   * read its plan, import it (each listed price a ticket type), approve and
   * publish the imported events with their sales open (with
   * `moderation:review`) and move one to an organiser's own organisation.
   * Platform-only.
   */
  EVENT_IMPORT: 'event:import',

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
  /**
   * Withdraw one ticket.
   *
   * Separate from refunding, because it is a different decision: a revocation
   * stops a ticket admitting anybody and gives nothing back. Held by an
   * organisation's event managers, and not by a door scanner — somebody on a
   * gate must not be able to turn an awkward attendee's ticket off.
   */
  TICKET_REVOKE: 'ticket:revoke',

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
  /**
   * Submit the organisation for verification, and answer a moderator's question.
   *
   * Separate from `organization:manage`, which is the OWNER's grant over the
   * record itself. Verification is a conversation with the platform rather than
   * an edit to the organisation, and an ADMIN should be able to have it without
   * also being able to rename the company.
   */
  ORGANIZATION_SUBMIT_VERIFICATION: 'organization:submit_verification',
  ORGANIZATION_VIEW_MEMBERS: 'organization:view_members',

  // --- Promotions and reporting --------------------------------------------
  /**
   * List, make, pause, resume and delete the organisation's promo codes
   * (`/v1/organizations/:id/promo-codes`). A code is a bearer discount, not
   * report data, so it starts at EVENT_MANAGER and FINANCE does not hold it.
   */
  PROMO_MANAGE: 'promo:manage',
  REPORT_VIEW: 'report:view',
  /**
   * Read every event's visit counts and paid-order counts across all
   * organisations (`GET /v1/traffic/events`). Never money: the list carries
   * counts only, and an event's money stays behind `finance:view` and its
   * step-up on the per-organisation view.
   *
   * Platform-only. `report:view` is an organisation capability and cannot be
   * asserted without an organisation (NF-05), so a list spanning every
   * organisation needs a platform capability of its own. Held by ADMIN and by
   * SUPER_ADMIN through ALL_CAPABILITIES.
   */
  ANALYTICS_VIEW_ALL: 'analytics:view_all',

  // --- Personal data --------------------------------------------------------
  /**
   * Redact a person's personal data within one organisation, and read the
   * record of that request.
   *
   * Its own capability, and the narrowest one in this table, because it is the
   * only action here that cannot be undone. A refund can be reversed, an event
   * can be republished, a removed member can be invited back; a redacted name
   * is gone, and no key, backup column or hidden mapping brings it back.
   *
   * Deliberately not folded into `organization:manage`. That grant is routine
   * administration — the organisation record, its members, its settings — and
   * is held by people who should be able to rename the company without also
   * being able to destroy somebody's personal data irreversibly. Widening
   * `organization:manage` would have handed this authority to every existing
   * holder with no review and no migration.
   *
   * Equally not `platform:admin`, which is the key to everything: granting
   * redaction through it would make the decision unauditable as a distinct
   * one, and ungrantable narrowly.
   *
   * Organisation-scoped rather than platform-only, so every route asserting it
   * must name the organisation in the request — see `capabilityScope`. One
   * request never spans two organisations.
   */
  PRIVACY_REDACT: 'privacy:redact',

  // --- Platform scope -------------------------------------------------------
  /** Read a customer's order across tenants to answer a support request. */
  SUPPORT_VIEW_ORDER: 'support:view_order',
  /** Approve, reject or suspend events, venues and organisations. */
  MODERATION_REVIEW: 'moderation:review',
  /** Resolve reconciliation tasks. Requires step-up authentication as well. */
  RECONCILIATION_MANAGE: 'reconciliation:manage',
  /** Read and post ledger corrections. */
  LEDGER_MANAGE: 'ledger:manage',
  /**
   * Read what a retention rehearsal found.
   *
   * Read-only, and it grants nothing else: the retention rehearsal has no
   * deletion path for it to unlock, and the rows it reaches carry class names,
   * cut-offs and counts rather than anybody's data. (The one deletion on a
   * timer in this repository is the traffic roll-up's, of raw visit rows it
   * has already added up — `@desi-event/db/traffic-rollup` — and no capability
   * reaches it.)
   *
   * Its own capability rather than `platform:admin`, for the reason that one
   * already gives elsewhere in this table — an authority folded into the key to
   * everything is an authority that cannot be granted narrowly, and the person
   * who should read a retention rehearsal is a privacy or compliance reader
   * rather than somebody who should also be able to suspend an organisation.
   *
   * Platform-scoped because the thing it reads is: `RetentionSweep` has no
   * `organizationId`, and a sweep counts across every tenant at once. There is
   * deliberately no organisation-scoped version, because a per-tenant number
   * cannot be derived from a platform-wide count without asking a different
   * question of the database than the one the sweep asked.
   *
   * Held by the platform administrators: ADMIN, and SUPER_ADMIN through
   * `ALL_CAPABILITIES` (ADR 0018).
   */
  RETENTION_VIEW: 'retention:view',
  /**
   * Invite somebody to start an organisation here, and read, withdraw and
   * reissue those invitations.
   *
   * Platform-only: an organisation cannot vouch for itself, which is the whole
   * point of the invitation. Held by ADMIN and by SUPER_ADMIN through
   * ALL_CAPABILITIES.
   */
  ORGANIZER_INVITE: 'organizer:invite',
  /**
   * Turn an event's "Visit the organiser's website" link on or off, and read
   * the list of website links waiting for a decision.
   *
   * Platform-only, and deliberately not `moderation:review`: a moderator
   * decides whether a listing is fit to publish; whether the platform sends
   * its visitors to somebody else's site is a separate call, held by platform
   * administrators (ADMIN, and SUPER_ADMIN through ALL_CAPABILITIES).
   */
  WEBSITE_REDIRECT_MANAGE: 'website_redirect:manage',
  /**
   * Set an event's own booking fee (the platform fee) or return it to the site
   * default, and switch paying at the venue on or off with its limit on unpaid
   * places, in any status but DELETED (SPEC3 §3.1, §3.3).
   *
   * Platform-only: the fee is The Desi Events' revenue, and how a buyer may pay is
   * for the team at The Desi Events to decide, never an organiser. Held by ADMIN, and by
   * SUPER_ADMIN through ALL_CAPABILITIES (ADR 0016).
   */
  PAYMENT_TERMS_MANAGE: 'payment_terms:manage',
  /**
   * Make, change, switch on or off, list and report the referral codes that
   * waive an order's whole booking fee (SPEC3 §3.2).
   *
   * Platform-only: a code removes The Desi Events' own fee, and its text is shown
   * only to platform administrators. Held by ADMIN, and by SUPER_ADMIN through
   * ALL_CAPABILITIES (ADR 0016).
   */
  REFERRAL_CODE_MANAGE: 'referral_code:manage',
  /**
   * Refund what is left of one past order's booking fee, and the tax it
   * carried, by hand: request, approve and submit in one step, nothing else of
   * the order (SPEC3 §7.4, the owner's A4). It reads that one order's
   * booking-fee figures by reference to do so.
   *
   * Platform-only: the fee is The Desi Events' money, not an organiser's. Held by
   * ADMIN and FINANCE_ADMIN, and by SUPER_ADMIN through ALL_CAPABILITIES.
   */
  PLATFORM_FEE_REFUND: 'platform_fee:refund',
  /**
   * Cancel unpaid pay-at-the-venue tickets of any event's booking, keeping
   * their booking fee, and read the bookings waiting to be paid at the door
   * (SPEC3-XI XU2). Nothing is refunded and no money moves.
   *
   * Platform-only, and not `order:refund`: the organisation side of the same
   * decision is a membership granting `order:refund` (OWNER, ADMIN), checked
   * on the membership alone, so the platform side keeps its own name for it.
   * Held by ADMIN, and by SUPER_ADMIN through ALL_CAPABILITIES; not by
   * FINANCE_ADMIN, MODERATOR or SUPPORT.
   */
  VENUE_BOOKING_CANCEL: 'venue_booking:cancel',
  /**
   * Act on any organisation as the team at The Desi Events: the platform-wide
   * bypass of organisation membership. Held by ADMIN, and by SUPER_ADMIN
   * through ALL_CAPABILITIES (ADR 0018).
   */
  PLATFORM_ADMIN: 'platform:admin',
  /**
   * Change anybody's platform role (`platform.setUserRole`): make and revoke
   * administrators, super administrators and every narrower platform role.
   *
   * Platform-only, and the one thing a platform administrator (ADMIN) may not
   * do (ADR 0018): it is listed in {@link SUPER_ADMIN_ONLY_CAPABILITIES}, so
   * only SUPER_ADMIN holds it, through ALL_CAPABILITIES. The route also
   * re-reads the actor's role inside its transaction and refuses anybody who is
   * not an unsuspended SUPER_ADMIN, so this capability is not the only guard.
   */
  PLATFORM_ROLE_MANAGE: 'platform:role_manage',
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
  CAPABILITIES.RETENTION_VIEW,
  CAPABILITIES.ORGANIZER_INVITE,
  CAPABILITIES.WEBSITE_REDIRECT_MANAGE,
  CAPABILITIES.ANALYTICS_VIEW_ALL,
  CAPABILITIES.EVENT_PLATFORM_EDIT,
  CAPABILITIES.EVENT_PLATFORM_DELETE,
  CAPABILITIES.EVENT_IMPORT,
  CAPABILITIES.PAYMENT_TERMS_MANAGE,
  CAPABILITIES.REFERRAL_CODE_MANAGE,
  CAPABILITIES.PLATFORM_FEE_REFUND,
  CAPABILITIES.VENUE_BOOKING_CANCEL,
  CAPABILITIES.PLATFORM_ADMIN,
  CAPABILITIES.PLATFORM_ROLE_MANAGE,
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
 * Phase 1's single `ADMIN` became `SUPER_ADMIN`. The narrower roles exist so
 * that support, moderation, finance and platform administration work does not
 * require the key to everything. Today's `ADMIN` is the platform administrator
 * (see {@link PLATFORM_ADMINISTRATOR_CAPABILITIES}): everything SUPER_ADMIN
 * holds except changing platform roles (ADR 0018).
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ROLE_ORDER = deepFreeze([
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'ADMIN',
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
    CAPABILITIES.TICKET_REVOKE,
    // Take down an event nobody paid for. Deleting a sold one is ADMIN's.
    CAPABILITIES.EVENT_DELETE_UNSOLD,
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
    CAPABILITIES.ORGANIZATION_SUBMIT_VERIFICATION,
    CAPABILITIES.EVENT_DELETE,
    CAPABILITIES.ORDER_REFUND,
    CAPABILITIES.ORDER_REFUND_APPROVE,
    CAPABILITIES.HOLD_RELEASE_ANY,
    CAPABILITIES.TEAM_REMOVE,
    CAPABILITIES.TEAM_ROLE_MANAGE,
  ],
  // Owns the organisation record itself, including its membership list, and is
  // the only organisation role that may destroy a person's personal data. The
  // narrowest grant available: OWNER inherits ADMIN, so granting here and
  // nowhere else means exactly one role holds it.
  OWNER: [CAPABILITIES.ORGANIZATION_MANAGE, CAPABILITIES.PRIVACY_REDACT],
}

/**
 * Find a cycle in an inheritance graph, or prove there is none.
 *
 * Finding NF-13 recorded the acyclicity check as inadequate. That was half
 * right, and the half that was wrong is worth stating: `resolveRole` below
 * already refuses a cycle, on a per-path basis, so a cyclic graph could never
 * have loaded. What did not exist was a check that could be *reused* — by a
 * test, by a future role editor, by anything that wants to know before trying —
 * and the test that claimed to prove acyclicity only rejected directly
 * reciprocal edges, so a three-role cycle would have passed it while failing at
 * import time, which is a confusing way to learn about a mistake.
 *
 * Depth-first with an explicit path, so a diamond is not mistaken for a cycle:
 * `ADMIN` inherits `MANAGER` and `FINANCE`, both of which reach `VIEWER`, and
 * visiting `VIEWER` twice by different routes is correct inheritance rather than
 * a loop. Only a role that appears *on the current path* is a cycle.
 *
 * @param {Record<string, ReadonlyArray<string>>} inherits Inheritance edges.
 * @returns {string[]|null} The cycle as a path that starts and ends at the same role, or null.
 */
export function findRoleCycle(inherits) {
  /** Roles fully explored, with no cycle beneath them. */
  const settled = new Set()

  /**
   * Walk one role.
   *
   * @param {string} role Where to start.
   * @param {string[]} path The roles on the current path, in order.
   * @returns {string[]|null} The cycle, or null.
   */
  function walk(role, path) {
    const at = path.indexOf(role)

    // On the path already: everything from that point back to here is the cycle,
    // and returning the slice rather than a boolean is what makes the error
    // message name the loop instead of one arbitrary member of it.
    if (at !== -1) return [...path.slice(at), role]

    if (settled.has(role)) return null

    const next = [...path, role]

    for (const parent of inherits[role] ?? []) {
      const cycle = walk(parent, next)

      if (cycle) return cycle
    }

    settled.add(role)

    return null
  }

  for (const role of Object.keys(inherits)) {
    const cycle = walk(role, [])

    if (cycle) return cycle
  }

  return null
}

/**
 * Throw when an inheritance graph has a cycle.
 *
 * @param {Record<string, ReadonlyArray<string>>} inherits Inheritance edges.
 * @returns {Record<string, ReadonlyArray<string>>} The same graph, when it is acyclic.
 * @throws {Error} Naming the whole cycle, not one role on it.
 */
export function assertAcyclic(inherits) {
  const cycle = findRoleCycle(inherits)

  if (cycle) {
    throw new Error(`Role inheritance cycle: ${cycle.join(' -> ')}`)
  }

  return inherits
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
  // Before walking anything. `resolveRole` would also catch a cycle, but only
  // the first one it happened to reach and only by the role it re-entered;
  // checking the whole graph first means the error names the loop.
  assertAcyclic(inherits)

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
 * The capabilities only SUPER_ADMIN holds: the platform administrator (`ADMIN`)
 * holds every capability except these (ADR 0018, the owner's decision of
 * 2026-10-16: "Admin should be able to do all super admin has access. Only
 * difference is that Super Admin can create, revoke the admin and all other").
 *
 * Today that is changing platform roles (`platform:role_manage`) and nothing
 * else. A capability added later that should also stay with SUPER_ADMIN must
 * be listed here on purpose: {@link assertPlatformAdministratorBounds} holds
 * ADMIN to exactly "everything but this list", so a new capability reaches
 * ADMIN unless somebody decides otherwise here.
 *
 * @type {ReadonlyArray<string>}
 */
export const SUPER_ADMIN_ONLY_CAPABILITIES = deepFreeze([CAPABILITIES.PLATFORM_ROLE_MANAGE].sort())

const SUPER_ADMIN_ONLY_LOOKUP = new Set(SUPER_ADMIN_ONLY_CAPABILITIES)

/**
 * Everything the platform administrator (`ADMIN`) holds, and nothing else:
 * {@link ALL_CAPABILITIES} minus {@link SUPER_ADMIN_ONLY_CAPABILITIES}.
 *
 * Under the owner's hierarchy (super admin > admin > organizer > organizer
 * manager > organizer staff > user, ADR 0018) the platform administrator does
 * everything a super administrator does except make, change or revoke anybody's
 * platform role. So ADMIN holds `platform:admin`, the bypass of organisation
 * membership: it may publish, cancel, refund and edit any organisation's event,
 * move an organiser's money, read every report with its money, admit people at
 * any door on platform authority (ADR 0007, amended by ADR 0018), grant
 * organisation memberships and merge venues.
 *
 * This supersedes in part ADR 0007 (SUPER_ADMIN was the only platform door
 * role) and ADR 0010 (ADMIN reviewed events and could post none of its own).
 * The review gate still holds for organisers; a platform administrator acting
 * on platform authority is the team at The Desi Events, as SUPER_ADMIN always
 * was. What keeps ADMIN below SUPER_ADMIN is `platform:role_manage`, the
 * in-transaction database re-check on `platform.setUserRole`, and the
 * last-super-admin guard.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLATFORM_ADMINISTRATOR_CAPABILITIES = deepFreeze(
  ALL_CAPABILITIES.filter((capability) => !SUPER_ADMIN_ONLY_LOOKUP.has(capability)),
)

/**
 * Capabilities granted by the platform-wide `User.role`, independent of any
 * organisation membership.
 *
 * `ORGANIZER` is deliberately empty. An organiser's authority comes entirely
 * from their memberships; granting anything here would apply to *every*
 * organisation on the platform, which is exactly the cross-tenant leak this
 * module exists to prevent.
 *
 * The narrow staff roles exist so that the common platform jobs do not need
 * `SUPER_ADMIN`. A moderator cannot refund; a finance administrator cannot
 * approve an event; support can read an order and change nothing; a platform
 * administrator does everything SUPER_ADMIN does except change anybody's
 * platform role (ADR 0018). MODERATOR, SUPPORT and FINANCE_ADMIN hold none of
 * the three platform event capabilities (`event:platform_edit`,
 * `event:platform_delete`, `event:import`), and none of `payment_terms:manage`,
 * `referral_code:manage` or `venue_booking:cancel`; FINANCE_ADMIN refunds one
 * order's booking fee by hand (`platform_fee:refund`), as ADMIN does.
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
    CAPABILITIES.PLATFORM_FEE_REFUND,
  ].sort(),
  ADMIN: [...PLATFORM_ADMINISTRATOR_CAPABILITIES],
  SUPER_ADMIN: [...ALL_CAPABILITIES],
})

/**
 * Throw unless the platform administrator's capabilities are exactly
 * {@link PLATFORM_ADMINISTRATOR_CAPABILITIES} (every capability but
 * {@link SUPER_ADMIN_ONLY_CAPABILITIES}): nothing missing, nothing extra, and
 * none of the super-admin-only capabilities in particular.
 *
 * An equality rather than a check for a few forbidden names, so a capability
 * that should stay with SUPER_ADMIN has to be listed in
 * SUPER_ADMIN_ONLY_CAPABILITIES on purpose, and a table that hands ADMIN
 * `platform:role_manage` fails the process that loads it. It also requires
 * SUPER_ADMIN to hold every super-admin-only capability, so the role that can
 * change platform roles never disappears from the table.
 *
 * @param {Record<string, ReadonlyArray<string>>} table A platform role table.
 * @returns {Record<string, ReadonlyArray<string>>} The same table, when it holds.
 * @throws {Error} Naming what is extra and what is missing.
 */
export function assertPlatformAdministratorBounds(table) {
  const held = new Set(table?.ADMIN ?? [])
  const forbidden = SUPER_ADMIN_ONLY_CAPABILITIES.filter((capability) => held.has(capability))

  if (forbidden.length > 0) {
    throw new Error(
      `The platform administrator (ADMIN) must never hold a super-admin-only capability; it holds ${forbidden.join(', ')}`,
    )
  }

  const allowed = new Set(PLATFORM_ADMINISTRATOR_CAPABILITIES)
  const extra = [...held].filter((capability) => !allowed.has(capability)).sort()
  const missing = [...allowed].filter((capability) => !held.has(capability)).sort()

  if (extra.length > 0 || missing.length > 0) {
    throw new Error(
      'The platform administrator (ADMIN) must hold exactly PLATFORM_ADMINISTRATOR_CAPABILITIES' +
        `${extra.length ? `; it also holds ${extra.join(', ')}` : ''}` +
        `${missing.length ? `; it lacks ${missing.join(', ')}` : ''}`,
    )
  }

  const superHeld = new Set(table?.SUPER_ADMIN ?? [])
  const superMissing = SUPER_ADMIN_ONLY_CAPABILITIES.filter(
    (capability) => !superHeld.has(capability),
  )

  if (superMissing.length > 0) {
    throw new Error(
      `SUPER_ADMIN must hold every super-admin-only capability; it lacks ${superMissing.join(', ')}`,
    )
  }

  return table
}

assertPlatformAdministratorBounds(PLATFORM_ROLE_CAPABILITIES)

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

/**
 * The capabilities that create or publish events.
 *
 * Holding one of them is what "posts events" means. The Desi Events team
 * decides who does: an organiser invitation makes somebody the owner of a new
 * organisation, and a super administrator may grant any role directly. An
 * organisation cannot hand one of these to somebody new on its own.
 *
 * @type {ReadonlyArray<string>}
 */
export const EVENT_POSTING_CAPABILITIES = deepFreeze([
  CAPABILITIES.EVENT_CREATE,
  CAPABILITIES.EVENT_UPDATE,
  CAPABILITIES.EVENT_SUBMIT_REVIEW,
  CAPABILITIES.EVENT_PUBLISH,
])

/**
 * Everything that shapes an event or what it sells: posting, plus pausing,
 * cancelling and deleting, tiers, inventory, venues, seating and promo codes.
 *
 * No role an owner may hand out holds any of these, so an owner-issued role can
 * read, scan, staff the door or handle money, and cannot change an event.
 *
 * @type {ReadonlyArray<string>}
 */
export const EVENT_AUTHORITY_CAPABILITIES = deepFreeze([
  ...EVENT_POSTING_CAPABILITIES,
  CAPABILITIES.EVENT_PAUSE_SALES,
  CAPABILITIES.EVENT_CANCEL,
  CAPABILITIES.EVENT_DELETE,
  CAPABILITIES.EVENT_DELETE_UNSOLD,
  CAPABILITIES.TICKET_TYPE_MANAGE,
  CAPABILITIES.INVENTORY_MANAGE,
  CAPABILITIES.VENUE_MANAGE,
  CAPABILITIES.VENUE_MAP_MANAGE,
  CAPABILITIES.PROMO_MANAGE,
])

/**
 * The organisation roles that post events, in {@link ORG_ROLE_ORDER} order.
 *
 * Derived from the role table rather than listed, so a grant that gave another
 * role a posting capability would move it here — and then fail
 * {@link assertPostingPolicy}, which pins the other half.
 *
 * @type {ReadonlyArray<string>}
 */
export const EVENT_POSTING_ORG_ROLES = deepFreeze(
  ORG_ROLE_ORDER.filter((role) =>
    ORG_ROLE_CAPABILITIES[role].some((capability) =>
      EVENT_POSTING_CAPABILITIES.includes(capability),
    ),
  ),
)

/**
 * The organisation roles an owner may give somebody new: the ones that do not
 * post events, in {@link ORG_ROLE_ORDER} order.
 *
 * @type {ReadonlyArray<string>}
 */
export const OWNER_GRANTABLE_ORG_ROLES = deepFreeze(
  ORG_ROLE_ORDER.filter((role) => !EVENT_POSTING_ORG_ROLES.includes(role)),
)

/**
 * Whether an organisation role creates or publishes events.
 *
 * @param {unknown} role An `OrgRole`.
 * @returns {boolean} True for EVENT_MANAGER, MANAGER, ADMIN and OWNER.
 */
export function postsEvents(role) {
  return typeof role === 'string' && EVENT_POSTING_ORG_ROLES.includes(role)
}

/**
 * Throw unless the organisation role table keeps event authority away from the
 * roles an owner may hand out.
 *
 * Three rules. The owner-grantable roles are exactly FINANCE, SCANNER, STAFF and
 * VIEWER, so a role-table change must also change this on purpose. None of them
 * holds any of {@link EVENT_AUTHORITY_CAPABILITIES}: a future grant of
 * `promo:manage` to FINANCE, say, fails every process rather than quietly
 * widening what owners can give. And OWNER posts events.
 *
 * @param {Record<string, ReadonlyArray<string>>} [table] An organisation role table.
 * @returns {Record<string, ReadonlyArray<string>>} The same table, when it holds.
 * @throws {Error} Naming the rule broken.
 */
export function assertPostingPolicy(table = ORG_ROLE_CAPABILITIES) {
  const posts = (role) =>
    (table[role] ?? []).some((capability) => EVENT_POSTING_CAPABILITIES.includes(capability))
  const grantable = Object.keys(table)
    .filter((role) => !posts(role))
    .sort()

  if (JSON.stringify(grantable) !== JSON.stringify(['FINANCE', 'SCANNER', 'STAFF', 'VIEWER'])) {
    throw new Error(
      `The roles that do not post events must be FINANCE, SCANNER, STAFF and VIEWER; they are ${grantable.join(', ')}`,
    )
  }

  for (const role of grantable) {
    const authority = (table[role] ?? []).filter((capability) =>
      EVENT_AUTHORITY_CAPABILITIES.includes(capability),
    )

    if (authority.length > 0) {
      throw new Error(
        `The owner-grantable role "${role}" holds event authority: ${authority.join(', ')}`,
      )
    }
  }

  if (!posts('OWNER')) throw new Error('OWNER must post events')

  return table
}

assertPostingPolicy(ORG_ROLE_CAPABILITIES)

/**
 * May a member holding `assignerRole` give somebody new `targetRole`, by a team
 * invitation?
 *
 * {@link canAssignOrgRole}, and the role must not post events: those are given
 * by the team at The Desi Events.
 *
 * @param {string} assignerRole The granting member's role.
 * @param {string} targetRole The role offered.
 * @returns {boolean} True when the invitation may offer it.
 */
export function canIssueOrgRole(assignerRole, targetRole) {
  return canAssignOrgRole(assignerRole, targetRole) && !postsEvents(targetRole)
}

/**
 * May a member holding `assignerRole` move a member from `fromRole` to `toRole`?
 *
 * Never to OWNER (ownership is handed over, not assigned), only to a role the
 * assigner could grant ({@link canAssignOrgRole}), and a move to a role that
 * posts events only downwards: the member must already post events, and the new
 * role's capabilities must be a subset of the old one's. An upward move to a
 * posting role, or any move that makes a non-poster a poster, is for the team
 * at The Desi Events to make.
 *
 * @param {string} assignerRole The acting member's role.
 * @param {string} fromRole The member's current role.
 * @param {string} toRole The role asked for.
 * @returns {boolean} True when the move is allowed.
 */
export function canMoveOrgRole(assignerRole, fromRole, toRole) {
  if (toRole === 'OWNER') return false
  if (!canAssignOrgRole(assignerRole, toRole)) return false
  if (!postsEvents(toRole)) return true
  if (!postsEvents(fromRole)) return false

  const from = ORG_ROLE_CAPABILITIES[fromRole] ?? []

  return (ORG_ROLE_CAPABILITIES[toRole] ?? []).every((capability) => from.includes(capability))
}
