import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, holdHeaders, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'

/**
 * Authoring an event: sessions, ticket types, inventory, readiness, pricing.
 *
 * The lifecycle tests are about entitlement — who may move an event from one
 * state to the next. These are about coherence: what an event may contain, and
 * what it may not contain even when the person asking is entitled to ask.
 *
 * Two rules run through all of them. A write that fails validation writes
 * nothing, and a write whose revision precondition has moved is reported rather
 * than resolved by whoever saved last.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-authoring
 */

/** A coherent general-admission session payload. */
const session = (revision, overrides = {}) => ({
  revision,
  startsAt: minutesFromNow(60 * 24 * 40).toISOString(),
  endsAt: minutesFromNow(60 * 24 * 40 + 180).toISOString(),
  timezone: 'Asia/Kolkata',
  capacity: 200,
  ...overrides,
})

/** A coherent general-admission ticket type payload. */
const tier = (revision, overrides = {}) => ({
  revision,
  name: `Tier ${Math.random().toString(36).slice(2, 8)}`,
  priceCents: 50_000,
  quantityTotal: 100,
  ...overrides,
})

/**
 * The event's current revision, which every authoring write must quote back.
 *
 * @param {object} app The Fastify instance.
 * @param {string} eventId The event.
 * @param {object} headers Authenticated headers.
 * @returns {Promise<number>} The revision.
 */
async function revisionOf(app, eventId, headers) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/events/${eventId}/sessions`,
    headers,
  })

  expect(response.statusCode).toBe(200)

  return response.json().meta.revision
}

describe('a session is only valid as a whole', () => {
  it('refuses a session that ends before it starts, and writes nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const before = prisma._store.eventSession.length
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, {
        endsAt: minutesFromNow(60 * 24 * 40 - 60).toISOString(),
      }),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/not coherent/i)
    expect(prisma._store.eventSession.length).toBe(before)

    // The revision did not move either: a refused write is not a write.
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision)

    await app.close()
  })

  it('refuses a time zone that is not an IANA zone', async () => {
    // "Seven o'clock" in a listing read from three time zones is three
    // different moments. A zone the runtime cannot resolve is not a zone.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, { timezone: 'Mars/Olympus_Mons' }),
    })

    expect([400, 422]).toContain(response.statusCode)

    await app.close()
  })

  it('refuses a sales window that closes before it opens', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, {
        salesStartAt: minutesFromNow(60 * 24 * 20).toISOString(),
        salesEndAt: minutesFromNow(60 * 24 * 10).toISOString(),
      }),
    })

    expect(response.statusCode).toBe(422)
    expect(JSON.stringify(response.json())).toMatch(/closes before it opens/i)

    await app.close()
  })

  it('refuses a general-admission session with no capacity', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, { capacity: null }),
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('adds a coherent session and moves the revision by one', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().meta.revision).toBe(revision + 1)
    expect(response.json().data.timezone).toBe('Asia/Kolkata')

    await app.close()
  })
})

describe('the revision precondition', () => {
  it('refuses a write quoting a revision that has moved, and says what it is now', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const stale = await revisionOf(app, ids.draftEvent.id, headers)

    const first = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(stale),
    })

    expect(first.statusCode).toBe(201)

    // The second write quotes the revision the first one replaced.
    const second = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(stale),
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().error.message).toMatch(/somebody else saved/i)

    await app.close()
  })
})

describe('what may be edited, and when', () => {
  it('refuses to edit an event a moderator is reviewing', async () => {
    // Editing under a moderator's nose changes what they are reviewing.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.reviewPendingEvent.id}/sessions`,
      headers,
      payload: session(0),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/withdraw it from review/i)

    await app.close()
  })

  it('refuses to edit a published event through the authoring routes', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/sessions`,
      headers,
      payload: session(0),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/material-change/i)

    await app.close()
  })

  it('refuses an outsider editing somebody else’s draft', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers: bearer(token),
      payload: session(0),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('does not tell a stranger the event exists', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/readiness`,
      headers: bearer(token),
    })

    // 404, not 403: a 403 confirms the id names something.
    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('ticket types', () => {
  it('refuses a general-admission tier with no quantity', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { quantityTotal: 0 }),
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('refuses a reserved tier with no price zone and no session', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { reserved: true, quantityTotal: 0 }),
    })

    expect(response.statusCode).toBe(422)
    expect(JSON.stringify(response.json())).toMatch(/price zone/i)

    await app.close()
  })

  it('refuses a complimentary tier that charges', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { complimentary: true, priceCents: 100 }),
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('refuses a tier naming a session that belongs to another event', async () => {
    // The database refuses this too — finding NF-20 — and this is the sentence
    // that says why in the organiser's terms.
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const otherSession = prisma._store.eventSession.find(
      (row) => row.eventId === ids.publishedEvent.id,
    )

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { eventSessionId: otherSession.id }),
    })

    expect(response.statusCode).toBe(422)
    expect(JSON.stringify(response.json())).toMatch(/different event/i)

    await app.close()
  })

  it('adds a coherent tier', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { name: 'Early bird' }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.name).toBe('Early bird')

    await app.close()
  })
})

describe('publication readiness', () => {
  it('lists every blocker rather than the first', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/readiness`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const body = response.json().data

    expect(body).toHaveProperty('ready')
    expect(body).toHaveProperty('publishable')
    expect(body).toHaveProperty('sellable')
    expect(body).toHaveProperty('inventory')
    expect(body).toHaveProperty('organizerVerified')
    expect(Array.isArray(body.sellable)).toBe(true)

    // The draft has no tier on sale, so it is not ready and says which gate.
    expect(body.ready).toBe(false)
    expect(body.sellable.join(' ')).toMatch(/ticket type/i)

    await app.close()
  })

  it('is not readable by a stranger', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/readiness`,
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('the all-in price preview', () => {
  it('shows face value, fees and the total a buyer is charged', async () => {
    // A face value that becomes something else at the last step of checkout is
    // the practice this preview exists to make hard to ship by accident.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/price-preview`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const rows = response.json().data

    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      expect(row.allInCents).toBe(row.faceValueCents + row.feesCents + row.taxCents)
      expect(row.allInCents).toBeGreaterThanOrEqual(row.faceValueCents)
    }

    await app.close()
  })

  it('quotes exactly what an order for one ticket is charged', async () => {
    // The preview was computed with the pricing package's default fee and no
    // tax, while checkout used the deployment's fee terms and the venue's tax.
    // Held to a real order here, not to a second calculation.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const preview = (
      await app.inject({
        method: 'GET',
        url: `/v1/events/${ids.publishedEvent.id}/price-preview`,
        headers: bearer(token),
      })
    ).json().data
    const quoted = preview.find((row) => row.ticketTypeId === ids.generalAdmission.id)

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

    expect(quoted).toMatchObject({
      faceValueCents: charged.subtotalCents,
      feesCents: charged.feesCents,
      taxCents: charged.taxCents,
      allInCents: charged.totalCents,
    })

    await app.close()
  })
})
