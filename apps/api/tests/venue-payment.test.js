/**
 * Paying at the venue, after the order (SPEC3 §9.3–§9.10, SPEC3-XI Q7 and
 * XT7), through the routes against the stub database: what the door is told a
 * ticket owes, how a payment is taken with the admission, the group pass, a
 * ticket passed on while it still owes, the report of payments at the venue,
 * the counts, the organiser's balance and the notices.
 *
 * The bookings are written here as settlement leaves them — a PAID order whose
 * total is the booking fee paid online, each ticket owing its share at the
 * door — rather than through checkout, so these tests do not depend on it. What
 * only PostgreSQL can prove (the locks, the triggers, two stewards at once) is
 * in `venue-payment-integration.test.js`.
 */

import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { issueGroupPass } from '../src/lib/group-pass-credentials.js'
import { availableBalance } from '../src/lib/payouts.js'
import { credentialDigest, mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  TEST_AUTH_SECRET,
  addRows,
  makeWorld,
  paymentTermsAccountsFixture,
  threeNightEventFixture,
} from './helpers/fixtures.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

const PREVIEW_URL = '/v1/tickets/admission/preview'
const CHECK_IN_URL = '/v1/tickets/check-in'
const GROUP_PREVIEW_URL = '/v1/tickets/admission/group/preview'
const GROUP_CHECK_IN_URL = '/v1/tickets/admission/group/check-in'

const BUYER = 'priya@example.com'
const RECIPIENT = 'meera@example.com'
const DOOR = 'door@rangoli.example'
const OWNER = 'owner@rangoli.example'
const MANAGER = 'arun@rangoli.example'
const VIEWER = 'finance@rangoli.example'
const RIVAL = 'rival@dhol.example'
const MODERATOR = 'maya@desi-event.example'

/** Every booking here is in US dollars: $40 a ticket at the door, $3 of booking fee each online. */
const CURRENCY = 'USD'
const PRICE = 4_000
const FEE = 300

/**
 * An attendee account to pass tickets on to.
 *
 * @param {object} ids `makeWorld().ids`.
 * @returns {object} A `User` row.
 */
function recipientAccount(ids) {
  const createdAt = new Date('2025-01-03T00:00:00.000Z')

  return {
    id: cuid(),
    email: RECIPIENT,
    passwordHash: ids.attendee.passwordHash,
    displayName: 'Meera Shah',
    phone: null,
    locale: 'en-US',
    role: 'ATTENDEE',
    emailVerified: true,
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * One ticket row as settlement (or an accepted transfer) leaves it, with the
 * digest of its secure pass at version 1.
 *
 * @param {object} options What the ticket is.
 * @param {string} options.itemId The order line it belongs to.
 * @param {string} options.ownerUserId Who holds it.
 * @param {number} options.dueCents What is still owed at the door.
 * @param {string} options.code Its public code.
 * @param {Date} options.paidAt When the order was paid (and the pass issued).
 * @param {object} [options.extra] Columns to override.
 * @returns {{row: object, credential: string}} The row and its pass.
 */
function ticketRow({ itemId, ownerUserId, dueCents, code, paidAt, extra = {} }) {
  const id = cuid()
  const credential = mintTicketCredential({ secret: TEST_AUTH_SECRET, ticketId: id, version: 1 })

  return {
    credential,
    row: {
      id,
      orderItemId: itemId,
      code,
      credentialHash: credentialDigest(credential),
      credentialVersion: 1,
      credentialIssuedAt: paidAt,
      attendeeName: null,
      ownerUserId,
      eventSeatId: null,
      status: 'VALID',
      checkedInAt: null,
      revokedAt: null,
      revokedReason: null,
      supersedesTicketId: null,
      venueDueCents: dueCents,
      venuePaymentId: null,
      venueCancellationId: null,
      createdAt: paidAt,
      updatedAt: paidAt,
      ...extra,
    },
  }
}

/**
 * A paid booking of the world's attendee for the published event: by default
 * to pay at the venue (the ticket price owed at the door, the booking fee paid
 * online), or by card.
 *
 * `passedOn` names the positions of tickets the buyer handed to `holder`, as an
 * accepted transfer leaves them: the buyer's row TRANSFERRED, a successor held
 * by `holder` owing the same.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} [options] Options.
 * @param {number} [options.quantity] How many tickets.
 * @param {string} [options.method] `AT_VENUE` or `CARD`.
 * @param {number[]} [options.passedOn] Positions of tickets handed to `holder`.
 * @param {object|null} [options.holder] Who the handed-on tickets went to.
 * @param {string} [options.reference] The order's reference.
 * @param {object} [options.event] The event row.
 * @param {object} [options.tier] The ticket type row.
 * @param {Date} [options.paidAt] When the order was paid.
 * @returns {object} `{ rows, order, item, payment, tickets, credentials, predecessors }`.
 */
function booking(
  ids,
  {
    quantity = 2,
    method = 'AT_VENUE',
    passedOn = [],
    holder = null,
    reference = 'DE-VENUE01',
    event = ids.publishedEvent,
    tier = ids.generalAdmission,
    paidAt = new Date('2026-09-01T12:00:00.000Z'),
  } = {},
) {
  const atVenue = method === 'AT_VENUE'
  const subtotal = PRICE * quantity
  const fees = FEE * quantity
  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: event.id,
    eventSessionId: null,
    userId: ids.attendee.id,
    buyerEmail: ids.attendee.email,
    buyerName: ids.attendee.displayName,
    status: 'PAID',
    currency: CURRENCY,
    subtotalCents: subtotal,
    discountCents: 0,
    feesCents: fees,
    taxCents: 0,
    // Paid online: the booking fee, and on a card order the tickets too.
    totalCents: atVenue ? fees : subtotal + fees,
    promoCodeId: null,
    refundedCents: 0,
    refundPendingCents: 0,
    expiresAt: null,
    paidAt,
    cancelledAt: null,
    createdAt: paidAt,
    updatedAt: paidAt,
    paymentMethod: method,
    feeGrossCents: fees,
    venueDueCents: atVenue ? subtotal : 0,
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId: tier.id,
    quantity,
    unitPriceCents: PRICE,
    subtotalCents: subtotal,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
    venueDueCents: atVenue ? subtotal : 0,
    venueCancelledQuantity: 0,
  }
  const payment = {
    id: cuid(),
    orderId: order.id,
    provider: 'in-memory-payments',
    providerRef: `pi_${reference.toLowerCase().replace(/[^a-z0-9]/gu, '')}`,
    status: 'SUCCEEDED',
    amountCents: order.totalCents,
    currency: CURRENCY,
    createdAt: paidAt,
    updatedAt: paidAt,
  }
  const rows = []
  const tickets = []
  const credentials = []
  const predecessors = []

  for (let index = 0; index < quantity; index += 1) {
    const issued = ticketRow({
      itemId: item.id,
      ownerUserId: ids.attendee.id,
      dueCents: atVenue ? PRICE : 0,
      code: `${reference}-${index + 1}`,
      paidAt,
    })

    if (passedOn.includes(index)) {
      // Handed on: the buyer's row is spent, its pass cleared; the holder's
      // successor owes the same at the door.
      const spent = { ...issued.row, status: 'TRANSFERRED', credentialHash: null }
      const successor = ticketRow({
        itemId: item.id,
        ownerUserId: holder.id,
        dueCents: issued.row.venueDueCents,
        code: `${reference}-${index + 1}B`,
        paidAt: new Date(paidAt.getTime() + 60_000),
        extra: { supersedesTicketId: spent.id, attendeeName: holder.displayName },
      })

      rows.push(spent, successor.row)
      predecessors.push(spent)
      tickets.push(successor.row)
      credentials.push(successor.credential)
    } else {
      rows.push(issued.row)
      tickets.push(issued.row)
      credentials.push(issued.credential)
    }
  }

  return {
    rows: { order: [order], orderItem: [item], payment: [payment], ticket: rows },
    order,
    item,
    payment,
    tickets,
    credentials,
    predecessors,
  }
}

/**
 * The world, its staff accounts, a recipient, and one pay-at-the-venue booking.
 *
 * @param {object} [options] Options for {@link booking}, plus `extra(world)` rows.
 * @param {function(object, object): object} [options.extra] More rows, given the world and the booking.
 * @returns {Promise<object>} The harness, the accounts, the recipient and the booking.
 */
async function withBooking({ extra, ...options } = {}) {
  const world = await makeWorld()

  // The event sells in US dollars, as every booking here is.
  world.ids.generalAdmission.currency = CURRENCY

  const accounts = paymentTermsAccountsFixture(world.ids)
  const recipient = recipientAccount(world.ids)
  const bought = booking(world.ids, { holder: recipient, ...options })

  addRows(world.seed, accounts.rows)
  addRows(world.seed, { user: [recipient] })
  addRows(world.seed, bought.rows)

  if (extra) addRows(world.seed, extra(world, bought))

  const harness = await createTestApp({ seed: world.seed, ids: world.ids })

  return { ...harness, accounts, recipient, booking: bought }
}

/**
 * POST a door request.
 *
 * @param {object} app The application.
 * @param {string} url The route.
 * @param {string} token A bearer token.
 * @param {object} payload The body.
 * @returns {Promise<object>} The response.
 */
function door(app, url, token, payload) {
  return app.inject({ method: 'POST', url, headers: bearer(token), payload })
}

/**
 * Look a ticket up at the door and confirm it with `extra` in the body.
 *
 * @param {object} app The application.
 * @param {string} token The steward's token.
 * @param {string} credential The ticket's pass.
 * @param {object} [extra] More of the confirmation's body (`payment`).
 * @returns {Promise<{looked: object, confirmed: object}>} Both responses.
 */
async function lookAndConfirm(app, token, credential, extra = {}) {
  const looked = await door(app, PREVIEW_URL, token, { credential })

  expect(looked.statusCode, looked.body).toBe(200)

  const confirmed = await door(app, CHECK_IN_URL, token, {
    credential,
    previewReference: looked.json().data.previewReference,
    ...extra,
  })

  return { looked, confirmed }
}

/**
 * Rows of a model.
 *
 * @param {object} prisma The stub.
 * @param {string} model The model.
 * @returns {object[]} Its rows.
 */
function rowsOf(prisma, model) {
  return prisma._store[model] ?? []
}

/**
 * A stored ticket.
 *
 * @param {object} prisma The stub.
 * @param {string} id Its id.
 * @returns {object} The row.
 */
function storedTicket(prisma, id) {
  return rowsOf(prisma, 'ticket').find((row) => row.id === id)
}

describe('what the door is told a ticket owes (SPEC3 §9.3, SPEC3-XI §9.3)', () => {
  it('names the amount, and what else the same holder owes on the booking and whether their group pass covers it', async () => {
    const { app, booking: bought } = await withBooking({ quantity: 3, passedOn: [2] })
    const token = await signIn(app, DOOR)

    const buyers = await door(app, PREVIEW_URL, token, { credential: bought.credentials[0] })

    expect(buyers.statusCode, buyers.body).toBe(200)
    expect(buyers.json().data.outcome).toBe('ADMISSIBLE')
    // The buyer holds two tickets of the three: the other one is theirs to
    // pay too, and their group pass covers it. The one passed on is not
    // counted: its holder pays for it with their own ticket.
    expect(buyers.json().data.payment).toEqual({
      dueCents: PRICE,
      currency: CURRENCY,
      paid: false,
      booking: { otherUnpaidTickets: 1, otherUnpaidCents: PRICE, groupPass: true },
    })

    const holders = await door(app, PREVIEW_URL, token, { credential: bought.credentials[2] })

    expect(holders.statusCode, holders.body).toBe(200)
    expect(holders.json().data.payment).toEqual({
      dueCents: PRICE,
      currency: CURRENCY,
      paid: false,
      booking: { otherUnpaidTickets: 0, otherUnpaidCents: 0, groupPass: false },
    })

    // A lookup takes nothing and writes nothing.
    expect(rowsOf(app.testPrisma, 'venuePayment')).toHaveLength(0)

    await app.close()
  })

  it('says nothing about payment for a ticket paid by card', async () => {
    const { app, booking: bought } = await withBooking({ method: 'CARD' })
    const looked = await door(app, PREVIEW_URL, await signIn(app, DOOR), {
      credential: bought.credentials[0],
    })

    expect(looked.statusCode, looked.body).toBe(200)
    expect(looked.json().data.payment).toBeNull()

    await app.close()
  })

  it('says a ticket was paid at the door already, and lets it in without another payment', async () => {
    const {
      app,
      prisma,
      booking: bought,
      ids,
    } = await withBooking({
      quantity: 1,
      extra: (world, rows) => ({
        venuePayment: [
          {
            id: 'cvenuepaidalready0000001',
            orderId: rows.order.id,
            eventId: world.ids.publishedEvent.id,
            eventSessionId: null,
            organizationId: world.ids.organization.id,
            amountCents: PRICE,
            currency: CURRENCY,
            ticketCount: 1,
            via: 'DOOR_TICKET',
            authority: 'EVENT_SCOPE',
            role: 'STAFF',
            recordedById: world.ids.staff.id,
            recordedAt: new Date('2026-09-02T18:00:00.000Z'),
            gate: null,
          },
        ],
      }),
    })

    storedTicket(prisma, bought.tickets[0].id).venuePaymentId = 'cvenuepaidalready0000001'

    const { looked, confirmed } = await lookAndConfirm(
      app,
      await signIn(app, DOOR),
      bought.credentials[0],
    )

    expect(looked.json().data.payment).toEqual({ dueCents: PRICE, currency: CURRENCY, paid: true })
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json().data.outcome).toBe('ADMITTED')
    // Nothing taken now: the payment found is the one recorded before.
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(1)
    expect(ids.publishedEvent.id).toBe(rowsOf(prisma, 'venuePayment')[0].eventId)

    await app.close()
  })

  it('refuses a ticket cancelled because it was not paid for, with UNPAID_CANCELLED', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking({ quantity: 1 })
    const cancellation = {
      id: cuid(),
      orderId: bought.order.id,
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      ticketCount: 1,
      basisCents: PRICE,
      feeKeptCents: FEE,
      currency: CURRENCY,
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
      reason: 'Not paid for by the end of the booking window.',
      cancelledById: ids.owner.id,
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
    }

    prisma._store.venueBookingCancellation = [cancellation]
    Object.assign(storedTicket(prisma, bought.tickets[0].id), {
      status: 'REVOKED',
      revokedAt: cancellation.createdAt,
      revokedReason: `venue-unpaid:${cancellation.id}`,
      venueCancellationId: cancellation.id,
    })

    const looked = await door(app, PREVIEW_URL, await signIn(app, DOOR), {
      credential: bought.credentials[0],
    })

    expect(looked.statusCode, looked.body).toBe(200)
    expect(looked.json().data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'UNPAID_CANCELLED',
      // Nothing to take for a ticket that no longer stands.
      payment: null,
    })

    await app.close()
  })
})

describe('taking the payment with the admission (SPEC3 §9.3, §9.4)', () => {
  it('refuses a confirmation sent without the payment the ticket owes: PAYMENT_DUE, audited, nothing written', async () => {
    const { app, prisma, booking: bought } = await withBooking()
    const { confirmed } = await lookAndConfirm(app, await signIn(app, DOOR), bought.credentials[0])

    expect(confirmed.statusCode).toBe(409)
    expect(confirmed.json().error).toMatchObject({
      code: 'PAYMENT_DUE',
      details: {
        dueCents: PRICE,
        booking: { otherUnpaidTickets: 1, otherUnpaidCents: PRICE, groupPass: true },
      },
    })
    expect(confirmed.json().error.message).toContain('$40.00')

    // Refused, as a door refusal is: audited with its reason, nothing else.
    const refused = rowsOf(prisma, 'auditLog').filter(
      (row) =>
        row.action === AUDIT_ACTIONS.TICKET_ADMISSION_REFUSED &&
        row.entityId === bought.tickets[0].id,
    )

    expect(refused).toHaveLength(1)
    expect(refused[0].metadata).toMatchObject({ operation: 'check_in', reason: 'PAYMENT_DUE' })
    expect(rowsOf(prisma, 'checkIn')).toHaveLength(0)
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(0)
    expect(storedTicket(prisma, bought.tickets[0].id)).toMatchObject({
      status: 'VALID',
      venuePaymentId: null,
    })

    await app.close()
  })

  it('refuses an amount that is not what the ticket owes with 422, and writes nothing', async () => {
    const { app, prisma, booking: bought } = await withBooking()
    const { confirmed } = await lookAndConfirm(
      app,
      await signIn(app, DOOR),
      bought.credentials[0],
      {
        payment: { amountCents: PRICE - 1 },
      },
    )

    expect(confirmed.statusCode).toBe(422)
    expect(confirmed.json().error.code).toBe('PAYMENT_AMOUNT_MISMATCH')
    expect(confirmed.json().error.message).toContain('$40.00')
    expect(rowsOf(prisma, 'checkIn')).toHaveLength(0)
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(0)
    expect(storedTicket(prisma, bought.tickets[0].id).status).toBe('VALID')

    await app.close()
  })

  it('records the payment and the admission together for a scanner with a scope, once, and a retry finds them', async () => {
    const { app, prisma, accounts, booking: bought, ids } = await withBooking()
    const token = await signIn(app, accounts.scanner.email)
    const { looked, confirmed } = await lookAndConfirm(app, token, bought.credentials[0], {
      payment: { amountCents: PRICE },
      gate: 'North gate',
    })

    expect(confirmed.statusCode, confirmed.body).toBe(200)

    const payments = rowsOf(prisma, 'venuePayment')

    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({
      orderId: bought.order.id,
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      amountCents: PRICE,
      currency: CURRENCY,
      ticketCount: 1,
      via: 'DOOR_TICKET',
      authority: 'EVENT_SCOPE',
      role: 'SCANNER',
      recordedById: accounts.scanner.id,
      gate: 'North gate',
    })
    expect(confirmed.json().data).toMatchObject({
      outcome: 'ADMITTED',
      payment: { recordedCents: PRICE, venuePaymentId: payments[0].id, byThisRequest: true },
    })
    expect(storedTicket(prisma, bought.tickets[0].id)).toMatchObject({
      status: 'CHECKED_IN',
      venuePaymentId: payments[0].id,
    })
    // The other ticket of the booking still owes.
    expect(storedTicket(prisma, bought.tickets[1].id).venuePaymentId).toBeNull()

    // Audited with ids, the amount and the door's authority: never the buyer,
    // never a pass.
    const audit = rowsOf(prisma, 'auditLog').filter(
      (row) => row.action === AUDIT_ACTIONS.VENUE_PAYMENT_RECORDED,
    )

    expect(audit).toHaveLength(1)
    expect(Object.keys(audit[0].metadata).sort()).toEqual(
      [
        'amountCents',
        'authority',
        'currency',
        'eventId',
        'eventSessionId',
        'orderId',
        'organizationId',
        'role',
        'ticketCount',
        'venuePaymentId',
        'via',
      ].sort(),
    )
    expect(audit[0]).toMatchObject({ entityType: 'VenuePayment', actorId: accounts.scanner.id })

    const audits = JSON.stringify(rowsOf(prisma, 'auditLog'))

    expect(audits).not.toContain(BUYER)
    expect(audits).not.toContain(bought.credentials[0])

    // The same confirmation again, after a lost answer: in already, with the
    // payment recorded the first time, and nothing taken twice.
    const again = await door(app, CHECK_IN_URL, token, {
      credential: bought.credentials[0],
      previewReference: looked.json().data.previewReference,
      payment: { amountCents: PRICE },
      gate: 'North gate',
    })

    expect(again.statusCode, again.body).toBe(200)
    expect(again.json().data).toMatchObject({
      outcome: 'ALREADY_CHECKED_IN',
      payment: { recordedCents: PRICE, venuePaymentId: payments[0].id, byThisRequest: false },
    })
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(1)

    await app.close()
  })

  it('records an owner’s payment on the organisation’s authority', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking()
    const { confirmed } = await lookAndConfirm(
      app,
      await signIn(app, OWNER),
      bought.credentials[1],
      {
        payment: { amountCents: PRICE },
      },
    )

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(rowsOf(prisma, 'venuePayment')).toEqual([
      expect.objectContaining({
        authority: 'ORGANIZATION_ROLE',
        role: 'OWNER',
        recordedById: ids.owner.id,
        amountCents: PRICE,
        ticketCount: 1,
      }),
    ])

    await app.close()
  })

  it('ignores a payment sent for a ticket paid by card, and records nothing', async () => {
    const { app, prisma, booking: bought } = await withBooking({ method: 'CARD' })
    const { confirmed } = await lookAndConfirm(
      app,
      await signIn(app, DOOR),
      bought.credentials[0],
      {
        payment: { amountCents: PRICE },
      },
    )

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json().data).toMatchObject({ outcome: 'ADMITTED', payment: null })
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(0)

    await app.close()
  })
})

describe('the group pass at the door (SPEC3 §9.5, SPEC3-XI §9.5)', () => {
  /**
   * A booking of three, the third passed on, with the buyer's group pass.
   *
   * @returns {Promise<object>} The harness and the pass.
   */
  async function withGroup() {
    const issued = {}
    const harness = await withBooking({
      quantity: 3,
      passedOn: [2],
      extra: (world, rows) => {
        const id = cuid()

        Object.assign(issued, issueGroupPass({ secret: TEST_AUTH_SECRET, groupPassId: id }))

        return {
          groupPass: [
            {
              id,
              orderId: rows.order.id,
              credentialHash: issued.credentialHash,
              codeHash: issued.codeHash,
              credentialVersion: 1,
              credentialIssuedAt: new Date('2026-09-01T12:05:00.000Z'),
              rotatedAt: null,
              createdAt: new Date('2026-09-01T12:05:00.000Z'),
              updatedAt: new Date('2026-09-01T12:05:00.000Z'),
            },
          ],
        }
      },
    })

    return { ...harness, pass: issued }
  }

  it('says what the buyer’s tickets owe together and how many passed on still owe; the giver’s pass no longer covers the one handed on', async () => {
    const { app, booking: bought, pass } = await withGroup()
    const looked = await door(app, GROUP_PREVIEW_URL, await signIn(app, DOOR), {
      credential: pass.credential,
    })

    expect(looked.statusCode, looked.body).toBe(200)

    const { data } = looked.json()

    expect(data.tickets.map((ticket) => ticket.ticketId).sort()).toEqual(
      [bought.tickets[0].id, bought.tickets[1].id].sort(),
    )
    expect(data.tickets.map((ticket) => ticket.ticketId)).not.toContain(bought.tickets[2].id)
    expect(data.handedOn).toBe(1)
    expect(data.payment).toEqual({
      dueCents: 2 * PRICE,
      currency: CURRENCY,
      handedOnUnpaidTickets: 1,
    })

    await app.close()
  })

  it('takes one payment for exactly the tickets named, and refuses another amount', async () => {
    const { app, prisma, booking: bought, pass } = await withGroup()
    const token = await signIn(app, DOOR)
    const looked = await door(app, GROUP_PREVIEW_URL, token, { credential: pass.credential })
    const reference = looked.json().data.previewReference
    const named = [bought.tickets[0].id, bought.tickets[1].id]

    for (const paymentCents of [undefined, 2 * PRICE - 1, PRICE]) {
      const wrong = await door(app, GROUP_CHECK_IN_URL, token, {
        credential: pass.credential,
        previewReference: reference,
        ticketIds: named,
        ...(paymentCents === undefined ? {} : { paymentCents }),
      })

      expect(wrong.statusCode, String(paymentCents)).toBe(422)
      expect(wrong.json().error.code).toBe('PAYMENT_AMOUNT_MISMATCH')
    }

    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(0)
    expect(rowsOf(prisma, 'checkIn')).toHaveLength(0)

    const confirmed = await door(app, GROUP_CHECK_IN_URL, token, {
      credential: pass.credential,
      previewReference: reference,
      ticketIds: named,
      paymentCents: 2 * PRICE,
    })

    expect(confirmed.statusCode, confirmed.body).toBe(200)

    const payments = rowsOf(prisma, 'venuePayment')

    expect(payments).toEqual([
      expect.objectContaining({
        via: 'DOOR_GROUP',
        amountCents: 2 * PRICE,
        ticketCount: 2,
        authority: 'EVENT_SCOPE',
        role: 'STAFF',
      }),
    ])

    for (const id of named) {
      expect(storedTicket(prisma, id)).toMatchObject({
        status: 'CHECKED_IN',
        venuePaymentId: payments[0].id,
      })
    }

    // The ticket passed on is its holder's to pay, with their own ticket.
    expect(storedTicket(prisma, bought.tickets[2].id)).toMatchObject({
      status: 'VALID',
      venuePaymentId: null,
    })

    await app.close()
  })

  it('takes the payment of the one ticket named when only one of the group is let in', async () => {
    const { app, prisma, booking: bought, pass } = await withGroup()
    const token = await signIn(app, DOOR)
    const looked = await door(app, GROUP_PREVIEW_URL, token, { credential: pass.credential })
    const confirmed = await door(app, GROUP_CHECK_IN_URL, token, {
      credential: pass.credential,
      previewReference: looked.json().data.previewReference,
      ticketIds: [bought.tickets[1].id],
      paymentCents: PRICE,
    })

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(rowsOf(prisma, 'venuePayment')).toEqual([
      expect.objectContaining({ amountCents: PRICE, ticketCount: 1 }),
    ])
    expect(storedTicket(prisma, bought.tickets[0].id).venuePaymentId).toBeNull()

    await app.close()
  })
})

describe('a ticket passed on while it still owes at the door (SPEC3-XI Q7)', () => {
  /**
   * Offer a ticket and accept it as the recipient.
   *
   * @param {object} app The application.
   * @param {string} ticketId The ticket.
   * @returns {Promise<{offered: object, accepted: object}>} Both responses.
   */
  async function handOn(app, ticketId) {
    const offered = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/transfers`,
      headers: bearer(await signIn(app, BUYER)),
      payload: { toEmail: RECIPIENT },
    })

    expect(offered.statusCode, offered.body).toBe(201)

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: bearer(await signIn(app, RECIPIENT)),
      payload: { token: offered.json().data.delivery.invitationCode },
    })

    return { offered, accepted }
  }

  it('can be offered and accepted: the successor owes the same, nothing is paid, and its holder is the one who pays', async () => {
    const { app, prisma, recipient, booking: bought } = await withBooking()
    const { accepted } = await handOn(app, bought.tickets[0].id)

    expect(accepted.statusCode, accepted.body).toBe(200)

    // The answer carries what the new ticket owes at the door; the row says
    // the same, with no payment and the recipient as its holder.
    const successor = accepted.json().data.ticket

    expect(successor.venuePayment).toEqual({
      dueCents: PRICE,
      paid: false,
      currency: CURRENCY,
      cancelled: null,
      paidAtDoorByYou: false,
    })
    expect(storedTicket(prisma, successor.id)).toMatchObject({
      supersedesTicketId: bought.tickets[0].id,
      ownerUserId: recipient.id,
      venueDueCents: PRICE,
      venuePaymentId: null,
      status: 'VALID',
    })
    expect(storedTicket(prisma, bought.tickets[0].id).status).toBe('TRANSFERRED')
    expect(rowsOf(prisma, 'venuePayment')).toHaveLength(0)

    // The invitation said what the ticket still owes at the door.
    const invited = rowsOf(prisma, 'notificationOutbox').filter(
      (row) => row.template === 'ticket.transfer.invited',
    )

    expect(invited).toHaveLength(1)
    expect(invited[0].payload).toMatchObject({ venueDueCents: PRICE, currency: CURRENCY })

    // At the door the successor shows its due, and the giver's group pass
    // does not cover it.
    const looked = await door(app, PREVIEW_URL, await signIn(app, DOOR), {
      credential: accepted.json().data.credential,
    })

    expect(looked.statusCode, looked.body).toBe(200)
    expect(looked.json().data.payment).toEqual({
      dueCents: PRICE,
      currency: CURRENCY,
      paid: false,
      booking: { otherUnpaidTickets: 0, otherUnpaidCents: 0, groupPass: false },
    })

    await app.close()
  })

  it('carries a reserved seat and the due together', async () => {
    const seatId = cuid()
    const {
      app,
      prisma,
      recipient,
      booking: bought,
    } = await withBooking({
      quantity: 1,
      extra: (world, rows) => ({
        eventSeat: [
          {
            id: seatId,
            eventSessionId: world.seed.eventSession.find(
              (night) => night.eventId === world.ids.publishedEvent.id,
            ).id,
            seatId: cuid(),
            ticketTypeId: world.ids.generalAdmission.id,
            status: 'SOLD',
            holdId: null,
            orderItemId: rows.item.id,
            priceCentsOverride: null,
            blockedReason: null,
            updatedAt: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
      }),
    })

    storedTicket(prisma, bought.tickets[0].id).eventSeatId = seatId

    const { accepted } = await handOn(app, bought.tickets[0].id)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data.ticket.venuePayment).toMatchObject({ dueCents: PRICE, paid: false })
    expect(storedTicket(prisma, accepted.json().data.ticket.id)).toMatchObject({
      eventSeatId: seatId,
      venueDueCents: PRICE,
      venuePaymentId: null,
      ownerUserId: recipient.id,
    })
    // The giver's row keeps the seat as history only.
    expect(storedTicket(prisma, bought.tickets[0].id)).toMatchObject({
      eventSeatId: seatId,
      status: 'TRANSFERRED',
    })

    await app.close()
  })

  it('cannot be offered once it was paid and let in: ALREADY_ADMITTED, even for a pass good for nights still to come', async () => {
    const world = await makeWorld()
    const nights = threeNightEventFixture(world.ids)

    for (const tier of [...nights.tiers, nights.pass]) tier.currency = CURRENCY

    const pass = booking(world.ids, {
      event: nights.event,
      tier: nights.pass,
      reference: 'DE-PASSVENUE',
      quantity: 1,
    })

    addRows(world.seed, nights.rows)
    addRows(world.seed, pass.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const night = { eventSessionId: nights.nights[0].id }

    // The steward's scope covers the published event only: the owner admits.
    const owner = await signIn(app, OWNER)
    const looked = await door(app, PREVIEW_URL, owner, {
      credential: pass.credentials[0],
      ...night,
    })

    expect(looked.statusCode, looked.body).toBe(200)

    const confirmed = await door(app, CHECK_IN_URL, owner, {
      credential: pass.credentials[0],
      previewReference: looked.json().data.previewReference,
      payment: { amountCents: PRICE },
      ...night,
    })

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    // Good for the other nights, so it stays VALID; its admission says it was used.
    expect(storedTicket(prisma, pass.tickets[0].id)).toMatchObject({ status: 'VALID' })

    const offered = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${pass.tickets[0].id}/transfers`,
      headers: bearer(await signIn(app, BUYER)),
      payload: { toEmail: RECIPIENT },
    })

    expect(offered.statusCode).toBe(409)
    expect(offered.json().error.details ?? offered.json().error).toMatchObject({
      reason: 'ALREADY_ADMITTED',
    })

    await app.close()
  })
})

describe('the report of payments at the venue (SPEC3 §9.8)', () => {
  /**
   * A booking of three: one paid at the door by the buyer, one passed on and
   * unpaid, one the buyer's and unpaid.
   *
   * @returns {Promise<object>} The harness.
   */
  async function withReport() {
    const harness = await withBooking({ quantity: 3, passedOn: [2] })
    const { confirmed } = await lookAndConfirm(
      harness.app,
      await signIn(harness.app, DOOR),
      harness.booking.credentials[0],
      { payment: { amountCents: PRICE } },
    )

    expect(confirmed.statusCode, confirmed.body).toBe(200)

    return harness
  }

  /**
   * Read the report.
   *
   * @param {object} app The application.
   * @param {string} eventId The event.
   * @param {string} email Who reads it.
   * @param {object} [options] Options.
   * @param {boolean} [options.stepped] Whether to step up first.
   * @returns {Promise<object>} The response.
   */
  async function report(app, eventId, email, { stepped = true } = {}) {
    const headers = bearer(await signIn(app, email))

    if (stepped) await stepUp(app, email, headers)

    return app.inject({ method: 'GET', url: `/v1/events/${eventId}/venue-payments`, headers })
  }

  it('gives the organisation’s finance readers the figures, the payments and the unpaid bookings, with no addresses', async () => {
    const { app, ids, accounts, booking: bought } = await withReport()
    const response = await report(app, ids.publishedEvent.id, accounts.organizationFinance.email)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')

    const { data } = response.json()

    expect(data.currency).toBe(CURRENCY)
    expect(data.summary).toMatchObject({
      unpaidTickets: 2,
      unpaidCents: 2 * PRICE,
      paidAtDoorTickets: 1,
      paidAtDoorCents: PRICE,
      payments: 1,
      eventEnded: false,
      notPaidByEndTickets: 0,
      notPaidByEndCents: 0,
      paidOnRefundedCents: 0,
      cancelledUnpaidTickets: 0,
      cancelledUnpaidCents: 0,
      feeKeptCents: 0,
    })
    expect(data.payments).toEqual([
      expect.objectContaining({
        orderReference: bought.order.reference,
        ticketCount: 1,
        amountCents: PRICE,
        via: 'DOOR_TICKET',
        recordedByName: 'Door Staff',
        tickets: [expect.objectContaining({ ticketId: bought.tickets[0].id, amountCents: PRICE })],
      }),
    ])
    // The passed-on ticket counts with the buyer's: the booking is waiting
    // for two payments.
    expect(data.unpaidOrders).toEqual([
      {
        orderReference: bought.order.reference,
        buyerName: ids.attendee.displayName,
        unpaidTickets: 2,
        unpaidCents: 2 * PRICE,
      },
    ])
    expect(data.canCancelUnpaid).toBe(false)
    expect(response.body).not.toContain(BUYER)
    expect(response.body).not.toContain(RECIPIENT)

    await app.close()
  })

  it('is read by the owner, who may also cancel unpaid tickets, and by platform finance', async () => {
    const { app, ids, accounts } = await withReport()
    const owner = await report(app, ids.publishedEvent.id, OWNER)

    expect(owner.statusCode, owner.body).toBe(200)
    expect(owner.json().data.canCancelUnpaid).toBe(true)

    const platform = await report(app, ids.publishedEvent.id, accounts.financeAdministrator.email)

    expect(platform.statusCode, platform.body).toBe(200)
    expect(platform.json().data.summary.paidAtDoorCents).toBe(PRICE)

    await app.close()
  })

  it('answers 404 to everybody without finance:view, as for an event that does not exist', async () => {
    const { app, ids, accounts } = await withReport()
    const unknown = await report(app, cuid(), OWNER)

    expect(unknown.statusCode).toBe(404)

    for (const email of [DOOR, MANAGER, VIEWER, RIVAL, MODERATOR, accounts.scanner.email]) {
      // An account with a second factor confirms it and is then told the
      // event does not exist; one without is stopped at the second factor
      // first. Neither learns anything about the event.
      const enrolled = app.testEnrolledEmails.has(email)
      const refused = await report(app, ids.publishedEvent.id, email, { stepped: enrolled })

      if (enrolled) {
        expect(refused.statusCode, email).toBe(404)
        expect(refused.json().error.message, email).toBe(unknown.json().error.message)
      } else {
        expect(refused.statusCode, email).toBe(403)
        expect(refused.json().error.code, email).toBe('STEP_UP_REQUIRED')
      }
    }

    await app.close()
  })

  it('asks for a second factor within the FINANCE_VIEW window first', async () => {
    const { app, prisma, ids } = await withReport()
    const headers = bearer(await signIn(app, OWNER))

    // The second factor given at sign-in, aged past the window.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60_000)
    }

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/venue-payments`,
      headers,
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })
})

describe('what counts as paid, and what the organiser is told (SPEC3 §9.10)', () => {
  /**
   * The funnel's "Orders paid".
   *
   * @param {object} funnel The analytics funnel.
   * @returns {number} Its count.
   */
  const ordersPaid = (funnel) => funnel.steps.find((step) => step.key === 'ordersPaid').count

  /**
   * The organiser's analytics for the published event.
   *
   * @param {object} app The application.
   * @param {object} ids The world's ids.
   * @returns {Promise<object>} The response.
   */
  async function analytics(app, ids) {
    const headers = bearer(await signIn(app, OWNER))

    await stepUp(app, OWNER, headers)

    return app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=${CURRENCY}&eventId=${ids.publishedEvent.id}`,
      headers,
    })
  }

  it('counts a booking waiting for its door payment as booked, not paid, and the door money outside the ledger figures', async () => {
    const { app, ids } = await withBooking({ paidAt: new Date() })
    const before = await analytics(app, ids)

    expect(before.statusCode, before.body).toBe(200)
    expect(ordersPaid(before.json().data.funnel)).toBe(0)
    // The traffic report's "Orders paid" counts the same way.
    expect(before.json().data.traffic.conversion.ordersPaid).toBe(0)
    expect(before.json().data.funnel.atVenue).toEqual({ bookedUnpaid: 1 })
    expect(before.json().data.venuePayments).toEqual({
      ticketsUnpaid: 2,
      unpaidCents: 2 * PRICE,
      paidAtDoorCents: 0,
      cancelledUnpaidTickets: 0,
    })

    await app.close()
  })

  it('counts it paid once every standing ticket was paid at the door', async () => {
    const { app, ids, booking: bought } = await withBooking({ paidAt: new Date() })
    const token = await signIn(app, DOOR)

    for (const credential of bought.credentials) {
      const { confirmed } = await lookAndConfirm(app, token, credential, {
        payment: { amountCents: PRICE },
      })

      expect(confirmed.statusCode, confirmed.body).toBe(200)
    }

    const after = await analytics(app, ids)

    expect(after.statusCode, after.body).toBe(200)
    expect(ordersPaid(after.json().data.funnel)).toBe(1)
    expect(after.json().data.traffic.conversion.ordersPaid).toBe(1)
    expect(after.json().data.funnel.atVenue).toEqual({ bookedUnpaid: 0 })
    expect(after.json().data.venuePayments).toMatchObject({
      ticketsUnpaid: 0,
      unpaidCents: 0,
      paidAtDoorCents: 2 * PRICE,
    })

    await app.close()
  })

  it('leaves the administrators’ events list counting every PAID order (SPEC3 §7.3)', async () => {
    const { app } = await withBooking()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))
    const response = await app.inject({ method: 'GET', url: '/v1/platform/events', headers })

    expect(response.statusCode, response.body).toBe(200)

    const row = response.json().data.find((entry) => entry.title === 'Navratri Garba Night')

    // A PAID order is a booking there, paid at the door yet or not.
    expect(row).toMatchObject({ paidOrders: 1 })

    await app.close()
  })
})

describe('the organiser’s balance (SPEC3 §9.8, §10.1)', () => {
  /**
   * A stub holding one organisation's orders, refunds and disputes.
   *
   * @param {object} rows Rows keyed by model.
   * @returns {Promise<object>} `{ prisma, ids }`.
   */
  async function balanceWorld(rows) {
    const world = await makeWorld()

    addRows(world.seed, rows(world.ids))

    return { prisma: createPrismaStub(world.seed), ids: world.ids }
  }

  /**
   * An order row of the published event.
   *
   * @param {object} ids The world's ids.
   * @param {object} overrides Columns.
   * @returns {object} The row.
   */
  function orderOf(ids, overrides) {
    return {
      ...booking(ids, { reference: `DE-${cuid().slice(-6).toUpperCase()}` }).order,
      ...overrides,
    }
  }

  it('holds nothing back for a pay-at-the-venue order’s refund, a booking-fee refund, or a dispute of a booking fee', async () => {
    const venue = { id: cuid() }
    const card = { id: cuid() }
    const { prisma, ids } = await balanceWorld((worldIds) => {
      const atVenueOrder = orderOf(worldIds, { id: venue.id, refundPendingCents: 2 * FEE })
      const cardOrder = orderOf(worldIds, {
        id: card.id,
        paymentMethod: 'CARD',
        venueDueCents: 0,
        totalCents: 2 * PRICE + 2 * FEE,
        refundPendingCents: 2 * FEE,
      })
      const venuePaymentId = cuid()

      return {
        order: [atVenueOrder, cardOrder],
        payment: [
          {
            id: venuePaymentId,
            orderId: venue.id,
            provider: 'in-memory-payments',
            providerRef: 'pi_venue_balance',
            status: 'SUCCEEDED',
            amountCents: 2 * FEE,
            currency: CURRENCY,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        refund: [
          // The booking fee of a card order, refunded on its own and on its
          // way: money of The Desi Events, not the organiser's.
          {
            id: cuid(),
            orderId: card.id,
            paymentId: null,
            amountCents: 2 * FEE,
            currency: CURRENCY,
            reason: 'BOOKING_FEE',
            status: 'APPROVED',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        dispute: [
          {
            id: cuid(),
            paymentId: venuePaymentId,
            amountCents: 2 * FEE,
            currency: CURRENCY,
            status: 'NEEDS_RESPONSE',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }
    })

    const balance = await availableBalance(prisma, {
      organizationId: ids.organization.id,
      currency: CURRENCY,
    })

    expect(balance).toMatchObject({
      refundLiabilityCents: 0,
      disputeLiabilityCents: 0,
      availableCents: balance.payableCents - balance.inFlightCents,
    })
  })

  it('still holds back a card order’s ticket refund and its dispute', async () => {
    const card = { id: cuid() }
    const { prisma, ids } = await balanceWorld((worldIds) => {
      const paymentId = cuid()

      return {
        order: [
          orderOf(worldIds, {
            id: card.id,
            paymentMethod: 'CARD',
            venueDueCents: 0,
            totalCents: 2 * PRICE + 2 * FEE,
            refundPendingCents: PRICE + FEE,
          }),
        ],
        payment: [
          {
            id: paymentId,
            orderId: card.id,
            provider: 'in-memory-payments',
            providerRef: 'pi_card_balance',
            status: 'SUCCEEDED',
            amountCents: 2 * PRICE + 2 * FEE,
            currency: CURRENCY,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        dispute: [
          {
            id: cuid(),
            paymentId,
            amountCents: 500,
            currency: CURRENCY,
            status: 'NEEDS_RESPONSE',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }
    })

    const balance = await availableBalance(prisma, {
      organizationId: ids.organization.id,
      currency: CURRENCY,
    })

    expect(balance.refundLiabilityCents).toBe(PRICE + FEE)
    expect(balance.disputeLiabilityCents).toBe(500)
  })
})

describe('notices and previews when a booking paid at the venue is called off (SPEC3 §9.7, §9.9, SPEC3-XI XT7)', () => {
  it('tells the buyer what was refunded online and what others paid at the door, and the holder who paid what they paid', async () => {
    // Three tickets: the buyer's two unpaid, one passed on and paid at the
    // door by its holder.
    const {
      app,
      prisma,
      recipient,
      booking: bought,
      ids,
    } = await withBooking({
      quantity: 3,
      passedOn: [2],
    })
    const { confirmed } = await lookAndConfirm(
      app,
      await signIn(app, DOOR),
      bought.credentials[2],
      {
        payment: { amountCents: PRICE },
      },
    )

    expect(confirmed.statusCode, confirmed.body).toBe(200)

    const headers = bearer(await signIn(app, OWNER))

    await stepUp(app, OWNER, headers)

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The hall flooded.' },
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const notices = rowsOf(prisma, 'notificationOutbox').filter(
      (row) => row.template === 'event.cancelled',
    )
    const buyers = notices.filter((row) => row.recipient === BUYER)
    const holders = notices.filter((row) => row.recipient === RECIPIENT)

    expect(buyers).toHaveLength(1)
    expect(buyers[0].payload).toMatchObject({
      atVenue: true,
      onlineRefund: 'REQUESTED',
      paidAtDoorCents: 0,
      paidAtDoorByOthersCents: PRICE,
      currency: CURRENCY,
    })
    expect(holders).toHaveLength(1)
    expect(holders[0]).toMatchObject({
      userId: recipient.id,
      dedupeKey: `event.cancelled:${ids.publishedEvent.id}:${bought.order.id}:holder:${recipient.id}`,
      suppressible: false,
    })
    expect(holders[0].payload).toEqual({
      eventId: ids.publishedEvent.id,
      eventTitle: ids.publishedEvent.title,
      recipient: 'HOLDER',
      paidAtDoorCents: PRICE,
      currency: CURRENCY,
    })

    // Only the booking fee goes back online: the order's total.
    const refunds = rowsOf(prisma, 'refund').filter((row) => row.orderId === bought.order.id)

    expect(refunds).toHaveLength(1)
    expect(refunds[0].amountCents).toBe(3 * FEE)

    await app.close()
  })

  it('counts the bookings paid at the venue in the deletion and night-cancellation previews', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking({ quantity: 2 })
    const { confirmed } = await lookAndConfirm(
      app,
      await signIn(app, DOOR),
      bought.credentials[0],
      {
        payment: { amountCents: PRICE },
      },
    )

    expect(confirmed.statusCode, confirmed.body).toBe(200)

    const headers = bearer(await signIn(app, OWNER))
    const deletion = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/deletion`,
      headers,
    })

    expect(deletion.statusCode, deletion.body).toBe(200)
    expect(deletion.json().data.atVenue).toEqual({
      orders: 1,
      ticketsPaidAtDoor: 1,
      paidAtDoorCents: PRICE,
    })

    // On a one-night event the ticket is good for every night: cancelling
    // that night (which is refused, being the last) touches no booking's
    // money, and the preview says so.
    const night = rowsOf(prisma, 'eventSession').find(
      (row) => row.eventId === ids.publishedEvent.id,
    )
    const onlyNight = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/sessions/${night.id}/cancellation`,
      headers,
    })

    expect(onlyNight.statusCode, onlyNight.body).toBe(200)
    expect(onlyNight.json().data.atVenue).toEqual({
      orders: 0,
      ticketsPaidAtDoor: 0,
      paidAtDoorCents: 0,
    })

    await app.close()
  })

  it('counts a night’s bookings paid at the venue in that night’s cancellation preview, and not another night’s', async () => {
    const world = await makeWorld()
    const nights = threeNightEventFixture(world.ids)

    for (const tier of [...nights.tiers, nights.pass]) tier.currency = CURRENCY

    const first = booking(world.ids, {
      event: nights.event,
      tier: nights.tiers[0],
      reference: 'DE-NIGHT1V',
      quantity: 2,
    })

    addRows(world.seed, nights.rows)
    addRows(world.seed, first.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    // One of the two paid at the door already.
    const paymentId = cuid()

    prisma._store.venuePayment = [
      {
        id: paymentId,
        orderId: first.order.id,
        eventId: nights.event.id,
        eventSessionId: nights.nights[0].id,
        organizationId: world.ids.organization.id,
        amountCents: PRICE,
        currency: CURRENCY,
        ticketCount: 1,
        via: 'DOOR_TICKET',
        authority: 'ORGANIZATION_ROLE',
        role: 'OWNER',
        recordedById: world.ids.owner.id,
        recordedAt: new Date(),
        gate: null,
      },
    ]
    storedTicket(prisma, first.tickets[0].id).venuePaymentId = paymentId

    const headers = bearer(await signIn(app, OWNER))
    const preview = (night) =>
      app.inject({
        method: 'GET',
        url: `/v1/events/${nights.event.id}/sessions/${night.id}/cancellation`,
        headers,
      })

    const firstNight = await preview(nights.nights[0])

    expect(firstNight.statusCode, firstNight.body).toBe(200)
    expect(firstNight.json().data.atVenue).toEqual({
      orders: 1,
      ticketsPaidAtDoor: 1,
      paidAtDoorCents: PRICE,
    })

    const secondNight = await preview(nights.nights[1])

    expect(secondNight.statusCode, secondNight.body).toBe(200)
    expect(secondNight.json().data.atVenue).toEqual({
      orders: 0,
      ticketsPaidAtDoor: 0,
      paidAtDoorCents: 0,
    })

    await app.close()
  })
})
