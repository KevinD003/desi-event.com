import { describe, expect, it } from 'vitest'

import { createTestApp, holdHeaders } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'

/**
 * Request a hold.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The request body.
 * @returns {Promise<object>} The inject result.
 */
function hold(app, payload) {
  return app.inject({ method: 'POST', url: '/v1/holds', payload })
}

describe('POST /v1/holds', () => {
  it('reserves inventory and returns an expiry derived from the configured TTL', async () => {
    const { app, ids, prisma } = await createTestApp({ env: { TICKET_HOLD_TTL_SECONDS: 300 } })

    const before = Date.now()
    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 2 })

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data).toMatchObject({
      ticketTypeId: ids.generalAdmission.id,
      quantity: 2,
      unitPriceCents: 150_000,
    })

    const expiresAt = Date.parse(data.expiresAt)
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000)
    expect(expiresAt).toBeLessThan(before + 305_000)

    expect(prisma._store.ticketHold).toHaveLength(1)
    expect(prisma._store.ticketHold[0].status).toBe('ACTIVE')

    await app.close()
  })

  it('takes a row lock on the ticket type before reading any counter', async () => {
    const { app, ids, prisma } = await createTestApp()

    await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })

    expect(prisma._rawQueries).toHaveLength(1)
    expect(prisma._rawQueries[0].sql).toContain('FOR UPDATE')
    // The id travels as a bound parameter, never interpolated into the SQL.
    expect(prisma._rawQueries[0].values).toEqual([ids.generalAdmission.id])

    await app.close()
  })

  it('counts live holds against availability', async () => {
    const { app, ids } = await createTestApp()

    // VIP has four seats and a per-order maximum of two.
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)

    const third = await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })
    expect(third.statusCode).toBe(409)
    expect(third.json().error.code).toBe('INSUFFICIENT_INVENTORY')

    await app.close()
  })

  it('ignores a lapsed hold the sweeper has not swept yet', async () => {
    const { app, ids, prisma } = await createTestApp()

    prisma._store.ticketHold.push({
      id: 'clapsedhold0000000000000z',
      ticketTypeId: ids.vip.id,
      orderId: null,
      quantity: 4,
      status: 'ACTIVE',
      expiresAt: minutesFromNow(-1),
      createdAt: minutesFromNow(-30),
      updatedAt: minutesFromNow(-30),
    })

    // All four seats look reserved by status alone; the expiry check frees them.
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)

    await app.close()
  })

  it('subtracts tickets already sold', async () => {
    const { app, ids, prisma } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(409)
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(201)

    await app.close()
  })

  it('enforces the per-order maximum with a 422', async () => {
    const { app, ids } = await createTestApp()

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 5 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('ABOVE_MAXIMUM')

    await app.close()
  })

  it('rejects a tier that is not on sale and an event that is not published', async () => {
    const { app, ids } = await createTestApp()

    const paused = await hold(app, { ticketTypeId: ids.pausedTier.id, quantity: 1 })
    const draft = await hold(app, { ticketTypeId: ids.draftTier.id, quantity: 1 })

    expect(paused.statusCode).toBe(422)
    expect(paused.json().error.message).toMatch(/paused/i)
    expect(draft.statusCode).toBe(422)

    await app.close()
  })

  it.each([
    ['PUBLISHED', 201],
    ['ON_SALE', 201],
    ['SALES_PAUSED', 422],
    ['SOLD_OUT', 422],
    ['CANCELLED', 422],
  ])('takes a hold on an event that is %s: %i', async (status, expected) => {
    // ON_SALE is the state an organiser's "Open sales" moves an event into, and
    // until Phase 4 it was refused here: the check was the literal PUBLISHED,
    // written before the lifecycle existed.
    const { app, prisma, ids } = await createTestApp()

    await prisma.event.update({ where: { id: ids.publishedEvent.id }, data: { status } })

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })

    expect(response.statusCode).toBe(expected)
    if (expected === 422) expect(response.json().error.message).toMatch(/not on sale/i)

    await app.close()
  })

  it('rejects a tier whose sales window has not opened or has closed', async () => {
    const { app, ids, prisma } = await createTestApp()

    /**
     * The stored tier row. Re-read each time, because a rolled-back
     * transaction replaces the row objects in the store.
     *
     * @returns {object} The live `TicketType` row.
     */
    const tier = () => prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)

    Object.assign(tier(), { salesStartAt: minutesFromNow(60), salesEndAt: null })
    expect(
      (await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })).json().error
        .message,
    ).toMatch(/not opened/i)

    Object.assign(tier(), { salesStartAt: minutesFromNow(-120), salesEndAt: minutesFromNow(-60) })
    expect(
      (await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })).json().error
        .message,
    ).toMatch(/closed/i)

    await app.close()
  })

  it('answers 404 for an unknown ticket type', async () => {
    const { app } = await createTestApp()

    const response = await hold(app, { ticketTypeId: 'cnosuchtickettype0000000z', quantity: 1 })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('rejects a malformed quantity before touching the database', async () => {
    const { app, ids, prisma } = await createTestApp()

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 0 })

    expect(response.statusCode).toBe(400)
    expect(prisma._rawQueries).toHaveLength(0)

    await app.close()
  })

  it('cannot be raced into an oversell', async () => {
    const { app, prisma, ids } = await createTestApp()

    // One seat left: two buyers ask for it at the same instant.
    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3

    const [first, second] = await Promise.all([
      hold(app, { ticketTypeId: ids.vip.id, quantity: 1 }),
      hold(app, { ticketTypeId: ids.vip.id, quantity: 1 }),
    ])

    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([201, 409])

    // Exactly one reservation exists, and it is for the one remaining seat.
    expect(prisma._store.ticketHold).toHaveLength(1)
    expect(prisma._store.ticketHold[0].quantity).toBe(1)

    await app.close()
  })

  it('serialises a burst of concurrent holds without overselling', async () => {
    const { app, prisma, ids } = await createTestApp()

    // Ten seats, ten simultaneous requests for two seats each.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 2 }),
      ),
    )

    const granted = attempts.filter((attempt) => attempt.statusCode === 201)
    const refused = attempts.filter((attempt) => attempt.statusCode === 409)

    expect(granted).toHaveLength(5)
    expect(refused).toHaveLength(5)

    const held = prisma._store.ticketHold.reduce((sum, row) => sum + row.quantity, 0)
    expect(held).toBe(10)

    await app.close()
  })
})

describe('DELETE /v1/holds/:id', () => {
  /**
   * Take a hold and return its id.
   *
   * @param {object} app The Fastify instance.
   * @param {string} ticketTypeId The tier to hold against.
   * @returns {Promise<string>} The new hold's id.
   */
  async function take(app, ticketTypeId) {
    const response = await hold(app, { ticketTypeId, quantity: 1 })
    expect(response.statusCode).toBe(201)
    return response.json().data
  }

  /**
   * Release a hold, presenting whatever ownership proof it came with.
   *
   * @param {object} app The Fastify instance.
   * @param {object} taken The `data` object returned when the hold was taken.
   * @returns {Promise<object>} The inject result.
   */
  function release(app, taken) {
    return app.inject({
      method: 'DELETE',
      url: `/v1/holds/${taken.id}`,
      headers: holdHeaders(taken),
    })
  }

  it('returns the inventory to the pool', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3
    const taken = await take(app, ids.vip.id)

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(409)

    const released = await release(app, taken)
    expect(released.statusCode).toBe(200)
    expect(released.json()).toEqual({ ok: true })

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(201)

    await app.close()
  })

  it('is idempotent for a hold that was already released', async () => {
    const { app, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    expect((await release(app, taken)).statusCode).toBe(200)
    expect((await release(app, taken)).statusCode).toBe(200)

    await app.close()
  })

  it('records a lapsed hold as EXPIRED rather than RELEASED', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    prisma._store.ticketHold.find((row) => row.id === taken.id).expiresAt = minutesFromNow(-1)

    await release(app, taken)

    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('EXPIRED')

    await app.close()
  })

  it('refuses to release a hold that has become a paid order', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    prisma._store.ticketHold.find((row) => row.id === taken.id).status = 'CONVERTED'

    const response = await release(app, taken)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('CONFLICT')

    await app.close()
  })

  it('answers 404 for an unknown hold', async () => {
    const { app } = await createTestApp()

    expect(
      (await app.inject({ method: 'DELETE', url: '/v1/holds/cnosuchhold00000000000zz' }))
        .statusCode,
    ).toBe(404)

    await app.close()
  })
})
