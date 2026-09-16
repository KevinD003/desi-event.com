/**
 * The venue shapes.
 *
 * Two things are worth testing here and the rest is Zod doing its job: that the
 * public payload is an allow-list rather than the row, and that accessibility is
 * a vocabulary a query can filter on rather than a paragraph a person has to
 * read.
 *
 * @module @desi-event/schemas/venues.test
 */

import { describe, expect, it } from 'vitest'

import {
  ACCESSIBILITY_FEATURES,
  createVenueRequestSchema,
  listVenuesQuerySchema,
  mergeVenueRequestSchema,
  updateVenueRequestSchema,
  venueAccessibilitySchema,
  venueListResponseSchema,
  venueResponseSchema,
} from './venues.js'

const ids = { venue: 'ckl1a2b3c4d5e6f7g8h9i0jm', org: 'ckl1a2b3c4d5e6f7g8h9i0jl' }

/** The smallest venue the create schema accepts. */
const minimal = {
  name: 'GMDC Ground',
  addressLine1: 'University Road',
  city: 'Ahmedabad',
  region: 'Gujarat',
  postalCode: '380015',
}

/** A complete venue as the API returns it. */
const detail = {
  id: ids.venue,
  slug: 'gmdc-ground',
  name: 'GMDC Ground',
  addressLine1: 'University Road',
  addressLine2: null,
  city: 'Ahmedabad',
  region: 'Gujarat',
  postalCode: '380015',
  country: 'IN',
  latitude: 23.0359,
  longitude: 72.5455,
  capacity: 20000,
  timezone: 'Asia/Kolkata',
  shared: true,
  mergedIntoVenueId: null,
  accessibility: { features: ['STEP_FREE_ENTRANCE'], note: null },
  description: null,
  directions: null,
  policies: null,
  provenance: 'moderator',
}

describe('createVenueRequestSchema', () => {
  it('accepts an address and nothing else', () => {
    expect(createVenueRequestSchema.parse(minimal).name).toBe('GMDC Ground')
  })

  it('rejects a country that is not two letters', () => {
    expect(createVenueRequestSchema.safeParse({ ...minimal, country: 'IND' }).success).toBe(false)
  })

  it('rejects coordinates off the planet', () => {
    expect(createVenueRequestSchema.safeParse({ ...minimal, latitude: 120 }).success).toBe(false)
    expect(createVenueRequestSchema.safeParse({ ...minimal, longitude: -200 }).success).toBe(false)
  })

  it('rejects a timezone nobody is in', () => {
    expect(
      createVenueRequestSchema.safeParse({ ...minimal, timezone: 'Asia/Atlantis' }).success,
    ).toBe(false)
  })

  it('lets a venue be claimed by an organisation or left shared', () => {
    expect(
      createVenueRequestSchema.parse({ ...minimal, organizationId: ids.org }).organizationId,
    ).toBe(ids.org)
    expect(createVenueRequestSchema.parse(minimal).organizationId).toBeUndefined()
  })
})

describe('updateVenueRequestSchema', () => {
  it('refuses a request that changes nothing', () => {
    // A PATCH with an empty body is a caller mistake, and answering 200 to it
    // teaches them it worked.
    expect(updateVenueRequestSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a single field', () => {
    expect(updateVenueRequestSchema.parse({ capacity: 18000 }).capacity).toBe(18000)
  })

  it('will not move a venue between organisations', () => {
    // Not an omission: a transfer changes who may edit the record next, so it
    // is not something a PATCH should do quietly. The field is dropped rather
    // than honoured.
    const parsed = updateVenueRequestSchema.parse({ name: 'X', organizationId: ids.org })

    expect(parsed).not.toHaveProperty('organizationId')
  })
})

describe('accessibility as a vocabulary', () => {
  it('names claims that can be checked, not ratings', () => {
    expect(ACCESSIBILITY_FEATURES).toContain('STEP_FREE_ENTRANCE')
    expect(ACCESSIBILITY_FEATURES).toContain('HEARING_LOOP')
    // Nothing here is an opinion about how good the venue is.
    expect(ACCESSIBILITY_FEATURES.some((f) => /GOOD|POOR|RATING|SCORE/.test(f))).toBe(false)
  })

  it('rejects a claim that is not in the vocabulary', () => {
    expect(venueAccessibilitySchema.safeParse({ features: ['PROBABLY_FINE'] }).success).toBe(false)
  })

  it('keeps the note, which is what a wheelchair user actually reads', () => {
    const parsed = venueAccessibilitySchema.parse({
      features: ['STEP_FREE_ENTRANCE'],
      note: 'The accessible entrance is Gate 3; ring the bell and staff take five minutes.',
    })

    expect(parsed.note).toMatch(/Gate 3/)
  })

  it('defaults to claiming nothing rather than claiming everything', () => {
    expect(venueAccessibilitySchema.parse({}).features).toEqual([])
  })

  it('is filterable, because a person cannot filter on a paragraph', () => {
    const query = listVenuesQuerySchema.parse({
      city: 'Ahmedabad',
      accessibility: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET'],
    })

    expect(query.accessibility).toHaveLength(2)
    expect(query.page).toBe(1)
    expect(query.perPage).toBe(20)
  })
})

describe('the public venue payload', () => {
  it('is an allow-list, not the row', () => {
    // Finding NF-14's lesson applied before the leak rather than after it.
    const parsed = venueResponseSchema.parse({
      data: { ...detail, organizationId: ids.org, mergedIntoVenueId: null },
    })

    expect(parsed.data).not.toHaveProperty('organizationId')
  })

  it('says whether a venue is shared without naming who owns it', () => {
    // A caller listing venues does not need to learn which other organisation
    // owns one. The only question the screen asks is "can I edit this".
    expect(venueResponseSchema.parse({ data: detail }).data.shared).toBe(true)
  })

  it('carries the merge target, so a merged venue is a redirect rather than a dead end', () => {
    const merged = { ...detail, mergedIntoVenueId: ids.org }

    expect(venueResponseSchema.parse({ data: merged }).data.mergedIntoVenueId).toBe(ids.org)
  })

  it('paginates a listing', () => {
    const parsed = venueListResponseSchema.parse({
      data: [detail],
      pagination: { page: 1, perPage: 20, total: 1, hasNextPage: false },
    })

    expect(parsed.data).toHaveLength(1)
  })
})

describe('mergeVenueRequestSchema', () => {
  it('requires a reason, because a merge is not reversible by guesswork', () => {
    expect(mergeVenueRequestSchema.safeParse({ intoVenueId: ids.venue }).success).toBe(false)
    expect(
      mergeVenueRequestSchema.parse({
        intoVenueId: ids.venue,
        reason: 'Duplicate of the same hall',
      }).reason,
    ).toMatch(/Duplicate/)
  })
})
