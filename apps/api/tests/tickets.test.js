import { beforeEach, describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'

/**
 * Build a world that already contains one paid order, so a scan has something
 * to scan.
 *
 * @returns {Promise<object>} The harness plus the issued ticket codes.
 */
async function withPaidOrder() {
  const harness = await createTestApp()

  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: harness.ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: harness.ids.generalAdmission.id, quantity: 2 }],
    },
  })

  expect(response.statusCode).toBe(201)

  return { ...harness, tickets: response.json().data.tickets }
}

describe('POST /v1/tickets/check-in', () => {
  /** @type {object} */
  let harness

  beforeEach(async () => {
    harness = await withPaidOrder()
  })

  it('admits a valid ticket for door staff', async () => {
    const { app, tickets } = harness
    const token = await signIn(app, 'door@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data.alreadyCheckedIn).toBe(false)
    expect(data.ticket).toMatchObject({ status: 'CHECKED_IN', code: tickets[0].code })
    expect(data.ticket.checkedInAt).toEqual(expect.any(String))
    // The buyer's order must not ride along to the door scanner.
    expect(data.ticket).not.toHaveProperty('orderItem')

    await app.close()
  })

  it('is idempotent: a re-scan reports the conflict and records no second check-in', async () => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, 'door@rangoli.example')

    const first = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })
    const firstStamp = first.json().data.ticket.checkedInAt

    const second = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })

    expect(second.statusCode).toBe(200)
    expect(second.json().data.alreadyCheckedIn).toBe(true)
    // The original admission time survives: the second scan changed nothing.
    expect(second.json().data.ticket.checkedInAt).toBe(firstStamp)

    const stored = prisma._store.ticket.find((row) => row.code === tickets[0].code)
    expect(stored.checkedInAt.toISOString()).toBe(firstStamp)

    await app.close()
  })

  it('will not let a scanner rewrite an admission, however it asks', async () => {
    const { app, tickets } = harness
    const token = await signIn(app, 'door@rangoli.example')
    const scan = (checkedInAt, extra = {}) =>
      app.inject({
        method: 'POST',
        url: '/v1/tickets/check-in',
        headers: bearer(token),
        payload: { code: tickets[0].code, checkedInAt, ...extra },
      })

    const first = await scan('2026-01-01T10:00:00.000Z')

    expect(first.json().data.checkedInAt).toBe('2026-01-01T10:00:00.000Z')

    // `force` used to re-stamp the time. It is gone: with a CheckIn row that is
    // unique per ticket, the only thing it could mean is "rewrite the admission
    // record", and a record whoever holds the scanner can rewrite is not one.
    // The field is not on the schema, so it is stripped and changes nothing.
    const again = await scan('2026-02-02T20:00:00.000Z', { force: true })

    expect(again.statusCode).toBe(200)
    expect(again.json().data.alreadyCheckedIn).toBe(true)
    expect(again.json().data.checkedInAt).toBe('2026-01-01T10:00:00.000Z')
    expect(again.json().data.ticket.checkedInAt).toBe('2026-01-01T10:00:00.000Z')

    await app.close()
  })

  it('rejects a scanner from another organisation', async () => {
    const { app, tickets } = harness
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')

    await app.close()
  })

  it('rejects an attendee and an anonymous caller', async () => {
    const { app, tickets } = harness
    const token = await signIn(app, 'priya@example.com')

    const attendee = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })
    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      payload: { code: tickets[0].code },
    })

    expect(attendee.statusCode).toBe(403)
    expect(anonymous.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a ticket scanned at the wrong event', async () => {
    const { app, ids, tickets } = harness
    const token = await signIn(app, 'door@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code, eventId: ids.draftEvent.id },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/different event/i)

    await app.close()
  })

  it('refuses a void ticket and a ticket whose order is not paid', async () => {
    const { app, prisma, tickets } = harness
    const token = await signIn(app, 'door@rangoli.example')

    prisma._store.ticket.find((row) => row.code === tickets[0].code).status = 'VOID'
    prisma._store.order[0].status = 'CANCELLED'

    const voided = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[0].code },
    })
    const unpaid = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: tickets[1].code },
    })

    expect(voided.statusCode).toBe(409)
    expect(voided.json().error.message).toMatch(/void/i)
    expect(unpaid.statusCode).toBe(409)
    expect(unpaid.json().error.message).toMatch(/not paid/i)

    await app.close()
  })

  it('answers 404 for a code that does not exist', async () => {
    const { app } = harness
    const token = await signIn(app, 'door@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: 'DET-NOTAREALCODE' },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('rejects a malformed code before looking anything up', async () => {
    const { app } = harness
    const token = await signIn(app, 'door@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(token),
      payload: { code: 'no!' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })
})
