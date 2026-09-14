import { describe, it, expect } from 'vitest'

import { createIssueTicketsProcessor } from './issue-tickets.js'
import { TICKET_CODE_PREFIX } from '../ticket-codes.js'
import { buildOrder, createFakeLogger, createFakePrisma, ORDER_ID } from '../../tests/helpers/fakes.js'

/**
 * @param {object} [data] Payload overrides.
 * @returns {object} A minimal BullMQ job.
 */
const job = (data = {}) => ({ name: 'issue-tickets', id: '1', data: { orderId: ORDER_ID, ...data } })

/**
 * Deterministic code factory, so a test can assert on exact codes.
 *
 * @param {number} count How many codes to produce.
 * @returns {string[]} Sequential fake codes.
 */
const sequentialCodes = (count) =>
  Array.from({ length: count }, (_, index) => `${TICKET_CODE_PREFIX}TEST${index}`)

describe('createIssueTicketsProcessor', () => {
  it('mints one ticket per unit of quantity for a paid order', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 3 })] })
    const process = createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })

    const result = await process(job())

    expect(result).toMatchObject({ orderId: ORDER_ID, issued: 3, existing: 0, total: 3, complete: true })
    expect(prisma.rows.tickets).toHaveLength(3)
    expect(prisma.rows.tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)
    expect(prisma.rows.tickets.every((ticket) => ticket.orderItemId === 'item-1')).toBe(true)
  })

  it('is idempotent: re-running the job mints nothing more', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 2 })] })
    const process = createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })

    const first = await process(job())
    const second = await process(job({ attempt: 2 }))
    const third = await process(job({ attempt: 3 }))

    expect(first.issued).toBe(2)
    expect(second).toMatchObject({ issued: 0, existing: 2, total: 2, complete: true })
    expect(third.issued).toBe(0)
    expect(prisma.rows.tickets).toHaveLength(2)
  })

  it('mints only the shortfall when a previous run partially succeeded', async () => {
    const prisma = createFakePrisma({
      orders: [buildOrder({ quantity: 4 })],
      tickets: [
        { id: 'existing-1', orderItemId: 'item-1', code: 'DET-ALREADY1', status: 'VALID' },
        { id: 'existing-2', orderItemId: 'item-1', code: 'DET-ALREADY2', status: 'VALID' },
      ],
    })

    const result = await createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })(job())

    expect(result).toMatchObject({ issued: 2, existing: 2, total: 4, complete: true })
    expect(prisma.rows.tickets).toHaveLength(4)
  })

  it('spreads the shortfall across several order items', async () => {
    const order = buildOrder()
    order.items = [
      { id: 'item-a', ticketTypeId: 'cltypea000000000000001a', quantity: 2 },
      { id: 'item-b', ticketTypeId: 'cltypeb000000000000001a', quantity: 1 },
    ]

    const prisma = createFakePrisma({ orders: [order] })
    const result = await createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })(job())

    expect(result.issued).toBe(3)
    const perItem = prisma.rows.tickets.reduce((counts, ticket) => {
      counts[ticket.orderItemId] = (counts[ticket.orderItemId] ?? 0) + 1
      return counts
    }, {})
    expect(perItem).toEqual({ 'item-a': 2, 'item-b': 1 })
  })

  it('takes the order row lock before reading any ticket count', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 1 })] })

    await createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })(job())

    const inTransaction = prisma.calls.slice(prisma.calls.findIndex((c) => c.method === '$transaction') + 1)
    expect(inTransaction[0].method).toBe('$queryRaw')
    expect(inTransaction[0].sql).toContain('FOR UPDATE')
    expect(inTransaction[0].values).toEqual([ORDER_ID])
    expect(inTransaction[1]).toMatchObject({ model: 'order', method: 'findUnique' })
  })

  it('never returns the ticket codes themselves — they are bearer tokens', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 2 })] })

    const result = await createIssueTicketsProcessor({ prisma, generateCodes: sequentialCodes })(job())

    expect(JSON.stringify(result)).not.toContain(TICKET_CODE_PREFIX)
  })

  it('generates real, distinct codes when no factory is injected', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 5 })] })

    await createIssueTicketsProcessor({ prisma })(job())

    const codes = prisma.rows.tickets.map((ticket) => ticket.code)
    expect(new Set(codes).size).toBe(5)
    for (const code of codes) expect(code).toMatch(/^DET-[23456789A-HJ-NP-Z]{14}$/)
  })

  it('fails permanently when the order does not exist', async () => {
    const prisma = createFakePrisma({ orders: [] })

    await expect(createIssueTicketsProcessor({ prisma })(job())).rejects.toMatchObject({
      name: 'PermanentJobError',
      code: 'ENTITY_NOT_FOUND',
    })
    expect(prisma.rows.tickets).toHaveLength(0)
  })

  it('retries a PENDING order, because payment may still be recorded', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder({ status: 'PENDING' })] })

    const error = await createIssueTicketsProcessor({ prisma })(job()).catch((thrown) => thrown)

    expect(error.name).toBe('RetryableJobError')
    expect(error.code).toBe('NOT_READY')
    expect(prisma.rows.tickets).toHaveLength(0)
  })

  it.each(['CANCELLED', 'REFUNDED', 'EXPIRED'])(
    'fails permanently for a %s order, which can never become paid',
    async (status) => {
      const prisma = createFakePrisma({ orders: [buildOrder({ status })] })

      await expect(createIssueTicketsProcessor({ prisma })(job())).rejects.toMatchObject({
        name: 'PermanentJobError',
        code: 'INVALID_STATE',
      })
      expect(prisma.rows.tickets).toHaveLength(0)
    },
  )

  it('rejects a payload with no order id', async () => {
    const prisma = createFakePrisma({ orders: [buildOrder()] })

    await expect(
      createIssueTicketsProcessor({ prisma })({ name: 'issue-tickets', data: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_JOB_PAYLOAD' })

    await expect(
      createIssueTicketsProcessor({ prisma })({ name: 'issue-tickets', data: { orderId: 'nope!' } }),
    ).rejects.toMatchObject({ code: 'INVALID_JOB_PAYLOAD' })

    expect(prisma.calls).toHaveLength(0)
  })

  it('reports an order whose items sum to zero as complete without minting anything', async () => {
    const order = buildOrder()
    order.items = []
    const prisma = createFakePrisma({ orders: [order] })

    const result = await createIssueTicketsProcessor({ prisma })(job())

    expect(result).toMatchObject({ issued: 0, expected: 0, total: 0, complete: true })
  })

  it('logs a different line for the first run and a re-run', async () => {
    const logger = createFakeLogger()
    const prisma = createFakePrisma({ orders: [buildOrder({ quantity: 1 })] })
    const process = createIssueTicketsProcessor({ prisma, logger, generateCodes: sequentialCodes })

    await process(job())
    await process(job({ attempt: 2 }))

    const messages = logger.at('info').map((line) => line.message)
    expect(messages).toEqual(['tickets issued', 'tickets already issued; nothing to do'])
  })

  it('refuses to be constructed without a prisma client', () => {
    expect(() => createIssueTicketsProcessor({})).toThrow(TypeError)
  })
})
