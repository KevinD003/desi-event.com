import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'

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
    const { app } = await createTestApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const body = await list(app, '', bearer(token))

    expect(body.pagination.total).toBe(3)
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
})

describe('GET /v1/events/:slug', () => {
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

  it('refuses to publish an event with no tier on sale', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/publish`,
      headers: bearer(token),
      payload: { status: 'PUBLISHED' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('UNPROCESSABLE')
  })

  it('publishes once a tier is on sale and stamps publishedAt', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const tier = prisma._store.ticketType.find((row) => row.eventId === ids.draftEvent.id)
    tier.status = 'ON_SALE'

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/publish`,
      headers: bearer(token),
      payload: { status: 'PUBLISHED' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('PUBLISHED')
    expect(response.json().data.publishedAt).toEqual(expect.any(String))
  })
})
