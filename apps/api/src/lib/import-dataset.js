/**
 * Reading an import file and planning what applying it does (SPEC2-XI §5.I-C).
 *
 * The file is uploaded by a person, so every rule the committed Sulekha file
 * is held to by its validator test holds here again, at run time, for whatever
 * file arrives: the shape (`importDatasetSchema`), the format and the source,
 * and the hosts. Pictures may come only from {@link IMPORT_IMAGE_HOSTS}, and
 * every listing and ticket link must be an `https:` page on
 * {@link IMPORT_SOURCE_HOSTS}, because approving an imported event turns on a
 * public link labelled "Buy tickets on Sulekha" to that address.
 *
 * The plan gives every listing one action. Every `EventStatus` maps to exactly
 * one (see {@link planActionForStatus}); a listing whose date has passed, whose
 * event was deleted or moved to an organiser's own organisation is skipped;
 * one whose content has not changed since it was last written is UNCHANGED.
 * "Last written" is the dataset of the run in `EventImportItem.lastRunId`:
 * apply moves `lastRunId` only for rows it writes or confirms unchanged
 * (CREATE, UPDATE_DRAFT, UPDATE_POSTED, UNCHANGED), never for a kept or
 * skipped one, so that run's copy of the listing is what the event holds.
 *
 * The plan's digest is SHA-256 over its canonical JSON. Apply recomputes the
 * plan and refuses one that has changed since the administrator read it.
 *
 * The user states that they own Sulekha.com and asked for its Texas events and
 * their photos to be imported, and later for every event of their own Sulekha
 * export, in the United States and Canada; that is recorded as their
 * statement. Nothing here assumes a country: a venue's country, region and
 * postal code, a listing's zone and a price's currency are each carried as the
 * file gives them (a Toronto listing: `CA`, `ON`, `M5V 2T6`,
 * `America/Toronto`, `CAD`).
 */

import { createHash } from 'node:crypto'

import {
  IMPORT_DATASET_FORMAT,
  IMPORT_PLAN_ACTIONS,
  importDatasetSchema,
  importEventSchema,
} from '@desi-event/schemas/imports'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { websiteUrlProblem } from '@desi-event/schemas/website'

import { httpError } from './errors.js'
import { checkImportImageUrl, IMPORT_IMAGE_HOSTS } from './import-images.js'

/** The only host a listing or ticket link may name. */
export const IMPORT_SOURCE_HOSTS = Object.freeze(['events.sulekha.com'])

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
 * The content digest of one listing, as parsed.
 *
 * @param {object} listing A listing from a parsed dataset.
 * @returns {string} 64 hexadecimal characters.
 */
export function listingDigest(listing) {
  return canonicalDigest(listing)
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
 * Why a listing or ticket link may not be imported, or null.
 *
 * @param {unknown} value The address.
 * @returns {string|null} The problem in words.
 */
export function sourceUrlProblem(value) {
  const sentence = `Use the listing's own https:// page on ${IMPORT_SOURCE_HOSTS.join(' or ')}.`

  if (typeof value !== 'string' || !/^https:\/\//iu.test(value)) return sentence

  let url

  try {
    url = new URL(value)
  } catch {
    return sentence
  }

  if (url.protocol !== 'https:') return sentence
  if (url.username !== '' || url.password !== '' || url.port !== '') return sentence
  if (!IMPORT_SOURCE_HOSTS.includes(url.hostname)) return sentence

  return null
}

/**
 * The run-time host checks, on the file as uploaded.
 *
 * @param {object} raw The file.
 * @returns {string[]} Problems, each placed.
 */
function hostProblems(raw) {
  const problems = []
  const imageSentence = `Pictures are copied only from https:// addresses on ${IMPORT_IMAGE_HOSTS.join(' or ')}.`

  if (Array.isArray(raw.imageHosts)) {
    raw.imageHosts.forEach((host, index) => {
      if (!IMPORT_IMAGE_HOSTS.includes(host)) {
        problems.push(`imageHosts[${index}]: ${imageSentence}`)
      }
    })
  }

  const declared = Array.isArray(raw.imageHosts) ? raw.imageHosts : []

  if (!Array.isArray(raw.events)) return problems

  raw.events.forEach((listing, index) => {
    if (!isPlainObject(listing)) return

    for (const field of ['sourceUrl', 'ticketUrl']) {
      const problem = sourceUrlProblem(listing[field])

      if (problem) problems.push(`${placeOf(['events', index, field], raw)}: ${problem}`)
    }

    if (!Array.isArray(listing.images)) return

    listing.images.forEach((image, position) => {
      const checked = checkImportImageUrl(image?.url)

      if (!checked.ok || !declared.includes(checked.url.hostname)) {
        problems.push(
          `${placeOf(['events', index, 'images', position, 'url'], raw)}: ${imageSentence}`,
        )
      }
    })
  })

  return problems
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
    problems.push('source: Only listings from Sulekha ("SULEKHA") can be imported.')
  }

  const parsed = importDatasetSchema.safeParse(raw)

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // The two problems above already say these in their own words.
      if (issue.path.length === 1 && (issue.path[0] === 'format' || issue.path[0] === 'source')) {
        continue
      }

      problems.push(`${placeOf(issue.path, raw)}: ${issue.message}`)
    }
  }

  problems.push(...hostProblems(raw))

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
  const linkProblem = websiteUrlProblem(listing.ticketUrl)
  let action
  let resubmit = false
  let problem = null

  if (!existing) {
    if (past) action = 'SKIPPED_PAST'
    else if (linkProblem) action = 'INVALID'
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
    } else if (WRITABLE_ACTIONS.has(changed) && linkProblem) {
      action = 'INVALID'
    } else {
      action = changed
    }
  }

  if (action === 'INVALID') problem = `Its ticket link cannot be used: ${linkProblem}`

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
    imageCount: listing.images.length,
    priceCount: listing.prices.length,
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
