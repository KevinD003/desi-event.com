/**
 * Event discovery and organiser event management.
 *
 * @module @desi-event/api/routes/events
 */

import { salesWindowState } from '@desi-event/inventory'
import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import { INDEXABLE_STATUSES, PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { organizationsWhere } from '../lib/actor.js'
import { maySeeDrafts } from '../lib/event-insiders.js'
import {
  availableTransitions,
  capabilityFor,
  loadForTransition,
  transitionEvent,
} from '../lib/event-lifecycle.js'
import {
  AUTHORING_MODES,
  assertAuthorable,
  authorChange,
  changedFields,
  contentOnlyMessage,
  endTimeListedAfter,
  sessionProblems,
} from '../lib/event-authoring.js'
import { authorityAuditMetadata, byPlatform, lifecycleAuthority } from '../lib/event-authority.js'
import { EVENT_MEDIA_INCLUDE } from '../lib/event-media.js'
import { cancellationTransactionOptions, cancellationWork } from '../lib/event-cancellation.js'
import {
  classifyChanges,
  describeFields,
  materialChangeWork,
  refuseUnconfirmed,
} from '../lib/event-material-change.js'
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { conflict, httpError, notFound, unprocessable } from '../lib/errors.js'
import { disambiguateSlug, slugify } from '../lib/identifiers.js'
import { equalsIgnoringCase, likeLiteral } from '../lib/like-pattern.js'
import {
  EVENT_SUMMARY_SELECT,
  IMPORTED_FROM_SELECT,
  isPublicTier,
  toEventDetail,
  toEventSummary,
} from '../lib/presenters.js'
import { eventFeeConfig } from '../lib/checkout-pricing.js'
import { eventPaymentTerms } from '../lib/payment-terms.js'
import { loadEventFacets } from '../lib/facets.js'
import {
  WEBSITE_REDIRECT_INCLUDE,
  applyWebsiteChange,
  websiteColumnsFor,
  websiteViewFor,
} from '../lib/website-redirect.js'
import { defineRoute } from '../lib/register.js'

/**
 * Relations every event detail carries: its approved pictures included. The
 * presenter filters them again, and only a public event shows any.
 */
const EVENT_INCLUDE = Object.freeze({
  venue: true,
  organization: true,
  ticketTypes: true,
  // The nights. The presenter sorts them; the list include stays lean.
  sessions: { orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }] },
  ...EVENT_MEDIA_INCLUDE,
  // Who last decided the website link, for the switch's state an insider reads.
  ...WEBSITE_REDIRECT_INCLUDE,
  // Who deleted it, for a deleted event's record (named only to those allowed).
  deletedBy: { select: { displayName: true } },
  // Where an imported event is listed and its prices there (SPEC2-XI §5.I-E).
  importItem: IMPORTED_FROM_SELECT,
})

/**
 * Whether a reader is on the team at The Desi Events, for what a deleted event's
 * record names.
 *
 * @param {object|null} actor The request actor.
 * @returns {boolean} True for a moderator or a platform administrator.
 */
function platformReader(actor) {
  return (
    can(actor, CAPABILITIES.MODERATION_REVIEW) ||
    can(actor, CAPABILITIES.PLATFORM_ADMIN) ||
    can(actor, CAPABILITIES.EVENT_PLATFORM_EDIT)
  )
}

/**
 * Whether a tier is inside its own sales window now.
 *
 * @param {object} tier A `TicketType` row.
 * @param {Date} now The moment.
 * @returns {boolean} True when a hold would pass the tier's window check.
 */
function tierSellingNow(tier, now) {
  try {
    return (
      salesWindowState({
        status: tier.status,
        salesStartAt: tier.salesStartAt ?? null,
        salesEndAt: tier.salesEndAt ?? null,
        now,
      }) === 'ON_SALE'
    )
  } catch {
    return false
  }
}

/**
 * How many seats a buyer could take now: per night with a seat map, and per
 * reserved tier.
 *
 * A night's count follows the seat map's own rule for a stranger: a free seat
 * sold under a tier of this event that a stranger may buy — not a draft, not
 * hidden — and that is inside its sales window now. Counting every free seat
 * bound to any tier offered "Choose seats" on a night whose only tiers were
 * drafts or a guest list, and told strangers how many seats the guest list
 * held.
 *
 * A reserved tier's count is its own free seats, the figure
 * `ticketTypes.listForEvent` gives, and only for the tiers this reader is
 * shown. Each zone sells out on its own, so a sold-out zone is never read off
 * another zone's seats.
 *
 * Counts, never lists, and a read: a seat taken a moment later is the seat
 * picker's to report.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} event The event, with `ticketTypes` and `sessions`.
 * @param {object} options Options.
 * @param {boolean} options.insider Whether the reader is shown draft and hidden tiers.
 * @param {Date} options.now The moment.
 * @returns {Promise<{bySession: Map<string, number>, byTier: Map<string, number>}>} The counts.
 */
async function reservedSeatAvailability(prisma, event, { insider, now }) {
  const tiers = event.ticketTypes ?? []
  const seated = (event.sessions ?? []).filter((session) => session.venueMapVersionId)
  const seatedIds = new Set(seated.map((session) => session.id))
  const sellable = tiers
    .filter((tier) => tier.status !== 'DRAFT' && isPublicTier(tier) && tierSellingNow(tier, now))
    .map((tier) => tier.id)

  const bySession = new Map(
    await Promise.all(
      seated.map(async (session) => [
        session.id,
        sellable.length === 0
          ? 0
          : await prisma.eventSeat.count({
              where: {
                eventSessionId: session.id,
                status: 'AVAILABLE',
                ticketTypeId: { in: sellable },
              },
            }),
      ]),
    ),
  )

  const shown = tiers.filter(
    (tier) =>
      tier.reserved &&
      seatedIds.has(tier.eventSessionId) &&
      (insider || (tier.status !== 'DRAFT' && isPublicTier(tier))),
  )
  const byTier = new Map(
    await Promise.all(
      shown.map(async (tier) => [
        tier.id,
        await prisma.eventSeat.count({
          where: {
            eventSessionId: tier.eventSessionId,
            ticketTypeId: tier.id,
            status: 'AVAILABLE',
          },
        }),
      ]),
    ),
  )

  return { bySession, byTier }
}

/** Query `sort` value to a Prisma `orderBy`. */
const ORDER_BY = Object.freeze({
  'startsAt:asc': [{ startsAt: 'asc' }, { id: 'asc' }],
  'startsAt:desc': [{ startsAt: 'desc' }, { id: 'asc' }],
  'createdAt:desc': [{ createdAt: 'desc' }, { id: 'asc' }],
  'title:asc': [{ title: 'asc' }, { id: 'asc' }],
})

/**
 * The Prisma filter describing which events this caller may see at all.
 *
 * Draft visibility is a permission question, so it is answered by
 * `@desi-event/permissions` and then *translated* into a filter: the caller's
 * organisations are collected once and become an `organizationId IN (...)`
 * clause. Filtering in the database rather than in memory is what stops a
 * draft from being counted in `pagination.total` for somebody who may not see
 * it.
 *
 * @param {object|null} actor The request actor, or `null` when anonymous.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.publishedOnly] When true, non-members see only `PUBLISHED`; otherwise they see everything except `DRAFT`.
 * @returns {object} A Prisma `where` fragment; `{}` for a platform administrator.
 */
export function visibilityFilter(actor, options = {}) {
  const { publishedOnly = true } = options

  if (actor && can(actor, CAPABILITIES.PLATFORM_ADMIN)) return {}

  // Finding NF-19. This used to read `{ status: 'PUBLISHED' }` or, worse,
  // `{ status: { not: 'DRAFT' } }` — the second of which showed a stranger every
  // submission, every rejection and every archived event, because DRAFT was the
  // only state anybody had thought to exclude.
  //
  // A *listing* uses the narrower set: a cancelled or finished show has a page
  // but does not belong in "what is on". `events.get` uses the wider one, so
  // the page still resolves for the person holding a ticket to it.
  const publicFilter = publishedOnly
    ? { status: { in: [...INDEXABLE_STATUSES] } }
    : { status: { in: [...PUBLICLY_VISIBLE_STATUSES] } }
  const organizationIds = organizationsWhere(actor, can, CAPABILITIES.EVENT_VIEW_DRAFT)

  if (organizationIds.length === 0) return publicFilter

  return { OR: [publicFilter, { organizationId: { in: organizationIds } }] }
}

/**
 * The most words a search is split into. The query is capped at 120
 * characters already; this bounds the conditions one request can add.
 */
const MAX_SEARCH_TERMS = 8

/**
 * The most venues or organisers one word is resolved to up front. Past this
 * the word falls back to filtering through the relation, which is slower but
 * never wrong.
 */
const MAX_RESOLVED_IDS = 1000

/**
 * From how many venues or organisers a word's list is checked for the ones
 * that add an event (see {@link contributingIds}).
 *
 * A list this short never moved PostgreSQL's plan in measurement — with 74
 * organiser ids "night" kept its trigram bitmap scan; with 150 it read every
 * event — and checking it would cost a round trip for nothing.
 */
const CONTRIBUTION_CHECK_FROM = 50

/**
 * Split a free-text search into the words that must each match.
 *
 * @param {string|undefined} q The validated, trimmed query.
 * @returns {string[]} Distinct lower-cased words, at most {@link MAX_SEARCH_TERMS}.
 */
export function searchTerms(q) {
  if (!q) return []

  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS)
}

/**
 * @typedef {object} ResolvedTerm
 * @property {string} term The word.
 * @property {string[]|null} venueIds Venues whose name or city holds it and that add an event to the search, or null when too many to list.
 * @property {string[]|null} organizationIds Organisers whose name holds it and that add an event to the search, or null when too many to list.
 */

/**
 * Find, for each word of a search, the venues and organisers it names.
 *
 * Venues and organisers are small tables beside the events. Looking them up
 * first and filtering events by id keeps a search as fast as one over the
 * event's own text; asking Postgres to reach through both relations inside
 * the same OR more than doubled it under load.
 *
 * A long list is then cut to the venues and organisers that add an event the
 * word's own-text match does not already find ({@link contributingIds}), so a
 * common word does not carry hundreds of ids that change nothing.
 *
 * @param {object} prisma The Prisma client.
 * @param {string|undefined} q The validated, trimmed query.
 * @returns {Promise<ResolvedTerm[]>} One entry per word, in order.
 */
export async function resolveSearchTerms(prisma, q) {
  return Promise.all(
    searchTerms(q).map(async (term) => {
      const contains = { contains: likeLiteral(term), mode: 'insensitive' }
      const [venues, organizations] = await Promise.all([
        prisma.venue.findMany({
          where: { OR: [{ name: contains }, { city: contains }] },
          select: { id: true },
          take: MAX_RESOLVED_IDS + 1,
        }),
        prisma.organization.findMany({
          where: { name: contains },
          select: { id: true },
          take: MAX_RESOLVED_IDS + 1,
        }),
      ])

      // The word in the event's own text: the branch of the search that no
      // venue or organiser id is needed for.
      const ownText = {
        OR: [{ title: contains }, { summary: contains }, { description: contains }],
      }
      const [venueIds, organizationIds] = await Promise.all([
        contributingIds(prisma, 'venueId', venues, ownText),
        contributingIds(prisma, 'organizationId', organizations, ownText),
      ])

      return { term, venueIds, organizationIds }
    }),
  )
}

/**
 * The venues (or organisers) found by name that add an event to a search:
 * those with at least one event, in any status, whose own text does not hold
 * the word.
 *
 * The others change nothing. Every event of theirs is found by its own title,
 * summary or description, so `venueId IN (…)` or `organizationId IN (…)` only
 * repeats it — at a price. Each id is a bind parameter in the page and the
 * count, and PostgreSQL costs a long id list as hundreds of index probes. On
 * the shared test catalogue "night" names 416 organisers ("Nine Nights …",
 * one more set per browser-suite seed), each of whose only event already says
 * "night"; carrying those ids turned the page and the count from the trigram
 * bitmap scan (29ms) into a scan of every event running ILIKE on each row
 * (55-64ms), and the load suite's public search went over its budget on code
 * that had passed it (efd3527 measures the same on today's catalogue).
 *
 * Exact, not a heuristic: an event of a dropped venue or organiser still
 * matches the word through its own text. A list shorter than
 * {@link CONTRIBUTION_CHECK_FROM} is kept as it is, and a list too long to
 * hold becomes `null` as before, which filters through the relation.
 *
 * @param {object} prisma The Prisma client.
 * @param {'venueId'|'organizationId'} column The event column the ids are matched on.
 * @param {Array<{id: string}>} rows The venues or organisers whose name holds the word, at most {@link MAX_RESOLVED_IDS} + 1.
 * @param {object} ownText The `where` fragment for the word in an event's own text.
 * @returns {Promise<string[]|null>} The ids to search by, or null when too many to list.
 */
async function contributingIds(prisma, column, rows, ownText) {
  if (rows.length > MAX_RESOLVED_IDS) return null

  const ids = rows.map((row) => row.id)

  if (ids.length < CONTRIBUTION_CHECK_FROM) return ids

  // One row per venue or organiser that has such an event: an index probe per
  // id, and the word tested against their events only.
  const groups = await prisma.event.groupBy({
    by: [column],
    where: { [column]: { in: ids }, NOT: ownText },
  })

  return groups.map((group) => group[column])
}

/**
 * The condition one search word adds: it must appear in the event's own text,
 * its venue, the venue's city or its organiser.
 *
 * @param {string} term The word.
 * @param {ResolvedTerm|undefined} resolved What {@link resolveSearchTerms} found for it, if it ran.
 * @returns {object} A Prisma `where` fragment.
 */
function searchCondition(term, resolved) {
  // A LIKE pattern underneath, so the word's own `_` and `%` are escaped:
  // a search for `100%` is a search for those four characters.
  const contains = { contains: likeLiteral(term), mode: 'insensitive' }
  const venue = resolved?.venueIds
    ? { venueId: { in: resolved.venueIds } }
    : { venue: { OR: [{ name: contains }, { city: contains }] } }
  const organization = resolved?.organizationIds
    ? { organizationId: { in: resolved.organizationIds } }
    : { organization: { name: contains } }

  return {
    OR: [
      { title: contains },
      { summary: contains },
      { description: contains },
      venue,
      organization,
    ],
  }
}

/**
 * Translate a validated list query into Prisma arguments.
 *
 * @param {object} query The parsed `listEventsQuerySchema` value.
 * @param {object|null} actor The request actor.
 * @param {object} [options] Options.
 * @param {ResolvedTerm[]} [options.search] The search words already resolved to venues and organisers; any word missing here filters through the relation instead.
 * @returns {{where: object, orderBy: object[], skip: number, take: number}} Prisma query arguments.
 */
export function buildEventQuery(query, actor, { search = [] } = {}) {
  /** @type {object[]} */
  const conditions = [visibilityFilter(actor)]

  // A deleted event is listed only when asked for by name (the organiser's
  // "Deleted" filter); strangers never see one, since `visibilityFilter`
  // already holds them to public statuses.
  conditions.push(query.status ? { status: query.status } : { status: { not: 'DELETED' } })
  if (query.category) conditions.push({ category: query.category })
  if (query.organizationId) conditions.push({ organizationId: query.organizationId })
  if (query.isOnline !== undefined) conditions.push({ isOnline: query.isOnline })
  // Case-insensitive equality runs as ILIKE, so the city is escaped first.
  if (query.city) conditions.push({ venue: { city: equalsIgnoringCase(query.city) } })

  // Every word has to turn up somewhere a visitor would describe the event
  // by: its own text, its venue, the venue's city or its organiser. So
  // "garba houston" finds a garba night in Houston, and a search for an
  // organiser's name finds their events.
  const resolvedByTerm = new Map(search.map((entry) => [entry.term, entry]))

  for (const term of searchTerms(query.q)) {
    conditions.push(searchCondition(term, resolvedByTerm.get(term)))
  }

  /** @type {Record<string, Date>} */
  const startsAt = {}
  if (query.startsAfter) startsAt.gte = new Date(query.startsAfter)
  if (query.startsBefore) startsAt.lte = new Date(query.startsBefore)
  if (Object.keys(startsAt).length > 0) conditions.push({ startsAt })

  return {
    where: { AND: conditions },
    orderBy: ORDER_BY[query.sort] ?? ORDER_BY['startsAt:asc'],
    ...toSkipTake(query),
  }
}

/**
 * Convert the timestamp fields of an event payload into `Date` objects.
 *
 * The schemas normalise every instant to an ISO string on the way in, which is
 * right for a JSON boundary and wrong for Prisma, which wants `Date`.
 *
 * @param {object} body A validated create/update payload.
 * @returns {object} The same fields with `startsAt`/`endsAt` as dates.
 */
function withEventDates(body) {
  const data = { ...body }
  if (data.startsAt) data.startsAt = new Date(data.startsAt)
  if (data.endsAt) data.endsAt = new Date(data.endsAt)
  return data
}

/**
 * The public contact's wire names, and the columns they are stored in.
 *
 * Published as `publicEmail`/`publicPhone` so no public payload carries the
 * private column's name even as a substring; see `@desi-event/schemas/event-content`.
 */
const CONTACT_COLUMNS = Object.freeze({
  publicEmail: 'publicContactEmail',
  publicPhone: 'publicContactPhone',
})

/**
 * Rename the public contact fields of a request body to their columns.
 *
 * @param {object} body The validated request body; not modified.
 * @returns {object} The body, keyed by column.
 */
function toEventColumns(body) {
  const data = { ...body }

  for (const [wire, column] of Object.entries(CONTACT_COLUMNS)) {
    if (!Object.hasOwn(data, wire)) continue

    data[column] = data[wire]
    delete data[wire]
  }

  return data
}

/**
 * Keep the line-up's two columns in step.
 *
 * `performers` is the source of truth — names with roles and bios — and
 * `artists`, the names alone, is what structured data and older clients read.
 * Kept in step here, on the server, and nowhere else: two writers would drift.
 *
 *   - `performers` sent: `artists` becomes their names, in the same order.
 *   - Only `artists` sent: `performers` is rebuilt from the names, keeping the
 *     role and bio of any stored performer with the same name, so an older
 *     client that edits the names does not wipe the bios.
 *
 * @param {object} body The validated request body; not modified.
 * @param {object|null} [existing] The stored event, for the bios to keep.
 * @returns {object} The body with both columns set, or unchanged when neither was sent.
 */
export function syncLineUp(body, existing = null) {
  if (body.performers !== undefined) {
    return { ...body, artists: body.performers.map((performer) => performer.name) }
  }

  if (body.artists === undefined) return body

  const stored = Array.isArray(existing?.performers) ? existing.performers : []
  const byName = new Map(
    stored
      .filter((performer) => typeof performer?.name === 'string')
      .map((performer) => [performer.name.trim().toLowerCase(), performer]),
  )

  return {
    ...body,
    performers: body.artists.map((name) => {
      const prior = byName.get(name.trim().toLowerCase())

      return { name, role: prior?.role ?? null, bio: prior?.bio ?? null }
    }),
  }
}

/**
 * Load an event the caller is allowed to see, or throw a 404.
 *
 * "Not found" and "not yours" answer identically on purpose: distinguishing
 * them would let anyone enumerate an organiser's unannounced events by slug.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} where A Prisma unique selector, e.g. `{ slug }`.
 * @param {object|null} actor The request actor.
 * @returns {Promise<object>} The event row with its relations.
 * @throws {Error} A 404 when the event is absent or is a draft the caller may not see.
 */
async function loadVisibleEvent(prisma, where, actor) {
  const event = await prisma.event.findUnique({ where, include: EVENT_INCLUDE })

  if (!event) throw notFound('No such event.')

  assertVisibleTo(event, actor)

  return event
}

/**
 * Refuse an event this caller has no business seeing.
 *
 * A 404 rather than a 403, deliberately: a 403 confirms the slug names
 * something, and "does this organiser have an unannounced event called X" is
 * not a question a stranger gets to ask.
 *
 * @param {object} event The event row.
 * @param {object|null} actor The request actor.
 * @returns {void}
 * @throws {Error} A 404 when the caller may not see it.
 */
function assertVisibleTo(event, actor) {
  if (PUBLICLY_VISIBLE_STATUSES.has(event.status)) return
  if (maySeeDrafts(event, actor)) return

  throw notFound('No such event.')
}

// `maySeeDrafts` lives in `lib/event-insiders.js`, so the website link's
// library can ask the same question; re-exported here for the routes that
// already import it from this module.
export { maySeeDrafts }

/**
 * The refusal for a web address another event holds.
 *
 * A deleted event that was ever public keeps its address, retired, so a link
 * shared before it was deleted never shows a different event (SPEC2-XI X-11).
 *
 * @param {string} slug The address asked for.
 * @param {object} holder The event holding it.
 * @returns {Error} A 409: `SLUG_RETIRED` for a deleted holder, else `CONFLICT`.
 */
function slugTaken(slug, holder) {
  if (holder.status === 'DELETED') {
    return httpError(
      409,
      'SLUG_RETIRED',
      'That web address belonged to an event that was deleted, so it stays retired. Choose another.',
      { field: 'slug' },
    )
  }

  return conflict(`The slug "${slug}" is already in use.`)
}

/**
 * Reserve a unique slug, retrying once with a random suffix on collision.
 *
 * @param {object} prisma The Prisma client.
 * @param {string|undefined} requested The slug the caller asked for, if any.
 * @param {string} title The event title, used to derive a slug when none was given.
 * @returns {Promise<string>} A slug no other event currently holds.
 * @throws {Error} A 409 when the caller asked for a slug that is already taken.
 */
async function resolveSlug(prisma, requested, title) {
  if (requested) {
    const taken = await prisma.event.findUnique({ where: { slug: requested } })
    if (taken) throw slugTaken(requested, taken)
    return requested
  }

  const base = slugify(title)
  const taken = await prisma.event.findUnique({ where: { slug: base } })

  return taken ? disambiguateSlug(base) : base
}

/**
 * Check that a caller-supplied venue exists before it reaches the database.
 *
 * A `venueId` arrives in the request body, so it is caller-controlled. Passing
 * an unknown one straight through turns a foreign key violation into a 500 —
 * a bad request reported as a server fault, with a database error message
 * attached. Resolving it first gives the caller a 422 that names the problem.
 *
 * @param {object} prisma A Prisma client.
 * @param {string|null|undefined} venueId The venue id from the request body.
 * @returns {Promise<void>} Resolves when the venue exists or none was supplied.
 * @throws {Error} A 422 when the venue does not exist.
 */
async function assertVenueExists(prisma, venueId) {
  if (venueId === undefined || venueId === null) return

  const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } })

  if (!venue) throw unprocessable(`No such venue: ${venueId}.`, { field: 'venueId' })
}

/**
 * How each ticket type's own sales window moves when a postponed event comes
 * back with new dates.
 *
 * By the same amount as what the tier is sold for: a tier for one night moves
 * with that night's start (not at all when that night keeps its date), and a
 * tier for every night moves with the event's start. A window that opened or
 * closed relative to the old date keeps that relation to the new one; left
 * behind, one that closed at the postponed date would keep the tier off sale
 * after the event came back. A tier with no window of its own has nothing to
 * move.
 *
 * A moved window is held to the rule a tier edit is held to: a tier for one
 * night may not close after that night has finished. A move that would break
 * it — a night brought back shorter — is a problem the caller is told about,
 * never a window silently clipped.
 *
 * @param {object} event The event as loaded, with `sessions` and `ticketTypes`.
 * @param {object} change The reschedule.
 * @param {string} change.startsAt The event's new start.
 * @param {Array<{id: string, startsAt: string}>} change.moves The nights named, with their new starts.
 * @param {object[]} change.proposed Every night as it will be.
 * @returns {Array<{id: string, data: object, before: object, after: object, problems: string[]}>} One entry per tier whose window moves.
 */
export function tierWindowMoves(event, { startsAt, moves, proposed }) {
  const eventDelta = new Date(startsAt).getTime() - new Date(event.startsAt).getTime()
  const oldNights = new Map((event.sessions ?? []).map((session) => [session.id, session]))
  const newNights = new Map(proposed.map((session) => [session.id, session]))
  const nightDelta = new Map(
    moves
      .filter((move) => oldNights.has(move.id))
      .map((move) => [
        move.id,
        new Date(move.startsAt).getTime() - new Date(oldNights.get(move.id).startsAt).getTime(),
      ]),
  )

  /** @type {Array<{id: string, data: object, before: object, after: object, problems: string[]}>} */
  const out = []

  for (const tier of event.ticketTypes ?? []) {
    if (!tier.salesStartAt && !tier.salesEndAt) continue

    const delta = tier.eventSessionId ? (nightDelta.get(tier.eventSessionId) ?? 0) : eventDelta

    if (delta === 0) continue

    const shift = (value) => (value ? new Date(new Date(value).getTime() + delta) : null)
    const data = { salesStartAt: shift(tier.salesStartAt), salesEndAt: shift(tier.salesEndAt) }
    const night = tier.eventSessionId ? newNights.get(tier.eventSessionId) : null
    /** @type {string[]} */
    const problems = []

    if (night && data.salesEndAt && data.salesEndAt > new Date(night.endsAt)) {
      problems.push(
        `Ticket type "${tier.name}": its sales window moves with its session, and would then close after the session has finished. Change its sales window first, or give the session a later end.`,
      )
    }

    const iso = (value) => (value ? new Date(value).toISOString() : null)

    out.push({
      id: tier.id,
      data,
      before: { salesStartAt: iso(tier.salesStartAt), salesEndAt: iso(tier.salesEndAt) },
      after: { salesStartAt: iso(data.salesStartAt), salesEndAt: iso(data.salesEndAt) },
      problems,
    })
  }

  return out
}

/**
 * Register the `/v1/events` routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.env] The parsed API environment, for the fee terms a card's price is quoted with.
 * @returns {void} Nothing.
 */
export function registerEventRoutes(app, { prisma, env }) {
  // One ticket of the cheapest tier, priced with checkout's own fee terms —
  // the event's own booking fee when the team at The Desi Events set one, else the
  // site default (SPEC3 §7.2) — so a card's "from" price is the price and not
  // the face value.
  const pricing = env
    ? { feeConfigFor: (currency, event) => eventFeeConfig(env, event, currency) }
    : {}
  const summaryOptions = pricing

  /**
   * An event's booking fee and pay-at-the-venue switch for a detail, when the
   * reader is its own team or the team at The Desi Events; undefined for everybody
   * else, so the key stays out (SPEC3 §7.2, §11.3).
   *
   * @param {object} event The event as read.
   * @param {object|null} actor The request actor.
   * @returns {Promise<object|undefined>} The `paymentTerms` view, or undefined.
   */
  const paymentTermsFor = (event, actor) => eventPaymentTerms(prisma, event, { actor, env })

  defineRoute(app, 'events.facets', {
    handler: async () => ({ data: await loadEventFacets(prisma) }),
  })

  defineRoute(app, 'events.list', {
    handler: async (request) => {
      const search = await resolveSearchTerms(prisma, request.query.q)
      const { where, orderBy, skip, take } = buildEventQuery(request.query, request.actor, {
        search,
      })

      // The page's ids first, then the cards for those ids only: Prisma sends
      // one statement per relation EVENT_SUMMARY_SELECT reads (five) even
      // when the page is empty, so a search that found nothing cost seven
      // statements and now costs one. The total needs its own count only when
      // the page does not show where the list ends.
      const page = await prisma.event.findMany({
        where,
        orderBy,
        skip,
        take,
        select: { id: true },
      })
      const endsHere = page.length < take && (page.length > 0 || skip === 0)
      const [events, total] = await Promise.all([
        page.length === 0
          ? []
          : // Read back under the same filter, so an event that left the
            // listing between the two reads is dropped rather than shown.
            prisma.event.findMany({
              where: { AND: [{ id: { in: page.map((row) => row.id) } }, where] },
              orderBy,
              select: EVENT_SUMMARY_SELECT,
            }),
        endsHere ? skip + page.length : prisma.event.count({ where }),
      ])

      return {
        data: events.map((event) => toEventSummary(event, summaryOptions)),
        pagination: buildPaginationMeta({
          page: request.query.page,
          perPage: request.query.perPage,
          total,
        }),
      }
    },
  })

  defineRoute(app, 'events.get', {
    handler: async (request) => {
      const key = request.params.slug

      // Slug first, then id. An organiser's editor is keyed by id — the slug
      // is one of the things being edited, so a URL built from it breaks the
      // moment somebody renames their event — but a slug that happens to look
      // like a cuid must still resolve to the event that owns it. Trying the
      // slug first makes that deterministic rather than a race between two
      // interpretations of the same string.
      const event =
        (await prisma.event.findUnique({ where: { slug: key }, include: EVENT_INCLUDE })) ??
        (await prisma.event.findUnique({ where: { id: key }, include: EVENT_INCLUDE }))

      if (!event) throw notFound('No such event.')

      assertVisibleTo(event, request.actor)

      const insider = maySeeDrafts(event, request.actor)
      const seats = await reservedSeatAvailability(prisma, event, { insider, now: new Date() })

      return {
        data: toEventDetail(event, {
          includeDraftTiers: insider,
          // The joining link is the organiser's and their ticket holders'. The
          // public page says it is on the ticket; the holder reads it there.
          includeOnlineUrl: insider,
          sessionsAvailability: seats.bySession,
          tierSeatsAvailable: seats.byTier,
          website: websiteViewFor(request.actor, event),
          paymentTerms: await paymentTermsFor(event, request.actor),
          // A deleted event reaches only its own team and the team at The Desi Events
          // (`assertVisibleTo`), who read its record.
          deletion: insider ? { platformReader: platformReader(request.actor) } : null,
          ...pricing,
        }),
      }
    },
  })

  defineRoute(app, 'events.create', {
    handler: async (request) => {
      const body = request.body
      assertCan(request.actor, CAPABILITIES.EVENT_CREATE, { organizationId: body.organizationId })

      const organization = await prisma.organization.findUnique({
        where: { id: body.organizationId },
      })
      if (!organization) throw notFound('No such organisation.')

      await assertVenueExists(prisma, body.venueId)

      const slug = await resolveSlug(prisma, body.slug, body.title)

      // Finding NF-17. `status` carried a DRAFT *default*, which is not a DRAFT
      // *guarantee*: a caller holding only `event:create` could post
      // `status: 'PUBLISHED'` — or `'APPROVED'`, forging a moderator's decision
      // — and have the row written that way. A new event is a draft. There is
      // no other way to make one, and the status field is ignored rather than
      // rejected so an old client keeps working and simply does not get its way.
      const { status: _ignored, ...writable } = body
      const data = withEventDates(syncLineUp(toEventColumns({ ...writable, slug })))

      const event = await prisma.event.create({
        data: {
          ...data,
          // An address given at creation waits for an administrator at The Desi Events;
          // the link starts off. Computed here as the database's trigger does.
          ...websiteColumnsFor(null, data.websiteUrl ?? null, new Date()),
          status: 'DRAFT',
          publishedAt: null,
        },
        include: EVENT_INCLUDE,
      })

      request.log.info({ eventId: event.id, actorId: request.actor.id }, 'event created')

      // Every route below `events.get` is already gated on holding something
      // in this organisation, so the caller is on the inside and sees the
      // tiers they are still holding back. Said explicitly rather than left to
      // the default: an organiser's own editor going blank after a save is not
      // a bug anybody would guess at.
      return {
        data: toEventDetail(event, {
          includeDraftTiers: true,
          includeOnlineUrl: true,
          website: websiteViewFor(request.actor, event),
          paymentTerms: await paymentTermsFor(event, request.actor),
          ...pricing,
        }),
      }
    },
  })

  defineRoute(app, 'events.update', {
    handler: async (request) => {
      const existing = await prisma.event.findUnique({
        where: { id: request.params.id },
        include: { venue: true, sessions: true },
      })
      if (!existing) throw notFound('No such event.')

      // The organisation's authority through membership, or that of the team at
      // The Desi Events in an open editing sitting of this browser session (SPEC2-XI
      // X-A). A finished or cancelled event takes its words and pictures only.
      const { mode, authority } = await assertAuthorable(prisma, existing, request.actor, {
        session: request.session,
        allow: [AUTHORING_MODES.DRAFT, AUTHORING_MODES.LIVE, AUTHORING_MODES.CONTENT],
      })

      const { revision, confirmMaterialChange = false, changeReason = null, ...body } = request.body

      if (body.slug && body.slug !== existing.slug) {
        const taken = await prisma.event.findUnique({ where: { slug: body.slug } })
        if (taken) throw slugTaken(body.slug, taken)
      }

      // A window is only valid as a whole, so a partial update that moves one
      // end must be checked against the end it did not move.
      const startsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt
      const endsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt

      if (endsAt.getTime() <= startsAt.getTime()) {
        throw unprocessable('endsAt must be strictly after startsAt.')
      }

      await assertVenueExists(prisma, body.venueId)

      const data = withEventDates(syncLineUp(toEventColumns(body), existing))
      const { material, before, after } = classifyChanges(existing, data)

      // What holders were told about a finished or cancelled event's date,
      // place and terms stays as they were told it.
      if (mode === AUTHORING_MODES.CONTENT && material.length > 0) {
        throw httpError(
          409,
          'NOT_EDITABLE',
          `${contentOnlyMessage(existing.status)} These stay as ticket holders were told them: ${describeFields(material).join(', ')}.`,
          { status: existing.status, fields: material },
        )
      }

      // A night with a seating map is seated at that venue: moving the event
      // elsewhere would leave its seats at the old one (SPEC2-XI X-V).
      if (
        data.venueId !== undefined &&
        data.venueId !== existing.venueId &&
        (existing.sessions ?? []).some(
          (session) => session.status !== 'CANCELLED' && session.venueMapVersionId,
        )
      ) {
        throw httpError(
          409,
          'VENUE_HAS_SEATING',
          `The nights of this event use ${existing.venue?.name ?? 'its venue'}'s seating map. Remove the map from each night (possible while nothing is sold there) or add nights at the new venue, then change the venue.`,
          { field: 'venueId' },
        )
      }

      // Three worlds, and they are genuinely different rather than three
      // branches of one rule.
      //
      //   - A draft is somebody's private working copy: edit it.
      //   - A live event has an audience, so a material change is a change to
      //     the deal and needs confirming, a reason, and people told.
      //   - A finished or cancelled event takes its words and pictures only
      //     (refused above for its date, place and terms).
      //   - Anything else — under review, approved, rejected, archived,
      //     deleted — is not the organiser's to edit at all. Editing a version
      //     a moderator is holding invalidates the decision rather than
      //     amending it. `assertAuthorable` refuses those with 409.
      const live = mode === AUTHORING_MODES.LIVE

      // A draft may be online before its link is typed — the editor saves the
      // tick on its own — and publication refuses it without one. A live event
      // is somebody's plan for the evening, so it may not lose its link.
      if (live) {
        const isOnline = data.isOnline ?? existing.isOnline
        const onlineUrl = data.onlineUrl !== undefined ? data.onlineUrl : existing.onlineUrl

        if (isOnline && !onlineUrl) {
          throw unprocessable('A published online event needs its joining link.', {
            problems: ['A published online event needs its joining link.'],
            fields: ['onlineUrl'],
          })
        }
      }

      if (live && material.length > 0 && !confirmMaterialChange) {
        refuseUnconfirmed(material, existing.status)
      }

      if (live && material.length > 0 && !changeReason) {
        throw unprocessable(
          'A confirmed material change needs a reason, because a notice with it is recorded for everybody holding a ticket.',
          { problems: ['Give a reason for the change.'], fields: material },
        )
      }

      // The revision precondition is optional on this route and mandatory in
      // practice for the editor, which always sends one. Omitting it is for a
      // script making a single deliberate change; an editor that autosaves
      // without one is an editor where the last writer silently wins.
      const expected = Number.isInteger(revision) ? revision : existing.revision

      const updated = await authorChange(prisma, {
        event: existing,
        revision: expected,
        actor: request.actor,
        authority,
        sessionId: request.session?.id ?? null,
        action: material.length > 0 ? 'event.material_change' : 'event.updated',
        // Which fields changed, never what they say: content values stay out of
        // the audit row, except the before and after of a material change below.
        metadata: { fields: changedFields(existing, data).sort() },
        write: async (tx) => {
          // The organiser's website address, with whether it now waits for an
          // administrator. Read under the row lock `authorChange` took, so a
          // decision committed a moment ago is what this is measured against.
          // The switch, the decided address and the reason are never written
          // here: an organiser's change never moves the link.
          const website =
            data.websiteUrl === undefined
              ? {}
              : await applyWebsiteChange(tx, { eventId: existing.id, nextUrl: data.websiteUrl })

          await tx.event.update({ where: { id: existing.id }, data: { ...data, ...website } })

          if (!live || material.length === 0) return

          const work = await materialChangeWork(tx, {
            event: existing,
            revision: expected + 1,
            material,
            before,
            after,
            reason: changeReason,
            byPlatform: byPlatform(authority),
          })

          // Recorded separately from the audit row `authorChange` writes, so
          // the before/after of a change to the deal is a first-class record
          // rather than a line item. Historical snapshots on the orders
          // themselves are never touched: that is what makes them snapshots.
          await recordAudit(tx, {
            action: 'event.material_change.notified',
            entityType: 'Event',
            entityId: existing.id,
            actorId: request.actor?.id ?? null,
            metadata: {
              ...authorityAuditMetadata(authority),
              fields: material,
              before,
              after,
              reason: changeReason,
              ordersAffected: work.orders,
              // Created, not delivered. No outbox worker exists yet.
              notificationsQueued: work.notifications,
            },
          })
        },
      })

      const event = await prisma.event.findUnique({
        where: { id: updated.id },
        include: EVENT_INCLUDE,
      })

      return {
        data: toEventDetail(event, {
          includeDraftTiers: true,
          includeOnlineUrl: true,
          website: websiteViewFor(request.actor, event),
          paymentTerms: await paymentTermsFor(event, request.actor),
          ...pricing,
        }),
      }
    },
  })

  /**
   * Run one lifecycle command.
   *
   * Every command is the same four steps in the same order, so they share one
   * body and differ only in the destination and what they carry. Writing them
   * out five times would mean five places for the audit record to be forgotten.
   *
   * @param {object} request The Fastify request.
   * @param {string} to The destination status.
   * @param {object} [extra] `reason`, `requestedChanges`, `onCommit`, and `from`:
   *   the source statuses this command is for, when the table allows the same
   *   destination from more than one. A command called from any other status
   *   answers 409 rather than making a move its name does not describe.
   * @returns {Promise<object>} The response body.
   */
  async function command(request, to, extra = {}) {
    const { from = null, ...options } = extra
    const event = await loadForTransition(prisma, request.params.id)

    if (from && !from.includes(event.status)) {
      // "Not in that state" is only news to somebody who may see the event and
      // make the move at all; everybody else gets the answer they would get
      // for any other status.
      assertVisibleTo(event, request.actor)
      lifecycleAuthority(request.actor, event, capabilityFor(to))

      throw httpError(
        409,
        'ILLEGAL_TRANSITION',
        `This command is for an event that is ${from.join(' or ')}; this one is ${event.status}.`,
        { from: event.status, to, expected: from },
      )
    }

    const updated = await transitionEvent(prisma, {
      event,
      to,
      actor: request.actor,
      ...options,
    })

    request.log.info(
      { eventId: event.id, from: event.status, to, actorId: request.actor?.id },
      'event lifecycle transition',
    )

    const full = await prisma.event.findUnique({
      where: { id: updated.id },
      include: EVENT_INCLUDE,
    })

    return {
      data: toEventDetail(full, {
        includeDraftTiers: true,
        includeOnlineUrl: true,
        website: websiteViewFor(request.actor, full),
        paymentTerms: await paymentTermsFor(full, request.actor),
        ...pricing,
      }),
    }
  }

  defineRoute(app, 'events.transitions', {
    handler: async (request) => {
      const event = await loadForTransition(prisma, request.params.id)

      assertVisibleTo(event, request.actor)
      assertCan(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
        organizationId: event.organizationId,
      })

      return {
        data: {
          status: event.status,
          transitions: await availableTransitions(prisma, event, request.actor),
        },
      }
    },
  })

  defineRoute(app, 'events.moderationHistory', {
    handler: async (request) => {
      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, organizationId: true, status: true },
      })

      if (!event) throw notFound('No such event.')

      // The history of a negotiation belongs to the two parties to it: the
      // organisation that owns the event, and the moderators who ruled on it.
      const permitted =
        can(request.actor, CAPABILITIES.MODERATION_REVIEW) ||
        can(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
          organizationId: event.organizationId,
        })

      if (!permitted) throw notFound('No such event.')

      const history = await prisma.eventModerationAction.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'desc' },
      })

      return {
        data: history.map((action) => ({
          id: action.id,
          fromStatus: action.fromStatus,
          toStatus: action.toStatus,
          reason: action.reason,
          requestedChanges: action.requestedChanges ?? null,
          actorId: action.actorId,
          createdAt: action.createdAt.toISOString(),
        })),
      }
    },
  })

  defineRoute(app, 'events.submitReview', {
    handler: (request) =>
      command(request, 'REVIEW_PENDING', { reason: request.body?.note ?? null }),
  })

  defineRoute(app, 'events.withdrawReview', {
    // REJECTED → DRAFT is a legal move too, but it is a rework, not a
    // withdrawal: it has its own route and its own name in the history.
    handler: (request) => command(request, 'DRAFT', { from: ['REVIEW_PENDING'] }),
  })

  defineRoute(app, 'events.rework', {
    handler: (request) => command(request, 'DRAFT', { from: ['REJECTED'] }),
  })

  defineRoute(app, 'events.reschedule', {
    handler: async (request) => {
      const { revision, startsAt, endsAt, sessions: moves, resume, reason } = request.body
      const event = await loadForTransition(prisma, request.params.id)

      // The dates are an edit; the return is a publication. Both authorities,
      // the second asserted by the transition itself. Both are the organiser's
      // (Rule L): a SUPER_ADMIN outside the organisation moves it as the
      // team at The Desi Events, and a platform ADMIN is told it is the organiser's.
      assertVisibleTo(event, request.actor)
      const authority = lifecycleAuthority(request.actor, event, CAPABILITIES.EVENT_UPDATE)

      if (event.status !== 'POSTPONED') {
        throw httpError(
          409,
          'ILLEGAL_TRANSITION',
          `Only a postponed event is brought back with a new date; this one is ${event.status}.`,
          { from: event.status, to: resume },
        )
      }

      const now = new Date()
      const byId = new Map((event.sessions ?? []).map((session) => [session.id, session]))
      /** @type {string[]} */
      const problems = []

      if (new Date(startsAt) <= now) problems.push('The new start is in the past.')

      for (const move of moves) {
        if (!byId.has(move.id)) problems.push('That session belongs to a different event.')

        // A cancelled night does not come back, and does not move.
        if (byId.get(move.id)?.status === 'CANCELLED') {
          throw httpError(409, 'NOT_EDITABLE', 'This night was cancelled.', {
            sessionId: move.id,
          })
        }
      }

      // Every night as it will be after the move, moved or not: an event brought
      // back with a night still in the past is a night nobody can attend.
      const proposed = (event.sessions ?? []).map((session) => {
        const move = moves.find((candidate) => candidate.id === session.id)

        return move ? { ...session, ...move } : session
      })

      for (const session of proposed) {
        const label = new Date(session.startsAt).toISOString()

        if (new Date(session.startsAt) <= now) {
          problems.push(`The session starting ${label} is in the past. Give it a new date too.`)
        }

        for (const problem of sessionProblems(session, event)) {
          problems.push(`Session ${label}: ${problem}`)
        }
      }

      // A ticket type's own sales window moves with what it is sold for, by
      // the same amount: a tier for one night with that night, a tier for
      // every night with the event's start. Left at the old dates, a window
      // that closed at the postponed date would keep the tier off sale after
      // the event came back.
      const tierMoves = tierWindowMoves(event, { startsAt, moves, proposed })

      for (const move of tierMoves) problems.push(...move.problems)

      if (problems.length > 0) {
        throw unprocessable('That new date cannot be used.', {
          problems: [...new Set(problems)],
        })
      }

      await transitionEvent(prisma, {
        event,
        to: resume,
        actor: request.actor,
        reason,
        /**
         * The dates, the notices and the record, with the status change.
         *
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when done.
         */
        onCommit: async (tx) => {
          // The revision precondition, inside the transaction: somebody who
          // saved since the form was read keeps their change, and nothing here
          // — status included — commits.
          const { count } = await tx.event.updateMany({
            where: { id: event.id, revision },
            data: {
              revision: revision + 1,
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
            },
          })

          if (count !== 1) {
            const current = await tx.event.findUnique({
              where: { id: event.id },
              select: { revision: true },
            })

            throw httpError(
              409,
              'STALE_REVISION',
              'Somebody else saved a change to this event while you were setting the new date. Reload and try again.',
              { expectedRevision: revision, currentRevision: current?.revision ?? null },
            )
          }

          /** @type {object[]} */
          const moved = []

          for (const move of moves) {
            const existing = byId.get(move.id)
            const data = {
              startsAt: new Date(move.startsAt),
              endsAt: new Date(move.endsAt),
              ...(move.doorsOpenAt !== undefined
                ? { doorsOpenAt: move.doorsOpenAt ? new Date(move.doorsOpenAt) : null }
                : {}),
              ...(move.salesStartAt !== undefined
                ? { salesStartAt: move.salesStartAt ? new Date(move.salesStartAt) : null }
                : {}),
              ...(move.salesEndAt !== undefined
                ? { salesEndAt: move.salesEndAt ? new Date(move.salesEndAt) : null }
                : {}),
            }
            const fields = changedFields(existing, data)
            // A night whose end the importer estimated keeps the estimate when it
            // moves whole; an end set apart from its start is the organiser's.
            const listed =
              existing.endTimeListed === false && endTimeListedAfter(existing, data)
                ? { endTimeListed: true }
                : {}

            await tx.eventSession.update({
              where: { id: existing.id },
              data: { ...data, ...listed },
            })

            if (fields.length > 0) {
              moved.push({
                id: existing.id,
                fields,
                before: { startsAt: existing.startsAt.toISOString() },
                after: { startsAt: data.startsAt.toISOString() },
              })
            }
          }

          for (const move of tierMoves) {
            await tx.ticketType.update({ where: { id: move.id }, data: move.data })
          }

          const change = classifyChanges(event, {
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
          })
          // One notice per order for the whole reschedule, naming the nights
          // that moved, rather than one per session.
          const work = await materialChangeWork(tx, {
            event,
            revision: revision + 1,
            material: change.material,
            before: change.before,
            after: change.after,
            reason,
            sessions: moved,
            kind: 'RESCHEDULED',
            byPlatform: byPlatform(authority),
          })

          await recordAudit(tx, {
            action: AUDIT_ACTIONS.EVENT_RESCHEDULED,
            entityType: 'Event',
            entityId: event.id,
            actorId: request.actor?.id ?? null,
            metadata: {
              ...authorityAuditMetadata(authority),
              from: event.status,
              to: resume,
              revision: revision + 1,
              fields: change.material,
              before: change.before,
              after: change.after,
              sessions: moved,
              // Each ticket type whose own sales window moved, and by how much.
              ticketTypes: tierMoves.map(({ id, before, after }) => ({ id, before, after })),
              reason,
              ordersAffected: work.orders,
              // Created, not delivered: this build queues notices and sends none.
              notificationsQueued: work.notifications,
            },
          })
        },
      })

      request.log.info(
        { eventId: event.id, to: resume, actorId: request.actor?.id },
        'event rescheduled',
      )

      const full = await prisma.event.findUnique({
        where: { id: event.id },
        include: EVENT_INCLUDE,
      })

      return {
        data: toEventDetail(full, {
          includeDraftTiers: true,
          includeOnlineUrl: true,
          website: websiteViewFor(request.actor, full),
          paymentTerms: await paymentTermsFor(full, request.actor),
          ...pricing,
        }),
      }
    },
  })

  defineRoute(app, 'events.publish', {
    handler: (request) => command(request, 'PUBLISHED'),
  })

  defineRoute(app, 'events.openSales', {
    handler: (request) => command(request, 'ON_SALE'),
  })

  defineRoute(app, 'events.pauseSales', {
    handler: (request) =>
      command(request, 'SALES_PAUSED', { reason: request.body?.reason ?? null }),
  })

  defineRoute(app, 'events.postpone', {
    handler: async (request) => {
      const { reasonCode, reason, newStartsAt, newEndsAt } = request.body

      return command(request, 'POSTPONED', {
        reason: `${reasonCode}: ${reason}`,
        /**
         * Move the dates and raise the notice in the same transaction.
         *
         * @param {object} tx The transaction client.
         * @param {object} updated The event after the status write.
         * @returns {Promise<void>} Resolves when done.
         */
        onCommit: async (tx, updated, { byPlatform: platform }) => {
          if (newStartsAt && newEndsAt) {
            await tx.event.update({
              where: { id: updated.id },
              data: { startsAt: new Date(newStartsAt), endsAt: new Date(newEndsAt) },
            })
          }

          await cancellationWork(tx, {
            event: updated,
            kind: 'POSTPONED',
            reasonCode,
            reason,
            actorId: request.actor?.id ?? null,
            requestId: request.id,
            byPlatform: platform,
          })
        },
        transactionOptions: await cancellationTransactionOptions(prisma, request.params.id),
      })
    },
  })

  defineRoute(app, 'events.cancel', {
    handler: async (request) => {
      const { reasonCode, reason } = request.body

      return command(request, 'CANCELLED', {
        reason: `${reasonCode}: ${reason}`,
        /**
         * Raise the notification and refund work with the cancellation.
         *
         * Inside the transaction because the work and the status must commit
         * together: an event cancelled with no refund work owed is worse than
         * one that is not cancelled at all.
         *
         * What it did goes into the cancellation's own audit record: the
         * refunds reserved, the orders with nothing left to refund, and the
         * disputed orders left to the finance team, by id.
         *
         * @param {object} tx The transaction client.
         * @param {object} updated The cancelled event.
         * @param {{byPlatform: boolean}} context Whose authority it was made under.
         * @returns {Promise<{auditMetadata: object}>} What the audit record carries.
         */
        onCommit: async (tx, updated, { byPlatform: platform }) => {
          const work = await cancellationWork(tx, {
            event: updated,
            kind: 'CANCELLED',
            reasonCode,
            reason,
            actorId: request.actor?.id ?? null,
            requestId: request.id,
            byPlatform: platform,
          })

          return { auditMetadata: { refundWork: work } }
        },
        // A refund is reserved for every paid order in this transaction, so its
        // budget grows with the orders rather than being Prisma's five seconds.
        transactionOptions: await cancellationTransactionOptions(prisma, request.params.id),
      })
    },
  })
}

export { loadVisibleEvent }
