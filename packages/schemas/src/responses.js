/**
 * Response body schemas.
 *
 * The API validates outbound payloads with these, and
 * `@desi-event/api-contract` renders them to JSON Schema for the OpenAPI
 * document — which is why nothing in this file uses `.transform()`.
 *
 * @module @desi-event/schemas/responses
 */

import { z } from 'zod'

import {
  centsSchema,
  countSchema,
  cuidSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  timestampSchema,
} from './primitives.js'
import { eventCategorySchema, logLevelSchema } from './enums.js'
import { PAYMENT_MODES } from './payments.js'
import {
  eventSummarySchema,
  eventWithRelationsSchema,
  notificationSummarySchema,
  orderWithItemsSchema,
  organizationSchema,
  publicUserSchema,
  refundSchema,
  ticketSchema,
  ticketTypeSchema,
} from './entities.js'

/** Page counters returned alongside every list payload. */
export const paginationMetaSchema = z.object({
  page: z.int().min(1),
  perPage: z.int().min(1),
  total: z.int().min(0),
  totalPages: z.int().min(0),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
})

/**
 * Build the pagination block for a list response.
 *
 * @param {object} args Counter inputs.
 * @param {number} args.page Current 1-based page number.
 * @param {number} args.perPage Page size actually used.
 * @param {number} args.total Total number of matching rows.
 * @returns {{page: number, perPage: number, total: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean}} Pagination metadata.
 */
export function buildPaginationMeta({ page, perPage, total }) {
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0

  return {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  }
}

/** A single validation issue as sent to a client. */
export const issueResponseSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})

/** The one error envelope every failing endpoint returns. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    statusCode: z.int().min(100).max(599),
    issues: z.array(issueResponseSchema).optional(),
    /**
     * Human-readable reasons a business rule refused, in the order they were
     * found.
     *
     * Distinct from `issues`, which are schema violations keyed to a field.
     * These are coherence failures a schema cannot express — "a reserved ticket
     * type needs a price zone", "the sales window closes before it opens" — and
     * they are plural because an organiser fixing one thing at a time and
     * resubmitting is a worse experience than a list.
     *
     * They were being collected and then dropped: the services built the array,
     * attached it to the error, and the serialiser forwarded only `issues`. So
     * a 422 said "that is not coherent" and nothing else.
     */
    problems: z.array(z.string()).optional(),
    requestId: z.string().min(1).max(64).optional(),
  }),
})

/** Successful sign-up or sign-in. */
export const authResponseSchema = z.object({
  token: z.string().min(1),
  tokenType: z.literal('Bearer').default('Bearer'),
  expiresIn: z.string().min(1).default('7d'),
  user: publicUserSchema,
})

/** `GET /events`. */
export const eventListResponseSchema = z.object({
  data: z.array(eventSummarySchema),
  pagination: paginationMetaSchema,
})

/** `GET /events/:slug`. */
export const eventDetailResponseSchema = z.object({
  data: eventWithRelationsSchema,
})

/** `GET /orders/:id` and the response to a successful checkout. */
export const orderResponseSchema = z.object({
  data: orderWithItemsSchema,
})

/** `GET /events/:id/ticket-types`, with live availability folded in. */
export const ticketTypeListResponseSchema = z.object({
  data: z.array(
    ticketTypeSchema.extend({
      availableQuantity: z.int().min(0).optional(),
      isSoldOut: z.boolean().optional(),
    }),
  ),
})

/** Response to a successful inventory hold. */
export const holdResponseSchema = z.object({
  data: z.object({
    id: cuidSchema,
    ticketTypeId: cuidSchema,
    quantity: z.int().min(1),
    expiresAt: timestampSchema,
    unitPriceCents: centsSchema.optional(),
    /**
     * Returned exactly once, when an anonymous caller takes a hold, and never
     * stored in plaintext. The caller must present it to release the hold.
     * Absent for holds owned by an authenticated user, whose identity comes
     * from their token instead.
     */
    guestToken: z.string().min(1).optional(),
  }),
})

/** Response to a door scan. */
export const checkInResponseSchema = z.object({
  data: z.object({
    ticket: ticketSchema,
    alreadyCheckedIn: z.boolean().default(false),
  }),
})

/** `GET /organizations/:id`. */
export const organizationResponseSchema = z.object({
  data: organizationSchema,
})

/** `GET /health` and `GET /ready`. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  uptimeSeconds: z.number().min(0).optional(),
  version: z.string().min(1).max(32).optional(),
  logLevel: logLevelSchema.optional(),
  timestamp: timestampSchema,
  checks: z
    .object({
      database: z.boolean(),
      redis: z.boolean(),
    })
    .partial()
    .optional(),
  /**
   * What this instance can do with money.
   *
   * There is one payment mode and it moves no money. Reporting it on the
   * liveness probe means an operator never has to read the source to find out
   * whether a deployment can charge a card: it cannot, and it says so.
   */
  payments: z
    .object({
      mode: z.enum([PAYMENT_MODES.MOCK, PAYMENT_MODES.STRIPE_TEST]),
      demo: z.literal(true),
      live: z.literal(false).optional(),
      label: z.string().min(1).max(16).optional(),
      message: z.string().min(1).max(200),
    })
    .optional(),
})

/** Envelope for endpoints that only confirm the write succeeded. */
export const okResponseSchema = z.object({
  ok: z.literal(true),
})

/**
 * Facet counts for the event catalogue.
 *
 * Computed over the whole eligible set, not over the page being displayed.
 * Paginating the results must not shrink the filter universe: a city whose
 * events all fall outside the current page still has to be selectable, or the
 * filters silently hide part of the catalogue.
 */
export const eventFacetsResponseSchema = z.object({
  data: z.object({
    /** The query scope these counts were computed over. */
    scope: z.object({
      status: z.string(),
      total: countSchema,
    }),
    categories: z.array(z.object({ value: eventCategorySchema, count: countSchema })),
    cities: z.array(z.object({ value: z.string(), count: countSchema })),
    languages: z.array(z.object({ value: z.string(), count: countSchema })),
    formats: z.array(z.object({ value: z.enum(['online', 'in_person']), count: countSchema })),
  }),
})

/**
 * One entry in an event's moderation history.
 *
 * `reason` is included because the organiser needs to read what was asked of
 * them. The public event payload never carries this shape at all — the history
 * of a negotiation is between the two parties to it.
 */
export const moderationActionSchema = z.object({
  id: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reason: z.string().nullable(),
  requestedChanges: z.record(z.string(), z.string()).nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
})

/** An event's moderation history, newest first. */
export const moderationHistoryResponseSchema = z.object({
  data: z.array(moderationActionSchema),
})

/**
 * What an actor may do to an event right now.
 *
 * `entitled` and `blockers` are separate on purpose: "you may not" and "not
 * yet" are different sentences, and a screen that conflates them tells an
 * organiser to ask for a permission they already have.
 */
export const availableTransitionSchema = z.object({
  to: z.string(),
  actor: z.string(),
  entitled: z.boolean(),
  blockers: z.array(z.string()),
})

/** The moves available out of an event's current status. */
export const eventTransitionsResponseSchema = z.object({
  data: z.object({
    status: z.string(),
    transitions: z.array(availableTransitionSchema),
  }),
})

/** One session of an event, as an organiser sees it. */
export const eventSessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  doorsOpenAt: z.string().nullable(),
  timezone: z.string(),
  salesStartAt: z.string().nullable(),
  salesEndAt: z.string().nullable(),
  status: z.string(),
  venueMapVersionId: z.string().nullable(),
  capacity: z.number().nullable(),
  sortOrder: z.number(),
})

/** A session, with the event's new revision so the editor can keep editing. */
export const eventSessionResponseSchema = z.object({
  data: eventSessionSchema,
  meta: z.object({ revision: z.number() }),
})

/**
 * Every session of an event.
 *
 * `eventSession`, not `session`: `sessionListResponseSchema` already exists and
 * means a signed-in person's *authentication* sessions. Two things called a
 * session is the kind of collision that produces a route returning the wrong
 * shape and nobody noticing until it is in a browser.
 */
export const eventSessionListResponseSchema = z.object({
  data: z.array(eventSessionSchema),
  meta: z.object({ revision: z.number() }),
})

/** A ticket type, with the event's new revision. */
export const authorTicketTypeResponseSchema = z.object({
  data: ticketTypeSchema,
  meta: z.object({ revision: z.number() }),
})

/**
 * What preparing inventory did.
 *
 * `created` and `prepared` are separate because the difference is the whole
 * point: a second run creates nothing and leaves `prepared` where it was, which
 * is how a caller can see the command was idempotent rather than being told so.
 */
export const inventoryPreparationResponseSchema = z.object({
  data: z.object({
    sessionId: z.string(),
    kind: z.enum(['reserved', 'general_admission']),
    expected: z.number(),
    prepared: z.number(),
    created: z.number(),
  }),
})

/**
 * Whether an event is ready to be published, and what is missing.
 *
 * Every blocker rather than the first, because an organiser fixing one thing at
 * a time and resubmitting is worse than a list — and a moderator reading the
 * same list knows what to expect.
 */
export const readinessResponseSchema = z.object({
  data: z.object({
    ready: z.boolean(),
    status: z.string(),
    publishable: z.array(z.string()),
    sellable: z.array(z.string()),
    inventory: z.array(z.string()),
    organizerVerified: z.boolean(),
  }),
})

/**
 * The all-in price of a ticket, as a buyer will be charged it.
 *
 * A face value that becomes something else at the last step of checkout is the
 * practice this makes hard to ship by accident.
 */
export const pricePreviewResponseSchema = z.object({
  data: z.array(
    z.object({
      ticketTypeId: z.string(),
      name: z.string(),
      currency: z.string(),
      quantity: z.number(),
      faceValueCents: z.number(),
      feesCents: z.number(),
      taxCents: z.number(),
      allInCents: z.number(),
    }),
  ),
})

/** `GET /operations/notifications`. */
export const notificationListResponseSchema = z.object({
  data: z.array(notificationSummarySchema),
  pagination: paginationMetaSchema,
})

/** `GET /operations/notifications/:id`, and the two actions on one. */
export const notificationDetailResponseSchema = z.object({
  data: notificationSummarySchema,
})

/** `GET /refunds`. */
export const refundListResponseSchema = z.object({
  data: z.array(refundSchema),
  pagination: paginationMetaSchema,
})

/** `GET /refunds/:id`, and every action that returns one refund. */
export const refundResponseSchema = z.object({
  data: refundSchema,
})

/**
 * What an order has left to give back.
 *
 * Returned alongside the refund on a request, because "it worked" is not the
 * useful answer — "and there is this much left" is, and computing it on the
 * client from a list of refunds is how two screens end up disagreeing.
 */
export const refundableResponseSchema = z.object({
  data: z.object({
    orderId: cuidSchema,
    orderReference: orderReferenceSchema,
    currency: z.string(),
    totalCents: z.number().int(),
    refundedCents: z.number().int(),
    refundPendingCents: z.number().int(),
    refundableCents: z.number().int(),
    lines: z.array(
      z.object({
        orderItemId: cuidSchema,
        ticketTypeId: cuidSchema,
        ticketTypeName: z.string(),
        quantity: z.number().int(),
        unitPriceCents: z.number().int(),
        refundedQuantity: z.number().int(),
        pendingQuantity: z.number().int(),
        refundableQuantity: z.number().int(),
      }),
    ),
    refunds: z.array(refundSchema),
  }),
})
