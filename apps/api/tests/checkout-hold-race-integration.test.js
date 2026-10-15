/**
 * A hold changing hands at checkout, against a real database.
 *
 * A hold an order is waiting on belongs to that order until its payment is
 * confirmed or refused. Two paths used to decide from an unlocked read of the
 * hold and write later, and both cost a buyer money:
 *
 *  - `DELETE /v1/holds/:id` racing `POST /v1/orders` on the same hold released
 *    it after the order had attached it: the seats went back on sale, the card
 *    was charged, and settlement refused to issue seatless tickets — a charge
 *    with no ticket and nothing to reconcile it.
 *  - Two checkouts spending one hold (a double submit, or a retry after a
 *    capture timed out) both succeeded: stock sold past the tier and the
 *    night's capacity, and the buyer paid twice.
 *
 * Both now lock the hold row before reading it, and checkout refuses a hold a
 * PENDING order is waiting on. The interleavings are forced, not hoped for: an
 * outside transaction holds the row (or a seat, or a capture is held open)
 * while the requests queue behind it, and `pg_blocking_pids` says when they
 * have. Also here: a settlement that refuses after the capture opens a
 * reconciliation task rather than leaving the charge unread, and a seat hold
 * racing the removal of its night answers 422 rather than a foreign-key 500.
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/checkout-hold-race-integration
 */

import { createHash } from 'node:crypto'

import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  createInMemoryProviderRegistry,
} from '@desi-event/providers'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { prepareInventory } from '../src/lib/event-authoring.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, reachable, when } = await connectTestDatabase('the checkout hold race suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256')
    .update(`checkout-hold-race-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

let app
let providers
let world

/** The provider's own capture, restored after each test that wraps it. */
let originalCapture

/**
 * Bearer headers for a real session.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'checkout-hold-race-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * A user row.
 *
 * @param {string} label Distinguishes it.
 * @param {string} [role] The platform role.
 * @returns {Promise<object>} The user.
 */
function user(label, role = 'ATTENDEE') {
  return prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${RUN}@checkout-hold-race.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })
}

/**
 * A published event on sale.
 *
 * @param {string} label Distinguishes it.
 * @param {Date} startsAt When it starts.
 * @returns {Promise<object>} The event.
 */
function onSaleEvent(label, startsAt) {
  return prisma.event.create({
    data: {
      id: id('event'),
      organizationId: world.organization.id,
      venueId: world.venue.id,
      title: `Race ${label} ${RUN}`,
      slug: `race-${label}-${RUN}`,
      summary: 'Seeded for the checkout hold race suite.',
      description: 'Seeded for the checkout hold race suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status: 'ON_SALE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      timezone: 'America/Chicago',
      publishedAt: new Date(),
      salesOpenedAt: new Date(),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
}

/**
 * A seated night: one row of three seats in one price zone, one reserved tier,
 * inventory prepared. With `secondNight`, the event has another night, so the
 * seated one is not its last and may be removed.
 *
 * @param {string} label Distinguishes it.
 * @param {object} [options] Options.
 * @param {boolean} [options.secondNight] Add a second night.
 * @returns {Promise<object>} The rows, and the seat ids by label.
 */
async function seatedEvent(label, { secondNight = false } = {}) {
  const startsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
  const map = await prisma.venueMap.create({
    data: { id: id('map'), venueId: world.venue.id, name: `Plan ${label} ${RUN}` },
  })
  const version = await prisma.venueMapVersion.create({
    data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: 3 },
  })
  const section = await prisma.section.create({
    data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })
  const row = await prisma.seatRow.create({
    data: {
      id: id('row'),
      venueMapVersionId: version.id,
      sectionId: section.id,
      label: 'A',
      sortOrder: 1,
    },
  })
  const zone = await prisma.priceZone.create({
    data: { id: id('zone'), venueMapVersionId: version.id, name: 'Front', sortOrder: 1 },
  })

  const seatIdByLabel = {}
  for (const [index, seatLabel] of ['A1', 'A2', 'A3'].entries()) {
    const seat = await prisma.seat.create({
      data: {
        id: id(`seat-${seatLabel}`),
        venueMapVersionId: version.id,
        sectionId: section.id,
        rowId: row.id,
        label: seatLabel,
        sortOrder: index + 1,
        priceZoneId: zone.id,
      },
    })
    seatIdByLabel[seatLabel] = seat.id
  }

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const event = await onSaleEvent(`seated-${label}`, startsAt)
  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      timezone: 'America/Chicago',
      label: 'Night 1',
      venueMapVersionId: version.id,
    },
  })

  if (secondNight) {
    const later = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    await prisma.eventSession.create({
      data: {
        id: id('session-2'),
        eventId: event.id,
        startsAt: later,
        endsAt: new Date(later.getTime() + 4 * 60 * 60 * 1000),
        timezone: 'America/Chicago',
        label: 'Night 2',
        capacity: 10,
      },
    })
  }

  const tier = await prisma.ticketType.create({
    data: {
      id: id('tier-front'),
      eventId: event.id,
      name: `Front ${label}`,
      priceCents: 6000,
      currency: 'USD',
      quantityTotal: 0,
      maxPerOrder: 6,
      status: 'ON_SALE',
      reserved: true,
      eventSessionId: session.id,
      priceZoneId: zone.id,
    },
  })

  await prepareInventory(prisma, {
    event: { ...event, sessions: [session] },
    sessionId: session.id,
    actor: world.owner,
  })

  const eventSeats = await prisma.eventSeat.findMany({ where: { eventSessionId: session.id } })
  const eventSeatIdByLabel = Object.fromEntries(
    Object.entries(seatIdByLabel).map(([seatLabel, seatId]) => [
      seatLabel,
      eventSeats.find((candidate) => candidate.seatId === seatId).id,
    ]),
  )

  return { event, session, tier, seatIdByLabel, eventSeatIdByLabel }
}

/**
 * A general-admission night with a capacity, and one tier for it.
 *
 * @param {string} label Distinguishes it.
 * @param {object} options Options.
 * @param {number} options.capacity The night's capacity.
 * @param {number} options.quantityTotal The tier's stock.
 * @returns {Promise<object>} The rows.
 */
async function generalEvent(label, { capacity, quantityTotal }) {
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const event = await onSaleEvent(`ga-${label}`, startsAt)
  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      timezone: 'America/Chicago',
      capacity,
    },
  })
  const tier = await prisma.ticketType.create({
    data: {
      id: id('tier-general'),
      eventId: event.id,
      name: `General ${label}`,
      priceCents: 4000,
      currency: 'USD',
      quantityTotal,
      maxPerOrder: 10,
      status: 'ON_SALE',
      eventSessionId: session.id,
    },
  })

  return { event, session, tier }
}

/**
 * Hold seats as the buyer.
 *
 * @param {object} seated From {@link seatedEvent}.
 * @param {string[]} labels Seat labels.
 * @returns {Promise<string>} The hold id.
 */
async function holdSeats(seated, labels) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${seated.session.id}/holds`,
    headers: world.buyer.headers,
    payload: { seatIds: labels.map((seatLabel) => seated.seatIdByLabel[seatLabel]) },
  })

  expect(response.statusCode).toBe(201)

  return response.json().data.id
}

/**
 * Hold general-admission stock as the buyer.
 *
 * @param {object} general From {@link generalEvent}.
 * @param {number} quantity How many.
 * @returns {Promise<string>} The hold id.
 */
async function holdStock(general, quantity) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/holds',
    headers: world.buyer.headers,
    payload: { ticketTypeId: general.tier.id, quantity },
  })

  expect(response.statusCode).toBe(201)

  return response.json().data.id
}

/**
 * Place an order as the buyer.
 *
 * @param {object} event The event.
 * @param {string} ticketTypeId The tier.
 * @param {number} quantity How many.
 * @param {string|null} holdId The hold to spend, or null to buy with none.
 * @param {Record<string, string>} [headers] Extra headers, such as an `Idempotency-Key`.
 * @returns {Promise<object>} The inject result.
 */
function placeOrder(event, ticketTypeId, quantity, holdId, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: { ...world.buyer.headers, ...headers },
    payload: {
      eventId: event.id,
      buyerEmail: world.buyer.user.email,
      buyerName: 'Race Buyer',
      items: [{ ticketTypeId, quantity }],
      ...(holdId ? { holdIds: [holdId] } : {}),
    },
  })
}

/**
 * Release a hold as the buyer.
 *
 * @param {string} holdId The hold.
 * @returns {Promise<object>} The inject result.
 */
function releaseHold(holdId) {
  return app.inject({
    method: 'DELETE',
    url: `/v1/holds/${holdId}`,
    headers: world.buyer.headers,
  })
}

/**
 * Hold one row locked from outside the app until `open()` is called.
 *
 * @param {string} table `TicketHold` or `EventSeat`.
 * @param {string} rowId The row.
 * @returns {Promise<{pid: number, open: function(): Promise<void>}>} The locking backend and its release.
 */
async function lockFromOutside(table, rowId) {
  let open
  const gate = new Promise((resolve) => {
    open = resolve
  })
  let ready
  const locked = new Promise((resolve) => {
    ready = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      if (table === 'TicketHold') {
        await tx.$queryRaw`SELECT id FROM "TicketHold" WHERE id = ${rowId} FOR UPDATE`
      } else {
        await tx.$queryRaw`SELECT id FROM "EventSeat" WHERE id = ${rowId} FOR UPDATE`
      }

      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`
      ready(pid)
      await gate
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  const pid = await locked

  return {
    pid,
    open: async () => {
      open()
      await done
    },
  }
}

/**
 * Wait until some backend other than `known` is blocked by one of `blockers`.
 *
 * @param {number[]} blockers Backends whose locks are being waited on.
 * @param {number[]} [known] Waiters already accounted for.
 * @returns {Promise<number>} The newly blocked backend.
 */
async function waitForWaiter(blockers, known = []) {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database()
        AND NOT (pid = ANY(${known}::int[]))
        AND pg_blocking_pids(pid) && ${blockers}::int[]`

    if (rows.length > 0) return rows[0].pid

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`nothing queued behind ${blockers.join(', ')} within 15 seconds`)
}

/**
 * Hold the next capture open until `open()` is called.
 *
 * @returns {{reached: Promise<void>, open: function(): void}} When the capture was reached, and its release.
 */
function holdNextCaptureOpen() {
  let open
  const gate = new Promise((resolve) => {
    open = resolve
  })
  let reach
  const reached = new Promise((resolve) => {
    reach = resolve
  })
  let first = true

  providers.payments.capture = async (...args) => {
    if (first) {
      first = false
      reach()
      await gate
    }

    return originalCapture(...args)
  }

  return { reached, open }
}

/**
 * Make the next capture time out: the provider says nothing definite.
 *
 * @returns {void} Nothing.
 */
function timeOutNextCapture() {
  let first = true

  providers.payments.capture = async (reference, settings) => {
    if (first) {
      first = false
      const intentId = typeof reference === 'string' ? reference : reference?.id

      throw new ProviderError(
        PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT,
        `Capture of payment intent ${intentId} timed out`,
        { provider: providers.payments.name, details: { intentId } },
      )
    }

    return originalCapture(reference, settings)
  }
}

/**
 * Every order of an event, with its payments and tickets.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} The orders, oldest first.
 */
function ordersOf(eventId) {
  return prisma.order.findMany({
    where: { eventId },
    include: { payments: true, items: { include: { tickets: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

beforeAll(async () => {
  if (!reachable) return

  providers = createInMemoryProviderRegistry({ payments: { idPrefix: `pirace${RUN}` } })
  originalCapture = providers.payments.capture.bind(providers.payments)

  app = await buildApp({
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Checkout race ${RUN}`,
      slug: `checkout-race-${RUN}`,
      contactEmail: `hello-${RUN}@checkout-hold-race.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `Race Hall ${RUN}`,
      slug: `race-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      organizationId: organization.id,
    },
  })
  const owner = await user('owner', 'ORGANIZER')

  await prisma.mfaFactor.create({
    data: {
      id: id('factor'),
      userId: owner.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })
  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  const buyer = await user('buyer')

  world = { organization, venue, owner }
  world.ownerHeaders = await sessionFor(owner)
  world.buyer = { user: buyer, headers: await sessionFor(buyer) }
})

afterEach(() => {
  if (providers && originalCapture) providers.payments.capture = originalCapture
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

when()('a hold changing hands at checkout, on a real database', () => {
  it('a release queued ahead of a checkout on one seat hold releases it, and the checkout charges nothing', async () => {
    const seated = await seatedEvent('release-first')
    const holdId = await holdSeats(seated, ['A2'])
    const intentsBefore = providers.payments.listIntents().length

    const outside = await lockFromOutside('TicketHold', holdId)
    const release = releaseHold(holdId)
    const releasing = await waitForWaiter([outside.pid])
    const order = placeOrder(seated.event, seated.tier.id, 1, holdId)
    await waitForWaiter([outside.pid, releasing], [releasing])
    await outside.open()

    const [released, ordered] = await Promise.all([release, order])

    expect(released.statusCode).toBe(200)
    expect(ordered.statusCode).toBe(410)
    expect(ordered.json().error.code).toBe('HOLD_EXPIRED')

    // Nothing was written for the order and nothing was sent to the provider.
    expect(await ordersOf(seated.event.id)).toHaveLength(0)
    expect(providers.payments.listIntents()).toHaveLength(intentsBefore)
    expect(
      await prisma.eventSeat.findUnique({ where: { id: seated.eventSeatIdByLabel.A2 } }),
    ).toMatchObject({ status: 'AVAILABLE', holdId: null })
  })

  it('a checkout queued ahead of a release keeps the hold, and the paid order has its seat', async () => {
    const seated = await seatedEvent('order-first')
    const holdId = await holdSeats(seated, ['A2'])

    const outside = await lockFromOutside('TicketHold', holdId)
    const order = placeOrder(seated.event, seated.tier.id, 1, holdId)
    const ordering = await waitForWaiter([outside.pid])
    const release = releaseHold(holdId)
    await waitForWaiter([outside.pid, ordering], [ordering])
    await outside.open()

    const [ordered, released] = await Promise.all([order, release])

    expect(ordered.statusCode).toBe(201)
    expect(released.statusCode).toBe(409)

    const [paid] = await ordersOf(seated.event.id)
    expect(paid.status).toBe('PAID')
    expect(paid.payments.map((payment) => payment.status)).toEqual(['SUCCEEDED'])

    const tickets = paid.items.flatMap((item) => item.tickets)
    expect(tickets).toHaveLength(1)
    expect(tickets[0].eventSeatId).toBe(seated.eventSeatIdByLabel.A2)
    expect(
      await prisma.eventSeat.findUnique({ where: { id: seated.eventSeatIdByLabel.A2 } }),
    ).toMatchObject({ status: 'SOLD', holdId: null })
    expect(await prisma.ticketHold.findUnique({ where: { id: holdId } })).toMatchObject({
      status: 'CONVERTED',
      orderId: paid.id,
    })
  })

  it('never leaves a charge without its ticket when a release and a checkout race freely', async () => {
    for (let round = 0; round < 6; round += 1) {
      const seated = await seatedEvent(`free-${round}`)
      const holdId = await holdSeats(seated, ['A1'])

      const [ordered, released] = await Promise.all([
        placeOrder(seated.event, seated.tier.id, 1, holdId),
        new Promise((resolve) => setTimeout(resolve, round % 3)).then(() => releaseHold(holdId)),
      ])

      // One of two clean outcomes, never a 500.
      expect([
        [201, 409],
        [410, 200],
      ]).toContainEqual([ordered.statusCode, released.statusCode])

      const orders = await ordersOf(seated.event.id)
      const seat = await prisma.eventSeat.findUnique({
        where: { id: seated.eventSeatIdByLabel.A1 },
      })

      for (const placed of orders) {
        expect(placed.status).toBe('PAID')
        expect(placed.items.flatMap((item) => item.tickets)).toHaveLength(1)
      }

      expect(seat.status).toBe(orders.length === 1 ? 'SOLD' : 'AVAILABLE')
    }
  })

  it('refuses a second checkout of one general-admission hold while the first is being charged', async () => {
    const general = await generalEvent('double', { capacity: 2, quantityTotal: 2 })
    const holdId = await holdStock(general, 2)

    const capture = holdNextCaptureOpen()
    const first = placeOrder(general.event, general.tier.id, 2, holdId)
    await capture.reached

    // The first order is committed PENDING with the hold attached, and its
    // card is being charged. The same basket again must not sell the stock a
    // second time.
    const second = await placeOrder(general.event, general.tier.id, 2, holdId)
    capture.open()
    const firstDone = await first

    expect(second.statusCode).toBe(409)
    expect(second.json().error.message).toMatch(/still being confirmed/)
    expect(firstDone.statusCode).toBe(201)

    const orders = await ordersOf(general.event.id)
    expect(orders.map((placed) => placed.status)).toEqual(['PAID'])

    const tier = await prisma.ticketType.findUnique({ where: { id: general.tier.id } })
    expect(tier.quantitySold).toBe(2)
    expect(await prisma.ticket.count({ where: { orderItem: { ticketTypeId: tier.id } } })).toBe(2)
  })

  it('refuses a second checkout of one seat hold before it charges anybody', async () => {
    const seated = await seatedEvent('double-seat')
    const holdId = await holdSeats(seated, ['A3'])

    const capture = holdNextCaptureOpen()
    const first = placeOrder(seated.event, seated.tier.id, 1, holdId)
    await capture.reached

    const intentsBefore = providers.payments.listIntents().length
    const second = await placeOrder(seated.event, seated.tier.id, 1, holdId)
    capture.open()
    const firstDone = await first

    expect(second.statusCode).toBe(409)
    expect(firstDone.statusCode).toBe(201)

    // The refusal came before the provider: no second intent, no second order.
    expect(providers.payments.listIntents()).toHaveLength(intentsBefore)

    const orders = await ordersOf(seated.event.id)
    expect(orders.map((placed) => placed.status)).toEqual(['PAID'])
    expect(orders[0].payments.map((payment) => payment.status)).toEqual(['SUCCEEDED'])
  })

  it('refuses a retry after a timed-out capture while the first order waits on its payment', async () => {
    const general = await generalEvent('retry', { capacity: 2, quantityTotal: 2 })
    const holdId = await holdStock(general, 2)

    timeOutNextCapture()
    const first = await placeOrder(general.event, general.tier.id, 2, holdId)
    expect(first.statusCode).toBe(502)

    const retry = await placeOrder(general.event, general.tier.id, 2, holdId)
    expect(retry.statusCode).toBe(409)
    expect(retry.json().error.message).toMatch(/still being confirmed/)

    const orders = await ordersOf(general.event.id)
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('PENDING')
    expect(orders[0].payments).toMatchObject([{ status: 'TIMEOUT', reconciliationRequired: true }])

    // The hold stays with the order it was spent on.
    expect(await prisma.ticketHold.findUnique({ where: { id: holdId } })).toMatchObject({
      status: 'ACTIVE',
      orderId: orders[0].id,
    })
    expect(
      (await prisma.ticketType.findUnique({ where: { id: general.tier.id } })).quantitySold,
    ).toBe(0)
  })

  it('answers a retry of the same attempt after a timed-out capture with the pending order, not a booking', async () => {
    // What the site does after a lost answer: Pay again with the same key. The
    // first answer was a 502; the retry used to be a 201 carrying the PENDING
    // order, which the checkout read as "Booked".
    const seated = await seatedEvent('replay')
    const holdId = await holdSeats(seated, ['A2'])
    const attempt = { 'idempotency-key': `replay-${RUN}` }

    timeOutNextCapture()
    const first = await placeOrder(seated.event, seated.tier.id, 1, holdId, attempt)
    const [pending] = await ordersOf(seated.event.id)

    expect(first.statusCode).toBe(502)
    expect(first.json().error).toMatchObject({
      code: 'PAYMENT_TIMEOUT',
      orderReference: pending.reference,
    })

    const retry = await placeOrder(seated.event, seated.tier.id, 1, holdId, attempt)

    expect(retry.statusCode).toBe(409)
    expect(retry.json().error).toMatchObject({
      code: 'ORDER_PENDING',
      orderReference: pending.reference,
    })
    expect(retry.json().error.message).toMatch(/please do not pay again/)

    const orders = await ordersOf(seated.event.id)
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('PENDING')
    expect(orders[0].payments).toHaveLength(1)
    expect(orders[0].items.flatMap((item) => item.tickets)).toHaveLength(0)
  })

  it('answers a double-submitted checkout that both halves began as one attempt, never a 500', async () => {
    // Both requests read "no order with this key" before either had written
    // one; the second meets the first on the key's unique index. Played by
    // hiding the first order from the second request's opening read.
    const general = await generalEvent('double-key', { capacity: 4, quantityTotal: 4 })
    const attempt = { 'idempotency-key': `double-key-${RUN}` }

    timeOutNextCapture()
    const first = await placeOrder(general.event, general.tier.id, 1, null, attempt)
    expect(first.statusCode).toBe(502)

    const findUnique = prisma.order.findUnique.bind(prisma.order)
    let hidden = false
    const opening = vi.spyOn(prisma.order, 'findUnique').mockImplementation(async (args) => {
      if (!hidden && args?.where?.idempotencyKey) {
        hidden = true
        return null
      }

      return findUnique(args)
    })

    let second
    try {
      second = await placeOrder(general.event, general.tier.id, 1, null, attempt)
    } finally {
      opening.mockRestore()
    }

    const orders = await ordersOf(general.event.id)

    expect(hidden).toBe(true)
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toMatchObject({
      code: 'ORDER_PENDING',
      orderReference: orders[0].reference,
    })
    expect(orders).toHaveLength(1)
    expect(orders[0].payments).toHaveLength(1)
  })

  it('records a capture whose settlement refused, and opens a reconciliation task for it', async () => {
    const seated = await seatedEvent('unsettled')
    const holdId = await holdSeats(seated, ['A1'])

    // While the card is being charged, the hold stops owning its seat by some
    // path nothing here knows about. Settlement will refuse to issue a
    // seatless ticket.
    providers.payments.capture = async (...args) => {
      await prisma.eventSeat.update({
        where: { id: seated.eventSeatIdByLabel.A1 },
        data: { status: 'AVAILABLE', holdId: null },
      })
      await prisma.ticketHold.update({ where: { id: holdId }, data: { status: 'EXPIRED' } })

      return originalCapture(...args)
    }

    const response = await placeOrder(seated.event, seated.tier.id, 1, holdId)

    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('ORDER_NOT_COMPLETED')

    const [pending] = await ordersOf(seated.event.id)
    expect(response.json().error.orderReference).toBe(pending.reference)
    expect(pending.status).toBe('PENDING')
    expect(pending.items.flatMap((item) => item.tickets)).toHaveLength(0)

    const [payment] = pending.payments
    const intent = providers.payments
      .listIntents()
      .find((candidate) => candidate.metadata?.reference === pending.reference)

    expect(intent.status).toBe('SUCCEEDED')
    expect(payment).toMatchObject({
      status: 'INITIATED',
      reconciliationRequired: true,
      providerRef: intent.id,
    })

    const tasks = await prisma.reconciliationTask.findMany({ where: { paymentId: payment.id } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      kind: 'PROVIDER_MISMATCH',
      state: 'OPEN',
      orderId: pending.id,
      providerRef: intent.id,
      organizationId: world.organization.id,
    })
    expect(tasks[0].lastError).toMatch(/SEATS_NOT_HELD/)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'reconciliation.opened', entityId: payment.id },
    })
    expect(audit.metadata).toMatchObject({ orderId: pending.id, taskId: tasks[0].id })
  })

  it('answers 422, not a foreign-key 500, to a seat hold racing the removal of its night', async () => {
    const seated = await seatedEvent('removal', { secondNight: true })
    const event = await prisma.event.findUnique({ where: { id: seated.event.id } })

    // The removal locks the night's tiers and the night, then stops at the
    // seat delete behind this outside lock, holding both.
    const outside = await lockFromOutside('EventSeat', seated.eventSeatIdByLabel.A3)
    const removal = app.inject({
      method: 'DELETE',
      url: `/v1/events/${seated.event.id}/sessions/${seated.session.id}?revision=${event.revision}`,
      headers: world.ownerHeaders,
    })
    const removing = await waitForWaiter([outside.pid])

    const hold = app.inject({
      method: 'POST',
      url: `/v1/sessions/${seated.session.id}/holds`,
      headers: world.buyer.headers,
      payload: { seatIds: [seated.seatIdByLabel.A1] },
    })
    await waitForWaiter([removing], [removing])
    await outside.open()

    const [removed, held] = await Promise.all([removal, hold])

    expect(removed.statusCode).toBe(200)
    expect(held.statusCode).toBe(422)
    expect(held.json().error.message).toBe('Those seats are not on sale at this session.')
    expect(await prisma.eventSession.findUnique({ where: { id: seated.session.id } })).toBeNull()
  })
})
