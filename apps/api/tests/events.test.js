import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'

import {
  bearer,
  createTestApp,
  feeConfig,
  holdHeaders,
  signIn,
  stepUp,
  taxRateBps,
} from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { resolveSearchTerms, searchTerms } from '../src/routes/events.js'

/**
 * Fetch the event list and return the parsed body.
 *
 * @param {object} app The Fastify instance.
 * @param {string} [query] A query string, without the leading `?`.
 * @param {object} [headers] Request headers.
 * @returns {Promise<object>} The parsed response body.
 */
async function list(app, query = '', headers = {}) {
  const response = await app.inject({
    method: 'GET',
    url: query ? `/v1/events?${query}` : '/v1/events',
    headers,
  })

  expect(response.statusCode).toBe(200)
  return response.json()
}

/**
 * The two numeric fee terms, without the currency.
 *
 * @param {{percentageBps: number, flatCents: number}} terms A fee configuration.
 * @returns {{percentageBps: number, flatCents: number}} The terms.
 */
function pick({ percentageBps, flatCents }) {
  return { percentageBps, flatCents }
}

describe('what a public event page says about its organiser, finding NF-14', () => {
  it('carries no contact address and no payout currency', async () => {
    // The endpoint used to return the whole Organization row. An organiser's
    // account contact address and the currency they are paid in are not things
    // an anonymous visitor to a listing needs.
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toMatch(/hello@rangoli/)
    expect(Object.keys(response.json().data.organization).sort()).toEqual([
      'description',
      'id',
      'name',
      'slug',
      'verified',
      'websiteUrl',
    ])

    await app.close()
  })

  it('carries only the fields somebody has decided are public', async () => {
    // Two allow lists, deliberately: the presenter names every field, and the
    // response schema drops anything not in it. This asserts the intersection,
    // so widening either one alone still fails here.
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(Object.keys(response.json().data).sort()).toEqual([
      'accessibility',
      'ageRestriction',
      'artists',
      'category',
      'coverImageUrl',
      'createdAt',
      'description',
      'endsAt',
      // The booking fee is part of the price; see `feeTerms` in the schema.
      'feeTerms',
      'id',
      'isOnline',
      'languages',
      'onlineUrl',
      'organization',
      'organizationId',
      'policies',
      'previousStartsAt',
      'publishedAt',
      'revision',
      'slug',
      'startsAt',
      'status',
      'summary',
      'ticketTypes',
      'timezone',
      'title',
      'updatedAt',
      'venue',
      'venueId',
    ])

    await app.close()
  })

  it('leaks nothing when the row itself carries a moderator note or a contact', async () => {
    // The columns exist and are populated in ordinary operation: a moderator
    // asking for changes writes `moderationNote`, and an organiser gives a
    // contact address for the event. Neither is a stranger's business.
    const { app, prisma } = await createTestApp()
    const row = prisma._store.event.find((event) => event.slug === 'navratri-garba-night')

    row.moderationNote = 'Chase them about the fire licence.'
    row.contactEmail = 'box-office@rangoli.example'
    row.reviewSubmittedAt = new Date('2025-01-20T00:00:00.000Z')
    row.cancellationReason = 'Not cancelled, but the column is here.'
    row.salesOpenedAt = new Date('2025-01-25T00:00:00.000Z')

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toMatch(/fire licence/i)
    expect(response.body).not.toMatch(/box-office@rangoli/)
    expect(response.body).not.toMatch(
      /moderationNote|contactEmail|reviewSubmittedAt|cancellationReason|salesOpenedAt/,
    )

    await app.close()
  })

  it('publishes the facts a person needs before they commit money', async () => {
    const { app, prisma } = await createTestApp()
    const row = prisma._store.event.find((event) => event.slug === 'navratri-garba-night')

    row.ageRestriction = 18
    row.artists = ['Falguni Pathak']
    row.accessibility = { features: ['STEP_FREE_ENTRANCE'], note: 'Gate 3.' }

    const { data } = (
      await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    ).json()

    expect(data.ageRestriction).toBe(18)
    expect(data.artists).toEqual(['Falguni Pathak'])
    expect(data.accessibility).toEqual({ features: ['STEP_FREE_ENTRANCE'], note: 'Gate 3.' })
    expect(data.policies.refund).toBe('Refundable up to 48 hours before.')

    await app.close()
  })

  it('does not advertise a ticket type the organiser is still holding back', async () => {
    // A tier is DRAFT until somebody puts it on sale. Showing one publicly
    // announces an early-bird price, or a tier half-built, on the organiser's
    // behalf and without being asked.
    const { app, prisma, ids } = await createTestApp()

    await prisma.ticketType.create({
      data: {
        eventId: ids.publishedEvent.id,
        name: 'Early bird, not announced yet',
        priceCents: 99_900,
        currency: 'INR',
        quantityTotal: 50,
        status: 'DRAFT',
      },
    })

    const { data } = (
      await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    ).json()

    expect(data.ticketTypes.map((tier) => tier.name)).not.toContain('Early bird, not announced yet')
    expect(data.ticketTypes.every((tier) => tier.status !== 'DRAFT')).toBe(true)

    await app.close()
  })

  it('shows it to the organiser, whose editor is the reason it exists', async () => {
    const { app, prisma, ids } = await createTestApp()

    await prisma.ticketType.create({
      data: {
        eventId: ids.publishedEvent.id,
        name: 'Early bird, not announced yet',
        priceCents: 99_900,
        currency: 'INR',
        quantityTotal: 50,
        status: 'DRAFT',
      },
    })

    const token = await signIn(app, 'arun@rangoli.example')

    const { data } = (
      await app.inject({
        method: 'GET',
        url: '/v1/events/navratri-garba-night',
        headers: bearer(token),
      })
    ).json()

    expect(data.ticketTypes.map((tier) => tier.name)).toContain('Early bird, not announced yet')

    await app.close()
  })

  it("carries the venue's accessibility claims, where somebody will read them", async () => {
    // On the event page as well as the venue's own. Somebody deciding whether
    // they can get into a show is reading the event page; sending them to a
    // second page to find out whether there is a step-free entrance is how
    // that fact stops being read.
    const { app, prisma, ids } = await createTestApp()
    const venue = prisma._store.venue.find((row) => row.id === ids.venue.id)

    venue.accessibility = { features: ['STEP_FREE_ENTRANCE'], note: 'The ramp is at Gate 3.' }

    const { data } = (
      await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    ).json()

    expect(data.venue.accessibility).toEqual({
      features: ['STEP_FREE_ENTRANCE'],
      note: 'The ramp is at Gate 3.',
    })

    await app.close()
  })

  it('shows no badge when the column and the verification state disagree', async () => {
    const { app, prisma, ids } = await createTestApp()
    const organization = prisma._store.organization.find((row) => row.id === ids.organization.id)

    organization.verified = true
    organization.verificationStatus = 'SUSPENDED'

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.json().data.organization.verified).toBe(false)

    await app.close()
  })
})

describe('GET /v1/events', () => {
  it('shows anonymous callers published events only, and counts only those', async () => {
    const { app } = await createTestApp()

    const body = await list(app)

    expect(body.data.map((event) => event.slug).sort()).toEqual([
      'classical-dance-masterclass',
      'navratri-garba-night',
    ])
    // The draft must not inflate the total either; a count that disagrees with
    // the page is how a hidden event leaks.
    expect(body.pagination.total).toBe(2)
  })

  it('shows a member their own organisation drafts but not another org drafts', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.event.push({
      ...ids.draftEvent,
      id: 'cotherdraft000000000000zz',
      slug: 'other-org-secret',
      organizationId: ids.otherOrganization.id,
    })

    const token = await signIn(app, 'arun@rangoli.example')
    const body = await list(app, '', bearer(token))

    const slugs = body.data.map((event) => event.slug)
    expect(slugs).toContain('secret-bollywood-night')
    expect(slugs).not.toContain('other-org-secret')
  })

  it('shows a platform admin everything', async () => {
    // Six, not three: the fixture world gained a review-pending, a rejected and
    // an approved event when finding NF-19 was closed, and the point of an
    // administrator is that none of them are hidden from one.
    const { app } = await createTestApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const body = await list(app, '', bearer(token))

    expect(body.pagination.total).toBe(6)
  })

  it('intersects an explicit status filter with what the caller may see', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const anonymous = await list(app, 'status=DRAFT')
    const member = await list(app, 'status=DRAFT', bearer(token))

    expect(anonymous.data).toHaveLength(0)
    expect(member.data.map((event) => event.slug)).toEqual(['secret-bollywood-night'])
  })

  it('filters by category, city, online flag and organisation', async () => {
    const { app, ids } = await createTestApp()

    expect((await list(app, 'category=GARBA_DANDIYA')).data).toHaveLength(1)
    expect((await list(app, 'category=COMEDY')).data).toHaveLength(0)
    expect((await list(app, 'city=mumbai')).data.map((event) => event.city)).toEqual(['Mumbai'])
    expect((await list(app, 'isOnline=true')).data.map((event) => event.slug)).toEqual([
      'classical-dance-masterclass',
    ])
    expect((await list(app, `organizationId=${ids.organization.id}`)).data).toHaveLength(1)
  })

  it('searches title, summary and description case-insensitively', async () => {
    const { app } = await createTestApp()

    expect((await list(app, 'q=garba')).data).toHaveLength(1)
    expect((await list(app, 'q=BHARATANATYAM')).data.map((event) => event.slug)).toEqual([
      'classical-dance-masterclass',
    ])
    expect((await list(app, 'q=nothing-matches-this')).data).toHaveLength(0)
  })

  it('needs every word of a search to match, each against the event, its venue, city or organiser', async () => {
    const { app } = await createTestApp()
    const [garba] = (await list(app, 'q=garba')).data

    // The city and the organiser are not in the event's own text.
    const byCity = await list(app, `q=${encodeURIComponent(`garba ${garba.city}`)}`)
    expect(byCity.data.map((event) => event.slug)).toEqual([garba.slug])

    const byOrganiser = await list(app, `q=${encodeURIComponent(garba.organizationName)}`)
    expect(byOrganiser.data.map((event) => event.slug)).toContain(garba.slug)

    const byVenue = await list(app, `q=${encodeURIComponent(garba.venueName)}`)
    expect(byVenue.data.map((event) => event.slug)).toContain(garba.slug)

    // One word that matches nothing sinks the whole search.
    expect((await list(app, 'q=garba%20nothing-matches-this')).data).toHaveLength(0)
  })

  it('filters by start window and rejects a window that runs backwards', async () => {
    const { app } = await createTestApp()

    const soon = new Date(minutesFromNow(60 * 24 * 20)).toISOString()
    expect((await list(app, `startsBefore=${soon}`)).data.map((event) => event.slug)).toEqual([
      'classical-dance-masterclass',
    ])
    expect((await list(app, `startsAfter=${soon}`)).data.map((event) => event.slug)).toEqual([
      'navratri-garba-night',
    ])

    const backwards = await app.inject({
      method: 'GET',
      url: '/v1/events?startsAfter=2026-06-01&startsBefore=2026-01-01',
    })
    expect(backwards.statusCode).toBe(400)
    expect(backwards.json().error.issues[0].path).toBe('startsBefore')
  })

  it('paginates with honest metadata', async () => {
    const { app } = await createTestApp()

    const first = await list(app, 'page=1&perPage=1')
    const second = await list(app, 'page=2&perPage=1')

    expect(first.data).toHaveLength(1)
    expect(first.pagination).toMatchObject({
      page: 1,
      perPage: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    })
    expect(second.pagination).toMatchObject({ hasNextPage: false, hasPreviousPage: true })
    expect(second.data[0].slug).not.toBe(first.data[0].slug)
  })

  it('sorts by the requested key', async () => {
    const { app } = await createTestApp()

    const ascending = await list(app, 'sort=startsAt:asc')
    const descending = await list(app, 'sort=startsAt:desc')

    expect(ascending.data.map((event) => event.slug)).toEqual(
      descending.data.map((event) => event.slug).reverse(),
    )
    expect((await list(app, 'sort=title:asc')).data[0].title).toBe('Classical Dance Masterclass')
  })

  it('rejects an unknown sort key and an oversized page', async () => {
    const { app } = await createTestApp()

    expect((await app.inject({ method: 'GET', url: '/v1/events?sort=price:asc' })).statusCode).toBe(
      400,
    )
    expect((await app.inject({ method: 'GET', url: '/v1/events?perPage=5000' })).statusCode).toBe(
      400,
    )
  })

  it('denormalises the card fields a listing needs', async () => {
    const { app } = await createTestApp()

    const [event] = (await list(app, 'q=garba')).data

    expect(event).toMatchObject({
      city: 'Mumbai',
      venueName: 'Nehru Centre',
      organizationName: 'Rangoli Collective',
      // The cheapest tier that is actually on sale, not the paused early bird.
      minPriceCents: 150_000,
      currency: 'INR',
      soldOut: false,
    })
  })

  it('does not call a seated show sold out from its quantity columns', async () => {
    // A seated tier's stock is its seats. Its quantity is zero by design, and
    // reading it made every seated-only show "Sold out" from the day it was
    // announced. The summary says nothing rather than something false.
    const { app, prisma, ids } = await createTestApp()
    const tiers = await prisma.ticketType.findMany({ where: { eventId: ids.publishedEvent.id } })

    for (const tier of tiers) {
      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { reserved: true, quantityTotal: 0, quantitySold: 0 },
      })
    }

    const [card] = (await list(app, 'q=garba')).data

    expect(card).not.toHaveProperty('soldOut')
    expect(card).not.toHaveProperty('salesOpen')

    const { data: event } = (
      await app.inject({ method: 'GET', url: `/v1/events/${ids.publishedEvent.slug}` })
    ).json()

    // And the page is told which tiers are seated, so it can say so.
    expect(event.ticketTypes.every((tier) => tier.reserved === true)).toBe(true)
  })

  it('says a card is on sale only when a ticket could be bought now', async () => {
    const { app, prisma, ids } = await createTestApp()

    expect((await list(app, 'q=garba')).data[0].salesOpen).toBe(true)

    // Paused by the organiser: still listed, with the words to say so, and
    // not on sale.
    await prisma.event.update({
      where: { id: ids.publishedEvent.id },
      data: { status: 'SALES_PAUSED' },
    })

    const [paused] = (await list(app, 'q=garba')).data

    expect(paused.status).toBe('SALES_PAUSED')
    expect(paused.salesOpen).toBe(false)
  })

  it('quotes a card’s starting price as exactly what checkout charges for one ticket', async () => {
    // Not recomputed here: an order is placed, and the card's number is held to
    // what the order came to. A second implementation in the test would agree
    // with a second implementation in the presenter and prove nothing.
    const { app, ids } = await createTestApp()

    const [card] = (await list(app, 'q=garba')).data

    const hold = (
      await app.inject({
        method: 'POST',
        url: '/v1/holds',
        payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
      })
    ).json().data

    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: holdHeaders(hold),
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        holdIds: [hold.id],
      },
    })

    expect(placed.statusCode).toBe(201)

    const charged = placed.json().data

    expect(charged.subtotalCents).toBe(card.minPriceCents)
    expect(card.minTotalCents).toBe(charged.totalCents)
    // All-in means more than the face value whenever there is a fee.
    expect(card.minTotalCents).toBeGreaterThan(card.minPriceCents)
  })
})

describe('searchTerms', () => {
  it('splits a search into distinct words, however they were spaced or cased', () => {
    expect(searchTerms('Garba   HOUSTON garba')).toEqual(['garba', 'houston'])
  })

  it('has nothing to add for an empty search', () => {
    expect(searchTerms(undefined)).toEqual([])
    expect(searchTerms('')).toEqual([])
  })

  it('resolves each word to its venues and organisers, and gives up listing past a thousand', async () => {
    const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `id${index}` }))
    const prisma = {
      venue: { findMany: async () => rows(1001) },
      organization: { findMany: async () => rows(2) },
    }

    const [resolved] = await resolveSearchTerms(prisma, 'hall')

    // Too many venues to list: that word filters through the relation instead.
    expect(resolved).toEqual({ term: 'hall', venueIds: null, organizationIds: ['id0', 'id1'] })
    expect(await resolveSearchTerms(prisma, undefined)).toEqual([])
  })

  it('stops at eight words, so one request cannot add unbounded conditions', () => {
    const words = Array.from({ length: 12 }, (_, index) => `w${index}`)

    expect(searchTerms(words.join(' '))).toEqual(words.slice(0, 8))
  })
})

describe('GET /v1/events/:slug', () => {
  it('publishes the fee terms checkout charges with, and they price an order exactly', async () => {
    const { app, ids } = await createTestApp()

    const { data: event } = (
      await app.inject({ method: 'GET', url: `/v1/events/${ids.publishedEvent.slug}` })
    ).json()

    const terms = event.feeTerms.find((entry) => entry.currency === 'INR')

    expect(terms).toEqual({ currency: 'INR', ...pick(feeConfig('INR')) })

    // Priced with those terms and the venue's tax, one General Admission
    // ticket comes to what the order is charged.
    const quote = computeOrderTotals({
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1, unitPriceCents: 150_000 }],
      feeConfig: { ...terms },
      taxRateBps: taxRateBps('IN'),
      currency: 'INR',
    })

    const hold = (
      await app.inject({
        method: 'POST',
        url: '/v1/holds',
        payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
      })
    ).json().data
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: holdHeaders(hold),
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        holdIds: [hold.id],
      },
    })

    expect(placed.json().data.totalCents).toBe(quote.totalCents)
  })

  it('returns an event with its venue, organisation and tiers', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.statusCode).toBe(200)
    const { data } = response.json()
    expect(data.venue.city).toBe('Mumbai')
    expect(data.organization.name).toBe('Rangoli Collective')
    expect(data.ticketTypes.map((tier) => tier.name)).toEqual([
      'General Admission',
      'VIP Table',
      'Early Bird',
    ])
  })

  it('hides a draft from anonymous callers and from another organisation', async () => {
    const { app } = await createTestApp()
    const outsiderToken = await signIn(app, 'rival@dhol.example')

    const anonymous = await app.inject({ method: 'GET', url: '/v1/events/secret-bollywood-night' })
    const outsider = await app.inject({
      method: 'GET',
      url: '/v1/events/secret-bollywood-night',
      headers: bearer(outsiderToken),
    })

    expect(anonymous.statusCode).toBe(404)
    expect(outsider.statusCode).toBe(404)
    // Identical to a genuinely missing event, so slugs cannot be enumerated.
    expect(outsider.json().error.message).toBe(
      (await app.inject({ method: 'GET', url: '/v1/events/no-such-event' })).json().error.message,
    )
  })

  it('shows a draft to a member holding event:view_draft', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'finance@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/events/secret-bollywood-night',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('DRAFT')
  })
})

describe('POST /v1/events', () => {
  /**
   * A valid create payload for the seeded organisation.
   *
   * @param {object} ids Fixture ids.
   * @returns {object} The payload.
   */
  const payload = (ids) => ({
    organizationId: ids.organization.id,
    title: 'Diwali Mela 2027',
    summary: 'A weekend of food, lights and music.',
    description: 'Long-form description of the mela, with stalls and a fireworks finale.',
    category: 'CULTURAL_FESTIVAL',
    startsAt: minutesFromNow(60 * 24 * 200).toISOString(),
    endsAt: minutesFromNow(60 * 24 * 200 + 480).toISOString(),
  })

  it('creates a draft and derives a slug', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: payload(ids),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ slug: 'diwali-mela-2027', status: 'DRAFT' })
  })

  it('refuses an anonymous caller and a caller from another organisation', async () => {
    const { app, ids } = await createTestApp()
    const outsiderToken = await signIn(app, 'rival@dhol.example')

    const anonymous = await app.inject({ method: 'POST', url: '/v1/events', payload: payload(ids) })
    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(outsiderToken),
      payload: payload(ids),
    })

    expect(anonymous.statusCode).toBe(401)
    expect(outsider.statusCode).toBe(403)
    expect(outsider.json().error.code).toBe('FORBIDDEN')
  })

  it('refuses a member whose role lacks event:create', async () => {
    const { app, ids } = await createTestApp()
    const viewerToken = await signIn(app, 'finance@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(viewerToken),
      payload: payload(ids),
    })

    expect(response.statusCode).toBe(403)
  })

  it('rejects a duplicate explicit slug with 409', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: { ...payload(ids), slug: 'navratri-garba-night' },
    })

    expect(response.statusCode).toBe(409)
  })

  it('rejects a window that ends before it starts', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: {
        ...payload(ids),
        startsAt: minutesFromNow(60).toISOString(),
        endsAt: minutesFromNow(30).toISOString(),
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.issues[0].path).toBe('endsAt')
  })
})

describe('PATCH /v1/events/:id and POST /v1/events/:id/publish', () => {
  it('updates a field the caller may change', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers: bearer(token),
      payload: { summary: 'Updated summary for the garba night.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.summary).toBe('Updated summary for the garba night.')
  })

  it('rejects an empty update and a cross-organisation update', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const outsiderToken = await signIn(app, 'rival@dhol.example')

    const empty = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers: bearer(token),
      payload: {},
    })
    const outsider = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers: bearer(outsiderToken),
      payload: { summary: 'Hijacked summary.' },
    })

    expect(empty.statusCode).toBe(400)
    expect(outsider.statusCode).toBe(403)
  })

  it('catches a partial update that would invert the event window', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers: bearer(token),
      // Valid on its own; invalid against the stored startsAt.
      payload: { endsAt: minutesFromNow(60).toISOString() },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  // These two used to send `{ status: 'PUBLISHED' }` to the publish route and
  // expect it to be written. That was finding NF-18: one capability reaching
  // thirteen destinations with no transition check. They are rewritten rather
  // than deleted, because what they were really about — you cannot publish
  // nothing, and a successful publish stamps `publishedAt` — is still true.
  it('refuses to publish a draft that no moderator has approved', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)

    await stepUp(app, 'arun@rangoli.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/publish`,
      headers,
      payload: {},
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/cannot become PUBLISHED/i)
  })

  it('publishes an approved event and stamps publishedAt', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)

    await stepUp(app, 'arun@rangoli.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.approvedEvent.id}/publish`,
      headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('PUBLISHED')
    expect(response.json().data.publishedAt).toEqual(expect.any(String))
  })
})

describe('caller-supplied input never surfaces as a server fault', () => {
  it('answers 422, not 500, for a title no slug can be derived from', async () => {
    // Devanagari, Tamil, Hangul or emoji are perfectly reasonable titles that
    // slugify cannot turn into a URL. That is the caller's problem to solve by
    // supplying a slug, not a server fault.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, ids.manager.email)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: {
        organizationId: ids.organization.id,
        title: '한국 축제 🎉',
        summary: 'Summary',
        description: 'Description',
        category: 'COMEDY',
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2030-01-01T02:00:00.000Z',
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/slug/i)

    await app.close()
  })

  it('accepts such a title when a slug is supplied explicitly', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, ids.manager.email)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: {
        organizationId: ids.organization.id,
        title: '한국 축제 🎉',
        slug: 'korean-festival',
        summary: 'Summary',
        description: 'Description',
        category: 'COMEDY',
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2030-01-01T02:00:00.000Z',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.slug).toBe('korean-festival')

    await app.close()
  })

  it('answers 422 for an unknown venueId rather than letting the foreign key fail', async () => {
    // venueId is caller-controlled. Passing an unknown one to the database
    // turns a bad request into a 500 with a driver error attached.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, ids.manager.email)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: {
        organizationId: ids.organization.id,
        venueId: 'cnosuchvenue000000000zz',
        title: 'A Perfectly Fine Title',
        summary: 'Summary',
        description: 'Description',
        category: 'COMEDY',
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2030-01-01T02:00:00.000Z',
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/no such venue/i)

    await app.close()
  })
})
