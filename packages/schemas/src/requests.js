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
  latitudeSchema,
  localeSchema,
  longitudeSchema,
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

/** Create a venue. */
export const createVenueRequestSchema = z.object({
  name: nonEmptyStringSchema,
  addressLine1: nonEmptyStringSchema,
  addressLine2: nonEmptyStringSchema.optional(),
  city: nonEmptyStringSchema,
  region: nonEmptyStringSchema,
  postalCode: z.string().min(1).max(16),
  country: z.string().length(2).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  capacity: countSchema.optional(),
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
