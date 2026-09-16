/**
 * The nine ways a refund can race, against a real database.
 *
 * A refund is the one commerce action where every failure mode costs somebody
 * money, and every safety argument in `../src/lib/refunds.js` is a claim about
 * what PostgreSQL does when two statements reach one row. A stub cannot check
 * any of it: the CHECK constraint that stops an over-refund, the conditional
 * `UPDATE` that makes settlement happen once, and the trigger that refuses a
 * check-in on a refunded ticket all live in the database.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips, because a suite that skipped reads exactly like a suite that
 * passed.
 *
 * Nothing is cleaned up afterwards, for the reason the seated suite gives: the
 * ledger is append-only, `db:verify:fresh` builds a new database per run, and
 * every row here carries a per-run suffix.
 *
 * @module @desi-event/api/tests/refund-concurrency
 */

import { createHash } from 'node:crypto'

import { createInMemoryPaymentProvider } from '@desi-event/providers'
import { afterAll, expect, it } from 'vitest'

import { settleCheckout } from '../src/lib/checkout.js'
import {
  REFUND_OUTCOMES,
  REFUND_STATES,
  approveRefund,
  markSubmitted,
  pendingQuantitiesByLine,
  recordRefundFailure,
  recordRefundTimeout,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../src/lib/refunds.js'
import { claimSeats } from '../src/lib/seating.js'
import { assertSeatsCoherent, loadSeatedHoldItems, priceLines } from '../src/lib/seated-checkout.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the refund concurrency suite')

/** A suffix unique to this run, so two runs cannot collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/** What every seat in this suite costs. Divisible by four, so quarters are whole. */
const SEAT_PRICE_CENTS = 100_000

/**
 * One provider for the whole suite.
 *
 * Not one per world: a fresh in-memory provider starts its ids at `pi_000001`,
 * and `Payment.provider + providerRef` is unique, so two worlds would collide
 * on the second one. The prefix carries the run so two runs against the same
 * database do not collide either.
 */
const payments = createInMemoryPaymentProvider({ idPrefix: `pi${RUN}` })

let sequence = 0

/**
 * A unique identifier for this run, shaped like one Prisma would generate.
 *
 * CUID-shaped rather than readable for the reason the seated suite records: a
 * row seeded with a readable id is a row the API cannot serialise, and this
 * suite leaves its rows behind.
 *
 * @param {string} kind What it names, folded into the hash so two kinds differ.
 * @returns {string} A 25-character CUID-shaped identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`refundrace-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * How many results in a settled batch failed, and with what.
 *
 * @param {Array<object>} results From `Promise.allSettled`.
 * @returns {{won: Array<object>, lost: Array<object>}} The two groups.
 */
function split(results) {
  return {
    won: results.filter((result) => result.status === 'fulfilled'),
    lost: results.filter((result) => result.status === 'rejected'),
  }
}

/**
 * Build a published event with one reserved-seat session and sell every seat.
 *
 * The order is produced by the real checkout path rather than inserted: a
 * refund against a hand-made order would be a refund against a shape checkout
 * never produces, and the triggers would be the only thing to notice.
 *
 * @param {object} [options] Options.
 * @param {number} [options.seats] How many seats, and therefore how many tickets.
 * @param {number} [options.startsInHours] How far away the event is, for the seat policy.
 * @returns {Promise<object>} Everything the tests need, including the paid order.
 */
async function buildPaidOrder({ seats = 4, startsInHours = 72 } = {}) {
  const startsAt = new Date(Date.now() + startsInHours * 3_600_000)
  const endsAt = new Date(startsAt.getTime() + 3_600_000)

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Refund Collective ${RUN}`,
      slug: `refundrace-${RUN}-org-${(sequence += 1).toString(36)}`,
      contactEmail: `refund-${RUN}@desi-event.example`,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Refund Hall',
      slug: `refundrace-${RUN}-venue-${(sequence += 1).toString(36)}`,
      addressLine1: '1 Test Road',
      city: 'Chennai',
      region: 'TN',
      postalCode: '600001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Refund Night ${RUN}`,
      slug: `refundrace-${RUN}-event-${(sequence += 1).toString(36)}`,
      category: 'MUSIC_CONCERT',
      summary: 'An event whose tickets are about to be given back.',
      description: 'Built by the refund concurrency suite.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Stalls',
      priceCents: SEAT_PRICE_CENTS,
      currency: 'INR',
      quantityTotal: seats,
      status: 'ON_SALE',
    },
  })

  const map = await prisma.venueMap.create({
    data: { id: id('map'), venueId: venue.id, name: 'Refund Hall plan' },
  })

  const version = await prisma.venueMapVersion.create({
    data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: seats },
  })

  const section = await prisma.section.create({
    data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })

  const row = await prisma.seatRow.create({
    data: { id: id('row'), venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })

  const seatRows = []

  for (let index = 0; index < seats; index += 1) {
    seatRows.push(
      await prisma.seat.create({
        data: {
          id: id(`seat-${index}`),
          venueMapVersionId: version.id,
          sectionId: section.id,
          rowId: row.id,
          label: `A${index + 1}`,
          sortOrder: index + 1,
        },
      }),
    )
  }

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      venueMapVersionId: version.id,
    },
  })

  const eventSeats = []

  for (const [index, seat] of seatRows.entries()) {
    eventSeats.push(
      await prisma.eventSeat.create({
        data: {
          id: id(`eventseat-${index}`),
          eventSessionId: session.id,
          seatId: seat.id,
          ticketTypeId: ticketType.id,
          status: 'AVAILABLE',
        },
      }),
    )
  }

  const hold = await prisma.$transaction(async (tx) => {
    const created = await tx.ticketHold.create({
      data: {
        id: id('hold'),
        ticketTypeId: ticketType.id,
        eventSessionId: session.id,
        quantity: eventSeats.length,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
        guestTokenHash: createHash('sha256')
          .update(`token-${RUN}-${(sequence += 1)}`)
          .digest('hex'),
      },
    })

    await claimSeats(tx, { eventSeatIds: eventSeats.map((seat) => seat.id), holdId: created.id })

    for (const seat of eventSeats) {
      await tx.holdItem.create({
        data: {
          id: id('holditem'),
          holdId: created.id,
          ticketTypeId: ticketType.id,
          eventSeatId: seat.id,
          quantity: 1,
        },
      })
    }

    return created
  })

  // A real intent, captured, so the refund has something to be against. The
  // provider is the in-memory one: no network, no credentials, and its refund
  // ids are its own rather than manufactured here.
  const intent = payments.createIntent({
    amountCents: SEAT_PRICE_CENTS * seats,
    currency: 'INR',
  })

  payments.capture(intent.id)

  const { order, payment } = await prisma.$transaction(async (tx) => {
    const seatedItems = await loadSeatedHoldItems(tx, [hold.id])

    assertSeatsCoherent(seatedItems, new Map([[hold.id, hold]]), session.id)

    const { lines, seatsByLineKey } = priceLines({
      items: [{ ticketTypeId: ticketType.id, quantity: seatedItems.length }],
      ticketTypesById: new Map([[ticketType.id, ticketType]]),
      seatedItems,
    })

    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)

    const created = await tx.order.create({
      data: {
        id: id('order'),
        reference: `DE-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
        eventId: event.id,
        eventSessionId: session.id,
        buyerEmail: 'refunder@desi-event.example',
        buyerName: 'Refunder',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents,
        totalCents: subtotalCents,
      },
    })

    await tx.ticketHold.update({ where: { id: hold.id }, data: { orderId: created.id } })

    for (const line of lines) {
      const orderItem = await tx.orderItem.create({
        data: {
          id: id('line'),
          orderId: created.id,
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          subtotalCents: line.unitPriceCents * line.quantity,
        },
      })

      for (const seat of seatsByLineKey.get(`${line.ticketTypeId}:${line.unitPriceCents}`) ?? []) {
        await tx.holdItem.update({
          where: { id: seat.id },
          data: { orderItemId: orderItem.id, unitPriceCents: line.unitPriceCents },
        })
      }
    }

    const attempt = await tx.payment.create({
      data: {
        id: id('payment'),
        orderId: created.id,
        provider: 'in-memory-payments',
        providerRef: intent.id,
        status: 'INITIATED',
        amountCents: subtotalCents,
        currency: 'INR',
      },
    })

    return { order: created, payment: attempt }
  })

  let codes = 0

  await prisma.$transaction((tx) =>
    settleCheckout(tx, {
      order,
      payment,
      result: { outcome: 'SUCCEEDED', intent, rawStatus: 'SUCCEEDED' },
      now: new Date(),
      generateTicketCode: () => {
        codes += 1

        return `DET-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}${codes}`
      },
      credentialSecret: SECRET,
    }),
  )

  const paid = await prisma.order.findUnique({
    where: { id: order.id },
    include: { items: true },
  })
  const settledPayment = await prisma.payment.findUnique({ where: { id: payment.id } })

  return {
    organization,
    event,
    session,
    ticketType,
    eventSeats,
    order: paid,
    payment: settledPayment,
    payments,
    intent,
  }
}

/**
 * Read the order back with its lines, the way a request handler would.
 *
 * @param {string} orderId Which order.
 * @returns {Promise<object>} The order and its items.
 */
function readOrder(orderId) {
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } })
}

/**
 * Ask for a refund, in one transaction, the way the route does.
 *
 * @param {object} world From {@link buildPaidOrder}.
 * @param {object} params What to ask for.
 * @param {number} [params.amountCents] An amount refund.
 * @param {Array<object>} [params.lines] A line refund.
 * @param {string} params.key The idempotency key.
 * @returns {Promise<{refund: object, created: boolean}>} What the service returned.
 */
function ask(world, { amountCents, lines, key }) {
  return prisma.$transaction(async (tx) => {
    const order = await readOrder(world.order.id)
    const pendingByLine = lines ? await pendingQuantitiesByLine(tx, order.id) : new Map()

    return requestRefund(tx, {
      order,
      payment: world.payment,
      amountCents,
      lines: lines ?? null,
      pendingByLine,
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: key,
      actorId: null,
      now: new Date(),
    })
  })
}

/**
 * Take a requested refund all the way to the provider and back.
 *
 * The same three phases the route uses: SUBMITTED in its own transaction, the
 * provider with nothing open, then a short transaction recording the answer.
 *
 * @param {object} world From {@link buildPaidOrder}.
 * @param {object} refund The refund to push through.
 * @param {object} [options] Options.
 * @param {object} [options.provider] A provider to use instead of the world's.
 * @returns {Promise<object>} `{ outcome, settled }`.
 */
async function pushThrough(world, refund, { provider } = {}) {
  const payments = provider ?? world.payments

  await prisma.$transaction((tx) => approveRefund(tx, { refund, actorId: null, now: new Date() }))

  const approved = await prisma.refund.findUnique({ where: { id: refund.id } })
  const claimed = await prisma.$transaction((tx) =>
    markSubmitted(tx, { refund: approved, now: new Date() }),
  )

  if (!claimed) return { outcome: null, settled: false }

  const submitted = await prisma.refund.findUnique({ where: { id: refund.id } })
  const result = await submitOutsideTransaction(payments, submitted, world.payment)

  const recorded = await prisma.$transaction(async (tx) => {
    const order = await readOrder(world.order.id)

    if (result.outcome === REFUND_OUTCOMES.SUCCEEDED) {
      return settleRefund(tx, {
        refund: submitted,
        order,
        result,
        organizationId: world.organization.id,
        eventStartsAt: world.event.startsAt,
        actorId: null,
        now: new Date(),
      })
    }

    if (result.outcome === REFUND_OUTCOMES.TIMEOUT) {
      return recordRefundTimeout(tx, {
        refund: submitted,
        order,
        result,
        organizationId: world.organization.id,
        actorId: null,
        now: new Date(),
      })
    }

    return recordRefundFailure(tx, {
      refund: submitted,
      order,
      result,
      actorId: null,
      now: new Date(),
    })
  })

  return { outcome: result.outcome, ...recorded }
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('two full-refund requests', () => {
  it('reserves the order once, and tells the loser why', async () => {
    const world = await buildPaidOrder()
    const total = world.order.totalCents

    const results = await Promise.allSettled([
      ask(world, { amountCents: total, key: `${RUN}-full-a` }),
      ask(world, { amountCents: total, key: `${RUN}-full-b` }),
    ])

    const { won, lost } = split(results)

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    // Either the conditional update found the counters moved, or the CHECK
    // constraint refused the second reservation. Both are the database saying
    // no; neither is this code noticing in time.
    expect(String(lost[0].reason)).toMatch(/refund|somebody else|constraint/i)

    const after = await readOrder(world.order.id)

    expect(after.refundPendingCents).toBe(total)
    expect(await prisma.refund.count({ where: { orderId: world.order.id } })).toBe(1)
  })

  it('answers a retried request with the refund the first one made', async () => {
    const world = await buildPaidOrder()
    const key = `${RUN}-idem-${(sequence += 1).toString(36)}`

    const first = await ask(world, { amountCents: 25_000, key })
    const second = await ask(world, { amountCents: 25_000, key })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.refund.id).toBe(first.refund.id)

    // The reservation was taken once. A retry that reserved again would put
    // the order half way to being refunded twice with nobody having asked.
    const after = await readOrder(world.order.id)

    expect(after.refundPendingCents).toBe(25_000)
  })
})

when()('a full and a partial request racing', () => {
  it('lets exactly one of them through', async () => {
    const world = await buildPaidOrder()
    const total = world.order.totalCents

    const results = await Promise.allSettled([
      ask(world, { amountCents: total, key: `${RUN}-mixed-full` }),
      ask(world, { amountCents: Math.floor(total / 4), key: `${RUN}-mixed-part` }),
    ])

    const { won } = split(results)

    expect(won).toHaveLength(1)

    const after = await readOrder(world.order.id)

    // Whichever won, the reservation equals what it asked for and no more.
    expect(after.refundPendingCents).toBe(won[0].value.refund.amountCents)
    expect(after.refundedCents + after.refundPendingCents).toBeLessThanOrEqual(after.totalCents)
  })
})

when()('multiple partial refunds reaching the ceiling', () => {
  it('stops at the total, whatever order they arrive in', async () => {
    const world = await buildPaidOrder()
    const total = world.order.totalCents
    const quarter = total / 4

    // Five quarters of an order. The fifth is the one the ceiling exists for.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        ask(world, { amountCents: quarter, key: `${RUN}-ceiling-${index}` }),
      ),
    )

    const { won } = split(results)

    expect(won.length).toBeLessThanOrEqual(4)

    const after = await readOrder(world.order.id)

    expect(after.refundPendingCents).toBe(won.length * quarter)
    expect(after.refundPendingCents).toBeLessThanOrEqual(total)
  })

  it('refuses a line refund for tickets another request already spoke for', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const line = world.order.items[0]

    await ask(world, {
      lines: [{ orderItemId: line.id, quantity: line.quantity }],
      key: `${RUN}-lines-all`,
    })

    // The money ceiling would not catch this on its own if the first refund
    // were cancelled later; the line count is what stops two refunds from
    // between them revoking one ticket and paying for two.
    await expect(
      ask(world, { lines: [{ orderItemId: line.id, quantity: 1 }], key: `${RUN}-lines-again` }),
    ).rejects.toThrow(/already been refunded or is being refunded/i)
  })
})

when()('a duplicate provider response', () => {
  it('settles once, revokes once, and posts the ledger once', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const { refund } = await ask(world, {
      amountCents: world.order.totalCents,
      key: `${RUN}-dupe`,
    })

    await prisma.$transaction((tx) => approveRefund(tx, { refund, actorId: null, now: new Date() }))

    const approved = await prisma.refund.findUnique({ where: { id: refund.id } })

    await prisma.$transaction((tx) => markSubmitted(tx, { refund: approved, now: new Date() }))

    const submitted = await prisma.refund.findUnique({ where: { id: refund.id } })
    const result = {
      outcome: REFUND_OUTCOMES.SUCCEEDED,
      providerRefundId: `${world.intent.id}-re`,
      failureCode: null,
      rawStatus: 'SUCCEEDED',
    }

    // The same answer twice — a webhook and a re-query, or one webhook
    // delivered twice, which every provider does eventually.
    const settlements = await Promise.allSettled([
      prisma.$transaction(async (tx) =>
        settleRefund(tx, {
          refund: submitted,
          order: await readOrder(world.order.id),
          result,
          organizationId: world.organization.id,
          eventStartsAt: world.event.startsAt,
          actorId: null,
          now: new Date(),
        }),
      ),
      prisma.$transaction(async (tx) =>
        settleRefund(tx, {
          refund: submitted,
          order: await readOrder(world.order.id),
          result,
          organizationId: world.organization.id,
          eventStartsAt: world.event.startsAt,
          actorId: null,
          now: new Date(),
        }),
      ),
    ])

    const settled = settlements.filter(
      (entry) => entry.status === 'fulfilled' && entry.value.settled,
    )

    expect(settled).toHaveLength(1)

    const after = await readOrder(world.order.id)

    expect(after.refundedCents).toBe(world.order.totalCents)
    expect(after.refundPendingCents).toBe(0)
    expect(after.status).toBe('REFUNDED')

    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: { in: world.order.items.map((item) => item.id) } },
    })

    expect(tickets.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)

    // Two batches for one refund — "we owe this back" and "it has gone" — and
    // not four.
    const batches = await prisma.ledgerBatch.count({ where: { refundId: refund.id } })

    expect(batches).toBe(2)
  })
})

when()('a timeout followed by a webhook saying it worked', () => {
  it('keeps the reservation, opens reconciliation, and settles on the answer', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const amountCents = world.order.totalCents

    // A provider that will not answer for this amount. Nothing random: the
    // mock takes the amount as the lever, so the case is reproducible.
    const silent = createInMemoryPaymentProvider({
      idPrefix: `pito${RUN}`,
      refundTimeoutAmountCents: amountCents,
    })
    const intent = silent.createIntent({ amountCents, currency: 'INR' })

    silent.capture(intent.id)

    const { refund } = await ask(world, { amountCents, key: `${RUN}-timeout` })
    const pushed = await pushThrough(
      { ...world, payment: { ...world.payment, providerRef: intent.id } },
      refund,
      { provider: silent },
    )

    expect(pushed.outcome).toBe(REFUND_OUTCOMES.TIMEOUT)

    const timedOut = await prisma.refund.findUnique({ where: { id: refund.id } })
    const duringTimeout = await readOrder(world.order.id)

    expect(timedOut.status).toBe(REFUND_STATES.TIMEOUT)
    // The reservation stays. Releasing it is how an order gets refunded twice
    // while the first refund is still possibly in flight.
    expect(duringTimeout.refundPendingCents).toBe(amountCents)

    const task = await prisma.reconciliationTask.findFirst({
      where: { refundId: refund.id, kind: 'REFUND_UNKNOWN' },
    })

    expect(task).not.toBeNull()

    // The webhook arrives: it did go through after all.
    const settled = await prisma.$transaction(async (tx) =>
      settleRefund(tx, {
        refund: timedOut,
        order: await readOrder(world.order.id),
        result: {
          outcome: REFUND_OUTCOMES.SUCCEEDED,
          providerRefundId: `${intent.id}-re`,
          failureCode: null,
          rawStatus: 'SUCCEEDED',
        },
        organizationId: world.organization.id,
        eventStartsAt: world.event.startsAt,
        actorId: null,
        now: new Date(),
      }),
    )

    expect(settled.settled).toBe(true)

    const after = await readOrder(world.order.id)

    expect(after.refundedCents).toBe(amountCents)
    expect(after.refundPendingCents).toBe(0)
  })
})

when()('a refund settling against a chargeback', () => {
  it('does not give the same money back twice', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const amountCents = world.order.totalCents

    const { refund } = await ask(world, { amountCents, key: `${RUN}-dispute` })

    await pushThrough(world, refund)

    const settledRefund = await prisma.refund.findUnique({ where: { id: refund.id } })

    expect(settledRefund.status).toBe(REFUND_STATES.SUCCEEDED)

    // The dispute lands afterwards, as they do. It is recorded, and it does
    // not move the order's refunded total again: the money already went back,
    // and a chargeback on top of a refund is a reconciliation question rather
    // than a second payment out.
    await prisma.dispute.create({
      data: {
        id: id('dispute'),
        paymentId: world.payment.id,
        provider: 'in-memory-payments',
        providerDisputeId: `dp_${RUN}`,
        amountCents,
        currency: 'INR',
        status: 'OPENED',
        reason: 'duplicate',
      },
    })

    const after = await readOrder(world.order.id)

    expect(after.refundedCents).toBe(amountCents)
    expect(after.refundedCents + after.refundPendingCents).toBeLessThanOrEqual(after.totalCents)

    // And a second refund cannot be asked for: there is nothing left.
    await expect(ask(world, { amountCents: 1, key: `${RUN}-dispute-again` })).rejects.toThrow(
      /already been refunded in full/i,
    )
  })
})

when()('a refund racing a ticket transfer', () => {
  it('leaves the ticket in exactly one of the two states', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const line = world.order.items[0]
    const ticket = await prisma.ticket.findFirst({ where: { orderItemId: line.id } })

    const { refund } = await ask(world, {
      lines: [{ orderItemId: line.id, quantity: line.quantity }],
      key: `${RUN}-transfer`,
    })

    const [transfer, settlement] = await Promise.allSettled([
      prisma.ticket.updateMany({
        where: { id: ticket.id, status: 'VALID' },
        data: { status: 'TRANSFER_PENDING' },
      }),
      pushThrough(world, refund),
    ])

    expect(settlement.status).toBe('fulfilled')

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // Both orders of arrival end the same way: revocation covers a
    // TRANSFER_PENDING ticket as well as a VALID one, so a transfer begun
    // moments before a refund does not save the ticket from being revoked.
    expect(after.status).toBe('REFUNDED')
    expect(transfer.status).toBe('fulfilled')
  })
})

when()('a refund racing a check-in', () => {
  it('never turns an admitted ticket into a refunded one', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const line = world.order.items[0]
    const ticket = await prisma.ticket.findFirst({ where: { orderItemId: line.id } })

    // Through the door first.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date() },
    })

    const { refund } = await ask(world, {
      lines: [{ orderItemId: line.id, quantity: line.quantity }],
      key: `${RUN}-checkin`,
    })

    await pushThrough(world, refund)

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // The revocation is conditional on the status it read. A ticket that went
    // through the door has been used, and quietly marking it refunded would
    // contradict the person who scanned it.
    expect(after.status).toBe('CHECKED_IN')

    // The money still went back — refunding somebody who attended is a
    // decision an organiser is allowed to make — and the audit says how many
    // tickets were actually revoked, which is not the number asked for.
    const settled = await prisma.refund.findUnique({ where: { id: refund.id } })

    expect(settled.status).toBe(REFUND_STATES.SUCCEEDED)

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: refund.id, action: 'refund.settled' },
    })

    expect(audit.metadata.ticketsRevoked).toBeLessThan(line.quantity)
  })

  it('refuses a check-in on a ticket the refund already revoked', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const line = world.order.items[0]
    const ticket = await prisma.ticket.findFirst({ where: { orderItemId: line.id } })

    const { refund } = await ask(world, {
      lines: [{ orderItemId: line.id, quantity: line.quantity }],
      key: `${RUN}-checkin-after`,
    })

    await pushThrough(world, refund)

    // The door, a moment later. `desi_check_in_ticket_admissible` refuses it in
    // the database rather than trusting the scanner's own read.
    await expect(
      prisma.checkIn.create({
        data: {
          id: id('checkin'),
          ticketId: ticket.id,
          eventId: world.event.id,
          eventSessionId: world.session.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/admissible|refunded|revoked/i)
  })
})

when()('a settlement that fails', () => {
  it('rolls back completely, leaving the refund submittable again', async () => {
    const world = await buildPaidOrder({ seats: 2 })
    const amountCents = world.order.totalCents

    // A provider that refuses this amount outright.
    const refuses = createInMemoryPaymentProvider({
      idPrefix: `pidc${RUN}`,
      refundDeclineAmountCents: amountCents,
    })
    const intent = refuses.createIntent({ amountCents, currency: 'INR' })

    refuses.capture(intent.id)

    const { refund } = await ask(world, { amountCents, key: `${RUN}-declined` })
    const pushed = await pushThrough(
      { ...world, payment: { ...world.payment, providerRef: intent.id } },
      refund,
      { provider: refuses },
    )

    expect(pushed.outcome).toBe(REFUND_OUTCOMES.DECLINED)

    const declined = await prisma.refund.findUnique({ where: { id: refund.id } })
    const after = await readOrder(world.order.id)

    expect(declined.status).toBe(REFUND_STATES.DECLINED)
    // The reservation is released, because nothing moved. That is exactly the
    // difference between a refusal and a timeout.
    expect(after.refundPendingCents).toBe(0)
    expect(after.refundedCents).toBe(0)

    // No ticket was revoked and no ledger batch was posted: a failure posts no
    // successful refund ledger event.
    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: { in: world.order.items.map((item) => item.id) } },
    })

    expect(tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)
    expect(await prisma.ledgerBatch.count({ where: { refundId: refund.id } })).toBe(0)

    // And the order can be refunded again, because it never was.
    const retry = await ask(world, { amountCents, key: `${RUN}-declined-retry` })

    expect(retry.created).toBe(true)
  })
})
