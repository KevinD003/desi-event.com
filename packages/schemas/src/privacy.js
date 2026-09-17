/**
 * Privacy redaction, holds and retention.
 *
 * These schemas describe what a browser may say about a redaction and what the
 * server says back. The asymmetry is the point: a request names a subject and a
 * reason and nothing else, while a response describes *scope* — how many rows in
 * which categories — and never a value.
 *
 * Two absences are deliberate and load-bearing.
 *
 * Nothing here accepts an organisation id. Organisation scope is resolved from
 * the caller's session on the server, and a caller-supplied organisation is a
 * caller-supplied authority. The one place an organisation appears in a request
 * is a path parameter, where the route's `capabilityScope` reads it and the
 * capability check refuses a caller who does not hold `privacy:redact` there.
 *
 * Nothing here accepts an idempotency key or a confirmation token as input to
 * the *raising* of a request. Both are minted by the server: a caller-chosen
 * idempotency key is a caller-chosen replay, and a caller-chosen confirmation is
 * not a confirmation.
 *
 * @module @desi-event/schemas/privacy
 */

import { z } from 'zod'

import {
  privacyHoldDecisionSchema,
  privacyRequestReasonSchema,
  privacyRequestStateSchema,
} from './enums.js'
import {
  cuidSchema,
  nonEmptyStringSchema,
  paginationQuerySchema,
  timestampSchema,
} from './primitives.js'
import { paginationMetaSchema } from './responses.js'

/**
 * The personal-data categories a redaction is expressed in.
 *
 * Categories rather than columns, because a category is what an operator can be
 * asked to confirm and a column list is a map of where the personal data is.
 * The mapping from category to column lives on the server.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRIVACY_DATA_CATEGORIES = Object.freeze([
  'ACCOUNT_IDENTITY',
  'BUYER_IDENTITY',
  'TICKET_HOLDER_IDENTITY',
  'NOTIFICATION_DELIVERY',
  'SECURITY_METADATA',
  'EXPORTS',
])

/** One personal-data category. */
export const privacyDataCategorySchema = z.enum(PRIVACY_DATA_CATEGORIES)

/**
 * How much there is to redact in one category.
 *
 * A count and a category name. Never a value, and never a column name: a
 * preview an operator reads must not become a map of where the personal data
 * is.
 */
export const privacyScopeEntrySchema = z.object({
  category: privacyDataCategorySchema,
  rows: z.int().min(0),
})

/**
 * What a redaction request looks like to an authorised operator.
 *
 * `subjectId` is an opaque row id, which is what makes this payload safe: it
 * identifies the person to the system without naming them. There is no
 * `subjectEmail`, no `subjectName`, and no field carrying anything that was or
 * will be redacted.
 */
export const privacyRequestSchema = z.object({
  id: cuidSchema,
  subjectId: cuidSchema,
  state: privacyRequestStateSchema,
  reason: privacyRequestReasonSchema,
  holdDecision: privacyHoldDecisionSchema,
  /// The policy revision the request was evaluated against.
  policyVersion: nonEmptyStringSchema,
  /// Ties this request's audit events together. Server-minted, never a secret.
  correlationId: nonEmptyStringSchema,
  /// Category counts, when they have been established. Null before the preview.
  scope: z.array(privacyScopeEntrySchema).nullable(),
  /// A closed-vocabulary code once the request is terminal.
  outcomeCode: nonEmptyStringSchema.nullable(),
  requestedAt: timestampSchema,
  confirmedAt: timestampSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
})

/** `GET /v1/organizations/:id/privacy/requests`. */
export const privacyRequestListResponseSchema = z.object({
  data: z.array(privacyRequestSchema),
  pagination: paginationMetaSchema,
})

/** `GET /v1/organizations/:id/privacy/requests/:requestId`. */
export const privacyRequestResponseSchema = z.object({
  data: privacyRequestSchema,
})

/**
 * Filters for the request list.
 *
 * `subjectId` is a cuid and never an address: searching by e-mail would make
 * this endpoint a way to confirm whether a given person is in the system, which
 * is exactly the question a redaction is supposed to stop answering.
 */
export const privacyRequestListQuerySchema = paginationQuerySchema.extend({
  state: privacyRequestStateSchema.optional(),
  subjectId: cuidSchema.optional(),
})
