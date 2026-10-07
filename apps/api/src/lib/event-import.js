/**
 * Importing listed events onto Desi-Event (SPEC2-XI area I): planning a file,
 * applying the plan, copying its pictures, approving and publishing what was
 * imported, and moving an imported event to an organiser's own organisation.
 *
 * ## Where imported events live
 *
 * In one platform-held organisation per source ("Sulekha Events",
 * `Organization.platformHeldSource = 'SULEKHA'`), created VERIFIED the first
 * time an import is applied, with no members: the database refuses any
 * (`desi_platform_held_has_no_members`). Each event names the organiser who
 * presents it, keeps the prices the listing gave on its import record, and has
 * no ticket type: tickets are sold on the listing's own page, which its
 * website link opens once an administrator approves it here.
 *
 * ## What a run does, and in what order
 *
 * 1. **Preview** reads the uploaded file (`lib/import-dataset.js`), plans it
 *    against the database and stores the run, PREVIEWED for an hour. Nothing
 *    else is written.
 * 2. **Apply** works the plan out again, refuses one that has changed since the
 *    administrator read it, moves the run PREVIEWED → APPLIED with a
 *    compare-and-set (a second apply of the same run is refused), then writes
 *    each listing in a transaction of its own: its venue, the event as a DRAFT,
 *    its one night, its import record and its pictures' rows, then the move
 *    into review. Then pictures are copied, four at a time, within a time
 *    budget a web request can wait for.
 * 3. **Approve** approves, publishes and switches on the Sulekha link, one
 *    transaction per event, for events this run wrote only.
 *
 * ## The import's own moves
 *
 * The lifecycle table gives DRAFT → REVIEW_PENDING, REVIEW_PENDING → DRAFT and
 * APPROVED → PUBLISHED to the organiser, and Rule L refuses a platform
 * administrator them. An imported event has no organiser here, so the import
 * makes those three moves itself ({@link importMove}), as deletion does its
 * own: the move must be in the table, its gates are run, it is written with
 * the lifecycle's own stamps and a moderation action, and audited
 * `event.<status>` with `authority: 'PLATFORM', via: 'IMPORT'`. Only for an
 * event with an import record in a platform-held organisation. Approval
 * itself is a moderator's move and goes through `transitionEvent`, which the
 * administrator is entitled to (`moderation:review`), with the review
 * exemption for the platform's own import (`lib/review-independence.js`).
 *
 * ## What is never made up
 *
 * No quantity, availability, end time or price is invented and shown. A night
 * the listing gives no end for stores start plus three hours, because the
 * column is NOT NULL, flagged `endTimeListed = false`, and no public surface
 * shows it.
 *
 * Only this module writes `EventImportRun`, `EventImportItem` and
 * `EventImportImage` (and, with `lib/organization-provisioning.js`,
 * `platformHeldSource`).
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/lib/event-import
 */

import { ACTORS, PUBLICLY_VISIBLE_STATUSES, findTransition } from '@desi-event/schemas/lifecycle'
import { EVENT_CONTENT_LIMITS } from '@desi-event/schemas/event-content'
import { normaliseWebsiteUrl } from '@desi-event/schemas/website'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { authorChange } from './event-authoring.js'
import {
  gateProblems,
  lifecycleStamps,
  loadForTransition,
  transitionEvent,
} from './event-lifecycle.js'
import { classifyChanges, materialChangeWork } from './event-material-change.js'
import {
  approveImportedMedia,
  approvePendingEventMedia,
  storeImportedImage,
} from './event-media.js'
import {
  conflict,
  databaseRefusal,
  httpError,
  isRetryableConflict,
  notFound,
  unprocessable,
} from './errors.js'
import { disambiguateSlug, slugify } from './identifiers.js'
import { canonicalDigest, importInvalid, parseImportDataset, planImport } from './import-dataset.js'
import { TOO_SMALL_FOR_COVER_NOTE, fetchImportImage } from './import-images.js'
import { equalsIgnoringCase, likeLiteral } from './like-pattern.js'
import { ensurePlatformHeldOrganization, isUniqueViolation } from './organization-provisioning.js'
import { assertIndependentReviewer } from './review-independence.js'
import { applyWebsiteChange, decideWebsiteRedirect } from './website-redirect.js'

/** How long a previewed plan may be applied, in milliseconds. */
export const IMPORT_RUN_TTL_MS = 60 * 60_000

/** Pictures copied at once. */
export const IMPORT_IMAGE_CONCURRENCY = 4

/** Pictures one copying pass tries at most. */
export const IMPORT_IMAGE_RUN_LIMIT = 200

/** The whole copying pass within a web request, in milliseconds. */
export const IMPORT_IMAGE_BUDGET_MS = 60_000

/** How long a night the listing gives no end for is planned to last. */
export const ESTIMATED_DURATION_MS = 3 * 3_600_000

/** The venue provenance an import writes. */
export const IMPORT_VENUE_PROVENANCE = Object.freeze({ SULEKHA: 'import:sulekha' })

/** The reason the Sulekha link is switched on with (SPEC2-XI O10). */
export const IMPORT_REDIRECT_REASON =
  'Tickets for this event are sold on its Sulekha page, which this link opens.'

/** The terms an imported event is listed with (SPEC2-XI I-C). */
export const IMPORT_POLICIES = Object.freeze({
  entry: 'Entry is run by the organiser. Check the Sulekha listing for their rules.',
  refund:
    "Tickets for this event are sold on Sulekha, not on Desi-Event. Refunds follow Sulekha's and the organiser's terms.",
  conduct: "The organiser's and the venue's rules apply.",
})

/** Statuses an imported draft is updated in. */
const UPDATABLE_DRAFTS = new Set(['DRAFT', 'CHANGES_REQUIRED', 'REVIEW_PENDING'])

/** Statuses a listing whose content has not changed is sent for review from. */
const RESUBMITTABLE = new Set(['DRAFT', 'CHANGES_REQUIRED'])

/** A picture's role, as the database names it. */
const IMAGE_ROLES = Object.freeze({ cover: 'COVER', gallery: 'GALLERY' })

/**
 * The run as administrators read it, with who made and applied it.
 */
const RUN_INCLUDE = Object.freeze({
  createdBy: { select: { displayName: true } },
  appliedBy: { select: { displayName: true } },
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
 * Write a listing's pictures as the import's rows: a new address waits to be
 * copied; one already known keeps its state and takes the listing's role,
 * description and order.
 *
 * @param {object} tx A transaction client.
 * @param {string} itemId The import record.
 * @param {object} listing The parsed listing.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeImageRows(tx, itemId, listing) {
  for (const [position, image] of listing.images.entries()) {
    await tx.eventImportImage.upsert({
      where: { itemId_url: { itemId, url: image.url } },
      create: {
        itemId,
        url: image.url,
        role: IMAGE_ROLES[image.role],
        alt: image.alt,
        position,
        status: 'WAITING',
      },
      update: { role: IMAGE_ROLES[image.role], alt: image.alt, position },
    })
  }
}

/**
 * The note an import move records on its moderation action.
 *
 * @param {object} run The run.
 * @param {string} [what] What the move did.
 * @returns {string} The note.
 */
function importNote(run, what = 'Imported from Sulekha') {
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
      'This event is not an import held by the Desi-Event team, so the import cannot move it.',
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
 * about one byte per key and per member (some 3% on the Sulekha file).
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
    const { organization } = await prisma.$transaction((tx) =>
      ensurePlatformHeldOrganization(tx, { source, actor, now }),
    )

    return organization
  } catch (error) {
    if (!isUniqueViolation(error)) throw error

    const { organization } = await prisma.$transaction((tx) =>
      ensurePlatformHeldOrganization(tx, { source, actor, now }),
    )

    return organization
  }
}

/**
 * Create a listing's event, night, import record and picture rows, then send
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
  const websiteUrl = normaliseWebsiteUrl(listing.ticketUrl)

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
      // An address waits for an administrator, as any new event's does; the
      // approval switches the link on for it.
      websiteUrl,
      websiteDecisionPending: true,
      websiteSubmittedAt: now,
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

  const item = await tx.eventImportItem.create({
    data: {
      source: run.source,
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl,
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

  await writeImageRows(tx, item.id, listing)

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
 * transaction. Pictures the listing no longer names are removed from the
 * draft with their rows.
 *
 * @param {object} tx A transaction client.
 * @param {object} context The run's context.
 * @param {object} listing The parsed listing.
 * @param {object} row The plan row.
 * @returns {Promise<string>} The event's id.
 */
async function updateImportedDraft(tx, context, listing, row) {
  const { run, actor, now, via, storage } = context
  const { item, event } = await lockedImport(tx, row, run)

  if (!UPDATABLE_DRAFTS.has(event.status)) throw rowChanged()

  if (event.status === 'REVIEW_PENDING') {
    await importMove(tx, {
      eventId: event.id,
      to: 'DRAFT',
      actor,
      note: importNote(run, 'Withdrawn to update it from its Sulekha listing'),
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
  const website = await applyWebsiteChange(tx, {
    eventId: event.id,
    nextUrl: normaliseWebsiteUrl(listing.ticketUrl),
    now,
  })

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
      websiteUrl: website.websiteUrl,
      websiteDecisionPending: website.websiteDecisionPending,
      websiteSubmittedAt: website.websiteSubmittedAt,
      revision: { increment: 1 },
    },
  })

  await writeNight(tx, event, times, listing)
  await writeItem(tx, item.id, context, listing)
  await dropUnlistedPictures(tx, storage, item.id, listing)
  await writeImageRows(tx, item.id, listing)

  await importMove(tx, {
    eventId: event.id,
    to: 'REVIEW_PENDING',
    actor,
    note: importNote(run, 'Updated from its Sulekha listing'),
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
      sourceUrl: listing.sourceUrl,
      scrapedAt: new Date(listing.scrapedAt),
      presentedBy: listing.presentedBy,
      prices: listingPrices(listing),
      priceText: listing.priceText,
      importNotes: listing.importNotes,
    },
  })
}

/**
 * Remove, from a draft, the pictures its listing no longer names: their rows,
 * and what was stored for them while it is still waiting for approval.
 *
 * @param {object} tx A transaction client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {string} itemId The import record.
 * @param {object} listing The parsed listing.
 * @returns {Promise<void>} Resolves when done.
 */
async function dropUnlistedPictures(tx, storage, itemId, listing) {
  const listed = new Set(listing.images.map((image) => image.url))
  const rows = await tx.eventImportImage.findMany({
    where: { itemId },
    select: { id: true, url: true, mediaAssetId: true },
  })
  const unlisted = rows.filter((row) => !listed.has(row.url))

  for (const row of unlisted) {
    if (row.mediaAssetId) {
      const asset = await tx.mediaAsset.findUnique({
        where: { id: row.mediaAssetId },
        select: { id: true, storageKey: true, moderationStatus: true },
      })

      if (asset && asset.moderationStatus === 'PENDING') {
        await storage.remove(tx, asset.storageKey)
        await tx.mediaAsset.deleteMany({ where: { id: asset.id, moderationStatus: 'PENDING' } })
      }
    }

    await tx.eventImportImage.deleteMany({ where: { id: row.id } })
  }
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
 * Update a posted event from its listing, as a live edit by the Desi-Event
 * team (`authorChange` under the import's authority): the date, the place and
 * the terms change with a change notice for ticket holders; the website
 * address change waits for an administrator as any does. New pictures are
 * added waiting for approval; pictures already public are left.
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
  const reason = `Updated from its Sulekha listing by the Desi-Event team, run ${run.id}.`
  let material = []

  await authorChange(prisma, {
    event,
    revision: event.revision,
    actor,
    authority,
    action: 'event.updated',
    metadata: () => ({ via: 'import', importRunId: run.id, sourceId: listing.sourceId, material }),
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

      const website = await applyWebsiteChange(tx, {
        eventId: event.id,
        nextUrl: normaliseWebsiteUrl(listing.ticketUrl),
        now,
      })

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
          websiteUrl: website.websiteUrl,
          websiteDecisionPending: website.websiteDecisionPending,
          websiteSubmittedAt: website.websiteSubmittedAt,
        },
      })

      await writeNight(tx, event, times, listing)

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
      await writeImageRows(tx, event.importItem.id, listing)

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
 * reported in the summary and the rest go on. Then the pictures are copied.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {object} options Inputs.
 * @param {object} options.run The run row.
 * @param {{id: string}} options.actor The administrator.
 * @param {string} options.planDigest The digest of the plan the administrator read.
 * @param {string[]} [options.updateFromSource] Posted listings to update; never from the command line.
 * @param {'web'|'cli'} options.via Where it came from.
 * @param {object} options.env The parsed API environment, for the pictures.
 * @param {Date} [options.now] The moment.
 * @param {number} [options.imageBudgetMs] How long copying pictures may take; `Infinity` from the command line.
 * @param {Function} [options.fetchImage] The picture fetcher; `fetchImportImage` by default.
 * @param {object} [options.log] A logger.
 * @returns {Promise<{run: object, results: object[], pictures: object}>} The run after, what each listing did and what copying did.
 */
export async function applyImport(prisma, storage, options) {
  const {
    run,
    actor,
    planDigest,
    updateFromSource = [],
    via,
    env,
    now = new Date(),
    imageBudgetMs = IMPORT_IMAGE_BUDGET_MS,
    fetchImage,
    log,
  } = options

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
      'Only a posted event whose Sulekha listing changed can be updated from Sulekha.',
      {
        problems: unknown.map((sourceId) => `Listing ${sourceId} cannot be updated from Sulekha.`),
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
  const context = { run, organization, actor, now, via, storage }
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
          : await prisma.$transaction(async (tx) => {
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

  await prisma.$transaction(async (tx) => {
    await tx.eventImportRun.update({ where: { id: run.id }, data: { summary } })
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_APPLIED,
      entityType: 'EventImportRun',
      entityId: run.id,
      actorId: actor.id,
      metadata: { summary, updateFromSource: updateFromSource.length, via },
    })
  })

  const pictures = await fetchRunImages(prisma, storage, {
    run,
    actor,
    env,
    now,
    budgetMs: imageBudgetMs,
    fetchImage,
    log,
  })

  return { results, pictures }
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
    'What Desi-Event holds changed after this plan was made, so it was not applied. Upload the file again to plan it as things are now.',
  )
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/**
 * Copy a run's pictures that are waiting or failed: four at a time, at most
 * {@link IMPORT_IMAGE_RUN_LIMIT}, within `budgetMs`. A picture not reached when
 * the time runs out stays waiting. Each one copied is stored waiting for
 * approval ({@link storeImportedImage}); each failure is recorded with its
 * code. Only pictures of events this run last wrote, still held by the
 * platform-held organisation and not deleted.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {{id: string}} options.actor The administrator.
 * @param {string[]|null} [options.eventIds] Only these events' pictures.
 * @param {object} options.env The parsed API environment.
 * @param {Date} [options.now] The moment.
 * @param {number} [options.budgetMs] How long the whole pass may take.
 * @param {Function} [options.fetchImage] The fetcher, `(url, {timeoutMs}) => result`.
 * @param {object} [options.log] A logger.
 * @returns {Promise<{tried: number, stored: number, failed: number, waiting: number}>} What happened.
 */
export async function fetchRunImages(prisma, storage, options) {
  const {
    run,
    actor,
    eventIds = null,
    env,
    budgetMs = IMPORT_IMAGE_BUDGET_MS,
    fetchImage,
    log,
  } = options
  const fetcher =
    fetchImage ??
    ((url, { timeoutMs }) =>
      fetchImportImage(url, {
        source: env?.IMPORT_IMAGE_SOURCE ?? 'network',
        fixtureDir: env?.IMPORT_IMAGE_FIXTURE_DIR,
        nodeEnv: env?.NODE_ENV,
        timeoutMs,
        log,
      }))

  const queue = await prisma.eventImportImage.findMany({
    where: {
      status: { in: ['WAITING', 'FAILED'] },
      item: {
        lastRunId: run.id,
        reassignedAt: null,
        ...(eventIds ? { eventId: { in: eventIds } } : {}),
      },
    },
    include: {
      item: {
        select: {
          eventId: true,
          event: {
            select: {
              status: true,
              organization: { select: { platformHeldSource: true } },
            },
          },
        },
      },
    },
    orderBy: [{ itemId: 'asc' }, { position: 'asc' }],
    take: IMPORT_IMAGE_RUN_LIMIT,
  })
  const eligible = queue.filter(
    (image) =>
      image.item?.event &&
      image.item.event.status !== 'DELETED' &&
      image.item.event.organization?.platformHeldSource,
  )
  const started = Date.now()
  const deadline = Number.isFinite(budgetMs) ? started + budgetMs : Infinity
  const tally = { tried: 0, stored: 0, failed: 0 }
  let next = 0

  /**
   * One worker: takes pictures off the queue until it is empty or the time
   * is up.
   *
   * @returns {Promise<void>} Resolves when done.
   */
  async function work() {
    while (next < eligible.length) {
      const left = deadline - Date.now()

      if (left <= 0) return

      const image = eligible[next]

      next += 1
      tally.tried += 1

      const timeoutMs = Math.max(1_000, Math.min(10_000, left))
      const fetched = await fetcher(image.url, { timeoutMs })
      const triedAt = new Date()

      if (!fetched?.ok) {
        if (await markFailed(prisma, image, fetched?.code ?? 'NETWORK_UNAVAILABLE', triedAt)) {
          tally.failed += 1
        }
        continue
      }

      const stored = await storeImportedImage(prisma, storage, {
        event: { id: image.item.eventId },
        image,
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        actor,
        now: triedAt,
        // Another pass over this run's pictures can be copying at the same
        // time (a command-line apply, a web apply whose request was
        // abandoned, a second "Retry pictures"). The picture is recorded only
        // while it is still waiting or failed; the pass that finds it copied
        // already rolls back its own copy, bytes and revision bump, so one
        // listed picture is never stored twice.
        onStored: async (tx, asset) => {
          const recorded = await tx.eventImportImage.updateMany({
            where: { id: image.id, status: { in: COPYABLE_IMAGE_STATUSES } },
            data: {
              status: 'STORED',
              failureCode: null,
              attempts: { increment: 1 },
              lastTriedAt: triedAt,
              mediaAssetId: asset.id,
            },
          })

          if (recorded.count !== 1) throw new ImageAlreadyCopied()
        },
      }).catch((error) => {
        if (error instanceof ImageAlreadyCopied) return { ok: false, copiedElsewhere: true }

        const refusal = rowRefusal(error)

        if (!refusal) throw error

        return { ok: false, code: refusal.code }
      })

      if (stored.ok) {
        tally.stored += 1
      } else if (
        !stored.copiedElsewhere &&
        (await markFailed(prisma, image, stored.code, triedAt))
      ) {
        tally.failed += 1
      }
    }
  }

  await Promise.all(Array.from({ length: IMPORT_IMAGE_CONCURRENCY }, () => work()))

  const waiting = await prisma.eventImportImage.count({
    where: { status: 'WAITING', item: { lastRunId: run.id, reassignedAt: null } },
  })

  return { ...tally, waiting }
}

/** The statuses a picture is copied from. */
const COPYABLE_IMAGE_STATUSES = Object.freeze(['WAITING', 'FAILED'])

/** Thrown inside a picture's transaction when another pass copied it first. */
class ImageAlreadyCopied extends Error {
  constructor() {
    super('Another pass over this run copied the picture first.')
    this.name = 'ImageAlreadyCopied'
  }
}

/**
 * Record why a picture was not copied, unless another pass copied it since.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} image The picture's row.
 * @param {string} code The failure code.
 * @param {Date} triedAt When it was tried.
 * @returns {Promise<boolean>} Whether it was recorded.
 */
async function markFailed(prisma, image, code, triedAt) {
  const marked = await prisma.eventImportImage.updateMany({
    where: { id: image.id, status: { in: COPYABLE_IMAGE_STATUSES } },
    data: {
      status: 'FAILED',
      failureCode: String(code).slice(0, 100),
      attempts: { increment: 1 },
      lastTriedAt: triedAt,
    },
  })

  return marked.count === 1
}

/**
 * "Retry pictures": copy again the run's waiting and failed pictures, or only
 * those of the events named. Audited `event_import.images_retried`.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} storage The `MediaStorage` adapter.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {{id: string}} options.actor The administrator.
 * @param {string[]|null} [options.eventIds] Only these events; each must be this run's.
 * @param {object} options.env The parsed API environment.
 * @param {Date} [options.now] The moment.
 * @param {Function} [options.fetchImage] The fetcher.
 * @param {object} [options.log] A logger.
 * @returns {Promise<object>} What copying did.
 * @throws {Error} 409 `NOT_EDITABLE` for a run not applied; 409 `NOT_IN_RUN` for an event the run did not write.
 */
export async function retryRunImages(prisma, storage, options) {
  const { run, actor, eventIds = null, now = new Date() } = options

  if (run.status !== 'APPLIED') {
    throw httpError(409, 'NOT_EDITABLE', 'Pictures are copied once a plan has been applied.')
  }

  if (eventIds) await assertInRun(prisma, run, eventIds)

  const pictures = await fetchRunImages(prisma, storage, { ...options, now })

  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_IMPORT_IMAGES_RETRIED,
      entityType: 'EventImportRun',
      entityId: run.id,
      actorId: actor.id,
      metadata: { ...pictures, events: eventIds ? eventIds.length : null },
    }),
  )

  return pictures
}

/**
 * Refuse an event this run did not last write.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} run The run.
 * @param {string[]} eventIds The events.
 * @returns {Promise<void>} Resolves when every one is the run's.
 * @throws {Error} 409 `NOT_IN_RUN`.
 */
async function assertInRun(db, run, eventIds) {
  const items = await db.eventImportItem.findMany({
    where: { eventId: { in: eventIds }, lastRunId: run.id },
    select: { eventId: true },
  })
  const mine = new Set(items.map((item) => item.eventId))
  const others = eventIds.filter((id) => !mine.has(id))

  if (others.length > 0) throw notInRun()
}

/**
 * @returns {Error} 409 `NOT_IN_RUN`.
 */
function notInRun() {
  return httpError(
    409,
    'NOT_IN_RUN',
    'This event was not imported by this run, so it cannot be approved or retried from here.',
  )
}

// ---------------------------------------------------------------------------
// Approve and publish
// ---------------------------------------------------------------------------

/**
 * "Approve and publish" (SPEC2-XI I-C): one transaction per event, each
 * refusal reported for its event. Each must be an event this run last wrote,
 * still in the platform-held organisation; then by its status:
 *
 * - REVIEW_PENDING: approved through `transitionEvent` (its waiting pictures
 *   with it), published by the import's own move, and its Sulekha link
 *   switched on, all in the approval's transaction, at the revision the page
 *   showed.
 * - APPROVED (a moderator approved it): published and switched on.
 * - Posted: its waiting imported pictures are approved; nothing else changes.
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
        picturesApproved: 0,
        ...refusal,
      })
    }
  }

  return results
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
          websiteUrl: true,
          websiteRedirectEnabled: true,
          websiteDecidedUrl: true,
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
    'This event changed after you opened the page (a picture may have been copied). Reload to review it as it is now. Nothing was decided.',
    { expectedRevision: expected, currentRevision: current },
  )
}

/**
 * Publish an approved import and switch its Sulekha link on, in the caller's
 * transaction; then stamp who approved it.
 *
 * @param {object} tx A transaction client.
 * @param {object} options Inputs.
 * @param {object} options.run The run.
 * @param {string} options.eventId The event.
 * @param {object} options.actor The administrator.
 * @param {Date} options.now The moment.
 * @param {{id: string|null, at: Date}} options.approval Who approved it, and when.
 * @returns {Promise<object>} The event after.
 */
async function publishImported(tx, { run, eventId, actor, now, approval }) {
  const published = await importMove(tx, {
    eventId,
    to: 'PUBLISHED',
    actor,
    note: importNote(run, 'Published by the Desi-Event team after review'),
    importRunId: run.id,
    via: 'web',
  })

  // Another administrator may already have switched the link on for this
  // address from the website-links list; then there is nothing to decide.
  const alreadyOn =
    published.websiteRedirectEnabled === true &&
    published.websiteDecidedUrl !== null &&
    published.websiteDecidedUrl === published.websiteUrl

  if (!alreadyOn) {
    await decideWebsiteRedirect(tx, {
      eventId,
      enabled: true,
      reason: IMPORT_REDIRECT_REASON,
      seenUrl: published.websiteUrl,
      actor,
      now,
    })
  }

  await tx.eventImportItem.update({
    where: { eventId },
    data: { approvedById: approval.id, approvedAt: approval.at },
  })

  return tx.event.findUnique({ where: { id: eventId } })
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
    let picturesApproved = 0

    const updated = await transitionEvent(prisma, {
      event: loaded,
      to: 'APPROVED',
      actor,
      onCommit: async (tx, decided) => {
        // The status write holds the row: no picture lands between this check
        // and the commit, and every stored picture bumps the revision.
        if (decided.revision !== item.revision) throw staleRevision(item.revision, decided.revision)

        await approvableItem(tx, run, event.id)
        picturesApproved = await approvePendingEventMedia(tx, decided, actor)

        await publishImported(tx, {
          run,
          eventId: event.id,
          actor,
          now,
          approval: { id: actor.id, at: now },
        })

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
      picturesApproved,
      code: null,
      message: null,
    }
  }

  if (event.status === 'APPROVED' || PUBLICLY_VISIBLE_STATUSES.has(event.status)) {
    const after = await prisma.$transaction(async (tx) => {
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

        return { outcome: 'PUBLISHED', event: published, picturesApproved: 0 }
      }

      if (!PUBLICLY_VISIBLE_STATUSES.has(locked.event.status)) throw notApprovable(locked.event)

      // Approving pictures is a review decision: the reviewer must be
      // independent of the event, or be the importer of the platform's own
      // import (SPEC2-XI O5).
      await assertIndependentReviewer(tx, {
        actor,
        organizationId: locked.event.organizationId,
        eventId: event.id,
      })

      const picturesApproved = await approveImportedMedia(tx, { eventId: event.id, actor, now })

      return { outcome: 'PICTURES_APPROVED', event: locked.event, picturesApproved }
    })

    return {
      eventId: event.id,
      outcome: after.outcome,
      status: after.event.status,
      revision: after.event.revision,
      picturesApproved: after.picturesApproved,
      code: null,
      message: null,
    }
  }

  throw notApprovable(event)
}

/**
 * The refusal for an event in a status an approval does nothing for.
 *
 * @param {{status: string}} event The event.
 * @returns {Error} 409 `NOT_EDITABLE`.
 */
function notApprovable(event) {
  return httpError(
    409,
    'NOT_EDITABLE',
    `This event is ${event.status}, so there is nothing here to approve or publish.`,
    { status: event.status },
  )
}

// ---------------------------------------------------------------------------
// Reassign
// ---------------------------------------------------------------------------

/**
 * The reason the Sulekha link is switched off with when an event moves.
 *
 * @param {string} name The organisation's name.
 * @returns {string} The reason.
 */
export function reassignLinkReason(name) {
  return `Moved to ${name}. The Sulekha ticket link is off until an administrator approves the organiser's own address.`
}

/**
 * Move an imported event to an organiser's own organisation (SPEC2-XI I-F),
 * in one transaction that locks the event first: the event and its venue move
 * (the venue is copied when another event uses it), the move is stamped on the
 * import record, the Sulekha link is switched off when it is on, and it is
 * audited. Its status, pictures and slug are unchanged.
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

  return prisma.$transaction(async (tx) => {
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
        },
      },
      images: {
        orderBy: { position: 'asc' },
        include: { mediaAsset: { select: { id: true, moderationStatus: true, kind: true } } },
      },
    },
  })
  const bySource = new Map(items.map((item) => [item.sourceId, item]))
  const pictures = { total: 0, stored: 0, failed: 0, waiting: 0 }

  const rows = plan.map((row) => {
    const item = bySource.get(row.sourceId) ?? null
    const images = (item?.images ?? []).map((image) => ({
      id: image.id,
      url: image.url,
      role: image.role,
      alt: image.alt,
      position: image.position,
      status: image.status,
      failureCode: image.failureCode ?? null,
      attempts: image.attempts,
      lastTriedAt: image.lastTriedAt ?? null,
      mediaId: image.mediaAsset?.id ?? null,
      mediaStatus: image.mediaAsset?.moderationStatus ?? null,
      // A cover the sanitiser found too small was stored in the gallery.
      note:
        image.role === 'COVER' && image.mediaAsset?.kind === 'EVENT_GALLERY'
          ? TOO_SMALL_FOR_COVER_NOTE
          : null,
    }))

    if (item?.lastRunId === run.id) {
      for (const image of images) {
        pictures.total += 1
        if (image.status === 'STORED') pictures.stored += 1
        else if (image.status === 'FAILED') pictures.failed += 1
        else pictures.waiting += 1
      }
    }

    return {
      sourceId: row.sourceId,
      title: row.title,
      startsAt: row.startsAt,
      city: row.city ?? null,
      action: row.action,
      problem: row.problem ?? null,
      importNotes: row.importNotes ?? [],
      imageCount: row.imageCount ?? 0,
      priceCount: row.priceCount ?? 0,
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
          }
        : null,
      pictures: images,
    }
  })

  return {
    ...toRunSummary(run, now),
    planDigest: run.planDigest,
    rows,
    pictures,
  }
}
