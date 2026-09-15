/**
 * Venues: the places events happen, and the accessibility facts a person needs
 * before they commit money to getting there.
 *
 * Two decisions shape everything here.
 *
 * **A venue is not owned by default.** `organizationId` is nullable, and a null
 * means a shared, platform-curated venue that many organisers list against. The
 * alternative — every organiser creating their own "Nehru Centre" — produces a
 * search page with eleven of them, none of which has the accessibility notes
 * somebody needs. So the shape allows sharing, and merging exists for when it
 * happens anyway.
 *
 * **Accessibility is a controlled vocabulary, not free text.** A visitor
 * filtering for step-free access cannot filter on a paragraph. The vocabulary is
 * small and explicit, and `accessibilityNote` carries what it cannot say —
 * which is the part a wheelchair user actually reads, so it is not an
 * afterthought either.
 *
 * Nothing here is scraped. `provenance` records who told us about a venue —
 * an organiser, a moderator, an import — because a listing with no attributable
 * source is one nobody can correct.
 *
 * @module @desi-event/schemas/venues
 */

import { z } from 'zod'

import {
  countSchema,
  cuidSchema,
  latitudeSchema,
  longitudeSchema,
  nonEmptyStringSchema,
  slugSchema,
  timestampSchema,
  timezoneSchema,
} from './primitives.js'

/**
 * Accessibility facts a venue can assert.
 *
 * Deliberately claims rather than ratings: "step-free entrance" is checkable and
 * "accessible" is an opinion. Each is something a person can be told is true and
 * hold the venue to.
 *
 * @type {string[]}
 */
export const ACCESSIBILITY_FEATURES = Object.freeze([
  'STEP_FREE_ENTRANCE',
  'STEP_FREE_TO_SEATING',
  'ACCESSIBLE_TOILET',
  'ACCESSIBLE_PARKING',
  'WHEELCHAIR_SPACES',
  'COMPANION_SEATING',
  'HEARING_LOOP',
  'AUDIO_DESCRIPTION',
  'SIGN_LANGUAGE',
  'CAPTIONING',
  'QUIET_SPACE',
  'ASSISTANCE_DOGS_WELCOME',
  'LIFT_ACCESS',
  'SEATED_ONLY',
  'STANDING_ONLY',
])

/** One accessibility claim. */
export const accessibilityFeatureSchema = z.enum([...ACCESSIBILITY_FEATURES])

/**
 * A venue's accessibility, as stored in the JSON column.
 *
 * The note is bounded but generous: "the accessible entrance is on Gate 3, ring
 * the bell, staff take five minutes to arrive" is exactly the kind of sentence
 * that makes a venue usable and does not fit in an enum.
 */
export const venueAccessibilitySchema = z.object({
  features: z.array(accessibilityFeatureSchema).max(ACCESSIBILITY_FEATURES.length).default([]),
  note: z.string().trim().max(2000).nullish(),
})

/** Fields a caller may set on a venue. */
const venueWritableFields = {
  name: nonEmptyStringSchema,
  addressLine1: nonEmptyStringSchema,
  addressLine2: nonEmptyStringSchema.nullish(),
  city: nonEmptyStringSchema,
  region: nonEmptyStringSchema,
  postalCode: z.string().trim().min(1).max(16),
  country: z.string().trim().length(2).optional(),
  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),
  capacity: countSchema.nullish(),
  description: z.string().trim().max(4000).nullish(),
  timezone: timezoneSchema.optional(),
  directions: z.string().trim().max(4000).nullish(),
  policies: z.string().trim().max(4000).nullish(),
  accessibility: venueAccessibilitySchema.nullish(),
}

/**
 * `POST /v1/venues`.
 *
 * `organizationId` is optional and means "this venue is ours". Omitting it asks
 * for a shared venue, which only platform staff may create — the route enforces
 * that, because a schema cannot know who is asking.
 */
export const createVenueRequestSchema = z.object({
  ...venueWritableFields,
  organizationId: cuidSchema.nullish(),
  slug: slugSchema.nullish(),
})

/**
 * `PATCH /v1/venues/:id`.
 *
 * Every field optional, and `organizationId` absent: moving a venue between
 * organisations is not an edit, it is a transfer, and it would silently change
 * who may edit it next.
 */
export const updateVenueRequestSchema = z
  .object({
    name: venueWritableFields.name.optional(),
    addressLine1: venueWritableFields.addressLine1.optional(),
    addressLine2: venueWritableFields.addressLine2,
    city: venueWritableFields.city.optional(),
    region: venueWritableFields.region.optional(),
    postalCode: venueWritableFields.postalCode.optional(),
    country: venueWritableFields.country,
    latitude: venueWritableFields.latitude,
    longitude: venueWritableFields.longitude,
    capacity: venueWritableFields.capacity,
    description: venueWritableFields.description,
    timezone: venueWritableFields.timezone,
    directions: venueWritableFields.directions,
    policies: venueWritableFields.policies,
    accessibility: venueWritableFields.accessibility,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change.',
  })

/** `GET /v1/venues` — search, for an organiser choosing where to put an event. */
export const listVenuesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).optional(),
  organizationId: cuidSchema.optional(),
  /**
   * Restrict to venues asserting every one of these.
   *
   * Wrapped in a preprocess because a query string carries one value as a
   * scalar and two as an array, and a filter that silently stops working when
   * you narrow it to a single feature is worse than one that never worked.
   */
  accessibility: z
    .preprocess(
      (value) => (value === undefined || Array.isArray(value) ? value : [value]),
      z.array(accessibilityFeatureSchema).max(6),
    )
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
})

/** `POST /v1/venues/:id/merge` — fold a duplicate into the row that survives. */
export const mergeVenueRequestSchema = z.object({
  /** The venue that survives. Events and orders are repointed at it. */
  intoVenueId: cuidSchema,
  reason: z.string().trim().min(3).max(500),
})

/** A venue as the API returns it. */
export const venueSummarySchema = z.object({
  id: cuidSchema,
  slug: z.string().nullable(),
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  capacity: z.number().int().nullable(),
  timezone: z.string(),
  /**
   * Whether this venue belongs to one organisation or is shared.
   *
   * Sent as a boolean rather than as the organisation's id: a caller listing
   * venues does not need to learn which other organisation owns one, and the
   * only question the screen asks is "can I edit this".
   */
  shared: z.boolean(),
  /** Set when this row has been merged away. Kept, never deleted. */
  mergedIntoVenueId: cuidSchema.nullable(),
  accessibility: venueAccessibilitySchema.nullable(),
})

/** A venue with the prose a page needs. */
export const venueDetailSchema = venueSummarySchema.extend({
  description: z.string().nullable(),
  directions: z.string().nullable(),
  policies: z.string().nullable(),
  provenance: z.string().nullable(),
  createdAt: timestampSchema.optional(),
})

/** Response envelopes. */
export const venueResponseSchema = z.object({ data: venueDetailSchema })

export const venueListResponseSchema = z.object({
  data: z.array(venueSummarySchema),
  pagination: z.object({
    page: z.int().min(1),
    perPage: z.int().min(1),
    total: z.int().min(0),
    hasNextPage: z.boolean(),
  }),
})

/** Path parameter for the public venue route. */
export const venueSlugParamSchema = z.object({ slug: z.string().min(1).max(160) })

/**
 * A venue as the public page shows it.
 *
 * Extends the detail shape with what the page is actually for: what is on
 * there. `canonicalSlug` is how a merged venue stays reachable — the old URL
 * resolves, and says which record it really is, rather than 404ing every link
 * and QR code printed before the merge.
 */
export const publicVenueSchema = venueDetailSchema.extend({
  canonicalSlug: z.string().nullable(),
  upcomingEvents: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      startsAt: timestampSchema,
      organizerName: z.string().nullable(),
    }),
  ),
})

/** `GET /v1/venues/slug/:slug`. */
export const publicVenueResponseSchema = z.object({ data: publicVenueSchema })
