/**
 * The event lifecycle, as a graph rather than a column.
 *
 * An event's status is not a field somebody sets. Every value in it is a claim
 * that somebody is entitled to make, and the entitlements differ:
 *
 *   - `APPROVED` says *a moderator looked at this*. An organiser asserting it
 *     about their own event is forging a decision.
 *   - `PUBLISHED` says *a verified organiser chose to go live*. It is the point
 *     after which the listing exists for strangers.
 *   - `ON_SALE` says *money may now change hands*.
 *   - `CANCELLED` says *refunds are owed*, which is a financial claim with a
 *     bill attached.
 *
 * Findings NF-17 and NF-18 were both the same mistake: a route that wrote the
 * column from a request body, which let the caller assert any of the above
 * about themselves. This module is the answer — one table naming every legal
 * move, who may make it, and what must be true first.
 *
 * ## Why this lives in `@desi-event/schemas` and not in the API
 *
 * The organiser's screen has to grey out the buttons that would fail, and it
 * cannot do that by asking the server after every keystroke. So the table has
 * to reach the browser. That makes it, unavoidably, public knowledge — which is
 * fine, and worth being explicit about: **this table is not a security
 * boundary.** It says which moves exist. The server decides whether *you* may
 * make one, using the capability and verification checks in
 * `apps/api/src/lib/event-lifecycle.js`, and it re-derives everything here
 * rather than trusting a client that claims to have checked.
 *
 * Imported as `@desi-event/schemas/lifecycle`, a subpath, so the browser does
 * not take the schemas barrel and the deployment contract behind it. That is
 * finding NF-16 applied rather than repeated.
 *
 * @module @desi-event/schemas/lifecycle
 */

import { PUBLIC_EVENT_STATUSES } from './enums.js'

/**
 * Who is entitled to make a move.
 *
 * `system` is not a person: it is a move only the platform makes on its own,
 * such as a session selling out or an event's end time passing. No route
 * exposes a `system` transition to a caller.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ACTORS = Object.freeze({
  ORGANIZER: 'organizer',
  MODERATOR: 'moderator',
  SYSTEM: 'system',
})

/**
 * Preconditions a transition can demand, beyond who is asking.
 *
 * Each is a name here and a function in the service. Keeping them as names
 * means the browser can say *why* a button is disabled without being able to
 * decide that it is not.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GATES = Object.freeze({
  /** The organisation must be verified and not suspended. */
  VERIFIED_ORGANIZER: 'verified_organizer',
  /** Every field, session, ticket type and policy publication needs. */
  PUBLISHABLE: 'publishable',
  /** At least one ticket type ready to sell. */
  SELLABLE: 'sellable',
  /** Inventory rows exist for every session that needs them. */
  INVENTORY_PREPARED: 'inventory_prepared',
})

/**
 * Every legal move, keyed by the status being left.
 *
 * A move absent from this table does not exist. There is no default, no
 * fall-through and no wildcard, because the failure mode being designed against
 * is exactly a status that can become anything.
 *
 * @type {Readonly<Record<string, ReadonlyArray<object>>>}
 */
export const TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze([
    Object.freeze({ to: 'REVIEW_PENDING', actor: ACTORS.ORGANIZER, gates: [GATES.PUBLISHABLE] }),
    Object.freeze({ to: 'ARCHIVED', actor: ACTORS.ORGANIZER, gates: [] }),
  ]),

  REVIEW_PENDING: Object.freeze([
    Object.freeze({ to: 'CHANGES_REQUIRED', actor: ACTORS.MODERATOR, gates: [] }),
    Object.freeze({ to: 'APPROVED', actor: ACTORS.MODERATOR, gates: [] }),
    Object.freeze({ to: 'REJECTED', actor: ACTORS.MODERATOR, gates: [] }),
    // An organiser may pull a submission back while nobody has ruled on it.
    Object.freeze({ to: 'DRAFT', actor: ACTORS.ORGANIZER, gates: [] }),
  ]),

  CHANGES_REQUIRED: Object.freeze([
    Object.freeze({ to: 'REVIEW_PENDING', actor: ACTORS.ORGANIZER, gates: [GATES.PUBLISHABLE] }),
    Object.freeze({ to: 'ARCHIVED', actor: ACTORS.ORGANIZER, gates: [] }),
  ]),

  APPROVED: Object.freeze([
    Object.freeze({
      to: 'PUBLISHED',
      actor: ACTORS.ORGANIZER,
      gates: [GATES.VERIFIED_ORGANIZER, GATES.PUBLISHABLE, GATES.INVENTORY_PREPARED],
    }),
    // A moderator can withdraw an approval it has second thoughts about, as
    // long as nothing has been published on the strength of it.
    Object.freeze({ to: 'CHANGES_REQUIRED', actor: ACTORS.MODERATOR, gates: [] }),
    Object.freeze({ to: 'REJECTED', actor: ACTORS.MODERATOR, gates: [] }),
  ]),

  PUBLISHED: Object.freeze([
    Object.freeze({
      to: 'ON_SALE',
      actor: ACTORS.ORGANIZER,
      gates: [GATES.VERIFIED_ORGANIZER, GATES.SELLABLE, GATES.INVENTORY_PREPARED],
    }),
    Object.freeze({ to: 'POSTPONED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'CANCELLED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'COMPLETED', actor: ACTORS.SYSTEM, gates: [] }),
  ]),

  ON_SALE: Object.freeze([
    Object.freeze({ to: 'SALES_PAUSED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'SOLD_OUT', actor: ACTORS.SYSTEM, gates: [] }),
    Object.freeze({ to: 'POSTPONED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'CANCELLED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'COMPLETED', actor: ACTORS.SYSTEM, gates: [] }),
  ]),

  SALES_PAUSED: Object.freeze([
    Object.freeze({
      to: 'ON_SALE',
      actor: ACTORS.ORGANIZER,
      gates: [GATES.VERIFIED_ORGANIZER, GATES.SELLABLE],
    }),
    Object.freeze({ to: 'POSTPONED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'CANCELLED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'COMPLETED', actor: ACTORS.SYSTEM, gates: [] }),
  ]),

  SOLD_OUT: Object.freeze([
    // Stock can come back: a release of held seats, a cancelled order.
    Object.freeze({ to: 'ON_SALE', actor: ACTORS.SYSTEM, gates: [] }),
    Object.freeze({ to: 'SALES_PAUSED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'POSTPONED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'CANCELLED', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'COMPLETED', actor: ACTORS.SYSTEM, gates: [] }),
  ]),

  POSTPONED: Object.freeze([
    // A new date returns it to sale; the organiser sets the date in the same
    // command, so there is no window where it is live with the old one.
    Object.freeze({
      to: 'ON_SALE',
      actor: ACTORS.ORGANIZER,
      gates: [GATES.VERIFIED_ORGANIZER, GATES.SELLABLE],
    }),
    Object.freeze({ to: 'PUBLISHED', actor: ACTORS.ORGANIZER, gates: [GATES.VERIFIED_ORGANIZER] }),
    Object.freeze({ to: 'CANCELLED', actor: ACTORS.ORGANIZER, gates: [] }),
  ]),

  REJECTED: Object.freeze([
    // Rejection is not the end: the organiser may rework it.
    Object.freeze({ to: 'DRAFT', actor: ACTORS.ORGANIZER, gates: [] }),
    Object.freeze({ to: 'ARCHIVED', actor: ACTORS.ORGANIZER, gates: [] }),
  ]),

  COMPLETED: Object.freeze([Object.freeze({ to: 'ARCHIVED', actor: ACTORS.ORGANIZER, gates: [] })]),

  // Terminal. A cancelled event owes refunds and an archived one is filed;
  // neither comes back, because "it was cancelled and then it was not" is not a
  // thing an attendee who has been refunded can be told.
  CANCELLED: Object.freeze([]),
  ARCHIVED: Object.freeze([]),
})

/**
 * Statuses that appear in a listing, and in the sitemap.
 *
 * This is `PUBLIC_EVENT_STATUSES` from `./enums.js`, not a second copy of it.
 * Two lists of "what is public" is exactly the shape of the bug this module
 * exists to prevent, so the answer is derived rather than retyped.
 *
 * @type {ReadonlySet<string>}
 */
export const INDEXABLE_STATUSES = Object.freeze(new Set(PUBLIC_EVENT_STATUSES))

/**
 * Statuses whose own page a stranger may open.
 *
 * Wider than {@link INDEXABLE_STATUSES}, and the difference is deliberate:
 * *appearing in a listing* and *resolving at a URL* are different questions.
 *
 * A cancelled, postponed or finished event must still resolve. Somebody holding
 * a ticket for it needs the page to say what happened, and a 404 leaves them
 * with no way to find out. But none of the three belongs in a "what is on"
 * listing or in a sitemap: asking a search engine to keep a cancelled show
 * fresh is asking for the wrong thing to be indexed.
 *
 * Everything else — `DRAFT`, `REVIEW_PENDING`, `CHANGES_REQUIRED`, `APPROVED`,
 * `REJECTED`, `ARCHIVED` — is unfinished or somebody's private business, and
 * must appear in no listing, no sitemap, no metadata, no structured data and no
 * anonymous API response. That was finding NF-19.
 *
 * @type {ReadonlySet<string>}
 */
export const PUBLICLY_VISIBLE_STATUSES = Object.freeze(
  new Set([...PUBLIC_EVENT_STATUSES, 'COMPLETED', 'POSTPONED', 'CANCELLED']),
)

/**
 * Statuses in which tickets may be bought.
 *
 * @type {ReadonlySet<string>}
 */
export const SELLING_STATUSES = Object.freeze(new Set(['ON_SALE']))

/**
 * Statuses in which the sale paths — a hold, a seat hold, an order — take a
 * booking. Each tier's own sales window still decides after this.
 *
 * `ON_SALE`, because that is what the status means. Until Phase 4 no sale path
 * read {@link SELLING_STATUSES}: holds, seat holds and orders each compared the
 * column with the literal `'PUBLISHED'`, written before this lifecycle existed,
 * so an organiser who pressed "Open sales" moved the event into the one public
 * state in which nobody could buy a ticket.
 *
 * `PUBLISHED` as well, because every event published before the lifecycle, and
 * every event this repository seeds, sells in that state, and taking that away
 * is a product decision rather than a bug fix. `SALES_PAUSED` and `SOLD_OUT`
 * are not here: a pause is an organiser's instruction to stop.
 *
 * @type {ReadonlySet<string>}
 */
export const BOOKABLE_STATUSES = Object.freeze(new Set(['PUBLISHED', ...SELLING_STATUSES]))

/**
 * Statuses an organiser may still edit the content of.
 *
 * After publication a material change needs a confirmation step rather than a
 * refusal, because a typo in a description should not require a new event; that
 * decision lives in the service, which knows what "material" means.
 *
 * @type {ReadonlySet<string>}
 */
export const EDITABLE_STATUSES = Object.freeze(new Set(['DRAFT', 'CHANGES_REQUIRED']))

/**
 * Fields whose change after publication is material enough to need confirming.
 *
 * Somebody has bought a ticket on the strength of these. Changing the
 * description is housekeeping; changing the date, the venue or the refund
 * policy is changing the deal.
 *
 * @type {ReadonlyArray<string>}
 */
export const MATERIAL_FIELDS = Object.freeze([
  'startsAt',
  'endsAt',
  'timezone',
  'venueId',
  'policies',
  'ageRestriction',
  'isOnline',
  'onlineUrl',
])

/**
 * The moves available from a status, optionally narrowed to one kind of actor.
 *
 * @param {string} from The current status.
 * @param {string} [actor] One of {@link ACTORS}. Omit for every move.
 * @returns {ReadonlyArray<object>} The legal moves. Empty for a terminal or unknown status.
 */
export function transitionsFrom(from, actor) {
  const moves = TRANSITIONS[from] ?? []

  return actor ? moves.filter((move) => move.actor === actor) : moves
}

/**
 * The move from one status to another, if it exists.
 *
 * @param {string} from The current status.
 * @param {string} to The proposed status.
 * @returns {object|null} The move, or null when there is no such move.
 */
export function findTransition(from, to) {
  return (TRANSITIONS[from] ?? []).find((move) => move.to === to) ?? null
}

/**
 * Whether a move exists at all, ignoring who is asking.
 *
 * @param {string} from The current status.
 * @param {string} to The proposed status.
 * @returns {boolean} True when the move is in the table.
 */
export function canTransition(from, to) {
  return findTransition(from, to) !== null
}

/**
 * Whether an event in this status is visible to a stranger.
 *
 * @param {string} status The status.
 * @returns {boolean} True when anonymous callers may see it.
 */
export function isPubliclyVisible(status) {
  return PUBLICLY_VISIBLE_STATUSES.has(status)
}

/**
 * Whether an event in this status belongs in the sitemap.
 *
 * @param {string} status The status.
 * @returns {boolean} True when it should be indexed.
 */
export function isIndexable(status) {
  return INDEXABLE_STATUSES.has(status)
}

/**
 * Which of a set of changes are material enough to need confirmation.
 *
 * @param {object} changes The fields being changed.
 * @returns {string[]} The material field names present, in declaration order.
 */
export function materialChanges(changes) {
  if (!changes || typeof changes !== 'object') return []

  return MATERIAL_FIELDS.filter((field) => Object.hasOwn(changes, field))
}
