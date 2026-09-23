/**
 * Who holds a ticket, who may read it, and who may be admitted on it.
 *
 * ## The defect these were written against
 *
 * Accepting a transfer mints the recipient's ticket onto the **buyer's order
 * item** — `acceptTransfer` reuses `ticket.orderItemId`. `toOrder` flattened
 * `item.tickets`, so the buyer's own order carried a stranger's ticket: their
 * reference code, the name printed on it, its status. Nothing in the suite
 * caught it, because every ownership test asked about the wallet and the wallet
 * filters by `ownerUserId`.
 *
 * `demonstrates the defect this replaced` below is the falsification: it builds
 * the exact shape the old presenter was handed and asserts on what came back.
 * Reverting the filter turns it red.
 *
 * ## Four concepts that were one
 *
 * The brief asked for these to be separated, and the tests are grouped by them:
 *
 *   - **Purchase history** — what this account bought. Survives a handover.
 *   - **Current ownership** — what this account holds now.
 *   - **Transfer history** — how it got from one to the other.
 *   - **Admission authority** — what will actually open a door, which is
 *     narrower than all three: a refunded ticket is owned, bought and never
 *     transferred, and admits nobody.
 *
 * @module @desi-event/api/tests/ticket-wallet
 */

import { describe, expect, it } from 'vitest'

import { toOrder, toWalletTicket } from '../src/lib/presenters.js'
import { credentialDigest } from '../src/lib/ticket-credentials.js'
import { bearer, claim, createTestApp, signIn } from './helpers/app.js'

/** Whoever bought the tickets. */
const BUYER = 'priya@example.com'

/** Whoever is offered one. `ids.outsider`, who also owns another organisation. */
const RECIPIENT = 'rival@dhol.example'

/** An organiser of the event, holding `ticket:revoke`. */
const MANAGER = 'arun@rangoli.example'

/** A platform administrator: every capability, and still not the holder. */
const PLATFORM_ADMIN = 'ops@desi-event.example'

/**
 * A world with two paid tickets held by the buyer, and a capturing `deliver`.
 *
 * Bought through the real checkout and then claimed, which is what the other
 * ticket suites do: checkout leaves a guest purchase unowned, and a ticket with
 * no owner is deliberately untransferable.
 *
 * @returns {Promise<object>} The harness, the tickets, the order, and what was delivered.
 */
async function withWallet(options = {}) {
  const delivered = []
  const harness = await createTestApp({
    ...options,
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

  expect(response.statusCode, response.body).toBe(201)

  const order = response.json().data
  const tickets = order.tickets

  claim(prisma, tickets, ids.attendee.id)

  return { ...harness, delivered, tickets, order }
}

/**
 * Offer a ticket and recover the token the way a mail provider would.
 *
 * @param {object} world From {@link withWallet}.
 * @param {string} ticketId Which ticket.
 * @returns {Promise<string>} The token that went to the recipient.
 */
async function offer(world, ticketId) {
  const token = await signIn(world.app, BUYER)

  const response = await world.app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/transfers`,
    headers: bearer(token),
    payload: { toEmail: RECIPIENT },
  })

  expect(response.statusCode, response.body).toBe(201)

  return world.delivered.at(-1).token
}

/**
 * Offer a ticket and have the recipient accept it.
 *
 * @param {object} world From {@link withWallet}.
 * @param {string} ticketId Which ticket.
 * @returns {Promise<{newTicketId: string, credential: string}>} The minted ticket and its pass.
 */
async function handOver(world, ticketId) {
  const token = await offer(world, ticketId)
  const recipientToken = await signIn(world.app, RECIPIENT)

  const response = await world.app.inject({
    method: 'POST',
    url: '/v1/ticket-transfers/accept',
    headers: bearer(recipientToken),
    payload: { token },
  })

  expect(response.statusCode, response.body).toBe(200)

  const { data } = response.json()

  return { newTicketId: data.ticket.id, credential: data.credential }
}

describe('the order presenter and ownership', () => {
  it('demonstrates the defect this replaced', () => {
    // The exact shape `acceptTransfer` leaves behind: one order item carrying
    // the buyer's handed-on ticket and the recipient's new one, because a
    // transfer reuses `orderItemId`. The old presenter flattened this and
    // returned both. Restore `items.flatMap((item) => item.tickets ?? [])` in
    // `toOrder` and this test fails.
    const order = {
      id: 'ord_1',
      userId: 'usr_buyer',
      reference: 'DE-BUYER1',
      items: [
        {
          id: 'oi_1',
          tickets: [
            { id: 'tkt_old', ownerUserId: 'usr_buyer', status: 'TRANSFERRED', code: 'DE-OLD' },
            {
              id: 'tkt_theirs',
              ownerUserId: 'usr_recipient',
              status: 'VALID',
              code: 'DE-THEIRS',
              attendeeName: 'Rival Organiser',
            },
          ],
        },
      ],
    }

    const presented = toOrder(order)
    const ids = presented.tickets.map((ticket) => ticket.id)

    expect(ids).toEqual(['tkt_old'])
    expect(ids).not.toContain('tkt_theirs')
    // Not merely absent from the list — absent from the payload. A code or a
    // name surviving anywhere in it is the same leak by another route.
    expect(JSON.stringify(presented)).not.toContain('DE-THEIRS')
    expect(JSON.stringify(presented)).not.toContain('Rival Organiser')
  })

  it('keeps the buyer their own handed-on ticket, and says it is gone', () => {
    // The other half of the same rule. Dropping the buyer's transferred ticket
    // would erase a purchase they made, which is its own untruth.
    const presented = toOrder({
      id: 'ord_1',
      userId: 'usr_buyer',
      items: [
        {
          id: 'oi_1',
          tickets: [{ id: 'tkt_old', ownerUserId: 'usr_buyer', status: 'TRANSFERRED' }],
        },
      ],
    })

    expect(presented.tickets).toHaveLength(1)
    expect(presented.tickets[0].purchaserHolding).toBe('TRANSFERRED_AWAY')
  })

  it('does not call an ordinary ticket transferred away', () => {
    const presented = toOrder({
      id: 'ord_1',
      userId: 'usr_buyer',
      items: [{ id: 'oi_1', tickets: [{ id: 'tkt', ownerUserId: 'usr_buyer', status: 'VALID' }] }],
    })

    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
  })

  it('refuses a ticket row whose owner column was not selected', () => {
    // The shape that silently reopens the leak. `undefined` and `null` both
    // normalise to "nobody", so a partial select would read a stranger's ticket
    // as a guest's and pass the filter. The function takes plain objects and
    // cannot type-check them, so it asserts instead.
    expect(() =>
      toOrder({
        id: 'ord_1',
        userId: 'usr_buyer',
        items: [{ id: 'oi_1', tickets: [{ id: 'tkt', status: 'VALID' }] }],
      }),
    ).toThrow(/ownerUserId was selected/u)
  })

  it('refuses an order whose buyer column was not selected', () => {
    expect(() =>
      toOrder({
        id: 'ord_1',
        items: [{ id: 'oi_1', tickets: [{ id: 'tkt', ownerUserId: null, status: 'VALID' }] }],
      }),
    ).toThrow(/userId was selected/u)
  })

  it('keeps an unclaimed guest purchase on its own order', () => {
    // Nobody signed in, so neither column names anybody. The tickets are still
    // the order's, and a rule that read a missing owner as "somebody else"
    // would empty every guest order in the system.
    const presented = toOrder({
      id: 'ord_1',
      userId: null,
      items: [{ id: 'oi_1', tickets: [{ id: 'tkt', ownerUserId: null, status: 'VALID' }] }],
    })

    expect(presented.tickets.map((ticket) => ticket.id)).toEqual(['tkt'])
  })

  it('drops a ticket whose owner the order does not name', () => {
    // An earlier draft of this rule read "both owners known and they differ",
    // which is looser and leaves the leak open in exactly this shape: an order
    // with no buyer account matches anybody, so a ticket transferred to
    // somebody else stays on it. The strict comparison is what closes it, and
    // this is the case that tells the two rules apart.
    const presented = toOrder({
      id: 'ord_1',
      userId: null,
      items: [
        {
          id: 'oi_1',
          tickets: [{ id: 'tkt_theirs', ownerUserId: 'usr_recipient', status: 'VALID' }],
        },
      ],
    })

    expect(presented.tickets).toEqual([])
  })

  it('never carries a credential digest out of an order', () => {
    const presented = toOrder({
      id: 'ord_1',
      userId: 'usr_buyer',
      items: [
        {
          id: 'oi_1',
          tickets: [
            {
              id: 'tkt',
              ownerUserId: 'usr_buyer',
              status: 'VALID',
              credentialHash: 'a'.repeat(64),
              credentialVersion: 3,
            },
          ],
        },
      ],
    })

    expect(JSON.stringify(presented)).not.toContain('a'.repeat(64))
    expect(presented.tickets[0].credentialHash).toBeUndefined()
    expect(presented.tickets[0].ownerUserId).toBeUndefined()
  })

  it('keeps the recipient out of the buyer order end to end', async () => {
    const world = await withWallet()
    const { app, tickets, order } = world

    const { newTicketId } = await handOver(world, tickets[0].id)
    const buyerToken = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: bearer(buyerToken),
    })

    expect(response.statusCode, response.body).toBe(200)

    const ids = response.json().data.tickets.map((ticket) => ticket.id)

    expect(ids).toContain(tickets[0].id)
    expect(ids).toContain(tickets[1].id)
    expect(ids).not.toContain(newTicketId)

    await app.close()
  })

  it('keeps the recipient out of the organiser view of the same order', async () => {
    // An organiser holds `order:view`, which is the power to read the order
    // somebody placed — not a power over a ticket that has since become
    // somebody else's. Asking the same question from more authority must not
    // produce a wider answer.
    const world = await withWallet()
    const { app, tickets, order } = world

    const { newTicketId } = await handOver(world, tickets[0].id)
    const managerToken = await signIn(app, MANAGER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: bearer(managerToken),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.tickets.map((ticket) => ticket.id)).not.toContain(newTicketId)

    await app.close()
  })
})

describe('the ownership classification, state by state', () => {
  /**
   * An order carrying the rows a given lifecycle state leaves behind.
   *
   * @param {Array<object>} tickets The ticket rows on one order item.
   * @param {string|null} [userId] The order's buyer.
   * @returns {object} The presented order.
   */
  function order(tickets, userId = 'usr_buyer') {
    return toOrder({ id: 'ord_1', userId, items: [{ id: 'oi_1', tickets }] })
  }

  /** The buyer's ticket, before anything has happened to it. */
  const bought = { id: 'A', ownerUserId: 'usr_buyer', status: 'VALID', supersedesTicketId: null }

  it('1 — an outstanding invitation has not moved anything', () => {
    // `startTransfer` writes no ownership column: it moves the status and
    // creates a TicketTransfer row. The ticket still admits its holder.
    const presented = order([{ ...bought, status: 'TRANSFER_PENDING' }])

    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
  })

  it('2 — an accepted transfer is the state the owner columns cannot see', () => {
    // The whole reason this is derived from the status. `acceptTransfer` leaves
    // the old row's `ownerUserId` as the buyer and mints a new row for the
    // recipient, so `ownerUserId !== order.userId` is FALSE on a ticket that
    // has demonstrably been handed away.
    const old = { ...bought, status: 'TRANSFERRED' }
    const minted = {
      id: 'B',
      ownerUserId: 'usr_recipient',
      status: 'VALID',
      supersedesTicketId: 'A',
      code: 'DE-THEIRS',
    }

    const presented = order([old, minted])

    expect(old.ownerUserId).toBe('usr_buyer')
    expect(presented.tickets.map((row) => row.id)).toEqual(['A'])
    expect(presented.tickets[0].purchaserHolding).toBe('TRANSFERRED_AWAY')
    expect(JSON.stringify(presented)).not.toContain('DE-THEIRS')
  })

  it('3 — a declined invitation puts it back', () => {
    // `endTransfer` returns the ticket to VALID conditionally on it still being
    // TRANSFER_PENDING. Ownership columns were never touched.
    expect(order([bought]).tickets[0].purchaserHolding).toBe('HELD')
  })

  it('4 — a withdrawn invitation puts it back', () => {
    expect(order([bought]).tickets[0].purchaserHolding).toBe('HELD')
  })

  it('5 — a lapsed invitation leaves the ticket where it was', () => {
    // EXPIRED is unreachable: nothing writes it and no worker sweeps lapsed
    // invitations, so the ticket stays TRANSFER_PENDING and the holder's only
    // exit is to withdraw. Recorded here as the behaviour that exists rather
    // than the one the enum implies.
    const presented = order([{ ...bought, status: 'TRANSFER_PENDING' }])

    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
    expect(presented.tickets[0].status).toBe('TRANSFER_PENDING')
  })

  it('6 — handed out and handed back leaves three rows for one purchase', () => {
    // A: the buyer's original, given away. B: the recipient's, given back.
    // C: the buyer's replacement. Two of the three are the buyer's, against an
    // OrderItem.quantity of one, which is why `supersededByLaterTicket` exists.
    const presented = order([
      { ...bought, status: 'TRANSFERRED' },
      { id: 'B', ownerUserId: 'usr_recipient', status: 'TRANSFERRED', supersedesTicketId: 'A' },
      { id: 'C', ownerUserId: 'usr_buyer', status: 'VALID', supersedesTicketId: 'B' },
    ])

    expect(presented.tickets.map((row) => row.id)).toEqual(['A', 'C'])

    const byId = Object.fromEntries(presented.tickets.map((row) => [row.id, row]))

    expect(byId.A.purchaserHolding).toBe('TRANSFERRED_AWAY')
    expect(byId.A.supersededByLaterTicket).toBe(true)
    expect(byId.C.purchaserHolding).toBe('HELD')
    // The live one. A screen counting rows can count this one and be right.
    expect(byId.C.supersededByLaterTicket).toBe(false)
  })

  it('7 — revoking a ticket with an invitation outstanding does not transfer it', () => {
    // Revocation is about admission, not ownership. The buyer still owns the
    // row; it simply opens nothing.
    const presented = order([{ ...bought, status: 'REVOKED' }])

    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
  })

  it('8 — revoking after an accepted transfer touches the recipient row, not the buyer', () => {
    // The original cannot be revoked at all — TRANSFERRED is terminal in the
    // transition table and the database trigger refuses it independently — so
    // what gets revoked is the recipient's row, which is not the buyer's and is
    // not on this payload.
    const presented = order([
      { ...bought, status: 'TRANSFERRED' },
      { id: 'B', ownerUserId: 'usr_recipient', status: 'REVOKED', supersedesTicketId: 'A' },
    ])

    expect(presented.tickets.map((row) => row.id)).toEqual(['A'])
    expect(presented.tickets[0].purchaserHolding).toBe('TRANSFERRED_AWAY')
  })

  it('9 — a refund that lands on the recipient row stays off the buyer order', () => {
    // The refund allocator selects by order item and status and never reads
    // ownership, so settling the buyer's refund can flip the *recipient's*
    // ticket to REFUNDED. That row is still not the buyer's, and presenting it
    // to them would be the same leak wearing a different status.
    const presented = order([
      { ...bought, status: 'TRANSFERRED' },
      { id: 'B', ownerUserId: 'usr_recipient', status: 'REFUNDED', supersedesTicketId: 'A' },
    ])

    expect(presented.tickets.map((row) => row.id)).toEqual(['A'])
  })

  it('10 — a guest order keeps its own tickets', () => {
    // Both columns null, written together by checkout. The ticket is the
    // guest's, and `HELD` is the truthful answer.
    const presented = order(
      [{ id: 'G', ownerUserId: null, status: 'VALID', supersedesTicketId: null }],
      null,
    )

    expect(presented.tickets.map((row) => row.id)).toEqual(['G'])
    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
  })

  it('10b — a row whose purchaser relationship has gone keeps its ticket', () => {
    // Deleting a user sets `Order.userId` and `Ticket.ownerUserId` to null
    // together, both being `onDelete: SetNull` against the same account. The
    // order does not lose its history because the account went.
    const presented = order(
      [{ id: 'H', ownerUserId: null, status: 'CHECKED_IN', supersedesTicketId: null }],
      null,
    )

    expect(presented.tickets[0].purchaserHolding).toBe('HELD')
  })

  it('never answers this question from the owner columns', () => {
    // The falsification for the whole group. If `purchaserHolding` were
    // computed as `ownerUserId !== order.userId`, this ticket — handed away,
    // owner column untouched — would come back HELD.
    const presented = order([{ ...bought, status: 'TRANSFERRED' }])

    expect(presented.tickets[0].ownerUserId).toBeUndefined()
    expect(presented.tickets[0].purchaserHolding).toBe('TRANSFERRED_AWAY')
  })
})

describe('GET /v1/tickets — the wallet', () => {
  it('carries everything a row has to show', async () => {
    const { app, ids } = await withWallet()
    const token = await signIn(app, BUYER)

    const response = await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(token) })

    expect(response.statusCode, response.body).toBe(200)

    const [row] = response.json().data

    expect(row.event.id).toBe(ids.publishedEvent.id)
    expect(row.event.slug).toBe(ids.publishedEvent.slug)
    expect(row.event.title).toBe(ids.publishedEvent.title)
    expect(row.event.startsAt).toEqual(expect.any(String))
    expect(row.event.endsAt).toEqual(expect.any(String))
    expect(row.event.timezone).toEqual(expect.any(String))
    expect(row.venue.name).toBe(ids.venue.name)
    expect(row.tier).toEqual({ id: ids.generalAdmission.id, name: ids.generalAdmission.name })
    expect(row.status).toBe('VALID')
    expect(row.admits).toBe(true)
    expect(row.admissionRefusal).toBeNull()
    expect(row.code).toEqual(expect.any(String))

    await app.close()
  })

  it('carries no credential, no digest, no buyer email and no owner id', async () => {
    const { app } = await withWallet()
    const token = await signIn(app, BUYER)

    const response = await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(token) })
    const [row] = response.json().data

    expect(row.credentialHash).toBeUndefined()
    expect(row.credential).toBeUndefined()
    expect(row.credentialVersion).toBeUndefined()
    expect(row.ownerUserId).toBeUndefined()
    expect(response.body).not.toContain(BUYER)

    await app.close()
  })

  it('tells a bought ticket from a received one, and withholds the order reference', async () => {
    const world = await withWallet()
    const { app } = world

    const { newTicketId } = await handOver(world, world.tickets[0].id)

    const buyer = await signIn(app, BUYER)
    const buyerRows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(buyer) })
    ).json().data

    for (const row of buyerRows) {
      expect(row.holderRelationship).toBe('PURCHASED')
      expect(row.orderReference).toBe(world.order.reference)
    }

    const recipient = await signIn(app, RECIPIENT)
    const recipientRows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(recipient) })
    ).json().data
    const received = recipientRows.find((row) => row.id === newTicketId)

    expect(received.holderRelationship).toBe('RECEIVED')
    // The order behind a received ticket is the sender's. Naming it would hand
    // the recipient a reference to somebody else's purchase.
    expect(received.orderReference).toBeNull()
    expect(JSON.stringify(recipientRows)).not.toContain(world.order.reference)

    await app.close()
  })

  it('shows the sender their handed-on ticket as one that admits nobody', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    await handOver(world, tickets[0].id)

    const buyer = await signIn(app, BUYER)
    const rows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(buyer) })
    ).json().data
    const handedOn = rows.find((row) => row.id === tickets[0].id)

    expect(handedOn.status).toBe('TRANSFERRED')
    expect(handedOn.admits).toBe(false)
    expect(handedOn.admissionRefusal).toMatch(/handed to somebody else/i)

    await app.close()
  })

  it('names the outstanding invitation by its domain alone, and never its token', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    const token = await offer(world, tickets[0].id)

    const buyer = await signIn(app, BUYER)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: bearer(buyer),
    })
    const offered = response.json().data.find((row) => row.id === tickets[0].id)

    expect(offered.status).toBe('TRANSFER_PENDING')
    // An invitation is not a handover: the sender can still walk in.
    expect(offered.admits).toBe(true)
    // Four bullets and the domain: nothing of the local part, its length or
    // its ends, which the old `r***l@` form kept.
    expect(offered.pendingTransfer.toEmailMasked).toBe(
      `••••@${RECIPIENT.slice(RECIPIENT.indexOf('@') + 1)}`,
    )
    expect(response.body).not.toContain(RECIPIENT)
    expect(response.body).not.toContain(RECIPIENT.slice(0, RECIPIENT.indexOf('@')))
    expect(response.body).not.toContain(token)

    await app.close()
  })

  it('counts only the caller own tickets in the pagination total', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    await handOver(world, tickets[0].id)

    const recipient = await signIn(app, RECIPIENT)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets?page=1&perPage=50',
      headers: bearer(recipient),
    })

    const { data, pagination } = response.json()

    // One ticket, theirs. A total that counted the order's rows would say two
    // and tell the recipient how many the sender bought.
    expect(data).toHaveLength(1)
    expect(pagination.total).toBe(1)

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app } = await withWallet()

    expect((await app.inject({ method: 'GET', url: '/v1/tickets' })).statusCode).toBe(401)

    await app.close()
  })
})

describe('the wallet presenter', () => {
  /** A ticket row joined the way `WALLET_INCLUDE` joins one. */
  const joined = Object.freeze({
    id: 'tkt_1',
    orderItemId: 'oi_1',
    code: 'DE-ABCD-1234',
    attendeeName: 'Priya Sharma',
    status: 'VALID',
    checkedInAt: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    credentialHash: 'f'.repeat(64),
    credentialVersion: 2,
    credentialIssuedAt: new Date('2026-01-01T00:00:00.000Z'),
    ownerUserId: 'usr_buyer',
    supersedesTicketId: null,
    orderItem: {
      ticketType: { id: 'tt_1', name: 'General admission' },
      order: {
        userId: 'usr_buyer',
        reference: 'DE-BUYER1',
        status: 'PAID',
        event: {
          id: 'evt_1',
          slug: 'garba-night',
          title: 'Garba Night',
          startsAt: new Date('2026-10-01T14:00:00.000Z'),
          endsAt: new Date('2026-10-01T19:00:00.000Z'),
          timezone: 'Asia/Kolkata',
          status: 'ON_SALE',
          cancelledAt: null,
          isOnline: false,
          venue: { name: 'Hall', city: 'Pune', region: 'MH', country: 'IN' },
        },
      },
    },
    eventSeat: {
      seat: {
        label: '12',
        accessible: true,
        section: { name: 'Stalls' },
        row: { label: 'G' },
      },
    },
    transfers: [],
  })

  it('projects a reserved seat', () => {
    const row = toWalletTicket(joined, { viewerUserId: 'usr_buyer' })

    expect(row.seat).toEqual({ section: 'Stalls', row: 'G', label: '12', accessible: true })

    // The seat is the one shape the browser suites cannot reach without a
    // reserved-seating checkout, so it is pinned here instead of nowhere.
  })

  it('leaves the seat null for general admission', () => {
    const row = toWalletTicket({ ...joined, eventSeat: null }, { viewerUserId: 'usr_buyer' })

    expect(row.seat).toBeNull()
  })

  it('leaves the venue null for an online event', () => {
    const event = { ...joined.orderItem.order.event, venue: null, isOnline: true }
    const row = toWalletTicket(
      {
        ...joined,
        orderItem: { ...joined.orderItem, order: { ...joined.orderItem.order, event } },
      },
      { viewerUserId: 'usr_buyer' },
    )

    expect(row.venue).toBeNull()
    expect(row.isOnline).toBe(true)
  })

  it('drops every credential column', () => {
    const row = toWalletTicket(joined, { viewerUserId: 'usr_buyer' })

    expect(JSON.stringify(row)).not.toContain('f'.repeat(64))
    expect(row.credentialHash).toBeUndefined()
    expect(row.credentialVersion).toBeUndefined()
    expect(row.credentialIssuedAt).toBeUndefined()
    expect(row.ownerUserId).toBeUndefined()
  })

  it('refuses to call an unpaid order admissible', () => {
    const order = { ...joined.orderItem.order, status: 'PENDING' }
    const row = toWalletTicket(
      { ...joined, orderItem: { ...joined.orderItem, order } },
      { viewerUserId: 'usr_buyer' },
    )

    expect(row.admits).toBe(false)
    expect(row.admissionRefusal).toMatch(/not paid/i)
  })
})

describe('GET /v1/tickets/:id/pass', () => {
  it('gives the holder a pass that matches the stored digest', async () => {
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()
    const stored = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    // The point of the whole design: recomputed from the secret and the
    // version, never read back from a column, and provably the one the door
    // will accept.
    expect(credentialDigest(data.credential)).toBe(stored.credentialHash)
    expect(data.credentialVersion).toBe(stored.credentialVersion)

    await app.close()
  })

  it('is answerable twice with the same value', async () => {
    // Which is the feature. A credential handed over once left an attendee who
    // closed the tab with no way back to their own ticket.
    const { app, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const first = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })
    const second = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(first.json().data.credential).toBe(second.json().data.credential)

    await app.close()
  })

  it('forbids storing or caching it anywhere', async () => {
    const { app, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['cache-control']).toContain('private')

    await app.close()
  })

  it('writes an audit row that does not contain the credential', async () => {
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    const { credential } = response.json().data
    const rows = prisma._store.auditLog.filter((row) => row.action === 'ticket.pass_issued')

    expect(rows).toHaveLength(1)
    expect(rows[0].entityId).toBe(tickets[0].id)
    expect(JSON.stringify(rows[0])).not.toContain(credential)

    await app.close()
  })

  it('never puts a credential in the list response', async () => {
    const { app, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const pass = (
      await app.inject({
        method: 'GET',
        url: `/v1/tickets/${tickets[0].id}/pass`,
        headers: bearer(token),
      })
    ).json().data.credential

    const list = await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(token) })
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}`,
      headers: bearer(token),
    })

    expect(list.body).not.toContain(pass)
    expect(detail.body).not.toContain(pass)

    await app.close()
  })

  it('refuses the sender once the ticket has been handed on', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    const { newTicketId } = await handOver(world, tickets[0].id)
    const buyer = await signIn(app, BUYER)

    // Their own row: it exists, it is theirs, and it opens nothing.
    const old = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(buyer),
    })

    expect(old.statusCode).toBe(409)
    expect(old.json().error.message).toMatch(/handed to somebody else/i)

    // The recipient's row: not theirs, and answered as if it did not exist.
    const theirs = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${newTicketId}/pass`,
      headers: bearer(buyer),
    })

    expect(theirs.statusCode).toBe(404)

    await app.close()
  })

  it('gives the recipient a pass that is not the sender old one', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    const buyer = await signIn(app, BUYER)
    const before = (
      await app.inject({
        method: 'GET',
        url: `/v1/tickets/${tickets[0].id}/pass`,
        headers: bearer(buyer),
      })
    ).json().data.credential

    const { newTicketId, credential } = await handOver(world, tickets[0].id)
    const recipient = await signIn(app, RECIPIENT)

    const after = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${newTicketId}/pass`,
      headers: bearer(recipient),
    })

    expect(after.statusCode, after.body).toBe(200)
    expect(after.json().data.credential).toBe(credential)
    expect(after.json().data.credential).not.toBe(before)

    await app.close()
  })

  it('refuses a revoked ticket', async () => {
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).status = 'REVOKED'

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/withdrawn/i)

    await app.close()
  })

  it.each([
    ['REFUNDED', /refunded/i],
    ['CANCELLED', /cancelled/i],
    ['VOID', /void/i],
    ['SUPERSEDED', /replaced/i],
  ])('refuses a %s ticket', async (status, message) => {
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).status = status

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(message)

    await app.close()
  })

  it('refuses a ticket whose digest was cleared', async () => {
    // Unreachable through the status check, and guarded anyway: the thing on
    // the other side of that branch is a bearer secret.
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).credentialHash = null

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/no pass/i)

    await app.close()
  })

  it('refuses rather than hand over a credential the door would reject', async () => {
    // A version that drifted from its digest. Returning the derived string
    // would look like success and fail at the turnstile, where nobody can fix
    // it. This is what "server-validated" has to mean.
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).credentialVersion = 9

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/cannot be verified/i)

    await app.close()
  })

  it('refuses an anonymous caller before reading anything', async () => {
    const { app, tickets } = await withWallet()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('answers a stranger the way it answers a bad identifier', async () => {
    const { app, tickets } = await withWallet()
    const stranger = await signIn(app, RECIPIENT)

    const real = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(stranger),
    })
    const invented = await app.inject({
      method: 'GET',
      url: '/v1/tickets/ckzzzzzzzzzzzzzzzzzzzzzzz/pass',
      headers: bearer(stranger),
    })

    // Identical, on purpose. A 403 for one and a 404 for the other would turn
    // this endpoint into a way of asking whether a guessed id names a ticket.
    expect(real.statusCode).toBe(404)
    expect(invented.statusCode).toBe(404)
    expect(real.json().error.message).toBe(invented.json().error.message)

    await app.close()
  })

  it('answers a guest ticket the way it answers an invented id', async () => {
    // The oracle this route used to be. `assertHolds` — written for the
    // transfer routes, where it is right — checks for a missing owner FIRST and
    // throws a distinct 403 telling somebody to claim the ticket. On a transfer
    // route that is a helpful message; here it meant a guest ticket's id
    // answered differently from an id nobody had ever used, so anybody could
    // learn which identifiers named a real unclaimed ticket.
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).ownerUserId = null

    const guest = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })
    const invented = await app.inject({
      method: 'GET',
      url: '/v1/tickets/ckzzzzzzzzzzzzzzzzzzzzzzz/pass',
      headers: bearer(token),
    })

    expect(guest.statusCode).toBe(404)
    expect(invented.statusCode).toBe(404)
    expect(guest.json().error.message).toBe(invented.json().error.message)
    expect(guest.json().error.code).toBe(invented.json().error.code)
    // And specifically not the transfer helper's code, which is what leaked.
    expect(guest.body).not.toContain('TICKET_UNCLAIMED')
  })

  it('does not advise a remedy that does not exist', async () => {
    // Both refusals used to end "Ask the organiser to reissue it." There is no
    // reissue endpoint anywhere in the contract, so that was dead advice
    // pointing at a button nobody can press.
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    prisma._store.ticket.find((row) => row.id === tickets[0].id).credentialHash = null

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).not.toMatch(/reissue/iu)
  })

  it('refuses an organiser who can revoke the very same ticket', async () => {
    const { app, tickets } = await withWallet()
    const manager = await signIn(app, MANAGER)

    const pass = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(manager),
    })

    expect(pass.statusCode).toBe(404)

    // And the ticket itself is readable by them, which is the contrast: the
    // organiser may see what the ticket is and may withdraw it. Neither of
    // those is the power to be admitted on it.
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}`,
      headers: bearer(manager),
    })

    expect(detail.statusCode, detail.body).toBe(200)
    expect(detail.json().data.holder).toBe(false)

    await app.close()
  })

  it('refuses a platform administrator holding every capability', async () => {
    const { app, tickets } = await withWallet()
    const admin = await signIn(app, PLATFORM_ADMIN)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(admin),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('rations retrieval', async () => {
    const { app, tickets } = await withWallet({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, pass: { max: 2 } },
    })
    const token = await signIn(app, BUYER)

    /**
     * Ask for the pass once.
     *
     * @returns {Promise<object>} The reply.
     */
    const ask = () =>
      app.inject({
        method: 'GET',
        url: `/v1/tickets/${tickets[0].id}/pass`,
        headers: bearer(token),
      })

    expect((await ask()).statusCode).toBe(200)
    expect((await ask()).statusCode).toBe(200)
    expect((await ask()).statusCode).toBe(429)

    await app.close()
  })

  it('stays read-only under concurrent retrieval', async () => {
    const { app, prisma, tickets } = await withWallet()
    const token = await signIn(app, BUYER)

    const before = { ...prisma._store.ticket.find((row) => row.id === tickets[0].id) }

    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'GET',
          url: `/v1/tickets/${tickets[0].id}/pass`,
          headers: bearer(token),
        }),
      ),
    )

    expect(replies.every((reply) => reply.statusCode === 200)).toBe(true)
    expect(new Set(replies.map((reply) => reply.json().data.credential)).size).toBe(1)

    const after = prisma._store.ticket.find((row) => row.id === tickets[0].id)

    // Reading a pass must not rotate it. A version that moved under concurrent
    // reads would invalidate the pass somebody is holding up at the door.
    expect(after.credentialVersion).toBe(before.credentialVersion)
    expect(after.credentialHash).toBe(before.credentialHash)
    expect(after.status).toBe(before.status)

    await app.close()
  })
})

describe('transfer states and who holds what', () => {
  it('does not create a second admission while an invitation stands', async () => {
    const world = await withWallet()
    const { app, prisma, tickets } = world

    await offer(world, tickets[0].id)

    // One row, one holder. The invitation is a row of its own.
    const forTicket = prisma._store.ticket.filter(
      (row) =>
        row.orderItemId === prisma._store.ticket.find((t) => t.id === tickets[0].id).orderItemId,
    )

    expect(
      forTicket.filter((row) => row.status === 'VALID' || row.status === 'TRANSFER_PENDING'),
    ).toHaveLength(2)

    const recipient = await signIn(app, RECIPIENT)
    const rows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(recipient) })
    ).json().data

    // Nothing has moved. The recipient has been asked, not given.
    expect(rows).toHaveLength(0)

    await app.close()
  })

  it('leaves the sender holding it when the invitation is declined', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    const token = await offer(world, tickets[0].id)
    const recipient = await signIn(app, RECIPIENT)

    const declined = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/decline',
      headers: bearer(recipient),
      payload: { token },
    })

    expect(declined.statusCode, declined.body).toBe(200)

    const buyer = await signIn(app, BUYER)
    const rows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(buyer) })
    ).json().data
    const back = rows.find((row) => row.id === tickets[0].id)

    expect(back.status).toBe('VALID')
    expect(back.admits).toBe(true)
    expect(back.pendingTransfer).toBeNull()

    const pass = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tickets[0].id}/pass`,
      headers: bearer(buyer),
    })

    expect(pass.statusCode).toBe(200)

    await app.close()
  })

  it('leaves the sender holding it when they withdraw the invitation', async () => {
    const world = await withWallet()
    const { app, tickets } = world

    await offer(world, tickets[0].id)

    const buyer = await signIn(app, BUYER)
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/transfers/cancel`,
      headers: bearer(buyer),
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const rows = (
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: bearer(buyer) })
    ).json().data

    expect(rows.find((row) => row.id === tickets[0].id).status).toBe('VALID')

    await app.close()
  })

  it('refuses an organiser of another organisation', async () => {
    // The recipient account also owns `otherOrganization`. Owning one
    // organisation is not a power over another's tickets, and revocation is
    // the organisation-scoped operation to prove it on.
    const { app, tickets } = await withWallet()
    const outsider = await signIn(app, RECIPIENT)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${tickets[0].id}/revoke`,
      headers: bearer(outsider),
      payload: { reason: 'Not mine to withdraw' },
    })

    expect([403, 404]).toContain(response.statusCode)

    await app.close()
  })
})
