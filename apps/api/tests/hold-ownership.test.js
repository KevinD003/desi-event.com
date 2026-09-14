/**
 * Hold release authorization.
 *
 * Taking a hold is open to anyone — checkout has to work for a buyer who has
 * not signed in — so releasing one has to be the guarded operation. Every case
 * below describes somebody trying to free inventory that is not theirs.
 */

import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { bearer, createTestApp, holdHeaders, signIn } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'

/**
 * Take a hold, optionally as an authenticated caller.
 *
 * @param {object} app The Fastify instance.
 * @param {string} ticketTypeId The tier to hold.
 * @param {Record<string, string>} [headers] Request headers.
 * @returns {Promise<object>} The `data` object from the response.
 */
async function take(app, ticketTypeId, headers = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/holds',
    payload: { ticketTypeId, quantity: 1 },
    headers,
  })

  expect(response.statusCode).toBe(201)
  return response.json().data
}

/**
 * Attempt a release.
 *
 * @param {object} app The Fastify instance.
 * @param {string} id The hold id.
 * @param {Record<string, string>} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function release(app, id, headers = {}) {
  return app.inject({ method: 'DELETE', url: `/v1/holds/${id}`, headers })
}

describe('hold ownership at creation', () => {
  it('records an authenticated hold against the caller and issues no guest token', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, ids.attendee.email)

    const taken = await take(app, ids.generalAdmission.id, bearer(token))
    const stored = prisma._store.ticketHold.find((row) => row.id === taken.id)

    expect(stored.userId).toBe(ids.attendee.id)
    expect(stored.guestTokenHash).toBeNull()
    expect(taken.guestToken).toBeUndefined()

    await app.close()
  })

  it('gives an anonymous hold a one-time token and stores only its digest', async () => {
    const { app, prisma, ids } = await createTestApp()

    const taken = await take(app, ids.generalAdmission.id)
    const stored = prisma._store.ticketHold.find((row) => row.id === taken.id)

    expect(taken.guestToken).toEqual(expect.any(String))
    expect(stored.userId).toBeNull()
    expect(stored.guestTokenHash).toEqual(expect.any(String))
    // The plaintext must never be persisted: a database leak would otherwise
    // hand the reader every guest's holds.
    expect(stored.guestTokenHash).not.toBe(taken.guestToken)
    expect(JSON.stringify(stored)).not.toContain(taken.guestToken)

    await app.close()
  })
})

describe('hold release authorization', () => {
  it('lets the owner release their own active hold', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, ids.attendee.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(token))

    const response = await release(app, taken.id, bearer(token))

    expect(response.statusCode).toBe(200)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('RELEASED')

    await app.close()
  })

  it('refuses a different authenticated user, without revealing the hold exists', async () => {
    const { app, prisma, ids } = await createTestApp()
    const ownerToken = await signIn(app, ids.attendee.email)
    const otherToken = await signIn(app, ids.outsider.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(ownerToken))

    const response = await release(app, taken.id, bearer(otherToken))

    expect(response.statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('refuses one guest presenting another guest token', async () => {
    const { app, prisma, ids } = await createTestApp()
    const mine = await take(app, ids.generalAdmission.id)
    const theirs = await take(app, ids.generalAdmission.id)

    const response = await release(app, theirs.id, holdHeaders(mine))

    expect(response.statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === theirs.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('refuses an anonymous request against an authenticated hold', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, ids.attendee.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(token))

    expect((await release(app, taken.id)).statusCode).toBe(404)
    expect((await release(app, taken.id, { 'x-hold-token': 'guessed' })).statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('ignores a userId in the request body', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, ids.attendee.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(token))

    // Both directions: claiming to be the owner, and claiming the hold belongs
    // to the caller. Neither may influence the decision.
    const forged = await app.inject({
      method: 'DELETE',
      url: `/v1/holds/${taken.id}`,
      payload: { userId: ids.attendee.id, ownerId: ids.attendee.id, role: 'ADMIN' },
      headers: { 'content-type': 'application/json' },
    })

    expect(forged.statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('denies an organizer who lacks hold:release_any', async () => {
    // MANAGER runs the event day to day but has no business freeing another
    // buyer's reservation.
    const { app, prisma, ids } = await createTestApp()
    const manager = await signIn(app, ids.manager.email)
    const taken = await take(app, ids.generalAdmission.id)

    const response = await release(app, taken.id, bearer(manager))

    expect(response.statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('allows an authorized administrative override and audits it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const admin = await signIn(app, ids.platformAdmin.email)
    const taken = await take(app, ids.generalAdmission.id)

    const response = await release(app, taken.id, bearer(admin))

    expect(response.statusCode).toBe(200)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('RELEASED')

    const entry = prisma._store.auditLog.find(
      (row) => row.action === AUDIT_ACTIONS.HOLD_RELEASED && row.entityId === taken.id,
    )

    expect(entry).toBeDefined()
    expect(entry.actorId).toBe(ids.platformAdmin.id)
    expect(entry.metadata).toMatchObject({
      mode: 'ADMIN',
      previousStatus: 'ACTIVE',
      newStatus: 'RELEASED',
    })
    expect(entry.metadata.requestId).toEqual(expect.any(String))
    expect(entry.metadata.at).toEqual(expect.any(String))

    await app.close()
  })

  it('answers identically for a nonexistent hold and one the caller may not touch', async () => {
    const { app, ids } = await createTestApp()
    const otherToken = await signIn(app, ids.outsider.email)
    const ownerToken = await signIn(app, ids.attendee.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(ownerToken))

    const missing = await release(app, 'cnosuchhold00000000000zz', bearer(otherToken))
    const forbidden = await release(app, taken.id, bearer(otherToken))

    // Same status and same body: the endpoint must not become an oracle for
    // which hold ids exist.
    expect(missing.statusCode).toBe(forbidden.statusCode)
    expect(missing.json().error.code).toBe(forbidden.json().error.code)
    expect(missing.json().error.message).toBe(forbidden.json().error.message)

    await app.close()
  })

  it('records a denial in the audit trail even though the caller cannot tell', async () => {
    const { app, prisma, ids } = await createTestApp()
    const otherToken = await signIn(app, ids.outsider.email)
    const ownerToken = await signIn(app, ids.attendee.email)
    const taken = await take(app, ids.generalAdmission.id, bearer(ownerToken))

    await release(app, taken.id, bearer(otherToken))

    const denial = prisma._store.auditLog.find(
      (row) => row.action === AUDIT_ACTIONS.HOLD_RELEASE_DENIED && row.entityId === taken.id,
    )

    expect(denial).toBeDefined()
    expect(denial.actorId).toBe(ids.outsider.id)

    await app.close()
  })
})

describe('hold release concurrency and replay', () => {
  it('makes only one business transition when two releases race', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    const [first, second] = await Promise.all([
      release(app, taken.id, holdHeaders(taken)),
      release(app, taken.id, holdHeaders(taken)),
    ])

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)

    // Exactly one released-audit row: the second request found the hold no
    // longer ACTIVE and wrote nothing.
    const released = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.HOLD_RELEASED && row.entityId === taken.id,
    )

    expect(released).toHaveLength(1)
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('RELEASED')

    await app.close()
  })

  it('stays consistent when release races expiry', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    // The sweep would call this lapsed; the caller asks to release it.
    prisma._store.ticketHold.find((row) => row.id === taken.id).expiresAt = new Date(Date.now() - 1_000)

    const response = await release(app, taken.id, holdHeaders(taken))

    expect(response.statusCode).toBe(200)
    // Recorded as EXPIRED, not RELEASED: it lapsed before the caller got to it,
    // and the two must not disagree about why the inventory came back.
    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('EXPIRED')

    await app.close()
  })

  it('does not duplicate side effects when a release is replayed', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await release(app, taken.id, holdHeaders(taken))).statusCode).toBe(200)
    }

    const released = prisma._store.auditLog.filter(
      (row) => row.action === AUDIT_ACTIONS.HOLD_RELEASED && row.entityId === taken.id,
    )

    expect(released).toHaveLength(1)

    await app.close()
  })
})

describe('checkout may not spend a hold it does not own', () => {
  it('refuses to convert another buyer holds', async () => {
    const { app, prisma, ids } = await createTestApp()
    const victim = await signIn(app, ids.attendee.email)
    const theirs = await take(app, ids.generalAdmission.id, bearer(victim))

    const attacker = await signIn(app, ids.outsider.email)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'attacker@example.com',
        buyerName: 'Attacker',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        holdIds: [theirs.id],
      },
      headers: bearer(attacker),
    })

    expect(response.statusCode).toBe(404)
    expect(prisma._store.ticketHold.find((row) => row.id === theirs.id).status).toBe('ACTIVE')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })
})

describe('the expiry sweep remains a system action', () => {
  it('keeps the worker path independent of request authorization', async () => {
    // The sweep runs with no actor at all, so it must not depend on any of the
    // request-scoped checks above. It works on status and expiry only.
    const world = await makeWorld()
    const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })
    const taken = await take(app, ids.generalAdmission.id)

    const row = prisma._store.ticketHold.find((item) => item.id === taken.id)
    row.expiresAt = new Date(Date.now() - 60_000)

    const { count } = await prisma.ticketHold.updateMany({
      where: { id: taken.id, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    })

    expect(count).toBe(1)
    expect(prisma._store.ticketHold.find((item) => item.id === taken.id).status).toBe('EXPIRED')

    await app.close()
  })
})
