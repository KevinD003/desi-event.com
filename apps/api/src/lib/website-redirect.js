/**
 * The organiser's website link, and the switch only the team at The Desi Events turns.
 *
 * ## The columns
 *
 * The organiser writes `Event.websiteUrl`. A platform administrator decides
 * about one address at a time: the decision records that address in
 * `websiteDecidedUrl`, and while the switch (`websiteRedirectEnabled`) is on,
 * the public link goes **there**. An organiser's later change never moves the
 * switch, the decided address or the reason; it only puts the new address on
 * the administrators' list (`websiteDecisionPending`, since
 * `websiteSubmittedAt`). So an approved address stays linked until an
 * administrator approves the new one or turns the link off, and an address
 * nobody looked at is never shown.
 *
 * Waiting means: the current address differs from the decided one, and there
 * is something to decide — an address, or a switch that is on (the organiser
 * removed the address while the link is on). {@link websiteColumnsFor}
 * computes it for every write of `websiteUrl`; trigger
 * `desi_event_website_change` computes the same for every other writer.
 *
 * ## The only writer of the switch
 *
 * {@link decideWebsiteRedirect} is the one place `websiteRedirectEnabled`,
 * `websiteDecidedUrl` and `websiteRedirectReason` are written (a source scan in
 * security-regression holds it so). It takes a client or a transaction client:
 * given a client it opens its own transaction, given a transaction client it
 * runs in it, so the importer can switch an event's link on in the same
 * transaction that publishes it.
 *
 * ## Who sees what
 *
 *   - Everybody: {@link publicWebsiteLink}, `{host}` or null. Never the address.
 *   - The event's own team, moderators and platform administrators:
 *     `websiteUrl` and {@link websiteRedirectState}, including the deciding
 *     administrator's display name, which the organiser is shown too.
 *
 * @module @desi-event/api/lib/website-redirect
 */

import { CAPABILITIES, can } from '@desi-event/permissions'
import { EVENT_STATUSES } from '@desi-event/schemas'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { websiteHost, websiteUrlProblem } from '@desi-event/schemas/website'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { httpError, notFound } from './errors.js'
import { maySeeDrafts } from './event-insiders.js'
import { likeLiteral } from './like-pattern.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from './transaction-budget.js'
import { isTransactionClient } from './transaction-client.js'

/** The relation the deciding administrator's name is read through. */
export const WEBSITE_REDIRECT_INCLUDE = Object.freeze({
  websiteRedirectChangedBy: { select: { displayName: true } },
})

/**
 * Every column {@link websiteRedirectState} and {@link publicWebsiteLink}
 * read, for a query that `select`s rather than `include`s.
 */
export const WEBSITE_REDIRECT_SELECT = Object.freeze({
  status: true,
  websiteUrl: true,
  websiteRedirectEnabled: true,
  websiteDecidedUrl: true,
  websiteDecisionPending: true,
  websiteSubmittedAt: true,
  websiteRedirectChangedAt: true,
  websiteRedirectChangedById: true,
  websiteRedirectReason: true,
  ...WEBSITE_REDIRECT_INCLUDE,
})

/** Who decided, once the administrator's account is gone. */
export const FORMER_ADMINISTRATOR_NAME = 'An administrator at The Desi Events'

/** `EventStatus.DELETED`, once the status exists (SPEC2-XI). */
export const DELETED_STATUS = 'DELETED'

/**
 * The statuses an event in the administrators' `waiting` list is in: under
 * review, approved, or public. Everything else with an address waiting (a
 * draft, one sent back for changes, a rejected or an archived event) is listed
 * under `drafts`.
 *
 * @type {ReadonlySet<string>}
 */
export const WEBSITE_REVIEWABLE_STATUSES = Object.freeze(
  new Set([...PUBLICLY_VISIBLE_STATUSES, 'REVIEW_PENDING', 'APPROVED']),
)

/**
 * Whether the status vocabulary has DELETED yet. Read rather than assumed:
 * naming a status the database does not have makes the whole query fail.
 *
 * @param {ReadonlyArray<string>} [statuses] Every event status there is.
 * @returns {boolean} True once events can be deleted.
 */
export function deletedStatusExists(statuses = EVENT_STATUSES) {
  return statuses.includes(DELETED_STATUS)
}

/**
 * What the public page shows for the website link: where it goes, as a host.
 *
 * Only while an administrator has the link on, the address they approved still
 * passes today's address rules, and the event's page is public. Never the
 * address itself: the link on the page is The Desi Events' own
 * `/events/{slug}/website`.
 *
 * @param {object|null|undefined} event An event row with the website columns and `status`.
 * @returns {{host: string}|null} The host, or null.
 */
export function publicWebsiteLink(event) {
  if (!event || event.websiteRedirectEnabled !== true) return null
  if (!PUBLICLY_VISIBLE_STATUSES.has(event.status)) return null

  const decided = event.websiteDecidedUrl

  if (typeof decided !== 'string' || websiteUrlProblem(decided) !== null) return null

  const host = websiteHost(decided)

  return host ? { host } : null
}

/**
 * The address a person following the link is sent to, or null when the link
 * shows nowhere. The same three conditions as {@link publicWebsiteLink}.
 *
 * @param {object|null|undefined} event An event row with the website columns and `status`.
 * @returns {string|null} The decided address.
 */
export function websiteRedirectTarget(event) {
  return publicWebsiteLink(event) ? event.websiteDecidedUrl : null
}

/**
 * The switch as the event's team and the team at The Desi Events read it.
 *
 * `changedByName` is the deciding administrator's display name, shown to the
 * organiser as well (SPEC2 D6), or {@link FORMER_ADMINISTRATOR_NAME} once the
 * account is gone. Never part of a public payload.
 *
 * @param {object} event An event row with the website columns and `websiteRedirectChangedBy`.
 * @param {object} [options] Options.
 * @param {boolean} [options.administrator] Whether the reader decides on links. Every insider sees the same state today; the flag is taken so a reader-dependent rule has one place to go.
 * @returns {object} A `websiteRedirectStateSchema` object.
 */
export function websiteRedirectState(event, { administrator: _administrator = false } = {}) {
  const decided = event.websiteRedirectChangedAt ?? null

  return {
    enabled: event.websiteRedirectEnabled === true,
    pending: event.websiteDecisionPending === true,
    decidedUrl: event.websiteDecidedUrl ?? null,
    submittedAt: event.websiteSubmittedAt ?? null,
    changedAt: decided,
    reason: event.websiteRedirectReason ?? null,
    changedByName: decided
      ? (event.websiteRedirectChangedBy?.displayName ?? FORMER_ADMINISTRATOR_NAME)
      : null,
    websiteProblem: event.websiteUrl ? websiteUrlProblem(event.websiteUrl) : null,
  }
}

/**
 * Which view of the website link this caller gets.
 *
 *   - `administrator`: holds `website_redirect:manage` (ADMIN, SUPER_ADMIN).
 *   - `insider`: may see the event's drafts (its team, moderators).
 *   - `public`: everybody else.
 *
 * @param {object|null} actor The request actor.
 * @param {object} event The event row.
 * @returns {'administrator'|'insider'|'public'} The view.
 */
export function websiteViewFor(actor, event) {
  if (actor && can(actor, CAPABILITIES.WEBSITE_REDIRECT_MANAGE)) return 'administrator'
  if (actor && maySeeDrafts(event, actor)) return 'insider'

  return 'public'
}

/**
 * The columns a write of `websiteUrl` carries, given the row as it is.
 *
 * Never the switch, the decided address or the reason: those are an
 * administrator's. Waiting is recomputed exactly as trigger
 * `desi_event_website_change` does, and an address already waiting keeps the
 * moment it started to.
 *
 * @param {object|null} current The stored row: `websiteRedirectEnabled`, `websiteDecidedUrl`, `websiteDecisionPending`, `websiteSubmittedAt`; null for a new event.
 * @param {string|null} nextUrl The address being saved, already normalised; null clears it.
 * @param {Date} now The moment.
 * @returns {{websiteUrl: string|null, websiteDecisionPending: boolean, websiteSubmittedAt: Date|null}} The columns.
 */
export function websiteColumnsFor(current, nextUrl, now) {
  const enabled = current?.websiteRedirectEnabled === true
  const decided = current?.websiteDecidedUrl ?? null
  const pending = nextUrl !== decided && (nextUrl !== null || enabled)
  const since =
    current?.websiteDecisionPending === true && current.websiteSubmittedAt
      ? current.websiteSubmittedAt
      : now

  return {
    websiteUrl: nextUrl,
    websiteDecisionPending: pending,
    websiteSubmittedAt: pending ? since : null,
  }
}

/**
 * Read the row inside the caller's transaction and give the columns a write of
 * `websiteUrl` carries.
 *
 * The caller holds the event's row lock (`authorChange`'s revision
 * compare-and-set takes it first), so an administrator's decision either
 * committed before this read or waits for this write: the waiting flag is never
 * computed from a decision that is about to be overwritten.
 *
 * @param {object} tx A transaction client.
 * @param {object} params Inputs.
 * @param {string} params.eventId The event.
 * @param {string|null} params.nextUrl The address being saved, normalised; null clears it.
 * @param {Date} [params.now] The moment.
 * @returns {Promise<object>} The columns, from {@link websiteColumnsFor}.
 */
export async function applyWebsiteChange(tx, { eventId, nextUrl, now = new Date() }) {
  const current = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      websiteRedirectEnabled: true,
      websiteDecidedUrl: true,
      websiteDecisionPending: true,
      websiteSubmittedAt: true,
    },
  })

  if (!current) throw notFound('No such event.')

  return websiteColumnsFor(current, nextUrl, now)
}

/**
 * An address as an audit row may keep it.
 *
 * An address that passes the rules is credential-free by rule and is kept in
 * full. One that does not (a legacy row carried by the migration with a
 * `?token=` in it, decided off) is kept without its query and fragment, the
 * only places a credential could sit once the database's shape check holds.
 *
 * @param {string|null} url The address.
 * @returns {string|null} What the audit row records.
 */
export function auditableAddress(url) {
  if (typeof url !== 'string') return null
  if (websiteUrlProblem(url) === null) return url

  try {
    const parsed = new URL(url)

    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return null
  }
}

/**
 * The refusal for an address the organiser changed after the administrator's
 * page was read.
 *
 * @param {string|null} current The address stored now.
 * @returns {Error} A 409 `WEBSITE_CHANGED`.
 */
function websiteChanged(current) {
  return httpError(
    409,
    'WEBSITE_CHANGED',
    'The organiser changed the website address after you opened this page. Reload to see the address as it is now. Nothing was changed.',
    { currentWebsiteUrl: current ?? null },
  )
}

/** The columns a decision reads first. */
const DECISION_SELECT = Object.freeze({
  id: true,
  status: true,
  websiteUrl: true,
  websiteRedirectEnabled: true,
  websiteDecidedUrl: true,
  websiteDecisionPending: true,
})

/**
 * An administrator's decision, inside a transaction.
 *
 * @param {object} tx A transaction client.
 * @param {object} params See {@link decideWebsiteRedirect}.
 * @returns {Promise<object>} The event after the decision.
 */
async function decideInTransaction(tx, params) {
  const { eventId, enabled, reason, seenUrl, actor, now = new Date() } = params

  if (typeof enabled !== 'boolean') {
    throw new TypeError('A website link decision is on (true) or off (false).')
  }
  if (!actor?.id) throw new TypeError('A website link decision needs the deciding administrator.')

  const seen = seenUrl ?? null

  // The row lock first, so what the audit row says the link was before is what
  // it was: a second administrator's decision waits for this one.
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`

  const before = await tx.event.findUnique({ where: { id: eventId }, select: DECISION_SELECT })

  if (!before) throw notFound('No such event.')

  // A deleted event's switch stays as it was, so a restore brings it back.
  if (before.status === DELETED_STATUS) {
    throw httpError(409, 'NOT_EDITABLE', 'This event was deleted.')
  }

  // The rule on what may be turned on comes first, as SPEC2 §4.W-A orders it:
  // an address that fails it is a 422 whichever address is stored now, and
  // only an acceptable one goes on to the compare below.
  if (enabled) {
    if (seen === null) {
      throw httpError(
        422,
        'NO_WEBSITE',
        'This event has no website address, so there is nothing to link to.',
      )
    }

    const problem = websiteUrlProblem(seen)

    if (problem) {
      throw httpError(
        422,
        'WEBSITE_NOT_ACCEPTABLE',
        `The address does not pass the address rules: ${problem} The organiser has to change it before the link can be turned on.`,
        { problems: [problem] },
      )
    }
  }

  // The decision is about exactly the address on the administrator's screen.
  if (before.websiteUrl !== seen) throw websiteChanged(before.websiteUrl)

  // Compare-and-set on the exact stored string, again in the write: the lock
  // above makes it hold, and it stays the guard for any writer that did not
  // take the lock. Turning on is a change unless the link is already on for
  // this address; turning off is a change while the link is on or an address
  // waits (a decided "off" for it).
  const where = enabled
    ? {
        id: eventId,
        websiteUrl: seen,
        OR: [
          { websiteRedirectEnabled: false },
          { websiteDecidedUrl: null },
          { websiteDecidedUrl: { not: seen } },
        ],
      }
    : {
        id: eventId,
        websiteUrl: seen,
        OR: [{ websiteRedirectEnabled: true }, { websiteDecisionPending: true }],
      }

  const { count } = await tx.event.updateMany({
    where,
    data: {
      websiteRedirectEnabled: enabled,
      websiteDecidedUrl: seen,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedAt: now,
      websiteRedirectChangedById: actor.id,
      websiteRedirectReason: reason,
    },
  })

  if (count !== 1) {
    const current = await tx.event.findUnique({
      where: { id: eventId },
      select: { websiteUrl: true, websiteRedirectEnabled: true },
    })

    if (!current) throw notFound('No such event.')
    if (current.websiteUrl !== seen) throw websiteChanged(current.websiteUrl)

    throw httpError(
      409,
      'WEBSITE_REDIRECT_UNCHANGED',
      enabled
        ? 'The website link is already on for this address. Nothing was changed.'
        : 'The website link is already off, and no address is waiting for a decision. Nothing was changed.',
      { enabled: current.websiteRedirectEnabled },
    )
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.EVENT_WEBSITE_REDIRECT_CHANGED,
    entityType: 'Event',
    entityId: eventId,
    actorId: actor.id,
    metadata: {
      enabled,
      previousEnabled: before.websiteRedirectEnabled === true,
      previousPending: before.websiteDecisionPending === true,
      reason,
      websiteUrl: auditableAddress(seen),
      websiteHost: websiteHost(seen),
      previousDecidedUrl: auditableAddress(before.websiteDecidedUrl),
      platformRole: actor.role ?? null,
      eventStatus: before.status,
    },
  })

  return tx.event.findUnique({ where: { id: eventId }, include: WEBSITE_REDIRECT_INCLUDE })
}

/**
 * The website link's own transaction: the event's row lock and two writes.
 * One that runs out answers 503 and changes nothing.
 */
const REDIRECT_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event was being saved at the same moment, and the website link could not wait for it, so nothing was changed. Try again in a moment.',
})

/**
 * Turn an event's website link on or off: an administrator's decision about
 * the address on their screen.
 *
 * One transaction: the row lock, the compare-and-set on the exact stored
 * address, the write and its audit row. Given a transaction client (see
 * {@link isTransactionClient}) it runs in that transaction and opens none; the
 * importer switches an imported event's link on in the transaction that
 * publishes it. Its own transaction waits behind whatever holds the event's
 * row (a deletion, an edit) for a bounded time; one that runs out answers 503
 * and changes nothing (`lib/transaction-budget.js`). The event's revision is not changed, so an organiser's open
 * editor is not made stale.
 *
 * Authority is the caller's: the route requires `website_redirect:manage` and
 * a MODERATION step-up before this is reached.
 *
 * @param {object} db A Prisma client, or a transaction client already open.
 * @param {object} params Inputs.
 * @param {string} params.eventId The event.
 * @param {boolean} params.enabled On or off.
 * @param {string} params.reason The administrator's reason, 3 to 500 characters.
 * @param {string|null} params.seenUrl The address on the administrator's screen; null for none.
 * @param {object} params.actor The deciding administrator: `id` and `role`.
 * @param {Date} [params.now] The moment.
 * @returns {Promise<object>} The event after the decision, with {@link WEBSITE_REDIRECT_INCLUDE}.
 * @throws {Error} 404 for no such event; 409 `NOT_EDITABLE`, `WEBSITE_CHANGED` or `WEBSITE_REDIRECT_UNCHANGED`; 422 `NO_WEBSITE` or `WEBSITE_NOT_ACCEPTABLE`.
 */
export function decideWebsiteRedirect(db, params) {
  return isTransactionClient(db)
    ? decideInTransaction(db, params)
    : budgetedTransaction(db, REDIRECT_BUDGET, (tx) => decideInTransaction(tx, params))
}

// Kept exported from here for the callers and tests that already import them;
// the one definition of each lives in its own module (`transaction-client.js`,
// and `like-pattern.js` beside the other searches').
export { isTransactionClient, likeLiteral }

/**
 * The Prisma `where` for one filter of the administrators' list.
 *
 * Every filter leaves out a deleted event once events can be deleted.
 *
 * @param {object} query The parsed `websiteLinkListQuerySchema`.
 * @param {string} query.state One of the five states.
 * @param {string} [query.q] Matches the title, the event's web address or its website address.
 * @param {object} [options] Options.
 * @param {ReadonlyArray<string>} [options.statuses] Every event status there is.
 * @returns {object} The `where`.
 */
export function websiteLinkWhere({ state, q }, { statuses = EVENT_STATUSES } = {}) {
  const reviewable = [...WEBSITE_REVIEWABLE_STATUSES].filter((status) => statuses.includes(status))
  /** @type {object[]} */
  const conditions = []

  if (deletedStatusExists(statuses)) conditions.push({ status: { not: DELETED_STATUS } })

  switch (state) {
    case 'drafts':
      conditions.push({ websiteDecisionPending: true, status: { notIn: reviewable } })
      break
    case 'on':
      conditions.push({ websiteRedirectEnabled: true })
      break
    case 'off':
      conditions.push({
        websiteUrl: { not: null },
        websiteRedirectEnabled: false,
        websiteDecisionPending: false,
      })
      break
    case 'all':
      conditions.push({ OR: [{ websiteUrl: { not: null } }, { websiteRedirectEnabled: true }] })
      break
    default:
      conditions.push({ websiteDecisionPending: true, status: { in: reviewable } })
  }

  if (q) {
    // Prisma's `contains` is a LIKE whose pattern it does not escape, so `_`
    // and `%` in a search would match any character. Taken literally here.
    const literal = likeLiteral(q)
    const contains = { contains: literal, mode: 'insensitive' }

    conditions.push({
      OR: [
        { title: contains },
        { slug: { contains: literal.toLowerCase() } },
        { websiteUrl: contains },
      ],
    })
  }

  return { AND: conditions }
}

/**
 * The order of one filter of the administrators' list: what has waited
 * longest first, otherwise the latest decision or change first.
 *
 * @param {string} state One of the five states.
 * @returns {object[]} A Prisma `orderBy`.
 */
export function websiteLinkOrder(state) {
  switch (state) {
    // An "off" row always has a decision time: its address equals the decided
    // one (or it would be waiting), and a decided address has its time
    // (`event_website_redirect_consistency`). So no null sorts first here.
    case 'on':
    case 'off':
      return [{ websiteRedirectChangedAt: 'desc' }, { id: 'asc' }]
    case 'all':
      return [{ updatedAt: 'desc' }, { id: 'asc' }]
    default:
      return [{ websiteSubmittedAt: 'asc' }, { id: 'asc' }]
  }
}

/** What one row of the list reads. */
export const WEBSITE_LINK_ROW_SELECT = Object.freeze({
  id: true,
  slug: true,
  title: true,
  ...WEBSITE_REDIRECT_SELECT,
  organization: { select: { name: true, verificationStatus: true } },
})
