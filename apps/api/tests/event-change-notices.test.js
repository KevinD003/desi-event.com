import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { addRows, makeWorld, threeNightEventFixture } from './helpers/fixtures.js'

/**
 * What ticket holders are shown changed (SPEC2-XI X-14, X-C): one notice per
 * change, read back on the order and ticket pages it touches.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/tests/event-change-notices
 */

/**
 * Sign in, and confirm a second factor when asked.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @param {object} [options] Options.
 * @param {boolean} [options.step] Whether to step up.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email, { step = false } = {}) {
  const headers = bearer(await signIn(app, email))

  if (step) await stepUp(app, email, headers)

  return headers
}

/**
 * The app with the three-night live event; one order placed later than the rest.
 *
 * @returns {Promise<object>} The harness and the fixture.
 */
async function noticeApp() {
  const world = await makeWorld()
  const fixture = threeNightEventFixture(world.ids)

  addRows(world.seed, fixture.rows)

  return { ...(await createTestApp({ seed: world.seed, ids: world.ids })), fixture }
}

/**
 * The event changes an order shows its buyer.
 *
 * @param {object} app The app.
 * @param {object} headers The buyer's headers.
 * @param {string} reference The order.
 * @returns {Promise<object[]>} The notices.
 */
async function changesOf(app, headers, reference) {
  const response = await app.inject({ method: 'GET', url: `/v1/orders/${reference}`, headers })

  expect(response.statusCode).toBe(200)

  return response.json().data.eventChanges
}

describe('a change to one night', () => {
  it('is recorded once, and shown to that night’s orders and to every-night passes only', async () => {
    const { app, prisma, fixture } = await noticeApp()
    const night = fixture.nights[1]
    const revision = prisma._store.event.find((row) => row.id === fixture.event.id).revision
    const later = new Date(night.startsAt.getTime() + 3_600_000)

    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: {
        revision,
        startsAt: later.toISOString(),
        endsAt: new Date(later.getTime() + 4 * 3_600_000).toISOString(),
        confirmMaterialChange: true,
        changeReason: 'The hall is booked until seven.',
      },
    })

    expect(moved.statusCode).toBe(200)

    const notices = prisma._store.eventChangeNotice.filter(
      (row) => row.eventId === fixture.event.id,
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'SESSION_CHANGE', eventSessionId: night.id })

    const buyer = await as(app, 'priya@example.com')

    expect(await changesOf(app, buyer, 'DE-3N01')).toEqual([])
    expect(await changesOf(app, buyer, 'DE-3N02')).toEqual([
      expect.objectContaining({
        kind: 'SESSION_CHANGE',
        sessionId: night.id,
        reason: 'The hall is booked until seven.',
        by: 'ORGANIZER',
      }),
    ])
    expect(await changesOf(app, buyer, 'DE-3NPASS')).toHaveLength(1)

    // The ticket pages read the same rule.
    const ticketOf = (reference) =>
      prisma._store.ticket.find((ticket) =>
        prisma._store.orderItem.some(
          (item) =>
            item.id === ticket.orderItemId &&
            prisma._store.order.some(
              (order) => order.id === item.orderId && order.reference === reference,
            ),
        ),
      )

    const nightOne = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${ticketOf('DE-3N01').id}`,
      headers: buyer,
    })
    const pass = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${ticketOf('DE-3NPASS').id}`,
      headers: buyer,
    })

    expect(nightOne.json().data.eventChanges).toEqual([])
    expect(pass.json().data.eventChanges).toHaveLength(1)

    await app.close()
  })
})

describe('a change to the event', () => {
  it('is shown to every order placed before it, said to be by the team at The Desi Events when it was', async () => {
    const { app, prisma, fixture } = await noticeApp()

    // An order placed after the change does not list it.
    prisma._store.order.find((row) => row.reference === 'DE-3N03').createdAt = new Date(
      Date.now() + 60 * 60_000,
    )

    const anil = await as(app, 'anil@desi-event.example', { step: true })

    await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${fixture.event.id}/edit`,
      headers: anil,
      payload: { reason: 'The organiser asked us to fix the end time.' },
    })

    const revision = prisma._store.event.find((row) => row.id === fixture.event.id).revision
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${fixture.event.id}`,
      headers: anil,
      payload: {
        revision,
        endsAt: new Date(fixture.event.endsAt.getTime() + 3_600_000).toISOString(),
        confirmMaterialChange: true,
        changeReason: 'The last night runs an hour longer.',
      },
    })

    expect(response.statusCode).toBe(200)

    const notices = prisma._store.eventChangeNotice.filter(
      (row) => row.eventId === fixture.event.id,
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'MATERIAL_CHANGE', byPlatform: true })

    const outbox = prisma._store.notificationOutbox.filter(
      (row) => row.template === 'event.changed' && row.payload?.eventId === fixture.event.id,
    )

    expect(outbox.length).toBeGreaterThan(0)
    expect(outbox.every((row) => row.payload.byPlatform === true)).toBe(true)

    const buyer = await as(app, 'priya@example.com')

    expect(await changesOf(app, buyer, 'DE-3N01')).toEqual([
      expect.objectContaining({ kind: 'MATERIAL_CHANGE', by: 'DESI_EVENT', sessionId: null }),
    ])
    expect(await changesOf(app, buyer, 'DE-3N03')).toEqual([])

    // A stranger reads nothing of it.
    const stranger = await app.inject({
      method: 'GET',
      url: '/v1/orders/DE-3N01',
      headers: await as(app, 'rival@dhol.example'),
    })

    expect(stranger.statusCode).toBeGreaterThanOrEqual(403)
    expect(stranger.body).not.toMatch(/runs an hour longer/)

    await app.close()
  })
})

describe('a new joining link for an online event', () => {
  it('is never shown in a notice: not to a refunded buyer, an order:view reader or the outbox', async () => {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids, {
      overrides: { isOnline: true, onlineUrl: 'https://meet.example/old-room' },
    })

    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    // DE-3N01 was refunded in full: its buyer no longer holds the link.
    const refunded = prisma._store.order.find((row) => row.reference === 'DE-3N01')

    refunded.status = 'REFUNDED'
    refunded.refundedCents = refunded.totalCents

    const refundedItems = prisma._store.orderItem.filter((item) => item.orderId === refunded.id)
    const refundedTicket = prisma._store.ticket.find((ticket) =>
      refundedItems.some((item) => item.id === ticket.orderItemId),
    )

    for (const ticket of prisma._store.ticket) {
      if (refundedItems.some((item) => item.id === ticket.orderItemId)) ticket.status = 'REFUNDED'
    }

    const revision = prisma._store.event.find((row) => row.id === fixture.event.id).revision
    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${fixture.event.id}`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: {
        revision,
        onlineUrl: 'https://meet.example/SECRET-new-room',
        confirmMaterialChange: true,
        changeReason: 'The room link changed for everyone.',
      },
    })

    expect(moved.statusCode, moved.body).toBe(200)

    // Stored without either link; it still says that the link changed.
    const notices = prisma._store.eventChangeNotice.filter(
      (row) => row.eventId === fixture.event.id,
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'MATERIAL_CHANGE', fields: ['onlineUrl'] })
    expect(notices[0].changed).toEqual(['the online address'])
    expect(JSON.stringify(notices[0])).not.toMatch(/meet\.example/)

    const outbox = prisma._store.notificationOutbox.filter(
      (row) => row.template === 'event.changed' && row.payload?.eventId === fixture.event.id,
    )

    expect(outbox.length).toBeGreaterThan(0)
    expect(JSON.stringify(outbox.map((row) => row.payload))).not.toMatch(/meet\.example/)

    const buyer = await as(app, 'priya@example.com')
    const order = await app.inject({ method: 'GET', url: '/v1/orders/DE-3N01', headers: buyer })

    expect(order.statusCode).toBe(200)
    expect(order.json().data.eventChanges).toEqual([
      expect.objectContaining({ kind: 'MATERIAL_CHANGE', changed: ['the online address'] }),
    ])
    expect(order.body).not.toMatch(/SECRET-new-room/)

    const ticket = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${refundedTicket.id}`,
      headers: buyer,
    })

    expect(ticket.statusCode).toBe(200)
    expect(ticket.json().data.eventChanges).toHaveLength(1)
    expect(ticket.body).not.toMatch(/SECRET-new-room/)

    // The organiser reads orders, not the link through a notice.
    const reader = await app.inject({
      method: 'GET',
      url: '/v1/orders/DE-3N02',
      headers: await as(app, 'owner@rangoli.example'),
    })

    expect(reader.statusCode).toBe(200)
    expect(reader.json().data.eventChanges).toHaveLength(1)
    expect(JSON.stringify(reader.json().data.eventChanges)).not.toMatch(/meet\.example/)

    await app.close()
  })

  it('is withheld on the way out from a notice that holds one', async () => {
    const { toEventChangeNotice } = await import('../src/lib/event-change-notices.js')
    const shown = toEventChangeNotice({
      id: 'c0000000000000000000notice',
      kind: 'MATERIAL_CHANGE',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      changed: ['the online address', 'the start time'],
      before: { onlineUrl: 'https://meet.example/a', startsAt: '2026-11-01T19:00:00.000Z' },
      after: { onlineUrl: 'https://meet.example/b' },
      reason: null,
      eventSessionId: null,
      byPlatform: false,
    })

    expect(shown.before).toEqual({ startsAt: '2026-11-01T19:00:00.000Z' })
    expect(shown.after).toBeNull()
  })
})
