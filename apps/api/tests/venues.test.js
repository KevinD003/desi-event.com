/**
 * Venues, and the unusual authorisation model they carry.
 *
 * Most rows in this system belong to one organisation and the rule is "yours or
 * not yours". A venue can also be **shared** — `organizationId` null — and that
 * third state is where the interesting refusals live:
 *
 *   1. An organiser must not be able to edit a hall a hundred other events are
 *      listed at, even though they can list an event there.
 *   2. An organiser must not be able to create a shared venue, or every promoter
 *      would mint one and the accessibility notes would scatter.
 *   3. An organiser must not be able to browse another organisation's private
 *      venue records, even though an attendee holding a ticket can read one by
 *      id — they need the address.
 *   4. A merge must not delete anything, because orders and tickets point at the
 *      row.
 *
 * @module @desi-event/api/tests/venues
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, mfaCodeFor, signIn } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The organisation the fixture members belong to. */
const org = (ids) => ids.organization.id

/** A venue body the create schema accepts. */
const body = (overrides = {}) => ({
  name: 'Jio World Garden',
  addressLine1: 'Bandra Kurla Complex',
  city: 'Mumbai',
  region: 'Maharashtra',
  postalCode: '400051',
  ...overrides,
})

/**
 * A harness whose main organisation has an EVENT_MANAGER, who is the role that
 * holds `venue:manage`.
 *
 * @returns {Promise<object>} The harness plus the manager's email.
 */
async function createVenueApp() {
  const world = await makeWorld()
  const { seed, ids } = world
  const template = seed.user.find((row) => row.email === 'arun@rangoli.example')
  const manager = { ...template, id: cuid(), email: 'venues@rangoli.example' }

  seed.user.push(manager)
  seed.membership.push({
    id: cuid(),
    userId: manager.id,
    organizationId: ids.organization.id,
    role: 'EVENT_MANAGER',
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
  })

  return createTestApp({ seed, ids })
}

/** Platform staff with a fresh step-up, for the merge route. */
async function staff(app, email = 'ops@desi-event.example') {
  const headers = bearer(await signIn(app, email))

  await app.inject({
    method: 'POST',
    url: '/v1/auth/step-up',
    headers,
    payload: { code: mfaCodeFor(app, email) },
  })

  return headers
}

describe('GET /v1/venues', () => {
  it('lists shared venues to an anonymous caller', async () => {
    const { app } = await createVenueApp()

    const response = await app.inject({ method: 'GET', url: '/v1/venues' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((venue) => venue.name)).toContain('Nehru Centre')

    await app.close()
  })

  it('says a venue is shared without naming who owns one that is not', async () => {
    const { app, prisma, ids } = await createVenueApp()

    prisma._store.venue[1].organizationId = org(ids)

    const response = await app.inject({ method: 'GET', url: '/v1/venues' })
    const body = response.body

    expect(response.json().data.every((venue) => venue.shared === true)).toBe(true)
    expect(body).not.toMatch(org(ids))

    await app.close()
  })

  it('shows a member their own organisation private venues', async () => {
    const { app, prisma, ids } = await createVenueApp()

    prisma._store.venue[1].organizationId = org(ids)

    const token = await signIn(app, 'venues@rangoli.example')
    const response = await app.inject({
      method: 'GET',
      url: '/v1/venues',
      headers: bearer(token),
    })

    expect(response.json().data.map((venue) => venue.name)).toContain('Phoenix Hall')

    await app.close()
  })

  it('hides another organisation private venues, and does not count them either', async () => {
    // Counting them would leak their existence through `pagination.total` even
    // though the rows themselves never appear.
    const { app, prisma, ids } = await createVenueApp()

    prisma._store.venue[1].organizationId = org(ids)

    const response = await app.inject({ method: 'GET', url: '/v1/venues' })

    expect(response.json().data.map((venue) => venue.name)).not.toContain('Phoenix Hall')
    expect(response.json().pagination.total).toBe(1)

    await app.close()
  })

  it('filters by accessibility, because a person cannot filter on a paragraph', async () => {
    const { app } = await createVenueApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/venues?accessibility=STEP_FREE_ENTRANCE',
    })

    const names = response.json().data.map((venue) => venue.name)

    expect(names).toContain('Nehru Centre')
    expect(names).not.toContain('Phoenix Hall')

    await app.close()
  })

  it('requires every requested feature, not any of them', async () => {
    const { app } = await createVenueApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/venues?accessibility=STEP_FREE_ENTRANCE&accessibility=HEARING_LOOP',
    })

    // Nehru has step-free and an accessible toilet; Phoenix has a hearing loop.
    // Neither has both, so asking for both is an empty list rather than two.
    expect(response.json().data).toHaveLength(0)

    await app.close()
  })

  it('filters by city without caring about case', async () => {
    const { app } = await createVenueApp()

    const response = await app.inject({ method: 'GET', url: '/v1/venues?city=mumbai' })

    expect(response.json().data.map((venue) => venue.city)).toEqual(['Mumbai'])

    await app.close()
  })

  it('leaves a merged venue out, because it is not somewhere you can choose', async () => {
    const { app, prisma } = await createVenueApp()

    prisma._store.venue[1].mergedIntoVenueId = prisma._store.venue[0].id

    const response = await app.inject({ method: 'GET', url: '/v1/venues' })

    expect(response.json().data.map((venue) => venue.name)).not.toContain('Phoenix Hall')

    await app.close()
  })
})

describe('GET /v1/venues/:id', () => {
  it('reads a venue by id, for somebody holding a ticket to it', async () => {
    const { app, prisma } = await createVenueApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/venues/${prisma._store.venue[0].id}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.name).toBe('Nehru Centre')

    await app.close()
  })

  it('follows a merge to the venue that survived', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue

    duplicate.mergedIntoVenueId = survivor.id

    const response = await app.inject({ method: 'GET', url: `/v1/venues/${duplicate.id}` })

    expect(response.json().data.name).toBe('Nehru Centre')

    await app.close()
  })

  it('refuses to follow a merge chain that does not end', async () => {
    const { app, prisma } = await createVenueApp()
    const [one, two] = prisma._store.venue

    one.mergedIntoVenueId = two.id
    two.mergedIntoVenueId = one.id

    const response = await app.inject({ method: 'GET', url: `/v1/venues/${one.id}` })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('is not found for a venue nobody has', async () => {
    const { app } = await createVenueApp()

    const response = await app.inject({ method: 'GET', url: `/v1/venues/${cuid()}` })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/venues', () => {
  it('lets an event manager create a venue for their own organisation', async () => {
    const { app, ids } = await createVenueApp()
    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body({ organizationId: org(ids) }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ name: 'Jio World Garden', shared: false })
    expect(response.json().data.slug).toBe('jio-world-garden')

    await app.close()
  })

  it('refuses an organiser who asks for a shared venue', async () => {
    // Otherwise every promoter mints their own "Nehru Centre" and the
    // accessibility notes scatter across eleven of them.
    const { app } = await createVenueApp()
    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body(),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('VENUE_SHARED_REQUIRES_STAFF')

    await app.close()
  })

  it('lets platform staff create a shared venue', async () => {
    const { app } = await createVenueApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.shared).toBe(true)

    await app.close()
  })

  it('refuses a venue for an organisation the caller is not in', async () => {
    const { app, prisma, ids } = await createVenueApp()
    const other = prisma._store.organization.find((row) => row.id !== org(ids))

    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body({ organizationId: other.id }),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app, ids } = await createVenueApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      payload: body({ organizationId: org(ids) }),
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('disambiguates a slug rather than colliding', async () => {
    const { app, ids } = await createVenueApp()
    const token = await signIn(app, 'venues@rangoli.example')

    const first = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body({ organizationId: org(ids) }),
    })

    const second = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body({ organizationId: org(ids) }),
    })

    expect(second.statusCode).toBe(201)
    expect(second.json().data.slug).not.toBe(first.json().data.slug)

    await app.close()
  })

  it('refuses a slug somebody already holds', async () => {
    const { app, ids } = await createVenueApp()
    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/venues',
      headers: bearer(token),
      payload: body({ organizationId: org(ids), slug: 'nehru-centre' }),
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })
})

describe('PATCH /v1/venues/:id', () => {
  it('refuses an organiser editing a shared venue', async () => {
    // The sharp end: an organiser can list an event at this hall, and must not
    // be able to rewrite its address for the hundred events already there.
    const { app, prisma } = await createVenueApp()
    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${prisma._store.venue[0].id}`,
      headers: bearer(token),
      payload: { addressLine1: 'Somewhere else entirely' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.venue[0].addressLine1).toBe('1 Worli Sea Face')

    await app.close()
  })

  it('lets an event manager edit their own organisation venue', async () => {
    const { app, prisma, ids } = await createVenueApp()

    prisma._store.venue[1].organizationId = org(ids)

    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${prisma._store.venue[1].id}`,
      headers: bearer(token),
      payload: { capacity: 1800 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.capacity).toBe(1800)

    await app.close()
  })

  it('lets platform staff edit a shared venue', async () => {
    const { app, prisma } = await createVenueApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${prisma._store.venue[0].id}`,
      headers: bearer(token),
      payload: { directions: 'Gate 3 is the step-free entrance; ring the bell.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.directions).toMatch(/Gate 3/)

    await app.close()
  })

  it('refuses a member of another organisation', async () => {
    const { app, prisma, ids } = await createVenueApp()

    prisma._store.venue[1].organizationId = org(ids)

    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${prisma._store.venue[1].id}`,
      headers: bearer(token),
      payload: { capacity: 1 },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an edit to a venue that has been merged away', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue

    duplicate.mergedIntoVenueId = survivor.id

    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${duplicate.id}`,
      headers: bearer(token),
      payload: { capacity: 1 },
    })

    expect(response.statusCode).toBe(409)
    // The refusal names the venue that survived, because "edit the other one"
    // without saying which is a dead end.
    expect(response.json().error.message).toContain(survivor.id)

    await app.close()
  })
})

describe('POST /v1/venues/:id/merge', () => {
  it('points the duplicate at the survivor without deleting anything', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue
    const before = prisma._store.venue.length

    const headers = await staff(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${duplicate.id}/merge`,
      headers,
      payload: { intoVenueId: survivor.id, reason: 'The same hall, listed twice.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.id).toBe(survivor.id)
    // Nothing is deleted: orders and tickets point at the row, and a deleted
    // venue turns somebody's ticket into a booking with no address.
    expect(prisma._store.venue).toHaveLength(before)
    expect(prisma._store.venue.find((v) => v.id === duplicate.id).mergedIntoVenueId).toBe(
      survivor.id,
    )

    await app.close()
  })

  it('repoints unpublished events and leaves published ones where they were', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue

    const published = prisma._store.event.find((event) => event.status === 'PUBLISHED')
    const draft = prisma._store.event.find((event) => event.status === 'DRAFT')

    published.venueId = duplicate.id
    draft.venueId = duplicate.id

    const headers = await staff(app)

    await app.inject({
      method: 'POST',
      url: `/v1/venues/${duplicate.id}/merge`,
      headers,
      payload: { intoVenueId: survivor.id, reason: 'Duplicate' },
    })

    expect(draft.venueId).toBe(survivor.id)
    // A published listing already told people where to go. Rewriting it to tidy
    // a duplicate is not a tidy-up.
    expect(published.venueId).toBe(duplicate.id)

    await app.close()
  })

  it('refuses a merge into itself', async () => {
    const { app, prisma } = await createVenueApp()
    const headers = await staff(app)
    const venue = prisma._store.venue[0]

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${venue.id}/merge`,
      headers,
      payload: { intoVenueId: venue.id, reason: 'Nonsense' },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('refuses a merge into a venue that was itself merged away', async () => {
    const { app, prisma } = await createVenueApp()
    const [one, two] = prisma._store.venue

    two.mergedIntoVenueId = one.id

    const headers = await staff(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${one.id}/merge`,
      headers,
      payload: { intoVenueId: two.id, reason: 'Wrong direction' },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('lets only one of two concurrent merges win', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue
    const headers = await staff(app)

    const merge = () =>
      app.inject({
        method: 'POST',
        url: `/v1/venues/${duplicate.id}/merge`,
        headers,
        payload: { intoVenueId: survivor.id, reason: 'Duplicate' },
      })

    const [first, second] = await Promise.all([merge(), merge()])
    const statuses = [first.statusCode, second.statusCode].sort()

    expect(statuses).toEqual([200, 409])

    await app.close()
  })

  it('refuses an organiser, however senior', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue

    const token = await signIn(app, 'venues@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${duplicate.id}/merge`,
      headers: bearer(token),
      payload: { intoVenueId: survivor.id, reason: 'Let me tidy up' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.venue[1].mergedIntoVenueId).toBeNull()

    await app.close()
  })

  it('records who merged what, and why', async () => {
    const { app, prisma } = await createVenueApp()
    const [survivor, duplicate] = prisma._store.venue
    const headers = await staff(app)

    await app.inject({
      method: 'POST',
      url: `/v1/venues/${duplicate.id}/merge`,
      headers,
      payload: { intoVenueId: survivor.id, reason: 'Same hall, two records' },
    })

    const entry = prisma._store.auditLog.find((row) => row.action === 'venue.merged')

    expect(entry).toMatchObject({ entityId: duplicate.id })
    expect(entry.metadata).toMatchObject({ intoVenueId: survivor.id })
    expect(entry.metadata.reason).toMatch(/two records/)

    await app.close()
  })
})
