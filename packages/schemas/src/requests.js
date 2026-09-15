/**
 * Request body and query schemas for the public API.
 *
 * Cross-field business rules live here rather than in route handlers: a rule
 * expressed once in the schema is enforced identically by the API, by the
 * worker replaying a payload and by the web app validating a form before it
 * ever hits the network.
 *
 * @module @desi-event/schemas/requests
 */

import { z } from 'zod'

import {
  centsSchema,
  countSchema,
  cuidSchema,
  currencySchema,
  emailSchema,
  localeSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  passwordSchema,
  phoneSchema,
  promoCodeStringSchema,
  quantitySchema,
  queryDateTimeSchema,
  richTextSchema,
  slugSchema,
  ticketCodeSchema,
  timestampSchema,
  timezoneSchema,
  urlSchema,
  paginationQuerySchema,
} from './primitives.js'
import {
  eventCategorySchema,
  eventStatusSchema,
  promoTypeSchema,
  ticketTypeStatusSchema,
} from './enums.js'

/** Sort orders accepted by the event listing endpoint. */
export const EVENT_SORT_OPTIONS = Object.freeze([
  'startsAt:asc',
  'startsAt:desc',
  'createdAt:desc',
  'title:asc',
])

/** Self-service registration. Only attendee/organizer roles may be requested. */
export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: nonEmptyStringSchema,
  phone: phoneSchema.optional(),
  locale: localeSchema.default('en-IN'),
  role: z.enum(['ATTENDEE', 'ORGANIZER']).default('ATTENDEE'),
})

/** Email/password sign-in. The password is only checked for presence here. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

/**
 * Fields an organiser may supply when creating or updating an event.
 *
 * Kept as a bare object so that {@link createEventRequestSchema} and
 * {@link updateEventRequestSchema} can derive required and partial variants
 * from one definition.
 */
const eventWritableFields = {
  organizationId: cuidSchema,
  venueId: cuidSchema.nullish(),
  title: nonEmptyStringSchema,
  slug: slugSchema.optional(),
  summary: nonEmptyStringSchema,
  description: richTextSchema,
  category: eventCategorySchema,
  status: eventStatusSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  timezone: timezoneSchema,
  coverImageUrl: urlSchema.nullish(),
  isOnline: z.boolean(),
  onlineUrl: urlSchema.nullish(),
  languages: z.array(nonEmptyStringSchema).max(12),
}

const eventWritableObject = z.object(eventWritableFields)

// Defaults live only on the create variant. `.partial()` still fills defaults
// in, so a partial built from a defaulted object would silently reset columns
// the caller never mentioned.
const createEventObject = eventWritableObject.extend({
  status: eventStatusSchema.default('DRAFT'),
  timezone: timezoneSchema.default('Asia/Kolkata'),
  isOnline: z.boolean().default(false),
  languages: z.array(nonEmptyStringSchema).max(12).default([]),
})

/**
 * Apply the event invariants that span more than one field.
 *
 * @param {object} value Candidate event payload.
 * @param {z.RefinementCtx} ctx Zod refinement context used to report issues.
 * @returns {void}
 */
function checkEventWindow(value, ctx) {
  const { startsAt, endsAt, isOnline, onlineUrl } = value

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must be strictly after startsAt',
    })
  }

  if (isOnline === true && !onlineUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['onlineUrl'],
      message: 'onlineUrl is required when isOnline is true',
    })
  }
}

/** Create an event. Rejects a window that ends at or before it starts. */
export const createEventRequestSchema = createEventObject.superRefine(checkEventWindow)

/**
 * Update an event. Every field is optional, but at least one must be present,
 * and a supplied window must still be valid.
 *
 * `status` is deliberately not updatable here. Editing an event needs the
 * `event:update` capability, but publishing one needs `event:publish`, and
 * publishing also has to check that the event has something to sell. Leaving
 * `status` writable on this route let a role with edit rights publish by
 * sending one extra field, skipping both checks. Status changes go through
 * `POST /v1/events/:id/publish`.
 */
export const updateEventRequestSchema = eventWritableObject
  .partial()
  .omit({ organizationId: true, status: true })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Provide at least one field to update' })
    }
    checkEventWindow(value, ctx)
  })

/** Change an event's publication status. */
export const publishEventRequestSchema = z.object({
  status: eventStatusSchema,
  publishedAt: timestampSchema.optional(),
})

/**
 * Query string for `GET /events`.
 *
 * Values arrive as strings from the URL, so `page`/`perPage` are coerced and
 * `startsAfter`/`startsBefore` accept a bare `YYYY-MM-DD` as well as a full
 * ISO timestamp.
 */
export const listEventsQuerySchema = paginationQuerySchema
  .extend({
    category: eventCategorySchema.optional(),
    status: eventStatusSchema.optional(),
    city: nonEmptyStringSchema.optional(),
    q: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim() : value),
        z.string().min(1).max(120),
      )
      .optional(),
    startsAfter: queryDateTimeSchema.optional(),
    startsBefore: queryDateTimeSchema.optional(),
    organizationId: cuidSchema.optional(),
    isOnline: z.stringbool().optional(),
    sort: z.enum([...EVENT_SORT_OPTIONS]).default('startsAt:asc'),
  })
  .superRefine((value, ctx) => {
    const { startsAfter, startsBefore } = value
    if (startsAfter && startsBefore && Date.parse(startsBefore) <= Date.parse(startsAfter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startsBefore'],
        message: 'startsBefore must be after startsAfter',
      })
    }
  })

const ticketTypeWritableFields = {
  eventId: cuidSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema.nullish(),
  priceCents: centsSchema,
  currency: currencySchema,
  quantityTotal: countSchema.min(1),
  minPerOrder: quantitySchema,
  maxPerOrder: quantitySchema,
  salesStartAt: timestampSchema.nullish(),
  salesEndAt: timestampSchema.nullish(),
  status: ticketTypeStatusSchema,
  sortOrder: z.int().min(0).max(10_000),
}

const ticketTypeWritableObject = z.object(ticketTypeWritableFields)

/**
 * Apply the ticket-type invariants that span more than one field.
 *
 * @param {object} value Candidate ticket type payload.
 * @param {z.RefinementCtx} ctx Zod refinement context used to report issues.
 * @returns {void}
 */
function checkTicketTypeBounds(value, ctx) {
  const { minPerOrder, maxPerOrder, quantityTotal, salesStartAt, salesEndAt } = value

  if (minPerOrder != null && maxPerOrder != null && maxPerOrder < minPerOrder) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxPerOrder'],
      message: 'maxPerOrder must be greater than or equal to minPerOrder',
    })
  }

  if (minPerOrder != null && quantityTotal != null && minPerOrder > quantityTotal) {
    ctx.addIssue({
      code: 'custom',
      path: ['minPerOrder'],
      message: 'minPerOrder cannot exceed quantityTotal',
    })
  }

  if (salesStartAt && salesEndAt && Date.parse(salesEndAt) <= Date.parse(salesStartAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['salesEndAt'],
      message: 'salesEndAt must be after salesStartAt',
    })
  }
}

/**
 * Create a ticket type. Rejects negative prices (via `centsSchema`) and a
 * `maxPerOrder` below `minPerOrder`.
 */
export const createTicketTypeRequestSchema = ticketTypeWritableObject
  .extend({
    currency: currencySchema.default('INR'),
    minPerOrder: quantitySchema.default(1),
    maxPerOrder: quantitySchema.default(10),
    status: ticketTypeStatusSchema.default('DRAFT'),
    sortOrder: z.int().min(0).max(10_000).default(0),
  })
  .superRefine(checkTicketTypeBounds)

/** Update a ticket type; `eventId` is immutable so it is omitted. */
export const updateTicketTypeRequestSchema = ticketTypeWritableObject
  .partial()
  .omit({ eventId: true })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Provide at least one field to update' })
    }
    checkTicketTypeBounds(value, ctx)
  })

/** Reserve inventory while a buyer completes checkout. */
export const createHoldRequestSchema = z.object({
  ticketTypeId: cuidSchema,
  quantity: quantitySchema,
  ttlSeconds: z.coerce.number().int().min(30).max(3600).optional(),
})

/** One line of a checkout request. */
export const orderItemRequestSchema = z.object({
  ticketTypeId: cuidSchema,
  quantity: quantitySchema,
})

/**
 * Place an order. Requires at least one line, and rejects the same ticket type
 * appearing twice — two lines for one ticket type would silently break the
 * per-order quantity limits.
 */
export const createOrderRequestSchema = z
  .object({
    eventId: cuidSchema,
    buyerEmail: emailSchema,
    buyerName: nonEmptyStringSchema,
    userId: cuidSchema.nullish(),
    items: z.array(orderItemRequestSchema).min(1, 'An order needs at least one item').max(20),
    promoCode: promoCodeStringSchema.optional(),
    holdIds: z.array(cuidSchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set()
    value.items.forEach((item, index) => {
      if (seen.has(item.ticketTypeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'ticketTypeId'],
          message: 'Each ticket type may appear only once; combine the quantities instead',
        })
      }
      seen.add(item.ticketTypeId)
    })
  })

/** Scan a ticket at the door. */
export const checkInRequestSchema = z.object({
  code: ticketCodeSchema,
  eventId: cuidSchema.optional(),
  checkedInAt: timestampSchema.optional(),
  deviceId: nonEmptyStringSchema.optional(),
  force: z.boolean().default(false),
})

/** Join the waitlist for a sold-out event. */
export const joinWaitlistRequestSchema = z.object({
  eventId: cuidSchema,
  email: emailSchema,
  quantity: quantitySchema.default(1),
  userId: cuidSchema.nullish(),
})

/** Create a promo code. `value` is basis points or cents, depending on `type`. */
export const createPromoCodeRequestSchema = z
  .object({
    organizationId: cuidSchema,
    eventId: cuidSchema.nullish(),
    code: promoCodeStringSchema,
    type: promoTypeSchema,
    value: z.int().min(1).max(1_000_000_000),
    maxRedemptions: countSchema.nullish(),
    startsAt: timestampSchema.nullish(),
    endsAt: timestampSchema.nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PERCENTAGE' && value.value > 10_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A PERCENTAGE promo code is basis points and cannot exceed 10000 (100%)',
      })
    }
    if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must be after startsAt',
      })
    }
  })

/** Query string for endpoints that only paginate. */
export const listQuerySchema = paginationQuerySchema

/** Path parameter shape for routes keyed by a CUID. */
export const idParamSchema = z.object({ id: cuidSchema })

/** Path parameter shape for routes keyed by a slug. */
export const slugParamSchema = z.object({ slug: slugSchema })

/**
 * A payment provider callback.
 *
 * The webhook is the authoritative signal that money moved. A browser redirect
 * is not: the buyer can close the tab, replay it, or forge it. `providerEventId`
 * is what makes replay a no-op — the same event id is only ever processed once.
 */
export const paymentWebhookRequestSchema = z.object({
  provider: z.string().min(1).max(64),
  providerEventId: z.string().min(1).max(200),
  eventType: z.enum(['payment.succeeded', 'payment.failed']),
  orderReference: orderReferenceSchema,
  providerRef: z.string().min(1).max(200).optional(),
  amountCents: centsSchema.optional(),
  currency: currencySchema.optional(),
  failureCode: z.string().min(1).max(100).optional(),
})

/**
 * Submit an event for review.
 *
 * No body fields: the request *is* the submission. Everything a moderator needs
 * is already on the event, and letting the submitter attach a status or a
 * decision is the mistake findings NF-17 and NF-18 were.
 */
export const submitEventReviewRequestSchema = z.object({
  /** An optional note to the moderator. Never shown to the public. */
  note: z.string().trim().max(2000).optional(),
})

/**
 * Publish an approved event.
 *
 * Deliberately empty. The old `publishEventRequestSchema` carried a `status`
 * field over the whole `EventStatus` enum, so one capability reached thirteen
 * destinations with no transition check — finding NF-18. The destination is now
 * the route, not a field somebody chooses.
 */
export const publishApprovedEventRequestSchema = z.object({})

/**
 * Open or resume sales.
 */
export const openSalesRequestSchema = z.object({})

/**
 * Pause sales.
 */
export const pauseSalesRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
})

/**
 * Cancel an event.
 *
 * A reason code *and* prose: the code is what the refund and notification work
 * is keyed on, the prose is what an attendee reads. Neither substitutes for the
 * other — "VENUE_UNAVAILABLE" is not an apology and an apology is not a
 * category.
 */
export const cancelEventRequestSchema = z.object({
  reasonCode: z.enum([
    'ORGANIZER_WITHDREW',
    'VENUE_UNAVAILABLE',
    'ARTIST_UNAVAILABLE',
    'LOW_SALES',
    'WEATHER',
    'SAFETY',
    'REGULATORY',
    'OTHER',
  ]),
  reason: z.string().trim().min(1).max(2000),
})

/**
 * Postpone an event, with or without a new date.
 *
 * A postponement with no new date is a real state: "we will tell you when we
 * know" is more honest than inventing a placeholder date somebody will plan
 * around.
 */
export const postponeEventRequestSchema = z.object({
  reasonCode: z.enum(['VENUE_UNAVAILABLE', 'ARTIST_UNAVAILABLE', 'WEATHER', 'SAFETY', 'OTHER']),
  reason: z.string().trim().min(1).max(2000),
  newStartsAt: timestampSchema.optional(),
  newEndsAt: timestampSchema.optional(),
})

/**
 * A moderator's decision on a submitted event.
 *
 * One route rather than three, because the three outcomes share every
 * precondition and differ only in what they write. A reason is required for
 * anything other than an approval: telling somebody no without saying why is
 * the part of moderation that wastes everybody's time.
 */
export const moderationDecisionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'request_changes', 'reject']),
    reason: z.string().trim().max(2000).optional(),
    /** Field-level notes, for the organiser's editor to link to. */
    requestedChanges: z.record(z.string(), z.string().max(1000)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== 'approve' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Say why. A refusal with no reason cannot be acted on.',
      })
    }
  })

/** Query string for the moderation queue. */
export const moderationQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['REVIEW_PENDING', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED']).optional(),
})

/**
 * The optimistic-concurrency precondition every authoring write carries.
 *
 * A client sends the revision it read. The write applies only if that is still
 * current, and a mismatch is reported rather than resolved by whoever saved
 * last. Two tabs open on one event is the ordinary case, not the exotic one.
 */
const revisionPrecondition = { revision: z.number().int().min(0) }

/** Create a session on an event. */
export const createSessionRequestSchema = z.object({
  ...revisionPrecondition,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  doorsOpenAt: timestampSchema.nullish(),
  timezone: timezoneSchema,
  salesStartAt: timestampSchema.nullish(),
  salesEndAt: timestampSchema.nullish(),
  /** Null for general admission; a published map version for reserved seating. */
  venueMapVersionId: cuidSchema.nullish(),
  /** General-admission capacity. Null when the session is reserved. */
  capacity: z.number().int().min(1).max(1_000_000).nullish(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

/** Update a session. Every field optional, but the revision is not. */
export const updateSessionRequestSchema = z.object({
  ...revisionPrecondition,
  startsAt: timestampSchema.optional(),
  endsAt: timestampSchema.optional(),
  doorsOpenAt: timestampSchema.nullish(),
  timezone: timezoneSchema.optional(),
  salesStartAt: timestampSchema.nullish(),
  salesEndAt: timestampSchema.nullish(),
  venueMapVersionId: cuidSchema.nullish(),
  capacity: z.number().int().min(1).max(1_000_000).nullish(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

/** Remove a session. The revision guards it like any other authoring write. */
export const deleteSessionRequestSchema = z.object({ ...revisionPrecondition })

/** Create a ticket type. */
export const authorTicketTypeRequestSchema = z.object({
  ...revisionPrecondition,
  name: nonEmptyStringSchema,
  description: z.string().trim().max(2000).nullish(),
  priceCents: centsSchema,
  currency: currencySchema.optional(),
  quantityTotal: z.number().int().min(0).max(1_000_000).optional(),
  minPerOrder: z.number().int().min(1).max(100).optional(),
  maxPerOrder: z.number().int().min(1).max(100).optional(),
  salesStartAt: timestampSchema.nullish(),
  salesEndAt: timestampSchema.nullish(),
  eventSessionId: cuidSchema.nullish(),
  priceZoneId: cuidSchema.nullish(),
  reserved: z.boolean().optional(),
  complimentary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

/** Update a ticket type. */
export const updateAuthorTicketTypeRequestSchema = authorTicketTypeRequestSchema.partial().extend({
  ...revisionPrecondition,
})

/** Remove a ticket type. */
export const deleteTicketTypeRequestSchema = z.object({ ...revisionPrecondition })

/**
 * Prepare a session's seat inventory.
 *
 * No fields beyond the session. The command is idempotent, so there is nothing
 * to configure and nothing a caller could get wrong by repeating it.
 */
export const prepareInventoryRequestSchema = z.object({
  eventSessionId: cuidSchema,
})

/**
 * Confirm a material change to a published event.
 *
 * `confirm` must be explicitly true. A default of true would make the
 * confirmation a formality, which is the opposite of what it is for.
 */
export const materialChangeRequestSchema = z.object({
  ...revisionPrecondition,
  confirm: z.literal(true),
  reason: z.string().trim().min(1).max(2000),
  changes: z.record(z.string(), z.unknown()),
})

/** Path parameters for a route addressing one session of one event. */
export const eventSessionParamSchema = z.object({ id: cuidSchema, sessionId: cuidSchema })

/** Path parameters for a route addressing one ticket type of one event. */
export const eventTierParamSchema = z.object({ id: cuidSchema, tierId: cuidSchema })
