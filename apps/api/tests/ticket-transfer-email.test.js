/**
 * A ticket transfer emailed (EMAIL mode).
 *
 * A transfer code goes to whatever address the holder types. With a mail
 * server wired in, that is a way to make Desi-Event email a stranger, so:
 *
 *   - one address is sent at most three codes a day, counting team
 *     invitations and ticket transfers together, whoever sent them;
 *   - one sender may email five transfer codes an hour;
 *   - a code the mail server refused is withdrawn: the offer is cancelled, the
 *     ticket is the holder's again, and the answer is 503 `DELIVERY_FAILED`.
 *
 * In MANUAL mode nothing is emailed and neither limit applies.
 *
 * @module @desi-event/api/tests/ticket-transfer-email
 */

import { describe, expect, it } from 'vitest'

import { TRANSFER_DELIVERY_FAILED_SENTENCE } from '../src/lib/delivery.js'
import { transferTokenDigest } from '../src/lib/tickets.js'
import { bearer, claim, createTestApp, signIn } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'

const BUYER = 'priya@example.com'

/**
 * A world with tickets held by the buyer, and codes going to a hook.
 *
 * @param {object} options Inputs.
 * @param {function(object): Promise<void>} [options.deliver] The hook; MANUAL when absent.
 * @param {number} [options.orders] How many orders of four tickets to buy.
 * @param {object} [options.transferMail] The sender limit, overridden.
 * @returns {Promise<object>} The harness and the tickets.
 */
async function withTickets({ deliver, orders = 1, transferMail } = {}) {
  const world = await makeWorld()
  const harness = await createTestApp({
    seed: world.seed,
    ids: world.ids,
    deliver,
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      ...(transferMail ? { transferMail } : {}),
    },
  })
  const { app, prisma, ids } = harness
  const tickets = []

  for (let order = 0; order < orders; order += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: BUYER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 4 }],
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    tickets.push(...response.json().data.tickets)
  }

  claim(prisma, tickets, ids.attendee.id)

  return { ...harness, tickets, token: await signIn(app, BUYER) }
}

/**
 * Offer a ticket.
 *
 * @param {object} app The instance.
 * @param {string} token The holder's session.
 * @param {string} ticketId The ticket.
 * @param {string} toEmail To whom.
 * @param {string} [message] A note.
 * @returns {Promise<object>} The inject result.
 */
function offer(app, token, ticketId, toEmail, message) {
  return app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/transfers`,
    headers: bearer(token),
    payload: { toEmail, ...(message ? { message } : {}) },
  })
}

describe('a ticket transfer in EMAIL mode', () => {
  it('hands the code to the mailer with what the letter needs, and shows it to nobody', async () => {
    const delivered = []
    const { app, prisma, tickets, token } = await withTickets({
      deliver: async (message) => delivered.push(message),
    })

    const response = await offer(app, token, tickets[0].id, 'Meera@Example.com', 'Enjoy!')

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(delivered).toHaveLength(1)

    const [message] = delivered
    const transfer = prisma._store.ticketTransfer.find((row) => row.ticketId === tickets[0].id)

    expect(message).toMatchObject({
      purpose: 'ticket-transfer',
      to: 'meera@example.com',
      ticketId: tickets[0].id,
      transferId: transfer.id,
      expiresAt: transfer.expiresAt.toISOString(),
      message: 'Enjoy!',
    })
    expect(transferTokenDigest(message.token)).toBe(transfer.tokenHash)
    expect(response.body).not.toContain(message.token)
    expect(JSON.stringify(prisma._store)).not.toContain(message.token)

    await app.close()
  })

  it('withdraws the offer and gives the ticket back when the mail server refuses it', async () => {
    const { app, prisma, ids, tickets, token } = await withTickets({
      deliver: async () => {
        throw Object.assign(new Error('The mail server did not accept the message'), {
          code: 'SEND_FAILED',
        })
      },
    })

    const response = await offer(app, token, tickets[0].id, 'meera@example.com')

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatchObject({
      code: 'DELIVERY_FAILED',
      message: TRANSFER_DELIVERY_FAILED_SENTENCE,
    })

    const transfer = prisma._store.ticketTransfer.find((row) => row.ticketId === tickets[0].id)
    const ticket = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    expect(transfer.status).toBe('CANCELLED')
    expect(ticket.status).toBe('VALID')
    expect(ticket.ownerUserId).toBe(ids.attendee.id)

    const failure = prisma._store.auditLog.find(
      (row) => row.action === 'ticket.transfer_delivery_failed',
    )

    expect(failure).toMatchObject({
      entityType: 'Ticket',
      entityId: ticket.id,
      actorId: ids.attendee.id,
    })
    expect(failure.metadata).toMatchObject({ transferId: transfer.id, deliveryMode: 'EMAIL' })
    // Nobody is owed a message about an offer that no longer stands.
    expect(
      prisma._store.notificationOutbox.filter((row) => row.template === 'ticket.transfer.invited'),
    ).toHaveLength(0)

    // And the holder can offer it again.
    const again = await offer(app, token, tickets[0].id, 'meera@example.com')

    expect(again.statusCode).toBe(503)
    expect(prisma._store.ticket.find((row) => row.id === tickets[0].id).status).toBe('VALID')

    await app.close()
  })

  it('sends one address at most three codes a day, counting team invitations too', async () => {
    const { app, prisma, ids, tickets, token } = await withTickets({
      deliver: async () => {},
    })

    // A team invitation emailed to the address earlier today.
    const invited = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/invitations`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
      payload: { email: 'popular@example.com', role: 'STAFF' },
    })

    expect(invited.statusCode).toBe(201)

    for (const ticket of tickets.slice(0, 2)) {
      expect((await offer(app, token, ticket.id, 'popular@example.com')).statusCode).toBe(201)
    }

    const fourth = await offer(app, token, tickets[2].id, 'POPULAR@example.com')

    expect(fourth.statusCode).toBe(429)
    expect(fourth.json().error).toMatchObject({
      code: 'RECIPIENT_DAILY_LIMIT',
      message:
        'This address has already been sent three codes from Desi-Event today. Try again tomorrow.',
    })
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60)
    expect(prisma._store.ticket.find((row) => row.id === tickets[2].id).status).toBe('VALID')
    expect(prisma._store.ticketTransfer).toHaveLength(2)

    // Another address is unaffected.
    expect((await offer(app, token, tickets[2].id, 'other@example.com')).statusCode).toBe(201)

    await app.close()
  })

  it('lets one sender email five transfer codes an hour, then answers 429', async () => {
    const { app, tickets, token } = await withTickets({
      deliver: async () => {},
      orders: 2,
    })

    for (let index = 0; index < 5; index += 1) {
      const response = await offer(app, token, tickets[index].id, `friend${index}@example.com`)

      expect(response.statusCode, response.body).toBe(201)
    }

    const sixth = await offer(app, token, tickets[5].id, 'friend5@example.com')

    expect(sixth.statusCode).toBe(429)
    expect(sixth.json().error.code).toBe('RATE_LIMITED')
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0)

    await app.close()
  })
})

describe('a ticket transfer in MANUAL mode', () => {
  it('has neither limit, because nothing is emailed', async () => {
    const { app, prisma, tickets, token } = await withTickets({ orders: 2 })

    expect(app.deliveryMode).toBe('MANUAL')

    // Six offers in a row, four of them to the same address.
    for (let index = 0; index < 6; index += 1) {
      const toEmail = index < 4 ? 'popular@example.com' : `friend${index}@example.com`
      const response = await offer(app, token, tickets[index].id, toEmail)

      expect(response.statusCode, response.body).toBe(201)
      expect(response.json().data.delivery.mode).toBe('MANUAL')
    }

    expect(prisma._store.ticketTransfer).toHaveLength(6)

    await app.close()
  })
})
