/**
 * Organiser invitations: the only way anybody comes to post events here.
 *
 * Somebody on the Desi-Event team holding `organizer:invite` (a platform
 * administrator or super administrator) invites an address to start a new
 * organisation as its owner. The invitation carries a single-use code bound to
 * that address. Accepting it creates the organisation, verified, with the
 * inviting administrator recorded as its verifier, and makes the accepting
 * account its `OWNER`.
 *
 * What goes public under that Verified badge is what the administrator wrote:
 * the organisation's name, its public description and its website are fields
 * of the invitation, not of the acceptance. The recipient chooses only the web
 * address and the time zone.
 *
 * Every object schema here strips keys it does not name, so a planted `role`,
 * `status`, `tokenHash`, `organizationId`, `verificationStatus` or
 * `payoutCurrency` never reaches a handler.
 *
 * Not a subpath export: the web reads these shapes only through server code.
 *
 * @module @desi-event/schemas/organizer-invitations
 */

import { z } from 'zod'

import { opaqueTokenSchema } from './auth.js'
import { verificationStatusSchema } from './enums.js'
import {
  organizationNameSchema,
  organizationProfileInputSchema,
  organizationProfileSchema,
} from './organizations.js'
import {
  cuidSchema,
  emailSchema,
  nonEmptyStringSchema,
  paginationQuerySchema,
  timestampSchema,
  withoutControlCharacters,
} from './primitives.js'
import { paginationMetaSchema } from './responses.js'
import { invitationDeliverySchema, privilegeSessionSchema } from './teams.js'
import { websiteUrlSchema } from './website.js'

/**
 * The states an organiser invitation is reported in.
 *
 * `EXPIRED` is reported for a waiting row whose expiry has passed, whether or
 * not the row itself has been moved there yet.
 *
 * @type {ReadonlyArray<string>}
 */
export const ORGANIZER_INVITATION_STATUSES = Object.freeze([
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED',
])

/** Fourteen days, like a team invitation. */
export const ORGANIZER_INVITATION_LIFETIME_DAYS = 14

/**
 * Trim a string and treat an empty one as absent.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} The trimmed string, `undefined` when blank, or the value unchanged.
 */
function trimmedOrAbsent(value) {
  if (typeof value !== 'string') return value

  const text = value.trim()

  return text === '' ? undefined : text
}

/**
 * A control character other than a line break.
 *
 * @type {RegExp}
 */
const NOTE_CONTROL_CHARACTER = /(?!\n)\p{Cc}/u

/**
 * A note for the recipient, sent with the code and never shown publicly.
 *
 * Line breaks are fine in a note; other control characters are not. Windows
 * line endings are folded to `\n` first.
 */
export const organizerInvitationNoteSchema = z.preprocess(
  (value) => (typeof value === 'string' ? trimmedOrAbsent(value.replace(/\r\n?/gu, '\n')) : value),
  z
    .string()
    .min(1)
    .max(1000)
    .refine((value) => !NOTE_CONTROL_CHARACTER.test(value), {
      message: 'A note cannot contain control characters.',
    })
    .optional(),
)

/** The organisation's public description, written by the administrator. */
const organizationDescriptionSchema = z.preprocess(
  (value) => (typeof value === 'string' ? trimmedOrAbsent(value.replace(/\r\n?/gu, '\n')) : value),
  z
    .string()
    .min(1)
    .max(2000)
    .refine((value) => !NOTE_CONTROL_CHARACTER.test(value), {
      message: 'A description cannot contain control characters.',
    })
    .optional(),
)

/**
 * `POST /v1/platform/organizer-invitations`.
 *
 * One kind of invitation: start a new organisation as its owner. The
 * description and website, when given, are what the organisation's public
 * page will show; the administrator writing them here is the review they get.
 * The website follows the event website rules and is stored normalised.
 */
export const createOrganizerInvitationRequestSchema = z.object({
  email: emailSchema,
  organizationName: organizationNameSchema,
  organizationDescription: organizationDescriptionSchema,
  organizationWebsiteUrl: websiteUrlSchema.optional(),
  note: organizerInvitationNoteSchema,
})

/**
 * `GET /v1/platform/organizer-invitations`.
 *
 * `q` searches organisation names only. An email address in a query string is
 * written to access logs, so the list cannot be searched by one.
 */
export const organizerInvitationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...ORGANIZER_INVITATION_STATUSES, 'ALL']).default('PENDING'),
  q: z.preprocess(trimmedOrAbsent, withoutControlCharacters(z.string().min(2).max(120)).optional()),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
})

/**
 * An organiser invitation, as the Desi-Event team's list shows it.
 *
 * An allow-list. It carries the recipient's address and the note, because the
 * people issuing invitations need both, and never the code or its digest.
 */
export const organizerInvitationSummarySchema = z.object({
  id: cuidSchema,
  email: emailSchema,
  organizationName: nonEmptyStringSchema,
  organizationDescription: z.string().nullable(),
  organizationWebsiteUrl: z.string().nullable(),
  /** The organisation the invitation created, once accepted. */
  organization: z
    .object({
      id: cuidSchema,
      name: nonEmptyStringSchema,
      slug: z.string(),
      verificationStatus: verificationStatusSchema,
    })
    .nullable(),
  note: z.string().nullable(),
  /** Effective: a waiting invitation past its expiry reads `EXPIRED`. */
  status: z.enum(ORGANIZER_INVITATION_STATUSES),
  deliveryMode: z.enum(['EMAIL', 'MANUAL']),
  invitedByName: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  revokedByName: z.string().nullable(),
  supersedesId: cuidSchema.nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
})

/** `GET /v1/platform/organizer-invitations`. */
export const organizerInvitationListResponseSchema = z.object({
  data: z.array(organizerInvitationSummarySchema),
  pagination: paginationMetaSchema,
  /** How codes go out in this deployment, so the screen can say. */
  meta: z.object({ deliveryMode: z.enum(['EMAIL', 'MANUAL']) }),
})

/**
 * `POST /v1/platform/organizer-invitations` and its reissue.
 *
 * The only responses that carry an organiser invitation code, and only in
 * `MANUAL`: once, `no-store`, never logged or audited.
 */
export const organizerInvitationIssuedResponseSchema = z.object({
  data: organizerInvitationSummarySchema.extend({ delivery: invitationDeliverySchema }),
})

/** `POST /v1/platform/organizer-invitations/:id/revoke`. */
export const organizerInvitationResponseSchema = z.object({
  data: organizerInvitationSummarySchema,
})

/**
 * `POST /v1/organizer-invitations/accept`.
 *
 * The code, typed rather than followed from a link, and the two things the
 * organiser chooses. `name`, `description`, `websiteUrl`, `verificationStatus`,
 * `verified`, `payoutCurrency`, `contactEmail`, `createdById` and anything else
 * are stripped.
 */
export const acceptOrganizerInvitationRequestSchema = organizationProfileInputSchema.extend({
  token: opaqueTokenSchema,
})

/** `POST /v1/organizer-invitations/accept`. */
export const acceptedOrganizerInvitationResponseSchema = z.object({
  data: z.object({
    organization: organizationProfileSchema,
    role: z.literal('OWNER'),
    /** Whether the account must now set up a second factor, and whether it has one. */
    session: privilegeSessionSchema,
  }),
})
