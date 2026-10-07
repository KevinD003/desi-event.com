import { describe, expect, it } from 'vitest'

import { endTimeListedAfter } from '../src/lib/event-authoring.js'
import { bearer, createTestApp, holdHeaders, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

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

  // Replaces "refuses to edit a published event through the authoring routes":
  // a live event now takes the edits that cannot take anything away from a
  // buyer, a new night among them. What stays refused is below.
  it('adds a session to a published event', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.publishedEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/sessions`,
      headers,
      payload: session(revision),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().meta.revision).toBe(revision + 1)

    const audit = prisma._store.auditLog.filter((row) => row.action === 'event.session_added')

    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({
      sessionId: response.json().data.id,
      revision: revision + 1,
      mode: 'live',
    })
    expect(audit[0].metadata.fields).toContain('startsAt')

    await app.close()
  })

  it.each([
    ['approvedEvent', 'APPROVED', /moderator holds this version/i],
    ['rejectedEvent', 'REJECTED', /rework it as a draft/i],
  ])('refuses authoring on an %s (409 NOT_EDITABLE)', async (key, _status, message) => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids[key].id}/sessions`,
      headers: bearer(token),
      payload: session(0),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_EDITABLE')
    expect(response.json().error.message).toMatch(message)

    await app.close()
  })

  it('refuses authoring on a cancelled event, which is final', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'CANCELLED'

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/tiers`,
      headers: bearer(token),
      payload: tier(0),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_EDITABLE')
    expect(response.json().error.message).toMatch(/final/i)

    await app.close()
  })

  // SPEC2-XI X-8 and X-12: a deleted event is not final, because the Desi-Event
  // team can restore it; the refusal says what to do instead.
  it('refuses authoring on a deleted event and says the Desi-Event team restores it, not that it is final', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    Object.assign(
      prisma._store.event.find((row) => row.id === ids.publishedEvent.id),
      {
        status: 'DELETED',
        deletedAt: new Date(),
        deletionReason: 'The venue withdrew the booking before any ticket was sold.',
        deletionOutcome: 'REMOVED',
        deletionAuthority: 'ORGANIZATION',
        statusBeforeDeletion: 'PUBLISHED',
      },
    )

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/tiers`,
      headers: bearer(token),
      payload: tier(0),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_EDITABLE')
    expect(response.json().error.message).toBe(
      'This event was deleted. Ask the Desi-Event team to restore it before changing it.',
    )

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

  // The database refuses a complimentary tier that is not HIDDEN
  // (ticket_type_complimentary_free_and_hidden), and the stub models no CHECKs,
  // so the stored row is the assertion.
  it('stores a free complimentary tier HIDDEN when no visibility is given', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { name: 'Guest list', complimentary: true, priceCents: 0 }),
    })

    expect(response.statusCode).toBe(201)

    const stored = prisma._store.ticketType.find((row) => row.id === response.json().data.id)

    expect(stored.complimentary).toBe(true)
    expect(stored.visibility).toBe('HIDDEN')

    await app.close()
  })

  it('stores an ordinary tier PUBLIC', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { priceCents: 0 }),
    })

    expect(response.statusCode).toBe(201)

    const stored = prisma._store.ticketType.find((row) => row.id === response.json().data.id)

    expect(stored.visibility).toBe('PUBLIC')

    await app.close()
  })

  it('hides a free tier when it is made complimentary later', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { priceCents: 0 }),
    })

    expect(created.statusCode).toBe(201)

    const tierId = created.json().data.id
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/tiers/${tierId}`,
      headers,
      payload: { revision: created.json().meta.revision, complimentary: true },
    })

    expect(response.statusCode).toBe(200)

    const stored = prisma._store.ticketType.find((row) => row.id === tierId)

    expect(stored.complimentary).toBe(true)
    expect(stored.visibility).toBe('HIDDEN')

    await app.close()
  })
})

describe('a session keeps the map its reserved tiers price', () => {
  /**
   * The draft event's session made a seated one, optionally with a reserved
   * tier pricing a zone of its map. The version and zone exist only as ids: the
   * refusal is decided before either is read.
   *
   * @param {object} prisma The stub.
   * @param {object} ids The world's ids.
   * @param {{priced: boolean}} options Whether a tier prices the map.
   * @returns {object} The session row.
   */
  function seatedDraftSession(prisma, ids, { priced }) {
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.draftEvent.id)

    Object.assign(session, { venueMapVersionId: cuid(), capacity: null })

    if (priced) {
      prisma._store.ticketType.push({
        ...ids.generalAdmission,
        id: cuid(),
        eventId: ids.draftEvent.id,
        name: 'Front stalls',
        eventSessionId: session.id,
        priceZoneId: cuid(),
        reserved: true,
        quantityTotal: 0,
        quantitySold: 0,
        status: 'DRAFT',
      })
    }

    return session
  }

  it('refuses to move a session to general admission while a tier prices its map', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const session = seatedDraftSession(prisma, ids, { priced: true })
    const versionBefore = session.venueMapVersionId
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/sessions/${session.id}`,
      headers,
      payload: { revision, venueMapVersionId: null, capacity: 200 },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/"Front stalls" prices seats/)
    expect(session.venueMapVersionId).toBe(versionBefore)
    expect(session.capacity).toBeNull()

    await app.close()
  })

  it('lets a session with no priced tier move to general admission', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const headers = bearer(token)
    const session = seatedDraftSession(prisma, ids, { priced: false })
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/sessions/${session.id}`,
      headers,
      payload: { revision, venueMapVersionId: null, capacity: 200 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.venueMapVersionId).toBeNull()

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

describe('a night’s label', () => {
  it('is saved trimmed, changed, and cleared back to the date alone', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, { label: '  Night 1  ' }),
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().data.label).toBe('Night 1')

    const id = created.json().data.id
    const stored = () => prisma._store.eventSession.find((row) => row.id === id)
    expect(stored().label).toBe('Night 1')

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/sessions/${id}`,
      headers,
      payload: { revision: created.json().meta.revision, label: 'Ashtami' },
    })

    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().data.label).toBe('Ashtami')

    // A blank box clears it, the same as null.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/sessions/${id}`,
      headers,
      payload: { revision: renamed.json().meta.revision, label: '   ' },
    })

    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().data.label).toBeNull()
    expect(stored().label).toBeNull()

    // Listed back the same way the editor reads it.
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
    })
    expect(listed.json().data.find((row) => row.id === id).label).toBeNull()

    await app.close()
  })

  it('refuses a label over sixty characters, and writes nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const before = prisma._store.eventSession.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
      payload: session(revision, { label: 'N'.repeat(61) }),
    })

    expect(response.statusCode).toBe(400)
    expect(prisma._store.eventSession).toHaveLength(before)

    await app.close()
  })
})

describe('an end time the listing did not give', () => {
  const hour = 3_600_000
  const startsAt = new Date('2026-10-19T00:00:00.000Z')
  const estimate = {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * hour),
    endTimeListed: false,
  }
  const at = (offset) => new Date(startsAt.getTime() + offset * hour).toISOString()

  it('stays an estimate while the end is not touched, or only rides along with the start', () => {
    expect(endTimeListedAfter(estimate, {})).toBe(false)
    expect(endTimeListedAfter(estimate, { capacity: 400 })).toBe(false)
    expect(endTimeListedAfter(estimate, { endsAt: at(3) })).toBe(false)
    // Moving only the start leaves the old estimate as the end: still not listed.
    expect(endTimeListedAfter(estimate, { startsAt: at(1) })).toBe(false)
    // The whole night a day later keeps its length.
    expect(endTimeListedAfter(estimate, { startsAt: at(24), endsAt: at(27) })).toBe(false)
  })

  it('becomes listed once the end is set apart from the start', () => {
    expect(endTimeListedAfter(estimate, { endsAt: at(5) })).toBe(true)
    expect(endTimeListedAfter(estimate, { startsAt: at(1), endsAt: at(6) })).toBe(true)
    expect(endTimeListedAfter(estimate, { endsAt: new Date(startsAt.getTime() + 2 * hour) })).toBe(
      true,
    )
  })

  it('keeps a listed end listed, whatever moves', () => {
    const listed = { ...estimate, endTimeListed: true }

    expect(endTimeListedAfter(listed, {})).toBe(true)
    expect(endTimeListedAfter(listed, { startsAt: at(24), endsAt: at(27) })).toBe(true)
    expect(endTimeListedAfter({ startsAt, endsAt: estimate.endsAt }, {})).toBe(true)
  })
})
