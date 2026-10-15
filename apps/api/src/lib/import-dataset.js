/**
 * Reading an import file and planning what applying it does (SPEC2-XI §5.I-C).
 *
 * The file is uploaded by a person, so every rule the committed files are
 * held to by their validator test holds here again, at run time, for whatever
 * file arrives: the shape (`importDatasetSchema`), the format and the source.
 *
 * Since 2026-10-15 a file carries **no web address**: the owner asked that
 * nothing on The Desi Events links, redirects or connects to the site the
 * listings came from ("No contact at all"). A file that still names a listing
 * link, a ticket link, pictures, a source site, picture hosts or a source name
 * is refused, each such field named ({@link retiredFieldProblems}). Nothing is
 * fetched. A listing is known by its `sourceId` alone.
 *
 * Each listed price becomes a ticket type sold here ({@link listingTiers}), in
 * the currency of the venue's country (USD in the United States, CAD in
 * Canada): a listing whose prices are in another currency is INVALID.
 *
 * The plan gives every listing one action. Every `EventStatus` maps to exactly
 * one (see {@link planActionForStatus}); a listing whose date has passed, whose
 * event was deleted or moved to an organiser's own organisation is skipped;
 * one whose content has not changed since it was last written is UNCHANGED.
 * "Last written" is the dataset of the run in `EventImportItem.lastRunId`:
 * apply moves `lastRunId` only for rows it writes or confirms unchanged
 * (CREATE, UPDATE_DRAFT, UPDATE_POSTED, UNCHANGED), never for a kept or
 * skipped one, so that run's copy of the listing is what the event holds. A
 * listing's digest is versioned ({@link LISTING_DIGEST_VERSION}), so every
 * listing written before its prices became ticket types reads as changed and
 * is written again, with them.
 *
 * The plan's digest is SHA-256 over its canonical JSON. Apply recomputes the
 * plan and refuses one that has changed since the administrator read it.
 *
 * The user states that they own the site the listings came from and asked
 * for its events to be imported; that is recorded as their statement. Nothing
 * here assumes a country beyond the currency rule: a venue's country, region
 * and postal code and a listing's zone are each carried as the file gives
 * them (a Toronto listing: `CA`, `ON`, `M5V 2T6`, `America/Toronto`, `CAD`).
 */

import { createHash } from 'node:crypto'

import {
  IMPORT_DATASET_FORMAT,
  IMPORT_PLAN_ACTIONS,
  RETIRED_DATASET_FIELDS,
  RETIRED_LISTING_FIELDS,
  importDatasetSchema,
  importEventSchema,
  priceNoteSaysSoldOut,
} from '@desi-event/schemas/imports'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { EVENT_CONTENT_LIMITS } from '@desi-event/schemas/event-content'

import { httpError } from './errors.js'
import { publicPriceName } from './presenters.js'

/** The source this build imports from. */
export const IMPORT_SOURCES = Object.freeze(['SULEKHA'])

/** How many problems a refusal lists. */
export const IMPORT_PROBLEM_LIMIT = 50

/**
 * The plan action for an imported event's status when its listing has
 * changed. Every `EventStatus` is a key, so a status added to the enum and
 * forgotten here fails {@link planActionForStatus} (and its test) instead of
 * being imported over.
 */
export const PLAN_ACTION_BY_STATUS = Object.freeze({
  DRAFT: 'UPDATE_DRAFT',
  CHANGES_REQUIRED: 'UPDATE_DRAFT',
  REVIEW_PENDING: 'UPDATE_DRAFT',
  // A reviewer has decided this version: approve and publish it, or delete
  // it, before importing it again.
  APPROVED: 'SKIPPED_DECIDED',
  REJECTED: 'SKIPPED_DECIDED',
  ARCHIVED: 'SKIPPED_DECIDED',
  DELETED: 'SKIPPED_DELETED',
  ...Object.fromEntries([...PUBLICLY_VISIBLE_STATUSES].map((status) => [status, 'POSTED_KEPT'])),
})

/** Actions that write content, so a listing that has not changed is UNCHANGED instead. */
const WRITABLE_ACTIONS = new Set(['UPDATE_DRAFT', 'POSTED_KEPT'])

/** Statuses an UNCHANGED listing is still sent for review from. */
const RESUBMIT_STATUSES = new Set(['DRAFT', 'CHANGES_REQUIRED'])

/**
 * The plan action for an imported event in a status, its listing changed.
 *
 * @param {string} status An `EventStatus`.
 * @returns {string} One of `IMPORT_PLAN_ACTIONS`.
 * @throws {Error} For a status this module does not know.
 */
export function planActionForStatus(status) {
  if (!Object.hasOwn(PLAN_ACTION_BY_STATUS, status)) {
    throw new Error(`No import plan action for event status ${String(status)}.`)
  }

  return PLAN_ACTION_BY_STATUS[status]
}

/**
 * JSON with every object's keys sorted, so equal content gives equal text.
 *
 * @param {unknown} value Any JSON value.
 * @returns {string} The canonical text.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value instanceof Date) return JSON.stringify(value.toISOString())

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()

    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }

  return JSON.stringify(value ?? null)
}

/**
 * SHA-256 of a value's canonical JSON, lower-case hex.
 *
 * @param {unknown} value Any JSON value.
 * @returns {string} 64 hexadecimal characters.
 */
export function canonicalDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * What a listing's digest is taken with beside the listing: changed when what
 * applying a listing writes changes, so every listing written the old way
 * reads as changed and is written again. `tiers-1`: its prices became ticket
 * types (2026-10-15).
 */
export const LISTING_DIGEST_VERSION = 'tiers-1'

/**
 * The content digest of one listing, as parsed.
 *
 * @param {object} listing A listing from a parsed dataset.
 * @returns {string} 64 hexadecimal characters.
 */
export function listingDigest(listing) {
  return canonicalDigest({ version: LISTING_DIGEST_VERSION, listing })
}

/**
 * A refusal of an import file: 422 `IMPORT_INVALID`, each problem listed.
 *
 * @param {string[]} problems What {@link parseImportDataset} found.
 * @returns {Error} The error, with `details.problems`.
 */
export function importInvalid(problems) {
  return httpError(
    422,
    'IMPORT_INVALID',
    'This file cannot be imported as it is. Each problem is listed; correct the file and upload it again.',
    { problems: problems.slice(0, IMPORT_PROBLEM_LIMIT) },
  )
}

/**
 * Whether a value is a plain object.
 *
 * @param {unknown} value Anything.
 * @returns {boolean} True for `{...}`.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Where a problem is, in words an administrator can find in the file.
 *
 * @param {ReadonlyArray<string|number>} path A zod issue path.
 * @param {unknown} raw The file as uploaded.
 * @returns {string} For example `events[4] (listing 402059) venue.name`.
 */
function placeOf(path, raw) {
  if (path.length === 0) return 'The file'

  if (path[0] === 'events' && typeof path[1] === 'number') {
    const listing = Array.isArray(raw?.events) ? raw.events[path[1]] : undefined
    const id =
      typeof listing?.sourceId === 'string' && /^[0-9]{1,12}$/u.test(listing.sourceId)
        ? ` (listing ${listing.sourceId})`
        : ''
    const rest = path
      .slice(2)
      .map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`))
      .join('')
      .replace(/^\./u, '')

    return `events[${path[1]}]${id}${rest ? ` ${rest}` : ''}`
  }

  return path
    .map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`))
    .join('')
    .replace(/^\./u, '')
}

/**
 * The retired fields a file still carries, each placed: they were addresses on
 * the source's own site, or its name, and a file carries none since
 * 2026-10-15.
 *
 * @param {object} raw The file.
 * @returns {string[]} Problems, each placed.
 */
export function retiredFieldProblems(raw) {
  const problems = []
  const sentence =
    'Import files carry no web address and no name of the site the listing came from. Remove this field.'

  for (const field of RETIRED_DATASET_FIELDS) {
    if (Object.hasOwn(raw, field)) problems.push(`${field}: ${sentence}`)
  }

  if (!Array.isArray(raw.events)) return problems

  raw.events.forEach((listing, index) => {
    if (!isPlainObject(listing)) return

    for (const field of RETIRED_LISTING_FIELDS) {
      if (Object.hasOwn(listing, field)) {
        problems.push(`${placeOf(['events', index, field], raw)}: ${sentence}`)
      }
    }
  })

  return problems
}

/**
 * Whether a schema issue is the strict object's own report of retired fields,
 * which {@link retiredFieldProblems} says in its own words.
 *
 * @param {object} issue A zod issue.
 * @returns {boolean} True when every key it names is retired.
 */
function isRetiredFieldIssue(issue) {
  if (issue.code !== 'unrecognized_keys' || !Array.isArray(issue.keys)) return false

  const retired =
    issue.path.length === 0
      ? RETIRED_DATASET_FIELDS
      : issue.path.length === 2 && issue.path[0] === 'events'
        ? RETIRED_LISTING_FIELDS
        : []

  return issue.keys.length > 0 && issue.keys.every((key) => retired.includes(key))
}

/**
 * The currency an imported event sells in: USD at a venue in the United
 * States, CAD in Canada, and elsewhere the one currency its prices are in.
 *
 * @param {object} listing A parsed listing.
 * @returns {string|null} An ISO 4217 code, or null for a listing elsewhere with no price.
 */
export function listingCurrency(listing) {
  if (listing.venue.country === 'US') return 'USD'
  if (listing.venue.country === 'CA') return 'CAD'

  return listing.prices[0]?.currency ?? null
}

/**
 * Why a listing's prices cannot be sold as one event's tickets, or null.
 *
 * @param {object} listing A parsed listing.
 * @returns {string|null} The problem in words.
 */
export function listingPriceProblem(listing) {
  const currency = listingCurrency(listing)
  const other = listing.prices.find((price) => price.currency !== currency)

  if (!other) return null

  return listing.venue.country === 'US' || listing.venue.country === 'CA'
    ? `Its price "${other.name}" is in ${other.currency}, but tickets at a venue in ${listing.venue.country} are sold in ${currency}. Correct the currency in the file.`
    : `Its prices are in more than one currency (${currency} and ${other.currency}), and an order is paid in one. Correct the file.`
}

/**
 * A price's amount as a ticket type's name may carry it: "$35.00", "CA$35.00".
 *
 * @param {number} cents The amount.
 * @param {string} currency Its currency.
 * @returns {string} The amount in words a buyer reads.
 */
function amountLabel(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/**
 * The ticket types a listing's prices become, in the listing's order: one per
 * price, named as the event page names it ({@link publicPriceName}: no sales
 * date or urgency in a name), keyed by that name for a re-import
 * (`TicketType.importKey`). Two prices that come to one name and one amount
 * are one ticket type (a listing that repeats a price); two that come to one
 * name at different amounts are told apart by their amounts ("General
 * Admission ($35.00)"). A price the listing marked sold out (`soldOut`) is made
 * CLOSED; one repeated is sold out only when every copy was.
 *
 * @param {object} listing A parsed listing.
 * @returns {Array<{key: string, name: string, priceCents: number, currency: string, soldOut: boolean, sortOrder: number}>} The tiers.
 */
export function listingTiers(listing) {
  const currency = listingCurrency(listing)
  const limit = EVENT_CONTENT_LIMITS.tierName
  /** @type {Map<string, {name: string, priceCents: number, soldOut: boolean, order: number}>} */
  const merged = new Map()

  listing.prices.forEach((price, order) => {
    const name = publicPriceName(price.name).slice(0, 100)
    const key = `${name}\u0000${price.priceCents}`
    const soldOut = priceNoteSaysSoldOut(price.note)
    const known = merged.get(key)

    if (known) known.soldOut = known.soldOut && soldOut
    else merged.set(key, { name, priceCents: price.priceCents, soldOut, order })
  })

  const tiers = [...merged.values()].sort((left, right) => left.order - right.order)
  const named = new Map()

  for (const tier of tiers) named.set(tier.name, (named.get(tier.name) ?? 0) + 1)

  return tiers.map((tier, index) => {
    const name = (
      named.get(tier.name) > 1
        ? `${tier.name} (${amountLabel(tier.priceCents, currency)})`
        : tier.name
    ).slice(0, limit)

    return {
      key: name,
      name,
      priceCents: tier.priceCents,
      currency,
      soldOut: tier.soldOut,
      sortOrder: index,
    }
  })
}

/**
 * Read an import file.
 *
 * @param {unknown} json The file: parsed JSON, or its text.
 * @returns {{dataset: object|null, problems: string[]}} The parsed dataset when there are no problems; otherwise null and at most {@link IMPORT_PROBLEM_LIMIT} problems.
 */
export function parseImportDataset(json) {
  let raw = json

  if (typeof json === 'string') {
    try {
      raw = JSON.parse(json)
    } catch {
      return { dataset: null, problems: ['The file is not JSON. Upload the .json file itself.'] }
    }
  }

  if (!isPlainObject(raw)) {
    return {
      dataset: null,
      problems: ['The file must be one JSON object with "format", "source" and "events".'],
    }
  }

  const problems = []

  if (raw.format !== IMPORT_DATASET_FORMAT) {
    problems.push(
      `format: This build reads "${IMPORT_DATASET_FORMAT}" files only, and this file does not say it is one.`,
    )
  }

  if (!IMPORT_SOURCES.includes(raw.source)) {
    problems.push('source: This file names a source this build does not import from.')
  }

  problems.push(...retiredFieldProblems(raw))

  const parsed = importDatasetSchema.safeParse(raw)

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // The problems above already say these in their own words.
      if (issue.path.length === 1 && (issue.path[0] === 'format' || issue.path[0] === 'source')) {
        continue
      }
      if (isRetiredFieldIssue(issue)) continue

      problems.push(`${placeOf(issue.path, raw)}: ${issue.message}`)
    }
  }

  const unique = [...new Set(problems)]

  if (unique.length === 0) return { dataset: parsed.data, problems: [] }

  if (unique.length > IMPORT_PROBLEM_LIMIT) {
    const shown = unique.slice(0, IMPORT_PROBLEM_LIMIT - 1)

    shown.push(`${unique.length - shown.length} more problems are not listed.`)

    return { dataset: null, problems: shown }
  }

  return { dataset: null, problems: unique }
}

/**
 * The digest of a listing as a run stored it, or null when it cannot be read.
 *
 * @param {unknown} storedDataset `EventImportRun.dataset`.
 * @param {string} sourceId The listing.
 * @returns {string|null} Its content digest.
 */
function storedListingDigest(storedDataset, sourceId) {
  const listing = Array.isArray(storedDataset?.events)
    ? storedDataset.events.find((event) => event?.sourceId === sourceId)
    : undefined

  if (!listing) return null

  const parsed = importEventSchema.safeParse(listing)

  return parsed.success ? listingDigest(parsed.data) : null
}

/**
 * One row of a plan, from the listing and what the database holds for it.
 *
 * @param {object} params The row's inputs.
 * @param {object} params.listing The parsed listing.
 * @param {object|null} params.existing Its import record (`eventId`, `reassignedAt`, `event.status`, `event.organization.platformHeldSource`), or null.
 * @param {string|null} params.previousDigest The digest of the listing last written, or null.
 * @param {Date} params.now The clock.
 * @returns {object} The row.
 */
export function planRow({ listing, existing, previousDigest, now }) {
  const contentDigest = listingDigest(listing)
  const status = existing?.event?.status ?? null
  const past = Date.parse(listing.startsAt) <= now.getTime()
  const priceProblem = listingPriceProblem(listing)
  let action
  let resubmit = false
  let problem = null

  if (!existing) {
    if (past) action = 'SKIPPED_PAST'
    else if (priceProblem) action = 'INVALID'
    else action = 'CREATE'
  } else if (existing.reassignedAt || !existing.event?.organization?.platformHeldSource) {
    action = 'SKIPPED_REASSIGNED'
  } else if (status === 'DELETED') {
    action = 'SKIPPED_DELETED'
  } else if (past) {
    action = 'SKIPPED_PAST'
  } else {
    const changed = planActionForStatus(status)

    if (WRITABLE_ACTIONS.has(changed) && previousDigest === contentDigest) {
      action = 'UNCHANGED'
      resubmit = RESUBMIT_STATUSES.has(status)
    } else if (WRITABLE_ACTIONS.has(changed) && priceProblem) {
      action = 'INVALID'
    } else {
      action = changed
    }
  }

  if (action === 'INVALID') problem = priceProblem

  // What applying makes of the prices: a listing that repeats a price makes
  // one ticket type of it, so the counts are the ticket types', not the prices'.
  const tiers = listingTiers(listing)

  return {
    sourceId: listing.sourceId,
    title: listing.title,
    startsAt: listing.startsAt,
    city: listing.venue.city,
    action,
    eventId: existing?.eventId ?? null,
    eventStatus: status,
    resubmit,
    updatable: action === 'POSTED_KEPT',
    contentDigest,
    problem,
    importNotes: listing.importNotes,
    priceCount: tiers.length,
    soldOutCount: tiers.filter((tier) => tier.soldOut).length,
    currency: listingCurrency(listing),
    endTimeListed: listing.endsAt !== null,
  }
}

/**
 * Plan a parsed dataset against what the database holds.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {{dataset: object, now: Date}} options The parsed dataset and the clock.
 * @returns {Promise<{rows: object[], planDigest: string}>} One row per listing, in file order, and the plan's digest.
 */
export async function planImport(db, { dataset, now }) {
  const sourceIds = dataset.events.map((listing) => listing.sourceId)
  const items = await db.eventImportItem.findMany({
    where: { source: dataset.source, sourceId: { in: sourceIds } },
    select: {
      sourceId: true,
      eventId: true,
      lastRunId: true,
      reassignedAt: true,
      event: {
        select: { status: true, organization: { select: { platformHeldSource: true } } },
      },
    },
  })
  const runIds = [...new Set(items.map((item) => item.lastRunId).filter(Boolean))]
  const runs =
    runIds.length > 0
      ? await db.eventImportRun.findMany({
          where: { id: { in: runIds } },
          select: { id: true, dataset: true },
        })
      : []
  const runDatasets = new Map(runs.map((run) => [run.id, run.dataset]))
  const itemsById = new Map(items.map((item) => [item.sourceId, item]))

  const rows = dataset.events.map((listing) => {
    const existing = itemsById.get(listing.sourceId) ?? null
    const previousDigest =
      existing?.lastRunId && runDatasets.has(existing.lastRunId)
        ? storedListingDigest(runDatasets.get(existing.lastRunId), listing.sourceId)
        : null

    return planRow({ listing, existing, previousDigest, now })
  })

  for (const row of rows) {
    if (!IMPORT_PLAN_ACTIONS.includes(row.action)) {
      throw new Error(`Unknown import plan action ${row.action}.`)
    }
  }

  return { rows, planDigest: canonicalDigest(rows) }
}
