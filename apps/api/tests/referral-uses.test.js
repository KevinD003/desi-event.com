/**
 * Giving a referral code's use back when its order ends without being used
 * (SPEC3-XI XR1-XR6, §14.1), against the stub: `settleReferralUsesIfEnded`
 * sets each ended order's marker once, then lowers each code once, codes last
 * and in ascending id order, never below zero; `orderEndedWithoutUse` is XR2's
 * predicate, one case per clause; `returnReferralUseOnce` is the marker alone.
 *
 * The same statements run against PostgreSQL in
 * `payment-terms-foundation-integration.test.js` and
 * `referral-returns-integration.test.js`.
 */

import { describe, expect, it, vi } from 'vitest'

import { REFERRAL_RETURN_CAUSES } from '@desi-event/schemas'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import {
  orderEndedWithoutUse,
  returnReferralUseOnce,
  settleReferralUsesIfEnded,
} from '../src/lib/referral-uses.js'
import { generatedReferralText } from './helpers/fee-orders.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

/** Two codes, in ascending id order. */
const C1 = 'rc-a'
const C2 = 'rc-b'

/**
 * A stub with an event, two referral codes and the given orders, lines,
 * tickets and admissions.
 *
 * @param {object} [seed] Rows to add.
 * @returns {object} The stub.
 */
function world(seed = {}) {
  return createPrismaStub({
    event: [
      { id: 'ev-live', status: 'ON_SALE' },
      { id: 'ev-cancelled', status: 'CANCELLED' },
      { id: 'ev-deleted', status: 'DELETED' },
    ],
    referralCode: [
      { id: C1, code: generatedReferralText(), scope: 'ALL_EVENTS', useCount: 5, maxUses: null },
      { id: C2, code: generatedReferralText(), scope: 'ALL_EVENTS', useCount: 5, maxUses: null },
    ],
    ...seed,
  })
}

/**
 * An order row naming a code.
 *
 * @param {string} id Its id.
 * @param {object} [columns] Other columns.
 * @returns {object} The row.
 */
function order(id, columns = {}) {
  return {
    id,
    eventId: 'ev-live',
    reference: `R-${id}`,
    status: 'CANCELLED',
    paymentMethod: 'AT_VENUE',
    totalCents: 0,
    refundedCents: 0,
    refundPendingCents: 0,
    venueFeeKeptCents: 0,
    referralCodeId: C1,
    ...columns,
  }
}

/**
 * Run a batch in a stub transaction.
 *
 * @param {object} prisma The stub.
 * @param {object} params `settleReferralUsesIfEnded`'s parameters.
 * @returns {Promise<object[]>} What it gave back.
 */
function settle(prisma, params) {
  return prisma.$transaction((tx) => settleReferralUsesIfEnded(tx, params))
}

/**
 * A code's use count, as stored.
 *
 * @param {object} prisma The stub.
 * @param {string} id The code.
 * @returns {number} Its count.
 */
function uses(prisma, id) {
  return prisma._store.referralCode.find((row) => row.id === id).useCount
}

describe('settleReferralUsesIfEnded (XR3)', () => {
  it('gives one ended order’s use back once: marker, one decrement, one audit row with ids only', async () => {
    const prisma = world({ order: [order('o-1')] })
    const now = new Date('2026-10-09T12:00:00.000Z')

    expect(
      await settle(prisma, {
        entries: [{ orderId: 'o-1', cause: 'UNPAID_ORDER_CANCELLED' }],
        actorId: 'admin-1',
        requestId: 'req-1',
        now,
      }),
    ).toEqual([{ orderId: 'o-1', referralCodeId: C1, cause: 'UNPAID_ORDER_CANCELLED' }])

    expect(prisma._store.order[0]).toMatchObject({
      referralUseReturnedAt: now,
      referralUseReturnCause: 'UNPAID_ORDER_CANCELLED',
    })
    expect(uses(prisma, C1)).toBe(4)
    expect(uses(prisma, C2)).toBe(5)

    const audits = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.REFERRAL_USE_RETURNED,
    )

    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: 'referral_code.use_returned',
      entityType: 'ReferralCode',
      entityId: C1,
      actorId: 'admin-1',
      metadata: {
        referralCodeId: C1,
        orderId: 'o-1',
        cause: 'UNPAID_ORDER_CANCELLED',
        requestId: 'req-1',
      },
    })
    expect(Object.keys(audits[0].metadata).sort()).toEqual([
      'cause',
      'orderId',
      'referralCodeId',
      'requestId',
    ])

    const codeText = prisma._store.referralCode[0].code

    expect(JSON.stringify(audits)).not.toContain(codeText)
  })

  it('writes nothing the second time: the marker is the exactly-once decision', async () => {
    const prisma = world({ order: [order('o-1')] })

    await settle(prisma, { entries: [{ orderId: 'o-1', cause: 'REFUNDED' }] })

    const statements = prisma._rawStatements.length
    const audits = prisma._store.auditLog.length
    const marked = prisma._store.order[0].referralUseReturnedAt

    expect(
      await settle(prisma, { entries: [{ orderId: 'o-1', cause: 'TICKETS_REVOKED' }] }),
    ).toEqual([])
    expect(uses(prisma, C1)).toBe(4)
    expect(prisma._rawStatements).toHaveLength(statements)
    expect(prisma._store.auditLog).toHaveLength(audits)
    expect(prisma._store.order[0]).toMatchObject({
      referralUseReturnedAt: marked,
      referralUseReturnCause: 'REFUNDED',
    })
  })

  it('de-duplicates entries by order: the first entry’s cause wins', async () => {
    const prisma = world({ order: [order('o-1')] })

    expect(
      await settle(prisma, {
        entries: [
          { orderId: 'o-1', cause: 'UNPAID_ORDER_CANCELLED' },
          { orderId: 'o-1', cause: 'EVENT_DELETED' },
        ],
      }),
    ).toEqual([{ orderId: 'o-1', referralCodeId: C1, cause: 'UNPAID_ORDER_CANCELLED' }])
    expect(uses(prisma, C1)).toBe(4)
  })

  it('skips an order that names no code without locking anything', async () => {
    const prisma = world({ order: [order('o-1', { referralCodeId: null })] })

    expect(await settle(prisma, { entries: [{ orderId: 'o-1', cause: 'REFUNDED' }] })).toEqual([])
    expect(prisma.lockLog).toEqual([])
    expect(prisma._store.order[0].referralUseReturnedAt).toBeNull()
    expect(await settle(prisma, { entries: [] })).toEqual([])
  })

  it('leaves an order that has not ended alone', async () => {
    const prisma = world({ order: [order('o-1', { status: 'PAID', totalCents: 335 })] })

    expect(await settle(prisma, { entries: [{ orderId: 'o-1', cause: 'REFUNDED' }] })).toEqual([])
    expect(uses(prisma, C1)).toBe(5)
    expect(prisma._store.order[0].referralUseReturnedAt).toBeNull()
    expect(prisma.lockLog.filter((entry) => entry.table === 'ReferralCode')).toEqual([])
  })

  it('takes the codes last, in ascending id order, each lowered once by its uses (XR6)', async () => {
    const prisma = world({
      order: [
        order('o-1', { referralCodeId: C2 }),
        order('o-2', { referralCodeId: C1 }),
        order('o-3', { referralCodeId: C2 }),
      ],
      orderItem: [{ id: 'l-1', orderId: 'o-1', quantity: 1 }],
      ticket: [{ id: 't-1', orderItemId: 'l-1', status: 'VALID' }],
    })

    const given = await prisma.$transaction(async (tx) => {
      // A caller's own writes first, as every returner makes them: the order
      // locked, its ticket withdrawn, the order cancelled.
      for (const id of ['o-1', 'o-2', 'o-3']) {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
      }
      await tx.ticket.update({ where: { id: 't-1' }, data: { status: 'REVOKED' } })
      await tx.order.update({ where: { id: 'o-1' }, data: { status: 'CANCELLED' } })

      return settleReferralUsesIfEnded(tx, {
        entries: [
          { orderId: 'o-3', cause: 'EVENT_CANCELLED' },
          { orderId: 'o-1', cause: 'EVENT_CANCELLED' },
          { orderId: 'o-2', cause: 'EVENT_CANCELLED' },
        ],
      })
    })

    expect(given.map((use) => [use.orderId, use.referralCodeId])).toEqual([
      ['o-1', C2],
      ['o-2', C1],
      ['o-3', C2],
    ])
    expect(uses(prisma, C1)).toBe(4)
    expect(uses(prisma, C2)).toBe(3)

    const log = prisma.lockLog
    const codeEntries = log
      .map((entry, index) => ({ ...entry, index }))
      .filter((entry) => entry.table === 'ReferralCode')
    const lastRowWrite = Math.max(
      ...log
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => ['Order', 'OrderItem', 'Ticket', 'EventSeat'].includes(entry.table))
        .map((entry) => entry.index),
    )

    // Every code lock after the transaction's last order, line, ticket or
    // seat lock or write, C1 before C2, each locked then lowered once.
    expect(codeEntries.every((entry) => entry.index > lastRowWrite)).toBe(true)
    expect(codeEntries.map((entry) => [entry.id, entry.kind])).toEqual([
      [C1, 'lock'],
      [C1, 'write'],
      [C2, 'lock'],
      [C2, 'write'],
    ])
    // NO KEY UPDATE, never UPDATE: an order written twice holds its code FOR
    // KEY SHARE through the foreign-key check, and a FOR UPDATE here would
    // wait on another returner's key share while it waited on this one's (the
    // final door review's 40P01; R14–R17 race it on PostgreSQL).
    expect(codeEntries.filter((entry) => entry.kind === 'lock').map((entry) => entry.mode)).toEqual(
      ['NO KEY UPDATE', 'NO KEY UPDATE'],
    )
    expect(new Set(log.map((entry) => entry.transaction)).size).toBe(1)
    expect(log[0].transaction).not.toBeNull()

    // The re-locks of step 2 are ascending, and every order the batch marked
    // was already held by the caller.
    const relocks = log.filter((entry) => entry.table === 'Order' && entry.kind === 'lock')

    expect(relocks.map((entry) => entry.id)).toEqual(['o-1', 'o-2', 'o-3', 'o-1', 'o-2', 'o-3'])

    // One statement per code, lowering it by its uses: never one per order.
    expect(
      prisma._rawStatements
        .filter((statement) => statement.sql.includes('"useCount" - '))
        .map((statement) => statement.values),
    ).toEqual([
      [1, C1],
      [2, C2],
    ])
  })

  it('never goes below zero: a hand-zeroed count stays 0, the marker is set, a warning names ids only', async () => {
    const prisma = world({ order: [order('o-1'), order('o-2')] })
    const warn = vi.fn()

    prisma._store.referralCode[0].useCount = 1

    const given = await settle(prisma, {
      entries: [
        { orderId: 'o-1', cause: 'REFUNDED' },
        { orderId: 'o-2', cause: 'REFUNDED' },
      ],
      log: { warn },
    })

    expect(given).toHaveLength(2)
    expect(uses(prisma, C1)).toBe(0)
    expect(prisma._store.order.every((row) => row.referralUseReturnCause === 'REFUNDED')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toEqual({ referralCodeId: C1, orderIds: ['o-1', 'o-2'] })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(prisma._store.referralCode[0].code)

    // Already at 0: locked, not lowered, still warned.
    const prismaZero = world({ order: [order('o-3')] })

    prismaZero._store.referralCode[0].useCount = 0

    expect(
      await settle(prismaZero, { entries: [{ orderId: 'o-3', cause: 'REFUNDED' }], log: { warn } }),
    ).toHaveLength(1)
    expect(uses(prismaZero, C1)).toBe(0)
    expect(prismaZero._store.order[0].referralUseReturnedAt).toBeInstanceOf(Date)
    expect(prismaZero._rawStatements.filter((s) => s.sql.includes('"useCount" - '))).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('refuses entries it cannot write: no list, no order id, a cause outside the vocabulary', async () => {
    const prisma = world({ order: [order('o-1')] })

    await expect(settle(prisma, {})).rejects.toThrow(TypeError)
    await expect(settle(prisma, { entries: [{ cause: 'REFUNDED' }] })).rejects.toThrow(TypeError)
    await expect(
      settle(prisma, { entries: [{ orderId: 'o-1', cause: 'PARTLY_REFUNDED' }] }),
    ).rejects.toThrow(TypeError)
    expect(uses(prisma, C1)).toBe(5)
  })

  it('accepts every cause of the vocabulary, NOT_COMPLETED included', async () => {
    expect(REFERRAL_RETURN_CAUSES).toContain('NOT_COMPLETED')

    for (const cause of REFERRAL_RETURN_CAUSES) {
      const prisma = world({ order: [order('o-1')] })

      expect(await settle(prisma, { entries: [{ orderId: 'o-1', cause }] }), cause).toEqual([
        { orderId: 'o-1', referralCodeId: C1, cause },
      ])
    }
  })
})

describe('orderEndedWithoutUse (XR2)', () => {
  /**
   * Whether one order, with its lines, tickets and admissions, ended.
   *
   * @param {object} columns The order's columns.
   * @param {object} [options] Its tickets and admissions, and its event.
   * @param {object[]} [options.tickets] Ticket columns.
   * @param {number[]} [options.admitted] Positions of tickets with an admission.
   * @returns {Promise<boolean>} True when it ended.
   */
  async function ended(columns, { tickets = [], admitted = [] } = {}) {
    const prisma = world({
      order: [order('o-1', columns)],
      orderItem: [{ id: 'l-1', orderId: 'o-1', quantity: tickets.length }],
      ticket: tickets.map((ticket, index) => ({
        id: `t-${index}`,
        orderItemId: 'l-1',
        ...ticket,
      })),
      checkIn: admitted.map((index) => ({ id: `c-${index}`, ticketId: `t-${index}` })),
    })

    return (await orderEndedWithoutUse(prisma, ['o-1'])).includes('o-1')
  }

  const paid = { status: 'PAID', totalCents: 335 }

  it('counts CANCELLED, EXPIRED and REFUNDED orders as ended, and a PENDING one as not', async () => {
    expect(await ended({ status: 'CANCELLED' })).toBe(true)
    expect(await ended({ status: 'EXPIRED' })).toBe(true)
    expect(await ended({ status: 'REFUNDED', refundedCents: 335, totalCents: 335 })).toBe(true)
    expect(await ended({ status: 'PENDING' })).toBe(false)
  })

  it('counts a PAID order with nothing left and nothing standing as ended', async () => {
    expect(
      await ended(
        { ...paid, refundedCents: 335 },
        { tickets: [{ status: 'REFUNDED' }, { status: 'REVOKED' }] },
      ),
    ).toBe(true)
    // A waived booking whose unpaid tickets were all cancelled: nothing was
    // paid online, nothing stands.
    expect(
      await ended(
        { status: 'PAID', totalCents: 0 },
        { tickets: [{ status: 'REVOKED', venueCancellationId: 'vc-1' }] },
      ),
    ).toBe(true)
    // Its kept fee is all that is left: the fee kept counts as gone.
    expect(
      await ended({ ...paid, venueFeeKeptCents: 335 }, { tickets: [{ status: 'REVOKED' }] }),
    ).toBe(true)
  })

  it('keeps the use of an order with a ticket ever let in', async () => {
    expect(
      await ended(
        { ...paid, refundedCents: 335 },
        { tickets: [{ status: 'REFUNDED' }], admitted: [0] },
      ),
    ).toBe(false)
    // An every-night pass used on night 1 stays VALID with its admission: the
    // order was used, even once its event is cancelled.
    expect(
      await ended(
        { status: 'PAID', totalCents: 0, eventId: 'ev-cancelled' },
        { tickets: [{ status: 'VALID' }], admitted: [0] },
      ),
    ).toBe(false)
  })

  it('keeps the use while a refund is in flight or money is left', async () => {
    expect(
      await ended(
        { ...paid, refundedCents: 200, refundPendingCents: 135 },
        { tickets: [{ status: 'REFUNDED' }] },
      ),
    ).toBe(false)
    expect(
      await ended({ ...paid, refundedCents: 200 }, { tickets: [{ status: 'REFUNDED' }] }),
    ).toBe(false)
  })

  it('keeps the use while a ticket stands, unless the event is cancelled', async () => {
    for (const status of ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN']) {
      expect(
        await ended({ status: 'PAID', totalCents: 0 }, { tickets: [{ status }] }),
        status,
      ).toBe(false)
    }

    expect(
      await ended(
        { status: 'PAID', totalCents: 0, eventId: 'ev-cancelled' },
        { tickets: [{ status: 'VALID' }] },
      ),
    ).toBe(true)
  })

  it('keeps the use of a deleted event’s order whose tickets stay as they are (REMOVE_AFTER_EVENT)', async () => {
    expect(
      await ended(
        { status: 'PAID', totalCents: 0, eventId: 'ev-deleted' },
        { tickets: [{ status: 'VALID' }] },
      ),
    ).toBe(false)
  })

  it('answers several orders in one statement, ascending, and nothing for none', async () => {
    const prisma = world({
      order: [order('o-2'), order('o-1'), order('o-3', { status: 'PENDING' })],
    })

    expect(await orderEndedWithoutUse(prisma, ['o-3', 'o-2', 'o-1', 'o-2'])).toEqual(['o-1', 'o-2'])
    expect(prisma._rawQueries).toHaveLength(1)
    expect(prisma._rawQueries[0].sql).toContain('referral-order-ended')
    expect(await orderEndedWithoutUse(prisma, [])).toEqual([])
    expect(prisma._rawQueries).toHaveLength(1)
    await expect(orderEndedWithoutUse(prisma, 'o-1')).rejects.toThrow(TypeError)
  })
})

describe('returnReferralUseOnce (XR3 step 4)', () => {
  it('sets the marker once and never lowers a count', async () => {
    const prisma = world({ order: [order('o-1'), order('o-2', { referralCodeId: null })] })
    const now = new Date('2026-10-09T13:00:00.000Z')

    expect(
      await returnReferralUseOnce(prisma, { orderId: 'o-1', cause: 'TICKETS_REVOKED', now }),
    ).toEqual({ returned: true, referralCodeId: C1 })
    expect(
      await returnReferralUseOnce(prisma, { orderId: 'o-1', cause: 'REFUNDED', now: new Date() }),
    ).toEqual({ returned: false, referralCodeId: null })
    expect(prisma._store.order[0]).toMatchObject({
      referralUseReturnedAt: now,
      referralUseReturnCause: 'TICKETS_REVOKED',
    })
    // An order with no code has no use to give back.
    expect(await returnReferralUseOnce(prisma, { orderId: 'o-2', cause: 'REFUNDED' })).toEqual({
      returned: false,
      referralCodeId: null,
    })
    expect(uses(prisma, C1)).toBe(5)
    expect(prisma._rawStatements).toEqual([])
  })

  it('refuses a missing order, an unknown cause and a moment that is not one', async () => {
    const prisma = world({ order: [order('o-1')] })

    await expect(returnReferralUseOnce(prisma, { cause: 'REFUNDED' })).rejects.toThrow(TypeError)
    await expect(returnReferralUseOnce(prisma, { orderId: 'o-1', cause: 'X' })).rejects.toThrow(
      TypeError,
    )
    await expect(
      returnReferralUseOnce(prisma, { orderId: 'o-1', cause: 'REFUNDED', now: new Date('nope') }),
    ).rejects.toThrow(TypeError)
    expect(prisma._store.order[0].referralUseReturnedAt).toBeNull()
  })
})
