/**
 * Entity schemas mirroring the Prisma models.
 *
 * Every timestamp uses {@link timestampSchema}, so a row read straight out of
 * Prisma (with real `Date` objects) and the same row after a JSON round trip
 * both parse, and both come out as UTC ISO-8601 strings. That is what makes it
 * safe for the API to `parse` a database row and send the result as a
 * response body.
 *
 * `createdAt`/`updatedAt` are optional: they always exist on a database row,
 * but trimmed payloads legitimately drop them, and rejecting those would be
 * noise rather than safety.
 *
 * @module @desi-event/schemas/entities
 */

import { z } from 'zod'

import {
  centsSchema,
  countSchema,
  countrySchema,
  cuidSchema,
  currencySchema,
  emailSchema,
  latitudeSchema,
  localeSchema,
  longitudeSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  phoneSchema,
  promoCodeStringSchema,
  quantitySchema,
  richTextSchema,
  slugSchema,
  ticketCodeSchema,
  timestampSchema,
  timezoneSchema,
  urlSchema,
} from './primitives.js'
import { venueAccessibilitySchema } from './venues.js'
import {
  eventCategorySchema,
  eventStatusSchema,
  holdStatusSchema,
  orderStatusSchema,
  orgRoleSchema,
  paymentStatusSchema,
  promoTypeSchema,
  notificationChannelSchema,
  notificationStatusSchema,
  refundReasonSchema,
  refundStatusSchema,
  ticketStatusSchema,
  ticketTypeStatusSchema,
  userRoleSchema,
} from './enums.js'

/** Audit columns shared by most models. */
const auditColumns = {
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}

/** A `User` row, including the bcrypt hash. Never send this to a client. */
export const userSchema = z.object({
  id: cuidSchema,
  email: emailSchema,
  passwordHash: z.string().min(1).max(255),
  displayName: nonEmptyStringSchema,
  phone: phoneSchema.nullish(),
  locale: localeSchema.default('en-IN'),
  role: userRoleSchema.default('ATTENDEE'),
  emailVerified: z.boolean().default(false),
  ...auditColumns,
})

/** The client-safe projection of a user: {@link userSchema} minus the hash. */
export const publicUserSchema = userSchema.omit({ passwordHash: true, updatedAt: true })

/** A `Membership` row linking a user to an organisation. */
export const membershipSchema = z.object({
  id: cuidSchema,
  userId: cuidSchema,
  organizationId: cuidSchema,
  role: orgRoleSchema.default('VIEWER'),
  createdAt: timestampSchema.optional(),
})

/** An `Organization` row. */
export const organizationSchema = z.object({
  id: cuidSchema,
  name: nonEmptyStringSchema,
  slug: slugSchema,
  description: richTextSchema.nullish(),
  contactEmail: emailSchema,
  websiteUrl: urlSchema.nullish(),
  verified: z.boolean().default(false),
  payoutCurrency: currencySchema.default('INR'),
  ...auditColumns,
})

/**
 * An organisation as an anonymous caller may see it.
 *
 * Finding NF-14: the event detail endpoint returned the whole `Organization`
 * row, so `contactEmail` — the account contact, not a published box office
 * address — and `payoutCurrency` were served to anybody who loaded a public
 * event page. This is the allow-list that replaced it, and it is a separate
 * schema rather than an `.omit()` so that a field added to the row is absent
 * from the public payload until somebody decides otherwise.
 *
 * `verified` stays, because it is the badge, but the presenter derives it from
 * the verification state rather than copying the denormalised column.
 */
export const publicOrganizerSummarySchema = z.object({
  id: cuidSchema,
  name: nonEmptyStringSchema,
  slug: slugSchema,
  description: richTextSchema.nullish(),
  websiteUrl: urlSchema.nullish(),
  verified: z.boolean().default(false),
})

/** A `Venue` row. */
export const venueSchema = z.object({
  id: cuidSchema,
  /** The venue's public page, so an event can link to it without a second read. */
  slug: slugSchema.nullish(),
  name: nonEmptyStringSchema,
  addressLine1: nonEmptyStringSchema,
  addressLine2: nonEmptyStringSchema.nullish(),
  city: nonEmptyStringSchema,
  region: nonEmptyStringSchema,
  postalCode: z.string().min(1).max(16),
  country: countrySchema.default('IN'),
  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),
  capacity: countSchema.nullish(),
  /**
   * The venue's accessibility claims.
   *
   * Public, and public here as well as on the venue's own page: somebody
   * deciding whether they can get into a show is reading the event page, and
   * sending them to a second page to find out whether there is a step-free
   * entrance is how that fact stops being read. The event's own claims are
   * layered over these.
   */
  accessibility: venueAccessibilitySchema.nullish(),
  ...auditColumns,
})

/** An `Event` row. */
export const eventSchema = z.object({
  id: cuidSchema,
  organizationId: cuidSchema,
  venueId: cuidSchema.nullish(),
  title: nonEmptyStringSchema,
  slug: slugSchema,
  summary: nonEmptyStringSchema,
  description: richTextSchema,
  category: eventCategorySchema,
  status: eventStatusSchema.default('DRAFT'),
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  timezone: timezoneSchema.default('Asia/Kolkata'),
  coverImageUrl: urlSchema.nullish(),
  isOnline: z.boolean().default(false),
  onlineUrl: urlSchema.nullish(),
  languages: z.array(nonEmptyStringSchema).max(12).default([]),
  publishedAt: timestampSchema.nullish(),
  ...auditColumns,
})

/**
 * The lean event shape used in listings and cards. It carries denormalised
 * fields (venue city, cheapest ticket price) that the list endpoint computes,
 * so a card can render without a second request.
 */
export const eventSummarySchema = z.object({
  id: cuidSchema,
  organizationId: cuidSchema,
  title: nonEmptyStringSchema,
  slug: slugSchema,
  summary: nonEmptyStringSchema,
  category: eventCategorySchema,
  status: eventStatusSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  timezone: timezoneSchema.default('Asia/Kolkata'),
  coverImageUrl: urlSchema.nullish(),
  isOnline: z.boolean().default(false),
  city: nonEmptyStringSchema.nullish(),
  venueName: nonEmptyStringSchema.nullish(),
  organizationName: nonEmptyStringSchema.nullish(),
  /**
   * The organiser's slug, so a card can link to their page without a second
   * request. Nullish because a summary built from a row with no organisation
   * joined has no honest answer, and guessing one would produce a dead link.
   */
  organizationSlug: slugSchema.nullish(),
  /** The venue's slug, for the same reason and with the same caveat. */
  venueSlug: slugSchema.nullish(),
  minPriceCents: centsSchema.nullish(),
  currency: currencySchema.nullish(),
  soldOut: z.boolean().optional(),
})

/** A `TicketType` row. */
export const ticketTypeSchema = z.object({
  id: cuidSchema,
  eventId: cuidSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema.nullish(),
  priceCents: centsSchema,
  currency: currencySchema.default('INR'),
  quantityTotal: countSchema,
  quantitySold: countSchema.default(0),
  minPerOrder: quantitySchema.default(1),
  maxPerOrder: quantitySchema.default(10),
  salesStartAt: timestampSchema.nullish(),
  salesEndAt: timestampSchema.nullish(),
  status: ticketTypeStatusSchema.default('DRAFT'),
  sortOrder: z.int().min(0).max(10_000).default(0),
  ...auditColumns,
})

/** A `TicketHold` row: a short-lived reservation taken during checkout. */
export const ticketHoldSchema = z.object({
  id: cuidSchema,
  ticketTypeId: cuidSchema,
  orderId: cuidSchema.nullish(),
  quantity: quantitySchema,
  status: holdStatusSchema.default('ACTIVE'),
  expiresAt: timestampSchema,
  ...auditColumns,
})

/** An `OrderItem` row. `subtotalCents` is `quantity * unitPriceCents`. */
export const orderItemSchema = z.object({
  id: cuidSchema,
  orderId: cuidSchema,
  ticketTypeId: cuidSchema,
  quantity: quantitySchema,
  unitPriceCents: centsSchema,
  subtotalCents: centsSchema,
})

/** An `Order` row. Every money column is integer cents of `currency`. */
export const orderSchema = z.object({
  id: cuidSchema,
  reference: orderReferenceSchema,
  eventId: cuidSchema,
  userId: cuidSchema.nullish(),
  buyerEmail: emailSchema,
  buyerName: nonEmptyStringSchema,
  status: orderStatusSchema.default('PENDING'),
  currency: currencySchema.default('INR'),
  subtotalCents: centsSchema,
  discountCents: centsSchema.default(0),
  feesCents: centsSchema.default(0),
  taxCents: centsSchema.default(0),
  totalCents: centsSchema,
  promoCodeId: cuidSchema.nullish(),
  expiresAt: timestampSchema.nullish(),
  paidAt: timestampSchema.nullish(),
  cancelledAt: timestampSchema.nullish(),
  ...auditColumns,
})

/** A `Ticket` row: one admission, one QR code. */
export const ticketSchema = z.object({
  id: cuidSchema,
  orderItemId: cuidSchema,
  code: ticketCodeSchema,
  attendeeName: nonEmptyStringSchema.nullish(),
  status: ticketStatusSchema.default('VALID'),
  checkedInAt: timestampSchema.nullish(),
  ...auditColumns,
})

/** A `Payment` row. */
export const paymentSchema = z.object({
  id: cuidSchema,
  orderId: cuidSchema,
  provider: nonEmptyStringSchema,
  providerRef: z.string().min(1).max(255).nullish(),
  status: paymentStatusSchema.default('INITIATED'),
  amountCents: centsSchema,
  currency: currencySchema.default('INR'),
  failureCode: z.string().min(1).max(64).nullish(),
  ...auditColumns,
})

/**
 * A `PromoCode` row.
 *
 * `value` is basis points when `type` is `PERCENTAGE` (1000 = 10%) and integer
 * cents when it is `FIXED_AMOUNT`; the bound is checked per type below.
 */
export const promoCodeSchema = z
  .object({
    id: cuidSchema,
    organizationId: cuidSchema,
    eventId: cuidSchema.nullish(),
    code: promoCodeStringSchema,
    type: promoTypeSchema,
    value: z.int().min(0).max(1_000_000_000),
    maxRedemptions: countSchema.nullish(),
    redemptionCount: countSchema.default(0),
    startsAt: timestampSchema.nullish(),
    endsAt: timestampSchema.nullish(),
    active: z.boolean().default(true),
    ...auditColumns,
  })
  .refine((promo) => promo.type !== 'PERCENTAGE' || promo.value <= 10_000, {
    message: 'A PERCENTAGE promo code value is basis points and cannot exceed 10000 (100%)',
    path: ['value'],
  })

/** A `WaitlistEntry` row. */
export const waitlistEntrySchema = z.object({
  id: cuidSchema,
  eventId: cuidSchema,
  userId: cuidSchema.nullish(),
  email: emailSchema,
  quantity: quantitySchema.default(1),
  notified: z.boolean().default(false),
  createdAt: timestampSchema.optional(),
})

/** An `AuditLog` row. */
export const auditLogSchema = z.object({
  id: cuidSchema,
  actorId: cuidSchema.nullish(),
  action: nonEmptyStringSchema,
  entityType: nonEmptyStringSchema,
  entityId: nonEmptyStringSchema,
  metadata: z.record(z.string(), z.unknown()).nullish(),
  createdAt: timestampSchema.optional(),
})

/**
 * An event's entry, refund and conduct rules.
 *
 * Named sections rather than one blob because the refund rule is the one a
 * buyer has to be able to find, and a page that renders a single paragraph of
 * everything buries it. The column is JSON so that the vocabulary can grow
 * without a migration; this schema is what stops it growing by accident.
 *
 * The same object is snapshotted onto an order at purchase, so a later edit
 * cannot change what somebody agreed to.
 */
export const eventPoliciesSchema = z.object({
  entry: z.string().max(4000).nullish(),
  refund: z.string().max(4000).nullish(),
  conduct: z.string().max(4000).nullish(),
  ageNote: z.string().max(1000).nullish(),
})

/**
 * An event with the relations the detail page needs, all in one payload.
 *
 * This is an allow list, and it is the *only* allow list protecting the public
 * event payload: the serialiser parses every response through it and drops
 * whatever is not named here. `Event` carries `contactEmail`, `moderationNote`,
 * `reviewSubmittedAt` and `cancellationReason`, and none of them appears below
 * — an organiser's address and a moderator's private note are not part of a
 * listing. Adding a column to the Prisma model must not add it here; somebody
 * has to decide it is public and write the line.
 *
 * The fields beyond `eventSchema` are the ones the public page is required to
 * show: who is playing, who may come in, what the rules are, and — after a
 * postponement — what the date used to be.
 */
export const eventWithRelationsSchema = eventSchema.extend({
  venue: venueSchema.nullish(),
  organization: publicOrganizerSummarySchema.nullish(),
  ticketTypes: z.array(ticketTypeSchema).default([]),
  /** Minimum age at the door. Null means there is no restriction. */
  ageRestriction: z.int().min(0).max(120).nullish(),
  /** Event-level accessibility claims, layered over the venue's. */
  accessibility: venueAccessibilitySchema.nullish(),
  /** Named performers, in billing order. */
  artists: z.array(nonEmptyStringSchema).max(64).default([]),
  policies: eventPoliciesSchema.nullish(),
  /**
   * The start time before a postponement.
   *
   * Public on purpose: it is what turns "this moved" into "this moved from the
   * date in your calendar", and `schema.org` has a field for exactly that.
   */
  previousStartsAt: timestampSchema.nullish(),
  /**
   * Optimistic-concurrency counter, echoed so the organiser's editor can send
   * it back as a precondition. Not sensitive — it counts edits, and an edit
   * count says nothing a visitor could not infer from the page changing.
   */
  revision: z.int().min(0).default(0),
})

/** An order with its line items and, once paid, its issued tickets. */
export const orderWithItemsSchema = orderSchema.extend({
  items: z.array(orderItemSchema).default([]),
  tickets: z.array(ticketSchema).optional(),
  event: eventSummarySchema.nullish(),
})

/**
 * One outbox row, as an operator sees it.
 *
 * Not as it is stored. The recipient is reduced to a masked form and the
 * payload is dropped entirely: an operations queue is read by people who need
 * to know whether a message went, not who it was to or what it said. Everything
 * here is a status, a count or an instant.
 */
export const notificationSummarySchema = z.object({
  id: cuidSchema,
  template: z.string(),
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  /** `p****a@example.com`. Enough to recognise, not enough to contact. */
  recipientMasked: z.string(),
  businessEvent: z.string().nullable(),
  templateVersion: z.number().int(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  scheduledFor: timestampSchema,
  sentAt: timestampSchema.nullable(),
  lastAttemptAt: timestampSchema.nullable(),
  failureCategory: z.enum(['PERMANENT', 'TRANSIENT']).nullable(),
  /** Already redacted when it was written. Repeated here for the same reason. */
  lastError: z.string().nullable(),
  leaseExpiresAt: timestampSchema.nullable(),
  suppressible: z.boolean(),
  createdAt: timestampSchema,
})

/**
 * One line of a refund: which order line, how many tickets, how much.
 *
 * @type {object}
 */
export const refundLineSchema = z.object({
  orderItemId: cuidSchema,
  quantity: countSchema,
  amountCents: centsSchema,
})

/**
 * A refund, as finance sees it.
 *
 * `providerRefundId` is whatever the provider returned and nothing else. It is
 * nullable because a refund that has not been submitted does not have one, and
 * a refund that timed out may never get one; the field is never filled in to
 * make a row look finished.
 *
 * What is deliberately absent: the buyer's name, their email, and anything
 * about how they paid. A refund screen is a money screen, and none of those is
 * needed to decide whether money should go back.
 *
 * @type {object}
 */
export const refundSchema = z.object({
  id: cuidSchema,
  orderId: cuidSchema,
  orderReference: orderReferenceSchema.nullish(),
  paymentId: cuidSchema,
  provider: z.string(),
  providerRefundId: z.string().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
  reason: refundReasonSchema,
  reasonNote: z.string().nullable(),
  status: refundStatusSchema,
  /** How the amount divides across face value, fee and tax. */
  allocation: z
    .object({
      faceValueCents: z.number().int(),
      feeCents: z.number().int(),
      taxCents: z.number().int(),
    })
    .nullable(),
  items: z.array(refundLineSchema),
  requestedById: cuidSchema.nullable(),
  approvedById: cuidSchema.nullable(),
  ticketsRevoked: z.boolean(),
  inventoryReturned: z.boolean(),
  failureCode: z.string().nullable(),
  attempts: z.number().int(),
  submittedAt: timestampSchema.nullable(),
  settledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
})

/**
 * The keys a piece of reconciliation evidence may carry.
 *
 * Every writer in this repository stores a small summary already — a status, an
 * amount, a currency, an instant. This list is what makes that a *guarantee*
 * rather than a habit: a payload is projected onto these keys before it is
 * shown, so a writer who one day stores the provider's raw object ships
 * nothing, instead of shipping a card's last four digits and a billing email
 * onto a screen read on a shared desk.
 *
 * Adding a key here is a deliberate act with a reviewer. Removing one loses
 * evidence an operator was using. Neither should be quiet.
 *
 * @type {ReadonlyArray<string>}
 */
export const RECONCILIATION_EVIDENCE_KEYS = Object.freeze([
  'amount',
  'amountCents',
  'at',
  'currency',
  'error',
  'found',
  'orderStatus',
  'payoutStatus',
  'paymentStatus',
  'refundStatus',
  'refundedAmountCents',
  'status',
  'totalCents',
])

/**
 * One side of the evidence behind a reconciliation item.
 *
 * Values are primitives or null, never objects or arrays. That is the second
 * half of the control: an allow list of keys still lets a raw payload through
 * if one of the allowed keys holds a nested object, and `charge.status` on a
 * Stripe object is exactly such a key.
 *
 * @type {object}
 */
export const reconciliationEvidenceSchema = z.object(
  Object.fromEntries(
    RECONCILIATION_EVIDENCE_KEYS.map((key) => [
      key,
      z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
    ]),
  ),
)

/**
 * A reconciliation task, as an operator sees it.
 *
 * `localState` and `providerState` are both here, because the decision is made
 * by comparing them and a screen that showed only one would be asking somebody
 * to decide with half the evidence. Neither is a provider payload: `localState`
 * is written by this system when the problem happens, and `providerState` is
 * the small summary {@link module:@desi-event/api/lib/reconciliation} records
 * after a re-query — never the provider's raw object, which can carry anything.
 * Both are projected onto {@link reconciliationEvidenceSchema} on the way out,
 * so "never" is enforced rather than intended.
 *
 * @type {object}
 */
export const reconciliationTaskSchema = z.object({
  id: cuidSchema,
  kind: z.enum([
    'PAYMENT_TIMEOUT',
    'PROVIDER_MISMATCH',
    'REFUND_UNKNOWN',
    'WEBHOOK_DEAD_LETTER',
    'TRANSFER_STUCK',
  ]),
  state: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED']),
  paymentId: cuidSchema.nullable(),
  orderId: cuidSchema.nullable(),
  orderReference: orderReferenceSchema.nullish(),
  refundId: cuidSchema.nullable(),
  organizationId: cuidSchema.nullable(),
  providerRef: z.string().nullable(),
  localState: reconciliationEvidenceSchema.nullable(),
  providerState: reconciliationEvidenceSchema.nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  assignedToId: cuidSchema.nullable(),
  resolution: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: timestampSchema.nullable(),
  resolvedById: cuidSchema.nullable(),
  escalatedAt: timestampSchema.nullable(),
  escalationReason: z.string().nullable(),
  notes: z
    .array(z.object({ at: timestampSchema, actorId: cuidSchema.nullable(), note: z.string() }))
    .nullable(),
  /** `FRESH`, `AGING` or `OVERDUE`. Derived, so two screens cannot disagree. */
  aging: z.enum(['FRESH', 'AGING', 'OVERDUE']),
  /** Whole hours since it was opened. */
  ageHours: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
})

/**
 * An organiser's balance, broken down.
 *
 * Every component, not only the answer. "Why is my balance lower than my
 * sales?" is the question an organiser asks, and a figure that cannot be broken
 * down is a figure they cannot trust.
 *
 * @type {object}
 */
export const organizerBalanceSchema = z.object({
  organizationId: cuidSchema,
  currency: currencySchema,
  /** What the ledger says is owed: `organizer_payable` credits less debits. */
  payableCents: z.number().int(),
  /** Transfers and payouts decided but not yet posted to the ledger. */
  inFlightCents: z.number().int(),
  /** Refunds promised to buyers and not yet settled. */
  refundLiabilityCents: z.number().int(),
  /** Every open dispute's amount. */
  disputeLiabilityCents: z.number().int(),
  /** What may actually be paid. Never below zero in practice, and may be. */
  availableCents: z.number().int(),
})

/** A payout, as finance sees it. */
export const payoutSchema = z.object({
  id: cuidSchema,
  organizationId: cuidSchema,
  connectedAccountId: cuidSchema.nullable(),
  provider: z.string(),
  providerPayoutId: z.string().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
  status: z.enum([
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
  ]),
  reversedCents: z.number().int(),
  /** Why it is held, when it is. Prose an organiser can act on. */
  holdReason: z.string().nullable(),
  failureCode: z.string().nullable(),
  arrivalDate: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
})

/** A transfer to a connected account. */
export const transferSchema = z.object({
  id: cuidSchema,
  organizationId: cuidSchema,
  connectedAccountId: cuidSchema.nullable(),
  orderId: cuidSchema.nullable(),
  provider: z.string(),
  providerTransferId: z.string().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
  status: z.enum([
    'PENDING',
    'SUBMITTED',
    'SENT',
    'PAID',
    'FAILED',
    'REVERSED',
    'PARTIALLY_REVERSED',
    'RECONCILIATION_REQUIRED',
  ]),
  reversedCents: z.number().int(),
  failureCode: z.string().nullable(),
  settledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
})

/**
 * A dispute.
 *
 * The provider's reason code passes through as a string and is not interpreted:
 * the vocabulary is theirs, it changes without notice, and mapping it onto an
 * enum here would mean a new reason code became a 500.
 *
 * @type {object}
 */
export const disputeSchema = z.object({
  id: cuidSchema,
  paymentId: cuidSchema,
  provider: z.string(),
  providerDisputeId: z.string(),
  amountCents: centsSchema,
  currency: currencySchema,
  reason: z.string().nullable(),
  status: z.enum([
    'OPENED',
    'NEEDS_RESPONSE',
    'UNDER_REVIEW',
    'CHARGE_REFUNDED',
    'WON',
    'LOST',
    'CLOSED',
    'WARNING_NEEDS_RESPONSE',
    'WARNING_CLOSED',
  ]),
  fundsWithheld: z.boolean(),
  evidenceDueAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
})
