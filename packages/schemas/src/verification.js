/**
 * Organiser verification: what an organiser may ask for, and what a moderator
 * may decide.
 *
 * The shapes are deliberately asymmetric, and the asymmetry is the
 * authorisation model written down:
 *
 *   - An organiser **submits**. They do not name a target state, because the
 *     only state they can reach is `PENDING` and offering a field implies a
 *     choice they do not have.
 *   - A moderator **decides**, naming one of four outcomes and a reason. The
 *     reason is required rather than optional: a verification decision with no
 *     recorded rationale is one nobody can review, appeal or learn from.
 *
 * Nothing here accepts a bank detail, a tax identifier or a document. Those
 * belong with the payment provider, which is licensed to hold them; this
 * endpoint holds the *decision*, not the evidence.
 *
 * @module @desi-event/schemas/verification
 */

import { z } from 'zod'

import { verificationStatusSchema } from './enums.js'
import { cuidSchema, nonEmptyStringSchema, timestampSchema } from './primitives.js'

/**
 * A moderator's reason, bounded.
 *
 * Long enough to explain a refusal, short enough that nobody pastes a case file
 * into a column that is read back on a public support screen.
 *
 * @type {object}
 */
export const verificationReasonSchema = z.string().trim().min(3).max(500)

/**
 * The outcomes a moderator may choose.
 *
 * `PENDING` and `UNVERIFIED` are absent: a moderator does not put something back
 * in their own queue and does not un-ask a question that was asked. The state
 * machine would refuse both anyway — this just means the request never gets that
 * far.
 *
 * @type {object}
 */
export const moderationDecisionSchema = z.enum([
  'REQUIRES_INFORMATION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED',
])

/** `POST /v1/organizations/:id/verification` — the organiser asks. */
export const submitVerificationRequestSchema = z.object({
  /** The registered legal name, when it differs from the trading name. */
  legalName: nonEmptyStringSchema.optional(),
  /** What the organiser wants a moderator to know. Never a document. */
  note: z.string().trim().max(1000).optional(),
})

/** `POST /v1/organizations/:id/verification/decision` — a moderator decides. */
export const moderateVerificationRequestSchema = z
  .object({
    decision: moderationDecisionSchema,
    reason: verificationReasonSchema,
    /**
     * What the organiser must supply. Only meaningful alongside
     * `REQUIRES_INFORMATION`, and required there: asking for information without
     * saying which information is a round trip wasted.
     */
    note: z.string().trim().max(1000).optional(),
  })
  .refine(
    (value) => value.decision !== 'REQUIRES_INFORMATION' || Boolean(value.note),
    { message: 'Say what the organiser needs to supply.', path: ['note'] },
  )

/** One entry in the history. */
export const verificationEventSchema = z.object({
  id: cuidSchema,
  fromStatus: verificationStatusSchema.nullable(),
  toStatus: verificationStatusSchema,
  reason: z.string().nullable(),
  createdAt: timestampSchema,
})

/** The state, with its history. */
export const verificationStateSchema = z.object({
  organizationId: cuidSchema,
  status: verificationStatusSchema,
  /**
   * Whether the organisation may publish and be paid.
   *
   * Sent as its own field rather than left for the client to derive from
   * `status`, so that a screen cannot get the rule subtly wrong — and so the
   * rule can change without every client changing with it.
   */
  eligible: z.boolean(),
  note: z.string().nullable(),
  updatedAt: timestampSchema.nullable(),
  history: z.array(verificationEventSchema),
})

/** The response envelope for both the read and the two writes. */
export const verificationStateResponseSchema = z.object({ data: verificationStateSchema })

/** A public organiser profile. */
export const publicOrganizerSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  /**
   * Shown only for a genuinely verified organisation.
   *
   * Derived server-side from the verification state rather than from the
   * denormalised column, so a stale badge cannot be served.
   */
  verified: z.boolean(),
  refundPolicy: z.string().nullable(),
  timezone: z.string(),
  upcomingEvents: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      startsAt: timestampSchema,
      venueName: z.string().nullable(),
    }),
  ),
  pastEvents: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      startsAt: timestampSchema,
      venueName: z.string().nullable(),
    }),
  ),
})

/** `GET /v1/organizers/:slug`. */
export const publicOrganizerResponseSchema = z.object({ data: publicOrganizerSchema })

/** Path parameter for the public organiser route. */
export const organizerSlugParamSchema = z.object({ slug: z.string().min(1).max(120) })
