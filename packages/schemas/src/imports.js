/**
 * Importing events listed on another site (Sulekha) onto Desi-Event, by the
 * Desi-Event team (SPEC2-XI area I): the dataset file's shape, and the bodies
 * of the import routes.
 *
 * At `@desi-event/schemas/imports`. Server-only in use — the upload form reads
 * the file in the browser and sends it as it is; the API parses it — but
 * nothing here is secret, and it imports nothing the browser may not have.
 *
 * The schema checks shape only. Which hosts a file may name (one picture host,
 * one source host) and whether its listings are still to come are checked at
 * run time by the API's `lib/import-dataset.js`, because the file is uploaded
 * by a person and every rule has to hold for that file, not only for the one
 * committed to the repository.
 *
 * @module @desi-event/schemas/imports
 */

import { z } from 'zod'

import { eventCategorySchema, eventImportSourceSchema } from './enums.js'
import { controlReasonSchema } from './event-control.js'
import { centsSchema, cuidSchema, isoDateTimeSchema, timezoneSchema } from './primitives.js'

/** The format every import file declares, and the only one this build reads. */
export const IMPORT_DATASET_FORMAT = 'desi-event-import/1'

/** What applying a plan does to one listing. Every `EventStatus` maps to exactly one. */
export const IMPORT_PLAN_ACTIONS = Object.freeze([
  /** Not imported before: a new draft, sent for review. */
  'CREATE',
  /** Imported, and still a draft, sent back for changes, or waiting for review: updated. */
  'UPDATE_DRAFT',
  /** Imported, and the listing has not changed. */
  'UNCHANGED',
  /** Imported and posted: left alone unless the administrator ticks "Update from Sulekha". */
  'POSTED_KEPT',
  /** Imported and posted, and the administrator chose to update it from the listing. */
  'UPDATE_POSTED',
  /** A reviewer has decided this version (approved, rejected or archived). */
  'SKIPPED_DECIDED',
  /** Imported, then deleted. */
  'SKIPPED_DELETED',
  /** Imported, then moved to an organiser's own organisation. */
  'SKIPPED_REASSIGNED',
  /** The listing's date has passed. */
  'SKIPPED_PAST',
  /** The listing cannot be imported as it is (its link does not pass the website rules). */
  'INVALID',
])

/** The bounds an import file is held to. */
export const IMPORT_LIMITS = Object.freeze({
  /** A file's size as the request carries it: 2 MiB (the route's own body limit). */
  datasetBytes: 2 * 1024 * 1024,
  fileName: 200,
  events: 500,
  prices: 20,
  importNotes: 20,
  images: 20,
  alt: 300,
  url: 2048,
  title: 200,
  summary: 500,
  description: 20_000,
  performers: 64,
  faq: 30,
  languages: 12,
  /** Approvals per request. */
  approveItems: 100,
})

/** The source's own id for a listing: 1-12 digits, as the database holds it. */
export const importSourceIdSchema = z
  .string()
  .regex(/^[0-9]{1,12}$/u, 'A listing id is 1 to 12 digits.')

/**
 * Whether a value is an absolute `https:` address within the length bound.
 *
 * @param {string} value The candidate.
 * @returns {boolean} True when it parses as https with a host.
 */
function isHttpsAddress(value) {
  if (value.length > IMPORT_LIMITS.url) return false

  try {
    const url = new URL(value)

    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

/** An absolute `https:` address. Its host is checked at run time. */
const httpsAddressSchema = z.string().min(1).refine(isHttpsAddress, 'Use a full https:// address.')

/**
 * A trimmed line of text between `min` and `max` characters.
 *
 * @param {number} max The upper bound.
 * @param {number} [min] The lower bound.
 * @returns {z.ZodType} The schema.
 */
function text(max, min = 1) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().min(min).max(max),
  )
}

/** An optional line the source may leave out. */
function optionalText(max) {
  return text(max).nullable()
}

/** A picture the source lists for an event. */
export const importImageSchema = z
  .object({
    url: httpsAddressSchema,
    role: z.enum(['cover', 'gallery']),
    alt: text(IMPORT_LIMITS.alt),
  })
  .strict()

/** A price as the source lists it. No ticket type is made from it. */
export const importPriceSchema = z
  .object({
    name: text(100),
    priceCents: centsSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u, 'A three-letter currency code.'),
    note: optionalText(200),
  })
  .strict()

/** One listing in an import file. */
export const importEventSchema = z
  .object({
    sourceId: importSourceIdSchema,
    sourceUrl: httpsAddressSchema,
    scrapedAt: isoDateTimeSchema,
    title: text(IMPORT_LIMITS.title),
    category: eventCategorySchema,
    /** The source's own category name, kept for the administrator's notes. */
    sourceCategory: z.string().regex(/^[A-Z][A-Z_]{0,39}$/u, 'An upper-case category name.'),
    summary: text(IMPORT_LIMITS.summary),
    description: text(IMPORT_LIMITS.description),
    startsAt: isoDateTimeSchema,
    /** Null when the source lists no end time. */
    endsAt: isoDateTimeSchema.nullable(),
    timeZone: timezoneSchema,
    venue: z
      .object({
        name: text(200),
        addressLine1: text(200),
        city: text(100),
        region: text(100),
        postalCode: text(20),
        country: z.string().regex(/^[A-Z]{2}$/u, 'A two-letter country code.'),
      })
      .strict(),
    performers: z
      .array(z.object({ name: text(200), role: optionalText(100) }).strict())
      .max(IMPORT_LIMITS.performers),
    /** The organiser the listing names, shown as "Presented by". */
    presentedBy: optionalText(200),
    languages: z.array(text(40)).max(IMPORT_LIMITS.languages),
    prices: z.array(importPriceSchema).max(IMPORT_LIMITS.prices),
    priceText: optionalText(200),
    ageRestriction: optionalText(200),
    dressCode: optionalText(200),
    parking: optionalText(500),
    faq: z.array(z.object({ q: text(500), a: text(2000) }).strict()).max(IMPORT_LIMITS.faq),
    images: z
      .array(importImageSchema)
      .max(IMPORT_LIMITS.images)
      .refine(
        (images) => images.filter((image) => image.role === 'cover').length <= 1,
        'A listing has at most one cover picture.',
      ),
    ticketUrl: httpsAddressSchema,
    /** What the curator noted, for the administrator only. */
    importNotes: z.array(text(500)).max(IMPORT_LIMITS.importNotes),
  })
  .strict()

/** A whole import file. */
export const importDatasetSchema = z
  .object({
    format: z.literal(IMPORT_DATASET_FORMAT),
    source: eventImportSourceSchema,
    sourceName: text(100),
    sourceSite: httpsAddressSchema,
    collectedFrom: isoDateTimeSchema,
    collectedTo: isoDateTimeSchema,
    curatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'A date as YYYY-MM-DD.'),
    imageHosts: z
      .array(z.string().regex(/^[a-z0-9.-]{1,253}$/u, 'A lower-case host name.'))
      .min(1)
      .max(10),
    events: z.array(importEventSchema).min(1).max(IMPORT_LIMITS.events),
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const seen = new Set()

    dataset.events.forEach((event, index) => {
      if (seen.has(event.sourceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'sourceId'],
          message: `Listing ${event.sourceId} appears more than once.`,
        })
      }
      seen.add(event.sourceId)

      if (event.endsAt !== null && Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'endsAt'],
          message: 'A listing ends after it starts.',
        })
      }
    })
  })

/**
 * `POST /v1/platform/imports`: an uploaded file and its name. The dataset is
 * parsed by the handler, so a file with problems is answered 422
 * `IMPORT_INVALID` with each problem listed, not 400.
 */
export const eventImportPreviewRequestSchema = z
  .object({
    fileName: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z
        .string()
        .min(1)
        .max(IMPORT_LIMITS.fileName)
        .refine(
          (value) => !/\p{Cc}/u.test(value) && !/[\\/]/u.test(value),
          'A file name, without folders or control characters.',
        ),
    ),
    dataset: z.unknown(),
  })
  .strict()

/** `POST /v1/platform/imports/:runId/apply`. */
export const eventImportApplyRequestSchema = z
  .object({
    /** The plan the administrator read; a plan that has changed since is refused. */
    planDigest: z.string().regex(/^[0-9a-f]{64}$/u, 'A plan digest is 64 hexadecimal characters.'),
    /** Posted listings to update from the source. Never sent by the command line. */
    updateFromSource: z
      .array(importSourceIdSchema)
      .max(IMPORT_LIMITS.events)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, 'Name each listing once.'),
  })
  .strict()

/** `POST /v1/platform/imports/:runId/approve`: the events, at the revisions the page showed. */
export const eventImportApproveRequestSchema = z
  .object({
    items: z
      .array(z.object({ eventId: cuidSchema, revision: z.int().min(0) }).strict())
      .min(1)
      .max(IMPORT_LIMITS.approveItems)
      .refine(
        (items) => new Set(items.map((item) => item.eventId)).size === items.length,
        'Name each event once.',
      ),
  })
  .strict()

/** `POST /v1/platform/imports/events/:eventId/reassign`. */
export const eventImportReassignRequestSchema = z
  .object({
    organizationId: cuidSchema,
    reason: controlReasonSchema,
    revision: z.int().min(0),
  })
  .strict()
