/**
 * Seat maps and seat holds, over the wire.
 *
 * Two response shapes and one request. What the request does *not* accept is the
 * point: no price, no status, no hold duration, no ticket-type override. A buyer
 * names seats and a session; everything else about what those seats cost and
 * whether they may have them is decided server-side from rows they cannot touch.
 *
 * @module @desi-event/schemas/seating
 */

import { z } from 'zod'

import { eventSeatStatusSchema, sectionKindSchema } from './enums.js'
import { centsSchema, cuidSchema, nonEmptyStringSchema, timestampSchema } from './primitives.js'

/**
 * A seat as a buyer sees it.
 *
 * `status` and `blockedReason` are optional because they are present only for an
 * organiser — the same shape serves both audiences, and the difference is what
 * the server chose to put in it.
 */
export const publicSeatSchema = z.object({
  id: cuidSchema,
  seatId: cuidSchema,
  label: nonEmptyStringSchema,
  sectionId: cuidSchema,
  rowId: cuidSchema.nullish(),
  priceZoneId: cuidSchema.nullish(),
  sortOrder: z.int(),
  available: z.boolean(),
  accessible: z.boolean(),
  companionOfSeatId: cuidSchema.nullish(),
  obstructedView: z.boolean(),
  restricted: z.boolean(),
  restrictionNote: z.string().max(500).nullish(),
  priceCents: centsSchema.nullish(),
  ticketTypeId: cuidSchema.nullish(),
  status: eventSeatStatusSchema.optional(),
  blockedReason: z.string().max(500).nullish(),
})

/** A row of seats within a section. */
export const seatRowSchema = z.object({
  id: cuidSchema,
  label: nonEmptyStringSchema,
  sortOrder: z.int(),
  seats: z.array(publicSeatSchema),
})

/** A section of the map, with its rows and any seats that belong to no row. */
export const seatSectionSchema = z.object({
  id: cuidSchema,
  name: nonEmptyStringSchema,
  kind: sectionKindSchema,
  sortOrder: z.int(),
  standingCapacity: z.int().nullish(),
  rows: z.array(seatRowSchema),
  seats: z.array(publicSeatSchema),
})

/** `GET /v1/sessions/:id/seats`. */
export const seatMapResponseSchema = z.object({
  data: z.object({
    sessionId: cuidSchema,
    eventId: cuidSchema,
    venueMapVersionId: cuidSchema.nullish(),
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    timezone: nonEmptyStringSchema,
    counts: z.object({
      total: z.int().min(0),
      available: z.int().min(0),
      held: z.int().min(0),
      sold: z.int().min(0),
      unavailable: z.int().min(0),
    }),
    sections: z.array(seatSectionSchema),
  }),
})

/**
 * `POST /v1/sessions/:id/holds`.
 *
 * A list of seats and nothing else. The hold's duration, the price, the ticket
 * type and whether the buyer may have these seats at all are all server-side
 * decisions; accepting any of them here would make them negotiable.
 */
export const holdSeatsRequestSchema = z.object({
  seatIds: z.array(cuidSchema).min(1).max(20),
})

/** `POST /v1/sessions/:id/holds`. */
export const seatHoldResponseSchema = z.object({
  data: z.object({
    id: cuidSchema,
    eventSessionId: cuidSchema,
    expiresAt: timestampSchema,
    // Returned once, to a guest who has no account to own the hold with. An
    // authenticated buyer gets no token: their session is the ownership proof.
    guestToken: z.string().min(16).nullish(),
    seats: z.array(publicSeatSchema),
    subtotalCents: centsSchema,
    currency: z.string().length(3),
  }),
})
