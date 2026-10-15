/**
 * Booking to pay at the venue, the checkout side, against a real database
 * (SPEC3 §14.3 as SPEC3-XI §3 §14.3 amends it): the switch turned off between
 * the quote and the order, no limit per account, the event's limit under
 * concurrency and against a settlement, and a waived booking on the
 * zero-total path, settled and not.
 *
 * The event's limit is held by one advisory lock per event and one counting
 * statement (`lib/venue-booking-limits.js`). Two checkouts for different
 * nights of one event share no tier and no night, so that lock is the only
 * thing between them: the races here use two nights, and hold the event's row
 * so both checkouts have counted before either writes its order. Without the
 * lock both count the same nothing, and the event goes past its limit.
 *
 * Orders are placed through `orders.create`; the door and the money after the
 * order are B1-V's (`venue-payment-integration.test.js`).
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/venue-booking-integration
 */

import { createHash } from 'node:crypto'

import { splitAcrossTickets } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { CAPTURE_OUTCOMES, settleCheckout } from '../src/lib/checkout.js'
import { findImbalances } from '../src/lib/finance-reporting.js'
import { startSession } from '../src/lib/sessions.js'
import { unpaidVenueTickets } from '../src/lib/venue-booking-limits.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { createFeeEvent, pendingZeroTotalOrder, referralCodeFixture } from './helpers/fee-orders.js'
import { holdRow, waitingOn } from './helpers/row-locks.js'

/**
 * A lever on settlement, for the booking whose settlement fails: with `fail`
 * set, `settleCheckout` refuses as a settlement that could not issue the
 * tickets does, and the charge's third phase records the failure.
 */
const doctored = vi.hoisted(() => ({ fail: false }))

vi.mock('../src/lib/checkout.js', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    async settleCheckout(tx, params) {
      if (doctored.fail) {
        throw Object.assign(new Error('Settlement refused by the suite'), {
          code: 'SETTLEMENT_REFUSED',
        })
      }

      return actual.settleCheckout(tx, params)
    },
  }
})

const { prisma, reachable, when } = await connectTestDatabase('the venue booking suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/** A reason inside every 10-500 character bound. */
const REASON = 'Set by the venue booking suite for its races.'

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
    .update(`venue-booking-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A tag unique to this run and this call, for slugs and references.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Wait until `count` backends queue behind a held row, directly or behind one
 * another (a second checkout waits on the first's advisory lock, not on the
 * held row).
 *
 * @param {number} holderPid The holder's backend.
 * @param {number} count How many waiters to wait for.
 * @param {string} what What is being waited for, for the failure message.
 * @returns {Promise<number[]>} The waiters, in the order they were seen.
 * @throws {Error} After ten seconds without them.
 */
async function untilQueued(holderPid, count, what) {
  const deadline = Date.now() + 10_000
  const queue = []

  while (Date.now() < deadline) {
    const waiting = await waitingOn(prisma, [holderPid, ...queue])

    for (const pid of waiting) if (!queue.includes(pid)) queue.push(pid)

    if (queue.length >= count) return queue

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`Never saw ${what} queued behind the held row within ten seconds.`)
}

let app
let admin

/**
 * A user with a session, as sign-in leaves one.
 *
 * @param {string} label Distinguishes it.
 * @param {string} [role] The platform role.
 * @returns {Promise<{user: object, headers: object}>} The account and its request headers.
 */
async function account(label, role = 'ATTENDEE') {
  const user = await prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${RUN}@venue-booking.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (role !== 'ATTENDEE') {
    await prisma.mfaFactor.create({
      data: {
        id: id('factor'),
        userId: user.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  const { secret } = await startSession(prisma, {
    actor: { id: user.id, role: user.role, memberships: [] },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'venue-booking-suite-pseudonymisation-key',
    mfaSatisfied: role !== 'ATTENDEE',
  })

  return { user, headers: { authorization: `Bearer ${secret}` } }
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry({ payments: { idPrefix: `pivenb${RUN}` } }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      quote: { max: 10_000, timeWindow: '1 minute' },
      paymentTerms: { max: 10_000, timeWindow: '1 minute' },
      referralAttempt: { actorMax: 10_000, addressMax: 10_000, sharedMax: 10_000 },
    },
  })
  await app.ready()

  admin = await account('admin', 'ADMIN')
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * Switch paying at the venue through `paymentTerms.setVenuePayment`.
 *
 * @param {string} eventId The event.
 * @param {object} body `enabled`, `limit` and `seen`.
 * @returns {Promise<object>} The inject result.
 */
function switchVenue(eventId, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/venue-payment`,
    headers: admin.headers,
    payload: { reason: REASON, ...body },
  })
}

/**
 * An event on sale with two nights, a tier on each, and paying at the venue
 * switched on with a limit.
 *
 * @param {string} label Distinguishes it.
 * @param {number} limit The event's limit on unpaid tickets.
 * @returns {Promise<object>} The world from `createFeeEvent`, with `nightTwo` and `secondTier`.
 */
async function twoNightWorld(label, limit) {
  const world = await createFeeEvent(prisma, { tag: tag(label) })
  const startsAt = new Date(world.session.startsAt.getTime() + 24 * 60 * 60 * 1000)
  const nightTwo = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: world.event.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      timezone: 'America/Chicago',
      capacity: 500,
    },
  })
  const secondTier = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: world.event.id,
      eventSessionId: nightTwo.id,
      name: `Night two ${tag(label)}`,
      priceCents: 2_000,
      currency: 'USD',
      quantityTotal: 200,
      maxPerOrder: 10,
      status: 'ON_SALE',
    },
  })
  const switched = await switchVenue(world.event.id, {
    enabled: true,
    limit,
    seen: { enabled: false, limit: null },
  })

  expect(switched.statusCode, switched.body).toBe(200)

  return { ...world, nightTwo, secondTier }
}

/**
 * Place an order through `orders.create`.
 *
 * @param {object} buyer From {@link account}.
 * @param {object} world The event.
 * @param {object} [options] Options.
 * @param {string} [options.tierId] The tier; the first night's balcony unless told.
 * @param {number} [options.quantity] How many.
 * @param {object} [options.body] Extra order fields.
 * @returns {Promise<object>} The inject result.
 */
function order(buyer, world, { tierId = world.tiers.balcony.id, quantity = 1, body = {} } = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: buyer.headers,
    payload: {
      eventId: world.event.id,
      buyerEmail: buyer.user.email,
      buyerName: buyer.user.displayName,
      items: [{ ticketTypeId: tierId, quantity }],
      paymentMethod: 'AT_VENUE',
      ...body,
    },
  })
}

/**
 * The tickets of an event waiting to be paid at the door, as the limit counts them.
 *
 * @param {string} eventId The event.
 * @returns {Promise<number>} The count.
 */
function unpaid(eventId) {
  return prisma.$transaction((tx) => unpaidVenueTickets(tx, eventId))
}

/**
 * Everything a refused checkout could have left behind for a buyer.
 *
 * @param {string} userId The buyer.
 * @returns {Promise<{orders: number, holds: number}>} Counts.
 */
async function leftBehind(userId) {
  const [orders, holds] = await Promise.all([
    prisma.order.count({ where: { userId } }),
    prisma.ticketHold.count({ where: { userId } }),
  ])

  return { orders, holds }
}

/**
 * The ledger of an organisation has no unbalanced batch.
 *
 * @param {string} organizationId The organisation.
 * @returns {Promise<void>} Resolves when checked.
 */
async function expectBalanced(organizationId) {
  const { imbalances } = await findImbalances(prisma, {
    organizationId,
    from: new Date(Date.now() - 10 * 60_000),
    to: new Date(Date.now() + 60_000),
  })

  expect(imbalances).toEqual([])
}

when()('paying at the venue switched off during a checkout', () => {
  it('refuses the order that was quoted with it, writes nothing, and a card order then goes through', async () => {
    const world = await twoNightWorld('switchoff', 10)
    const buyer = await account('switchoff')

    const quote = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers: buyer.headers,
      payload: {
        eventId: world.event.id,
        items: [{ ticketTypeId: world.tiers.balcony.id, quantity: 2 }],
        paymentMethod: 'AT_VENUE',
      },
    })

    expect(quote.statusCode, quote.body).toBe(200)

    const quoted = quote.json().data

    expect(quoted.venueDueCents).toBe(4_000)

    const off = await switchVenue(world.event.id, {
      enabled: false,
      seen: { enabled: true, limit: 10 },
    })

    expect(off.statusCode, off.body).toBe(200)

    const refused = await order(buyer, world, {
      quantity: 2,
      body: {
        expectedTotalCents: quoted.totalCents,
        expectedVenueDueCents: quoted.venueDueCents,
      },
    })

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('VENUE_PAYMENT_OFF')
    expect(await leftBehind(buyer.user.id)).toEqual({ orders: 0, holds: 0 })

    const card = await order(buyer, world, { quantity: 2, body: { paymentMethod: 'CARD' } })

    expect(card.statusCode, card.body).toBe(201)
    expect(card.json().data.status).toBe('PAID')

    const stored = await prisma.order.findUnique({ where: { id: card.json().data.id } })

    expect(stored).toMatchObject({ paymentMethod: 'CARD', venueDueCents: 0 })
  })
})

when()('the one limit is the event’s', () => {
  it('lets one buyer book up to the event’s limit in two orders at once, and refuses the ticket past it', async () => {
    const world = await twoNightWorld('noaccount', 12)
    const buyer = await account('noaccount')

    const [first, second] = await Promise.all([
      order(buyer, world, { quantity: 6 }),
      order(buyer, world, { tierId: world.secondTier.id, quantity: 6 }),
    ])

    expect(first.statusCode, first.body).toBe(201)
    expect(second.statusCode, second.body).toBe(201)
    expect(await unpaid(world.event.id)).toBe(12)

    const third = await order(buyer, world, { quantity: 1 })

    expect(third.statusCode, third.body).toBe(409)
    expect(third.json().error.code).toBe('VENUE_PAYMENT_FULL')
    expect(await prisma.order.count({ where: { userId: buyer.user.id } })).toBe(2)
    expect(await unpaid(world.event.id)).toBe(12)
    await expectBalanced(world.organization.id)
  })

  it('lets one of two buyers who have both counted have the last places, and refuses the other', async () => {
    const world = await twoNightWorld('eventlimit', 5)
    const buyers = [await account('eventlimita'), await account('eventlimitb')]

    // Held so that each checkout reaches its order insert (the event's
    // foreign key) only after it has counted: the first counts and waits on
    // the event, the second waits on the first's advisory lock.
    const held = await holdRow(prisma, 'Event', world.event.id)
    const racing = [
      order(buyers[0], world, { quantity: 3 }),
      order(buyers[1], world, { tierId: world.secondTier.id, quantity: 3 }),
    ]

    try {
      await untilQueued(held.pid, 2, 'both checkouts')
    } finally {
      held.release()
      await held.done
    }

    const responses = await Promise.all(racing)

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])

    const refused = responses.find((response) => response.statusCode === 409)

    expect(refused.json().error.code).toBe('VENUE_PAYMENT_FULL')
    expect(await leftBehind(buyers[responses.indexOf(refused)].user.id)).toEqual({
      orders: 0,
      holds: 0,
    })
    expect(await unpaid(world.event.id)).toBe(3)
    await expectBalanced(world.organization.id)
  })
})

when()('the event’s limit against a booking being settled', () => {
  let codes = 0

  /**
   * A PENDING waived booking of three on the first night, as checkout's first
   * transaction leaves one, and its settlement.
   *
   * @param {object} world The event.
   * @param {object} code A referral code row with no limit.
   * @param {string} userId The buyer.
   * @returns {Promise<{pending: object, settle: function(): Promise<object>}>} The booking.
   */
  async function bookingOfThree(world, code, userId) {
    const pending = await prisma.$transaction((tx) =>
      pendingZeroTotalOrder(tx, {
        world,
        referralCode: code,
        tag: tag('settling'),
        userId,
        lines: [{ ticketTypeId: world.tiers.balcony.id, quantity: 3, unitPriceCents: 2_000 }],
      }),
    )

    return {
      pending: pending.order,
      settle: () =>
        prisma.$transaction(
          (tx) =>
            settleCheckout(tx, {
              order: pending.order,
              payment: null,
              result: {
                outcome: CAPTURE_OUTCOMES.SUCCEEDED,
                intent: null,
                failureCode: null,
                rawStatus: 'ZERO_TOTAL',
              },
              now: new Date(),
              generateTicketCode: () => {
                codes += 1

                return `DET-VB${RUN}${codes}`.toUpperCase()
              },
              credentialSecret: SECRET,
            }),
          { timeout: 15_000, maxWait: 10_000 },
        ),
    }
  }

  it('counts a booking still PENDING: a checkout behind its settlement is refused', async () => {
    const world = await twoNightWorld('pendingcount', 5)
    const { row: code } = await referralCodeFixture(prisma, { createdById: admin.user.id })
    const owner = await account('pendingcounta')
    const buyer = await account('pendingcountb')
    const booking = await bookingOfThree(world, code, owner.user.id)

    // The settlement takes its tiers first: holding the tier keeps it PENDING.
    const held = await holdRow(prisma, 'TicketType', world.tiers.balcony.id)
    const settling = booking.settle()

    try {
      await untilQueued(held.pid, 1, 'the settlement')

      const refused = await order(buyer, world, { tierId: world.secondTier.id, quantity: 3 })

      expect(refused.statusCode, refused.body).toBe(409)
      expect(refused.json().error.code).toBe('VENUE_PAYMENT_FULL')
    } finally {
      held.release()
      await held.done
    }

    expect(await settling).toEqual({ settled: true })
    expect(await unpaid(world.event.id)).toBe(3)
  })

  it('counts a booking once it is PAID: a checkout after its settlement is refused', async () => {
    const world = await twoNightWorld('paidcount', 5)
    const { row: code } = await referralCodeFixture(prisma, { createdById: admin.user.id })
    const owner = await account('paidcounta')
    const buyer = await account('paidcountb')
    const booking = await bookingOfThree(world, code, owner.user.id)

    expect(await booking.settle()).toEqual({ settled: true })

    const refused = await order(buyer, world, { tierId: world.secondTier.id, quantity: 3 })

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error.code).toBe('VENUE_PAYMENT_FULL')
    expect(await unpaid(world.event.id)).toBe(3)
  })

  it('never goes past the limit whichever commits first, twenty times over', async () => {
    const { row: code } = await referralCodeFixture(prisma, { createdById: admin.user.id })

    for (let round = 0; round < 20; round += 1) {
      const world = await twoNightWorld(`settlerace${round}`, 5)
      const owner = await account(`settlerace${round}a`)
      const buyer = await account(`settlerace${round}b`)
      const booking = await bookingOfThree(world, code, owner.user.id)

      const [settled, placed] = await Promise.all([
        booking.settle(),
        order(buyer, world, { tierId: world.secondTier.id, quantity: 3 }),
      ])

      expect(settled).toEqual({ settled: true })
      expect(placed.statusCode, placed.body).toBe(409)
      expect(placed.json().error.code).toBe('VENUE_PAYMENT_FULL')

      const counted = await unpaid(world.event.id)

      expect(counted).toBe(3)
      expect(counted).toBeLessThanOrEqual(5)
    }
  })
})

when()('a booking whose booking fee a referral code waived', () => {
  it('settles on the zero-total path with no payment, and issues its tickets with their shares', async () => {
    const world = await twoNightWorld('waived', 20)
    const buyer = await account('waived')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 5,
    })
    // An odd door price over three tickets, so the shares are not equal.
    const tier = await prisma.ticketType.create({
      data: {
        id: id('tier'),
        eventId: world.event.id,
        eventSessionId: world.session.id,
        name: `Odd ${RUN}`,
        priceCents: 1_001,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })

    const placed = await order(buyer, world, {
      tierId: tier.id,
      quantity: 3,
      body: { referralCode, promoCode: world.promoCode.code },
    })

    expect(placed.statusCode, placed.body).toBe(201)

    const stored = await prisma.order.findUnique({
      where: { id: placed.json().data.id },
      include: { items: true, payments: true },
    })

    expect(stored).toMatchObject({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      totalCents: 0,
      feesCents: 0,
      taxCents: 0,
      referralCodeId: row.id,
    })
    expect(stored.feeWaivedCents).toBe(stored.feeGrossCents)
    expect(stored.payments).toEqual([])

    const [line] = stored.items

    expect(line.venueDueCents).toBe(stored.venueDueCents)
    expect(line.venueDueCents).toBe(3_003 - stored.discountCents)

    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: line.id },
      orderBy: { createdAt: 'asc' },
    })
    const shares = splitAcrossTickets(line.venueDueCents, 3)

    expect(new Set(shares).size).toBeGreaterThan(1)
    expect(tickets.map((ticket) => ticket.venueDueCents).sort()).toEqual([...shares].sort())
    expect(tickets.reduce((sum, ticket) => sum + ticket.venueDueCents, 0)).toBe(line.venueDueCents)
    expect(tickets.every((ticket) => ticket.venuePaymentId === null)).toBe(true)
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(1)
    await expectBalanced(world.organization.id)
  })

  it('gives its use back, once, when its settlement fails', async () => {
    const world = await twoNightWorld('waivedfails', 20)
    const buyer = await account('waivedfails')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 5,
      useCount: 1,
    })

    doctored.fail = true

    let response

    try {
      response = await order(buyer, world, { quantity: 2, body: { referralCode } })
    } finally {
      doctored.fail = false
    }

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('ORDER_CANCELLED')

    const cancelled = await prisma.order.findFirst({
      where: { userId: buyer.user.id },
      include: { payments: true },
    })

    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      paymentMethod: 'AT_VENUE',
      totalCents: 0,
      referralCodeId: row.id,
      referralUseReturnCause: 'NOT_COMPLETED',
    })
    expect(cancelled.payments).toEqual([])
    expect(await prisma.ticket.count({ where: { orderItem: { orderId: cancelled.id } } })).toBe(0)
    // Taken when the booking was placed, given back once: where it began.
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { action: 'referral_code.use_returned', entityId: row.id },
      }),
    ).toBe(1)
    // A cancelled booking holds no place against the limit.
    expect(await unpaid(world.event.id)).toBe(0)
  })
})
