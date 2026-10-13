/**
 * A referral use given back when its order ends without being used, against
 * real PostgreSQL (SPEC3-XI XR, §14.3 R1–R7 and R9–R13).
 *
 * Every path that can end an order evaluates "ended without being used" under
 * the order's row lock, and gives the use back through
 * `settleReferralUsesIfEnded`: a conditional marker update decides it once,
 * and the codes are locked last, in ascending id order (XR3–XR6). Each race
 * here runs its sides against one barrier — a row held from outside, released
 * once PostgreSQL reports every side waiting behind it — and asserts no
 * deadlock (`40P01`) and exactly one return per ended order. R7, the identity
 * `useCount = orders naming the code with no return marked`, is checked after
 * every case and once more over every code this file made.
 *
 * SPEC3's `referral-codes-integration` case 3 ("a refund keeps the use")
 * changed rule and is R1 and R6 here; case 4's deletion half is R3.
 *
 * Runs against `TEST_DATABASE_URL`; with `REQUIRE_DATABASE` set it fails
 * rather than skips.
 */

import { createPrismaClient } from '@desi-event/db'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadActor } from '../src/lib/actor.js'
import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { CAPTURE_OUTCOMES, recordUnsettledCapture, settleCheckout } from '../src/lib/checkout.js'
import { refundOwed } from '../src/lib/event-refunds.js'
import { settleReferralUsesIfEnded } from '../src/lib/referral-uses.js'
import {
  REFUND_OUTCOMES,
  approveRefund,
  markSubmitted,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../src/lib/refunds.js'
import { startSession } from '../src/lib/sessions.js'
import { cancelUnpaidVenueTickets } from '../src/lib/venue-bookings.js'
import { testEnv } from './helpers/app.js'
import { TEST_CONNECTION, connectTestDatabase } from './helpers/database.js'
import {
  FEE_ORDER_CURRENCY,
  atVenueOrder,
  cancelledUnpaidFixture,
  feeOrderFeeConfig,
  orderFeeColumns,
  pendingZeroTotalOrder,
  priceFeeOrder,
  referralCodeFixture,
  waivedOrder,
} from './helpers/fee-orders.js'
import { TEST_AUTH_SECRET } from './helpers/fixtures.js'
import { holdRow } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the referral returns suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The secret passes are derived from. */
const SECRET = TEST_AUTH_SECRET

/** A reason inside every 10–500 character bound. */
const REASON = 'Checked by the referral returns suite.'

/** A ticket's price, in cents. */
const PRICE = 4_000

/** How many times a race the spec marks ×20 is run. */
const ROUNDS = 20

const providers = createInMemoryProviderRegistry({ payments: { idPrefix: `pireturn${RUN}` } })
const payments = providers.payments

/** Every referral code this file made, for R7. */
const CODES = new Set()

let app
let racers
let sequence = 0
let buyer
let owner
let administrator

/**
 * A tag unique to this run and call.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A user, with a confirmed second factor when `privileged`.
 *
 * @param {string} label Distinguishes them.
 * @param {object} [options] Options.
 * @param {string} [options.role] The platform role.
 * @param {boolean} [options.privileged] Whether to enrol a second factor.
 * @returns {Promise<object>} The user.
 */
async function person(label, { role = 'ATTENDEE', privileged = false } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@referral-returns.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (privileged) {
    await prisma.mfaFactor.create({
      data: {
        userId: user.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  return user
}

/**
 * Bearer headers for a real session whose second factor was confirmed now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function headersFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'referral-returns-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * The actor a request from this user would carry, read now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The actor.
 */
async function actorFor(who) {
  return (await loadActor(prisma, who.id)).actor
}

/**
 * An organisation the suite's owner runs and one event on sale with one
 * night and two $40 tiers (one for the night, one for every night).
 *
 * @param {string} label Distinguishes it.
 * @returns {Promise<object>} `{ organization, event, session, tiers, ownerHeaders }`.
 */
async function world(label) {
  const slug = tag(label)
  const organization = await prisma.organization.create({
    data: {
      name: `Referral returns ${slug}`,
      slug: `referral-returns-${slug}`,
      contactEmail: `hello-${slug}@referral-returns.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Returns Hall ${slug}`,
      slug: `returns-hall-${slug}`,
      addressLine1: '1 Door Street',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })
  const startsAt = new Date(Date.now() + 30 * 86_400_000)
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Returns night ${slug}`,
      slug: `returns-night-${slug}`,
      summary: 'Seeded for the referral returns suite.',
      description: 'Seeded for the referral returns suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status: 'ON_SALE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      timezone: 'America/Chicago',
      publishedAt: new Date(Date.now() - 40 * 86_400_000),
      salesOpenedAt: new Date(Date.now() - 40 * 86_400_000),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      label: 'Night 1',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      timezone: 'America/Chicago',
      capacity: 500,
    },
  })
  const tier = (name, eventSessionId) =>
    prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId,
        name: `${name} ${slug}`,
        priceCents: PRICE,
        currency: FEE_ORDER_CURRENCY,
        quantityTotal: 200,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
  const tiers = [await tier('Floor', session.id), await tier('Gallery', null)]

  await prisma.membership.create({
    data: { userId: owner.id, organizationId: organization.id, role: 'OWNER' },
  })

  return {
    organization,
    venue,
    event,
    session,
    tiers,
    promoCode: null,
    ownerHeaders: await headersFor(owner),
  }
}

/**
 * A referral code made by the suite's administrator.
 *
 * @returns {Promise<object>} The row.
 */
async function code() {
  const { row } = await referralCodeFixture(prisma, { createdById: administrator.id })

  CODES.add(row.id)

  return row
}

/**
 * A zero-online pay-at-the-venue booking whose fee `referralCode` waived.
 *
 * @param {object} place From {@link world}.
 * @param {object} referralCode The code.
 * @param {number} [quantity] How many tickets.
 * @returns {Promise<object>} From `atVenueOrder`.
 */
function waivedBooking(place, referralCode, quantity = 1) {
  return atVenueOrder(prisma, place, {
    tag: tag('booking'),
    payments,
    credentialSecret: SECRET,
    userId: buyer.id,
    lines: [{ ticketTypeId: place.tiers[0].id, quantity, unitPriceCents: PRICE }],
    referralCode,
    waived: true,
  })
}

/**
 * A paid card order whose fee `referralCode` waived, with a line on each tier.
 *
 * @param {object} place From {@link world}.
 * @param {object} referralCode The code.
 * @returns {Promise<object>} From `waivedOrder`.
 */
function waivedCard(place, referralCode) {
  return waivedOrder(prisma, place, {
    tag: tag('card'),
    payments,
    credentialSecret: SECRET,
    userId: buyer.id,
    withPromo: false,
    lines: [
      { ticketTypeId: place.tiers[0].id, quantity: 2, unitPriceCents: PRICE },
      { ticketTypeId: place.tiers[1].id, quantity: 1, unitPriceCents: PRICE },
    ],
    referralCode,
  })
}

/**
 * A refund of the given lines of an order, requested and approved by the
 * owner, marked submitted and taken by the in-memory provider: ready for
 * `settleRefund`.
 *
 * @param {object} order The order.
 * @param {object[]} items The lines to refund in full.
 * @returns {Promise<{refund: object, result: object}>} What settlement needs.
 */
async function refundReady(order, items) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })
  const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: order.id } })), items: lines },
      payment,
      lines: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `returns-${tag('refund')}`,
      actorId: owner.id,
      now: new Date(),
    }),
  )

  await prisma.$transaction((tx) =>
    approveRefund(tx, { refund, actorId: owner.id, now: new Date() }),
  )
  await prisma.$transaction(async (tx) =>
    markSubmitted(tx, {
      refund: await tx.refund.findUnique({ where: { id: refund.id } }),
      now: new Date(),
    }),
  )

  const submitted = await prisma.refund.findUnique({ where: { id: refund.id } })
  const result = await submitOutsideTransaction(payments, submitted, payment)

  expect(result.outcome).toBe(REFUND_OUTCOMES.SUCCEEDED)

  return { refund: submitted, result }
}

/**
 * Settle a refund as `refunds.submit` and reconciliation settle one.
 *
 * @param {object} place From {@link world}.
 * @param {object} order The order.
 * @param {{refund: object, result: object}} ready From {@link refundReady}.
 * @returns {Promise<object>} What `settleRefund` returned.
 */
function settle(place, order, ready) {
  return prisma.$transaction(async (tx) =>
    settleRefund(tx, {
      refund: ready.refund,
      order: await tx.order.findUnique({ where: { id: order.id } }),
      result: ready.result,
      organizationId: place.organization.id,
      eventStartsAt: place.event.startsAt,
      actorId: owner.id,
      now: new Date(),
    }),
  )
}

/**
 * Cancel unpaid tickets as the suite's owner, through the library the route
 * calls.
 *
 * @param {object} order The booking.
 * @param {object[]} tickets The tickets.
 * @param {object} actor The owner's actor, read after the world was made.
 * @returns {Promise<object>} The response payload.
 */
function cancelUnpaid(order, tickets, actor) {
  return cancelUnpaidVenueTickets(prisma, {
    reference: order.reference,
    ticketIds: tickets.map((ticket) => ticket.id),
    reason: REASON,
    actor,
    now: new Date(),
    requestId: `req-${tag('cancel')}`,
  })
}

/**
 * Cancel the event through `events.cancel`.
 *
 * @param {object} place From {@link world}.
 * @returns {Promise<object>} The inject result.
 */
function cancelEvent(place) {
  return app.inject({
    method: 'POST',
    url: `/v1/events/${place.event.id}/cancel`,
    headers: place.ownerHeaders,
    payload: { reasonCode: 'OTHER', reason: 'Called off by the referral returns suite.' },
  })
}

/**
 * The event's deletion, previewed now and sent when called, with the outcome
 * the preview gives (CANCEL_AND_REFUND when it is offered).
 *
 * @param {object} place From {@link world}.
 * @returns {Promise<function(): Promise<object>>} Sends it.
 */
async function deletion(place) {
  const preview = await app.inject({
    method: 'GET',
    url: `/v1/events/${place.event.id}/deletion`,
    headers: place.ownerHeaders,
  })

  expect(preview.statusCode, preview.body).toBe(200)

  const { outcome, choices } = preview.json().data
  const expectedOutcome = choices?.includes('CANCEL_AND_REFUND')
    ? 'CANCEL_AND_REFUND'
    : (outcome ?? choices?.[0])
  const event = await prisma.event.findUnique({ where: { id: place.event.id } })

  return () =>
    app.inject({
      method: 'POST',
      url: `/v1/events/${place.event.id}/delete`,
      headers: place.ownerHeaders,
      payload: {
        revision: event.revision,
        reason: REASON,
        confirmSlug: event.slug,
        expectedOutcome,
      },
    })
}

/**
 * Settle a zero-total booking as the charge's third phase does.
 *
 * @param {object} pending The PENDING order.
 * @returns {Promise<object>} What `settleCheckout` returned.
 */
function settleZeroTotal(pending) {
  return prisma.$transaction(
    (tx) =>
      settleCheckout(tx, {
        order: pending,
        payment: null,
        result: {
          outcome: CAPTURE_OUTCOMES.SUCCEEDED,
          intent: null,
          failureCode: null,
          rawStatus: 'ZERO_TOTAL',
        },
        now: new Date(),
        generateTicketCode: () => `DET-RR${tag('code')}`.toUpperCase().slice(0, 32),
        credentialSecret: SECRET,
      }),
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/**
 * A PENDING card order with its payment captured and not yet settled, as
 * checkout's first two phases leave one.
 *
 * @param {object} place From {@link world}.
 * @returns {Promise<{order: object, payment: object, intent: object}>} The rows.
 */
async function pendingCard(place) {
  const suffix = tag('pending').toUpperCase()
  const feeConfig = feeOrderFeeConfig()
  const totals = priceFeeOrder({
    items: [{ ticketTypeId: place.tiers[0].id, quantity: 1, unitPriceCents: PRICE }],
    feeConfig,
  })
  const intent = payments.createIntent({
    amountCents: totals.totalCents,
    currency: FEE_ORDER_CURRENCY,
  })

  payments.capture(intent.id)

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        reference: `DE-RR${suffix}`.slice(0, 32),
        eventId: place.event.id,
        eventSessionId: place.session.id,
        userId: buyer.id,
        buyerEmail: `card-${suffix.toLowerCase()}@referral-returns.example`,
        buyerName: 'Card Buyer',
        status: 'PENDING',
        currency: FEE_ORDER_CURRENCY,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        feesCents: totals.feesCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        ...orderFeeColumns(totals, { feeConfig }),
      },
    })

    for (const line of totals.lineItems) {
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          subtotalCents: line.subtotalCents,
        },
      })
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: payments.name,
        providerRef: intent.id,
        status: 'INITIATED',
        amountCents: totals.totalCents,
        currency: FEE_ORDER_CURRENCY,
      },
    })

    return { order, payment, intent }
  })
}

/**
 * What a call came to, error or not, never thrown.
 *
 * @param {Promise<unknown>} call The call.
 * @returns {Promise<object>} `{ status, data?, code?, error? }`.
 */
async function outcome(call) {
  try {
    const value = await call

    if (value && typeof value.statusCode === 'number' && typeof value.json === 'function') {
      let body = null

      try {
        body = JSON.parse(value.body)
      } catch {
        body = null
      }

      return {
        status: value.statusCode,
        data: body?.data,
        code: body?.error?.code,
        body: value.body,
      }
    }

    return { status: 200, data: value }
  } catch (error) {
    if (typeof error?.statusCode === 'number') {
      return { status: error.statusCode, code: error.code, body: error.message }
    }

    return { status: 0, error: String(error?.message ?? error), body: String(error?.stack ?? '') }
  }
}

/**
 * Asserts that no side of a race saw a deadlock or a 500.
 *
 * @param {Array<object>} results From {@link outcome}.
 * @returns {void} Nothing.
 */
function expectNoDeadlock(results) {
  const text = JSON.stringify(results)

  expect(text).not.toMatch(/40P01|deadlock|P2034/iu)

  for (const result of results) {
    expect(result.code, JSON.stringify(result)).not.toBe('TRY_AGAIN')
    expect(result.status, JSON.stringify(result)).toBeGreaterThan(0)
    expect(result.status, JSON.stringify(result)).toBeLessThan(500)
  }
}

/**
 * How many backends wait, directly or behind another waiter, on `pid`.
 *
 * @param {number} pid The backend holding the barrier.
 * @returns {Promise<number>} The count.
 */
async function waitersBehind(pid) {
  const rows = await prisma.$queryRaw`
    SELECT pid, pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity
    WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`
  const behind = new Set([Number(pid)])
  let grew = true

  while (grew) {
    grew = false

    for (const row of rows) {
      const waiter = Number(row.pid)

      if (!behind.has(waiter) && row.blockers.some((blocker) => behind.has(Number(blocker)))) {
        behind.add(waiter)
        grew = true
      }
    }
  }

  return behind.size - 1
}

/**
 * Wait until `count` backends wait behind the barrier, or fail when a side
 * answered without ever waiting.
 *
 * @param {number} pid The barrier's backend.
 * @param {number} count How many.
 * @param {string} what For the failure message.
 * @param {function(): (object|null)} finished A side that already answered, if any.
 * @returns {Promise<void>} Resolves once they do.
 */
async function untilBehind(pid, count, what, finished) {
  const deadline = Date.now() + 8_000

  while (Date.now() < deadline) {
    if ((await waitersBehind(pid)) >= count) return

    const early = finished()

    if (early) throw new Error(`${what} answered without waiting: ${JSON.stringify(early)}`)

    await new Promise((resolve) => {
      setTimeout(resolve, 15)
    })
  }

  throw new Error(`Never saw ${what} waiting behind the barrier (${pid}) within eight seconds`)
}

/**
 * Run calls against a barrier: hold the row, start each side in turn once
 * the ones before it queue, then let go.
 *
 * @param {object} barrier `{ table, id }` of the row to hold.
 * @param {...function(): Promise<unknown>} sides The sides, in arrival order.
 * @returns {Promise<Array<object>>} Every outcome, in the order given.
 */
async function race(barrier, ...sides) {
  const held = await holdRow(prisma, barrier.table, barrier.id)
  const started = []
  const answered = []

  try {
    for (const [index, side] of sides.entries()) {
      started.push(
        outcome(side()).then((result) => {
          answered[index] = result

          return result
        }),
      )
      await untilBehind(
        held.pid,
        index + 1,
        `side ${index + 1} of ${sides.length}`,
        () => answered.find(Boolean) ?? null,
      )
    }
  } finally {
    held.release()
    await held.done
  }

  return Promise.all(started)
}

/**
 * The `referral_code.use_returned` audit rows of an order.
 *
 * @param {string} orderId The order.
 * @returns {Promise<object[]>} The rows.
 */
function returnsOf(orderId) {
  return prisma.auditLog.findMany({
    where: {
      action: AUDIT_ACTIONS.REFERRAL_USE_RETURNED,
      metadata: { path: ['orderId'], equals: orderId },
    },
  })
}

/**
 * Asserts an order's use was given back exactly once.
 *
 * @param {string} orderId The order.
 * @param {string|string[]} [causes] The cause, or the causes it may be.
 * @returns {Promise<object>} The order.
 */
async function expectReturnedOnce(orderId, causes) {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  const rows = await returnsOf(orderId)

  expect(order.referralUseReturnedAt, orderId).not.toBeNull()
  expect(rows, orderId).toHaveLength(1)
  expect(rows[0].metadata.cause).toBe(order.referralUseReturnCause)

  if (causes) {
    expect([causes].flat()).toContain(order.referralUseReturnCause)
  }

  return order
}

/**
 * Asserts an order still holds its use.
 *
 * @param {string} orderId The order.
 * @returns {Promise<void>} Resolves when checked.
 */
async function expectKept(orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId } })

  expect(order.referralUseReturnedAt, orderId).toBeNull()
  expect(await returnsOf(orderId)).toHaveLength(0)
}

/**
 * R7: a code's count is the orders naming it whose use was not given back,
 * and never below zero.
 *
 * @param {string} referralCodeId The code.
 * @returns {Promise<number>} The count.
 */
async function expectIdentity(referralCodeId) {
  const row = await prisma.referralCode.findUnique({ where: { id: referralCodeId } })
  const holding = await prisma.order.count({
    where: { referralCodeId, referralUseReturnedAt: null },
  })

  expect(row.useCount, referralCodeId).toBe(holding)
  expect(row.useCount).toBeGreaterThanOrEqual(0)

  return row.useCount
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  // Ten transactions at once need their own connections: the suite's client
  // keeps the barrier and the polling.
  racers = createPrismaClient({ connectionString: TEST_CONNECTION })

  buyer = await person('buyer')
  owner = await person('owner', { role: 'ORGANIZER', privileged: true })
  administrator = await person('administrator', { role: 'ADMIN', privileged: true })
})

afterAll(async () => {
  await app?.close()
  await racers?.$disconnect().catch(() => {})
  await prisma.$disconnect().catch(() => {})
})

when()('a referral use given back once, whoever ends the order (SPEC3-XI XR)', () => {
  it(
    'R1. two line refunds of a waived card order settling at once: the one that ends it gives the use back, once (the order FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const place = await world('r1')
      const referral = await code()
      const { order } = await waivedCard(place, referral)
      const [first, second] = order.items
      const readyA = await refundReady(order, [first])
      const readyB = await refundReady(order, [second])

      expect(await expectIdentity(referral.id)).toBe(1)

      const results = await race(
        { table: 'Order', id: order.id },
        () => settle(place, order, readyA),
        () => settle(place, order, readyB),
      )

      expectNoDeadlock(results)
      expect(results.map((result) => result.data.settled)).toEqual([true, true])
      expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('REFUNDED')
      await expectReturnedOnce(order.id, 'REFUNDED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R2. two cancels of a waived booking’s two tickets at once: one return (the order FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const place = await world('r2')
      const referral = await code()
      const { order, tickets } = await waivedBooking(place, referral, 2)
      const actor = await actorFor(owner)

      const results = await race(
        { table: 'Order', id: order.id },
        () => cancelUnpaid(order, [tickets[0]], actor),
        () => cancelUnpaid(order, [tickets[1]], actor),
      )

      expectNoDeadlock(results)
      expect(results.map((result) => result.status)).toEqual([200, 200])
      await expectReturnedOnce(order.id, 'VENUE_UNPAID_CANCELLED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R3. deleting the event against cancelling a waived booking’s tickets, both arrival orders: one return (serialised at the tier)',
    { timeout: 120_000 },
    async () => {
      for (const cancelFirst of [true, false]) {
        const place = await world(`r3${cancelFirst ? 'a' : 'b'}`)
        const referral = await code()
        const { order, tickets } = await waivedBooking(place, referral, 2)
        const actor = await actorFor(owner)
        const sendDeletion = await deletion(place)
        const cancelling = () => cancelUnpaid(order, tickets, actor)

        const results = await race(
          { table: 'TicketType', id: place.tiers[0].id },
          cancelFirst ? cancelling : sendDeletion,
          cancelFirst ? sendDeletion : cancelling,
        )
        const [cancelled, deleted] = cancelFirst ? results : [...results].reverse()

        expectNoDeadlock(results)
        expect(deleted.status, deleted.body).toBe(200)

        if (cancelFirst) {
          expect(cancelled.status).toBe(200)
          await expectReturnedOnce(order.id, 'VENUE_UNPAID_CANCELLED')
        } else {
          expect(cancelled.status).toBe(409)
          await expectReturnedOnce(order.id, 'EVENT_DELETED')
        }

        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R4. the same refund settled twice at once (refunds.submit and reconciliation): settled once, one return (the refund row, then the order)',
    { timeout: 120_000 },
    async () => {
      const place = await world('r4')
      const referral = await code()
      const { order } = await waivedCard(place, referral)
      const ready = await refundReady(order, order.items)

      const results = await race(
        { table: 'Order', id: order.id },
        () => settle(place, order, ready),
        () => settle(place, order, ready),
      )

      expectNoDeadlock(results)
      expect(results.map((result) => Boolean(result.data?.settled)).sort()).toEqual([false, true])
      expect(await prisma.refund.count({ where: { orderId: order.id, status: 'SUCCEEDED' } })).toBe(
        1,
      )
      await expectReturnedOnce(order.id, 'REFUNDED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R5. ten returners at once on one ended order: the count lowered once, one audit row (the conditional marker)',
    { timeout: 120_000 },
    async () => {
      const place = await world('r5')
      const referral = await code()
      const { order, tickets } = await waivedBooking(place, referral, 1)

      // Ended without anything giving the use back: the fixture writes the
      // cancellation and nothing else.
      await prisma.$transaction((tx) => cancelledUnpaidFixture(tx, { order, tickets }))
      expect(await expectIdentity(referral.id)).toBe(1)
      await expectKept(order.id)

      const held = await holdRow(prisma, 'Order', order.id)
      const returners = Array.from({ length: 10 }, () =>
        racers
          .$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

              return settleReferralUsesIfEnded(tx, {
                entries: [{ orderId: order.id, cause: 'VENUE_UNPAID_CANCELLED' }],
                actorId: owner.id,
                now: new Date(),
              })
            },
            { timeout: 20_000, maxWait: 10_000 },
          )
          .then(
            (value) => ({ status: 200, data: value }),
            (error) => ({ status: 0, error: String(error?.message ?? error) }),
          ),
      )

      try {
        await untilBehind(held.pid, 10, 'all ten returners', () => null)
      } finally {
        held.release()
        await held.done
      }

      const results = await Promise.all(returners)

      expectNoDeadlock(results)
      expect(results.filter((result) => result.data.length === 1)).toHaveLength(1)
      expect(results.filter((result) => result.data.length === 0)).toHaveLength(9)
      await expectReturnedOnce(order.id, 'VENUE_UNPAID_CANCELLED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R6. a partial refund and a booking-fee refund keep the use; the refund of the last line gives it back',
    { timeout: 120_000 },
    async () => {
      const place = await world('r6')
      const referral = await code()
      const { order } = await waivedCard(place, referral)
      const [first, second] = order.items

      await settle(place, order, await refundReady(order, [first]))

      expect((await prisma.order.findUnique({ where: { id: order.id } })).status).not.toBe(
        'REFUNDED',
      )
      await expectKept(order.id)
      expect(await expectIdentity(referral.id)).toBe(1)

      // The booking fee was waived by the code, so a booking-fee refund has
      // nothing to give back, and the use stays.
      const headers = await headersFor(administrator)
      const quoted = await app.inject({
        method: 'GET',
        url: `/v1/platform/orders/${order.reference}/fee`,
        headers,
      })

      expect(quoted.statusCode, quoted.body).toBe(200)

      const fee = await app.inject({
        method: 'POST',
        url: `/v1/platform/orders/${order.reference}/fee-refund`,
        headers,
        payload: {
          reason: REASON,
          expectedRefundableCents:
            quoted.json().data.refundableFeeCents + quoted.json().data.taxOnFeeCents,
        },
      })

      expect(fee.statusCode, fee.body).toBe(409)
      expect(fee.json().error.code).toBe('NO_FEE_TO_REFUND')
      await expectKept(order.id)

      await settle(place, order, await refundReady(order, [second]))

      expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('REFUNDED')
      await expectReturnedOnce(order.id, 'REFUNDED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R9. cancelling the event gives a zero-online booking’s use back at once, and a card order’s when its refund settles',
    { timeout: 120_000 },
    async () => {
      const place = await world('r9')
      const referral = await code()
      const booking = await waivedBooking(place, referral, 2)
      const card = await waivedCard(place, referral)

      expect(await expectIdentity(referral.id)).toBe(2)

      const cancelled = await cancelEvent(place)

      expect(cancelled.statusCode, cancelled.body).toBe(200)
      await expectReturnedOnce(booking.order.id, 'EVENT_CANCELLED')
      // The card order's money is still to go back: its refund was asked for
      // and it keeps the use until that settles.
      expect(
        await prisma.refund.count({ where: { orderId: card.order.id, status: 'REQUESTED' } }),
      ).toBe(1)
      await expectKept(card.order.id)
      expect(await expectIdentity(referral.id)).toBe(1)

      const event = await prisma.event.findUnique({
        where: { id: place.event.id },
        include: { sessions: true },
      })
      const sent = await refundOwed(prisma, {
        event,
        actor: await actorFor(owner),
        providers,
        via: 'finish_refunds',
      })

      expect(sent.settled).toBe(1)
      expect((await prisma.order.findUnique({ where: { id: card.order.id } })).status).toBe(
        'REFUNDED',
      )
      await expectReturnedOnce(card.order.id, 'REFUNDED')
      expect(await expectIdentity(referral.id)).toBe(0)
    },
  )

  it(
    'R10. cancelling an event with two waived bookings against cancel-unpaid, a revocation and a refund settling on orders naming the same code, ×20 each: no deadlock, one return per ended order (orders before codes)',
    { timeout: 300_000 },
    async () => {
      for (const variant of ['cancelUnpaid', 'revoke', 'settleRefund']) {
        for (let round = 0; round < ROUNDS; round += 1) {
          const eventFirst = round % 2 === 0
          const place = await world(`r10${variant}${round}`)
          const referral = await code()
          const first = await waivedBooking(place, referral, 1)
          const second = await waivedBooking(place, referral, 1)
          const card = variant === 'settleRefund' ? await waivedCard(place, referral) : null
          const ready = card ? await refundReady(card.order, card.order.items) : null
          const actor = await actorFor(owner)
          const other = {
            cancelUnpaid: () => cancelUnpaid(second.order, second.tickets, actor),
            revoke: () =>
              app.inject({
                method: 'POST',
                url: `/v1/tickets/${second.tickets[0].id}/revoke`,
                headers: place.ownerHeaders,
                payload: { reason: 'Withdrawn by the referral returns suite.' },
              }),
            settleRefund: () => settle(place, card.order, ready),
          }[variant]
          const barrier = { table: 'Order', id: (card ?? second).order.id }
          const results = await race(
            barrier,
            eventFirst ? () => cancelEvent(place) : other,
            eventFirst ? other : () => cancelEvent(place),
          )
          const label = `${variant}, ${eventFirst ? 'event' : 'other'} first, round ${round}`

          expectNoDeadlock(results)

          const cancelled = eventFirst ? results[0] : results[1]

          expect(cancelled.status, `${label}: ${cancelled.body}`).toBe(200)

          for (const ended of [first, second, card].filter(Boolean)) {
            await expectReturnedOnce(ended.order.id)
          }

          expect(await expectIdentity(referral.id), label).toBe(0)
        }
      }
    },
  )

  it(
    'R11. two events cancelled at once whose orders name two codes in opposite orders, ×20: no deadlock, every use given back once (codes ascending, last)',
    { timeout: 300_000 },
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const one = await world(`r11a${round}`)
        const two = await world(`r11b${round}`)
        const codes = [await code(), await code()]
        const orders = [
          await waivedBooking(one, codes[0]),
          await waivedBooking(one, codes[1]),
          await waivedBooking(two, codes[1]),
          await waivedBooking(two, codes[0]),
        ]
        const lowest = [...codes].sort((a, b) => (a.id < b.id ? -1 : 1))[0]

        const results = await race(
          { table: 'ReferralCode', id: lowest.id },
          () => cancelEvent(round % 2 === 0 ? one : two),
          () => cancelEvent(round % 2 === 0 ? two : one),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])

        for (const booked of orders) await expectReturnedOnce(booked.order.id, 'EVENT_CANCELLED')

        for (const row of codes) expect(await expectIdentity(row.id)).toBe(0)
      }
    },
  )

  it(
    'R12. deletion cancelling unpaid orders naming a code, against a zero-total capture left unsettled on one of them, both arrival orders: each cancelled once, two returns (no code held while waiting for an order)',
    { timeout: 120_000 },
    async () => {
      for (const deletionFirst of [true, false, true, false]) {
        const place = await world(`r12${deletionFirst ? 'a' : 'b'}`)
        const referral = await code()
        const lines = [{ ticketTypeId: place.tiers[0].id, quantity: 1, unitPriceCents: PRICE }]
        const pending = []

        for (let index = 0; index < 2; index += 1) {
          pending.push(
            await prisma.$transaction((tx) =>
              pendingZeroTotalOrder(tx, {
                world: place,
                referralCode: referral,
                tag: tag('pending'),
                userId: buyer.id,
                lines,
              }),
            ),
          )
        }

        const [onlyDeleted, contested] = pending.map((row) => row.order)

        expect(await expectIdentity(referral.id)).toBe(2)

        const sendDeletion = await deletion(place)
        const unsettled = () =>
          prisma.$transaction((tx) =>
            recordUnsettledCapture(tx, {
              order: contested,
              payment: null,
              result: { outcome: CAPTURE_OUTCOMES.TIMEOUT, rawStatus: 'ZERO_TOTAL' },
              reason: 'The suite left the booking unsettled.',
              now: new Date(),
            }),
          )

        const results = await race(
          { table: 'Order', id: contested.id },
          deletionFirst ? sendDeletion : unsettled,
          deletionFirst ? unsettled : sendDeletion,
        )
        const [deleted, captured] = deletionFirst ? results : [...results].reverse()

        expectNoDeadlock(results)
        expect(deleted.status, deleted.body).toBe(200)
        expect(captured.data.recorded).toBe(!deletionFirst)

        for (const order of [onlyDeleted, contested]) {
          expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe(
            'CANCELLED',
          )
          expect(
            await prisma.auditLog.count({
              where: { action: AUDIT_ACTIONS.ORDER_CANCELLED, entityId: order.id },
            }),
          ).toBe(1)
        }

        await expectReturnedOnce(onlyDeleted.id, 'UNPAID_ORDER_CANCELLED')
        await expectReturnedOnce(
          contested.id,
          deletionFirst ? 'UNPAID_ORDER_CANCELLED' : 'NOT_COMPLETED',
        )
        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R12b. a night’s cancellation of unpaid orders naming a code, against a zero-total capture left unsettled on one of them, both arrival orders: each cancelled once, two returns (the capture takes the tiers and the night before its order)',
    { timeout: 120_000 },
    async () => {
      for (const nightFirst of [true, false, true, false]) {
        const place = await world(`r12n${nightFirst ? 'a' : 'b'}`)
        // A second night, sold by a tier of its own and inside the event's
        // dates: the last night left cannot be cancelled.
        const opens = new Date(place.session.startsAt.getTime() + 86_400_000)
        const closes = new Date(opens.getTime() + 4 * 3_600_000)

        await prisma.event.update({ where: { id: place.event.id }, data: { endsAt: closes } })

        const night = await prisma.eventSession.create({
          data: {
            eventId: place.event.id,
            label: 'Night 2',
            startsAt: opens,
            endsAt: closes,
            timezone: 'America/Chicago',
            capacity: 500,
          },
        })
        const nightTier = await prisma.ticketType.create({
          data: {
            eventId: place.event.id,
            eventSessionId: night.id,
            name: `Night two ${tag('tier')}`,
            priceCents: PRICE,
            currency: FEE_ORDER_CURRENCY,
            quantityTotal: 200,
            maxPerOrder: 10,
            status: 'ON_SALE',
          },
        })
        const referral = await code()
        const lines = [{ ticketTypeId: nightTier.id, quantity: 1, unitPriceCents: PRICE }]
        const pending = []

        for (let index = 0; index < 2; index += 1) {
          pending.push(
            await prisma.$transaction((tx) =>
              pendingZeroTotalOrder(tx, {
                world: { ...place, session: night },
                referralCode: referral,
                tag: tag('pending'),
                userId: buyer.id,
                lines,
              }),
            ),
          )
        }

        const [onlyCancelled, contested] = pending.map((row) => row.order)

        expect(contested.eventSessionId).toBe(night.id)
        expect(await expectIdentity(referral.id)).toBe(2)

        // The night's cancellation, previewed now and sent when called.
        const nightCancellation = async () => {
          const preview = await app.inject({
            method: 'GET',
            url: `/v1/events/${place.event.id}/sessions/${night.id}/cancellation`,
            headers: place.ownerHeaders,
          })

          expect(preview.statusCode, preview.body).toBe(200)

          const { revision } = await prisma.event.findUnique({ where: { id: place.event.id } })

          return () =>
            app.inject({
              method: 'POST',
              url: `/v1/events/${place.event.id}/sessions/${night.id}/cancel`,
              headers: place.ownerHeaders,
              payload: {
                revision,
                reason: 'The band could not travel that night.',
                confirm: true,
                expectedOrders: preview.json().data.orders,
              },
            })
        }
        const sendCancellation = await nightCancellation()
        const unsettled = () =>
          prisma.$transaction((tx) =>
            recordUnsettledCapture(tx, {
              order: contested,
              payment: null,
              result: { outcome: CAPTURE_OUTCOMES.TIMEOUT, rawStatus: 'ZERO_TOTAL' },
              reason: 'The suite left the booking unsettled.',
              now: new Date(),
            }),
          )

        const results = await race(
          { table: 'Order', id: contested.id },
          nightFirst ? sendCancellation : unsettled,
          nightFirst ? unsettled : sendCancellation,
        )
        const [cancelled, captured] = nightFirst ? results : [...results].reverse()

        expectNoDeadlock(results)
        expect(captured.data.recorded).toBe(!nightFirst)

        if (nightFirst) {
          expect(cancelled.status, cancelled.body).toBe(200)
        } else {
          // The capture went first and cancelled one of the night's orders
          // under the cancellation's feet: it says so rather than act on what
          // its preview read, and a fresh preview goes through.
          expect(cancelled.status, cancelled.body).toBe(409)
          expect(cancelled.code).toBe('ORDERS_CHANGED')

          const again = await (await nightCancellation())()

          expect(again.statusCode, again.body).toBe(200)
        }

        expect((await prisma.eventSession.findUnique({ where: { id: night.id } })).status).toBe(
          'CANCELLED',
        )

        for (const order of [onlyCancelled, contested]) {
          expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe(
            'CANCELLED',
          )
          expect(
            await prisma.auditLog.count({
              where: { action: AUDIT_ACTIONS.ORDER_CANCELLED, entityId: order.id },
            }),
          ).toBe(1)
        }

        await expectReturnedOnce(onlyCancelled.id, 'UNPAID_ORDER_CANCELLED')
        await expectReturnedOnce(
          contested.id,
          nightFirst ? 'UNPAID_ORDER_CANCELLED' : 'NOT_COMPLETED',
        )
        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R13. an event cancelled between a waived booking’s creation and its settlement, both interleavings: one return, EVENT_CANCELLED; a card order settled first has its refund asked for',
    { timeout: 120_000 },
    async () => {
      const lines = (place) => [
        { ticketTypeId: place.tiers[0].id, quantity: 1, unitPriceCents: PRICE },
      ]

      for (const settledFirst of [true, false]) {
        const place = await world(`r13${settledFirst ? 'a' : 'b'}`)
        const referral = await code()
        const { order } = await prisma.$transaction((tx) =>
          pendingZeroTotalOrder(tx, {
            world: place,
            referralCode: referral,
            tag: tag('pending'),
            userId: buyer.id,
            lines: lines(place),
          }),
        )
        const settling = () => settleZeroTotal(order)
        const cancelling = () => cancelEvent(place)

        const results = await race(
          { table: 'Order', id: order.id },
          settledFirst ? settling : cancelling,
          settledFirst ? cancelling : settling,
        )
        const [settled, cancelled] = settledFirst ? results : [...results].reverse()

        expectNoDeadlock(results)
        expect(cancelled.status, cancelled.body).toBe(200)
        expect(settled.status, JSON.stringify(settled)).toBe(200)
        expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')
        await expectReturnedOnce(order.id, 'EVENT_CANCELLED')
        expect(await expectIdentity(referral.id)).toBe(0)
      }

      // A card order whose settlement commits before the cancellation's lock:
      // the cancellation finds it paid and asks for its refund.
      const place = await world('r13card')
      const pending = await pendingCard(place)
      const results = await race(
        { table: 'Order', id: pending.order.id },
        () =>
          prisma.$transaction((tx) =>
            settleCheckout(tx, {
              order: pending.order,
              payment: pending.payment,
              result: {
                outcome: CAPTURE_OUTCOMES.SUCCEEDED,
                intent: pending.intent,
                rawStatus: 'SUCCEEDED',
              },
              now: new Date(),
              generateTicketCode: () => `DET-RC${tag('code')}`.toUpperCase().slice(0, 32),
              credentialSecret: SECRET,
            }),
          ),
        () => cancelEvent(place),
      )

      expectNoDeadlock(results)
      expect(results.map((result) => result.status)).toEqual([200, 200])

      const paid = await prisma.order.findUnique({ where: { id: pending.order.id } })

      expect(paid.status).toBe('PAID')
      expect(
        await prisma.refund.findMany({
          where: { orderId: paid.id },
          select: { amountCents: true },
        }),
      ).toEqual([{ amountCents: paid.totalCents }])
    },
  )

  // R14–R17 (final door review, finding 1): two transactions ending two
  // DIFFERENT orders, on two events, that name ONE code. Each writes its order
  // a second time (the marker, or settleRefund's REFUNDED), so PostgreSQL's
  // foreign-key re-check of that second write takes the code `FOR KEY SHARE`
  // before the batch locks it. With the code locked `FOR UPDATE` in step 5 the
  // two share holders each waited for the other (40P01); `FOR NO KEY UPDATE`
  // does not conflict with the key share and still serialises the counts.
  // The barrier is the code row, held until both sides queue behind it.

  it(
    'R14. the organiser cancels a waived booking’s unpaid tickets on E1 while an administrator cancels another on E2, one code, both arrival orders: no deadlock, two returns',
    { timeout: 120_000 },
    async () => {
      for (const ownerFirst of [true, false]) {
        const referral = await code()
        const one = await world(`r14a${ownerFirst ? 'o' : 'a'}`)
        const two = await world(`r14b${ownerFirst ? 'o' : 'a'}`)
        // Read after the worlds, so the owner's actor carries their memberships.
        const organiser = await actorFor(owner)
        const admin = await actorFor(administrator)
        const first = await waivedBooking(one, referral, 2)
        const second = await waivedBooking(two, referral, 2)

        expect(await expectIdentity(referral.id)).toBe(2)

        const byOwner = () => cancelUnpaid(first.order, first.tickets, organiser)
        const byAdmin = () => cancelUnpaid(second.order, second.tickets, admin)
        const results = await race(
          { table: 'ReferralCode', id: referral.id },
          ...(ownerFirst ? [byOwner, byAdmin] : [byAdmin, byOwner]),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])
        await expectReturnedOnce(first.order.id, 'VENUE_UNPAID_CANCELLED')
        await expectReturnedOnce(second.order.id, 'VENUE_UNPAID_CANCELLED')
        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R15. two whole refunds ending two waived card orders on two events, one code, settling at once: no deadlock, two returns',
    { timeout: 120_000 },
    async () => {
      for (const round of [0, 1]) {
        const referral = await code()
        const one = await world(`r15a${round}`)
        const two = await world(`r15b${round}`)
        const { order: first } = await waivedCard(one, referral)
        const { order: second } = await waivedCard(two, referral)
        const readyFirst = await refundReady(first, first.items)
        const readySecond = await refundReady(second, second.items)

        expect(await expectIdentity(referral.id)).toBe(2)

        const sides = [() => settle(one, first, readyFirst), () => settle(two, second, readySecond)]
        const results = await race(
          { table: 'ReferralCode', id: referral.id },
          ...(round ? sides.reverse() : sides),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])

        for (const order of [first, second]) {
          expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe(
            'REFUNDED',
          )
          await expectReturnedOnce(order.id)
        }

        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R16. a refund ending a waived card order on E1 against the cancellation of a waived booking’s unpaid tickets on E2, one code, both arrival orders: no deadlock, two returns',
    { timeout: 120_000 },
    async () => {
      for (const refundFirst of [true, false]) {
        const referral = await code()
        const one = await world(`r16a${refundFirst ? 'r' : 'c'}`)
        const two = await world(`r16b${refundFirst ? 'r' : 'c'}`)
        const actor = await actorFor(owner)
        const { order: card } = await waivedCard(one, referral)
        const booked = await waivedBooking(two, referral, 2)
        const ready = await refundReady(card, card.items)

        expect(await expectIdentity(referral.id)).toBe(2)

        const refunding = () => settle(one, card, ready)
        const cancelling = () => cancelUnpaid(booked.order, booked.tickets, actor)
        const results = await race(
          { table: 'ReferralCode', id: referral.id },
          ...(refundFirst ? [refunding, cancelling] : [cancelling, refunding]),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])
        await expectReturnedOnce(card.id)
        await expectReturnedOnce(booked.order.id, 'VENUE_UNPAID_CANCELLED')
        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R17. two zero-total bookings on two events, one code, both left unsettled at once (NOT_COMPLETED): no deadlock, two returns',
    { timeout: 120_000 },
    async () => {
      for (const round of [0, 1]) {
        const referral = await code()
        const pending = []

        for (const label of ['a', 'b']) {
          const place = await world(`r17${label}${round}`)

          pending.push(
            await prisma.$transaction((tx) =>
              pendingZeroTotalOrder(tx, {
                world: place,
                referralCode: referral,
                tag: tag('pending'),
                userId: buyer.id,
                lines: [{ ticketTypeId: place.tiers[0].id, quantity: 1, unitPriceCents: PRICE }],
              }),
            ),
          )
        }

        expect(await expectIdentity(referral.id)).toBe(2)

        const unsettled = (order) => () =>
          prisma.$transaction((tx) =>
            recordUnsettledCapture(tx, {
              order,
              payment: null,
              result: { outcome: CAPTURE_OUTCOMES.TIMEOUT, rawStatus: 'ZERO_TOTAL' },
              reason: 'Left unsettled by the referral returns suite.',
              now: new Date(),
            }),
          )
        const sides = [unsettled(pending[0].order), unsettled(pending[1].order)]
        const results = await race(
          { table: 'ReferralCode', id: referral.id },
          ...(round ? sides.reverse() : sides),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])

        for (const { order } of pending) await expectReturnedOnce(order.id, 'NOT_COMPLETED')

        expect(await expectIdentity(referral.id)).toBe(0)
      }
    },
  )

  it(
    'R7. every code this file made: its count is the orders naming it with no return marked, never below zero',
    { timeout: 120_000 },
    async () => {
      expect(CODES.size).toBeGreaterThan(0)

      for (const referralCodeId of CODES) await expectIdentity(referralCodeId)
    },
  )
})
