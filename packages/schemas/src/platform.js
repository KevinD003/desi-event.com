/**
 * Platform staff administration: finding an account, changing its platform
 * role, and putting somebody into an organisation directly.
 *
 * Every write here is held by `platform:admin` alone — a super administrator —
 * and needs a second factor confirmed within the `SECURITY_ROLE` window and a
 * written reason. A narrower capability would be a false promise: whoever can
 * grant `SUPER_ADMIN` effectively holds everything already.
 *
 * Searching for an account takes its query in a request body rather than the
 * URL. The query is usually an email address, and a URL is written to access
 * logs, proxy logs and browser history; a body is not.
 *
 * @module @desi-event/schemas/platform
 */

import { z } from 'zod'

import { orgRoleSchema, userRoleSchema, verificationStatusSchema } from './enums.js'
import {
  countSchema,
  cuidSchema,
  emailSchema,
  nonEmptyStringSchema,
  pageSchema,
  paginationQuerySchema,
  timestampSchema,
  withoutControlCharacters,
} from './primitives.js'
import { paginationMetaSchema } from './responses.js'

/**
 * Trim a string, leaving any other value for the wrapped schema to refuse.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} Trimmed string, or the value unchanged.
 */
function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value
}

/** How many accounts one page of search results carries at most. */
export const PLATFORM_USER_SEARCH_MAX_PER_PAGE = 50

/**
 * `POST /v1/platform/users/search`.
 *
 * At least three characters: a one-letter query is a request for the whole
 * user table, a page at a time.
 */
export const platformUserSearchRequestSchema = z.object({
  // A search term PostgreSQL reads: no NUL, no other control character.
  q: z.preprocess(trimmed, withoutControlCharacters(z.string().min(3).max(254))),
  role: userRoleSchema.optional(),
  page: pageSchema,
  perPage: z.coerce.number().int().min(1).max(PLATFORM_USER_SEARCH_MAX_PER_PAGE).default(20),
})

/** One account, as a super administrator sees it in search results. */
export const platformUserSummarySchema = z.object({
  id: cuidSchema,
  email: emailSchema,
  displayName: nonEmptyStringSchema,
  role: userRoleSchema,
  suspended: z.boolean(),
  /** Whether a second factor is confirmed. A privileged role needs one before it can work. */
  mfaEnrolled: z.boolean(),
  /** The caller's own account, whose role this surface will not change. */
  self: z.boolean(),
  createdAt: timestampSchema,
  memberships: z
    .array(
      z.object({
        organizationId: cuidSchema,
        organizationName: nonEmptyStringSchema.nullable(),
        role: orgRoleSchema,
      }),
    )
    .max(50),
})

/** `POST /v1/platform/users/search`. */
export const platformUserSearchResponseSchema = z.object({
  data: z.array(platformUserSummarySchema),
  pagination: paginationMetaSchema,
})

/**
 * Why a platform change was made. Required, and stored on the audit row.
 *
 * @type {object}
 */
export const platformReasonSchema = z.preprocess(trimmed, z.string().min(3).max(500))

/**
 * `POST /v1/platform/users/:id/role`.
 *
 * Every platform role is accepted, including `ORGANIZER`, so that the role a
 * self-registered organiser already holds is one this surface can write back.
 */
export const setPlatformRoleRequestSchema = z.object({
  role: userRoleSchema,
  reason: platformReasonSchema,
})

/** `POST /v1/platform/users/:id/role`. */
export const platformRoleChangedResponseSchema = z.object({
  data: z.object({
    userId: cuidSchema,
    from: userRoleSchema,
    role: userRoleSchema,
    /** How many of the account's sessions ended, so it signs in again under the new role. */
    sessionsRevoked: countSchema,
  }),
})

/**
 * `GET /v1/platform/organizations`.
 *
 * A GET, unlike the account search, because an organisation's name is public
 * already: it is on its organiser page.
 */
export const platformOrganizationSearchQuerySchema = paginationQuerySchema.extend({
  q: z.preprocess(trimmed, withoutControlCharacters(z.string().min(2).max(120))),
})

/** One organisation in the super administrator's search. */
export const platformOrganizationSummarySchema = z.object({
  id: cuidSchema,
  name: nonEmptyStringSchema,
  slug: z.string(),
  verificationStatus: verificationStatusSchema,
  suspended: z.boolean(),
  memberCount: countSchema,
  /** Zero means nobody can manage it, which is the case the direct grant exists for. */
  ownerCount: countSchema,
})

/** `GET /v1/platform/organizations`. */
export const platformOrganizationSearchResponseSchema = z.object({
  data: z.array(platformOrganizationSummarySchema),
  pagination: paginationMetaSchema,
})

/**
 * `POST /v1/platform/organizations/:id/members`.
 *
 * The one request in the API that can name `OWNER` as a role to grant. It
 * exists for the organisation whose only owner has left, and it is the
 * audited, reasoned, second-factor path for that — never the everyday one.
 */
export const grantMembershipRequestSchema = z.object({
  userId: cuidSchema,
  role: orgRoleSchema,
  reason: platformReasonSchema,
})

/** `POST /v1/platform/organizations/:id/members`. */
export const membershipGrantedResponseSchema = z.object({
  data: z.object({
    membershipId: cuidSchema,
    organizationId: cuidSchema,
    userId: cuidSchema,
    role: orgRoleSchema,
    /** Null when the person was not a member before. */
    previousRole: orgRoleSchema.nullable(),
    created: z.boolean(),
    sessionsRevoked: countSchema,
  }),
})
