/**
 * SPEC3's foundation against real PostgreSQL: the helpers the next stages
 * build their orders with write rows every new CHECK accepts, the filters
 * every count uses are filters PostgreSQL runs, a referral code's use count is
 * held to its limit by the database and the refusal reaches a caller as the
 * right 409, every new constraint and trigger is answered by name rather than
 * as a 500, and the booking-fee writers' row lock does not block an order.
 *
 * SPEC3-XI's addendum: a referral use goes back only when its order ended
 * without being used, once, through `settleReferralUsesIfEnded` (SPEC3's
 * `returnReferralUse` is gone); XR2's predicate is the statement PostgreSQL
 * runs; and the fixtures for passed-on, paid-at-the-door, waived, cancelled
 * and pending bookings write rows every new trigger accepts.
 *
 * Every row carries this run's tag. Real PostgreSQL only.
 */

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { databaseRefusal } from '../src/lib/errors.js'
import { findImbalances } from '../src/lib/finance-reporting.js'
import {
  consumeReferralUse,
  orderEndedWithoutUse,
  settleReferralUsesIfEnded,
} from '../src/lib/referral-uses.js'
import {
  BOOKED_UNPAID_ORDER_WHERE,
  PAID_ORDER_WHERE,
  UNPAID_VENUE_TICKET_WHERE,
  venuePaymentStateOf,
} from '../src/lib/venue-payment-filters.js'
import { connectTestDatabase } from './helpers/database.js'
import {
  FEE_ORDER_CURRENCY,
  atVenueOrder,
  cancelledUnpaidFixture,
  createFeeEvent,
  createFeeOrder,
  pendingZeroTotalOrder,
  referralCodeFixture,
  waivedOrder,
} from './helpers/fee-orders.js'
import { holdRow, untilWaiting } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the SPEC3 foundation suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/** A reason inside every 10-500 character bound. */
const REASON = 'Checked by the SPEC3 foundation suite.'

let sequence = 0
let payments
let buyer
let holder
let administrator

/**
 * A tag unique to this run and call.
 *
 * @param {string} label What the rows are for.
 * @returns {string} The tag.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The error a write refused with.
 *
 * @param {Promise<unknown>} write The write.
 * @returns {Promise<unknown>} The error, or undefined when it succeeded.
 */
async function refusalOf(write) {
  try {
    await write
  } catch (error) {
    return error
  }

  return undefined
}

beforeAll(async () => {
  if (!reachable) return

  payments = createInMemoryProviderRegistry({ payments: { idPrefix: `pifound${RUN}` } }).payments
  buyer = await prisma.user.create({
    data: {
      email: `foundation-buyer-${RUN}@example.test`,
      passwordHash: 'not-a-hash',
      displayName: 'Foundation Buyer',
    },
  })
  holder = await prisma.user.create({
    data: {
      email: `foundation-holder-${RUN}@example.test`,
      passwordHash: 'not-a-hash',
      displayName: 'Foundation Holder',
    },
  })
  administrator = await prisma.user.create({
    data: {
      email: `foundation-admin-${RUN}@example.test`,
      passwordHash: 'not-a-hash',
      displayName: 'Foundation Administrator',
      role: 'ADMIN',
    },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

when()('SPEC3 foundation on PostgreSQL', () => {
  it('writes a pay-at-the-venue order every CHECK accepts, with shares that sum to each line', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('venue') })
    const { order, payment, totals, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('venueorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })

    // 2 × $50 + 1 × $20 at the door; 5.90% of $120 + 3 × 99¢ online, no tax.
    expect(totals).toMatchObject({
      subtotalCents: 12_000,
      feeGrossCents: 708 + 297,
      feesCents: 1_005,
      taxCents: 0,
      totalCents: 1_005,
      venueDueCents: 12_000,
    })
    expect(order).toMatchObject({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      feeGrossCents: 1_005,
      feeWaivedCents: 0,
      feesCents: 1_005,
      totalCents: 1_005,
      venueDueCents: 12_000,
      feePercentageBps: 590,
      feeFlatCentsPerTicket: 99,
    })
    expect(payment).toMatchObject({ status: 'SUCCEEDED', amountCents: 1_005 })
    expect(tickets.map((ticket) => ticket.venueDueCents)).toEqual([5_000, 5_000, 2_000])
    expect(order.items.map((item) => item.venueDueCents).sort()).toEqual([10_000, 2_000].sort())

    // The online part is the fee of The Desi Events alone: no organiser share, balanced.
    const entries = await prisma.ledgerEntry.findMany({
      where: { batch: { orderId: order.id } },
      include: { account: true },
    })

    expect(
      entries.map((entry) => [entry.account.code, entry.direction, entry.amountCents]).sort(),
    ).toEqual(
      [
        ['platform_fee_revenue', 'CREDIT', 1_005],
        ['processor_clearing', 'DEBIT', 1_005],
      ].sort(),
    )
    expect(
      (
        await findImbalances(prisma, {
          organizationId: world.organization.id,
          from: new Date(Date.now() - 60_000),
          to: new Date(Date.now() + 60_000),
        })
      ).imbalances,
    ).toEqual([])
  })

  it('runs the filters on PostgreSQL: booked and unpaid until the door takes every payment', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('filters') })
    const { order, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('filtersorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })
    const inScope = (where) => ({ AND: [where, { eventId: world.event.id }] })
    const read = () =>
      prisma.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { tickets: true } } },
      })

    expect(await prisma.order.count({ where: inScope(BOOKED_UNPAID_ORDER_WHERE) })).toBe(1)
    expect(await prisma.order.count({ where: inScope(PAID_ORDER_WHERE) })).toBe(0)
    expect(venuePaymentStateOf(await read())).toMatchObject({
      dueCents: 12_000,
      unpaidTickets: 3,
      unpaidCents: 12_000,
      state: 'TO_PAY',
    })

    // The door takes all three at once, as `lib/venue-payments.js` will: the
    // payment, each ticket pointed at it, and the admissions, in one
    // transaction whose deferred sum check passes at commit.
    await prisma.$transaction(async (tx) => {
      const recorded = await tx.venuePayment.create({
        data: {
          orderId: order.id,
          eventId: world.event.id,
          eventSessionId: world.session.id,
          organizationId: world.organization.id,
          amountCents: 12_000,
          currency: FEE_ORDER_CURRENCY,
          ticketCount: 3,
          via: 'DOOR_GROUP',
          authority: 'ORGANIZATION_ROLE',
          role: 'OWNER',
        },
      })

      for (const ticket of tickets) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { venuePaymentId: recorded.id },
        })
        await tx.checkIn.create({
          data: { ticketId: ticket.id, eventSessionId: world.session.id, method: 'MANUAL_CODE' },
        })
      }
    })

    expect(await prisma.order.count({ where: inScope(BOOKED_UNPAID_ORDER_WHERE) })).toBe(0)
    expect(await prisma.order.count({ where: inScope(PAID_ORDER_WHERE) })).toBe(1)
    expect(
      await prisma.ticket.count({
        where: { AND: [UNPAID_VENUE_TICKET_WHERE, { orderItem: { orderId: order.id } }] },
      }),
    ).toBe(0)
    expect(venuePaymentStateOf(await read())).toMatchObject({
      paidCents: 12_000,
      paidTickets: 3,
      unpaidTickets: 0,
      state: 'PAID',
    })
  })

  it('keeps a committed door payment equal to its tickets: no ticket joins it, changes its due or leaves it', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('paidsum') })
    const { order, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('paidsumorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })
    const [paid, unpaid] = tickets
    const answer = async (write) => databaseRefusal(await refusalOf(write))?.code

    // The door takes the first ticket's $50 and commits: one ticket, 5000.
    const recorded = await prisma.$transaction(async (tx) => {
      const row = await tx.venuePayment.create({
        data: {
          orderId: order.id,
          eventId: world.event.id,
          eventSessionId: world.session.id,
          organizationId: world.organization.id,
          amountCents: paid.venueDueCents,
          currency: FEE_ORDER_CURRENCY,
          ticketCount: 1,
          via: 'DOOR_TICKET',
          authority: 'ORGANIZATION_ROLE',
          role: 'OWNER',
        },
      })
      await tx.ticket.update({ where: { id: paid.id }, data: { venuePaymentId: row.id } })

      return row
    })

    // Later, each on its own: the second unpaid $50 ticket pointed at that
    // payment would be let in with nothing recorded for it; a paid ticket's due
    // changed, a ticket inserted already pointing at it, or the paid ticket
    // removed, would leave the payment's amount naming other tickets than the
    // ones it paid for. Each is refused as a 409.
    expect(
      await answer(
        prisma.ticket.update({ where: { id: unpaid.id }, data: { venuePaymentId: recorded.id } }),
      ),
    ).toBe('PAYMENT_NOT_RECORDED')
    // SPEC3-XI (open question 7): what is due stays with a ticket, so the
    // guard `desi_ticket_venue_due_guard` refuses these two before the deferred
    // payment sum is reached — a due never changes (`ticket_venue_due_fixed`)
    // and a ticket is never inserted paid (`ticket_venue_insert_unpaid`) —
    // and they answer as the transfer acceptance that could race them: 409
    // CONFLICT, reason TICKET_CHANGED. The deferred sum still refuses both
    // with the guard set aside (probe 16's commit-time cases,
    // `payment-terms-probes.mjs`).
    const dueChanged = await refusalOf(
      prisma.ticket.update({ where: { id: paid.id }, data: { venueDueCents: 1 } }),
    )

    expect(databaseRefusal(dueChanged)).toMatchObject({ statusCode: 409, code: 'CONFLICT' })
    expect(databaseRefusal(dueChanged).details).toEqual({ reason: 'TICKET_CHANGED' })
    expect(
      await answer(
        prisma.ticket.create({
          data: {
            orderItemId: unpaid.orderItemId,
            code: `PS${RUN}${sequence}`.toUpperCase(),
            venueDueCents: unpaid.venueDueCents,
            venuePaymentId: recorded.id,
          },
        }),
      ),
    ).toBe('CONFLICT')
    expect(await answer(prisma.ticket.delete({ where: { id: paid.id } }))).toBe(
      'PAYMENT_NOT_RECORDED',
    )

    // Nothing moved: the payment still names exactly the ticket it paid for.
    expect(
      await prisma.ticket.findMany({
        where: { venuePaymentId: recorded.id },
        select: { id: true, venueDueCents: true },
      }),
    ).toEqual([{ id: paid.id, venueDueCents: paid.venueDueCents }])
    expect((await prisma.ticket.findUnique({ where: { id: unpaid.id } })).venuePaymentId).toBeNull()
    expect(
      await answer(
        prisma.checkIn.create({
          data: { ticketId: unpaid.id, eventSessionId: world.session.id, method: 'MANUAL_CODE' },
        }),
      ),
    ).toBe('PAYMENT_DUE')
  })

  it('counts a referral use against its limit at the database, and gives it back once its order ended', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('referral') })
    const { row } = await referralCodeFixture(prisma, {
      createdById: administrator.id,
      maxUses: 1,
      scope: 'SELECTED_EVENTS',
      eventIds: [world.event.id],
    })
    const { order, payment, totals, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('referralorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      referralCode: row,
    })

    // The whole fee waived: nothing online, no payment, no ledger batch.
    expect(totals).toMatchObject({ feeGrossCents: 1_005, feeWaivedCents: 1_005, totalCents: 0 })
    expect(order).toMatchObject({ referralCodeId: row.id, feesCents: 0, totalCents: 0 })
    expect(payment).toBeNull()
    expect(await prisma.ledgerBatch.count({ where: { orderId: order.id } })).toBe(0)

    const counted = await prisma.referralCode.findUnique({ where: { id: row.id } })

    expect(counted.useCount).toBe(1)
    // The edit precondition does not move when an order takes a use.
    expect(counted.updatedAt.getTime()).toBe(row.updatedAt.getTime())

    const refused = await refusalOf(consumeReferralUse(prisma, { referralCodeId: row.id }))

    expect(databaseRefusal(refused)).toMatchObject({
      statusCode: 409,
      code: 'REFERRAL_NOT_ACCEPTED',
    })

    // SPEC3-XI §14.8: no use goes back while the booking stands.
    const settle = (orderId, cause = 'VENUE_UNPAID_CANCELLED') =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

        return settleReferralUsesIfEnded(tx, { entries: [{ orderId, cause }], requestId: 'r-1' })
      })

    expect(await settle(order.id)).toEqual([])
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(1)

    // Its unpaid tickets all cancelled: nothing was paid online and nothing
    // stands, so the order ended without being used. The first call sets the
    // marker and lowers the count once; the second gives nothing back.
    await prisma.$transaction((tx) => cancelledUnpaidFixture(tx, { order, tickets }))

    expect(await settle(order.id)).toEqual([
      { orderId: order.id, referralCodeId: row.id, cause: 'VENUE_UNPAID_CANCELLED' },
    ])
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      referralUseReturnCause: 'VENUE_UNPAID_CANCELLED',
      referralUseReturnedAt: expect.any(Date),
    })

    const returned = await prisma.referralCode.findUnique({ where: { id: row.id } })

    expect(returned.useCount).toBe(0)
    // Lowered by a raw statement: the edit precondition does not move.
    expect(returned.updatedAt.getTime()).toBe(row.updatedAt.getTime())
    expect(
      await prisma.auditLog.count({
        where: { action: 'referral_code.use_returned', entityId: row.id },
      }),
    ).toBe(1)

    expect(await settle(order.id, 'REFUNDED')).toEqual([])
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(0)
    expect(
      (await prisma.order.findUnique({ where: { id: order.id } })).referralUseReturnCause,
    ).toBe('VENUE_UNPAID_CANCELLED')

    // A count zeroed by hand stays 0; the next ended order's marker is set.
    const pending = await prisma.$transaction((tx) =>
      pendingZeroTotalOrder(tx, { world, referralCode: row, tag: tag('zeroed'), userId: buyer.id }),
    )

    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(1)
    await prisma.$executeRaw`UPDATE "ReferralCode" SET "useCount" = 0 WHERE "id" = ${row.id}`
    await prisma.ticketHold.updateMany({
      where: { orderId: pending.order.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    })
    await prisma.order.update({
      where: { id: pending.order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })

    expect(await settle(pending.order.id, 'NOT_COMPLETED')).toHaveLength(1)
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(0)
    expect(
      (await prisma.order.findUnique({ where: { id: pending.order.id } })).referralUseReturnCause,
    ).toBe('NOT_COMPLETED')

    // An order that names no code gives nothing back.
    const plain = await atVenueOrder(prisma, world, {
      tag: tag('nocode'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })

    expect(await settle(plain.order.id, 'REFUNDED')).toEqual([])

    // Never below zero, whoever writes: CHECK referral_code_shape.
    const below = await refusalOf(
      prisma.$executeRaw`UPDATE "ReferralCode" SET "useCount" = -1 WHERE "id" = ${row.id}`,
    )

    expect(databaseRefusal(below)).toMatchObject({ statusCode: 409, code: 'REFERRAL_CODE_CHANGED' })
    expect(String(below?.message ?? below)).toMatch(/referral_code_shape/u)
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(0)
    await expect(consumeReferralUse(prisma, {})).rejects.toThrow(TypeError)
  })

  it('runs XR2 as one statement on PostgreSQL, one case per clause', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('ended') })
    const booking = (label, options = {}) =>
      atVenueOrder(prisma, world, {
        tag: tag(label),
        payments,
        credentialSecret: SECRET,
        userId: buyer.id,
        ...options,
      })

    // Standing tickets, money left online: not ended.
    const standing = await booking('standing')
    // Every unpaid ticket cancelled: PAID, nothing standing, only the kept fee
    // left: ended.
    const cancelled = await booking('cancelled')

    await prisma.$transaction((tx) =>
      cancelledUnpaidFixture(tx, { order: cancelled.order, tickets: cancelled.tickets }),
    )

    // Waived, its tickets cancelled: nothing paid online, ended.
    const waived = await booking('waived', { waived: true })

    await prisma.$transaction((tx) =>
      cancelledUnpaidFixture(tx, { order: waived.order, tickets: waived.tickets }),
    )

    // Waived, one ticket let in after paying at the door, the rest cancelled:
    // used, so not ended.
    const admitted = await booking('admitted', { waived: true, paidBy: [{ index: 0 }] })

    await prisma.$transaction((tx) =>
      cancelledUnpaidFixture(tx, { order: admitted.order, tickets: admitted.tickets.slice(1) }),
    )

    // Waived and still standing, one ticket passed on: not ended.
    const passedOn = await booking('passedon', { waived: true, holders: [null, holder.id] })
    // A pending waived booking: not ended until it is cancelled.
    const pending = await prisma.$transaction((tx) =>
      pendingZeroTotalOrder(tx, {
        world,
        referralCode: waived.referralCode,
        tag: tag('pending'),
        userId: buyer.id,
      }),
    )
    const ids = [standing, cancelled, waived, admitted, passedOn].map((made) => made.order.id)

    expect(await orderEndedWithoutUse(prisma, [...ids, pending.order.id])).toEqual(
      [cancelled.order.id, waived.order.id].sort(),
    )

    // The event cancelled: an order with no money left whose tickets still
    // stand ends (the passed-on booking); one with money left, or one ever let
    // in, does not.
    await prisma.event.update({ where: { id: world.event.id }, data: { status: 'CANCELLED' } })

    expect(await orderEndedWithoutUse(prisma, [...ids, pending.order.id])).toEqual(
      [cancelled.order.id, waived.order.id, passedOn.order.id].sort(),
    )

    // A cancelled order has ended, whatever else.
    await prisma.order.update({
      where: { id: pending.order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })

    expect(await orderEndedWithoutUse(prisma, [pending.order.id])).toEqual([pending.order.id])
  })

  it('gives several orders’ uses back in one batch on PostgreSQL, each code lowered once', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('batch') })
    const first = await referralCodeFixture(prisma, { createdById: administrator.id })
    const second = await referralCodeFixture(prisma, { createdById: administrator.id })
    const made = []

    for (const code of [first.row, second.row, second.row]) {
      made.push(
        await atVenueOrder(prisma, world, {
          tag: tag('batchorder'),
          payments,
          credentialSecret: SECRET,
          userId: buyer.id,
          referralCode: code,
        }),
      )
    }

    for (const booking of made) {
      await prisma.$transaction((tx) =>
        cancelledUnpaidFixture(tx, { order: booking.order, tickets: booking.tickets }),
      )
    }

    const given = await prisma.$transaction(async (tx) => {
      for (const id of made.map((booking) => booking.order.id).sort()) {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
      }

      return settleReferralUsesIfEnded(tx, {
        entries: made.map((booking) => ({ orderId: booking.order.id, cause: 'EVENT_DELETED' })),
        actorId: administrator.id,
        requestId: 'r-batch',
      })
    })

    expect(given).toHaveLength(3)
    expect(given.map((use) => use.orderId)).toEqual(made.map((b) => b.order.id).sort())

    const counts = await prisma.referralCode.findMany({
      where: { id: { in: [first.row.id, second.row.id] } },
    })

    expect(Object.fromEntries(counts.map((code) => [code.id, code.useCount]))).toEqual({
      [first.row.id]: 0,
      [second.row.id]: 0,
    })
    expect(
      await prisma.auditLog.count({
        where: { action: 'referral_code.use_returned', actorId: administrator.id },
      }),
    ).toBeGreaterThanOrEqual(3)
  })

  it('writes the SPEC3-XI fixtures every trigger accepts: passed on, paid at the door, cancelled', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('fixtures') })
    const soldBefore = await prisma.ticketType.findMany({
      where: { eventId: world.event.id },
      orderBy: { id: 'asc' },
    })
    const { order, tickets, handedOn, venuePayments } = await atVenueOrder(prisma, world, {
      tag: tag('fixturesorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      holders: [null, holder.id],
      paidBy: [{ index: 0, holderId: holder.id }],
    })

    // Both $50 tickets passed on (the first then paid at the door by its
    // holder), the $20 one still the buyer's.
    expect(handedOn.map((entry) => entry.index).sort()).toEqual([0, 1])
    expect(tickets.map((ticket) => ticket.ownerUserId)).toEqual([holder.id, holder.id, buyer.id])
    expect(tickets.map((ticket) => ticket.status)).toEqual(['CHECKED_IN', 'VALID', 'VALID'])
    expect(tickets.map((ticket) => ticket.venueDueCents)).toEqual([5_000, 5_000, 2_000])
    expect(venuePayments).toHaveLength(1)

    const read = () =>
      prisma.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { tickets: true } } },
      })

    expect(venuePaymentStateOf(await read())).toMatchObject({
      paidTickets: 0,
      paidByOthersTickets: 1,
      paidByOthersCents: 5_000,
      passedOnUnpaidTickets: 1,
      passedOnUnpaidCents: 5_000,
      unpaidTickets: 1,
      unpaidCents: 2_000,
      state: 'TO_PAY',
    })

    // The buyer's own unpaid ticket cancelled, exactly as the service writes it.
    const { cancellation } = await prisma.$transaction((tx) =>
      cancelledUnpaidFixture(tx, {
        order,
        tickets: [tickets[2]],
        actor: administrator,
        authority: 'PLATFORM_ROLE',
        role: 'ADMIN',
      }),
    )
    const after = await read()

    // 2000 of 12000 cancelled: 1005 × 2000 / 12000 = 167 of the fee kept.
    expect(cancellation).toMatchObject({
      ticketCount: 1,
      basisCents: 2_000,
      feeKeptCents: 167,
      authority: 'PLATFORM_ROLE',
      cancelledById: administrator.id,
    })
    expect(after).toMatchObject({ venueCancelledBasisCents: 2_000, venueFeeKeptCents: 167 })
    expect(after.items.map((item) => item.venueCancelledQuantity).sort()).toEqual([0, 1])
    expect(venuePaymentStateOf(after)).toMatchObject({
      unpaidTickets: 0,
      cancelledTickets: 1,
      cancelledCents: 2_000,
      feeKeptCents: 167,
      state: 'PAID',
    })

    const soldAfter = await prisma.ticketType.findMany({
      where: { eventId: world.event.id },
      orderBy: { id: 'asc' },
    })

    expect(soldAfter.map((tier) => tier.quantitySold)).toEqual(
      soldBefore.map((tier) => tier.quantitySold + (tier.id === world.tiers.floor.id ? 2 : 0)),
    )
  })

  it('cancels a ticket offered to someone as the service does: the offer withdrawn, the pass dead', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('offered') })
    const { order, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('offeredorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })
    const [offered, kept] = tickets
    const now = new Date()
    const offer = (ticket, label) =>
      prisma.$transaction(async (tx) => {
        await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'TRANSFER_PENDING' } })

        return tx.ticketTransfer.create({
          data: {
            ticketId: ticket.id,
            fromUserId: buyer.id,
            toEmail: `offered-${tag(label)}@example.test`,
            tokenHash: `offer-hash-${tag(label)}`,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        })
      })
    const withdrawn = await offer(offered, 'offerone')
    // An offer on a ticket the cancellation leaves alone stays open.
    const open = await offer(kept, 'offertwo')
    const { cancellation, tickets: after } = await prisma.$transaction((tx) =>
      cancelledUnpaidFixture(tx, { order, tickets: [offered], now }),
    )

    // XU1, SPEC3-XI §2.2 step 6: never a PENDING offer on a REVOKED ticket.
    expect(await prisma.ticketTransfer.findUnique({ where: { id: withdrawn.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: now,
    })
    expect(await prisma.ticketTransfer.findUnique({ where: { id: open.id } })).toMatchObject({
      status: 'PENDING',
      cancelledAt: null,
    })
    expect(
      await prisma.ticketTransfer.count({
        where: {
          ticket: { status: 'REVOKED', orderItem: { orderId: order.id } },
          status: 'PENDING',
        },
      }),
    ).toBe(0)
    expect(after).toEqual([
      expect.objectContaining({
        id: offered.id,
        status: 'REVOKED',
        credentialHash: null,
        credentialVersion: offered.credentialVersion + 1,
        venueCancellationId: cancellation.id,
      }),
    ])
  })

  it('settles a card order whose fee a referral code waived, tax charged on the tickets alone', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('waived') })
    const { row } = await referralCodeFixture(prisma, { createdById: administrator.id })
    const { order, totals } = await waivedOrder(prisma, world, {
      tag: tag('waivedorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      referralCode: row,
    })

    // $60 after the 50% promo; tax 8.25% of $60 only, the fee being waived.
    expect(totals).toMatchObject({
      discountCents: 6_000,
      feeWaivedCents: totals.feeGrossCents,
      feesCents: 0,
      taxCents: 495,
      totalCents: 6_495,
    })
    expect(order).toMatchObject({
      status: 'PAID',
      paymentMethod: 'CARD',
      referralCodeId: row.id,
      feesCents: 0,
      feeWaivedCents: totals.feeGrossCents,
    })
    expect((await prisma.referralCode.findUnique({ where: { id: row.id } })).useCount).toBe(1)
  })

  it('still writes an ordinary card order, its gross fee the fee it charged', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('card') })
    const { order } = await createFeeOrder(prisma, world, {
      tag: tag('cardorder'),
      payments,
      credentialSecret: SECRET,
    })

    expect(order).toMatchObject({
      paymentMethod: 'CARD',
      feeSource: 'SITE_DEFAULT',
      feesCents: 651,
      feeGrossCents: 651,
      feeWaivedCents: 0,
      venueDueCents: 0,
      feePercentageBps: 590,
      feeFlatCentsPerTicket: 99,
    })
  })

  it('answers every new constraint and trigger by name: a 409, never a 500', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('refusals') })
    const { order, tickets } = await atVenueOrder(prisma, world, {
      tag: tag('refusalsorder'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
    })
    const answer = async (write) => databaseRefusal(await refusalOf(write))?.code

    // A CHECK on the event's fee, and one on the switch, whose name contains
    // the door payment's.
    expect(
      await answer(
        prisma.event.update({
          where: { id: world.event.id },
          data: { feeSource: 'EVENT', feeFlatCentsPerTicket: 149, feeCurrency: 'USD' },
        }),
      ),
    ).toBe('PAYMENT_TERMS_CHANGED')
    expect(
      await answer(
        prisma.event.update({
          where: { id: world.event.id },
          data: { venuePaymentEnabled: true, venuePaymentReason: REASON },
        }),
      ),
    ).toBe('PAYMENT_TERMS_CHANGED')

    // The admission trigger, through the adapter's real error.
    expect(
      await answer(
        prisma.checkIn.create({
          data: {
            ticketId: tickets[0].id,
            eventSessionId: world.session.id,
            method: 'MANUAL_CODE',
          },
        }),
      ),
    ).toBe('PAYMENT_DUE')

    // A door payment's own CHECK.
    expect(
      await answer(
        prisma.venuePayment.create({
          data: {
            orderId: order.id,
            eventId: world.event.id,
            organizationId: world.organization.id,
            amountCents: 0,
            currency: FEE_ORDER_CURRENCY,
            ticketCount: 1,
            via: 'DOOR_TICKET',
            authority: 'ORGANIZATION_ROLE',
            role: 'OWNER',
          },
        }),
      ),
    ).toBe('PAYMENT_NOT_RECORDED')

    // A fee decision is never edited.
    const setting = await prisma.eventFeeSetting.create({
      data: {
        eventId: world.event.id,
        sequence: 1,
        source: 'SITE_DEFAULT',
        reason: REASON,
        setById: administrator.id,
      },
    })

    expect(
      await answer(
        prisma.eventFeeSetting.update({
          where: { id: setting.id },
          data: { reason: 'Another reason, written later.' },
        }),
      ),
    ).toBe('PAYMENT_TERMS_CHANGED')
  })

  it('holds the event row FOR NO KEY UPDATE without blocking an order that names it', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('lock') })
    const lock = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR NO KEY UPDATE' })

    try {
      // An order insert takes FOR KEY SHARE on the event through its foreign
      // key, which FOR NO KEY UPDATE does not block: this completes while the
      // row is held.
      const order = await prisma.order.create({
        data: {
          reference: `DE-LOCK${RUN}`.toUpperCase().slice(0, 32),
          eventId: world.event.id,
          buyerEmail: `lock-${RUN}@example.test`,
          buyerName: 'Lock Buyer',
          currency: FEE_ORDER_CURRENCY,
          subtotalCents: 0,
          totalCents: 0,
        },
      })

      expect(order.eventId).toBe(world.event.id)
    } finally {
      lock.release()
      await lock.done
    }
  })

  it('makes a FOR UPDATE on the event row block that same insert, so the mode is what decides', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('lockupdate') })
    const lock = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR UPDATE' })
    // A Prisma query runs only once something waits on it: `then` starts it
    // now, so it is already waiting on the row when the check below looks.
    const insert = prisma.order
      .create({
        data: {
          reference: `DE-LOCKU${RUN}`.toUpperCase().slice(0, 32),
          eventId: world.event.id,
          buyerEmail: `lock-update-${RUN}@example.test`,
          buyerName: 'Lock Buyer',
          currency: FEE_ORDER_CURRENCY,
          subtotalCents: 0,
          totalCents: 0,
        },
      })
      .then((row) => row)

    try {
      await untilWaiting(prisma, () => [lock.pid], 1, 'the order insert to wait on the event row')
    } finally {
      lock.release()
      await lock.done
    }

    expect((await insert).eventId).toBe(world.event.id)
  })
})
