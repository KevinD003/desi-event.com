/**
 * Settlement takes its tier locks in one order, whatever order its lines come in.
 *
 * `settleCheckout` adds each line's quantity to its tier's `quantitySold`, and
 * that update is a row lock on the tier until the transaction ends. The lines
 * are read without an ORDER BY, so PostgreSQL returns them in whatever order it
 * finds them, which for two orders over the same two tiers is not always the
 * same order. Incrementing each tier as the line loop reached it let one
 * settlement lock Floor then Balcony while another locked Balcony then Floor,
 * and PostgreSQL ended one of them as a deadlock: a captured payment left on an
 * order that never became PAID. `refund-fees-integration.test.js` case 28,
 * which settles ten two-tier orders at a time, failed that way about one run in
 * four.
 *
 * The rule is the one `lockTicketTypes` already keeps: tiers are locked in id
 * order. This file pins it without needing two real transactions to collide,
 * by handing settlement its lines in the reverse of that order.
 *
 * @module @desi-event/api/tests/checkout-settlement-lock-order
 */

import { describe, expect, it, vi } from 'vitest'

import { compensateCheckout, recordUnsettledCapture, settleCheckout } from '../src/lib/checkout.js'

import { pendingZeroTotalOrder, referralCodeFixture } from './helpers/fee-orders.js'
import { makeWorld } from './helpers/fixtures.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/**
 * A stub world with a PENDING two-tier order whose lines were written with the
 * higher tier id first.
 *
 * @returns {Promise<object>} The stub, the order, the two tiers in id order.
 */
async function twoTierOrder() {
  const { seed, ids } = await makeWorld()
  const prisma = createPrismaStub(seed)
  const [low, high] = [ids.generalAdmission, ids.vip].sort((left, right) =>
    left.id < right.id ? -1 : 1,
  )

  const order = await prisma.order.create({
    data: {
      reference: 'DE-LOCKORDER1',
      eventId: ids.publishedEvent.id,
      buyerEmail: 'lock-order@example.test',
      buyerName: 'Lock Order',
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: 0,
      discountCents: 0,
      feesCents: 0,
      taxCents: 0,
      totalCents: 0,
    },
  })

  // Higher id first, so a settlement that follows the lines as stored locks
  // the tiers the wrong way round.
  for (const [tier, quantity] of [
    [high, 1],
    [low, 2],
  ]) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId: tier.id,
        quantity,
        unitPriceCents: 0,
        subtotalCents: 0,
      },
    })
  }

  return { prisma, order, low, high }
}

describe('settling an order with lines on two tiers', () => {
  it('adds to the tiers in id order whatever order the lines come back in', async () => {
    const { prisma, order, low, high } = await twoTierOrder()
    const stored = await prisma.orderItem.findMany({ where: { orderId: order.id } })

    // The precondition this test is about: the lines arrive highest id first.
    expect(stored.map((item) => item.ticketTypeId)).toEqual([high.id, low.id])

    const update = vi.spyOn(prisma.ticketType, 'update')
    let codes = 0

    const result = await prisma.$transaction((tx) =>
      settleCheckout(tx, {
        order,
        payment: null,
        result: { outcome: 'SUCCEEDED', intent: null, rawStatus: 'ZERO_TOTAL' },
        now: new Date(),
        generateTicketCode: () => {
          codes += 1

          return `DET-LOCK${codes}`
        },
        credentialSecret: SECRET,
      }),
    )

    expect(result).toEqual({ settled: true })
    expect(update.mock.calls.map(([args]) => args.where.id)).toEqual([low.id, high.id])

    const tiers = await prisma.ticketType.findMany({ where: { id: { in: [low.id, high.id] } } })
    const sold = Object.fromEntries(tiers.map((tier) => [tier.id, tier.quantitySold]))

    expect(sold).toEqual({ [low.id]: low.quantitySold + 2, [high.id]: high.quantitySold + 1 })
    expect(prisma._store.ticket).toHaveLength(3)
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('adds nothing when somebody else settled the order first', async () => {
    const { prisma, order } = await twoTierOrder()
    const update = vi.spyOn(prisma.ticketType, 'update')
    const settle = () =>
      prisma.$transaction((tx) =>
        settleCheckout(tx, {
          order,
          payment: null,
          result: { outcome: 'SUCCEEDED', intent: null, rawStatus: 'ZERO_TOTAL' },
          now: new Date(),
          generateTicketCode: () => `DET-LOCK${Math.random().toString(36).slice(2, 10)}`,
          credentialSecret: SECRET,
        }),
      )

    expect(await settle()).toEqual({ settled: true })
    expect(await settle()).toEqual({ settled: false })
    expect(update).toHaveBeenCalledTimes(2)
  })
})

/**
 * SPEC3-XI §2.3.3 and XR4, against the stub: settlement takes its tiers before
 * its order, and the three ways a checkout ends an order without it being used
 * each give its referral code's use back, once, with their cause — the code
 * locked after the transaction's last order, line, ticket and seat write.
 */
describe('settlement locks and referral uses (SPEC3-XI)', () => {
  /** What a row write or lock on these tables means for the lock order. */
  const ROW_TABLES = ['Order', 'OrderItem', 'Ticket', 'EventSeat']

  /**
   * A stub world, its published event's night and a referral code.
   *
   * @returns {Promise<object>} The stub and the pieces.
   */
  async function world() {
    const { seed, ids } = await makeWorld()
    const prisma = createPrismaStub(seed)
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    const { row: code } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
    })

    return {
      prisma,
      ids,
      code,
      fees: {
        event: ids.publishedEvent,
        session,
        tiers: { floor: ids.generalAdmission, balcony: ids.vip },
      },
    }
  }

  /**
   * A PENDING booking to pay at the venue whose fee the code waived: a total
   * of 0 and no payment, as checkout's first transaction leaves it.
   *
   * @param {object} built From {@link world}.
   * @param {object} built.prisma The stub.
   * @param {object} built.ids The fixture's ids.
   * @param {object} built.code The referral code row.
   * @param {object} built.fees The event, its night and tiers, as the fee helpers take them.
   * @returns {Promise<object>} The order.
   */
  async function waivedBooking({ prisma, ids, code, fees }) {
    const { order } = await prisma.$transaction((tx) =>
      pendingZeroTotalOrder(tx, {
        world: fees,
        referralCode: code,
        tag: 'settle',
        userId: ids.attendee.id,
        lines: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2, unitPriceCents: 4_000 }],
      }),
    )

    return order
  }

  /**
   * Settle an order as the zero-total path does.
   *
   * @param {object} prisma The stub.
   * @param {object} order The order.
   * @returns {Promise<object>} The result.
   */
  function settleZero(prisma, order) {
    let codes = 0

    return prisma.$transaction((tx) =>
      settleCheckout(tx, {
        order,
        payment: null,
        result: { outcome: 'SUCCEEDED', intent: null, rawStatus: 'ZERO_TOTAL' },
        now: new Date(),
        generateTicketCode: () => {
          codes += 1

          return `DET-XR${order.id.slice(-6)}${codes}`
        },
        credentialSecret: SECRET,
      }),
    )
  }

  /**
   * The lock log of the newest transaction, with positions.
   *
   * @param {object} prisma The stub.
   * @returns {object[]} The entries.
   */
  function lastTransaction(prisma) {
    const log = prisma.lockLog.map((entry, index) => ({ ...entry, index }))
    const newest = log.at(-1).transaction

    return log.filter((entry) => entry.transaction === newest)
  }

  /**
   * Whether the code's locks come after every order, line, ticket and seat
   * write of the transaction.
   *
   * @param {object[]} log One transaction's entries.
   * @returns {boolean} True when the code is the last row lock.
   */
  function codeLockedLast(log) {
    const codes = log.filter((entry) => entry.table === 'ReferralCode')
    const rows = log.filter((entry) => ROW_TABLES.includes(entry.table))

    return codes.length > 0 && codes.every((code) => rows.every((row) => row.index < code.index))
  }

  it('locks its tiers, sorted, before its conditional PENDING→PAID update', async () => {
    const { prisma, order, low, high } = await twoTierOrder()

    await prisma.$transaction((tx) =>
      settleCheckout(tx, {
        order,
        payment: null,
        result: { outcome: 'SUCCEEDED', intent: null, rawStatus: 'ZERO_TOTAL' },
        now: new Date(),
        generateTicketCode: () => `DET-T${Math.random().toString(36).slice(2, 10)}`,
        credentialSecret: SECRET,
      }),
    )

    const log = lastTransaction(prisma)
    const tierLocks = log.filter((entry) => entry.table === 'TicketType' && entry.kind === 'lock')
    const firstOrderWrite = log.find((entry) => entry.table === 'Order' && entry.kind === 'write')

    expect(tierLocks.map((entry) => entry.id)).toEqual([low.id, high.id])
    expect(firstOrderWrite).toBeTruthy()
    expect(tierLocks.every((entry) => entry.index < firstOrderWrite.index)).toBe(true)
  })

  /**
   * Whether a transaction took its tiers (sorted, `FOR UPDATE`), then the
   * order's night (`FOR KEY SHARE`), before its first write to the order.
   *
   * @param {object[]} log One transaction's entries.
   * @param {string[]} tierIds The order's tiers, in id order.
   * @param {string} nightId The order's night.
   * @returns {void} Nothing; asserts.
   */
  function expectTiersThenNightBeforeOrder(log, tierIds, nightId) {
    const tierLocks = log.filter((entry) => entry.table === 'TicketType' && entry.kind === 'lock')
    const nightLocks = log.filter(
      (entry) => entry.table === 'EventSession' && entry.kind === 'lock',
    )
    const firstOrderWrite = log.find((entry) => entry.table === 'Order' && entry.kind === 'write')

    expect(tierLocks.map((entry) => [entry.id, entry.mode])).toEqual(
      tierIds.map((id) => [id, 'UPDATE']),
    )
    expect(nightLocks.map((entry) => [entry.id, entry.mode])).toEqual([[nightId, 'KEY SHARE']])
    expect(firstOrderWrite).toBeTruthy()
    expect(tierLocks.every((entry) => entry.index < nightLocks[0].index)).toBe(true)
    expect(nightLocks[0].index).toBeLessThan(firstOrderWrite.index)
  }

  it('a declined card takes its tiers, sorted, then its night, before it cancels the order (SPEC3-XI §2.1)', async () => {
    const built = await world()
    const { prisma, ids, fees } = built
    const order = await waivedBooking(built)

    // A second line on the other tier, written after, so the sort is what
    // puts the tiers in order.
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId: ids.vip.id,
        quantity: 1,
        unitPriceCents: 4_000,
        subtotalCents: 4_000,
      },
    })

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'memory',
        status: 'INITIATED',
        amountCents: 1,
        currency: 'USD',
      },
    })

    expect(
      await prisma.$transaction((tx) =>
        compensateCheckout(tx, { order, payment, failureCode: 'card_declined', now: new Date() }),
      ),
    ).toEqual({ compensated: true })

    expectTiersThenNightBeforeOrder(
      lastTransaction(prisma),
      [ids.generalAdmission.id, ids.vip.id].sort(),
      fees.session.id,
    )
  })

  it('a free booking that could not be completed takes its tiers, sorted, then its night, before it cancels the order (R12’s cycle, SPEC3-XI §2.1)', async () => {
    const built = await world()
    const { prisma, ids, fees } = built
    const order = await waivedBooking(built)

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId: ids.vip.id,
        quantity: 1,
        unitPriceCents: 4_000,
        subtotalCents: 4_000,
      },
    })

    expect(
      await prisma.$transaction((tx) =>
        recordUnsettledCapture(tx, {
          order,
          payment: null,
          result: { outcome: 'SUCCEEDED', rawStatus: 'ZERO_TOTAL' },
          reason: 'SEAT_TAKEN',
          now: new Date(),
        }),
      ),
    ).toEqual({ recorded: true })

    expectTiersThenNightBeforeOrder(
      lastTransaction(prisma),
      [ids.generalAdmission.id, ids.vip.id].sort(),
      fees.session.id,
    )
  })

  it('gives a waived booking’s use back when its event was cancelled before it settled', async () => {
    const built = await world()
    const { prisma, ids, code } = built
    const order = await waivedBooking(built)

    expect(prisma._store.referralCode[0].useCount).toBe(1)

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'CANCELLED'

    expect(await settleZero(prisma, order)).toEqual({ settled: true })

    const settled = prisma._store.order.find((row) => row.id === order.id)

    expect(settled).toMatchObject({ status: 'PAID', referralUseReturnCause: 'EVENT_CANCELLED' })
    expect(settled.referralUseReturnedAt).toBeInstanceOf(Date)
    expect(prisma._store.referralCode[0].useCount).toBe(0)
    expect(
      prisma._store.auditLog
        .filter((row) => row.action === 'referral_code.use_returned')
        .map((row) => row.metadata),
    ).toEqual([
      expect.objectContaining({
        referralCodeId: code.id,
        orderId: order.id,
        cause: 'EVENT_CANCELLED',
      }),
    ])
    expect(codeLockedLast(lastTransaction(prisma))).toBe(true)

    // Settled again by a second worker: nothing more.
    expect(await settleZero(prisma, order)).toEqual({ settled: false })
    expect(prisma._store.referralCode[0].useCount).toBe(0)
  })

  it('keeps the use of a booking that settles on a live event', async () => {
    const built = await world()
    const { prisma } = built
    const order = await waivedBooking(built)

    await settleZero(prisma, order)

    expect(prisma._store.order.find((row) => row.id === order.id)).toMatchObject({
      status: 'PAID',
      referralUseReturnedAt: null,
      referralUseReturnCause: null,
    })
    expect(prisma._store.referralCode[0].useCount).toBe(1)
  })

  it('keeps the use of a card order settling on a cancelled event: it has money to refund', async () => {
    const built = await world()
    const { prisma, ids, code } = built
    const order = await prisma.order.create({
      data: {
        reference: 'DE-XRCARD01',
        eventId: ids.publishedEvent.id,
        userId: ids.attendee.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents: 4_000,
        discountCents: 0,
        feesCents: 0,
        taxCents: 0,
        totalCents: 4_000,
        feeGrossCents: 335,
        feeWaivedCents: 335,
        referralCodeId: code.id,
      },
    })

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId: ids.generalAdmission.id,
        quantity: 1,
        unitPriceCents: 4_000,
        subtotalCents: 4_000,
      },
    })
    prisma._store.referralCode[0].useCount = 1
    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'CANCELLED'

    await settleZero(prisma, order)

    expect(prisma._store.order.find((row) => row.id === order.id).referralUseReturnedAt).toBeNull()
    expect(prisma._store.referralCode[0].useCount).toBe(1)
  })

  it('gives the use back when the card is declined (PAYMENT_FAILED), once', async () => {
    const built = await world()
    const { prisma, code } = built
    const order = await waivedBooking(built)
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'memory',
        status: 'INITIATED',
        amountCents: 1,
        currency: 'USD',
      },
    })
    const compensate = () =>
      prisma.$transaction((tx) =>
        compensateCheckout(tx, { order, payment, failureCode: 'card_declined', now: new Date() }),
      )

    expect(await compensate()).toEqual({ compensated: true })
    expect(prisma._store.order.find((row) => row.id === order.id)).toMatchObject({
      status: 'CANCELLED',
      referralUseReturnCause: 'PAYMENT_FAILED',
    })
    expect(prisma._store.referralCode.find((row) => row.id === code.id).useCount).toBe(0)
    expect(codeLockedLast(lastTransaction(prisma))).toBe(true)

    expect(await compensate()).toEqual({ compensated: false })
    expect(prisma._store.referralCode.find((row) => row.id === code.id).useCount).toBe(0)
  })

  it('gives the use back when a free booking could not be completed (NOT_COMPLETED)', async () => {
    const built = await world()
    const { prisma, code } = built
    const order = await waivedBooking(built)

    const recorded = await prisma.$transaction((tx) =>
      recordUnsettledCapture(tx, {
        order,
        payment: null,
        result: { outcome: 'SUCCEEDED', rawStatus: 'ZERO_TOTAL' },
        reason: 'SEAT_TAKEN',
        now: new Date(),
      }),
    )

    expect(recorded).toEqual({ recorded: true })
    expect(prisma._store.order.find((row) => row.id === order.id)).toMatchObject({
      status: 'CANCELLED',
      referralUseReturnCause: 'NOT_COMPLETED',
    })
    expect(prisma._store.referralCode.find((row) => row.id === code.id).useCount).toBe(0)
    expect(codeLockedLast(lastTransaction(prisma))).toBe(true)
  })
})
