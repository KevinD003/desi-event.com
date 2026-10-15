import { describe, it, expect } from 'vitest'

import { createExpireHoldsProcessor } from './expire-holds.js'
import {
  buildHold,
  createFakeLogger,
  createFakePrisma,
  TICKET_TYPE_ID,
} from '../../tests/helpers/fakes.js'

const NOW = new Date('2026-03-01T12:00:00.000Z')

/**
 * @param {object} [data] The job payload.
 * @returns {object} A minimal BullMQ job.
 */
const job = (data = {}) => ({ name: 'expire-holds', id: '1', data })

describe('createExpireHoldsProcessor', () => {
  it('expires lapsed holds and leaves the ones still within their window alone', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'lapsed', expiresAt: new Date('2026-03-01T11:59:00.000Z'), quantity: 3 }),
        buildHold({ id: 'fresh', expiresAt: new Date('2026-03-01T12:05:00.000Z'), quantity: 4 }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    expect(result.scanned).toBe(2)
    expect(result.expired).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.releasedQuantity).toBe(3)

    const byId = Object.fromEntries(prisma.rows.holds.map((hold) => [hold.id, hold.status]))
    expect(byId).toEqual({ lapsed: 'EXPIRED', fresh: 'ACTIVE' })
  })

  it('does nothing at all when no hold has lapsed yet', async () => {
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'fresh', expiresAt: new Date('2026-03-01T12:10:00.000Z') })],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    expect(result).toMatchObject({ scanned: 1, expired: 0, updated: 0, releasedQuantity: 0 })
    expect(result.byTicketType).toEqual([])
    expect(prisma.calls.some((call) => call.method === 'updateMany')).toBe(false)
    expect(prisma.rows.holds[0].status).toBe('ACTIVE')
  })

  it('treats a hold expiring exactly now as expired, matching activeHeldQuantity', async () => {
    const prisma = createFakePrisma({ holds: [buildHold({ id: 'boundary', expiresAt: NOW })] })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    expect(result.expired).toBe(1)
    expect(prisma.rows.holds[0].status).toBe('EXPIRED')
  })

  it('never sweeps a hold that is not ACTIVE, whatever its timestamp says', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'converted', status: 'CONVERTED', expiresAt: new Date('2020-01-01') }),
        buildHold({ id: 'released', status: 'RELEASED', expiresAt: new Date('2020-01-01') }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    // The query itself filters on ACTIVE, so these rows never even arrive.
    expect(result.scanned).toBe(0)
    expect(result.expired).toBe(0)
    expect(prisma.rows.holds.map((hold) => hold.status)).toEqual(['CONVERTED', 'RELEASED'])
  })

  it('guards the write with status ACTIVE so a concurrent release is not overwritten', async () => {
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'lapsed', expiresAt: new Date('2026-02-01T00:00:00.000Z') })],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    await process(job())

    const update = prisma.calls.find((call) => call.method === 'updateMany')
    expect(update.args.where.status).toBe('ACTIVE')
    expect(update.args.where.id).toEqual({ in: ['lapsed'] })
    expect(update.args.data).toEqual({ status: 'EXPIRED' })
  })

  it('reports a lower `updated` count than `expired` when another process won the race', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'a', expiresAt: new Date('2026-02-01T00:00:00.000Z') }),
        buildHold({ id: 'b', expiresAt: new Date('2026-02-01T00:00:00.000Z') }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })

    // Simulate the API releasing hold `b` between the read and the write.
    const realFindMany = prisma.ticketHold.findMany
    prisma.ticketHold.findMany = async (args) => {
      const found = await realFindMany(args)
      prisma.rows.holds.find((hold) => hold.id === 'b').status = 'RELEASED'
      return found
    }

    const result = await process(job())

    expect(result.expired).toBe(2)
    expect(result.updated).toBe(1)
  })

  it('groups the freed stock by ticket type, largest release first', async () => {
    const stale = new Date('2026-02-01T00:00:00.000Z')
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'a', ticketTypeId: TICKET_TYPE_ID, quantity: 1, expiresAt: stale }),
        buildHold({
          id: 'b',
          ticketTypeId: 'cltypeb000000000000001a',
          quantity: 5,
          expiresAt: stale,
        }),
        buildHold({ id: 'c', ticketTypeId: TICKET_TYPE_ID, quantity: 2, expiresAt: stale }),
      ],
    })

    const result = await createExpireHoldsProcessor({ prisma, clock: () => NOW })(job())

    expect(result.byTicketType).toEqual([
      { ticketTypeId: 'cltypeb000000000000001a', quantity: 5, holds: 1 },
      { ticketTypeId: TICKET_TYPE_ID, quantity: 3, holds: 2 },
    ])
    expect(result.releasedQuantity).toBe(8)
  })

  it('honours batchSize and flags a full batch so the caller knows more remain', async () => {
    const stale = new Date('2026-02-01T00:00:00.000Z')
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'a', expiresAt: stale }),
        buildHold({ id: 'b', expiresAt: stale }),
        buildHold({ id: 'c', expiresAt: stale }),
      ],
    })

    const result = await createExpireHoldsProcessor({ prisma, clock: () => NOW })(
      job({ batchSize: 2 }),
    )

    expect(result.scanned).toBe(2)
    expect(result.expired).toBe(2)
    expect(result.sawFullBatch).toBe(true)
    expect(prisma.rows.holds.find((hold) => hold.id === 'c').status).toBe('ACTIVE')
  })

  it('narrows the sweep to one ticket type when the payload names one', async () => {
    const stale = new Date('2026-02-01T00:00:00.000Z')
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'mine', ticketTypeId: TICKET_TYPE_ID, expiresAt: stale }),
        buildHold({ id: 'other', ticketTypeId: 'cltypeb000000000000001a', expiresAt: stale }),
      ],
    })

    const result = await createExpireHoldsProcessor({ prisma, clock: () => NOW })(
      job({ ticketTypeId: TICKET_TYPE_ID }),
    )

    expect(result.expired).toBe(1)
    expect(prisma.rows.holds.find((hold) => hold.id === 'other').status).toBe('ACTIVE')
  })

  it('evaluates against an explicit `now` from the payload when one is supplied', async () => {
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'lapsed', expiresAt: new Date('2026-03-01T11:00:00.000Z') })],
    })

    // A clock stuck in 2020 would find nothing; the payload's instant must win.
    const process = createExpireHoldsProcessor({
      prisma,
      clock: () => new Date('2020-01-01T00:00:00.000Z'),
    })
    const result = await process(job({ now: '2026-03-01T12:00:00.000Z' }))

    expect(result.now).toBe('2026-03-01T12:00:00.000Z')
    expect(result.expired).toBe(1)
  })

  it('rejects a payload that does not match the schema, without retrying it', async () => {
    const prisma = createFakePrisma({ holds: [] })
    const process = createExpireHoldsProcessor({ prisma })

    await expect(process(job({ batchSize: 0 }))).rejects.toMatchObject({
      name: 'PermanentJobError',
      code: 'INVALID_JOB_PAYLOAD',
    })
    await expect(process(job({ ticketTypeId: 'NOT A CUID' }))).rejects.toMatchObject({
      code: 'INVALID_JOB_PAYLOAD',
    })
    expect(prisma.calls).toHaveLength(0)
  })

  it('logs one summary line per sweep that actually freed stock', async () => {
    const logger = createFakeLogger()
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'lapsed', expiresAt: new Date('2026-02-01T00:00:00.000Z') })],
    })

    await createExpireHoldsProcessor({ prisma, logger, clock: () => NOW })(job())

    expect(logger.at('info')).toHaveLength(1)
    expect(logger.at('info')[0].fields).toMatchObject({
      expired: 1,
      updated: 1,
      releasedQuantity: 2,
    })
  })

  it('refuses to be constructed without a prisma client', () => {
    expect(() => createExpireHoldsProcessor({})).toThrow(TypeError)
  })
})

describe('createExpireHoldsProcessor, for seat holds', () => {
  const lapsedAt = new Date('2026-02-01T00:00:00.000Z')

  /**
   * An `EventSeat` row.
   *
   * @param {string} id The seat.
   * @param {object} [overrides] Fields to set.
   * @returns {object} The row.
   */
  const seat = (id, overrides = {}) => ({ id, status: 'HELD', holdId: null, ...overrides })

  it('puts the seats of the holds it expires back on sale, in one transaction', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'lapsed', expiresAt: lapsedAt, quantity: 2 }),
        buildHold({ id: 'fresh', expiresAt: new Date('2026-03-01T12:05:00.000Z') }),
      ],
      seats: [
        seat('s1', { holdId: 'lapsed' }),
        seat('s2', { holdId: 'lapsed' }),
        seat('s3', { holdId: 'fresh' }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    expect(result.seatsReleased).toBe(2)

    const byId = Object.fromEntries(prisma.rows.seats.map((row) => [row.id, row]))
    expect(byId.s1).toMatchObject({ status: 'AVAILABLE', holdId: null })
    expect(byId.s2).toMatchObject({ status: 'AVAILABLE', holdId: null })
    // A live hold keeps its seat.
    expect(byId.s3).toMatchObject({ status: 'HELD', holdId: 'fresh' })

    // The status flip and the seat release share one transaction.
    const opened = prisma.calls.findIndex((call) => call.method === '$transaction')
    const released = prisma.calls.findIndex((call) => call.model === 'eventSeat')
    expect(opened).toBeGreaterThanOrEqual(0)
    expect(released).toBeGreaterThan(opened)

    const release = prisma.calls[released]
    expect(release.args.where).toEqual({
      holdId: { in: ['lapsed'] },
      status: 'HELD',
      hold: { status: 'EXPIRED' },
    })
    expect(release.args.data).toEqual({ status: 'AVAILABLE', holdId: null })
  })

  it('leaves alone the seats of a hold another writer converted in the meantime', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'sold', expiresAt: lapsedAt }),
        buildHold({ id: 'lapsed', expiresAt: lapsedAt }),
      ],
      seats: [
        // Checkout sold this one: it is no longer HELD.
        seat('paid', { status: 'SOLD', holdId: 'sold' }),
        // And this one it had not sold yet, but the hold is CONVERTED now.
        seat('converting', { holdId: 'sold' }),
        seat('free', { holdId: 'lapsed' }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })

    // A checkout converts hold `sold` between the sweep's read and its write.
    const realFindMany = prisma.ticketHold.findMany
    prisma.ticketHold.findMany = async (args) => {
      const found = await realFindMany(args)
      prisma.rows.holds.find((hold) => hold.id === 'sold').status = 'CONVERTED'
      return found
    }

    const result = await process(job())

    expect(result).toMatchObject({ expired: 2, updated: 1, seatsReleased: 1 })

    const byId = Object.fromEntries(prisma.rows.seats.map((row) => [row.id, row]))
    expect(byId.paid).toMatchObject({ status: 'SOLD', holdId: 'sold' })
    expect(byId.converting).toMatchObject({ status: 'HELD', holdId: 'sold' })
    expect(byId.free).toMatchObject({ status: 'AVAILABLE', holdId: null })
  })

  it('reports the seats it released in its summary line', async () => {
    const logger = createFakeLogger()
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'lapsed', expiresAt: lapsedAt })],
      seats: [seat('s1', { holdId: 'lapsed' })],
    })

    const process = createExpireHoldsProcessor({ prisma, logger, clock: () => NOW })
    await process(job())

    expect(logger.at('info')[0].fields).toMatchObject({ seatsReleased: 1 })
  })

  it('leaves alone a hold whose order is still waiting on its payment, and its seats', async () => {
    const prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'awaiting', orderId: 'order-pending', expiresAt: lapsedAt }),
        buildHold({ id: 'declined', orderId: 'order-cancelled', expiresAt: lapsedAt }),
        buildHold({ id: 'abandoned', expiresAt: lapsedAt }),
      ],
      orders: [
        { id: 'order-pending', status: 'PENDING' },
        { id: 'order-cancelled', status: 'CANCELLED' },
      ],
      seats: [
        seat('paying', { holdId: 'awaiting' }),
        seat('retry', { holdId: 'declined' }),
        seat('left', { holdId: 'abandoned' }),
      ],
    })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    // The PENDING order's hold is not even read: a timed-out capture is
    // reconciliation's to settle, and its seats are the buyer's until then.
    expect(result).toMatchObject({ scanned: 2, expired: 2, updated: 2, seatsReleased: 2 })

    const holds = Object.fromEntries(prisma.rows.holds.map((hold) => [hold.id, hold.status]))
    expect(holds).toEqual({ awaiting: 'ACTIVE', declined: 'EXPIRED', abandoned: 'EXPIRED' })

    const seats = Object.fromEntries(prisma.rows.seats.map((row) => [row.id, row]))
    expect(seats.paying).toMatchObject({ status: 'HELD', holdId: 'awaiting' })
    expect(seats.retry).toMatchObject({ status: 'AVAILABLE', holdId: null })
    expect(seats.left).toMatchObject({ status: 'AVAILABLE', holdId: null })

    // The write carries the same guard, for an order attached after the read.
    const update = prisma.calls.find(
      (call) => call.model === 'ticketHold' && call.method === 'updateMany',
    )
    expect(update.args.where.OR).toEqual([
      { orderId: null },
      { order: { is: { status: { not: 'PENDING' } } } },
    ])
  })

  it('does not expire a hold an order attached between the read and the write', async () => {
    const prisma = createFakePrisma({
      holds: [buildHold({ id: 'caught', expiresAt: lapsedAt })],
      orders: [{ id: 'order-new', status: 'PENDING' }],
      seats: [seat('s1', { holdId: 'caught' })],
    })

    const realFindMany = prisma.ticketHold.findMany
    prisma.ticketHold.findMany = async (args) => {
      const found = await realFindMany(args)
      prisma.rows.holds[0].orderId = 'order-new'
      return found
    }

    const result = await createExpireHoldsProcessor({ prisma, clock: () => NOW })(job())

    expect(result).toMatchObject({ expired: 1, updated: 0, seatsReleased: 0 })
    expect(prisma.rows.holds[0].status).toBe('ACTIVE')
    expect(prisma.rows.seats[0]).toMatchObject({ status: 'HELD', holdId: 'caught' })
  })

  it('reports none for a sweep that expired only general-admission holds', async () => {
    const prisma = createFakePrisma({ holds: [buildHold({ id: 'lapsed', expiresAt: lapsedAt })] })

    const process = createExpireHoldsProcessor({ prisma, clock: () => NOW })
    const result = await process(job())

    expect(result.seatsReleased).toBe(0)
  })
})
