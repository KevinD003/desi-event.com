/**
 * Editing an event after it is published.
 *
 * A live event takes the edits that cannot take anything away from a buyer —
 * a new tier or night, a renamed tier, a raised quantity, a paused tier — and
 * refuses, with a code the editor can branch on, the ones that would: a price
 * somebody paid, a quantity below what is sold and held, a layout people chose
 * seats from, a removal that would orphan an order. A change to a night's date
 * is allowed with a confirmation and a reason, and queues a notice for the
 * people holding tickets for that night.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-authoring-live
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import {
  auditRows,
  authoringWorld,
  revisionOf,
  seedHold,
  seedOrder,
} from './helpers/authoring-world.js'
import { tierChangeProblems } from '../src/lib/event-authoring.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * The published event put on sale, with the manager signed in.
 *
 * @returns {Promise<object>} The harness.
 */
async function liveHarness() {
  const world = await authoringWorld()
  const { app, prisma, ids } = await createTestApp(world)
  const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

  event.status = 'ON_SALE'
  event.salesOpenedAt = new Date('2025-03-01T00:00:00.000Z')

  const headers = bearer(await signIn(app, 'arun@rangoli.example'))
  const url = `/v1/events/${ids.publishedEvent.id}`

  /**
   * PATCH a tier with the current revision.
   *
   * @param {string} tierId The tier.
   * @param {object} patch The change.
   * @returns {Promise<object>} The response.
   */
  const patchTier = async (tierId, patch) =>
    app.inject({
      method: 'PATCH',
      url: `${url}/tiers/${tierId}`,
      headers,
      payload: { revision: await revisionOf(app, ids.publishedEvent.id, headers), ...patch },
    })

  /**
   * PATCH a session with the current revision.
   *
   * @param {string} sessionId The session.
   * @param {object} patch The change.
   * @returns {Promise<object>} The response.
   */
  const patchSession = async (sessionId, patch) =>
    app.inject({
      method: 'PATCH',
      url: `${url}/sessions/${sessionId}`,
      headers,
      payload: { revision: await revisionOf(app, ids.publishedEvent.id, headers), ...patch },
    })

  /**
   * DELETE a tier or session with the current revision.
   *
   * @param {string} path `tiers/:id` or `sessions/:id`.
   * @returns {Promise<object>} The response.
   */
  const remove = async (path) =>
    app.inject({
      method: 'DELETE',
      url: `${url}/${path}?revision=${await revisionOf(app, ids.publishedEvent.id, headers)}`,
      headers,
    })

  return { app, prisma, ids, headers, url, patchTier, patchSession, remove }
}

describe('a live event takes the tier edits that take nothing from a buyer', () => {
  it('adds a tier, as a draft', async () => {
    const { app, ids, headers, url } = await liveHarness()

    const response = await app.inject({
      method: 'POST',
      url: `${url}/tiers`,
      headers,
      payload: {
        revision: await revisionOf(app, ids.publishedEvent.id, headers),
        name: 'Late release',
        priceCents: 200_000,
        quantityTotal: 20,
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.status).toBe('DRAFT')

    await app.close()
  })

  it('renames, redescribes, re-windows, re-limits and hides a tier that has sold', async () => {
    const { app, prisma, ids, patchTier } = await liveHarness()

    prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id).quantitySold = 2

    const response = await patchTier(ids.generalAdmission.id, {
      name: 'General (standing)',
      description: 'Standing, near the stage.',
      salesStartAt: minutesFromNow(-60).toISOString(),
      salesEndAt: minutesFromNow(60 * 24 * 20).toISOString(),
      maxPerOrder: 6,
      visibility: 'HIDDEN',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      name: 'General (standing)',
      maxPerOrder: 6,
      visibility: 'HIDDEN',
      hasOrders: false,
    })

    await app.close()
  })

  it('raises a quantity, and refuses one below what is sold and held', async () => {
    const { app, prisma, ids, patchTier } = await liveHarness()

    prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id).quantitySold = 4
    seedHold(prisma, { ticketTypeId: ids.generalAdmission.id, quantity: 3 })

    expect((await patchTier(ids.generalAdmission.id, { quantityTotal: 40 })).statusCode).toBe(200)

    const below = await patchTier(ids.generalAdmission.id, { quantityTotal: 6 })

    expect(below.statusCode).toBe(409)
    expect(below.json().error.code).toBe('TIER_QUANTITY_BELOW_SOLD')
    expect(below.json().error.message).toMatch(/4 sold and 3 held.*below 7/)

    expect((await patchTier(ids.generalAdmission.id, { quantityTotal: 7 })).statusCode).toBe(200)

    await app.close()
  })

  // SPEC2-XI X-4 (§8): a sold tier may be re-priced for the next buyer — each
  // order line keeps the price it was bought at — while its currency stays and
  // a tier in somebody's basket keeps the price that basket was quoted.
  it('re-prices a sold tier for the next buyer, keeps the currency (TIER_SOLD) and the price of a tier in a basket (TIER_IN_USE)', async () => {
    const { app, prisma, ids, patchTier } = await liveHarness()
    const tier = prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)

    tier.quantitySold = 1

    const { item } = seedOrder(prisma, {
      eventId: ids.publishedEvent.id,
      ticketTypeId: ids.generalAdmission.id,
    })
    const was = tier.priceCents

    const sold = await patchTier(ids.generalAdmission.id, { priceCents: 1 })

    expect(sold.statusCode).toBe(200)
    expect(sold.json().data.priceCents).toBe(1)
    // The buyer keeps what they paid.
    expect(prisma._store.orderItem.find((row) => row.id === item.id).unitPriceCents).toBe(1000)

    const [audit] = auditRows(prisma, 'event.ticket_type_updated')

    expect(audit.metadata).toMatchObject({
      tierId: ids.generalAdmission.id,
      before: { priceCents: was },
      after: { priceCents: 1 },
    })

    // The currency those orders were paid in stays.
    expect(
      tierChangeProblems(tier, { currency: 'USD' }, { sold: 1, held: 0 }, 'live'),
    ).toMatchObject({ code: 'TIER_SOLD' })

    seedHold(prisma, { ticketTypeId: ids.vip.id, quantity: 1 })

    const held = await patchTier(ids.vip.id, { priceCents: 1 })

    expect(held.statusCode).toBe(409)
    expect(held.json().error.code).toBe('TIER_IN_USE')

    await app.close()
  })

  it('keeps the night and seating of a tier people have bought', async () => {
    const { app, prisma, ids, patchTier } = await liveHarness()

    seedOrder(prisma, { eventId: ids.publishedEvent.id, ticketTypeId: ids.vip.id })

    const moved = await patchTier(ids.vip.id, { eventSessionId: ids.publishedSession.id })

    expect(moved.statusCode).toBe(409)
    expect(moved.json().error.code).toBe('TIER_IN_USE')

    const toDraft = await patchTier(ids.vip.id, { status: 'DRAFT' })

    expect(toDraft.statusCode).toBe(409)
    expect(toDraft.json().error.message).toMatch(/Pause it or hide it instead/)

    await app.close()
  })

  it('pauses a tier and puts it back on sale', async () => {
    const { app, ids, patchTier } = await liveHarness()

    expect(
      (await patchTier(ids.generalAdmission.id, { status: 'PAUSED' })).json().data.status,
    ).toBe('PAUSED')
    expect(
      (await patchTier(ids.generalAdmission.id, { status: 'ON_SALE' })).json().data.status,
    ).toBe('ON_SALE')

    await app.close()
  })
})

describe('removing a live tier', () => {
  it.each([
    [
      'a sale',
      (prisma, ids) => {
        prisma._store.ticketType.find((row) => row.id === ids.vip.id).quantitySold = 1
      },
    ],
    [
      'an order line, even unpaid',
      (prisma, ids) => {
        seedOrder(prisma, {
          eventId: ids.publishedEvent.id,
          ticketTypeId: ids.vip.id,
          status: 'PENDING',
        })
      },
    ],
    [
      'a hold line',
      (prisma, ids) => {
        const hold = seedHold(prisma, { ticketTypeId: ids.generalAdmission.id })

        prisma._store.holdItem.push({
          id: cuid(),
          holdId: hold.id,
          ticketTypeId: ids.vip.id,
          quantity: 1,
        })
      },
    ],
    [
      'a live hold',
      (prisma, ids) => {
        seedHold(prisma, { ticketTypeId: ids.vip.id })
      },
    ],
  ])('refuses one with %s (409 TIER_IN_USE, never a 500)', async (_label, arrange) => {
    const { app, prisma, ids, remove } = await liveHarness()

    arrange(prisma, ids)

    const response = await remove(`tiers/${ids.vip.id}`)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('TIER_IN_USE')
    expect(prisma._store.ticketType.some((row) => row.id === ids.vip.id)).toBe(true)

    await app.close()
  })

  it('removes one nothing depends on', async () => {
    const { app, prisma, ids, remove } = await liveHarness()

    const response = await remove(`tiers/${ids.pausedTier.id}`)

    expect(response.statusCode).toBe(200)
    expect(prisma._store.ticketType.some((row) => row.id === ids.pausedTier.id)).toBe(false)

    await app.close()
  })
})

describe('a live session', () => {
  it('refuses to move a night without a confirmation, naming the start time', async () => {
    const { app, ids, patchSession } = await liveHarness()

    const response = await patchSession(ids.publishedSession.id, {
      startsAt: new Date(ids.publishedSession.startsAt.getTime() + 3_600_000).toISOString(),
      endsAt: new Date(ids.publishedSession.endsAt.getTime() + 3_600_000).toISOString(),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(/the start time/)
    expect(response.json().error.problems.join(' ')).toMatch(/the end time/)

    await app.close()
  })

  it('moves a night with a confirmation and a reason, and queues notices for that night only', async () => {
    const { app, prisma, ids, url, headers, patchSession } = await liveHarness()
    const secondId = cuid()

    prisma._store.eventSession.push({
      ...ids.publishedSession,
      id: secondId,
      startsAt: minutesFromNow(60 * 24 * 31),
      endsAt: minutesFromNow(60 * 24 * 31 + 240),
      sortOrder: 1,
    })

    const firstNight = cuid()
    const secondNight = cuid()

    prisma._store.ticketType.push(
      { ...ids.vip, id: firstNight, name: 'Night one', eventSessionId: ids.publishedSession.id },
      { ...ids.vip, id: secondNight, name: 'Night two', eventSessionId: secondId },
    )

    const forFirst = seedOrder(prisma, { eventId: ids.publishedEvent.id, ticketTypeId: firstNight })
    const forSecond = seedOrder(prisma, {
      eventId: ids.publishedEvent.id,
      ticketTypeId: secondNight,
    })

    const needsReason = await patchSession(secondId, {
      startsAt: minutesFromNow(60 * 24 * 32).toISOString(),
      endsAt: minutesFromNow(60 * 24 * 32 + 240).toISOString(),
      confirmMaterialChange: true,
    })

    expect(needsReason.statusCode).toBe(422)

    const before = prisma._store.notificationOutbox.length
    const response = await patchSession(secondId, {
      startsAt: minutesFromNow(60 * 24 * 32).toISOString(),
      endsAt: minutesFromNow(60 * 24 * 32 + 240).toISOString(),
      confirmMaterialChange: true,
      changeReason: 'The band moved us a day later.',
    })

    expect(response.statusCode).toBe(200)

    const notices = prisma._store.notificationOutbox.slice(before)

    expect(notices.map((row) => row.recipient)).toEqual([forSecond.order.buyerEmail])
    expect(notices[0].payload).toMatchObject({
      sessionId: secondId,
      changedFields: ['startsAt', 'endsAt'],
      changed: ['the start time', 'the end time'],
      reason: 'The band moved us a day later.',
    })
    expect(notices.map((row) => row.recipient)).not.toContain(forFirst.order.buyerEmail)

    const [audit] = auditRows(prisma, 'event.session_material_change')

    expect(audit.metadata).toMatchObject({
      fields: ['startsAt', 'endsAt'],
      ordersAffected: 1,
      notificationsQueued: 1,
    })
    expect(auditRows(prisma, 'event.session_updated')).toHaveLength(1)

    // A housekeeping change to the same night needs no confirmation.
    const housekeeping = await app.inject({
      method: 'PATCH',
      url: `${url}/sessions/${secondId}`,
      headers,
      payload: { revision: response.json().meta.revision, sortOrder: 4 },
    })

    expect(housekeeping.statusCode).toBe(200)

    await app.close()
  })

  it('refuses a capacity below what is sold and held', async () => {
    const { app, prisma, ids, patchSession } = await liveHarness()
    const boundTier = cuid()

    prisma._store.ticketType.push({
      ...ids.vip,
      id: boundTier,
      name: 'Night pass',
      quantitySold: 5,
      eventSessionId: ids.publishedSession.id,
    })
    seedHold(prisma, { ticketTypeId: boundTier, quantity: 2 })

    const below = await patchSession(ids.publishedSession.id, { capacity: 6 })

    expect(below.statusCode).toBe(409)
    expect(below.json().error.code).toBe('SESSION_CAPACITY_BELOW_SOLD')

    expect((await patchSession(ids.publishedSession.id, { capacity: 7 })).statusCode).toBe(200)

    await app.close()
  })

  // SPEC2-XI X-4 (§8): a live night nobody holds a ticket for may move to
  // another map, its seats prepared in the same write; one whose seats are
  // sold keeps the map those people chose from.
  it('moves an unused live night to another map, and keeps a night whose seats are sold (409 MAP_FROZEN)', async () => {
    const { app, prisma, ids, patchSession } = await liveHarness()

    const response = await patchSession(ids.publishedSession.id, {
      venueMapVersionId: ids.versionId,
      capacity: null,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.venueMapVersionId).toBe(ids.versionId)

    const seats = prisma._store.eventSeat.filter(
      (row) => row.eventSessionId === ids.publishedSession.id,
    )

    expect(seats).toHaveLength(ids.seats.length)
    expect(seats.every((row) => row.status === 'AVAILABLE')).toBe(true)

    // A tier pricing one of the map's zones pins it too, sold or not.
    const priced = {
      ...ids.vip,
      id: cuid(),
      name: 'Stalls',
      quantitySold: 0,
      eventSessionId: ids.publishedSession.id,
      priceZoneId: ids.stalls.id,
    }

    prisma._store.ticketType.push(priced)

    const pinned = await patchSession(ids.publishedSession.id, {
      venueMapVersionId: ids.otherVersionId,
    })

    expect(pinned.statusCode).toBe(409)
    expect(pinned.json().error.code).toBe('MAP_PRICED')
    expect(pinned.json().error.message).toMatch(/^"Stalls" prices seats on this session/)

    prisma._store.ticketType.splice(prisma._store.ticketType.indexOf(priced), 1)

    seats[0].status = 'SOLD'

    const frozen = await patchSession(ids.publishedSession.id, {
      venueMapVersionId: ids.otherVersionId,
    })

    expect(frozen.statusCode).toBe(409)
    expect(frozen.json().error.code).toBe('MAP_FROZEN')

    await app.close()
  })

  it('refuses to remove a night a general-admission order was placed for (409, not a 500)', async () => {
    const { app, prisma, ids, remove } = await liveHarness()
    const boundTier = cuid()

    prisma._store.ticketType.push({
      ...ids.vip,
      id: boundTier,
      name: 'Night pass',
      eventSessionId: ids.publishedSession.id,
    })

    // Checkout writes no session on a general-admission order.
    seedOrder(prisma, {
      eventId: ids.publishedEvent.id,
      ticketTypeId: boundTier,
      eventSessionId: null,
    })

    const response = await remove(`sessions/${ids.publishedSession.id}`)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('SESSION_IN_USE')
    expect(prisma._store.eventSession.some((row) => row.id === ids.publishedSession.id)).toBe(true)

    await app.close()
  })

  it('refuses to remove the only night of a live event (409 LAST_SESSION)', async () => {
    const { app, prisma, ids, remove } = await liveHarness()
    const nights = prisma._store.eventSession.filter((row) => row.eventId === ids.publishedEvent.id)

    expect(nights).toHaveLength(1)

    const response = await remove(`sessions/${ids.publishedSession.id}`)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('LAST_SESSION')
    expect(response.json().error.message).toMatch(/Postpone the event|cancel the event/)
    expect(prisma._store.eventSession.some((row) => row.id === ids.publishedSession.id)).toBe(true)
    expect(auditRows(prisma, 'event.session_removed')).toHaveLength(0)

    await app.close()
  })

  it('removes an unused second night and names the tiers that went with it', async () => {
    const { app, prisma, ids, remove } = await liveHarness()
    const secondId = cuid()
    const nightTier = cuid()

    prisma._store.eventSession.push({
      ...ids.publishedSession,
      id: secondId,
      startsAt: minutesFromNow(60 * 24 * 31),
      endsAt: minutesFromNow(60 * 24 * 31 + 240),
      sortOrder: 1,
    })
    prisma._store.ticketType.push({
      ...ids.vip,
      id: nightTier,
      name: 'Second night',
      status: 'ON_SALE',
      quantitySold: 0,
      eventSessionId: secondId,
    })

    const response = await remove(`sessions/${secondId}`)

    expect(response.statusCode).toBe(200)

    const [audit] = auditRows(prisma, 'event.session_removed')

    expect(audit.metadata).toMatchObject({ sessionId: secondId, removedTierIds: [nightTier] })

    await app.close()
  })

  it('adds a night only in the future', async () => {
    const { app, ids, headers, url } = await liveHarness()

    const response = await app.inject({
      method: 'POST',
      url: `${url}/sessions`,
      headers,
      payload: {
        revision: await revisionOf(app, ids.publishedEvent.id, headers),
        startsAt: minutesFromNow(-120).toISOString(),
        endsAt: minutesFromNow(-60).toISOString(),
        timezone: 'America/Chicago',
        capacity: 50,
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(/start in the future/)

    await app.close()
  })
})
