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

import { settleCheckout } from '../src/lib/checkout.js'

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
