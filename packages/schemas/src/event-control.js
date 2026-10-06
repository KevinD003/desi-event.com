/**
 * Full control of posted events: deleting and restoring an event, cancelling
 * one of its nights, the Desi-Event team's editing sittings, and what ticket
 * holders are shown changed (SPEC2-XI area X).
 *
 * Browser-safe, at `@desi-event/schemas/event-control`: nothing here imports
 * `entities.js`, so the organiser's dialogs can validate their own forms. The
 * two responses that carry a whole event or a page of rows are built beside
 * the routes that answer them.
 *
 * The server decides every outcome; a preview here is what it decided, and the
 * browser builds its sentences from the counts, never an outcome of its own.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/schemas/event-control
 */

import { z } from 'zod'

import {
  eventAuthoritySchema,
  eventChangeKindSchema,
  eventStatusSchema,
  platformEditEndSchema,
} from './enums.js'
import { DELETION_OUTCOMES } from './lifecycle.js'
import { cuidSchema, slugSchema, timestampSchema } from './primitives.js'

/** How long a platform edit sitting lasts, in minutes (the database allows two hours). */
export const PLATFORM_EDIT_MINUTES = 60

/**
 * How long before a night's doors (or its start, when it lists no door time)
 * the night counts as started: nothing about it may then be cancelled, and an
 * event with a started night may not be deleted until its last night is over.
 */
export const NIGHT_START_MARGIN_MINUTES = 60

/** The bounds of every reason this area asks for. */
export const CONTROL_REASON_LIMITS = Object.freeze({ min: 10, max: 500 })

/**
 * The description every reason box carries (SPEC2-XI §0.8): reasons are kept as
 * written and are not rewritten by the privacy process.
 */
export const CONTROL_REASON_DESCRIPTION =
  "Shown with the event's history. Do not include anybody's personal details."

/** Refusal codes a deletion preview or commit can carry. */
export const DELETION_REFUSALS = Object.freeze([
  'EVENT_IN_PROGRESS',
  'PAYMENT_IN_FLIGHT',
  'UNEXPECTED_ORDERS',
  'ALREADY_DELETED',
])

/** Refusal codes a night-cancellation preview can carry. */
export const SESSION_CANCELLATION_REFUSALS = Object.freeze([
  'SESSION_STARTED',
  'LAST_SESSION',
  'PAYMENT_IN_FLIGHT',
  'NOT_LIVE',
  'NOT_EDITABLE',
])

/** The payment modes a preview names, so its sentence says what moves. */
export const CONTROL_PAYMENT_MODES = Object.freeze(['MOCK', 'STRIPE_TEST', 'LIVE'])

/** A control character a reason may not carry. Line breaks and tabs are allowed. */
const REASON_CONTROL = /(?![\t\n\r])\p{Cc}/u

/**
 * A reason for deleting, restoring, cancelling a night or opening a platform
 * edit: 10 to 500 characters once trimmed, with no control character but a
 * line break or a tab.
 */
export const controlReasonSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z
    .string()
    .min(CONTROL_REASON_LIMITS.min, 'Give a reason of at least 10 characters.')
    .max(CONTROL_REASON_LIMITS.max, 'Keep the reason to 500 characters.')
    .refine(
      (value) => !REASON_CONTROL.test(value),
      'Take the control characters out of the reason.',
    ),
)

/** A revision the caller read, for the compare-and-set every write here makes. */
const revisionSchema = z.int().min(0)

/** A count in a preview or a summary. */
const countSchema = z.int().min(0)

/** A money amount in a preview or a summary, in the smallest unit. */
const amountSchema = z.int().min(0)

/** A three-letter currency, or null when nothing is owed. */
const currencyOrNullSchema = z
  .string()
  .regex(/^[A-Z]{3}$/u)
  .nullable()

/**
 * `POST /v1/events/:id/delete`.
 *
 * `confirmSlug` is the event's web address typed back; the server compares it
 * after trimming and lower-casing. `expectedOutcome` is the preview's outcome,
 * which must still hold at commit. `confirmTookPlace` is needed only to remove
 * a finished event nobody was checked in at without refunding anybody.
 */
export const deleteEventRequestSchema = z
  .object({
    revision: revisionSchema,
    reason: controlReasonSchema,
    confirmSlug: z
      .string()
      .min(1, 'Type the web address to confirm.')
      .max(200, 'That is not this event’s web address.'),
    expectedOutcome: z.enum(DELETION_OUTCOMES),
    confirmTookPlace: z.literal(true).optional(),
  })
  .strict()

/** What a deletion would touch, counted. */
export const deletionCountsSchema = z.object({
  paidOrders: countSchema,
  refundableCents: amountSchema,
  currency: currencyOrNullSchema,
  pendingOrders: countSchema,
  paymentsInFlight: countSchema,
  activeHolds: countSchema,
  tickets: countSchema,
  checkIns: countSchema,
  zeroValueOrders: countSchema,
  disputedOrders: countSchema,
  partlyRefundedOrders: countSchema,
})

/** `GET /v1/events/:id/deletion`: what deleting the event would do now. */
export const eventDeletionPreviewSchema = z.object({
  eventId: cuidSchema,
  status: eventStatusSchema,
  revision: revisionSchema,
  outcome: z.enum(DELETION_OUTCOMES).nullable(),
  /** Present when the person deleting must say what happened (a finished event nobody was checked in at). */
  choices: z.array(z.enum(DELETION_OUTCOMES)).max(DELETION_OUTCOMES.length).nullable(),
  needsTookPlaceConfirmation: z.boolean(),
  refusal: z.object({ code: z.enum(DELETION_REFUSALS), message: z.string() }).nullable(),
  authority: eventAuthoritySchema.nullable(),
  permitted: z.boolean(),
  /** Why the reader may not, in a sentence, when `permitted` is false. */
  missing: z.string().nullable(),
  counts: deletionCountsSchema,
  slug: z.object({ value: slugSchema, keptRetired: z.boolean() }),
  paymentMode: z.enum(CONTROL_PAYMENT_MODES),
})

/** `GET /v1/events/:id/deletion` response. */
export const eventDeletionPreviewResponseSchema = z.object({ data: eventDeletionPreviewSchema })

/** What one pass of the refund driver did. */
export const refundDriveSummarySchema = z.object({
  owed: countSchema,
  settled: countSchema,
  waiting: countSchema,
  failed: countSchema,
  /** Orders left to the finance team because their payment is disputed. */
  disputed: countSchema,
  amountCents: amountSchema,
  currency: currencyOrNullSchema,
})

/** `POST /v1/events/:id/refunds/finish` response. */
export const finishRefundsResponseSchema = z.object({ data: refundDriveSummarySchema })

/** `POST /v1/events/:id/sessions/:sessionId/cancel`. */
export const cancelSessionRequestSchema = z
  .object({
    revision: revisionSchema,
    reason: controlReasonSchema,
    confirm: z.literal(true, { error: 'Confirm that these orders are refunded.' }),
    expectedOrders: countSchema,
  })
  .strict()

/** `GET /v1/events/:id/sessions/:sessionId/cancellation`: what cancelling the night would do now. */
export const sessionCancellationPreviewSchema = z.object({
  sessionId: cuidSchema,
  revision: revisionSchema,
  permitted: z.boolean(),
  missing: z.string().nullable(),
  refusal: z
    .object({ code: z.enum(SESSION_CANCELLATION_REFUSALS), message: z.string() })
    .nullable(),
  /**
   * Every order the night touches: the sum of the five counts below, and the
   * number a cancellation sends back as `expectedOrders`.
   */
  orders: countSchema,
  ordersRefunded: countSchema,
  /** Every-night tickets: their holders are told, not refunded. */
  ordersToldOnly: countSchema,
  zeroValueOrders: countSchema,
  disputedOrders: countSchema,
  /** Unpaid orders for the night, nobody paying for them now: cancelled. */
  ordersCancelled: countSchema,
  ticketsWithdrawn: countSchema,
  refundableCents: amountSchema,
  currency: currencyOrNullSchema,
  paymentMode: z.enum(CONTROL_PAYMENT_MODES),
})

/** `GET /v1/events/:id/sessions/:sessionId/cancellation` response. */
export const sessionCancellationPreviewResponseSchema = z.object({
  data: sessionCancellationPreviewSchema,
})

/** `POST /v1/platform/events/:id/edit`. */
export const openPlatformEditRequestSchema = z.object({ reason: controlReasonSchema }).strict()

/** `POST /v1/platform/events/:id/restore`. */
export const restoreEventRequestSchema = z
  .object({ revision: revisionSchema, reason: controlReasonSchema })
  .strict()

/** One platform edit sitting, as its reader may see it. */
export const platformEditSchema = z.object({
  id: cuidSchema,
  openedAt: timestampSchema,
  expiresAt: timestampSchema,
  closedAt: timestampSchema.nullable(),
  /** EXPIRED is also what a read shows for a sitting that ran out unclosed. */
  endedBy: platformEditEndSchema.nullable(),
  open: z.boolean(),
  mine: z.boolean(),
  reason: z.string(),
  /** Platform readers only; null for the organiser. */
  administratorName: z.string().nullable(),
  changes: z
    .array(
      z.object({ action: z.string(), fields: z.array(z.string()).max(40), at: timestampSchema }),
    )
    .max(200),
})

/** `GET /v1/events/:id/platform-edits` response. */
export const platformEditListResponseSchema = z.object({ data: z.array(platformEditSchema) })

/** `POST /v1/platform/events/:id/edit` and `.../edit/close` response. */
export const platformEditResponseSchema = z.object({ data: platformEditSchema })

/** `GET /v1/platform/events` query. */
export const platformEventsQuerySchema = z.object({
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
  status: eventStatusSchema.optional(),
  organizationId: cuidSchema.optional(),
  deleted: z.enum(['exclude', 'only', 'include']).default('exclude'),
  imported: z.enum(['include', 'only', 'exclude']).default('include'),
  sort: z.enum(['updatedAt:desc', 'startsAt:asc', 'createdAt:desc']).default('updatedAt:desc'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
})

/** A deleted event's record, as the Desi-Event team's list shows it. */
export const platformEventDeletionSchema = z.object({
  deletedAt: timestampSchema,
  outcome: z.enum(DELETION_OUTCOMES),
  authority: eventAuthoritySchema,
  statusBefore: eventStatusSchema,
  restoreTo: eventStatusSchema,
})

/** One row of `GET /v1/platform/events`. */
export const platformEventRowSchema = z.object({
  id: cuidSchema,
  title: z.string(),
  slug: slugSchema,
  status: eventStatusSchema,
  startsAt: timestampSchema,
  updatedAt: timestampSchema,
  organization: z.object({ id: cuidSchema, name: z.string() }),
  paidOrders: countSchema,
  picturesWaiting: countSchema,
  imported: z.boolean(),
  deletion: platformEventDeletionSchema.nullable(),
})

/** What changed about an event since an order was placed, as its holder reads it. */
export const eventChangeNoticeSchema = z.object({
  id: cuidSchema,
  kind: eventChangeKindSchema,
  at: timestampSchema,
  changed: z.array(z.string()).max(40),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  sessionId: cuidSchema.nullable(),
  by: z.enum(['ORGANIZER', 'DESI_EVENT']),
})
