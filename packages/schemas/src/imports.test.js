import { describe, expect, it } from 'vitest'

import * as imports from './imports.js'
import {
  IMPORT_DATASET_FORMAT,
  IMPORT_LIMITS,
  IMPORT_PLAN_ACTIONS,
  IMPORT_TIER_DEFAULTS,
  RETIRED_DATASET_FIELDS,
  RETIRED_LISTING_FIELDS,
  eventImportApplyRequestSchema,
  eventImportApproveRequestSchema,
  eventImportPreviewRequestSchema,
  eventImportReassignRequestSchema,
  eventImportRunParamSchema,
  importDatasetSchema,
  importEventSchema,
  importSourceIdSchema,
  importTargetQuerySchema,
  priceNoteSaysSoldOut,
} from './imports.js'

/** One listing shaped as the curated file holds it: no web address anywhere. */
function listing(overrides = {}) {
  return {
    sourceId: '400132',
    scrapedAt: '2026-09-29T21:25:00Z',
    title: 'Falguni Pathak Live in Dallas – Dandiya Dhoom 2026',
    category: 'GARBA_DANDIYA',
    sourceCategory: 'GARBA_DANDIYA',
    summary: 'An evening of dandiya and garba with Falguni Pathak.',
    description: 'Dance your heart out.\n\nMeet the icon: Falguni Pathak.',
    startsAt: '2026-10-02T19:00:00-05:00',
    endsAt: null,
    timeZone: 'America/Chicago',
    venue: {
      name: 'Frisco Flyers',
      addressLine1: '6300 Flyers Way',
      city: 'Frisco',
      region: 'TX',
      postalCode: '75034',
      country: 'US',
    },
    performers: [{ name: 'Falguni Pathak', role: null }],
    presentedBy: 'hi INDiA Entertainment',
    languages: ['Gujarati', 'Multilingual'],
    prices: [
      { name: 'EARLY BIRD', priceCents: 3500, currency: 'USD', note: 'Sold Out' },
      { name: 'Regular', priceCents: 4500, currency: 'USD', note: null },
    ],
    priceText: '$35 - $45',
    ageRestriction: null,
    dressCode: null,
    parking: null,
    faq: [{ q: 'Where is it?', a: 'Frisco Flyers, 6300 Flyers Way, Frisco, TX' }],
    importNotes: [],
    ...overrides,
  }
}

/** A whole file around the listings given. */
function dataset(events = [listing()], overrides = {}) {
  return {
    format: IMPORT_DATASET_FORMAT,
    source: 'SULEKHA',
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
    events,
    ...overrides,
  }
}

describe('the plan actions', () => {
  it('name every action a plan row can carry', () => {
    expect([...IMPORT_PLAN_ACTIONS]).toEqual([
      'CREATE',
      'UPDATE_DRAFT',
      'UNCHANGED',
      'POSTED_KEPT',
      'UPDATE_POSTED',
      'SKIPPED_DECIDED',
      'SKIPPED_DELETED',
      'SKIPPED_REASSIGNED',
      'SKIPPED_PAST',
      'INVALID',
    ])
    expect(Object.isFrozen(IMPORT_PLAN_ACTIONS)).toBe(true)
  })
})

describe('importDatasetSchema', () => {
  it('parses a curated file', () => {
    const parsed = importDatasetSchema.parse(dataset())

    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0].endsAt).toBeNull()
  })

  it('takes a listing with an end time after its start, and refuses one that ends first', () => {
    expect(
      importDatasetSchema.safeParse(dataset([listing({ endsAt: '2026-10-02T23:00:00-05:00' })]))
        .success,
    ).toBe(true)

    const refused = importDatasetSchema.safeParse(
      dataset([listing({ endsAt: '2026-10-02T18:00:00-05:00' })]),
    )
    expect(refused.success).toBe(false)
    expect(refused.error.issues[0].path).toEqual(['events', 0, 'endsAt'])
  })

  it('refuses a listing that appears twice', () => {
    const refused = importDatasetSchema.safeParse(dataset([listing(), listing()]))

    expect(refused.success).toBe(false)
    expect(refused.error.issues[0].message).toBe('Listing 400132 appears more than once.')
  })

  it('refuses another format or another source', () => {
    expect(
      importDatasetSchema.safeParse(dataset(undefined, { format: 'desi-event-import/2' })).success,
    ).toBe(false)
    expect(
      importDatasetSchema.safeParse(dataset(undefined, { source: 'EVENTBRITE' })).success,
    ).toBe(false)
  })

  it('refuses an empty file and a key it does not know', () => {
    expect(importDatasetSchema.safeParse(dataset([])).success).toBe(false)
    expect(importDatasetSchema.safeParse(dataset(undefined, { extra: true })).success).toBe(false)
    expect(importDatasetSchema.safeParse(dataset([listing({ organizer: {} })])).success).toBe(false)
  })

  it('refuses a file that still carries a web address or the source site’s name, whatever the address', () => {
    // The listing link, the ticket link and the pictures of a file made before
    // 2026-10-15, and its header's site, picture hosts and name.
    expect([...RETIRED_LISTING_FIELDS]).toEqual(['sourceUrl', 'ticketUrl', 'images'])
    expect([...RETIRED_DATASET_FIELDS]).toEqual(['sourceName', 'sourceSite', 'imageHosts'])

    for (const broken of [
      listing({ sourceUrl: 'https://listings.example/x_1' }),
      listing({ ticketUrl: 'https://tickets.example/x_1' }),
      listing({ images: [] }),
      listing({ images: [{ url: 'https://pictures.example/a.webp', role: 'cover', alt: 'A' }] }),
    ]) {
      const refused = importDatasetSchema.safeParse(dataset([broken]))

      expect(refused.success).toBe(false)
      expect(refused.error.issues[0].code).toBe('unrecognized_keys')
    }

    for (const field of RETIRED_DATASET_FIELDS) {
      expect(importDatasetSchema.safeParse(dataset(undefined, { [field]: 'x' })).success).toBe(
        false,
      )
    }

    // Nothing in the schema module is a picture or address shape any more.
    expect(Object.keys(imports).filter((name) => /image|url|retry/iu.test(name))).toEqual([])
  })

  it('makes each listed price a ticket type with an allowance, closed when the listing sold out of it', () => {
    expect(IMPORT_TIER_DEFAULTS).toEqual({ quantityTotal: 100, minPerOrder: 1, maxPerOrder: 10 })
    expect(Object.isFrozen(IMPORT_TIER_DEFAULTS)).toBe(true)

    for (const note of [
      'Sold Out',
      'sold out',
      'SOLD-OUT',
      'Sold out; ticket sales close on Oct 9',
    ]) {
      expect(priceNoteSaysSoldOut(note), note).toBe(true)
    }
    for (const note of [null, undefined, '', 'Available', 'Selling fast', 'Almost full', 42]) {
      expect(priceNoteSaysSoldOut(note), String(note)).toBe(false)
    }
  })

  it('holds a listing to the bounds the database holds', () => {
    expect(
      importEventSchema.safeParse(
        listing({
          prices: Array.from({ length: IMPORT_LIMITS.prices + 1 }, (_, index) => ({
            name: `Tier ${index}`,
            priceCents: 1000,
            currency: 'USD',
            note: null,
          })),
        }),
      ).success,
    ).toBe(false)
    expect(
      importEventSchema.safeParse(listing({ importNotes: Array(21).fill('A note.') })).success,
    ).toBe(false)
    expect(
      importEventSchema.safeParse(
        listing({ prices: [{ name: '  ', priceCents: 1000, currency: 'USD', note: null }] }),
      ).success,
    ).toBe(false)
    expect(
      importEventSchema.safeParse(
        listing({ prices: [{ name: 'Regular', priceCents: 1000, currency: 'usd', note: null }] }),
      ).success,
    ).toBe(false)
  })

  it('takes only a known category and a known time zone', () => {
    expect(importEventSchema.safeParse(listing({ category: 'CONCERT' })).success).toBe(false)
    expect(importEventSchema.safeParse(listing({ timeZone: 'Texas/Dallas' })).success).toBe(false)
  })
})

describe('importSourceIdSchema', () => {
  it('takes 1 to 12 digits, as the database does', () => {
    expect(importSourceIdSchema.parse('402059')).toBe('402059')
    expect(importSourceIdSchema.parse('1')).toBe('1')
    expect(importSourceIdSchema.safeParse('1234567890123').success).toBe(false)
    expect(importSourceIdSchema.safeParse('40205a').success).toBe(false)
    expect(importSourceIdSchema.safeParse('').success).toBe(false)
  })
})

describe('the request bodies', () => {
  it('previews a named file and leaves the dataset to the handler', () => {
    expect(
      eventImportPreviewRequestSchema.parse({ fileName: ' texas.json ', dataset: { any: 1 } }),
    ).toEqual({ fileName: 'texas.json', dataset: { any: 1 } })
    expect(
      eventImportPreviewRequestSchema.safeParse({ fileName: '../texas.json', dataset: {} }).success,
    ).toBe(false)
    expect(
      eventImportPreviewRequestSchema.safeParse({ fileName: 'a'.repeat(201), dataset: {} }).success,
    ).toBe(false)
    expect(
      eventImportPreviewRequestSchema.safeParse({ fileName: 'texas.json', dataset: {}, run: 1 })
        .success,
    ).toBe(false)
  })

  it('applies a plan by its digest, updating posted listings only when named', () => {
    const digest = 'a'.repeat(64)

    expect(eventImportApplyRequestSchema.parse({ planDigest: digest })).toEqual({
      planDigest: digest,
      updateFromSource: [],
    })
    expect(
      eventImportApplyRequestSchema.parse({ planDigest: digest, updateFromSource: ['402059'] })
        .updateFromSource,
    ).toEqual(['402059'])
    expect(eventImportApplyRequestSchema.safeParse({ planDigest: 'A'.repeat(64) }).success).toBe(
      false,
    )
    expect(
      eventImportApplyRequestSchema.safeParse({
        planDigest: digest,
        updateFromSource: ['402059', '402059'],
      }).success,
    ).toBe(false)
  })

  it('approves 1 to 100 events, each once, at the revision the page showed', () => {
    const item = { eventId: 'cm8eventaaaaaaaaaaaaaaaaa', revision: 3 }

    expect(eventImportApproveRequestSchema.parse({ items: [item] }).items).toEqual([item])
    expect(eventImportApproveRequestSchema.safeParse({ items: [] }).success).toBe(false)
    expect(eventImportApproveRequestSchema.safeParse({ items: [item, item] }).success).toBe(false)
    expect(
      eventImportApproveRequestSchema.safeParse({
        items: Array.from({ length: 101 }, (_, index) => ({
          eventId: `cm8event${String(index).padStart(17, 'a')}`,
          revision: 0,
        })),
      }).success,
    ).toBe(false)
    expect(
      eventImportApproveRequestSchema.safeParse({ items: [{ eventId: item.eventId }] }).success,
    ).toBe(false)
  })

  it('reassigns with a reason of 10 to 500 characters and the revision read', () => {
    const body = {
      organizationId: 'cm8orgaaaaaaaaaaaaaaaaaaa',
      reason: 'The organiser has joined and runs this event now.',
      revision: 5,
    }

    expect(eventImportReassignRequestSchema.parse(body)).toEqual(body)
    expect(
      eventImportReassignRequestSchema.safeParse({ ...body, reason: 'Too short' }).success,
    ).toBe(false)
    expect(eventImportReassignRequestSchema.safeParse({ ...body, notify: true }).success).toBe(
      false,
    )
  })
})

describe('the run parameter and the target search', () => {
  const RUN = 'ckimportrun0000000000000a'

  it('has no body for retrying pictures: no picture is copied any more', () => {
    expect(imports.eventImportRetryRequestSchema).toBeUndefined()
  })

  it('takes a run id that is an id', () => {
    expect(eventImportRunParamSchema.parse({ runId: RUN })).toEqual({ runId: RUN })
    expect(eventImportRunParamSchema.safeParse({ runId: 'nope' }).success).toBe(false)
  })

  it('searches by a trimmed line of text without control characters', () => {
    expect(importTargetQuerySchema.parse({ q: '  Garba  ' })).toEqual({ q: 'Garba' })
    expect(importTargetQuerySchema.parse({})).toEqual({})
    expect(importTargetQuerySchema.safeParse({ q: '' }).success).toBe(false)
    expect(importTargetQuerySchema.safeParse({ q: 'a\u0000b' }).success).toBe(false)
    expect(importTargetQuerySchema.safeParse({ q: 'x'.repeat(121) }).success).toBe(false)
  })
})
