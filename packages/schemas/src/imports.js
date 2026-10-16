/**
 * Importing listed events onto The Desi Events, by the team at The Desi Events
 * (SPEC2-XI area I): the dataset file's shape, and the bodies of the import
 * routes.
 *
 * At `@desi-event/schemas/imports`. Server-only in use — the upload form reads
 * the file in the browser and sends it as it is; the API parses it — but
 * nothing here is secret, and it imports nothing the browser may not have.
 *
 * Since 2026-10-15 (the owner: "no connection" with the site the listings came
 * from) a file carries **no web address at all**: no listing link, no ticket
 * link, no picture, no source site and no picture hosts. A listing is known by
 * its `sourceId` only, which keeps an import idempotent. Each listed price
 * becomes a ticket type sold on The Desi Events ({@link IMPORT_TIER_DEFAULTS}).
 * The schema is strict, so a file that still carries an address is refused;
 * the API words that refusal itself (`lib/import-dataset.js`).
 *
 * @module @desi-event/schemas/imports
 */

import { z } from 'zod'

import { eventCategorySchema, eventImportSourceSchema, eventStatusSchema } from './enums.js'
import { controlReasonSchema } from './event-control.js'
import {
  centsSchema,
  cuidSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  revisionPreconditionSchema,
  timezoneSchema,
} from './primitives.js'

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
  /** Imported and posted: left alone unless the administrator ticks it to be updated from its source listing. */
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
  /** The listing cannot be imported as it is (its prices are not in the venue country's currency). */
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
 * What each listed price becomes on import: a general-admission ticket type
 * sold on The Desi Events. The listing gives no quantity, so each tier gets an
 * **allowance** of 100 tickets, marked `TicketType.quantityIsAllowance` so no
 * page shows a count of tickets left that was never the organiser's; an
 * administrator changes it in the tier editor at any time. A price the listing
 * marked sold out is made `CLOSED`: shown, not on sale.
 */
export const IMPORT_TIER_DEFAULTS = Object.freeze({
  quantityTotal: 100,
  minPerOrder: 1,
  maxPerOrder: 10,
})

/**
 * Whether a listed price's note says the listing had sold out of it.
 *
 * @param {string|null|undefined} note The price's note.
 * @returns {boolean} True for "Sold Out" and the like.
 */
export function priceNoteSaysSoldOut(note) {
  return typeof note === 'string' && /\bsold[\s-]*out\b/iu.test(note)
}

/**
 * The fields a file carried before 2026-10-15 that it may no longer carry:
 * each is a web address on the source's own site, or names it.
 */
export const RETIRED_DATASET_FIELDS = Object.freeze(['sourceName', 'sourceSite', 'imageHosts'])

/** The listing fields retired with them: the listing's link, its ticket link and its pictures. */
export const RETIRED_LISTING_FIELDS = Object.freeze(['sourceUrl', 'ticketUrl', 'images'])

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

/**
 * A price as the listing gives it. Each becomes a ticket type
 * ({@link IMPORT_TIER_DEFAULTS}); `note` is for the administrator only.
 */
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
    /** What the curator noted, for the administrator only. */
    importNotes: z.array(text(500)).max(IMPORT_LIMITS.importNotes),
  })
  .strict()

/** A whole import file. */
export const importDatasetSchema = z
  .object({
    format: z.literal(IMPORT_DATASET_FORMAT),
    source: eventImportSourceSchema,
    collectedFrom: isoDateTimeSchema,
    collectedTo: isoDateTimeSchema,
    curatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'A date as YYYY-MM-DD.'),
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
      .array(z.object({ eventId: cuidSchema, revision: revisionPreconditionSchema }).strict())
      .min(1)
      .max(IMPORT_LIMITS.approveItems)
      .refine(
        (items) => new Set(items.map((item) => item.eventId)).size === items.length,
        'Name each event once.',
      ),
  })
  .strict()

/** The digest of the pending list an administrator read: 64 hexadecimal characters. */
const pendingDigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'A list digest is 64 hexadecimal characters.')

/**
 * `POST /v1/platform/imports/approve-pending`: the digest of the list of
 * pending imported events the administrator read. A list that has changed
 * since is refused, so what is approved is what they were shown.
 */
export const eventImportApprovePendingRequestSchema = z
  .object({ digest: pendingDigestSchema })
  .strict()

/** One imported event waiting for "Approve and publish", in any run. */
export const pendingImportedEventSchema = z.object({
  eventId: cuidSchema,
  title: z.string().min(1).max(IMPORT_LIMITS.title),
  startsAt: isoDateTimeSchema,
  /** REVIEW_PENDING, APPROVED, or PUBLISHED with an imported ticket type that can go on sale. */
  status: z.enum(['REVIEW_PENDING', 'APPROVED', 'PUBLISHED']),
  revision: z.int().min(0),
  /** The run that last wrote it, which is the run it is approved from. */
  runId: cuidSchema,
  sourceId: importSourceIdSchema,
  city: z.string().max(200).nullable(),
  region: z.string().max(120).nullable(),
  /** Whether approving it puts something on sale; false means it is published with nothing to sell. */
  willGoOnSale: z.boolean(),
})

/** `GET /v1/platform/imports/pending`: every imported event waiting, across every run. */
export const eventImportPendingResponseSchema = z.object({
  data: z.object({
    /** What `approve-pending` must name: over each event's id, revision and last run. */
    digest: pendingDigestSchema,
    total: z.int().min(0),
    /** How many approving puts on sale. */
    willGoOnSale: z.int().min(0),
    /** How many approving publishes with nothing to sell: no prices, or every price sold out. */
    publishedNothingToSell: z.int().min(0),
    /** Imported events waiting for approval that start within the minute or have started: left out. */
    past: z.int().min(0),
    items: z.array(pendingImportedEventSchema),
  }),
})

/** What approving one pending event did. */
export const pendingApprovalResultSchema = z.object({
  eventId: cuidSchema,
  outcome: z.enum(['PUBLISHED', 'SALES_OPENED', 'REFUSED']),
  status: eventStatusSchema.nullable(),
  revision: z.int().min(0).nullable(),
  ticketTypesOnSale: z.int().min(0),
  code: z.string().max(100).nullable(),
  message: z.string().max(1000).nullable(),
})

/** `POST /v1/platform/imports/approve-pending`: the counts, and each event's result. */
export const eventImportApprovePendingResponseSchema = z.object({
  data: z.object({
    total: z.int().min(0),
    /** How many are on sale after it. */
    onSale: z.int().min(0),
    /** How many were published with nothing to sell. */
    publishedNothingToSell: z.int().min(0),
    refused: z.int().min(0),
    /** Imported events waiting that had started, or start within the minute: left out. */
    skippedPast: z.int().min(0),
    results: z.array(pendingApprovalResultSchema),
    refusals: z.array(
      z.object({
        eventId: cuidSchema,
        code: z.string().max(100).nullable(),
        message: z.string().max(1000).nullable(),
      }),
    ),
  }),
})

/** `POST /v1/platform/imports/events/:eventId/reassign`. */
export const eventImportReassignRequestSchema = z
  .object({
    organizationId: cuidSchema,
    reason: controlReasonSchema,
    revision: revisionPreconditionSchema,
  })
  .strict()

/** `GET /v1/platform/imports`: a page of runs, newest first. */
export const eventImportListQuerySchema = paginationQuerySchema

/** `:runId` in the run routes. */
export const eventImportRunParamSchema = z.object({ runId: cuidSchema })

/** `:eventId` in the reassign route. */
export const eventImportEventParamSchema = z.object({ eventId: cuidSchema })

/** `GET /v1/platform/import-targets`: organisations matched by name or web address. */
export const importTargetQuerySchema = z.object({
  q: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z
        .string()
        .min(1)
        .max(120)
        .refine((value) => !/\p{Cc}/u.test(value), 'Remove the control character.'),
    )
    .optional(),
})
