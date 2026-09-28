/**
 * Organisations somebody creates for themselves, and the profile its members
 * read.
 *
 * Anybody with an account may create an organisation, and that is safe only
 * because of what a new one cannot do. It starts `UNVERIFIED`, so it may draft
 * events but cannot publish them or be paid until a moderator has verified it,
 * and nothing in the request can say otherwise:
 *
 *   - the body carries no verification state, badge, suspension, payout
 *     currency or contact address — the server sets every one of them;
 *   - the contact address is the creator's own account email, recorded for the
 *     platform and never shown publicly;
 *   - the creator becomes its `OWNER`, which is a privileged role and therefore
 *     needs a second factor before the workspace will answer.
 *
 * @module @desi-event/schemas/organizations
 */

import { z } from 'zod'

import { addressFree } from './addresses.js'
import { verificationStatusSchema } from './enums.js'
import {
  cuidSchema,
  nonEmptyStringSchema,
  slugSchema,
  timestampSchema,
  urlSchema,
} from './primitives.js'
import { privilegeSessionSchema } from './teams.js'

/**
 * The time zones an organisation created on this site may run in.
 *
 * The catalogue is US-only, so the list is the US zones rather than every IANA
 * name: a picker with four hundred entries is one nobody reads, and a zone the
 * site does not sell in is a zone whose reports nobody has checked.
 *
 * @type {ReadonlyArray<string>}
 */
export const US_ORGANIZATION_TIMEZONES = Object.freeze([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
])

/** How many organisations one account may create in a day. */
export const ORGANIZATIONS_PER_ACCOUNT_PER_DAY = 3

/**
 * Trim a string, leaving any other value for the wrapped schema to refuse.
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} Trimmed string, or the value unchanged.
 */
function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value
}

/**
 * Trim a string and treat an empty one as absent.
 *
 * An optional field left blank in a form arrives as `''`, which means "not
 * given", not "given as nothing".
 *
 * @param {unknown} value Raw input.
 * @returns {unknown} The trimmed string, `undefined` when blank, or the value unchanged.
 */
function trimmedOrAbsent(value) {
  if (typeof value !== 'string') return value

  const text = value.trim()

  return text === '' ? undefined : text
}

/** An organisation's public name. Never an email address. */
export const organizationNameSchema = addressFree(z.preprocess(trimmed, z.string().min(2).max(120)))

/**
 * `POST /v1/organizations`.
 *
 * Deliberately short. The fields a moderator verifies, the address the
 * platform writes to and the currency it pays in are not the creator's to type
 * here: an object schema strips every key it does not name, so a request that
 * sends `verificationStatus`, `verified`, `payoutCurrency` or `contactEmail`
 * has them removed before the handler sees it.
 */
export const createOrganizationRequestSchema = z.object({
  name: organizationNameSchema,
  /** Derived from the name when absent. A taken slug is refused rather than altered. */
  slug: z.preprocess(trimmedOrAbsent, slugSchema.optional()),
  timezone: z.enum([...US_ORGANIZATION_TIMEZONES]).default('America/New_York'),
  description: z.preprocess(trimmedOrAbsent, z.string().min(1).max(2000).optional()),
  websiteUrl: z.preprocess(trimmedOrAbsent, urlSchema.optional()),
})

/**
 * An organisation, as its own members read it.
 *
 * An allow-list. The contact address, payout currency, suspension reason and
 * who created it are not here: a member needs the public face and the
 * verification state, and the rest is the platform's.
 */
export const organizationProfileSchema = z.object({
  id: cuidSchema,
  name: nonEmptyStringSchema,
  slug: slugSchema,
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  timezone: z.string(),
  legalName: z.string().nullable(),
  verificationStatus: verificationStatusSchema,
  /** Whether it may publish and be paid. Decided by the server, never derived by a screen. */
  eligible: z.boolean(),
  createdAt: timestampSchema,
})

/** `GET /v1/organizations/:id`. */
export const organizationProfileResponseSchema = z.object({ data: organizationProfileSchema })

/** `POST /v1/organizations`. */
export const organizationCreatedResponseSchema = z.object({
  data: organizationProfileSchema.extend({
    role: z.literal('OWNER'),
    session: privilegeSessionSchema,
  }),
})
