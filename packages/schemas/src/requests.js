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
  notificationStatusSchema,
  promoTypeSchema,
  refundReasonSchema,
  refundStatusSchema,
  ticketTypeStatusSchema,
} from './enums.js'
import { eventPoliciesSchema } from './entities.js'
import { venueAccessibilitySchema } from './venues.js'

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
  /** Named performers, in billing order. Free text: this is a listing, not a licensed artist database. */
  artists: z.array(nonEmptyStringSchema).max(64),
  /** Minimum age at the door. Null clears the restriction. */
  ageRestriction: z.int().min(0).max(120).nullish(),
  /**
   * Accessibility claims and policies are JSON columns, and both are
   * `.optional()` rather than `.nullish()` on purpose: Prisma will not take a
   * bare `null` for a nullable JSON column, so accepting one here would turn an
   * organiser clearing a field into a 500. An empty object clears them.
   */
  accessibility: venueAccessibilitySchema.optional(),
  policies: eventPoliciesSchema.optional(),
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
  artists: z.array(nonEmptyStringSchema).max(64).default([]),
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
  .extend({
    /**
     * The revision the caller read.
     *
     * Optional on the wire and mandatory in practice for an editor: without it
     * the last writer silently wins, which for a form that autosaves means one
     * organiser's afternoon quietly overwriting another's. Omitting it is for a
     * script making a single deliberate change.
     */
    revision: z.int().min(0).optional(),
    /**
     * "I know this changes what somebody bought."
     *
     * Required before a live event's date, venue, time zone, age limit, online
     * status or policies may move. Not a default and not inferred from the
     * fields: the point is that a person said it. The refusal names every field
     * that made the change material, so the confirmation asked for is specific.
     */
    confirmMaterialChange: z.boolean().optional(),
    /** Why. Sent to everybody holding a ticket, so it is prose, not a code. */
    changeReason: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    // The three control fields are not content: a body carrying only a
    // revision is not an update, it is a no-op with a precondition.
    const { revision: _r, confirmMaterialChange: _c, changeReason: _n, ...fields } = value

    if (Object.keys(fields).length === 0) {
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
export const checkInRequestSchema = z
  .object({
    /**
     * The pass from a QR code.
     *
     * Base64url, and bounded: a scanner sends what it read, and an unbounded
     * string from a device at a door is a hashing job somebody else chose the
     * size of.
     */
    credential: z
      .string()
      .trim()
      .min(16)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
    /** The printed reference, for when a pass will not scan. */
    code: ticketCodeSchema.optional(),
    eventId: cuidSchema.optional(),
    eventSessionId: cuidSchema.optional(),
    checkedInAt: timestampSchema.optional(),
    deviceId: nonEmptyStringSchema.optional(),
    gate: z.string().trim().min(1).max(60).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.credential && !value.code) {
      ctx.addIssue({
        code: 'custom',
        path: ['credential'],
        message: 'Send the scanned pass, or the printed code.',
      })
    }
  })

/**
 * Offering a ticket to somebody.
 *
 * An address and nothing else. Not a user id: the recipient may not have an
 * account yet, and letting a sender name an account would let them hand a
 * ticket to somebody who never asked for it.
 */
export const startTicketTransferRequestSchema = z.object({
  toEmail: emailSchema,
  message: z.string().trim().max(500).optional(),
})

/**
 * Accepting or declining one.
 *
 * The token is the invitation. It is a bearer secret, so it is bounded and
 * shaped, and the server compares its digest rather than the token itself.
 */
export const respondToTicketTransferRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .min(16)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/u),
})

/** Withdrawing a ticket. */
export const revokeTicketRequestSchema = z.object({
  reason: z.string().trim().min(4).max(500),
})

/** The tickets belonging to the signed-in person. */
export const myTicketsQuerySchema = paginationQuerySchema.extend({
  eventId: cuidSchema.optional(),
  status: z
    .enum([
      'VALID',
      'TRANSFER_PENDING',
      'TRANSFERRED',
      'REVOKED',
      'REFUNDED',
      'CHECKED_IN',
      'CANCELLED',
      'SUPERSEDED',
      'VOID',
    ])
    .optional(),
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
 * precondition and differ only in what they write.
 *
 * A refusal has to be actionable. That was originally spelled "a reason is
 * required", which is not quite the same thing: a set of notes against named
 * fields — "description: name the language" — is *more* actionable than a
 * paragraph, and demanding prose as well meant a moderator who had written the
 * useful version was refused for not also writing the vague one.
 *
 * So the rule is what it was always for: say something the organiser can act
 * on. Prose, or field notes, or both. A rejection needs prose, because there is
 * no field to attach a note to when the answer is no.
 */
export const moderationDecisionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'request_changes', 'reject']),
    reason: z.string().trim().max(2000).optional(),
    /** Field-level notes, for the organiser's editor to link to. */
    requestedChanges: z.record(z.string(), z.string().max(1000)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'approve') return

    const notes = Object.keys(value.requestedChanges ?? {}).length

    if (value.decision === 'reject' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Say why. A rejection with no reason cannot be acted on.',
      })
      return
    }

    if (!value.reason && notes === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          'Say what needs changing, either as a reason or as a note against a field. A refusal with neither cannot be acted on.',
      })
    }
  })

/**
 * Query string for the notification operations queue.
 *
 * `status` and `template` narrow it; `organizationId` is *not* a filter an
 * operator supplies, because whose messages an operator may see is decided by
 * their capability rather than by what they ask for.
 */
export const notificationQueueQuerySchema = paginationQuerySchema.extend({
  status: notificationStatusSchema.optional(),
  template: z.string().trim().min(1).max(64).optional(),
  failureCategory: z.enum(['PERMANENT', 'TRANSIENT']).optional(),
})

/**
 * Putting a failed message back in the queue, or withdrawing it.
 *
 * A reason is required for both. An operator who requeues a dead letter has
 * decided that whatever caused it is fixed, and an operator who cancels one has
 * decided it should never be sent; in six months neither decision is
 * reconstructable from the row alone.
 */
export const notificationActionRequestSchema = z.object({
  reason: z.string().trim().min(4).max(500),
})

/**
 * Asking for a refund.
 *
 * Two forms, exactly one of them at a time: an amount, or the lines to give
 * back. No price appears anywhere. A request that could name what a ticket cost
 * would be a request that could refund more than was paid, and the order's own
 * unit prices are the only prices this application will use.
 *
 * `idempotencyKey` is required rather than optional. A refund is the one request
 * where a retry that is not recognised as a retry costs somebody money twice,
 * and making the client supply the key is what lets the server recognise it.
 */
export const requestRefundRequestSchema = z
  .object({
    amountCents: centsSchema.optional(),
    lines: z
      .array(z.object({ orderItemId: cuidSchema, quantity: quantitySchema }))
      .min(1)
      .max(50)
      .optional(),
    reason: refundReasonSchema,
    reasonNote: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
    /** `RESELL` or `WITHHOLD`, when an organiser overrides the default. */
    seatPolicy: z.enum(['RESELL', 'WITHHOLD']).optional(),
  })
  .superRefine((value, ctx) => {
    const hasAmount = value.amountCents !== undefined
    const hasLines = value.lines !== undefined

    if (hasAmount === hasLines) {
      ctx.addIssue({
        code: 'custom',
        path: hasAmount ? ['lines'] : ['amountCents'],
        message: 'Send either an amount or the lines to refund, not both and not neither.',
      })
    }

    if (hasAmount && value.amountCents <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountCents'],
        message: 'A refund has to be for more than nothing.',
      })
    }
  })

/**
 * Approving, submitting or withdrawing a refund.
 *
 * A reason on every one, for the same reason the notification actions carry
 * one: in six months the row says what happened and nothing says why.
 */
export const refundActionRequestSchema = z.object({
  reason: z.string().trim().min(4).max(500),
  /** Overrides the distance-based default when the refund settles. */
  seatPolicy: z.enum(['RESELL', 'WITHHOLD']).optional(),
})

/**
 * The finance refund queue.
 *
 * `organizationId` is required and is not a convenience. It is where the
 * capability guard reads the organisation from, so a request without one is a
 * request that could not be scoped — see `capabilityScope` in the contract.
 */
export const refundQueueQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidSchema,
  status: refundStatusSchema.optional(),
  orderReference: orderReferenceSchema.optional(),
})

/**
 * The reconciliation queue.
 *
 * `organizationId` is optional and it decides who may ask: with one, the caller
 * needs `finance:view` in that organisation and sees only its work; without
 * one, the caller needs the platform capability and sees everything. That is
 * the scoping rule, expressed as a query rather than as two endpoints.
 */
export const reconciliationQueueQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidSchema.optional(),
  state: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED']).optional(),
  kind: z
    .enum([
      'PAYMENT_TIMEOUT',
      'PROVIDER_MISMATCH',
      'REFUND_UNKNOWN',
      'WEBHOOK_DEAD_LETTER',
      'TRANSFER_STUCK',
    ])
    .optional(),
  /** Matches a payment, order or refund id, or a provider reference. */
  reference: z.string().trim().min(3).max(200).optional(),
  /** `AGING` and `OVERDUE` narrow the queue to what is late. */
  aging: z.enum(['AGING', 'OVERDUE']).optional(),
})

/**
 * Closing a reconciliation task.
 *
 * There is no status here, and there is no amount. An operator says how the
 * item was settled and why; what changes in the payment, the order or the
 * refund follows from what the provider said, applied through the domain
 * command that owns it.
 */
export const resolveReconciliationRequestSchema = z.object({
  resolution: z.enum([
    'SETTLED_FROM_PROVIDER',
    'RELEASED_FROM_PROVIDER',
    'ALREADY_CONSISTENT',
    'NO_ACTION_REQUIRED',
  ]),
  note: z.string().trim().min(10).max(1000),
})

/** Escalating a task, or adding a note to one. */
export const reconciliationNoteRequestSchema = z.object({
  note: z.string().trim().min(4).max(1000),
})

/**
 * Scheduling a payout.
 *
 * No destination and no bank details. Where an organiser's money goes is a
 * property of their connected account, changed through the onboarding flow with
 * its own step-up — not a field on the request that asks for money to be sent.
 * A request that could name a destination would be a request that could send
 * somebody else's money somewhere new.
 */
export const schedulePayoutRequestSchema = z.object({
  organizationId: cuidSchema,
  amountCents: centsSchema,
  currency: currencySchema.default('INR'),
  idempotencyKey: z.string().trim().min(8).max(200),
})

/** Sending a scheduled payout, releasing a held one, or cancelling either. */
export const payoutActionRequestSchema = z.object({
  reason: z.string().trim().min(4).max(500),
})

/** Clawing back money that already went. */
export const reversePayoutRequestSchema = z.object({
  amountCents: centsSchema,
  reason: z.string().trim().min(4).max(500),
})

/** The payout list for one organisation. */
export const payoutQueryQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidSchema,
  status: z
    .enum([
      'SCHEDULED',
      'PENDING',
      'IN_TRANSIT',
      'SUBMITTED',
      'PAID',
      'FAILED',
      'REVERSED',
      'HELD',
      'RECONCILIATION_REQUIRED',
      'CANCELLED',
    ])
    .optional(),
})

/** The transfer list for one organisation. */
export const transferQueryQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidSchema,
  status: z
    .enum([
      'PENDING',
      'SUBMITTED',
      'SENT',
      'PAID',
      'FAILED',
      'REVERSED',
      'PARTIALLY_REVERSED',
      'RECONCILIATION_REQUIRED',
    ])
    .optional(),
})

/**
 * The dispute list for one organisation.
 *
 * Its own status enum rather than the payout one. Sharing a query schema across
 * three lists whose statuses differ would mean a caller filtering disputes by
 * `OPENED` got a validation error naming payout states, which is a puzzle
 * rather than a message.
 */
export const disputeQueryQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidSchema,
  status: z
    .enum([
      'OPENED',
      'NEEDS_RESPONSE',
      'UNDER_REVIEW',
      'CHARGE_REFUNDED',
      'WON',
      'LOST',
      'CLOSED',
      'WARNING_NEEDS_RESPONSE',
      'WARNING_CLOSED',
    ])
    .optional(),
})

/**
 * The finance summary, and the export of it.
 *
 * `organizationId` is optional and decides the scope: with one, the caller
 * needs `finance:view` in that organisation; without one it is the platform
 * view and needs a platform capability. `from` and `to` bound the window, and
 * `to` is exclusive so two adjacent months do not both count the boundary.
 */
export const financeSummaryQuerySchema = z.object({
  organizationId: cuidSchema.optional(),
  currency: currencySchema.default('INR'),
  from: queryDateTimeSchema.optional(),
  to: queryDateTimeSchema.optional(),
})

/**
 * Organiser analytics, and the export of it.
 *
 * `organizationId` is **required**, unlike the finance summary's. There is no
 * platform-wide analytics view and there should not be one: these figures mix
 * money with inventory and attendance, and the only reading of "everybody's
 * tickets sold" that means anything is a per-organisation list. Making the
 * field required is also what keeps the capability check scoped — an optional
 * organisation is how an organisation capability silently becomes a platform
 * one.
 *
 * `eventId` and `eventSessionId` narrow; neither widens, and neither carries the
 * organisation. An event belonging to somebody else simply matches nothing.
 */
export const analyticsQuerySchema = z.object({
  organizationId: cuidSchema,
  currency: currencySchema.default('INR'),
  eventId: cuidSchema.optional(),
  eventSessionId: cuidSchema.optional(),
  from: queryDateTimeSchema.optional(),
  to: queryDateTimeSchema.optional(),
})

/** Reading a balance. */
export const balanceQuerySchema = z.object({
  organizationId: cuidSchema,
  currency: currencySchema.default('INR'),
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
  /**
   * Whether this tier is selling.
   *
   * Three of the five `TicketTypeStatus` values, and the two that are missing
   * are missing on purpose. `SOLD_OUT` is derived from inventory — a tier that
   * says it is sold out while stock remains is a lie a caller should not be
   * able to tell — and `CLOSED` is reached by the sales window ending, not by
   * asking.
   *
   * A tier had no way to leave `DRAFT` at all until this existed, which meant
   * `openSales` could never pass its gate: it counts `ON_SALE` tiers, and the
   * authoring API could only ever create drafts. An organiser could build a
   * complete event and had no way to sell a ticket to it.
   */
  status: z.enum(['DRAFT', 'ON_SALE', 'PAUSED']).optional(),
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
