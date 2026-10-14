/**
 * Organisations: the profile their members read, and the few fields an
 * organiser chooses when an organiser invitation starts one.
 *
 * Nobody creates an organisation for themselves here. An organisation comes
 * into being when somebody accepts an organiser invitation from the team
 * at The Desi Events (`organizer-invitations.js`), and almost everything about it
 * is decided by the server or by the administrator who sent the invitation:
 *
 *   - its name, public description and website are the ones the administrator
 *     wrote on the invitation, so what goes public under a Verified badge is
 *     what the team vouched for;
 *   - it starts VERIFIED, with the inviting administrator recorded as its
 *     verifier;
 *   - the contact address is the accepting account's own email, recorded for
 *     the platform and never shown publicly, and the payout currency is USD;
 *   - the accepting account becomes its `OWNER`, a privileged role that needs a
 *     second factor before the workspace will answer.
 *
 * The organiser picks only its web address (`slug`) and time zone, here.
 *
 * @module @desi-event/schemas/organizations
 */

import { z } from 'zod'

import { addressFree } from './addresses.js'
import { verificationStatusSchema } from './enums.js'
import { cuidSchema, nonEmptyStringSchema, slugSchema, timestampSchema } from './primitives.js'

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
 * What the organiser chooses when their invitation starts an organisation.
 *
 * Deliberately short. The name, description and website come from the
 * invitation; the verification state, badge, suspension, payout currency and
 * contact address are the server's. An object schema strips every key it does
 * not name, so a request that sends `name`, `description`, `websiteUrl`,
 * `verificationStatus`, `verified`, `payoutCurrency` or `contactEmail` has them
 * removed before the handler sees it.
 */
export const organizationProfileInputSchema = z.object({
  /** Derived from the name when absent. A taken slug is refused rather than altered. */
  slug: z.preprocess(trimmedOrAbsent, slugSchema.optional()),
  timezone: z.enum([...US_ORGANIZATION_TIMEZONES]).default('America/New_York'),
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
