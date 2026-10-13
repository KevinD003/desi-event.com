import { describe, expect, it } from 'vitest'

import { nightFor } from '../src/lib/admission.js'
import {
  atVenueNothingLeftOutcome,
  nothingRefundedOutcome,
} from '../src/lib/session-cancellation.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { addRows, makeWorld, minutesFromNow, threeNightEventFixture } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * Cancelling one night of a live event (SPEC2-XI X-N): the night's tickets
 * are withdrawn and refunded, an every-night pass is kept for the others, and
 * nothing about the night comes back.
 *
 * @file @desi-event/api/tests/session-cancellation
 */

/** A reason long enough for every reason box. */
const REASON = 'The band cannot travel that night.'

/**
 * Sign in, and confirm a second factor when asked.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @param {object} [options] Options.
 * @param {boolean} [options.step] Whether to step up.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email, { step = true } = {}) {
  const headers = bearer(await signIn(app, email))

  if (step) await stepUp(app, email, headers)

  return headers
}

/**
 * The app with the three-night live event added, its payments known to the
 * in-memory provider so their refunds can be sent.
 *
 * @param {function(object, object): void} [shape] Changes the fixture (and the seed) before seeding.
 * @returns {Promise<object>} The harness and the fixture.
 */
async function threeNightApp(shape = () => {}) {
  const world = await makeWorld()
  const fixture = threeNightEventFixture(world.ids)

  shape(fixture, world)
  addRows(world.seed, fixture.rows)

  const harness = await createTestApp({ seed: world.seed, ids: world.ids })

  for (const payment of harness.prisma._store.payment) {
    if (payment.status !== 'SUCCEEDED') continue

    const intent = harness.providers.payments.createIntent({
      amountCents: payment.amountCents,
      currency: payment.currency,
      orderId: payment.orderId,
    })

    harness.providers.payments.capture(intent.id)
    payment.providerRef = intent.id
  }

  return { ...harness, fixture }
}

/**
 * The cancel request body.
 *
 * @param {number} expectedOrders The preview's count of touched orders.
 * @param {object} [extra] More fields.
 * @returns {object} The body.
 */
function body(expectedOrders, extra = {}) {
  return { revision: 0, reason: REASON, confirm: true, expectedOrders, ...extra }
}

describe('GET /v1/events/:id/sessions/:sessionId/cancellation', () => {
  it('counts what cancelling the second night would do, never cached', async () => {
    const { app, fixture } = await threeNightApp()
    const night = fixture.nights[1]

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancellation`,
      headers: await as(app, 'owner@rangoli.example', { step: false }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data).toMatchObject({
      sessionId: night.id,
      permitted: true,
      refusal: null,
      // The night-2 order is refunded; the every-night pass is kept and told.
      orders: 2,
      ordersRefunded: 1,
      ordersToldOnly: 1,
      zeroValueOrders: 0,
      disputedOrders: 0,
      ordersCancelled: 0,
      ticketsWithdrawn: 1,
      refundableCents: 80_000,
      currency: 'INR',
      paymentMode: 'MOCK',
    })

    await app.close()
  })

  it('is the 404 an unknown event gets for a stranger and a member who may not cancel', async () => {
    const { app, fixture } = await threeNightApp()
    const url = `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancellation`

    for (const email of ['arun@rangoli.example', 'rival@dhol.example', 'maya@desi-event.example']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: await as(app, email, { step: false }),
      })

      expect(response.statusCode, email).toBe(404)
    }

    await app.close()
  })

  it('tells the Desi-Event team it needs a sitting in this browser', async () => {
    const { app, fixture } = await threeNightApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancellation`,
      headers: await as(app, 'anil@desi-event.example', { step: false }),
    })

    expect(response.json().data.permitted).toBe(false)
    expect(response.json().data.missing).toMatch(/Open this event for editing/)

    await app.close()
  })
})

describe('POST /v1/events/:id/sessions/:sessionId/cancel', () => {
  it('cancels the night, closes its tiers, withdraws and refunds its tickets, and tells everyone it touched', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const night = fixture.nights[1]
    const headers = await as(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(2),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data.session).toMatchObject({
      id: night.id,
      status: 'CANCELLED',
      cancellationReason: REASON,
    })
    expect(response.json().data.refunds).toMatchObject({ owed: 1, settled: 1, amountCents: 80_000 })

    expect(prisma._store.ticketType.find((tier) => tier.id === fixture.tiers[1].id).status).toBe(
      'CLOSED',
    )
    // Night 2's order refunded in full; the others untouched.
    expect(prisma._store.order.find((row) => row.id === fixture.orders[1].id).status).toBe(
      'REFUNDED',
    )
    expect(prisma._store.order.find((row) => row.id === fixture.orders[0].id).status).toBe('PAID')
    expect(prisma._store.order.find((row) => row.id === fixture.passOrder.id).status).toBe('PAID')

    const refund = prisma._store.refund.find((row) => row.orderId === fixture.orders[1].id)

    expect(refund).toMatchObject({
      status: 'SUCCEEDED',
      reason: 'EVENT_CANCELLED',
      idempotencyKey: `session-cancelled:${night.id}:${fixture.orders[1].id}`,
    })

    // One notice per touched order, deduplicated by night and order.
    const notices = prisma._store.notificationOutbox.filter(
      (row) => row.template === 'event.session_cancelled',
    )

    expect(notices.map((row) => row.dedupeKey).sort()).toEqual(
      [
        `session-cancelled:${night.id}:${fixture.orders[1].id}`,
        `session-cancelled:${night.id}:${fixture.passOrder.id}`,
      ].sort(),
    )
    expect(
      notices.find((row) => row.payload.orderId === fixture.passOrder.id).payload,
    ).toMatchObject({ keptEveryNight: true, refunded: false, byPlatform: false })

    // One change notice for ticket holders, for that night.
    const changes = prisma._store.eventChangeNotice.filter(
      (row) => row.eventId === fixture.event.id,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'SESSION_CANCELLED', eventSessionId: night.id })

    const audit = prisma._store.auditLog.find((entry) => entry.action === 'event.session_cancelled')

    expect(audit.metadata).toMatchObject({ sessionId: night.id, reason: REASON })
    expect(audit.metadata.counts).toMatchObject({
      orders: 2,
      refundsReserved: 1,
      ordersToldOnly: 1,
    })

    // Final: a second cancel is refused.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(2, { revision: 1 }),
    })

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('NOT_EDITABLE')

    // And nothing more is sold or held for it.
    const hold = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: await as(app, 'priya@example.com', { step: false }),
      payload: { ticketTypeId: fixture.tiers[1].id, quantity: 1 },
    })

    expect(hold.statusCode).toBeGreaterThanOrEqual(400)
    expect(hold.statusCode).toBeLessThan(500)

    await app.close()
  })

  it('refuses a stale count of orders, writing nothing', async () => {
    const { app, prisma, fixture } = await threeNightApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancel`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(1),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('ORDERS_CHANGED')
    expect(prisma._store.eventSession.find((row) => row.id === fixture.nights[1].id).status).toBe(
      'SCHEDULED',
    )

    await app.close()
  })

  it('refuses a night that has started, by the hour before its doors', async () => {
    const { app, fixture } = await threeNightApp((shaped) => {
      // Doors in fifty minutes: inside the 60-minute margin.
      shaped.nights[0].startsAt = minutesFromNow(120)
      shaped.nights[0].doorsOpenAt = minutesFromNow(50)
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[0].id}/cancel`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(2),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('SESSION_STARTED')

    await app.close()
  })

  it('refuses the only night still on, and allows the last unstarted one once another has started', async () => {
    const { app, fixture } = await threeNightApp((shaped) => {
      shaped.nights[0].startsAt = minutesFromNow(-30)
      shaped.nights[0].endsAt = minutesFromNow(200)
      shaped.nights[1].status = 'CANCELLED'
      shaped.nights[1].cancelledAt = new Date()
    })
    const headers = await as(app, 'owner@rangoli.example')

    // Night 1 is under way and night 2 was cancelled: night 3 may still go.
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[2].id}/cancellation`,
      headers,
    })

    expect(preview.json().data.refusal).toBeNull()

    await app.close()

    const lone = await threeNightApp((shaped) => {
      for (const night of shaped.nights.slice(1)) {
        night.status = 'CANCELLED'
        night.cancelledAt = new Date()
      }
    })
    const last = await lone.app.inject({
      method: 'POST',
      url: `/v1/events/${lone.fixture.event.id}/sessions/${lone.fixture.nights[0].id}/cancel`,
      headers: await as(lone.app, 'owner@rangoli.example'),
      payload: body(2),
    })

    expect(last.statusCode).toBe(409)
    expect(last.json().error.code).toBe('LAST_SESSION')

    await lone.app.close()
  })

  it('refuses while somebody is paying for a ticket to the night', async () => {
    const { app, fixture } = await threeNightApp((shaped, world) => {
      const pending = {
        ...shaped.rows.order[1],
        id: cuid(),
        reference: 'DE-3NPEND',
        status: 'PENDING',
        paidAt: null,
      }

      shaped.rows.order.push(pending)
      shaped.rows.orderItem.push({ ...shaped.rows.orderItem[1], id: cuid(), orderId: pending.id })
      shaped.rows.payment.push({
        ...shaped.rows.payment[1],
        id: cuid(),
        orderId: pending.id,
        providerRef: 'pi_pending_night',
        status: 'PENDING',
      })
      void world
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancel`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(3),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PAYMENT_IN_FLIGHT')

    await app.close()
  })

  it('withdraws a free night ticket without a refund', async () => {
    const { app, prisma, fixture } = await threeNightApp((shaped) => {
      Object.assign(shaped.rows.order[1], { subtotalCents: 0, totalCents: 0 })
      Object.assign(shaped.rows.orderItem[1], { unitPriceCents: 0, subtotalCents: 0 })
      shaped.rows.payment.splice(1, 1)
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancel`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(2),
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.refund.filter((row) => row.orderId === fixture.orders[1].id)).toEqual([])

    const ticket = prisma._store.ticket.find((row) =>
      prisma._store.orderItem.some(
        (item) => item.id === row.orderItemId && item.orderId === fixture.orders[1].id,
      ),
    )

    expect(ticket).toMatchObject({
      status: 'CANCELLED',
      revokedReason: `session-cancelled:${fixture.nights[1].id}`,
      credentialHash: null,
    })

    await app.close()
  })

  it('withdraws a complimentary night ticket without a refund, and says it was free', async () => {
    const { app, prisma, fixture } = await threeNightApp((shaped) => {
      // Night 2's ticket was given away: a complimentary tier, an order of nothing.
      Object.assign(shaped.rows.ticketType[1], { complimentary: true, priceCents: 0 })
      Object.assign(shaped.rows.order[1], { subtotalCents: 0, totalCents: 0 })
      Object.assign(shaped.rows.orderItem[1], { unitPriceCents: 0, subtotalCents: 0 })
      shaped.rows.payment.splice(1, 1)
    })
    const night = fixture.nights[1]
    const headers = await as(app, 'owner@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancellation`,
      headers,
    })

    expect(preview.json().data).toMatchObject({
      orders: 2,
      ordersRefunded: 0,
      zeroValueOrders: 1,
      ticketsWithdrawn: 1,
      refundableCents: 0,
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(preview.json().data.orders),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(prisma._store.refund.filter((row) => row.orderId === fixture.orders[1].id)).toEqual([])

    const ticket = prisma._store.ticket.find((row) =>
      prisma._store.orderItem.some(
        (item) => item.id === row.orderItemId && item.orderId === fixture.orders[1].id,
      ),
    )

    // Withdrawn, so it admits nobody: no credential, a reason naming the night.
    expect(ticket).toMatchObject({
      status: 'CANCELLED',
      revokedReason: `session-cancelled:${night.id}`,
      credentialHash: null,
    })
    expect(
      prisma._store.notificationOutbox.find(
        (row) =>
          row.template === 'event.session_cancelled' &&
          row.payload.orderId === fixture.orders[1].id,
      ).payload,
    ).toMatchObject({ outcome: 'FREE', refunded: false })

    await app.close()
  })

  it('refuses a member who may not cancel with a 403, and needs the EVENT_CANCEL second factor', async () => {
    const { app, prisma, fixture, ids } = await threeNightApp()
    const url = `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancel`

    const manager = await app.inject({
      method: 'POST',
      url,
      headers: await as(app, 'arun@rangoli.example'),
      payload: body(2),
    })

    expect(manager.statusCode).toBe(403)

    const ownerHeaders = await as(app, 'owner@rangoli.example', { step: false })

    for (const session of prisma._store.session) {
      if (session.userId === ids.owner.id) {
        session.mfaSatisfiedAt = new Date(Date.now() - 6 * 60_000)
      }
    }

    const stale = await app.inject({ method: 'POST', url, headers: ownerHeaders, payload: body(2) })

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })

  it('lets the Desi-Event team cancel a night only in a sitting, recorded as theirs', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'anil@desi-event.example')
    const url = `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}/cancel`

    const without = await app.inject({ method: 'POST', url, headers, payload: body(2) })

    expect(without.statusCode).toBe(403)
    expect(without.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    const opened = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${fixture.event.id}/edit`,
      headers,
      payload: { reason: 'The organiser asked us to cancel night two.' },
    })

    expect(opened.statusCode).toBe(201)

    const response = await app.inject({ method: 'POST', url, headers, payload: body(2) })

    expect(response.statusCode).toBe(200)

    const audit = prisma._store.auditLog.find((entry) => entry.action === 'event.session_cancelled')

    expect(audit.metadata).toMatchObject({
      authority: 'PLATFORM',
      platformEditId: opened.json().data.id,
    })
    expect(
      prisma._store.eventChangeNotice.find((row) => row.kind === 'SESSION_CANCELLED').byPlatform,
    ).toBe(true)

    await app.close()
  })
})

describe('orders that are not simply refunded', () => {
  it('counts an unpaid order on the night, so the preview’s total confirms, and cancels it', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const night = fixture.nights[1]
    const paid = prisma._store.order.find((row) => row.reference === 'DE-3N02')
    const line = prisma._store.orderItem.find((item) => item.orderId === paid.id)
    const unpaidId = cuid()

    const promo = {
      id: cuid(),
      organizationId: fixture.event.organizationId,
      eventId: fixture.event.id,
      code: 'NIGHTTWO',
      type: 'PERCENTAGE',
      value: 1000,
      currency: null,
      maxRedemptions: 1,
      redemptionCount: 1,
      startsAt: null,
      endsAt: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const unpaidLine = cuid()

    // Somebody started buying a night-2 ticket with a promo code, named the
    // guest, and never paid: no payment.
    prisma._store.promoCode.push(promo)
    prisma._store.order.push({
      ...paid,
      id: unpaidId,
      reference: 'DE-3NPEND',
      status: 'PENDING',
      promoCodeId: promo.id,
      paidAt: null,
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    prisma._store.orderItem.push({
      ...line,
      id: unpaidLine,
      orderId: unpaidId,
      attendeeNames: ['Asha Patel'],
      refundedCents: 0,
      refundedQuantity: 0,
    })

    const headers = await as(app, 'owner@rangoli.example')
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancellation`,
      headers,
    })
    const counts = preview.json().data

    expect(counts).toMatchObject({
      orders: 3,
      ordersRefunded: 1,
      ordersToldOnly: 1,
      zeroValueOrders: 0,
      disputedOrders: 0,
      ordersCancelled: 1,
    })
    // Every touched order is counted once.
    expect(
      counts.ordersRefunded +
        counts.ordersToldOnly +
        counts.zeroValueOrders +
        counts.disputedOrders +
        counts.ordersCancelled,
    ).toBe(counts.orders)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(counts.orders),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(prisma._store.order.find((row) => row.id === unpaidId).status).toBe('CANCELLED')
    // Cancelled as a declined checkout is: the code's use back, the name gone, audited.
    expect(promo.redemptionCount).toBe(0)
    expect(prisma._store.orderItem.find((row) => row.id === unpaidLine).attendeeNames).toEqual([])
    expect(
      prisma._store.auditLog.find(
        (row) => row.action === 'order.cancelled' && row.entityId === unpaidId,
      ).metadata,
    ).toMatchObject({ reason: 'SESSION_CANCELLED', promoRedemptionReturned: true })

    const notice = prisma._store.notificationOutbox.find(
      (row) => row.template === 'event.session_cancelled' && row.payload.orderId === unpaidId,
    )

    expect(notice.payload).toMatchObject({
      outcome: 'UNPAID',
      refunded: false,
      keptEveryNight: false,
    })

    await app.close()
  })

  it('leaves a disputed order to the finance team, with a task, and does not call it free', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const night = fixture.nights[1]
    const order = prisma._store.order.find((row) => row.reference === 'DE-3N02')
    const payment = prisma._store.payment.find(
      (row) => row.orderId === order.id && row.status === 'SUCCEEDED',
    )

    prisma._store.dispute.push({
      id: cuid(),
      paymentId: payment.id,
      provider: 'MOCK',
      providerDisputeId: 'dp_night_two',
      amountCents: payment.amountCents,
      currency: payment.currency,
      reason: null,
      status: 'NEEDS_RESPONSE',
      evidenceDueAt: null,
      rawProviderStatus: null,
      fundsWithheld: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
    })

    const headers = await as(app, 'owner@rangoli.example')
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancellation`,
      headers,
    })

    expect(preview.json().data).toMatchObject({ orders: 2, disputedOrders: 1, ordersRefunded: 0 })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(2),
    })

    expect(response.statusCode, response.body).toBe(200)

    // No refund was asked for; the money is the dispute's.
    expect(prisma._store.refund.filter((row) => row.orderId === order.id)).toHaveLength(0)

    const notice = prisma._store.notificationOutbox.find(
      (row) => row.template === 'event.session_cancelled' && row.payload.orderId === order.id,
    )

    expect(notice.payload).toMatchObject({ outcome: 'DISPUTED', refunded: false })

    // The finance team is told, as a cancelled event's disputed order is.
    const tasks = prisma._store.reconciliationTask.filter((row) => row.paymentId === payment.id)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: 'PROVIDER_MISMATCH', state: 'OPEN', orderId: order.id })
    expect(tasks[0].localState).toMatchObject({
      disputeStatus: 'NEEDS_RESPONSE',
      sessionId: night.id,
    })
    expect(tasks[0].lastError).toMatch(/night of the event was cancelled while this payment/)

    await app.close()
  })

  it('records the outcome of each order it tells, refunded or kept', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const night = fixture.nights[1]

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(2),
    })

    expect(response.statusCode, response.body).toBe(200)

    const outcomeOf = (reference) => {
      const order = prisma._store.order.find((row) => row.reference === reference)

      return prisma._store.notificationOutbox.find(
        (row) => row.template === 'event.session_cancelled' && row.payload.orderId === order.id,
      ).payload
    }

    expect(outcomeOf('DE-3N02')).toMatchObject({ outcome: 'REFUNDED', refunded: true })
    expect(outcomeOf('DE-3NPASS')).toMatchObject({ outcome: 'KEPT', keptEveryNight: true })

    await app.close()
  })
})

describe('the door and a cancelled night', () => {
  it('admits nobody to a cancelled night, whatever the ticket', () => {
    const nights = [
      { id: 'n1', status: 'SCHEDULED' },
      { id: 'n2', status: 'CANCELLED' },
    ]
    const everyNight = { orderItem: { ticketType: { eventSessionId: null } }, eventSeat: null }
    const nightTwo = { orderItem: { ticketType: { eventSessionId: 'n2' } }, eventSeat: null }

    expect(nightFor(everyNight, nights, 'n2')).toMatchObject({ refusal: 'SESSION_CANCELLED' })
    expect(nightFor(nightTwo, nights, 'n2')).toMatchObject({ refusal: 'SESSION_CANCELLED' })
    expect(nightFor(everyNight, nights, 'n1')).toMatchObject({ refusal: null, night: 'n1' })
  })

  it('admits to the one night left without being told which, and refuses the cancelled ones', () => {
    const nights = [
      { id: 'n1', status: 'SCHEDULED' },
      { id: 'n2', status: 'CANCELLED' },
      { id: 'n3', status: 'CANCELLED' },
    ]
    const everyNight = { orderItem: { ticketType: { eventSessionId: null } }, eventSeat: null }
    const nightOne = { orderItem: { ticketType: { eventSessionId: 'n1' } }, eventSeat: null }
    const nightTwo = { orderItem: { ticketType: { eventSessionId: 'n2' } }, eventSeat: null }

    // The door lists one night and names none: that night is the one.
    expect(nightFor(nightOne, nights, null)).toEqual({
      night: 'n1',
      everyNight: false,
      refusal: null,
    })
    // A pass is still good for every night, and is admitted on the one left.
    expect(nightFor(everyNight, nights, null)).toEqual({
      night: 'n1',
      everyNight: true,
      refusal: null,
    })
    // A ticket for a cancelled night is told so, named or not.
    expect(nightFor(nightTwo, nights, null)).toMatchObject({ refusal: 'SESSION_CANCELLED' })
    expect(nightFor(nightTwo, nights, 'n1')).toMatchObject({ refusal: 'SESSION_CANCELLED' })

    // Two nights still on: the door must still say which.
    const two = [
      { id: 'n1', status: 'SCHEDULED' },
      { id: 'n2', status: 'CANCELLED' },
      { id: 'n3', status: 'SCHEDULED' },
    ]

    expect(nightFor(nightOne, two, null)).toMatchObject({ refusal: 'NIGHT_REQUIRED' })
    expect(nightFor(everyNight, two, null)).toMatchObject({ refusal: 'NIGHT_REQUIRED' })
  })

  it('lets the door admit to the last night once the others are cancelled, naming none', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const owner = await as(app, 'owner@rangoli.example')

    for (const night of [fixture.nights[1], fixture.nights[2]]) {
      const preview = await app.inject({
        method: 'GET',
        url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancellation`,
        headers: owner,
      })
      const revision = prisma._store.event.find((row) => row.id === fixture.event.id).revision
      const cancelled = await app.inject({
        method: 'POST',
        url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
        headers: owner,
        payload: { ...body(preview.json().data.orders), revision },
      })

      expect(cancelled.statusCode, cancelled.body).toBe(200)
    }

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/tickets/admission/events',
      headers: owner,
    })
    const entry = listed.json().data.find((row) => (row.event?.id ?? row.id) === fixture.event.id)

    // One night is offered, so the door names none (door-workspace.jsx).
    expect(entry.sessions.map((night) => night.id)).toEqual([fixture.nights[0].id])

    const ticketOf = (reference) => {
      const order = prisma._store.order.find((row) => row.reference === reference)

      return prisma._store.ticket.find((ticket) =>
        prisma._store.orderItem.some(
          (item) => item.id === ticket.orderItemId && item.orderId === order.id,
        ),
      )
    }

    for (const reference of ['DE-3N01', 'DE-3NPASS']) {
      const looked = await app.inject({
        method: 'POST',
        url: '/v1/tickets/admission/preview',
        headers: owner,
        payload: { code: ticketOf(reference).code, expectedEventId: fixture.event.id },
      })

      expect(looked.statusCode, looked.body).toBe(200)
      expect(looked.json().data.refusal ?? null, reference).toBeNull()
      expect(looked.json().data.outcome, reference).toBe('ADMISSIBLE')
    }

    await app.close()
  })
})

/**
 * A booking paid at the venue whose whole booking fee a referral code waived
 * (SPEC3-XI XR2's zero-online booking): PAID, nothing paid online, no
 * payment, one ticket for a night owing its price at the door, the code's use
 * taken.
 *
 * @param {object} fixture `threeNightEventFixture`'s result.
 * @param {object} buyer The buyer's account.
 * @param {object} options Options.
 * @param {object} options.tier The night's tier.
 * @param {string} options.codeId The code's id.
 * @param {string} options.reference The booking's reference.
 * @returns {object} The rows to add.
 */
function waivedNightBooking(fixture, buyer, { tier, codeId, reference }) {
  const paidAt = new Date('2026-09-01T12:00:00.000Z')
  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: fixture.event.id,
    eventSessionId: tier.eventSessionId,
    userId: buyer.id,
    buyerEmail: buyer.email,
    buyerName: buyer.displayName,
    status: 'PAID',
    currency: 'INR',
    subtotalCents: tier.priceCents,
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    totalCents: 0,
    promoCodeId: null,
    refundedCents: 0,
    refundPendingCents: 0,
    expiresAt: null,
    paidAt,
    cancelledAt: null,
    createdAt: paidAt,
    updatedAt: paidAt,
    paymentMethod: 'AT_VENUE',
    feeGrossCents: 2_400,
    feeWaivedCents: 2_400,
    referralCodeId: codeId,
    referralUseReturnedAt: null,
    referralUseReturnCause: null,
    venueDueCents: tier.priceCents,
    venueCancelledBasisCents: 0,
    venueFeeKeptCents: 0,
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId: tier.id,
    quantity: 1,
    unitPriceCents: tier.priceCents,
    subtotalCents: tier.priceCents,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
    venueDueCents: tier.priceCents,
    venueCancelledQuantity: 0,
  }
  const ticket = {
    id: cuid(),
    orderItemId: item.id,
    code: `${reference}-1`,
    credentialHash: `${reference.toLowerCase()}-pass`,
    credentialVersion: 1,
    credentialIssuedAt: paidAt,
    attendeeName: null,
    ownerUserId: buyer.id,
    eventSeatId: null,
    status: 'VALID',
    checkedInAt: null,
    revokedAt: null,
    revokedReason: null,
    supersedesTicketId: null,
    venueDueCents: tier.priceCents,
    venuePaymentId: null,
    venueCancellationId: null,
    createdAt: paidAt,
    updatedAt: paidAt,
  }
  const createdAt = new Date('2026-08-01T00:00:00.000Z')
  const code = {
    id: codeId,
    code: `FRIENDS-${reference}`,
    label: null,
    scope: 'ALL_EVENTS',
    expiresAt: null,
    maxUses: null,
    useCount: 1,
    active: true,
    switchedOffAt: null,
    createdById: null,
    updatedById: null,
    createdAt,
    updatedAt: createdAt,
  }

  return { order: [order], orderItem: [item], ticket: [ticket], referralCode: [code] }
}

describe('the lock law and the referral uses (SPEC3-XI §2.3.1, XR4)', () => {
  it('locks every paid order of the night, sorted, before withdrawing a ticket, and gives a waived booking’s use back last, in one batch', async () => {
    const codeId = cuid()
    let reference = null
    const { app, prisma, fixture } = await threeNightApp((shape, world) => {
      reference = 'DE-3NWAIVED'
      addRows(
        shape.rows,
        waivedNightBooking(shape, world.ids.attendee, {
          tier: shape.tiers[1],
          codeId,
          reference,
        }),
      )
    })
    const night = fixture.nights[1]
    const headers = await as(app, 'owner@rangoli.example')
    const from = prisma.lockLog.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: body(3),
    })

    expect(response.statusCode, response.body).toBe(200)

    const waived = prisma._store.order.find((row) => row.reference === reference)
    const log = prisma.lockLog.slice(from)
    const cancelling = log.find((entry) => entry.table === 'EventSession').transaction
    const inTransaction = log.filter((entry) => entry.transaction === cancelling)
    const firstTicketWrite = inTransaction.findIndex(
      (entry) => entry.table === 'Ticket' && entry.kind === 'write',
    )
    const orderLocks = inTransaction
      .slice(0, firstTicketWrite)
      .filter((entry) => entry.table === 'Order' && entry.kind === 'lock')
      .map((entry) => entry.id)
    const paidOnNight = [fixture.orders[1].id, waived.id].sort()

    // Both paid orders with tickets on the night, ascending, before any ticket.
    expect(orderLocks).toEqual(paidOnNight)

    const codeAt = inTransaction.findIndex((entry) => entry.table === 'ReferralCode')
    const lastRowWrite = inTransaction
      .map(
        (entry) =>
          entry.kind === 'write' &&
          ['Order', 'OrderItem', 'Ticket', 'EventSeat'].includes(entry.table),
      )
      .lastIndexOf(true)

    expect(codeAt).toBeGreaterThan(lastRowWrite)

    // The waived booking ended: nothing online, its only ticket withdrawn.
    expect(waived).toMatchObject({ status: 'PAID', referralUseReturnCause: 'SESSION_CANCELLED' })
    expect(prisma._store.referralCode.find((row) => row.id === codeId).useCount).toBe(0)
    expect(
      prisma._store.auditLog.filter((row) => row.action === 'referral_code.use_returned'),
    ).toHaveLength(1)

    // Its notice says nothing was paid online.
    const notice = prisma._store.notificationOutbox.find(
      (row) => row.dedupeKey === `session-cancelled:${night.id}:${waived.id}`,
    )

    expect(notice.payload).toMatchObject({ outcome: 'NOTHING_PAID_ONLINE', atVenue: true })

    await app.close()
  })
})

describe('a night withdrawn with nothing refunded: what a booking paid at the venue is told (codes review)', () => {
  /**
   * A pay-at-the-venue booking of two $40 tickets with a $6.70 fee.
   *
   * @param {object} [overrides] Columns to change.
   * @returns {object} The order.
   */
  function booked(overrides = {}) {
    return {
      paymentMethod: 'AT_VENUE',
      subtotalCents: 8_000,
      discountCents: 0,
      totalCents: 670,
      refundedCents: 0,
      refundPendingCents: 0,
      venueFeeKeptCents: 0,
      ...overrides,
    }
  }

  it('says nothing was paid online only for a booking that paid nothing online', () => {
    expect(nothingRefundedOutcome(booked({ totalCents: 0 }))).toBe('NOTHING_PAID_ONLINE')
    expect(atVenueNothingLeftOutcome(booked({ totalCents: 0 }))).toBe('NOTHING_PAID_ONLINE')
  })

  it('says the fee was refunded earlier when an administrator refunded all of it by hand', () => {
    expect(nothingRefundedOutcome(booked({ refundedCents: 670 }))).toBe('FEE_REFUNDED_EARLIER')
  })

  it('says only that nothing is left to refund when part of the fee was kept, or is held for other tickets', () => {
    expect(nothingRefundedOutcome(booked({ refundedCents: 335, venueFeeKeptCents: 335 }))).toBe(
      'NOTHING_OWED',
    )
    expect(atVenueNothingLeftOutcome(booked())).toBe('NOTHING_OWED')
  })

  it('keeps free tickets and card orders as they were', () => {
    expect(nothingRefundedOutcome(booked({ subtotalCents: 0, totalCents: 0 }))).toBe('FREE')
    expect(nothingRefundedOutcome(booked({ paymentMethod: 'CARD' }))).toBe('NOTHING_OWED')
  })
})
