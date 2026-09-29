/**
 * Authoring a draft's tiers and sessions: removal with the query-string
 * revision, the tier limits, the organiser's tier read, and reserved seating
 * from price zone to bound seats.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-authoring-tiers
 */

import { describe, expect, it } from 'vitest'

import { authorTicketTypeListResponseSchema } from '@desi-event/schemas'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { auditRows, authoringWorld, revisionOf, seedHold } from './helpers/authoring-world.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** A coherent general-admission ticket type payload. */
const tier = (revision, overrides = {}) => ({
  revision,
  name: `Tier ${Math.random().toString(36).slice(2, 8)}`,
  priceCents: 50_000,
  quantityTotal: 100,
  ...overrides,
})

/**
 * A harness on the authoring world, signed in as the organisation's manager.
 *
 * @param {object} [options] Passed to `authoringWorld`.
 * @returns {Promise<object>} The app, the stub, the ids and the headers.
 */
async function harness(options) {
  const world = await authoringWorld(options)
  const { app, prisma, ids } = await createTestApp(world)
  const headers = bearer(await signIn(app, 'arun@rangoli.example'))

  return { app, prisma, ids, headers }
}

describe('removal carries its revision in the query string', () => {
  it('removes a session with ?revision=N and moves the revision', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.draftEvent.id}/sessions/${ids.reservedSession.id}?revision=${revision}`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision + 1)
    expect(prisma._store.eventSession.some((row) => row.id === ids.reservedSession.id)).toBe(false)
    expect(auditRows(prisma, 'event.session_removed')[0].metadata).toMatchObject({
      sessionId: ids.reservedSession.id,
      revision: revision + 1,
    })

    await app.close()
  })

  it('refuses a removal with no revision (400) and a stale one (409 STALE_REVISION)', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const url = `/v1/events/${ids.draftEvent.id}/sessions/${ids.reservedSession.id}`

    const missing = await app.inject({ method: 'DELETE', url, headers })

    expect(missing.statusCode).toBe(400)

    const stale = await app.inject({
      method: 'DELETE',
      url: `${url}?revision=${revision + 5}`,
      headers,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')
    expect(prisma._store.eventSession.some((row) => row.id === ids.reservedSession.id)).toBe(true)

    await app.close()
  })

  it('removes a ticket type with ?revision=N, and refuses none or a stale one', async () => {
    const { app, prisma, ids, headers } = await harness()
    const url = `/v1/events/${ids.draftEvent.id}/tiers/${ids.draftTier.id}`
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(400)

    const stale = await app.inject({
      method: 'DELETE',
      url: `${url}?revision=${revision + 1}`,
      headers,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')

    const removed = await app.inject({
      method: 'DELETE',
      url: `${url}?revision=${revision}`,
      headers,
    })

    expect(removed.statusCode).toBe(200)
    expect(prisma._store.ticketType.some((row) => row.id === ids.draftTier.id)).toBe(false)
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision + 1)

    await app.close()
  })
})

describe('a ticket type holds the limits the database and the public page hold', () => {
  it.each([
    [
      'a 501-character description',
      { description: 'd'.repeat(501) },
      /Shorten the description \(501 of 500/,
    ],
    ['51 per order at most', { maxPerOrder: 51 }, /most per order is 51/],
    ['51 per order at least', { minPerOrder: 51, maxPerOrder: 50 }, /least per order is 51/],
    ['a 121-character name', { name: 'n'.repeat(121) }, /Shorten the name/],
  ])('refuses %s with 422 before anything is written', async (_label, overrides, problem) => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const before = prisma._store.ticketType.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, overrides),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(problem)
    expect(prisma._store.ticketType.length).toBe(before)
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision)

    await app.close()
  })

  it('accepts the boundaries, stores a blank description as none, and answers a shape that parses', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { description: '   ', minPerOrder: 50, maxPerOrder: 50 }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({
      description: null,
      minPerOrder: 50,
      maxPerOrder: 50,
      visibility: 'PUBLIC',
      removable: true,
      hasOrders: false,
      heldQuantity: 0,
    })
    expect(
      prisma._store.ticketType.find((row) => row.id === response.json().data.id).description,
    ).toBeNull()

    await app.close()
  })

  it('refuses a name-only edit to a legacy row whose description is too long, with a sentence', async () => {
    const { app, prisma, ids, headers } = await harness()
    const legacy = prisma._store.ticketType.find((row) => row.id === ids.draftTier.id)

    legacy.description = 'd'.repeat(700)

    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/tiers/${ids.draftTier.id}`,
      headers,
      payload: { revision, name: 'Renamed' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toContain(
      'Shorten the description (700 of 500 characters) to save this ticket type.',
    )
    expect(legacy.name).toBe('Draft Tier')

    await app.close()
  })

  it('refuses a complimentary tier shown on the public page', async () => {
    const { app, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { complimentary: true, priceCents: 0, visibility: 'PUBLIC' }),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(/hidden from the public page/)

    await app.close()
  })

  it('refuses a name another tier on the event already has, adding or renaming, with 422', async () => {
    const { app, prisma, ids, headers } = await harness()
    const url = `/v1/events/${ids.draftEvent.id}/tiers`

    const first = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: tier(await revisionOf(app, ids.draftEvent.id, headers), { name: 'Encore' }),
    })

    expect(first.statusCode).toBe(201)

    const count = prisma._store.ticketType.length
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const sentence =
      'Another ticket type on this event is already called "Encore". Give this one a different name.'

    // The request schema trims, and the index compares what is stored.
    const added = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: tier(revision, { name: '  Encore ' }),
    })

    expect(added.statusCode).toBe(422)
    expect(added.json().error.problems).toContain(sentence)
    expect(prisma._store.ticketType.length).toBe(count)

    const renamed = await app.inject({
      method: 'PATCH',
      url: `${url}/${ids.draftTier.id}`,
      headers,
      payload: { revision, name: 'Encore' },
    })

    expect(renamed.statusCode).toBe(422)
    expect(renamed.json().error.problems).toContain(sentence)
    expect(prisma._store.ticketType.find((row) => row.id === ids.draftTier.id).name).toBe(
      'Draft Tier',
    )
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision)

    // A tier keeps its own name through an edit of something else.
    const own = await app.inject({
      method: 'PATCH',
      url: `${url}/${first.json().data.id}`,
      headers,
      payload: { revision, name: 'Encore', maxPerOrder: 4 },
    })

    expect(own.statusCode).toBe(200)

    await app.close()
  })

  it('answers 409 TIER_NAME_TAKEN, not a 500, when another write takes the name first', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const count = prisma._store.ticketType.length
    const transaction = prisma.$transaction

    // Another writer commits a tier of the same name after this request has
    // read the event's tiers and before its transaction opens.
    prisma.$transaction = (fn) => {
      prisma.$transaction = transaction
      prisma._store.ticketType.push({
        ...prisma._store.ticketType.find((row) => row.id === ids.draftTier.id),
        id: cuid(),
        name: 'Encore',
      })

      return transaction(fn)
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, { name: 'Encore' }),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('TIER_NAME_TAKEN')
    expect(prisma._store.ticketType.length).toBe(count + 1)
    expect(await revisionOf(app, ids.draftEvent.id, headers)).toBe(revision)

    await app.close()
  })

  it('writes the changed field names, and never their values, to the audit row', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/tiers/${ids.draftTier.id}`,
      headers,
      payload: { revision, name: 'A secret early price', priceCents: 1234 },
    })

    expect(response.statusCode).toBe(200)

    const [row] = auditRows(prisma, 'event.ticket_type_updated')

    expect(row.metadata).toMatchObject({ tierId: ids.draftTier.id, revision: revision + 1 })
    expect(row.metadata.fields.sort()).toEqual(['name', 'priceCents'])
    expect(JSON.stringify(row.metadata)).not.toMatch(/secret early price|1234/)

    await app.close()
  })
})

describe('the organiser reads every tier, as it is', () => {
  it('carries the session, zone, visibility, holds and whether it can be removed', async () => {
    const { app, prisma, ids, headers } = await harness()

    seedHold(prisma, { ticketTypeId: ids.draftTier.id, quantity: 3 })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(authorTicketTypeListResponseSchema.safeParse(response.json()).success).toBe(true)

    const [draft] = response.json().data

    expect(draft).toMatchObject({
      id: ids.draftTier.id,
      eventSessionId: null,
      priceZoneId: null,
      visibility: 'PUBLIC',
      heldQuantity: 3,
      removable: false,
    })
    expect(response.json().meta.revision).toBe(0)

    await app.close()
  })

  it('reads a legacy row the public shape would refuse', async () => {
    const { app, prisma, ids, headers } = await harness()
    const legacy = prisma._store.ticketType.find((row) => row.id === ids.draftTier.id)

    Object.assign(legacy, { description: 'd'.repeat(900), maxPerOrder: 100, minPerOrder: 60 })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data[0].maxPerOrder).toBe(100)

    await app.close()
  })

  it('does not tell a stranger the event exists', async () => {
    const { app, ids } = await harness()
    const stranger = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers: stranger,
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('reserved seating from the organiser screen', () => {
  it('lists a reserved session’s price zones, and none for general admission', async () => {
    const { app, ids, headers } = await harness()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/sessions`,
      headers,
    })

    expect(response.statusCode).toBe(200)

    const byId = new Map(response.json().data.map((row) => [row.id, row]))

    expect(byId.get(ids.reservedSession.id).priceZones.map((zone) => zone.name)).toEqual([
      'Stalls',
      'Balcony',
    ])
    expect(byId.get(ids.gaSession.id).priceZones).toEqual([])
    expect(byId.get(ids.gaSession.id)).toMatchObject({
      usage: { sold: 0, held: 0 },
      removable: true,
    })

    await app.close()
  })

  it('refuses a zone from another map version with 422, before the database is asked', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const before = prisma._store.ticketType.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, {
        reserved: true,
        quantityTotal: 0,
        eventSessionId: ids.reservedSession.id,
        priceZoneId: ids.elsewhere.id,
      }),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toContain(
      "That price zone is not on this session's seating map.",
    )
    expect(prisma._store.ticketType.length).toBe(before)

    await app.close()
  })

  it('refuses a second reserved tier on the same session and zone with 422', async () => {
    const { app, ids, headers } = await harness()
    const reserved = (revision, name) =>
      app.inject({
        method: 'POST',
        url: `/v1/events/${ids.draftEvent.id}/tiers`,
        headers,
        payload: tier(revision, {
          name,
          reserved: true,
          quantityTotal: 0,
          eventSessionId: ids.reservedSession.id,
          priceZoneId: ids.stalls.id,
        }),
      })

    const first = await reserved(await revisionOf(app, ids.draftEvent.id, headers), 'Stalls')

    expect(first.statusCode).toBe(201)

    const second = await reserved(first.json().meta.revision, 'Stalls again')

    expect(second.statusCode).toBe(422)
    expect(second.json().error.problems.join(' ')).toMatch(
      /Another reserved ticket type \("Stalls"\) already prices that zone at this session/,
    )

    await app.close()
  })

  it('binds a prepared session’s seats to the tier pricing their zone as the tier is added', async () => {
    const { app, prisma, ids, headers } = await harness({ prepared: true })
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, {
        name: 'Stalls',
        reserved: true,
        quantityTotal: 0,
        eventSessionId: ids.reservedSession.id,
        priceZoneId: ids.stalls.id,
      }),
    })

    expect(response.statusCode).toBe(201)

    const tierId = response.json().data.id
    const stallsSeatIds = new Set(
      ids.seats.filter((seat) => seat.priceZoneId === ids.stalls.id).map((seat) => seat.id),
    )
    const bound = prisma._store.eventSeat.filter((row) => row.ticketTypeId === tierId)

    expect(bound).toHaveLength(3)
    expect(bound.every((row) => stallsSeatIds.has(row.seatId))).toBe(true)
    expect(auditRows(prisma, 'event.seats_bound')[0].metadata).toMatchObject({
      bound: 3,
      unbound: 0,
    })

    await app.close()
  })

  it('prepares inventory, assigns each seat to its zone’s tier and says how many', async () => {
    const { app, prisma, ids, headers } = await harness()
    const revision = await revisionOf(app, ids.draftEvent.id, headers)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, {
        name: 'Balcony',
        reserved: true,
        quantityTotal: 0,
        eventSessionId: ids.reservedSession.id,
        priceZoneId: ids.balcony.id,
      }),
    })

    expect(created.statusCode).toBe(201)

    const prepared = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/prepare-inventory`,
      headers,
      payload: { eventSessionId: ids.reservedSession.id },
    })

    expect(prepared.statusCode).toBe(200)
    expect(prepared.json().data).toMatchObject({ created: 6, prepared: 6, assigned: 3 })

    const tierId = created.json().data.id

    expect(prisma._store.eventSeat.filter((row) => row.ticketTypeId === tierId)).toHaveLength(3)
    expect(auditRows(prisma, 'event.inventory_prepared')[0].metadata).toMatchObject({ bound: 3 })
    expect(auditRows(prisma, 'event.seats_bound')).toHaveLength(1)

    // Idempotent: a second run assigns nothing new and writes no binding row.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/prepare-inventory`,
      headers,
      payload: { eventSessionId: ids.reservedSession.id },
    })

    expect(again.json().data).toMatchObject({ created: 0, assigned: 0 })
    expect(auditRows(prisma, 'event.seats_bound')).toHaveLength(1)

    await app.close()
  })

  it('moves a tier to another zone, taking back only seats nobody holds', async () => {
    const { app, prisma, ids, headers } = await harness({ prepared: true })
    const revision = await revisionOf(app, ids.draftEvent.id, headers)
    const created = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/tiers`,
      headers,
      payload: tier(revision, {
        name: 'Moving',
        reserved: true,
        quantityTotal: 0,
        eventSessionId: ids.reservedSession.id,
        priceZoneId: ids.stalls.id,
      }),
    })
    const tierId = created.json().data.id
    const stallsRows = prisma._store.eventSeat.filter((row) => row.ticketTypeId === tierId)

    // One Stalls seat is blocked by the organiser: it keeps the tier it had.
    stallsRows[0].status = 'BLOCKED'

    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/tiers/${tierId}`,
      headers,
      payload: { revision: created.json().meta.revision, priceZoneId: ids.balcony.id },
    })

    expect(moved.statusCode).toBe(200)

    const balconySeatIds = new Set(
      ids.seats.filter((seat) => seat.priceZoneId === ids.balcony.id).map((seat) => seat.id),
    )
    const nowBound = prisma._store.eventSeat.filter((row) => row.ticketTypeId === tierId)

    expect(nowBound.filter((row) => balconySeatIds.has(row.seatId))).toHaveLength(3)
    expect(nowBound.filter((row) => !balconySeatIds.has(row.seatId))).toEqual([stallsRows[0]])
    expect(auditRows(prisma, 'event.seats_bound').at(-1).metadata).toMatchObject({
      bound: 3,
      unbound: 2,
    })

    await app.close()
  })
})

describe('opening sales needs seats behind every reserved tier on sale', () => {
  it('refuses a reserved tier on sale with no bound seats, naming it', async () => {
    const { app, prisma, ids } = await harness()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))

    // The published event gets a reserved session with no seat rows and an
    // on-sale reserved tier pricing a zone of it.
    const sessionId = cuid()

    prisma._store.eventSession.push({
      ...ids.reservedSession,
      id: sessionId,
      eventId: ids.publishedEvent.id,
      startsAt: minutesFromNow(60 * 24 * 31),
      endsAt: minutesFromNow(60 * 24 * 31 + 120),
    })
    prisma._store.ticketType.push({
      ...ids.generalAdmission,
      id: cuid(),
      name: 'Front stalls',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: sessionId,
      priceZoneId: ids.stalls.id,
    })

    await stepUp(app, 'owner@rangoli.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/open-sales`,
      headers,
      payload: {},
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(
      /Reserved ticket type "Front stalls" has no seats\. /,
    )

    await app.close()
  })

  it('binds prepared seats as sales open, so the same tier then passes', async () => {
    const { app, prisma, ids } = await harness()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))
    const sessionId = cuid()
    const tierId = cuid()

    prisma._store.eventSession.push({
      ...ids.reservedSession,
      id: sessionId,
      eventId: ids.publishedEvent.id,
    })
    prisma._store.ticketType.push({
      ...ids.generalAdmission,
      id: tierId,
      name: 'Front stalls',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: sessionId,
      priceZoneId: ids.stalls.id,
    })

    for (const seat of ids.seats) {
      prisma._store.eventSeat.push({
        id: cuid(),
        eventSessionId: sessionId,
        seatId: seat.id,
        ticketTypeId: null,
        status: 'AVAILABLE',
        holdId: null,
        orderItemId: null,
        priceCentsOverride: null,
        blockedReason: null,
      })
    }

    await stepUp(app, 'owner@rangoli.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/open-sales`,
      headers,
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('ON_SALE')
    expect(prisma._store.eventSeat.filter((row) => row.ticketTypeId === tierId)).toHaveLength(3)
    expect(auditRows(prisma, 'event.seats_bound')[0].actorId).toBe(ids.owner.id)

    await app.close()
  })

  it('binds nothing for a caller who may not open sales', async () => {
    const { app, prisma, ids } = await harness()
    const headers = bearer(await signIn(app, 'finance@rangoli.example'))
    const sessionId = cuid()

    prisma._store.eventSession.push({
      ...ids.reservedSession,
      id: sessionId,
      eventId: ids.publishedEvent.id,
    })
    prisma._store.ticketType.push({
      ...ids.generalAdmission,
      id: cuid(),
      reserved: true,
      quantityTotal: 0,
      eventSessionId: sessionId,
      priceZoneId: ids.stalls.id,
    })
    prisma._store.eventSeat.push({
      id: cuid(),
      eventSessionId: sessionId,
      seatId: ids.seats[0].id,
      ticketTypeId: null,
      status: 'AVAILABLE',
      holdId: null,
      orderItemId: null,
      priceCentsOverride: null,
      blockedReason: null,
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/open-sales`,
      headers,
      payload: {},
    })

    expect([403]).toContain(response.statusCode)
    expect(prisma._store.eventSeat.every((row) => row.ticketTypeId === null)).toBe(true)

    await app.close()
  })
})
