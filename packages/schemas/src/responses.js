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
  cuidSchema,
  nonEmptyStringSchema,
  timestampSchema,
} from './primitives.js'
import { logLevelSchema } from './enums.js'
import {
  eventSummarySchema,
  eventWithRelationsSchema,
  orderWithItemsSchema,
  organizationSchema,
  publicUserSchema,
  ticketSchema,
  ticketTypeSchema,
  venueSchema,
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

/** `GET /venues/:id`. */
export const venueResponseSchema = z.object({
  data: venueSchema,
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
})

/** Envelope for endpoints that only confirm the write succeeded. */
export const okResponseSchema = z.object({
  ok: z.literal(true),
})
