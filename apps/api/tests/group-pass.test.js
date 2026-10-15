/**
 * The group pass, through the routes: take it out, replace it, and who may.
 *
 * Against the stub database, so these prove the wiring — who gets a pass and
 * who gets the uniform 404, what reaches the wire, the headers, the audit
 * rows, the rate limit. The door's use of a group pass is in `tickets.test.js`
 * (stub) and `group-admission-integration.test.js` (PostgreSQL).
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { bearer, claim, createTestApp, signIn } from './helpers/app.js'

const ATTENDEE = 'priya@example.com'
const OWNER = 'owner@rangoli.example'
const PLATFORM = 'ops@desi-event.example'
const RIVAL = 'rival@dhol.example'
const DOOR = 'door@rangoli.example'

/**
 * SHA-256, hex.
 *
 * @param {string} value The input.
 * @returns {string} The digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * A world with one paid order of `quantity` tickets, bought as a guest and
 * then claimed by the attendee's account — so the order has a buyer account.
 *
 * @param {object} [options] Options.
 * @param {number} [options.quantity] How many tickets.
 * @param {boolean} [options.claimed] Whether the attendee's account holds it.
 * @param {object} [options.app] Harness options.
 * @returns {Promise<object>} The harness plus the order and its tickets.
 */
async function withOrder({ quantity = 2, claimed = true, app: appOptions = {} } = {}) {
  const harness = await createTestApp(appOptions)
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: harness.ids.publishedEvent.id,
      buyerEmail: ATTENDEE,
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: harness.ids.generalAdmission.id, quantity }],
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  const order = response.json().data

  if (claimed) claim(harness.prisma, order.tickets, harness.ids.attendee.id)

  return { ...harness, order, tickets: order.tickets }
}

/**
 * Ask for an order's group pass.
 *
 * @param {object} app The application.
 * @param {string|null} token A bearer token.
 * @param {string} reference The order reference.
 * @returns {Promise<object>} The injected response.
 */
function groupPass(app, token, reference) {
  return app.inject({
    method: 'GET',
    url: `/v1/orders/${encodeURIComponent(reference)}/group-pass`,
    headers: token ? bearer(token) : {},
  })
}

/**
 * Replace an order's group pass.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {string} reference The order reference.
 * @returns {Promise<object>} The injected response.
 */
function rotate(app, token, reference) {
  return app.inject({
    method: 'POST',
    url: `/v1/orders/${encodeURIComponent(reference)}/group-pass/rotate`,
    headers: bearer(token),
  })
}

/**
 * The error envelope without its per-request id.
 *
 * @param {object} response An injected response.
 * @returns {object} `{ statusCode, error }` minus `requestId`.
 */
function refusalShape(response) {
  const { requestId: _requestId, ...error } = response.json().error

  return { statusCode: response.statusCode, error }
}

describe('GET /v1/orders/:reference/group-pass', () => {
  it('hands the buyer a derived pass whose digests are what the database holds, and never caches it', async () => {
    const { app, prisma, order, tickets } = await withOrder()
    const token = await signIn(app, ATTENDEE)

    const first = await groupPass(app, token, order.reference)

    expect(first.statusCode, first.body).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store, private')
    expect(first.headers.pragma).toBe('no-cache')

    const { data } = first.json()
    const [row] = prisma._store.groupPass

    expect(prisma._store.groupPass).toHaveLength(1)
    expect(row.orderId).toBe(order.id)
    expect(data.credential).toMatch(/^G1\.[A-Za-z0-9_-]{43}$/u)
    expect(data.groupCode).toMatch(/^DEG-[2-9A-HJ-NP-Z]{12}$/u)
    expect(sha256(data.credential)).toBe(row.credentialHash)
    expect(sha256(data.groupCode)).toBe(row.codeHash)
    expect(data).toMatchObject({
      orderReference: order.reference,
      credentialVersion: 1,
      admits: 2,
    })
    expect(data.tickets.map((ticket) => ticket.id).sort()).toEqual(
      tickets.map((ticket) => ticket.id).sort(),
    )
    // The digests are the database's business; the wire carries the values.
    expect(first.body).not.toContain(row.credentialHash)
    expect(first.body).not.toContain(row.codeHash)
    expect(first.body).not.toMatch(/credentialHash|codeHash/u)

    // Created once; asked again, the same pass.
    const second = await groupPass(app, token, order.reference)

    expect(prisma._store.groupPass).toHaveLength(1)
    expect(second.json().data.credential).toBe(data.credential)
    expect(second.json().data.groupCode).toBe(data.groupCode)

    await app.close()
  })

  it('audits each retrieval with the version and never the pass or the code', async () => {
    const { app, prisma, order } = await withOrder()
    const response = await groupPass(app, await signIn(app, ATTENDEE), order.reference)
    const { credential, groupCode } = response.json().data

    const rows = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.TICKET_GROUP_PASS_ISSUED,
    )

    expect(rows).toEqual([
      expect.objectContaining({
        entityType: 'GroupPass',
        entityId: prisma._store.groupPass[0].id,
        metadata: expect.objectContaining({ credentialVersion: 1, orderId: order.id }),
      }),
    ])

    const everything = JSON.stringify(prisma._store.auditLog)

    expect(everything).not.toContain(credential)
    expect(everything).not.toContain(groupCode)

    await app.close()
  })

  it('answers an organiser, a platform administrator, another account at the buyer’s address and a guest order as it answers an unknown reference', async () => {
    const { app, prisma, order, ids } = await withOrder()
    const unknown = await groupPass(app, await signIn(app, ATTENDEE), 'DE-NOSUCHORDER')

    expect(unknown.statusCode).toBe(404)

    // An organiser who may read the order, and the platform: not their pass.
    for (const email of [OWNER, PLATFORM]) {
      const response = await groupPass(app, await signIn(app, email), order.reference)

      expect(refusalShape(response), email).toEqual(refusalShape(unknown))
    }

    // Somebody signed in at the address the order was placed with, on another
    // account: the order route lets them read it; the pass is the account's.
    prisma._store.order.find((row) => row.id === order.id).buyerEmail = RIVAL

    const sameAddress = await groupPass(app, await signIn(app, RIVAL), order.reference)

    expect(refusalShape(sameAddress)).toEqual(refusalShape(unknown))

    // A guest order has no account, so nobody holds its group pass.
    const guest = await withOrder({ claimed: false })
    const guestAnswer = await groupPass(
      guest.app,
      await signIn(guest.app, ATTENDEE),
      guest.order.reference,
    )

    expect(guestAnswer.statusCode).toBe(404)
    expect(guestAnswer.json().error.message).toBe(unknown.json().error.message)

    expect(prisma._store.groupPass).toHaveLength(0)
    expect(ids.attendee.id).toEqual(expect.any(String))

    await guest.app.close()
    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app, order } = await withOrder()

    expect((await groupPass(app, null, order.reference)).statusCode).toBe(401)

    await app.close()
  })

  it('says why there is no pass when fewer than two tickets still admit', async () => {
    const { app, prisma, order, tickets } = await withOrder()

    prisma._store.ticket.find((row) => row.id === tickets[0].id).status = 'REFUNDED'

    const response = await groupPass(app, await signIn(app, ATTENDEE), order.reference)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.reason).toBe('TOO_FEW_TICKETS')
    expect(prisma._store.groupPass).toHaveLength(0)

    await app.close()
  })

  it('says why there is no pass for an unpaid order or a cancelled event', async () => {
    const { app, prisma, order, ids } = await withOrder()
    const token = await signIn(app, ATTENDEE)
    const row = prisma._store.order.find((candidate) => candidate.id === order.id)

    row.status = 'CANCELLED'
    expect((await groupPass(app, token, order.reference)).json().error.reason).toBe(
      'ORDER_NOT_PAID',
    )

    row.status = 'PAID'
    prisma._store.event.find((event) => event.id === ids.publishedEvent.id).cancelledAt = new Date()
    expect((await groupPass(app, token, order.reference)).json().error.reason).toBe(
      'EVENT_CANCELLED',
    )

    await app.close()
  })

  it('refuses a pass whose derived value does not match the stored digest', async () => {
    const { app, prisma, order } = await withOrder()
    const token = await signIn(app, ATTENDEE)

    expect((await groupPass(app, token, order.reference)).statusCode).toBe(200)

    prisma._store.groupPass[0].credentialHash = 'f'.repeat(64)

    const response = await groupPass(app, token, order.reference)

    expect(response.statusCode).toBe(409)
    expect(response.body).not.toMatch(/G1\./u)

    await app.close()
  })

  it('is rate-limited per account', async () => {
    const { app, order } = await withOrder({
      app: { rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, pass: { max: 2 } } },
    })
    const token = await signIn(app, ATTENDEE)

    expect((await groupPass(app, token, order.reference)).statusCode).toBe(200)
    expect((await groupPass(app, token, order.reference)).statusCode).toBe(200)
    expect((await groupPass(app, token, order.reference)).statusCode).toBe(429)

    await app.close()
  })
})

describe('POST /v1/orders/:reference/group-pass/rotate', () => {
  it('replaces the pass: the version moves on, the old QR and code open nothing, no secret comes back', async () => {
    const { app, prisma, order } = await withOrder()
    const token = await signIn(app, ATTENDEE)
    const before = (await groupPass(app, token, order.reference)).json().data

    const rotated = await rotate(app, token, order.reference)

    expect(rotated.statusCode, rotated.body).toBe(200)
    expect(rotated.headers['cache-control']).toBe('no-store, private')
    expect(rotated.json().data).toEqual({
      credentialVersion: 2,
      rotatedAt: expect.any(String),
    })
    expect(rotated.body).not.toMatch(/G1\.|DEG-/u)
    expect(prisma._store.groupPass[0].credentialVersion).toBe(2)

    const after = (await groupPass(app, token, order.reference)).json().data

    expect(after.credential).not.toBe(before.credential)
    expect(after.groupCode).not.toBe(before.groupCode)

    // At the door, the old QR and the old code resolve to nothing.
    const door = await signIn(app, DOOR)

    for (const body of [{ credential: before.credential }, { code: before.groupCode }]) {
      const looked = await app.inject({
        method: 'POST',
        url: '/v1/tickets/admission/group/preview',
        headers: bearer(door),
        payload: body,
      })

      expect(looked.statusCode, JSON.stringify(Object.keys(body))).toBe(404)
    }

    const audit = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.TICKET_GROUP_PASS_ROTATED,
    )

    expect(audit).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ fromVersion: 1, toVersion: 2 }),
      }),
    ])

    const everything = JSON.stringify(prisma._store.auditLog)

    for (const secret of [before.credential, before.groupCode, after.credential, after.groupCode]) {
      expect(everything).not.toContain(secret)
    }

    await app.close()
  })

  it('is the buyer’s alone, with the same 404', async () => {
    const { app, order } = await withOrder()

    await groupPass(app, await signIn(app, ATTENDEE), order.reference)

    for (const email of [OWNER, PLATFORM]) {
      const response = await rotate(app, await signIn(app, email), order.reference)

      expect(response.statusCode, email).toBe(404)
    }

    await app.close()
  })

  it('refuses to replace a pass that was never taken out', async () => {
    const { app, order } = await withOrder()
    const response = await rotate(app, await signIn(app, ATTENDEE), order.reference)

    expect(response.statusCode).toBe(409)

    await app.close()
  })
})

describe('GET /v1/orders/:reference', () => {
  it('tells the buyer whether the order has a group pass, and nobody else', async () => {
    const { app, order } = await withOrder()

    const mine = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: bearer(await signIn(app, ATTENDEE)),
    })

    expect(mine.statusCode).toBe(200)
    expect(mine.json().data.groupPass).toEqual({
      admits: 2,
      available: true,
      unavailableReason: null,
    })

    const organiser = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: bearer(await signIn(app, OWNER)),
    })

    expect(organiser.statusCode).toBe(200)
    expect(organiser.json().data.groupPass).toBeNull()

    await app.close()
  })

  it('keeps a pass already taken out showing for the last ticket that admits, and says when none does', async () => {
    const { app, prisma, order, tickets } = await withOrder()
    const token = await signIn(app, ATTENDEE)
    const summary = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/orders/${order.reference}`,
          headers: bearer(token),
        })
      ).json().data.groupPass
    const taken = (await groupPass(app, token, order.reference)).json().data
    const ticket = (id) => prisma._store.ticket.find((row) => row.id === id)

    // One of the two went in.
    ticket(tickets[0].id).status = 'CHECKED_IN'

    expect(await summary()).toEqual({ admits: 1, available: true, unavailableReason: null })

    const lastGuest = await groupPass(app, token, order.reference)

    expect(lastGuest.statusCode, lastGuest.body).toBe(200)
    expect(lastGuest.json().data).toMatchObject({
      admits: 1,
      credential: taken.credential,
      groupCode: taken.groupCode,
    })

    // And the other.
    ticket(tickets[1].id).status = 'CHECKED_IN'

    expect(await summary()).toEqual({
      admits: 0,
      available: false,
      unavailableReason: 'TOO_FEW_TICKETS',
    })

    const none = await groupPass(app, token, order.reference)
    const replaced = await rotate(app, token, order.reference)

    expect(none.statusCode).toBe(409)
    expect(none.json().error.reason).toBe('TOO_FEW_TICKETS')
    expect(replaced.statusCode).toBe(409)
    expect(replaced.json().error.reason).toBe('TOO_FEW_TICKETS')
    expect(prisma._store.groupPass[0].credentialVersion).toBe(1)

    await app.close()
  })

  it('says why an order of one ticket has none', async () => {
    const { app, order } = await withOrder({ quantity: 1 })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: bearer(await signIn(app, ATTENDEE)),
    })

    expect(response.json().data.groupPass).toEqual({
      admits: 1,
      available: false,
      unavailableReason: 'TOO_FEW_TICKETS',
    })

    await app.close()
  })
})
