/**
 * Importing listed events onto The Desi Events (SPEC2-XI area I): planning a file,
 * applying the plan, approving, publishing and selling what was imported, and
 * moving an imported event to an organiser's own organisation.
 *
 * ## Where imported events live
 *
 * In one platform-held organisation per source ("The Desi Events",
 * `Organization.platformHeldSource = 'SULEKHA'`), created VERIFIED the first
 * time an import is applied, with no members: the database refuses any
 * (`desi_platform_held_has_no_members`). Each event names the organiser who
 * presents it and keeps the prices the listing gave on its import record.
 *
 * ## Sold here, and nothing goes to the source (2026-10-15)
 *
 * The owner asked that nothing links, redirects or connects to the site the
 * listings came from, and that visitors buy tickets on The Desi Events (and may
 * reserve them on WhatsApp, which the web page offers). So:
 *
 * - **No address, no request.** A file carries no web address
 *   (`lib/import-dataset.js`), an imported event is given no website link, and
 *   nothing is fetched: this module makes no outbound request (a source scan
 *   holds `apps/api/src` to none at all).
 * - **Each listed price is a ticket type** ({@link syncListingTiers}): general
 *   admission, priced as listed in the event's currency (USD at a venue in the
 *   United States, CAD in Canada), an allowance of 100 tickets
 *   (`quantityIsAllowance`, which no page shows as tickets left), 1 to 10 per
 *   order, keyed to its price (`importKey`). A price the listing marked sold
 *   out is made CLOSED. On approval the event is published and its tiers go on
 *   sale from then until it starts ({@link openImportedSales}).
 * - **A re-import never touches a tier that has been sold, ordered or held.**
 *   A tier with none of that takes the listing's price (and is closed when the
 *   listing marks it sold out); a new price is a new tier, not on sale until an
 *   administrator approves it here; a tier the listing no longer gives is
 *   removed. Its allowance and name, as an administrator set them, stay.
 *
 * ## What a run does, and in what order
 *
 * 1. **Preview** reads the uploaded file, plans it against the database and
 *    stores the run, PREVIEWED for an hour. Nothing else is written.
 * 2. **Apply** works the plan out again, refuses one that has changed since the
 *    administrator read it, moves the run PREVIEWED → APPLIED with a
 *    compare-and-set (a second apply of the same run is refused), then writes
 *    each listing in a transaction of its own: its venue, the event as a DRAFT,
 *    its one night, its ticket types, its import record, then the move into
 *    review.
 * 3. **Approve** approves, publishes and opens sales, one transaction per
 *    event, for events this run wrote only.
 *
 * ## The import's own moves
 *
 * The lifecycle table gives DRAFT → REVIEW_PENDING, REVIEW_PENDING → DRAFT,
 * APPROVED → PUBLISHED and PUBLISHED → ON_SALE to the organiser, and Rule L
 * refuses a platform administrator them. An imported event has no organiser
 * here, so the import makes those moves itself ({@link importMove}), as
 * deletion does its own: the move must be in the table, its gates are run, it
 * is written with the lifecycle's own stamps and a moderation action, and
 * audited `event.<status>` with `authority: 'PLATFORM', via: 'IMPORT'`. Only
 * for an event with an import record in a platform-held organisation. Approval
 * itself is a moderator's move and goes through `transitionEvent`, which the
 * administrator is entitled to (`moderation:review`), with the review
 * exemption for the platform's own import (`lib/review-independence.js`).
 *
 * ## What is never made up
 *
 * No availability, end time or price is invented and shown. The allowance is a
 * quantity the database needs; it is marked as one and never shown. A night
 * the listing gives no end for stores start plus three hours, because the
 * column is NOT NULL, flagged `endTimeListed = false`, and no public surface
 * shows it.
 *
 * Only this module writes `EventImportRun` and `EventImportItem` (and, with
 * `lib/organization-provisioning.js`, `platformHeldSource`), and only it writes
 * `TicketType.importKey`.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/lib/event-import
 */

import { ACTORS, PUBLICLY_VISIBLE_STATUSES, findTransition } from '@desi-event/schemas/lifecycle'
import { EVENT_CONTENT_LIMITS } from '@desi-event/schemas/event-content'
import { IMPORT_TIER_DEFAULTS } from '@desi-event/schemas/imports'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { authorChange, tierRemovable, tierUsage } from './event-authoring.js'
import {
  gateProblems,
  lifecycleStamps,
  loadForTransition,
  transitionEvent,
} from './event-lifecycle.js'
import { classifyChanges, materialChangeWork } from './event-material-change.js'
import { approvePendingEventMedia } from './event-media.js'
import {
  conflict,
  databaseRefusal,
  httpError,
  isRetryableConflict,
  notFound,
  unprocessable,
} from './errors.js'
import { disambiguateSlug, slugify } from './identifiers.js'
import {
  canonicalDigest,
  importInvalid,
  listingTiers,
  parseImportDataset,
  planImport,
} from './import-dataset.js'
import { lockTicketTypes } from './inventory.js'
import { equalsIgnoringCase, likeLiteral } from './like-pattern.js'
import { ensurePlatformHeldOrganization, isUniqueViolation } from './organization-provisioning.js'
import {
  LOCK_WAIT_MS,
  TRANSACTION_BUDGETS,
  budgetOptions,
  budgetedTransaction,
  isBudgetRefusal,
} from './transaction-budget.js'
import { decideWebsiteRedirect } from './website-redirect.js'

/** How long a previewed plan may be applied, in milliseconds. */
export const IMPORT_RUN_TTL_MS = 60 * 60_000

/** How long a night the listing gives no end for is planned to last. */
export const ESTIMATED_DURATION_MS = 3 * 3_600_000

/**
 * The venue provenance an import writes. It names no site (2026-10-15):
 * migration `20261015100000_imported_events_sold_here` moved the venues an
 * import wrote before to it.
 */
export const IMPORT_VENUE_PROVENANCE = Object.freeze({ SULEKHA: 'import:listing' })

/**
 * The terms an imported event is listed with (SPEC2-XI I-C). Its tickets are
 * sold on The Desi Events (2026-10-15); a cancelled event's paid orders are
 * refunded here, as any event's are (`lib/event-cancellation.js`).
 */
export const IMPORT_POLICIES = Object.freeze({
  entry:
    'Entry is run by the organiser who presents this event. Bring the ticket you bought on The Desi Events.',
  refund:
    'Tickets for this event are sold on The Desi Events. If the event is cancelled, every ticket bought here is refunded. For anything else, contact The Desi Events before the event.',
  conduct: "The organiser's and the venue's rules apply.",
})

/** Statuses an imported draft is updated in. */
const UPDATABLE_DRAFTS = new Set(['DRAFT', 'CHANGES_REQUIRED', 'REVIEW_PENDING'])

/** Statuses a listing whose content has not changed is sent for review from. */
const RESUBMITTABLE = new Set(['DRAFT', 'CHANGES_REQUIRED'])

/**
 * The run as administrators read it, with who made and applied it.
 */
const RUN_INCLUDE = Object.freeze({
  createdBy: { select: { displayName: true } },
  appliedBy: { select: { displayName: true } },
})

/**
 * What one listing's refusal says when its transaction waited too long
 * behind another change to its event (`lib/transaction-budget.js`). The
 * listing was rolled back whole; the rest of the run went on.
 *
 * @type {string}
 */
export const IMPORT_ROW_OUT_OF_TIME_SENTENCE =
  'Another change to this event was being saved at the same moment, and this listing could not wait for it, so nothing of it was changed. Try again in a moment.'

/**
 * The budgets of an import's transactions. Each writes a row or two and its
 * audit row, behind whatever holds the event's row (or the platform-held
 * organisation's), and says what was not done when it runs out.
 */
const IMPORT_ROW_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal: IMPORT_ROW_OUT_OF_TIME_SENTENCE,
})
const IMPORT_STEP_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change was being saved at the same moment, and this import could not wait for it, so nothing was changed. Try again in a moment.',
})
const IMPORT_SUMMARY_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Every listing this run wrote stands, but its summary could not be saved in time behind another change. Reload the run to see what it wrote.',
})
const BULK_APPROVAL_SUMMARY_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Every event this approved stands, but the record of the request could not be saved in time behind another change. Reload the list to see what is still waiting.',
})
const REASSIGN_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event was being saved at the same moment, and moving it could not wait for it, so nothing was changed: it is still held where it was. Try again in a moment.',
})

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/**
 * The status a run reads as now: a plan not applied within its hour is EXPIRED.
 *
 * @param {{status: string, expiresAt: Date|string}} run The run.
 * @param {Date} now The moment.
 * @returns {string} PREVIEWED, APPLIED or EXPIRED.
 */
export function runStatus(run, now) {
  if (run.status === 'PREVIEWED' && new Date(run.expiresAt).getTime() <= now.getTime()) {
    return 'EXPIRED'
  }

  return run.status
}

/**
 * Whether a database or domain error is one this module reports for one row
 * (or one approval) instead of failing the whole request.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {{code: string, message: string}|null} The refusal, or null for a fault.
 */
export function rowRefusal(error) {
  const mapped = databaseRefusal(error)

  if (mapped) return { code: mapped.code, message: mapped.message }
  if (isRetryableConflict(error)) {
    return {
      code: 'TRY_AGAIN',
      message: 'Another change to this event was being saved at the same moment. Try again.',
    }
  }
  // Its transaction waited past its lock wait behind another change to the
  // event, or ran past its budget (`lib/transaction-budget.js`): rolled back
  // whole, so this listing was left as it was and the rest went on.
  if (isBudgetRefusal(error)) {
    return { code: 'TRY_AGAIN', message: IMPORT_ROW_OUT_OF_TIME_SENTENCE }
  }
  if (isUniqueViolation(error)) {
    return {
      code: 'IMPORT_ROW_CHANGED',
      message:
        'This listing was imported by another run at the same moment. Upload the file again to see it as it is now.',
    }
  }

  const status = /** @type {{statusCode?: number}} */ (error)?.statusCode

  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return {
      code: /** @type {{code?: string}} */ (error).code ?? 'CONFLICT',
      message: String(/** @type {Error} */ (error).message).slice(0, 1000),
    }
  }

  return null
}

/**
 * A listing's night: its own end, or the planning estimate the column needs.
 *
 * @param {object} listing The parsed listing.
 * @returns {{startsAt: Date, endsAt: Date, endTimeListed: boolean}} The night's times.
 */
export function listingTimes(listing) {
  const startsAt = new Date(listing.startsAt)

  if (listing.endsAt) {
    return { startsAt, endsAt: new Date(listing.endsAt), endTimeListed: true }
  }

  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + ESTIMATED_DURATION_MS),
    endTimeListed: false,
  }
}

/**
 * The event's terms from a listing: the import's own sentences, with the age
 * limit the listing names.
 *
 * @param {object} listing The parsed listing.
 * @returns {{entry: string, refund: string, conduct: string}} The policies.
 */
export function listingPolicies(listing) {
  const age = typeof listing.ageRestriction === 'string' ? listing.ageRestriction.trim() : ''

  return {
    entry: age ? `${IMPORT_POLICIES.entry} Age: ${age}.` : IMPORT_POLICIES.entry,
    refund: IMPORT_POLICIES.refund,
    conduct: IMPORT_POLICIES.conduct,
  }
}

/**
 * The event's public content from a listing, held to the editor's own bounds
 * so the event can be edited once it is published.
 *
 * @param {object} listing The parsed listing.
 * @returns {{performers: object[], artists: string[], faq: object[], dressCode: string|null, directions: string|null}} The columns.
 */
export function listingContent(listing) {
  const performers = listing.performers
    .slice(0, EVENT_CONTENT_LIMITS.performers)
    .map((performer) => ({
      name: performer.name.slice(0, EVENT_CONTENT_LIMITS.performerName),
      role: performer.role ? performer.role.slice(0, EVENT_CONTENT_LIMITS.performerRole) : null,
      bio: null,
    }))

  return {
    performers,
    artists: performers.map((performer) => performer.name),
    faq: listing.faq.slice(0, EVENT_CONTENT_LIMITS.faqItems).map((entry) => ({
      question: entry.q.slice(0, EVENT_CONTENT_LIMITS.faqQuestion),
      answer: entry.a.slice(0, EVENT_CONTENT_LIMITS.faqAnswer),
    })),
    dressCode: listing.dressCode
      ? listing.dressCode.slice(0, EVENT_CONTENT_LIMITS.dressCode)
      : null,
    directions: listing.parking ? listing.parking.slice(0, EVENT_CONTENT_LIMITS.directions) : null,
  }
}

/**
 * The prices an import record keeps: as listed, note included (for
 * administrators; no public payload carries it).
 *
 * @param {object} listing The parsed listing.
 * @returns {object[]} The prices.
 */
function listingPrices(listing) {
  return listing.prices.map((price) => ({
    name: price.name,
    priceCents: price.priceCents,
    currency: price.currency,
    note: price.note ?? null,
  }))
}

/**
 * Reuse the platform-held organisation's venue for a listing, or create it:
 * matched on the organisation, the name and the street ignoring case, and the
 * postal code.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {string} options.organizationId The platform-held organisation.
 * @param {object} options.listing The parsed listing.
 * @param {string} options.source The import source.
 * @returns {Promise<string>} The venue's id.
 */
async function venueFor(tx, { organizationId, listing, source }) {
  const { venue } = listing
  const existing = await tx.venue.findFirst({
    where: {
      organizationId,
      name: equalsIgnoringCase(venue.name),
      addressLine1: equalsIgnoringCase(venue.addressLine1),
      postalCode: venue.postalCode,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  if (existing) return existing.id

  const created = await tx.venue.create({
    data: {
      name: venue.name,
      addressLine1: venue.addressLine1,
      city: venue.city,
      region: venue.region,
      postalCode: venue.postalCode,
      country: venue.country,
      timezone: listing.timeZone,
      provenance: IMPORT_VENUE_PROVENANCE[source],
      organizationId,
    },
    select: { id: true },
  })

  return created.id
}

/**
 * A free web address for an imported event's title.
 *
 * @param {object} tx A transaction client.
 * @param {string} title The title.
 * @returns {Promise<string>} The slug.
 */
async function freeSlug(tx, title) {
  const base = slugify(title)
  const taken = await tx.event.findUnique({ where: { slug: base }, select: { id: true } })

  return taken ? disambiguateSlug(base) : base
}

/**
 * Write a listing's prices as the event's ticket types (2026-10-15): one per
 * price ({@link listingTiers}), keyed by `importKey`, in the caller's
 * transaction, which holds the event's row.
 *
 * - A price with no tier yet becomes one: general admission, priced as listed
 *   in the event's currency, an allowance of 100 (`quantityIsAllowance`), 1 to
 *   10 per order, `CLOSED` when the listing marked it sold out and otherwise a
 *   `DRAFT`, which approval puts on sale ({@link openImportedSales}).
 * - A tier that has been sold, ordered or held (`tierUsage`, read under the
 *   tiers' row locks) is never changed.
 * - A tier with none of that takes the listing's price, its currency and its
 *   place in the list, and is closed when the listing marks it sold out; its
 *   name, allowance and status otherwise stay as an administrator left them. A
 *   draft event's tier also goes back to `DRAFT` when the listing no longer
 *   marks it sold out (nobody can have opened it).
 * - A tier the listing no longer gives, with none of that, is removed.
 *
 * Tiers nobody imported (`importKey` null) are never touched.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {string} options.eventId The event.
 * @param {object} options.listing The parsed listing.
 * @param {boolean} options.posted Whether the event is posted (a live edit).
 * @param {Date} options.now The moment.
 * @returns {Promise<{created: number, updated: number, kept: number, removed: number}>} What was done.
 */
export async function syncListingTiers(tx, { eventId, listing, posted, now }) {
  const wanted = listingTiers(listing)
  const found = await tx.ticketType.findMany({
    where: { eventId, importKey: { not: null } },
    select: { id: true },
  })

  // Under each tier's own lock, then read again, as the tier editor does
  // (`routes/event-authoring.js`): a hold locks only its tier, never the
  // event, so without this one could land between the usage read below and a
  // write, and the write would reprice or close a tier a buyer holds. A hold
  // that comes after waits for this transaction and sees the tier as written.
  await lockTicketTypes(
    tx,
    found.map((tier) => tier.id),
  )

  const existing = await tx.ticketType.findMany({
    where: { eventId, importKey: { not: null } },
  })
  const usage = await tierUsage(tx, existing, { now })
  const byKey = new Map(existing.map((tier) => [tier.importKey, tier]))
  const tally = { created: 0, updated: 0, kept: 0, removed: 0 }

  for (const tier of wanted) {
    const current = byKey.get(tier.key)

    byKey.delete(tier.key)

    if (!current) {
      await tx.ticketType.create({
        data: {
          eventId,
          name: tier.name,
          priceCents: tier.priceCents,
          currency: tier.currency,
          quantityTotal: IMPORT_TIER_DEFAULTS.quantityTotal,
          quantityIsAllowance: true,
          minPerOrder: IMPORT_TIER_DEFAULTS.minPerOrder,
          maxPerOrder: IMPORT_TIER_DEFAULTS.maxPerOrder,
          status: tier.soldOut ? 'CLOSED' : 'DRAFT',
          visibility: 'PUBLIC',
          sortOrder: tier.sortOrder,
          importKey: tier.key,
        },
      })
      tally.created += 1
      continue
    }

    if (!tierRemovable(usage.get(current.id))) {
      tally.kept += 1
      continue
    }

    const status = tier.soldOut
      ? 'CLOSED'
      : !posted && current.status === 'CLOSED'
        ? 'DRAFT'
        : current.status

    await tx.ticketType.update({
      where: { id: current.id },
      data: {
        priceCents: tier.priceCents,
        currency: tier.currency,
        sortOrder: tier.sortOrder,
        status,
      },
    })
    tally.updated += 1
  }

  for (const gone of byKey.values()) {
    if (!tierRemovable(usage.get(gone.id))) {
      tally.kept += 1
      continue
    }

    await tx.ticketType.delete({ where: { id: gone.id } })
    tally.removed += 1
  }

  return tally
}

/**
 * The note an import move records on its moderation action.
 *
 * @param {object} run The run.
 * @param {string} [what] What the move did.
 * @returns {string} The note.
 */
function importNote(run, what = 'Imported from its listing') {
  return `${what}, run ${run.id}.`
}

/**
 * One of the import's own moves (DRAFT or CHANGES_REQUIRED → REVIEW_PENDING,
 * REVIEW_PENDING → DRAFT, APPROVED → PUBLISHED), written as the lifecycle
 * writes a move: in the table, its gates open, a compare-and-set on the status
 * with the lifecycle's own stamps, a moderation action and the `event.<status>`
 * audit, in the caller's transaction. Only for an import still held by the
 * platform-held organisation.
 *
 * A move into review also names its administrator as the importer of record
 * (`EventImportItem.importedById`, `importedAt`): the version a reviewer sees
 * is theirs, and the import exemption (SPEC2-XI O5) lets only that
 * administrator approve their own submission. Another administrator who
 * re-imports a changed listing withdraws the event and sends it back, so they
 * become its importer, and the approval records them, not the first importer.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {string} options.eventId The event.
 * @param {string} options.to The destination.
 * @param {{id: string}} options.actor The administrator.
 * @param {string} options.note What the moderation action says.
 * @param {string|null} options.importRunId The run, for the audit.
 * @param {'web'|'cli'|'import'} options.via How the move was asked for.
 * @returns {Promise<object>} The event after the move.
 * @throws {Error} 409 `NOT_PLATFORM_HELD`, `ILLEGAL_TRANSITION` or `STALE_STATUS`; 422 when a gate is shut.
 */
export async function importMove(tx, { eventId, to, actor, note, importRunId, via }) {
  const event = await loadForTransition(tx, eventId)
  const item = await tx.eventImportItem.findUnique({
    where: { eventId },
    select: { id: true, reassignedAt: true, importedById: true },
  })

  if (!item || item.reassignedAt || !event.organization?.platformHeldSource) {
    throw httpError(
      409,
      'NOT_PLATFORM_HELD',
      'This event is not an import held by the team at The Desi Events, so the import cannot move it.',
    )
  }

  const from = event.status
  const move = findTransition(from, to)

  if (!move || move.actor !== ACTORS.ORGANIZER) {
    throw conflict(`An event that is ${from} cannot become ${to} by an import.`, {
      from,
      to,
      code: 'ILLEGAL_TRANSITION',
    })
  }

  const problems = await gateProblems(tx, event, move.gates)

  if (problems.length > 0) {
    throw unprocessable(`This event is not ready to become ${to}.`, { from, to, problems })
  }

  const { count } = await tx.event.updateMany({
    where: { id: event.id, status: from },
    data: lifecycleStamps({ to, reason: null, event }),
  })

  if (count !== 1) {
    throw conflict(`This event is no longer ${from}. Reload and try again.`, {
      from,
      to,
      code: 'STALE_STATUS',
    })
  }

  await tx.eventModerationAction.create({
    data: {
      eventId: event.id,
      actorId: actor.id,
      fromStatus: from,
      toStatus: to,
      reason: note,
    },
  })

  if (to === 'REVIEW_PENDING' && item.importedById !== actor.id) {
    await tx.eventImportItem.update({
      where: { id: item.id },
      data: { importedById: actor.id, importedAt: new Date() },
    })
  }

  await recordAudit(tx, {
    action: `event.${to.toLowerCase()}`,
    entityType: 'Event',
    entityId: event.id,
    actorId: actor.id,
    metadata: {
      authority: 'PLATFORM',
      via: 'IMPORT',
      importRunId,
      requestedVia: via,
      from,
      to,
      reason: note,
    },
  })

  return tx.event.findUnique({ where: { id: event.id } })
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * The most a run's dataset may take as PostgreSQL stores it: the run's CHECK
 * `event_import_run_shape` holds `octet_length("dataset"::text)` to 2 MiB.
 */
export const RUN_DATASET_BYTES = 2 * 1024 * 1024

/**
 * How many bytes the text form of a `jsonb` value takes, which is what the
 * run's CHECK measures. PostgreSQL writes `", "` between members and `": "`
 * after each key, so the stored text is longer than `JSON.stringify`'s by
 * about one byte per key and per member (some 3% on the North America file).
 * Strings and numbers are written as `JSON.stringify` writes them: both
 * escape the same characters and keep other characters as UTF-8.
 *
 * @param {unknown} value A JSON value, as Prisma would send it.
 * @returns {number} Its size in bytes.
 */
export function jsonbTextBytes(value) {
  const json =
    value !== null && typeof value === 'object' && typeof value.toJSON === 'function'
      ? value.toJSON()
      : value

  if (Array.isArray(json)) {
    return json.reduce(
      (sum, item, index) => sum + (index > 0 ? 2 : 0) + jsonbTextBytes(item ?? null),
      2,
    )
  }

  if (json !== null && typeof json === 'object') {
    const members = Object.entries(json).filter(
      ([, item]) => item !== undefined && typeof item !== 'function',
    )

    return members.reduce(
      (sum, [key, item], index) =>
        sum +
        (index > 0 ? 2 : 0) +
        Buffer.byteLength(JSON.stringify(key), 'utf8') +
        2 +
        jsonbTextBytes(item),
      2,
    )
  }

  return Buffer.byteLength(JSON.stringify(json) ?? 'null', 'utf8')
}

/**
 * Read an uploaded file, plan it and store the run (SPEC2-XI I-C).
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {string} options.fileName The file's name.
 * @param {unknown} options.dataset The file as uploaded.
 * @param {{id: string}} options.actor The administrator.
 * @param {'web'|'cli'} options.via Where it came from.
 * @param {Date} [options.now] The moment.
 * @returns {Promise<object>} The run.
 * @throws {Error} 422 `IMPORT_INVALID` with every problem.
 */
export async function previewImport(
  prisma,
  { fileName, dataset: raw, actor, via, now = new Date() },
) {
  const { dataset, problems } = parseImportDataset(raw)

  if (!dataset) throw importInvalid(problems)

  // The run keeps the file as it was read, and the database holds it to 2 MiB
  // measured as it stores it, which is longer than the file the request
  // carried: refused here, with the reason, rather than by the CHECK.
  if (jsonbTextBytes(dataset) > RUN_DATASET_BYTES) {
    throw importInvalid([
      'The file: keep it to 2 MiB. Stored, it takes a little more room than the file (a space after every ":" and ","), and this one would be over.',
    ])
  }

  const { rows, planDigest } = await planImport(prisma, { dataset, now })
  const counts = countBy(rows.map((row) => row.action))

  return prisma.$transaction(async (tx) => {
    const run = await tx.eventImportRun.create({
      data: {
        source: dataset.source,
        status: 'PREVIEWED',
        fileName,
        datasetSha256: canonicalDigest(dataset),
        dataset,
        plan: rows,
        planDigest,
        eventCount: rows.length,
        createdById: actor.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IMPORT_RUN_TTL_MS),
      },
      include: RUN_INCLUDE,
    })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_PREVIEWED,
      entityType: 'EventImportRun',
      entityId: run.id,
      actorId: actor.id,
      metadata: {
        source: dataset.source,
        fileName,
        datasetSha256: run.datasetSha256,
        planDigest,
        eventCount: rows.length,
        actions: counts,
        via,
      },
    })

    return run
  })
}

/**
 * Count values.
 *
 * @param {string[]} values The values.
 * @returns {Record<string, number>} How many of each.
 */
function countBy(values) {
  /** @type {Record<string, number>} */
  const counts = {}

  for (const value of values) counts[value] = (counts[value] ?? 0) + 1

  return counts
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Find the platform-held organisation, creating it the first time; a second
 * import creating it at the same moment reads the first one's.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {string} options.source The source.
 * @param {{id: string}} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @returns {Promise<object>} The organisation.
 */
async function platformHeldOrganization(prisma, { source, actor, now }) {
  try {
    const { organization } = await budgetedTransaction(prisma, IMPORT_STEP_BUDGET, (tx) =>
      ensurePlatformHeldOrganization(tx, { source, actor, now }),
    )

    return organization
  } catch (error) {
    if (!isUniqueViolation(error)) throw error

    const { organization } = await budgetedTransaction(prisma, IMPORT_STEP_BUDGET, (tx) =>
      ensurePlatformHeldOrganization(tx, { source, actor, now }),
    )

    return organization
  }
}

/**
 * Create a listing's event, night, ticket types and import record, then send
 * it for review. In one transaction.
 *
 * @param {object} tx A transaction client.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @returns {Promise<string>} The event's id.
 */
async function createImported(tx, context, listing) {
  const { run, organization, actor, now, via } = context
  const venueId = await venueFor(tx, {
    organizationId: organization.id,
    listing,
    source: run.source,
  })
  const times = listingTimes(listing)
  const content = listingContent(listing)
  const policies = listingPolicies(listing)

  const event = await tx.event.create({
    data: {
      organizationId: organization.id,
      venueId,
      title: listing.title,
      slug: await freeSlug(tx, listing.title),
      summary: listing.summary,
      description: listing.description,
      category: listing.category,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: listing.timeZone,
      isOnline: false,
      languages: listing.languages,
      policies,
      performers: content.performers,
      artists: content.artists,
      faq: content.faq,
      dressCode: content.dressCode,
      directions: content.directions,
      // No website link: nothing on The Desi Events points at the site the
      // listing came from (2026-10-15). Its tickets are its ticket types.
      publishedAt: null,
      status: 'DRAFT',
    },
    select: { id: true },
  })

  await tx.eventSession.create({
    data: {
      eventId: event.id,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: listing.timeZone,
      endTimeListed: times.endTimeListed,
      sortOrder: 0,
    },
  })

  await syncListingTiers(tx, { eventId: event.id, listing, posted: false, now })

  await tx.eventImportItem.create({
    data: {
      source: run.source,
      sourceId: listing.sourceId,
      eventId: event.id,
      lastRunId: run.id,
      importedById: actor.id,
      importedAt: now,
      lastSyncedAt: now,
      scrapedAt: new Date(listing.scrapedAt),
      presentedBy: listing.presentedBy,
      prices: listingPrices(listing),
      priceText: listing.priceText,
      importNotes: listing.importNotes,
    },
    select: { id: true },
  })

  await importMove(tx, {
    eventId: event.id,
    to: 'REVIEW_PENDING',
    actor,
    note: importNote(run),
    importRunId: run.id,
    via,
  })

  return event.id
}

/**
 * The import record and the event as they stand, locked.
 *
 * @param {object} tx A transaction client.
 * @param {object} row The plan row.
 * @param {object} run The run.
 * @returns {Promise<object>} `{ item, event }`: the import record and the event.
 * @throws {Error} 409 `IMPORT_ROW_CHANGED` when the event moved since the plan.
 */
async function lockedImport(tx, row, run) {
  const item = await tx.eventImportItem.findUnique({
    where: { source_sourceId: { source: run.source, sourceId: row.sourceId } },
    select: { id: true, eventId: true, reassignedAt: true },
  })

  if (!item || item.eventId !== row.eventId || item.reassignedAt) throw rowChanged()

  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${item.eventId} FOR UPDATE`

  const event = await tx.event.findUnique({
    where: { id: item.eventId },
    include: {
      organization: { select: { platformHeldSource: true } },
      sessions: { orderBy: { startsAt: 'asc' } },
    },
  })

  if (!event || !event.organization?.platformHeldSource || event.status !== row.eventStatus) {
    throw rowChanged()
  }

  return { item, event }
}

/**
 * The refusal for a listing whose event changed between the plan and now.
 *
 * @returns {Error} 409 `IMPORT_ROW_CHANGED`.
 */
function rowChanged() {
  return httpError(
    409,
    'IMPORT_ROW_CHANGED',
    'This event changed after the plan was made, so it was left as it is. Upload the file again to plan it as it is now.',
  )
}

/**
 * Update an imported draft from its listing and send it for review again. An
 * event waiting for review is withdrawn to a draft first, in the same
 * transaction. Its ticket types are matched to the listing's prices
 * ({@link syncListingTiers}). Its website address is left as it is: the import
 * never sets one.
 *
 * @param {object} tx A transaction client.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @param {object} row The plan row.
 * @returns {Promise<string>} The event's id.
 */
async function updateImportedDraft(tx, context, listing, row) {
  const { run, actor, now, via } = context
  const { item, event } = await lockedImport(tx, row, run)

  if (!UPDATABLE_DRAFTS.has(event.status)) throw rowChanged()

  if (event.status === 'REVIEW_PENDING') {
    await importMove(tx, {
      eventId: event.id,
      to: 'DRAFT',
      actor,
      note: importNote(run, 'Withdrawn to update it from its source listing'),
      importRunId: run.id,
      via,
    })
  }

  const venueId = await venueFor(tx, {
    organizationId: event.organizationId,
    listing,
    source: run.source,
  })
  const times = listingTimes(listing)
  const content = listingContent(listing)
  const policies = listingPolicies(listing)

  await tx.event.update({
    where: { id: event.id },
    data: {
      venueId,
      title: listing.title,
      summary: listing.summary,
      description: listing.description,
      category: listing.category,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: listing.timeZone,
      languages: listing.languages,
      policies,
      performers: content.performers,
      artists: content.artists,
      faq: content.faq,
      dressCode: content.dressCode,
      directions: content.directions,
      revision: { increment: 1 },
    },
  })

  await writeNight(tx, event, times, listing)
  await syncListingTiers(tx, { eventId: event.id, listing, posted: false, now })
  await writeItem(tx, item.id, context, listing)

  await importMove(tx, {
    eventId: event.id,
    to: 'REVIEW_PENDING',
    actor,
    note: importNote(run, 'Updated from its source listing'),
    importRunId: run.id,
    via,
  })

  return event.id
}

/**
 * Move the event's one night to the listing's times.
 *
 * @param {object} tx A transaction client.
 * @param {object} event The event, with `sessions`.
 * @param {{startsAt: Date, endsAt: Date, endTimeListed: boolean}} times The listing's times.
 * @param {object} listing The parsed listing.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeNight(tx, event, times, listing) {
  const night = (event.sessions ?? [])[0]

  if (!night) {
    await tx.eventSession.create({
      data: {
        eventId: event.id,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        timezone: listing.timeZone,
        endTimeListed: times.endTimeListed,
        sortOrder: 0,
      },
    })

    return
  }

  await tx.eventSession.update({
    where: { id: night.id },
    data: {
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: listing.timeZone,
      endTimeListed: times.endTimeListed,
    },
  })
}

/**
 * Record on the import record that this run wrote (or confirmed) the listing.
 *
 * @param {object} tx A transaction client.
 * @param {string} itemId The import record.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeItem(tx, itemId, context, listing) {
  await tx.eventImportItem.update({
    where: { id: itemId },
    data: {
      lastRunId: context.run.id,
      lastSyncedAt: context.now,
      scrapedAt: new Date(listing.scrapedAt),
      presentedBy: listing.presentedBy,
      prices: listingPrices(listing),
      priceText: listing.priceText,
      importNotes: listing.importNotes,
    },
  })
}

/**
 * Confirm a listing that has not changed: the import record moves to this run,
 * and a draft or an event sent back for changes is sent for review again.
 *
 * @param {object} tx A transaction client.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @param {object} row The plan row.
 * @returns {Promise<string>} The event's id.
 */
async function confirmUnchanged(tx, context, listing, row) {
  const { run, actor, via } = context
  const { item, event } = await lockedImport(tx, row, run)

  await writeItem(tx, item.id, context, listing)

  if (row.resubmit && RESUBMITTABLE.has(event.status)) {
    await importMove(tx, {
      eventId: event.id,
      to: 'REVIEW_PENDING',
      actor,
      note: importNote(run, 'Sent for review again by an import'),
      importRunId: run.id,
      via,
    })
  }

  return event.id
}

/**
 * Update a posted event from its listing, as a live edit by the team at The
 * Desi Events (`authorChange` under the import's authority): the date, the place and
 * the terms change with a change notice for ticket holders. Its ticket types
 * follow the listing's prices without touching one that has been sold,
 * ordered or held ({@link syncListingTiers}); a new one waits, not on sale,
 * for "Approve and publish". Its website address is left as it is.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @param {object} row The plan row.
 * @returns {Promise<string>} The event's id.
 */
async function updatePosted(prisma, context, listing, row) {
  const { run, actor, now } = context
  const event = await prisma.event.findUnique({
    where: { id: row.eventId },
    include: {
      organization: { select: { platformHeldSource: true } },
      sessions: { orderBy: { startsAt: 'asc' } },
      importItem: { select: { id: true, reassignedAt: true } },
    },
  })

  if (
    !event ||
    !event.importItem ||
    event.importItem.reassignedAt ||
    !event.organization?.platformHeldSource ||
    event.status !== row.eventStatus ||
    !PUBLICLY_VISIBLE_STATUSES.has(event.status)
  ) {
    throw rowChanged()
  }

  const authority = {
    kind: 'PLATFORM',
    via: 'IMPORT',
    editId: null,
    reason: null,
    importRunId: run.id,
  }
  const times = listingTimes(listing)
  const content = listingContent(listing)
  const policies = listingPolicies(listing)
  const reason = `Updated from its source listing by the team at The Desi Events, run ${run.id}.`
  let material = []
  let tiers = null

  await authorChange(prisma, {
    event,
    revision: event.revision,
    actor,
    authority,
    action: 'event.updated',
    metadata: () => ({
      via: 'import',
      importRunId: run.id,
      sourceId: listing.sourceId,
      material,
      ticketTypes: tiers,
    }),
    write: async (tx) => {
      const venueId = await venueFor(tx, {
        organizationId: event.organizationId,
        listing,
        source: run.source,
      })
      const patch = {
        venueId,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        timezone: listing.timeZone,
        policies,
      }
      const changes = classifyChanges(event, patch)

      material = changes.material

      await tx.event.update({
        where: { id: event.id },
        data: {
          venueId,
          title: listing.title,
          summary: listing.summary,
          description: listing.description,
          category: listing.category,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          timezone: listing.timeZone,
          languages: listing.languages,
          policies,
          performers: content.performers,
          artists: content.artists,
          faq: content.faq,
          dressCode: content.dressCode,
          directions: content.directions,
        },
      })

      await writeNight(tx, event, times, listing)
      tiers = await syncListingTiers(tx, { eventId: event.id, listing, posted: true, now })

      if (material.length > 0) {
        await materialChangeWork(tx, {
          event,
          revision: event.revision + 1,
          material,
          before: changes.before,
          after: changes.after,
          reason,
          byPlatform: true,
        })
      }

      await writeItem(tx, event.importItem.id, context, listing)

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.EVENT_IMPORTED,
        entityType: 'Event',
        entityId: event.id,
        actorId: actor.id,
        metadata: {
          mode: 'UPDATE_POSTED',
          sourceId: listing.sourceId,
          importRunId: run.id,
          via: context.via,
        },
      })
    },
  })

  return event.id
}

/**
 * Apply a previewed run (SPEC2-XI I-C).
 *
 * The plan is worked out again and must give the digest the administrator
 * read (409 `IMPORT_PLAN_CHANGED`); the run moves PREVIEWED → APPLIED once
 * (409 `IMPORT_RUN_APPLIED`), within its hour (409 `IMPORT_RUN_EXPIRED`). Then
 * each listing is written in a transaction of its own; one that fails is
 * reported in the summary and the rest go on. Nothing is fetched.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {object} options.run The run row.
 * @param {{id: string}} options.actor The administrator.
 * @param {string} options.planDigest The digest of the plan the administrator read.
 * @param {string[]} [options.updateFromSource] Posted listings to update; never from the command line.
 * @param {'web'|'cli'} options.via Where it came from.
 * @param {Date} [options.now] The moment.
 * @param {object} [options.log] A logger.
 * @returns {Promise<{results: object[]}>} What each listing did.
 */
export async function applyImport(prisma, options) {
  const { run, actor, planDigest, updateFromSource = [], via, now = new Date(), log } = options

  if (via === 'cli' && updateFromSource.length > 0) {
    throw new TypeError('The command line never updates a posted event.')
  }

  assertApplicable(run, now)

  if (planDigest !== run.planDigest) throw planChanged()

  const { dataset } = parseImportDataset(run.dataset)

  if (!dataset) throw planChanged()

  const { rows, planDigest: again } = await planImport(prisma, { dataset, now })

  if (again !== run.planDigest) throw planChanged()

  const updatable = new Set(rows.filter((row) => row.updatable).map((row) => row.sourceId))
  const unknown = updateFromSource.filter((sourceId) => !updatable.has(sourceId))

  if (unknown.length > 0) {
    throw unprocessable(
      'Only a posted event whose source listing changed can be updated from it.',
      {
        problems: unknown.map(
          (sourceId) => `Listing ${sourceId} cannot be updated from its source listing.`,
        ),
      },
    )
  }

  // Once, whatever arrives together: the compare-and-set on the run.
  const { count } = await prisma.eventImportRun.updateMany({
    where: { id: run.id, status: 'PREVIEWED', expiresAt: { gt: now } },
    data: { status: 'APPLIED', appliedAt: now, appliedById: actor.id },
  })

  if (count !== 1) {
    const current = await prisma.eventImportRun.findUnique({
      where: { id: run.id },
      select: { status: true, expiresAt: true },
    })

    assertApplicable(current ?? run, now)

    throw runApplied()
  }

  const organization = await platformHeldOrganization(prisma, {
    source: dataset.source,
    actor,
    now,
  })
  const context = { run, organization, actor, now, via }
  const listings = new Map(dataset.events.map((listing) => [listing.sourceId, listing]))
  const chosen = new Set(updateFromSource)
  const results = []

  for (const row of rows) {
    const listing = listings.get(row.sourceId)
    const mode =
      row.action === 'POSTED_KEPT' && chosen.has(row.sourceId) ? 'UPDATE_POSTED' : row.action

    if (!['CREATE', 'UPDATE_DRAFT', 'UNCHANGED', 'UPDATE_POSTED'].includes(mode)) {
      results.push({ sourceId: row.sourceId, mode, eventId: row.eventId, outcome: 'LEFT' })
      continue
    }

    try {
      const eventId =
        mode === 'UPDATE_POSTED'
          ? await updatePosted(prisma, context, listing, row)
          : await budgetedTransaction(prisma, IMPORT_ROW_BUDGET, async (tx) => {
              const id =
                mode === 'CREATE'
                  ? await createImported(tx, context, listing)
                  : mode === 'UPDATE_DRAFT'
                    ? await updateImportedDraft(tx, context, listing, row)
                    : await confirmUnchanged(tx, context, listing, row)

              await recordAudit(tx, {
                action: AUDIT_ACTIONS.EVENT_IMPORTED,
                entityType: 'Event',
                entityId: id,
                actorId: actor.id,
                metadata: { mode, sourceId: row.sourceId, importRunId: run.id, via },
              })

              return id
            })

      results.push({ sourceId: row.sourceId, mode, eventId, outcome: 'WRITTEN' })
    } catch (error) {
      const refusal = rowRefusal(error)

      if (!refusal) throw error

      log?.warn?.(
        { runId: run.id, sourceId: row.sourceId, code: refusal.code },
        'an import row was refused',
      )
      results.push({
        sourceId: row.sourceId,
        mode,
        eventId: row.eventId,
        outcome: 'REFUSED',
        ...refusal,
      })
    }
  }

  const summary = summarise(results)

  await budgetedTransaction(prisma, IMPORT_SUMMARY_BUDGET, async (tx) => {
    await tx.eventImportRun.update({ where: { id: run.id }, data: { summary } })
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_APPLIED,
      entityType: 'EventImportRun',
      entityId: run.id,
      actorId: actor.id,
      metadata: { summary, updateFromSource: updateFromSource.length, via },
    })
  })

  return { results }
}

/**
 * What applying did, by what it did: each written mode, `FAILED` for a
 * listing refused, and each action it left alone.
 *
 * @param {object[]} results Per listing.
 * @returns {Record<string, number>} The counts.
 */
function summarise(results) {
  return countBy(
    results.map((result) => {
      if (result.outcome === 'REFUSED') return 'FAILED'

      return result.mode
    }),
  )
}

/**
 * Refuse a run that cannot be applied now.
 *
 * @param {{status: string, expiresAt: Date|string}} run The run.
 * @param {Date} now The moment.
 * @returns {void}
 * @throws {Error} 409 `IMPORT_RUN_APPLIED` or `IMPORT_RUN_EXPIRED`.
 */
function assertApplicable(run, now) {
  if (run.status === 'APPLIED') throw runApplied()

  if (runStatus(run, now) === 'EXPIRED') {
    throw httpError(
      409,
      'IMPORT_RUN_EXPIRED',
      'This plan was made more than an hour ago, so it was not applied. Upload the file again to plan it as things are now.',
    )
  }
}

/**
 * @returns {Error} 409 `IMPORT_RUN_APPLIED`.
 */
function runApplied() {
  return httpError(
    409,
    'IMPORT_RUN_APPLIED',
    'This plan has already been applied. Nothing was changed.',
  )
}

/**
 * @returns {Error} 409 `IMPORT_PLAN_CHANGED`.
 */
function planChanged() {
  return httpError(
    409,
    'IMPORT_PLAN_CHANGED',
    'What The Desi Events holds changed after this plan was made, so it was not applied. Upload the file again to plan it as things are now.',
  )
}

// ---------------------------------------------------------------------------
// Approve, publish and open sales
// ---------------------------------------------------------------------------

/**
 * @returns {Error} 409 `NOT_IN_RUN`.
 */
function notInRun() {
  return httpError(
    409,
    'NOT_IN_RUN',
    'This event was not imported by this run, so it cannot be approved from here.',
  )
}

/**
 * "Approve and publish" (SPEC2-XI I-C): one transaction per event, each
 * refusal reported for its event. Each must be an event this run last wrote,
 * still in the platform-held organisation; then by its status:
 *
 * - REVIEW_PENDING: approved through `transitionEvent`, published by the
 *   import's own move and put on sale ({@link openImportedSales}), all in the
 *   approval's transaction, at the revision the page showed.
 * - APPROVED (a moderator approved it): published and put on sale.
 * - Posted: its imported tiers not yet on sale are put on sale, and a
 *   PUBLISHED event moves to ON_SALE (`SALES_OPENED`); one with nothing to put
 *   on sale is refused `NOT_EDITABLE`.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {Array<{eventId: string, revision: number}>} options.items What the page showed.
 * @param {object} options.actor The administrator.
 * @param {Date} [options.now] The moment.
 * @returns {Promise<object[]>} One result per item, in the order asked.
 */
export async function approveImported(prisma, { run, items, actor, now = new Date() }) {
  return approveEach(prisma, { run, items, actor, now })
}

/**
 * The approvals one request makes, one transaction each ({@link approveOne}),
 * a refusal reported for its event and the rest carried on. The one step both
 * a run's approval and "approve all pending" take.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {object} options.run The run the events are approved from.
 * @param {Array<{eventId: string, revision: number}>} options.items The events, at the revisions read.
 * @param {object} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @returns {Promise<object[]>} One result per item, in the order given.
 */
async function approveEach(prisma, { run, items, actor, now }) {
  const results = []

  for (const item of items) {
    try {
      results.push(await approveOne(prisma, { run, item, actor, now }))
    } catch (error) {
      const refusal = rowRefusal(error)

      if (!refusal) throw error

      results.push({
        eventId: item.eventId,
        outcome: 'REFUSED',
        status: null,
        revision: null,
        ticketTypesOnSale: 0,
        ...refusal,
      })
    }
  }

  return results
}

/**
 * How far ahead of its start an imported event must be for "approve all
 * pending" to take it: the margin {@link openImportedSales} keeps before it
 * opens sales, so every event taken can still have something sold.
 */
const PENDING_LEAD_MS = 60_000

/** The statuses an imported event waits for approval in. */
const AWAITING_APPROVAL = Object.freeze(['REVIEW_PENDING', 'APPROVED'])

/**
 * Every imported event waiting for "Approve and publish", across every run.
 *
 * An event is waiting when its import record has not been moved to an
 * organiser's organisation, it is still in the platform-held organisation,
 * the run that last wrote it was applied, and it is either REVIEW_PENDING or
 * APPROVED, or PUBLISHED with an imported ticket type still a DRAFT that can
 * go on sale. Only events that start more than a minute from now are taken;
 * the rest are counted as `past`. Each is approved from the run that last
 * wrote it, which is the only run `approveOne` accepts, so a listing two runs
 * imported is approved once, from the later.
 *
 * The digest is over each waiting event's id, revision and last run, in id
 * order: a change to any of them, an event joining or leaving, changes it.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The moment.
 * @param {string[]} [options.runIds] Only the events these runs last wrote. The routes never pass it: it is for a caller that shares the database with imports it must not touch (the integration suites).
 * @returns {Promise<{digest: string, total: number, willGoOnSale: number, publishedNothingToSell: number, past: number, items: object[]}>} The list and its counts.
 */
export async function pendingImports(prisma, { now = new Date(), runIds } = {}) {
  const records = await prisma.eventImportItem.findMany({
    where: {
      reassignedAt: null,
      lastRunId: Array.isArray(runIds) ? { in: runIds } : { not: null },
      lastRun: { status: 'APPLIED' },
      event: {
        organization: { platformHeldSource: { not: null } },
        OR: [
          { status: { in: [...AWAITING_APPROVAL] } },
          {
            status: 'PUBLISHED',
            ticketTypes: { some: { importKey: { not: null }, status: 'DRAFT' } },
          },
        ],
      },
    },
    select: {
      sourceId: true,
      lastRunId: true,
      event: {
        select: {
          id: true,
          title: true,
          status: true,
          revision: true,
          startsAt: true,
          venue: { select: { city: true, region: true } },
          ticketTypes: { select: { status: true, importKey: true } },
        },
      },
    },
  })

  const from = now.getTime() + PENDING_LEAD_MS
  const waiting = records.filter((record) => new Date(record.event.startsAt).getTime() > from)
  const items = waiting
    .map((record) => {
      const { event } = record
      const tiers = event.ticketTypes ?? []
      const opens = tiers.filter((tier) => tier.importKey !== null && tier.status === 'DRAFT')
      const onSale = tiers.filter((tier) => tier.status === 'ON_SALE')

      return {
        eventId: event.id,
        title: event.title,
        startsAt: new Date(event.startsAt).toISOString(),
        status: event.status,
        revision: event.revision,
        runId: record.lastRunId,
        sourceId: record.sourceId,
        city: event.venue?.city ?? null,
        region: event.venue?.region ?? null,
        willGoOnSale: opens.length > 0 || onSale.length > 0,
      }
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.eventId.localeCompare(b.eventId))

  const digest = canonicalDigest(
    [...items]
      .sort((a, b) => a.eventId.localeCompare(b.eventId))
      .map(({ eventId, revision, runId }) => ({ eventId, revision, lastRunId: runId })),
  )
  const willGoOnSale = items.filter((item) => item.willGoOnSale).length

  return {
    digest,
    total: items.length,
    willGoOnSale,
    publishedNothingToSell: items.length - willGoOnSale,
    past: records.length - waiting.length,
    items,
  }
}

/**
 * The refusal for a confirmation of a list that is no longer the list.
 *
 * @returns {Error} 409 `IMPORT_PENDING_CHANGED`.
 */
function pendingChanged() {
  return httpError(
    409,
    'IMPORT_PENDING_CHANGED',
    'The imported events waiting for approval changed after you read the list, so nothing was approved. Read the list again and confirm what it says now.',
  )
}

/**
 * "Approve and publish all pending imported events": every event
 * {@link pendingImports} lists, each through the same `approveOne` a run's
 * page uses — its own transaction, the lifecycle's gates, the reviewer
 * independence exemption and the `event.approved` and `event.published`
 * audit rows — from the run that last wrote it, at the revision the list
 * held. A refusal is that event's alone and is reported; the rest go on.
 * One `event_import.bulk_approved` row records the request.
 *
 * The list is worked out again first and must give the digest the
 * administrator confirmed (409 `IMPORT_PENDING_CHANGED`), so what is
 * approved is exactly what they were shown. A second call finds the list
 * changed — every event it approved has left it — and approves nothing.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {string} options.digest The digest the administrator confirmed.
 * @param {object} options.actor The administrator.
 * @param {Date} [options.now] The moment.
 * @param {string[]} [options.runIds] Only these runs' events, as {@link pendingImports} takes it; the route never passes it.
 * @returns {Promise<object>} The counts, each event's result and the refusals.
 * @throws {Error} 409 `IMPORT_PENDING_CHANGED`.
 */
export async function approvePendingImports(prisma, { digest, actor, now = new Date(), runIds }) {
  const pending = await pendingImports(prisma, { now, runIds })

  if (pending.digest !== digest) throw pendingChanged()

  const fromRuns = [...new Set(pending.items.map((item) => item.runId))]
  const runs = new Map(
    (await prisma.eventImportRun.findMany({ where: { id: { in: fromRuns } } })).map((run) => [
      run.id,
      run,
    ]),
  )
  const results = []

  for (const item of pending.items) {
    const run = runs.get(item.runId)

    if (!run) {
      results.push({
        eventId: item.eventId,
        outcome: 'REFUSED',
        status: null,
        revision: null,
        ticketTypesOnSale: 0,
        code: 'NOT_IN_RUN',
        message: notInRun().message,
      })
      continue
    }

    const [result] = await approveEach(prisma, {
      run,
      items: [{ eventId: item.eventId, revision: item.revision }],
      actor,
      now,
    })

    results.push(result)
  }

  const refusals = results
    .filter((result) => result.outcome === 'REFUSED')
    .map(({ eventId, code, message }) => ({ eventId, code, message }))
  const summary = {
    total: results.length,
    onSale: results.filter((result) => result.status === 'ON_SALE').length,
    publishedNothingToSell: results.filter(
      (result) => result.outcome !== 'REFUSED' && result.status === 'PUBLISHED',
    ).length,
    refused: refusals.length,
  }

  await budgetedTransaction(prisma, BULK_APPROVAL_SUMMARY_BUDGET, async (tx) => {
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_BULK_APPROVED,
      entityType: 'EventImport',
      entityId: 'pending',
      actorId: actor.id,
      metadata: {
        digest,
        ...summary,
        skippedPast: pending.past,
        runIds: fromRuns,
        refusals: refusals.map(({ eventId, code }) => ({ eventId, code })),
      },
    })
  })

  return { ...summary, skippedPast: pending.past, results, refusals }
}

/**
 * The checks every approval makes first: this run's import, still held.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} run The run.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The import record, with the event and its organisation.
 * @throws {Error} 409 `NOT_IN_RUN` or `NOT_PLATFORM_HELD`.
 */
async function approvableItem(db, run, eventId) {
  const record = await db.eventImportItem.findUnique({
    where: { eventId },
    select: {
      id: true,
      lastRunId: true,
      reassignedAt: true,
      importedById: true,
      event: {
        select: {
          id: true,
          status: true,
          revision: true,
          startsAt: true,
          organizationId: true,
          organization: { select: { platformHeldSource: true } },
        },
      },
    },
  })

  if (!record || record.lastRunId !== run.id) throw notInRun()

  if (record.reassignedAt || !record.event?.organization?.platformHeldSource) {
    throw httpError(
      409,
      'NOT_PLATFORM_HELD',
      'This event has been moved to an organiser’s own organisation, so its organiser publishes it.',
    )
  }

  return record
}

/**
 * The refusal for a page that showed another revision.
 *
 * @param {number} expected What the page showed.
 * @param {number} current What the event has.
 * @returns {Error} 409 `STALE_REVISION`.
 */
function staleRevision(expected, current) {
  return httpError(
    409,
    'STALE_REVISION',
    'This event changed after you opened the page. Reload to review it as it is now. Nothing was decided.',
    { expectedRevision: expected, currentRevision: current },
  )
}

/** The statuses whose imported tiers {@link openImportedSales} may put on sale. */
const SALES_OPENABLE = new Set(['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT'])

/**
 * Put an imported event on sale, in the caller's transaction, which holds the
 * event's row: each tier the import made that is still a `DRAFT` goes
 * `ON_SALE`, from now until the event starts (a tier it made `CLOSED`, sold out
 * on the listing, stays closed), and a PUBLISHED event moves to ON_SALE by the
 * import's own move, through the lifecycle's gates. An event that starts
 * within the minute, or has nothing to put on sale, is left as it is.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {string} options.eventId The event.
 * @param {object} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @returns {Promise<{opened: number, onSale: number}>} How many tiers this put on sale, and how many are on sale now.
 */
async function openImportedSales(tx, { run, eventId, actor, now }) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true, startsAt: true },
  })

  if (!event || !SALES_OPENABLE.has(event.status)) return { opened: 0, onSale: 0 }

  const startsAt = new Date(event.startsAt)
  let opened = 0

  if (startsAt.getTime() - now.getTime() > 60_000) {
    const { count } = await tx.ticketType.updateMany({
      where: { eventId, importKey: { not: null }, status: 'DRAFT' },
      data: { status: 'ON_SALE', salesStartAt: now, salesEndAt: startsAt },
    })

    opened = count
  }

  const onSale = await tx.ticketType.count({ where: { eventId, status: 'ON_SALE' } })

  if (onSale > 0 && event.status === 'PUBLISHED') {
    await importMove(tx, {
      eventId,
      to: 'ON_SALE',
      actor,
      note: importNote(run, 'Sales opened by the team at The Desi Events'),
      importRunId: run.id,
      via: 'web',
    })
  }

  return { opened, onSale }
}

/**
 * Publish an approved import and put it on sale, in the caller's transaction;
 * then stamp who approved it.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {string} options.eventId The event.
 * @param {object} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @param {{id: string|null, at: Date}} options.approval Who approved it, and when.
 * @returns {Promise<object>} `{ event, onSale }`: the event after, and how many of its tiers are on sale.
 */
async function publishImported(tx, { run, eventId, actor, now, approval }) {
  await importMove(tx, {
    eventId,
    to: 'PUBLISHED',
    actor,
    note: importNote(run, 'Published by the team at The Desi Events after review'),
    importRunId: run.id,
    via: 'web',
  })

  const { onSale } = await openImportedSales(tx, { run, eventId, actor, now })

  await tx.eventImportItem.update({
    where: { eventId },
    data: { approvedById: approval.id, approvedAt: approval.at },
  })

  return { event: await tx.event.findUnique({ where: { id: eventId } }), onSale }
}

/**
 * One approval.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {{eventId: string, revision: number}} options.item What the page showed.
 * @param {object} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @returns {Promise<object>} The result.
 */
async function approveOne(prisma, { run, item, actor, now }) {
  const record = await approvableItem(prisma, run, item.eventId)
  const { event } = record

  if (event.revision !== item.revision) throw staleRevision(item.revision, event.revision)

  if (event.status === 'REVIEW_PENDING') {
    const loaded = await loadForTransition(prisma, event.id)
    let onSale = 0

    const updated = await transitionEvent(prisma, {
      event: loaded,
      to: 'APPROVED',
      actor,
      // The approval, the publication and the opening of sales: one event's
      // worth of work, behind whatever holds the event's row.
      transactionOptions: budgetOptions(TRANSACTION_BUDGETS.ROW),
      lockWaitMs: LOCK_WAIT_MS,
      onCommit: async (tx, decided) => {
        // The status write holds the row: nothing lands between this check
        // and the commit.
        if (decided.revision !== item.revision) throw staleRevision(item.revision, decided.revision)

        await approvableItem(tx, run, event.id)
        await approvePendingEventMedia(tx, decided, actor)

        const published = await publishImported(tx, {
          run,
          eventId: event.id,
          actor,
          now,
          approval: { id: actor.id, at: now },
        })

        onSale = published.onSale

        return { auditMetadata: { via: 'import', importRunId: run.id } }
      },
    })

    const after = await prisma.event.findUnique({
      where: { id: updated.id },
      select: { status: true, revision: true },
    })

    return {
      eventId: event.id,
      outcome: 'PUBLISHED',
      status: after.status,
      revision: after.revision,
      ticketTypesOnSale: onSale,
      code: null,
      message: null,
    }
  }

  if (event.status === 'APPROVED' || PUBLICLY_VISIBLE_STATUSES.has(event.status)) {
    const after = await budgetedTransaction(prisma, IMPORT_ROW_BUDGET, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`

      const locked = await approvableItem(tx, run, event.id)

      if (locked.event.revision !== item.revision) {
        throw staleRevision(item.revision, locked.event.revision)
      }

      if (locked.event.status === 'APPROVED') {
        // The moderator's approval stands as the review; its approver is the
        // one recorded.
        const decision = await tx.eventModerationAction.findFirst({
          where: { eventId: event.id, toStatus: 'APPROVED' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { actorId: true, createdAt: true },
        })
        const published = await publishImported(tx, {
          run,
          eventId: event.id,
          actor,
          now,
          approval: { id: decision?.actorId ?? actor.id, at: decision?.createdAt ?? now },
        })

        return { outcome: 'PUBLISHED', event: published.event, onSale: published.onSale }
      }

      if (!SALES_OPENABLE.has(locked.event.status)) throw notApprovable(locked.event)

      const before = locked.event.status
      const { opened, onSale } = await openImportedSales(tx, {
        run,
        eventId: event.id,
        actor,
        now,
      })
      const moved = await tx.event.findUnique({ where: { id: event.id } })

      if (opened === 0 && moved.status === before) throw notApprovable(locked.event)

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.EVENT_IMPORT_SALES_OPENED,
        entityType: 'Event',
        entityId: event.id,
        actorId: actor.id,
        metadata: {
          importRunId: run.id,
          ticketTypesOpened: opened,
          ticketTypesOnSale: onSale,
          from: before,
          to: moved.status,
        },
      })

      return { outcome: 'SALES_OPENED', event: moved, onSale }
    })

    return {
      eventId: event.id,
      outcome: after.outcome,
      status: after.event.status,
      revision: after.event.revision,
      ticketTypesOnSale: after.onSale,
      code: null,
      message: null,
    }
  }

  throw notApprovable(event)
}

/**
 * The refusal for an event in a status an approval does nothing for, or a
 * posted one with no imported ticket type left to put on sale.
 *
 * @param {{status: string}} event The event.
 * @returns {Error} 409 `NOT_EDITABLE`.
 */
function notApprovable(event) {
  return httpError(
    409,
    'NOT_EDITABLE',
    PUBLICLY_VISIBLE_STATUSES.has(event.status)
      ? `This event is ${event.status}, and none of its imported ticket types is waiting to go on sale, so there is nothing here to approve.`
      : `This event is ${event.status}, so there is nothing here to approve or publish.`,
    { status: event.status },
  )
}

// ---------------------------------------------------------------------------
// Reassign
// ---------------------------------------------------------------------------

/**
 * The reason the website link is switched off with when an event moves.
 *
 * @param {string} name The organisation's name.
 * @returns {string} The reason.
 */
export function reassignLinkReason(name) {
  return `Moved to ${name}. Its website link is off until an administrator approves the organiser's own address.`
}

/**
 * Move an imported event to an organiser's own organisation (SPEC2-XI I-F),
 * in one transaction that locks the event first: the event and its venue move
 * (the venue is copied when another event uses it), the move is stamped on the
 * import record, the website link is switched off when it is on, and it is
 * audited. Its status, ticket types, sales, pictures and slug are unchanged.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} options Inputs.
 * @param {string} options.eventId The event.
 * @param {string} options.organizationId The organisation it moves to.
 * @param {string} options.reason Why.
 * @param {number} options.revision The revision the administrator's page showed.
 * @param {object} options.actor The administrator.
 * @param {Date} [options.now] The moment.
 * @returns {Promise<object>} The event after.
 * @throws {Error} 404; 409 `NOT_IMPORTED`, `NOT_PLATFORM_HELD`, `NOT_EDITABLE`, `TARGET_NOT_ELIGIBLE` or `STALE_REVISION`.
 */
export async function reassignImportedEvent(prisma, options) {
  const { eventId, organizationId, reason, revision, actor, now = new Date() } = options

  return budgetedTransaction(prisma, REASSIGN_BUDGET, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`

    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: {
        organization: { select: { id: true, platformHeldSource: true } },
        importItem: { select: { id: true, reassignedAt: true } },
      },
    })

    if (!event) throw notFound('No such event.')

    if (!event.importItem) {
      throw httpError(
        409,
        'NOT_IMPORTED',
        'This event was not imported, so it is not moved from here.',
      )
    }

    if (event.importItem.reassignedAt || !event.organization?.platformHeldSource) {
      throw httpError(
        409,
        'NOT_PLATFORM_HELD',
        'This event has already been moved to an organiser’s own organisation.',
      )
    }

    if (event.status === 'DELETED') {
      throw httpError(409, 'NOT_EDITABLE', 'This event was deleted. Restore it before moving it.', {
        status: 'DELETED',
      })
    }

    const target = await tx.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        verificationStatus: true,
        suspendedAt: true,
        platformHeldSource: true,
      },
    })

    if (
      !target ||
      target.verificationStatus !== 'VERIFIED' ||
      target.suspendedAt ||
      target.platformHeldSource
    ) {
      throw httpError(
        409,
        'TARGET_NOT_ELIGIBLE',
        'An imported event moves only to a verified organisation that is not suspended and holds no imports.',
      )
    }

    if (event.revision !== revision) throw staleRevision(revision, event.revision)

    let venueId = event.venueId
    let venueMoved = false

    if (event.venueId) {
      const sharing = await tx.event.count({
        where: { venueId: event.venueId, id: { not: event.id } },
      })

      if (sharing === 0) {
        await tx.venue.update({ where: { id: event.venueId }, data: { organizationId: target.id } })
        venueMoved = true
      } else {
        const venue = await tx.venue.findUnique({ where: { id: event.venueId } })
        const copy = await tx.venue.create({
          data: {
            name: venue.name,
            addressLine1: venue.addressLine1,
            addressLine2: venue.addressLine2,
            city: venue.city,
            region: venue.region,
            postalCode: venue.postalCode,
            country: venue.country,
            latitude: venue.latitude,
            longitude: venue.longitude,
            timezone: venue.timezone,
            directions: venue.directions,
            provenance: venue.provenance,
            organizationId: target.id,
          },
          select: { id: true },
        })

        venueId = copy.id
      }
    }

    await tx.event.update({
      where: { id: event.id },
      data: { organizationId: target.id, venueId, revision: { increment: 1 } },
    })

    await tx.eventImportItem.update({
      where: { id: event.importItem.id },
      data: {
        reassignedAt: now,
        reassignedById: actor.id,
        reassignedFromOrganizationId: event.organizationId,
        reassignedToOrganizationId: target.id,
      },
    })

    const linkOn = event.websiteRedirectEnabled === true

    if (linkOn) {
      await decideWebsiteRedirect(tx, {
        eventId: event.id,
        enabled: false,
        reason: reassignLinkReason(target.name),
        seenUrl: event.websiteUrl,
        actor,
        now,
      })
    }

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_REASSIGNED,
      entityType: 'Event',
      entityId: event.id,
      actorId: actor.id,
      metadata: {
        fromOrganizationId: event.organizationId,
        toOrganizationId: target.id,
        reason,
        websiteLinkTurnedOff: linkOn,
        venue: event.venueId ? (venueMoved ? 'MOVED' : 'COPIED') : null,
      },
    })

    return tx.event.findUnique({ where: { id: event.id } })
  })
}

/**
 * Organisations an imported event may move to: verified, not suspended, not
 * platform-held, matching `q` on name or web address; at most twenty.
 *
 * @param {object} prisma The Prisma client.
 * @param {{q?: string}} query The parsed query.
 * @returns {Promise<object[]>} The organisations.
 */
export async function importTargets(prisma, { q } = {}) {
  const term = q ? likeLiteral(q) : null

  return prisma.organization.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      suspendedAt: null,
      platformHeldSource: null,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, slug: true, verificationStatus: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
  })
}

// ---------------------------------------------------------------------------
// Reading runs
// ---------------------------------------------------------------------------

/**
 * Load a run, or the 404 an unknown one gets.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} runId The run.
 * @returns {Promise<object>} The run, with who made and applied it.
 */
export async function loadRun(prisma, runId) {
  const run = await prisma.eventImportRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE })

  if (!run) throw notFound('No such import run.')

  return run
}

/**
 * A run as its list row shows it.
 *
 * @param {object} run The run, with {@link RUN_INCLUDE}.
 * @param {Date} now The moment.
 * @returns {object} An `eventImportRunSummarySchema` payload.
 */
export function toRunSummary(run, now) {
  return {
    id: run.id,
    source: run.source,
    status: runStatus(run, now),
    fileName: run.fileName,
    eventCount: run.eventCount,
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
    appliedAt: run.appliedAt ?? null,
    createdByName: run.createdBy?.displayName ?? null,
    appliedByName: run.appliedBy?.displayName ?? null,
    summary: run.summary && typeof run.summary === 'object' ? run.summary : null,
  }
}

/**
 * Runs, newest first.
 *
 * @param {object} prisma The Prisma client.
 * @param {{skip: number, take: number}} page The page.
 * @param {Date} now The moment.
 * @returns {Promise<{rows: object[], total: number}>} The page and the total.
 */
export async function listRuns(prisma, { skip, take }, now) {
  const [rows, total] = await Promise.all([
    prisma.eventImportRun.findMany({
      include: RUN_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.eventImportRun.count(),
  ])

  return { rows: rows.map((run) => toRunSummary(run, now)), total }
}

/**
 * A run in full: its plan row by row, and what each row's event is now.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} run The run, with {@link RUN_INCLUDE}.
 * @param {Date} now The moment.
 * @returns {Promise<object>} An `eventImportRunSchema` payload.
 */
export async function toRunView(prisma, run, now) {
  const plan = Array.isArray(run.plan) ? run.plan : []
  const items = await prisma.eventImportItem.findMany({
    where: { source: run.source, sourceId: { in: plan.map((row) => row.sourceId) } },
    include: {
      importedBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          revision: true,
          organization: { select: { name: true } },
          ticketTypes: { where: { importKey: { not: null } }, select: { status: true } },
        },
      },
    },
  })
  const bySource = new Map(items.map((item) => [item.sourceId, item]))

  const rows = plan.map((row) => {
    const item = bySource.get(row.sourceId) ?? null
    const tiers = item?.event?.ticketTypes ?? []

    return {
      sourceId: row.sourceId,
      title: row.title,
      startsAt: row.startsAt,
      city: row.city ?? null,
      action: row.action,
      problem: row.problem ?? null,
      importNotes: row.importNotes ?? [],
      priceCount: row.priceCount ?? 0,
      // A plan stored before ticket types were made from prices has neither.
      soldOutCount: row.soldOutCount ?? 0,
      currency: typeof row.currency === 'string' ? row.currency : null,
      endTimeListed: row.endTimeListed !== false,
      updatable: Boolean(row.updatable),
      resubmit: Boolean(row.resubmit),
      eventStatusAtPlan: row.eventStatus ?? null,
      event: item?.event
        ? {
            id: item.event.id,
            title: item.event.title,
            slug: item.event.slug,
            status: item.event.status,
            revision: item.event.revision,
            inThisRun: item.lastRunId === run.id,
            reassigned: Boolean(item.reassignedAt),
            organizationName: item.event.organization?.name ?? null,
            importedByName: item.importedBy?.displayName ?? null,
            approvedAt: item.approvedAt ?? null,
            approvedByName: item.approvedBy?.displayName ?? null,
            ticketTypes: {
              imported: tiers.length,
              onSale: tiers.filter((tier) => tier.status === 'ON_SALE').length,
              // Still a DRAFT, so approving can put it on sale; a tier closed
              // as sold out on the listing is neither.
              waiting: tiers.filter((tier) => tier.status === 'DRAFT').length,
            },
          }
        : null,
    }
  })

  return {
    ...toRunSummary(run, now),
    planDigest: run.planDigest,
    rows,
  }
}
