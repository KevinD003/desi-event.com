/**
 * A ticket handed on, withdrawn, and presented at a door.
 *
 * The properties here are the ones a dishonest holder would try:
 *
 *   - **A transferred-away ticket does not admit.** Its credential is cleared,
 *     so the old QR code matches nothing at all rather than matching a row in a
 *     state somebody has to remember to check.
 *   - **An invitation is not a handover.** While one stands the current holder
 *     can still walk in, because an invitation nobody accepted must not leave a
 *     paying attendee at the door.
 *   - **A token works only for the address it was sent to.** Otherwise a
 *     forwarded email is a way to take somebody else's ticket.
 *   - **Neither the pass nor the transfer token is ever returned twice**, and
 *     neither is stored: the database holds digests.
 *
 * The real-PostgreSQL races — two scanners, a transfer against a check-in, a
 * refund against a transfer — are in `ticket-concurrency.test.js`, because a
 * stub cannot prove any of them.
 *
 * @module @desi-event/api/tests/ticket-lifecycle
 */

import { describe, expect, it } from 'vitest'

import {
  TICKET_STATES,
  admissionRefusal,
  canTransition,
  mintTransferToken,
  transferHasLapsed,
  transferTokenDigest,
} from '../src/lib/tickets.js'
import { credentialDigest, mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { bearer, claim, createTestApp, signIn } from './helpers/app.js'
import { TEST_AUTH_SECRET } from './helpers/fixtures.js'

/** Whoever bought the tickets. */
const BUYER = 'priya@example.com'

/** Whoever is being offered one. */
const RECIPIENT = 'rival@dhol.example'

/** Somebody on the door. */
const DOOR = 'door@rangoli.example'

/** An organiser who may withdraw a ticket. */
const MANAGER = 'arun@rangoli.example'

/**
 * A world with two paid tickets held by the buyer.
 *
 * Bought through the real checkout, then claimed: a ticket bought as a guest
 * has no owner and cannot be transferred, which is itself one of the rules
 * below.
 *
 * @returns {Promise<object>} The harness and the tickets.
 */
async function withOwnedTickets() {
  const harness = await createTestApp()
  const { app, prisma, ids } = harness

  const response = await app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  const tickets = response.json().data.tickets

  // Claimed by the buyer's account. Checkout does not do this for a guest
  // purchase, and a ticket with no owner is deliberately untransferable.
  //
  // The order's buyer moves with them. Checkout sets `ownerUserId` from
  // `order.userId`, so the two columns are in step in every state this system
  // produces; a fixture that set only one would be rehearsing a state that does
  // not exist, and the ownership rules read both.
  claim(prisma, tickets, ids.attendee.id)

  return { ...harness, tickets }
}

describe('the transition table', () => {
  it('will not move a checked-in ticket anywhere', () => {
    // A ticket that went through the door has been used. Every later claim on
    // it is about money or about the audit trail, not about admission.
    for (const to of Object.values(TICKET_STATES)) {
      expect(canTransition(TICKET_STATES.CHECKED_IN, to)).toBe(false)
    }
  })

  it('lets a ticket with an invitation outstanding still be admitted', () => {
    expect(canTransition(TICKET_STATES.TRANSFER_PENDING, TICKET_STATES.CHECKED_IN)).toBe(true)
  })

  it('will not transfer a ticket that was already handed on', () => {
    expect(canTransition(TICKET_STATES.TRANSFERRED, TICKET_STATES.TRANSFER_PENDING)).toBe(false)
  })

  it('will not revive a revoked or refunded ticket', () => {
    expect(canTransition(TICKET_STATES.REVOKED, TICKET_STATES.VALID)).toBe(false)
    expect(canTransition(TICKET_STATES.REFUNDED, TICKET_STATES.VALID)).toBe(false)
  })
})

describe('admission', () => {
  it.each([
    [TICKET_STATES.REFUNDED, /refunded/i],
    [TICKET_STATES.REVOKED, /withdrawn/i],
    [TICKET_STATES.TRANSFERRED, /handed to somebody else/i],
    [TICKET_STATES.CANCELLED, /cancelled/i],
    [TICKET_STATES.VOID, /void/i],
  ])('refuses a %s ticket', (status, message) => {
    expect(admissionRefusal({ status }, { status: 'PAID' })).toMatch(message)
  })

  it('admits a valid ticket and one with an invitation outstanding', () => {
    expect(admissionRefusal({ status: TICKET_STATES.VALID }, { status: 'PAID' })).toBeNull()
    expect(
      admissionRefusal({ status: TICKET_STATES.TRANSFER_PENDING }, { status: 'PAID' }),
    ).toBeNull()
  })

  it('refuses a ticket whose order was never paid', () => {
    expect(admissionRefusal({ status: TICKET_STATES.VALID }, { status: 'PENDING' })).toMatch(
      /not paid/i,
    )
  })

  it('does not refuse a ticket that is already in', () => {
    // Null, not a refusal: a re-scan is a duplicate rather than a problem, and
    // the route answers it with the original admission time.
    expect(admissionRefusal({ status: TICKET_STATES.CHECKED_IN }, { status: 'PAID' })).toBeNull()
  })
})

describe('transfer tokens', () => {
  it('stores a digest and never the token', () => {
    const { token, tokenHash } = mintTransferToken()

    expect(tokenHash).toHaveLength(64)
    expect(tokenHash).not.toContain(token)
    expect(transferTokenDigest(token)).toBe(tokenHash)
  })

  it('does not produce the same token twice', () => {
    expect(mintTransferToken().token).not.toBe(mintTransferToken().token)
  })

  it('counts an invitation past its expiry as lapsed', () => {
    const now = new Date('2026-09-16T12:00:00Z')

    expect(transferHasLapsed({ expiresAt: new Date('2026-09-16T11:59:59Z') }, now)).toBe(true)
    expect(transferHasLapsed({ expiresAt: new Date('2026-09-16T12:00:01Z') }, now)).toBe(false)
  })
})

describe('POST /v1/tickets/:id/transfers', () => {
  it('offers a ticket without moving it', async () => {
    const { app, prisma, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: RECIPIENT },
    })

    expect(response.statusCode, response.body).toBe(201)

    const { data } = response.json()

    expect(data.status).toBe('PENDING')
    // Masked, not whole: a transfer record is read by the sender and shown on a
    // screen, and the address is enough to recognise rather than to harvest.
    expect(data.toEmailMasked).toMatch(/^r\*+l@dhol\.example$/)
    expect(response.body).not.toContain(RECIPIENT)

    // The token is not in the response. It is a bearer secret, and a response
    // carrying it would put it wherever the sender's browser keeps responses.
    expect(data).not.toHaveProperty('token')
    expect(data).not.toHaveProperty('tokenHash')

    const ticket = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    expect(ticket.status).toBe('TRANSFER_PENDING')
    // Still admittable. An invitation nobody accepted must not leave a paying
    // attendee at the door.
    expect(ticket.credentialHash).not.toBeNull()

    await app.close()
  })

  it('queues one message and no secret with it', async () => {
    const { app, prisma, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: RECIPIENT },
    })

    const queued = prisma._store.notificationOutbox.filter(
      (row) => row.template === 'ticket.transfer.invited',
    )

    expect(queued).toHaveLength(1)
    expect(queued[0].suppressible).toBe(false)
    // The payload is read by a worker and by whoever is debugging it. A token
    // in one would be a bearer secret in a log.
    expect(JSON.stringify(queued[0].payload)).not.toMatch(/token/i)

    await app.close()
  })

  it('refuses to send a ticket to whoever already holds it', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: BUYER },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/already theirs/i)

    await app.close()
  })

  it('refuses somebody who does not hold the ticket', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: 'somebody@else.example' },
    })

    // 404 rather than 403: telling a stranger that a ticket exists and is
    // somebody else's is more than they need to know.
    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('refuses a ticket bought without an account', async () => {
    const { app, prisma, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).ownerUserId = null

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: RECIPIENT },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('TICKET_UNCLAIMED')

    await app.close()
  })

  it('will not start a second invitation while one stands', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)
    const offer = () =>
      app.inject({
        method: 'POST',
        url: `/v1/tickets/${tickets[0].id}/transfers`,
        headers: bearer(token),
        payload: { toEmail: RECIPIENT },
      })

    await offer()

    const second = await offer()

    expect(second.statusCode).toBe(409)
    expect(second.json().error.message).toMatch(/transfer pending ticket cannot become/i)

    await app.close()
  })
})

describe('POST /v1/ticket-transfers/accept', () => {
  /**
   * Offer a ticket and recover the token the way a mail provider would.
   *
   * @param {object} world From {@link withOwnedTickets}.
   * @param {string} ticketId Which ticket.
   * @returns {Promise<string>} The token that went to the recipient.
   */
  async function offerAndCaptureToken(world, ticketId) {
    const token = await signIn(world.app, BUYER)

    await world.app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/transfers`,
      headers: bearer(token),
      payload: { toEmail: RECIPIENT },
    })

    return world.delivered.at(-1).token
  }

  /**
   * A world whose `deliver` seam records what it was handed.
   *
   * @returns {Promise<object>} The harness, the tickets, and what was delivered.
   */
  async function withCapture() {
    const delivered = []
    const harness = await createTestApp({
      deliver: async (message) => {
        delivered.push(message)
      },
    })
    const { app, prisma, ids } = harness

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: BUYER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
      },
    })

    const tickets = response.json().data.tickets

    claim(prisma, tickets, ids.attendee.id)

    return { ...harness, tickets, delivered }
  }

  it('mints a new ticket, kills the old pass, and returns the new one once', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(recipientToken),
      payload: { token },
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.ticket.status).toBe('VALID')
    expect(data.ticket.id).not.toBe(tickets[0].id)
    expect(data.credential).toEqual(expect.any(String))

    const old = prisma._store.ticket.find((row) => row.id === tickets[0].id)
    const issued = prisma._store.ticket.find((row) => row.id === data.ticket.id)

    expect(old.status).toBe('TRANSFERRED')
    // The old pass matches nothing at all rather than matching a ticket in the
    // wrong state, which is one check fewer for a scanner to get right.
    expect(old.credentialHash).toBeNull()
    expect(old.credentialVersion).toBe(2)

    expect(issued.ownerUserId).toBeTruthy()
    expect(issued.supersedesTicketId).toBe(tickets[0].id)
    expect(issued.credentialVersion).toBe(1)
    // The digest is stored; the credential itself is not, anywhere.
    expect(issued.credentialHash).toBe(credentialDigest(data.credential))
    expect(JSON.stringify(prisma._store.ticket)).not.toContain(data.credential)

    // And it is the credential this ticket's own deriver would produce.
    expect(data.credential).toBe(
      mintTicketCredential({ secret: TEST_AUTH_SECRET, ticketId: issued.id, version: 1 }),
    )

    await app.close()
  })

  it('refuses a token presented by the wrong address', async () => {
    const world = await withCapture()
    const { app, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const wrongPerson = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(wrongPerson),
      payload: { token },
    })

    // Otherwise a forwarded email is a way to take somebody else's ticket.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('TRANSFER_NOT_YOURS')

    await app.close()
  })

  it('accepts once, however many times it is pressed', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)
    const accept = () =>
      app.inject({
        method: 'POST',
        url: '/v1/ticket-transfers/accept',
        headers: bearer(recipientToken),
        payload: { token },
      })

    const first = await accept()
    const second = await accept()

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)

    // One new ticket, not two. Two would be two people admitted on one purchase.
    const issued = prisma._store.ticket.filter((row) => row.supersedesTicketId === tickets[0].id)

    expect(issued).toHaveLength(1)

    await app.close()
  })

  it('refuses an invitation that has lapsed', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)

    for (const row of prisma._store.ticketTransfer) {
      row.expiresAt = new Date(Date.now() - 1000)
    }

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(recipientToken),
      payload: { token },
    })

    expect(response.statusCode).toBe(410)
    expect(response.json().error.code).toBe('TRANSFER_EXPIRED')

    await app.close()
  })

  it('answers the same way for a token that names nothing', async () => {
    const world = await withCapture()
    const { app } = world
    const recipientToken = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(recipientToken),
      payload: { token: 'a'.repeat(43) },
    })

    // 404 and nothing else. Distinguishing "no such invitation" from "not
    // yours" would let somebody with a guessed token learn it named something.
    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('puts the ticket back when the recipient declines', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/decline',
      headers: bearer(recipientToken),
      payload: { token },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('DECLINED')

    const ticket = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    // Exactly where it was. An invitation that did not complete leaves the
    // holder holding it.
    expect(ticket.status).toBe('VALID')
    expect(ticket.credentialHash).not.toBeNull()

    await app.close()
  })

  it('lets the recipient decline, leaving the ticket where it was', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/decline',
      headers: bearer(recipientToken),
      payload: { token },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('DECLINED')

    // Declining is not a half-transfer. The ticket goes back to VALID with the
    // credential it always had, so the person who offered it can still walk in
    // and does not need a new pass.
    const original = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    expect(original.status).toBe('VALID')
    expect(original.credentialVersion).toBe(1)
    expect(original.credentialHash).toBeTruthy()

    await app.close()
  })

  it('refuses a second answer to an invitation already answered', async () => {
    const world = await withCapture()
    const { app, tickets } = world
    const token = await offerAndCaptureToken(world, tickets[0].id)
    const recipientToken = await signIn(app, RECIPIENT)

    const first = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/decline',
      headers: bearer(recipientToken),
      payload: { token },
    })

    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(recipientToken),
      payload: { token },
    })

    // Declining and then accepting the same invitation is the race that would
    // otherwise hand out a ticket somebody already gave back.
    expect([404, 409]).toContain(second.statusCode)

    await app.close()
  })

  it('has nothing to withdraw when no invitation is outstanding', async () => {
    const { app, tickets } = await withOwnedTickets()
    const senderToken = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers/cancel`,
      headers: bearer(senderToken),
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('lets the sender withdraw an offer', async () => {
    const world = await withCapture()
    const { app, prisma, tickets } = world

    await offerAndCaptureToken(world, tickets[0].id)

    const senderToken = await signIn(app, BUYER)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers/cancel`,
      headers: bearer(senderToken),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('CANCELLED')
    expect(prisma._store.ticket.find((row) => row.id === tickets[0].id).status).toBe('VALID')

    await app.close()
  })
})

describe('a transferred-away ticket at the door', () => {
  it('does not admit on the old pass', async () => {
    const delivered = []
    const harness = await createTestApp({
      deliver: async (message) => {
        delivered.push(message)
      },
    })
    const { app, prisma, ids } = harness

    const order = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: BUYER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      },
    })
    const [ticket] = order.json().data.tickets

    claim(prisma, [ticket], ids.attendee.id)

    const oldCredential = mintTicketCredential({
      secret: TEST_AUTH_SECRET,
      ticketId: ticket.id,
      version: 1,
    })
    const buyerToken = await signIn(app, BUYER)

    await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers: bearer(buyerToken),
      payload: { toEmail: RECIPIENT },
    })

    const recipientToken = await signIn(app, RECIPIENT)

    await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(recipientToken),
      payload: { token: delivered.at(-1).token },
    })

    const doorToken = await signIn(app, DOOR)
    const scan = await app.inject({
      method: 'POST',
      url: '/v1/tickets/admission/preview',
      headers: bearer(doorToken),
      payload: { credential: oldCredential },
    })

    // 404, not 409. The digest was cleared, so the old pass names nothing —
    // which is a stronger guarantee than a status check the scanner has to
    // remember to make. A door cannot confirm what it could not preview.
    expect(scan.statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/tickets/:id/revoke', () => {
  it('withdraws a ticket and kills its pass', async () => {
    const { app, prisma, tickets } = await withOwnedTickets()
    const token = await signIn(app, MANAGER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/revoke`,
      headers: bearer(token),
      payload: { reason: 'Bought with a card that was later disputed.' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.status).toBe('REVOKED')

    const revoked = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    expect(revoked.revokedReason).toMatch(/disputed/)
    expect(revoked.credentialHash).toBeNull()

    await app.close()
  })

  it('refuses a door scanner', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, DOOR)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/revoke`,
      headers: bearer(token),
      payload: { reason: 'They were rude to me.' },
    })

    // Somebody on a gate must not be able to turn an awkward attendee's ticket
    // off.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('will not revoke a ticket that already went through the door', async () => {
    const { app, prisma, tickets } = await withOwnedTickets()
    const doorToken = await signIn(app, DOOR)

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/tickets/admission/preview',
      headers: bearer(doorToken),
      payload: { code: tickets[0].code },
    })
    const admitted = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: bearer(doorToken),
      payload: { code: tickets[0].code, previewReference: preview.json().data.previewReference },
    })

    expect(admitted.json().data.outcome).toBe('ADMITTED')

    const managerToken = await signIn(app, MANAGER)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/revoke`,
      headers: bearer(managerToken),
      payload: { reason: 'Changed my mind after they came in.' },
    })

    expect(response.statusCode).toBe(409)
    expect(prisma._store.ticket.find((row) => row.id === tickets[0].id).status).toBe('CHECKED_IN')

    await app.close()
  })
})

describe('GET /v1/tickets/:id', () => {
  it('gives the holder the ticket, its event and its history', async () => {
    const { app, tickets, ids } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}`,
      headers: bearer(token),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.ticket.id).toBe(tickets[0].id)
    expect(data.holder).toBe(true)
    expect(data.organizationId).toBe(ids.organization.id)
    expect(data.event.title).toBe(ids.publishedEvent.title)
    expect(data.transfers).toEqual([])

    await app.close()
  })

  it('gives the organiser the same ticket, and says they are not the holder', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, MANAGER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}`,
      headers: bearer(token),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.holder).toBe(false)

    await app.close()
  })

  it('refuses somebody who neither holds it nor runs the event', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)
    // Nothing about the ticket, the buyer or the event comes back with the
    // refusal, or guessing identifiers becomes a way of reading them.
    expect(response.body).not.toMatch(/priya|Diwali|VALID/iu)

    await app.close()
  })

  it('carries no pass, no token and no digest, however many transfers there have been', async () => {
    const delivered = []
    const harness = await createTestApp({
      deliver: async (message) => {
        delivered.push(message)
      },
    })
    const { app, prisma, ids } = harness

    const order = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: BUYER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      },
    })

    const [ticket] = order.json().data.tickets

    claim(prisma, [ticket], ids.attendee.id)

    const token = await signIn(app, BUYER)

    await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers: bearer(token),
      payload: { toEmail: RECIPIENT },
    })

    const invitation = delivered.at(-1).token

    expect(invitation).toBeTruthy()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${ticket.id}`,
      headers: bearer(token),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.transfers).toHaveLength(1)
    expect(data.transfers[0].status).toBe('PENDING')
    // Masked, not omitted: the sender typed the address and should recognise
    // it, and nobody should be able to harvest it from here.
    expect(data.transfers[0].toEmailMasked).toMatch(/\*/u)
    expect(data.transfers[0].toEmailMasked).not.toBe(RECIPIENT)

    // The three things that must never come back.
    expect(response.body).not.toContain(invitation)
    expect(response.body).not.toContain('credentialHash')
    expect(response.body).not.toContain('tokenHash')

    await app.close()
  })
})

describe('GET /v1/tickets', () => {
  it('lists the tickets I hold, without their passes', async () => {
    const { app, tickets } = await withOwnedTickets()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: bearer(token),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toHaveLength(tickets.length)
    // A credential is derived once and handed over once. A list endpoint that
    // returned one would put it in every cache between here and the phone.
    expect(response.body).not.toContain('credentialHash')

    await app.close()
  })

  it('does not list somebody else’s', async () => {
    const { app } = await withOwnedTickets()
    const token = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: bearer(token),
    })

    expect(response.json().data).toEqual([])

    await app.close()
  })
})
