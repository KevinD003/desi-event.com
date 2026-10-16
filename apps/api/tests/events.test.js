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
import { reservedWorld } from './helpers/reserved-world.js'
import { EVENT_SUMMARY_SELECT, toEventSummary } from '../src/lib/presenters.js'
import { buildEventQuery, resolveSearchTerms, searchTerms } from '../src/routes/events.js'

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
      // The approved cover and gallery: public by the moderator's decision,
      // and absent until one is made.
      'coverImage',
      'createdAt',
      'description',
      // The event page's own content, public because the organiser chose to
      // publish it. The contact is the one typed into the public contact
      // fields, never the private `contactEmail` (NF-14, asserted below).
      'directions',
      'dressCode',
      'endsAt',
      'faq',
      // The booking fee is part of the price; see `feeTerms` in the schema.
      'feeTerms',
      'gallery',
      'id',
      // Where an imported event is listed and its prices there (SPEC2-XI
      // §5.I-E); null for an organiser's own event, as here.
      'importedFrom',
      'isOnline',
      'languages',
      // No `onlineUrl`: an online event's joining link is its ticket holders'
      // (`onlineJoinUrl` on the ticket) and its organiser's, never a
      // stranger's. The key itself is absent from the public payload.
      'organization',
      'organizationId',
      'performers',
      'policies',
      'previousStartsAt',
      'publicEmail',
      'publicPhone',
      'publishedAt',
      'revision',
      'runningOrder',
      // The event's nights, with their labels, times and sales windows.
      'sessions',
      'slug',
      'socialLinks',
      'sponsors',
      'startsAt',
      'status',
      'summary',
      'ticketTypes',
      'timezone',
      'title',
      'updatedAt',
      'venue',
      'venueId',
      // Whether buyers may pay the ticket price at the door now, and nothing
      // else about the switch (SPEC3 §9.2, §11.3): an anonymous reader never
      // gets the event's `paymentTerms`.
      'venuePayment',
      // Where "Visit the organiser's website" goes, as a host, or null. Never
      // the address: no `websiteUrl` and no `websiteRedirect` (the switch, with
      // the deciding administrator's name) for a stranger; both keys absent.
      'websiteLink',
    ])
    expect(response.json().data).not.toHaveProperty('websiteUrl')
    expect(response.json().data).not.toHaveProperty('websiteRedirect')

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

  it('filters by country, state and city together, in any case', async () => {
    const { app } = await createTestApp()

    // Both listed events' venues are in Maharashtra, India: one in Mumbai,
    // one in Pune.
    const slugs = async (query) => (await list(app, query)).data.map((event) => event.slug).sort()
    const both = ['classical-dance-masterclass', 'navratri-garba-night']

    expect(await slugs('country=IN')).toEqual(both)
    expect(await slugs('country=US')).toEqual([])
    expect(await slugs('region=maharashtra')).toEqual(both)
    expect(await slugs('region=MAHARASHTRA&city=mumbai')).toEqual(['navratri-garba-night'])
    expect(await slugs('region=Maharashtra&city=Pune')).toEqual(['classical-dance-masterclass'])
    // The city exists, but not in that state: one venue condition, not two.
    expect(await slugs('region=TX&city=Mumbai')).toEqual([])
    expect(await slugs('country=CA&region=Maharashtra')).toEqual([])
  })

  it('says each card’s state and country', async () => {
    const { app, prisma, ids } = await createTestApp()
    const online = await prisma.event.findFirst({ where: { slug: 'classical-dance-masterclass' } })

    // Streamed from nowhere in particular: no venue, so no place.
    await prisma.event.update({ where: { id: online.id }, data: { venueId: null } })
    expect(ids.publishedEvent.slug).toBe('navratri-garba-night')

    const cards = (await list(app)).data
    const garba = cards.find((event) => event.slug === 'navratri-garba-night')
    const streamed = cards.find((event) => event.slug === 'classical-dance-masterclass')

    expect(garba).toMatchObject({ city: 'Mumbai', region: 'MAHARASHTRA', country: 'IN' })
    expect(streamed).toMatchObject({ city: null, region: null, country: null })
  })

  it('filters by language without regard to case', async () => {
    const { app } = await createTestApp()

    for (const language of ['Hindi', 'hindi', 'HINDI']) {
      const body = await list(app, `language=${language}`)
      expect(body.data.map((event) => event.slug)).toContain('navratri-garba-night')
      expect(body.data.every((event) => event.slug !== 'secret-bollywood-night')).toBe(true)
    }
    expect((await list(app, 'language=Klingon')).data).toEqual([])
    // A part of a language is not the language.
    expect((await list(app, 'language=Hin')).data).toEqual([])
  })

  it('finds free events by the rule the card’s price uses', async () => {
    const { app, prisma, ids } = await createTestApp()
    const isFree = async () =>
      (await list(app, 'free=true')).data.some((event) => event.slug === 'navratri-garba-night')

    expect(await isFree()).toBe(false)

    const tiers = await prisma.ticketType.findMany({ where: { eventId: ids.publishedEvent.id } })
    const onSale = tiers.filter((tier) => tier.status === 'ON_SALE')
    const other = tiers.find((tier) => tier.status !== 'ON_SALE')

    // A $0 tier that is not on sale does not make an event with paid tiers on
    // sale free: its card's price is the cheapest tier on sale.
    await prisma.ticketType.update({ where: { id: other.id }, data: { priceCents: 0 } })
    expect(await isFree()).toBe(false)

    // A hidden $0 guest list is no price anybody can pay. Hiding the only tier
    // on sale leaves none on sale, and then the cheapest public tier — the $0
    // one not on sale — is the card's price; with another tier still on sale,
    // that one is.
    await prisma.ticketType.update({
      where: { id: onSale[0].id },
      data: { priceCents: 0, visibility: 'HIDDEN' },
    })
    expect(await isFree()).toBe(onSale.length === 1)

    // A public $0 tier on sale does, and the card says $0.
    await prisma.ticketType.update({
      where: { id: onSale[0].id },
      data: { priceCents: 0, visibility: 'PUBLIC' },
    })
    expect(await isFree()).toBe(true)
    const [card] = (await list(app, 'free=true&q=garba')).data
    expect(card.minPriceCents).toBe(0)
    // free=false is no filter at all.
    expect((await list(app, 'free=false')).pagination.total).toBe(
      (await list(app)).pagination.total,
    )
  })

  it('finds events with nothing on sale as free when their cheapest public tier is $0', async () => {
    const { app, prisma, ids } = await createTestApp()
    const tiers = await prisma.ticketType.findMany({ where: { eventId: ids.publishedEvent.id } })

    for (const tier of tiers) {
      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { status: 'DRAFT', priceCents: tier === tiers[0] ? 0 : tier.priceCents },
      })
    }

    const [card] = (await list(app, 'free=true&q=garba')).data
    expect(card?.slug).toBe('navratri-garba-night')
    expect(card.minPriceCents).toBe(0)
  })

  it('filters to events on sale now', async () => {
    const { app, prisma, ids } = await createTestApp()

    expect((await list(app, 'onSale=true')).data).toEqual([])

    await prisma.event.update({ where: { id: ids.publishedEvent.id }, data: { status: 'ON_SALE' } })

    expect((await list(app, 'onSale=true')).data.map((event) => event.slug)).toEqual([
      'navratri-garba-night',
    ])
    expect((await list(app, 'onSale=false')).pagination.total).toBe(2)
  })

  it('reads fromDate and toDate as days where each event happens', async () => {
    const { app, prisma, ids } = await createTestApp()

    // 23:30 in Kolkata on 17 October is 18:00 UTC; the same instant is the
    // 17th in Kolkata and in London alike, so move it to 01:00 on the 18th in
    // Kolkata, which is still the 17th in UTC.
    await prisma.event.update({
      where: { id: ids.publishedEvent.id },
      data: {
        startsAt: new Date('2031-10-17T19:30:00.000Z'),
        endsAt: new Date('2031-10-17T23:30:00.000Z'),
      },
    })

    const slugs = async (query) => (await list(app, query)).data.map((event) => event.slug)

    expect(await slugs('fromDate=2031-10-18&toDate=2031-10-18')).toEqual(['navratri-garba-night'])
    expect(await slugs('fromDate=2031-10-17&toDate=2031-10-17')).toEqual([])
    expect(await slugs('fromDate=2031-10-18')).toEqual(['navratri-garba-night'])
    expect(await slugs('toDate=2031-10-17')).not.toContain('navratri-garba-night')

    const backwards = await app.inject({
      method: 'GET',
      url: '/v1/events?fromDate=2031-10-18&toDate=2031-10-17',
    })
    expect(backwards.statusCode).toBe(400)
    expect(backwards.json().error.issues[0].path).toBe('toDate')
  })

  it('takes a named span of days and refuses one it does not know', async () => {
    const { app } = await createTestApp()

    expect((await list(app, 'when=month')).data).toBeInstanceOf(Array)

    const unknown = await app.inject({ method: 'GET', url: '/v1/events?when=tonight' })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json().error.issues[0].path).toBe('when')
  })

  it('still refuses a price sort', async () => {
    const { app } = await createTestApp()
    const response = await app.inject({ method: 'GET', url: '/v1/events?sort=price:asc&free=true' })

    expect(response.statusCode).toBe(400)
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

  it('tells the same total from a last page, a page past the end and an empty search', async () => {
    const { app, prisma } = await createTestApp()
    const count = prisma.event.count
    let counted = 0

    prisma.event.count = (args) => {
      counted += 1

      return count(args)
    }

    // A page that is not full shows where the list ends; a page past the end
    // does not, and is counted. Either way the total is the listing's.
    const last = await list(app, 'page=1&perPage=5')
    const beyond = await list(app, 'page=2&perPage=5')
    const nothing = await list(app, 'q=zzzznomatch')

    expect(last.data).toHaveLength(2)
    expect(last.pagination).toMatchObject({ total: 2, totalPages: 1, hasNextPage: false })
    expect(beyond.data).toEqual([])
    expect(beyond.pagination).toMatchObject({ total: 2, totalPages: 1, hasNextPage: false })
    expect(nothing.data).toEqual([])
    expect(nothing.pagination).toMatchObject({ total: 0, hasNextPage: false })
    // Only the page past the end needed a count of its own.
    expect(counted).toBe(1)

    await app.close()
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

  it.each([
    ['a NUL in the search', 'q=gar%00ba'],
    ['a NUL in the city', 'city=Edi%00son'],
    ['a tab in the search', 'q=gar%09ba'],
    ['a C1 control in the search', 'q=gar%C2%85ba'],
  ])('answers 400 for %s, which PostgreSQL would refuse as a 500', async (_label, query) => {
    const { app } = await createTestApp()
    const response = await app.inject({ method: 'GET', url: `/v1/events?${query}` })

    expect(response.statusCode, response.body).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
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

/**
 * A whole event row, as `include: {venue, organization, ticketTypes, media}`
 * returned it: every column, the long and private ones included.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function wholeEventRow(overrides = {}) {
  const startsAt = new Date('2031-11-07T00:30:00.000Z')
  const tier = (fields) => ({
    eventId: 'cevent0000000000000000001',
    description: 'A long tier description nobody puts on a card.',
    minPerOrder: 1,
    maxPerOrder: 10,
    sortOrder: 0,
    createdAt: new Date('2031-01-01T00:00:00.000Z'),
    updatedAt: new Date('2031-01-01T00:00:00.000Z'),
    eventSessionId: null,
    priceZoneId: null,
    complimentary: false,
    refundedQuantity: 0,
    refundedCents: 0,
    visibility: 'PUBLIC',
    reserved: false,
    salesStartAt: null,
    salesEndAt: null,
    ...fields,
  })

  return {
    id: 'cevent0000000000000000001',
    organizationId: 'corg00000000000000000001',
    venueId: 'cvenue000000000000000001',
    title: 'Navratri Garba Night',
    slug: 'navratri-garba-night',
    summary: 'Nine nights of garba.',
    description: 'A description far longer than any card.'.repeat(50),
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    timezone: 'America/Chicago',
    isOnline: false,
    onlineUrl: 'https://meet.example.com/private-room',
    languages: ['Gujarati'],
    publishedAt: new Date('2031-01-02T00:00:00.000Z'),
    createdAt: new Date('2031-01-01T00:00:00.000Z'),
    updatedAt: new Date('2031-01-02T00:00:00.000Z'),
    revision: 7,
    ageRestriction: null,
    accessibility: null,
    artists: ['Falguni'],
    policies: null,
    contactEmail: 'private-contact@example.com',
    reviewSubmittedAt: null,
    moderationNote: 'A note for the organiser only.',
    cancelledAt: null,
    cancellationReason: null,
    postponedAt: null,
    previousStartsAt: null,
    salesOpenedAt: new Date('2031-01-03T00:00:00.000Z'),
    faq: [{ question: 'Parking?', answer: 'Yes.' }],
    performers: [{ name: 'Falguni', role: null, bio: null }],
    runningOrder: null,
    sponsors: null,
    socialLinks: null,
    dressCode: 'Chaniya choli',
    directions: 'Gate 3.',
    publicContactEmail: 'hello@example.com',
    publicContactPhone: null,
    venue: {
      id: 'cvenue000000000000000001',
      name: 'Garba Ground',
      slug: 'garba-ground',
      addressLine1: '1 Main Street',
      addressLine2: null,
      city: 'Houston',
      region: 'TX',
      postalCode: '77001',
      country: 'US',
      description: 'A long venue description.',
      timezone: 'America/Chicago',
      directions: 'Park at the back.',
      policies: null,
      accessibility: null,
      organizationId: 'corg00000000000000000001',
    },
    organization: {
      id: 'corg00000000000000000001',
      name: 'Rangoli Collective',
      slug: 'rangoli-collective',
      description: 'An organiser.',
      contactEmail: 'account@example.com',
      payoutCurrency: 'USD',
      verified: true,
      verificationStatus: 'VERIFIED',
    },
    ticketTypes: [
      tier({
        id: 'ctier0000000000000000001',
        name: 'General',
        priceCents: 2_500,
        currency: 'USD',
        quantityTotal: 100,
        quantitySold: 40,
        status: 'ON_SALE',
      }),
      // Cheaper, but a guest list: never the card's price.
      tier({
        id: 'ctier0000000000000000002',
        name: 'Guest list',
        priceCents: 0,
        currency: 'USD',
        quantityTotal: 20,
        quantitySold: 0,
        status: 'ON_SALE',
        visibility: 'HIDDEN',
      }),
      // Not on sale until next year.
      tier({
        id: 'ctier0000000000000000003',
        name: 'Late',
        priceCents: 3_500,
        currency: 'USD',
        quantityTotal: 50,
        quantitySold: 0,
        status: 'ON_SALE',
        salesStartAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
      // Seated: its stock is its seats, not its quantity columns.
      tier({
        id: 'ctier0000000000000000004',
        name: 'Stalls',
        priceCents: 4_000,
        currency: 'USD',
        quantityTotal: 0,
        quantitySold: 0,
        status: 'ON_SALE',
        reserved: true,
      }),
    ],
    media: [
      {
        id: 'cmedia000000000000000001',
        kind: 'EVENT_COVER',
        position: null,
        altText: 'Dancers in a circle',
        width: 1600,
        height: 900,
        contentType: 'image/jpeg',
        moderationStatus: 'APPROVED',
        scanStatus: 'CLEAN',
        sanitisedAt: new Date('2031-01-02T00:00:00.000Z'),
        createdAt: new Date('2031-01-02T00:00:00.000Z'),
      },
    ],
    ...overrides,
  }
}

/**
 * Keep only what a Prisma `select` names, the way Prisma answers one.
 *
 * @param {object} row A whole row.
 * @param {object} select The select.
 * @returns {object} The row as the select would load it.
 */
function projected(row, select) {
  const out = {}

  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue

    const value = row[key]

    if (spec === true || value == null) {
      out[key] = value ?? null
      continue
    }

    out[key] = Array.isArray(value)
      ? value.map((child) => projected(child, spec.select))
      : projected(value, spec.select)
  }

  return out
}

/**
 * Every path a select loads, as `venue.city` or `ticketTypes[].status`.
 *
 * @param {object} select The select.
 * @param {string} [prefix] The path so far.
 * @returns {Set<string>} The paths.
 */
function selectedPaths(select, prefix = '') {
  const paths = new Set()

  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue

    const path = `${prefix}${key}`
    paths.add(path)

    if (spec !== true) {
      const many = key === 'ticketTypes' || key === 'media'
      for (const nested of selectedPaths(spec.select, `${path}${many ? '[]' : ''}.`)) {
        paths.add(nested)
      }
    }
  }

  return paths
}

/**
 * Wrap a row so that every field read from it, at any depth, is recorded.
 *
 * @param {unknown} value The row, or a value inside it.
 * @param {string} path Where it sits in the row.
 * @param {Set<string>} reads Collects the paths read.
 * @returns {unknown} The value, wrapped when it is an object.
 */
function watched(value, path, reads) {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value

  return new Proxy(value, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver)

      if (typeof key === 'symbol') return result

      if (Array.isArray(target)) {
        return /^\d+$/.test(key) ? watched(result, `${path}[]`, reads) : result
      }

      const next = path ? `${path}.${key}` : key
      reads.add(next)

      return watched(result, next, reads)
    },
  })
}

describe('a listing card reads the columns it shows, and no others', () => {
  const now = new Date('2031-06-01T12:00:00.000Z')
  const options = { feeConfigFor: () => feeConfig('USD'), now }
  const variants = [
    wholeEventRow(),
    wholeEventRow({ venue: null, venueId: null, isOnline: true, media: [] }),
    wholeEventRow({ status: 'SALES_PAUSED' }),
    wholeEventRow({
      ticketTypes: wholeEventRow().ticketTypes.map((tier) => ({
        ...tier,
        quantitySold: tier.quantityTotal,
      })),
    }),
    wholeEventRow({ ticketTypes: [] }),
  ]

  it('finds every field the summary reads in EVENT_SUMMARY_SELECT', () => {
    // Read tracking rather than a list kept by hand: a field the presenter
    // starts reading and the select does not load fails here, not on a card.
    const allowed = selectedPaths(EVENT_SUMMARY_SELECT)
    const reads = new Set()

    for (const row of variants) {
      toEventSummary(watched(row, '', reads), options)
      toEventSummary(watched(row, '', reads))
    }

    expect([...reads].filter((path) => !allowed.has(path))).toEqual([])
  })

  it('gives the same card from the selected columns as from the whole row', () => {
    for (const row of variants) {
      expect(toEventSummary(projected(row, EVENT_SUMMARY_SELECT), options)).toEqual(
        toEventSummary(row, options),
      )
      expect(toEventSummary(projected(row, EVENT_SUMMARY_SELECT))).toEqual(toEventSummary(row))
    }
  })

  it('loads none of the long or private columns a card never shows', () => {
    const loaded = selectedPaths(EVENT_SUMMARY_SELECT)

    for (const path of [
      'description',
      'contactEmail',
      'moderationNote',
      'onlineUrl',
      'faq',
      'performers',
      'runningOrder',
      'sponsors',
      'socialLinks',
      'publicContactEmail',
      'venue.description',
      'venue.addressLine1',
      'organization.contactEmail',
      'organization.payoutCurrency',
      'ticketTypes[].description',
    ]) {
      expect(loaded.has(path), path).toBe(false)
    }
  })

  it('is what GET /v1/events and the review queue ask the database for', async () => {
    const { app, prisma } = await createTestApp()
    const asked = []
    const findMany = prisma.event.findMany

    prisma.event.findMany = (args) => {
      asked.push(args)

      return findMany(args)
    }

    await list(app, 'q=garba')
    await app.inject({
      method: 'GET',
      url: '/v1/moderation/events',
      headers: bearer(await signIn(app, 'maya@desi-event.example')),
    })

    const listings = asked.filter((args) => args?.select === EVENT_SUMMARY_SELECT)

    expect(listings).toHaveLength(2)
    expect(listings.every((args) => args.include === undefined)).toBe(true)

    await app.close()
  })
})

describe('buildEventQuery', () => {
  const base = { page: 1, perPage: 20, sort: 'startsAt:asc' }

  /**
   * The conditions a query adds after the visibility and status ones.
   *
   * @param {object} query The parsed query.
   * @param {object} [options] `buildEventQuery` options.
   * @returns {object[]} The extra conditions.
   */
  const extra = (query, options) =>
    buildEventQuery({ ...base, ...query }, null, options).where.AND.slice(2)

  it('puts country, state and city in one venue condition', () => {
    expect(extra({ country: 'US', region: 'IL', city: 'Springfield' })).toEqual([
      {
        venue: {
          // In any case, so a venue stored as `us` before codes were stored
          // in capitals is still found under United States.
          country: { equals: 'US', mode: 'insensitive' },
          region: { equals: 'IL', mode: 'insensitive' },
          city: { equals: 'Springfield', mode: 'insensitive' },
        },
      },
    ])
  })

  it('escapes a region before it is matched as ILIKE', () => {
    expect(extra({ region: 'T_' })).toEqual([
      { venue: { region: { equals: 'T\\_', mode: 'insensitive' } } },
    ])
  })

  it('matches a language by its stored spellings, and finds nothing for none', () => {
    expect(extra({ language: 'hindi' }, { languages: ['Hindi', 'HINDI'] })).toEqual([
      { languages: { hasSome: ['Hindi', 'HINDI'] } },
    ])
    expect(extra({ language: 'hindi' }, { languages: [] })).toEqual([{ id: { in: [] } }])
    // Unresolved, the value is matched as given.
    expect(extra({ language: 'Hindi' })).toEqual([{ languages: { has: 'Hindi' } }])
  })

  it('says free the way the card price does, and on sale as ON_SALE', () => {
    const [free] = extra({ free: true })
    const publicTier = { visibility: { not: 'HIDDEN' } }

    expect(free).toEqual({
      OR: [
        { ticketTypes: { some: { ...publicTier, status: 'ON_SALE', priceCents: 0 } } },
        {
          AND: [
            { ticketTypes: { none: { ...publicTier, status: 'ON_SALE' } } },
            { ticketTypes: { some: { ...publicTier, priceCents: 0 } } },
          ],
        },
      ],
    })
    expect(extra({ onSale: true })).toEqual([{ status: 'ON_SALE' }])
    expect(extra({ free: false, onSale: false })).toEqual([])
  })

  it('reads a day range once per timezone', () => {
    const [condition] = extra(
      { fromDate: '2026-10-17', toDate: '2026-10-17' },
      { zones: ['America/Chicago', 'America/Toronto', 'America/Chicago'] },
    )

    expect(condition).toEqual({
      OR: [
        {
          timezone: 'America/Chicago',
          startsAt: {
            gte: new Date('2026-10-17T05:00:00.000Z'),
            lt: new Date('2026-10-18T05:00:00.000Z'),
          },
        },
        {
          timezone: 'America/Toronto',
          startsAt: {
            gte: new Date('2026-10-17T04:00:00.000Z'),
            lt: new Date('2026-10-18T04:00:00.000Z'),
          },
        },
      ],
    })
    // A named span is read at the moment given.
    const [today] = extra(
      { when: 'today' },
      { zones: ['America/Toronto'], now: new Date('2026-10-17T03:00:00.000Z') },
    )
    expect(today).toEqual({
      OR: [
        {
          timezone: 'America/Toronto',
          startsAt: {
            gte: new Date('2026-10-16T04:00:00.000Z'),
            lt: new Date('2026-10-17T04:00:00.000Z'),
          },
        },
      ],
    })
    // With no event in any zone, a date filter finds nothing.
    expect(extra({ fromDate: '2026-10-17' }, { zones: [] })).toEqual([{ id: { in: [] } }])
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

describe('GET /v1/events/:slug: the online joining link and the nights', () => {
  it('never gives an anonymous caller an online event’s joining link', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.onlineEvent.slug}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.isOnline).toBe(true)
    expect(response.json().data).not.toHaveProperty('onlineUrl')
    // Not under any other key either.
    expect(response.body).not.toContain(ids.onlineEvent.onlineUrl)

    await app.close()
  })

  it('does not give it to a signed-in buyer who holds no ticket either', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.onlineEvent.slug}`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain(ids.onlineEvent.onlineUrl)

    await app.close()
  })

  it('still gives the organiser’s own team the link, for the editor', async () => {
    const { app, ids } = await createTestApp()
    // The online event belongs to the other organisation, whose owner this is.
    const headers = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.onlineEvent.slug}`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.onlineUrl).toBe(ids.onlineEvent.onlineUrl)

    // A member of a different organisation is a stranger here.
    const outsider = bearer(await signIn(app, 'arun@rangoli.example'))
    const refused = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.onlineEvent.slug}`,
      headers: outsider,
    })
    expect(refused.body).not.toContain(ids.onlineEvent.onlineUrl)

    await app.close()
  })

  it('lists the nights soonest first, with their labels, doors and zone; tiers name theirs', async () => {
    const { app, prisma, ids } = await createTestApp()
    const first = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    const second = {
      ...first,
      id: 'ckseconds0000000000000000',
      label: 'Night 1',
      startsAt: minutesFromNow(60 * 24 * 5),
      endsAt: minutesFromNow(60 * 24 * 5 + 240),
      doorsOpenAt: minutesFromNow(60 * 24 * 5 - 30),
      timezone: 'America/Chicago',
      sortOrder: 0,
    }
    prisma._store.eventSession.push(second)
    first.label = '  Night 2  '
    first.sortOrder = 1

    await prisma.ticketType.update({
      where: { id: ids.vip.id },
      data: { eventSessionId: second.id },
    })

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.statusCode).toBe(200)

    const { sessions, ticketTypes } = response.json().data
    expect(sessions.map((session) => session.id)).toEqual([second.id, first.id])
    expect(sessions[0]).toEqual({
      id: second.id,
      label: 'Night 1',
      startsAt: second.startsAt.toISOString(),
      endsAt: second.endsAt.toISOString(),
      doorsOpenAt: second.doorsOpenAt.toISOString(),
      timezone: 'America/Chicago',
      status: 'SCHEDULED',
      salesStartAt: null,
      salesEndAt: null,
      hasSeatMap: false,
      seatsAvailable: null,
      // An organiser's night lists its end; only an imported one may not.
      endTimeListed: true,
    })
    // A label is trimmed, never padded out to the page.
    expect(sessions[1].label).toBe('Night 2')

    const vip = ticketTypes.find((tier) => tier.id === ids.vip.id)
    const general = ticketTypes.find((tier) => tier.id === ids.generalAdmission.id)
    expect(vip.eventSessionId).toBe(second.id)
    expect(general.eventSessionId ?? null).toBeNull()

    await app.close()
  })

  it('counts a seated night’s free seats that a tier sells, and no others', async () => {
    const { app, prisma, ids } = await createTestApp()
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    session.venueMapVersionId = 'ckmapversion0000000000000'
    session.capacity = null

    const seat = (status, ticketTypeId) => ({
      id: `ckseat${Math.random().toString(36).slice(2, 12).padEnd(19, '0')}`,
      eventSessionId: session.id,
      seatId: `cksid${Math.random().toString(36).slice(2, 12).padEnd(20, '0')}`,
      ticketTypeId,
      status,
    })

    prisma._store.eventSeat.push(
      seat('AVAILABLE', ids.generalAdmission.id),
      seat('AVAILABLE', ids.generalAdmission.id),
      seat('AVAILABLE', null),
      seat('SOLD', ids.generalAdmission.id),
    )

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    const [night] = response.json().data.sessions

    expect(night).toMatchObject({ hasSeatMap: true, seatsAvailable: 2 })

    await app.close()
  })
})

describe('GET /v1/events/:slug, for a night sold by zone', () => {
  /**
   * Read the event page's payload.
   *
   * @param {object} world From `reservedWorld`.
   * @param {object} [headers] Request headers.
   * @returns {Promise<object>} The event's `data`.
   */
  async function page(world, headers = {}) {
    const response = await world.app.inject({
      method: 'GET',
      url: `/v1/events/${world.ids.publishedEvent.slug}`,
      headers,
    })

    expect(response.statusCode).toBe(200)

    return response.json().data
  }

  it('gives each zone’s tier its own free seats, so a sold-out zone reads sold out', async () => {
    const world = await reservedWorld({
      statuses: { A1: 'SOLD', A2: 'SOLD', A3: 'HELD' },
    })

    const data = await page(world)
    const night = data.sessions.find((session) => session.id === world.sessionId)
    const front = data.ticketTypes.find((tier) => tier.id === world.frontTier.id)
    const back = data.ticketTypes.find((tier) => tier.id === world.backTier.id)

    expect(front).toMatchObject({ availableQuantity: 0, isSoldOut: true })
    expect(back).toMatchObject({ availableQuantity: 3, isSoldOut: false })
    expect(night).toMatchObject({ hasSeatMap: true, seatsAvailable: 3 })

    // General admission is still counted where it always was, not here.
    const general = data.ticketTypes.find((tier) => tier.id === world.ids.generalAdmission.id)
    expect(general).not.toHaveProperty('availableQuantity')

    await world.app.close()
  })

  it('counts no seat of a draft or hidden tier for a stranger, and names neither', async () => {
    const world = await reservedWorld({
      front: { status: 'DRAFT' },
      back: { visibility: 'HIDDEN' },
    })

    const data = await page(world)
    const night = data.sessions.find((session) => session.id === world.sessionId)

    // The seat map offers this stranger nothing, and the page says the same.
    expect(night).toMatchObject({ hasSeatMap: true, seatsAvailable: 0 })
    expect(data.ticketTypes.map((tier) => tier.id)).not.toContain(world.frontTier.id)
    expect(data.ticketTypes.map((tier) => tier.id)).not.toContain(world.backTier.id)

    const map = await world.app.inject({
      method: 'GET',
      url: `/v1/sessions/${world.sessionId}/seats`,
    })
    expect(map.json().data.counts.available).toBe(night.seatsAvailable)

    // The organiser is shown both tiers, each with its own seats.
    const headers = bearer(await signIn(world.app, 'arun@rangoli.example'))
    const inside = await page(world, headers)
    expect(inside.ticketTypes.find((tier) => tier.id === world.frontTier.id)).toMatchObject({
      availableQuantity: 3,
    })
    expect(inside.ticketTypes.find((tier) => tier.id === world.backTier.id)).toMatchObject({
      availableQuantity: 3,
    })

    await world.app.close()
  })

  it('leaves a tier outside its sales window out of the night’s count, without calling it sold out', async () => {
    const world = await reservedWorld({ back: { salesStartAt: minutesFromNow(60) } })

    const data = await page(world)
    const night = data.sessions.find((session) => session.id === world.sessionId)
    const back = data.ticketTypes.find((tier) => tier.id === world.backTier.id)

    // Only the Front seats can be had now; the Back tier still has its three.
    expect(night.seatsAvailable).toBe(3)
    expect(back).toMatchObject({ availableQuantity: 3, isSoldOut: false })

    const map = await world.app.inject({
      method: 'GET',
      url: `/v1/sessions/${world.sessionId}/seats`,
    })
    expect(map.json().data.counts.available).toBe(night.seatsAvailable)

    await world.app.close()
  })
})
