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
import {
  eventCategorySchema,
  eventStatusSchema,
  holdStatusSchema,
  orderStatusSchema,
  orgRoleSchema,
  paymentStatusSchema,
  promoTypeSchema,
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

/** A `Venue` row. */
export const venueSchema = z.object({
  id: cuidSchema,
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

/** An event with the relations the detail page needs, all in one payload. */
export const eventWithRelationsSchema = eventSchema.extend({
  venue: venueSchema.nullish(),
  organization: organizationSchema.nullish(),
  ticketTypes: z.array(ticketTypeSchema).default([]),
})

/** An order with its line items and, once paid, its issued tickets. */
export const orderWithItemsSchema = orderSchema.extend({
  items: z.array(orderItemSchema).default([]),
  tickets: z.array(ticketSchema).optional(),
  event: eventSummarySchema.nullish(),
})
