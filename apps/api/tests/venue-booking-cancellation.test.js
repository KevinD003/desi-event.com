/**
 * Cancelling unpaid pay-at-the-venue tickets (SPEC3-XI XU1–XU14, §2.2,
 * §14.2): `venueBookings.unpaid` and `venueBookings.cancel`, through the routes
 * against the stub database.
 *
 * Who may cancel and who is told nothing; the step-up before anything else;
 * the request's bounds; when it is allowed; which tickets can no longer be
 * cancelled; the replay; the order the rows are locked in; what it writes —
 * statuses, counts, sums, the kept share, the seat, the offer withdrawn, the
 * notices, the audit row — and what it never writes (a refund, a ledger
 * batch); whether the freed places are on sale; the list's two readings; the
 * door's refusal afterwards; and the referral use given back once the booking
 * has nothing left.
 *
 * The bookings are written here as settlement leaves them — a PAID order whose
 * total is the booking fee paid online, each ticket owing its share at the
 * door. What only PostgreSQL can prove (the races, the triggers) is in
 * `venue-booking-cancellation-integration.test.js`.
 */

import { describe, expect, it } from 'vitest'

import { EVENT_STATUSES } from '@desi-event/schemas'
import { LIVE_STATUSES } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { credentialDigest, mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  TEST_AUTH_SECRET,
  addRows,
  makeWorld,
  paymentTermsAccountsFixture,
  venueCancellationAccountsFixture,
} from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

const PREVIEW_URL = '/v1/tickets/admission/preview'
const CHECK_IN_URL = '/v1/tickets/check-in'

const OWNER = 'owner@rangoli.example'
const ORG_ADMIN = 'arjun-admin@rangoli.example'
const PLATFORM_ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const STAFF_ADMIN = 'sita-staff@desi-event.example'
const MEMBER_ORG_ADMIN = 'omar-orgadmin@desi-event.example'
const BUYER = 'priya@example.com'
const RECIPIENT = 'meera@example.com'
const SUPPORT = 'sunil-support@desi-event.example'
const DOOR = 'door@rangoli.example'

/** Every booking here: $40 a ticket at the door, $3 of booking fee each online. */
const CURRENCY = 'USD'
const PRICE = 4_000
const FEE = 300
const REASON = 'Not paid for before the doors opened.'

/**
 * An account to pass tickets on to, or a platform SUPPORT account.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {string} email Its address.
 * @param {string} displayName Its name.
 * @param {string} role Its platform role.
 * @returns {object} A `User` row.
 */
function account(ids, email, displayName, role) {
  const createdAt = new Date('2025-01-03T00:00:00.000Z')

  return {
    id: cuid(),
    email,
    passwordHash: ids.attendee.passwordHash,
    displayName,
    phone: null,
    locale: 'en-US',
    role,
    emailVerified: true,
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * One ticket row as settlement (or an accepted transfer) leaves it, with its
 * pass at version 1.
 *
 * @param {object} options What the ticket is.
 * @param {string} options.itemId Its order line.
 * @param {string|null} options.ownerUserId Who holds it.
 * @param {number} options.dueCents What it owes at the door.
 * @param {string} options.code Its printed code.
 * @param {Date} options.paidAt When it was issued.
 * @param {object} [options.extra] More of the row.
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
 * A paid booking of the world's attendee for the published event.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} [options] Options.
 * @param {number} [options.quantity] Tickets per line.
 * @param {Array<object>} [options.tiers] One line per tier.
 * @param {string} [options.method] `AT_VENUE` or `CARD`.
 * @param {number[]} [options.passedOn] Positions handed to `holder`.
 * @param {object|null} [options.holder] Who they went to.
 * @param {string} [options.reference] The reference.
 * @param {boolean} [options.waived] The fee waived by `referralCode` (a zero-online booking).
 * @param {object|null} [options.referralCode] The code that waived it.
 * @returns {object} `{ rows, order, items, tickets, credentials, predecessors }`.
 */
function booking(
  ids,
  {
    quantity = 2,
    tiers = [ids.generalAdmission],
    method = 'AT_VENUE',
    passedOn = [],
    holder = null,
    reference = 'DE-UNPAID01',
    waived = false,
    referralCode = null,
  } = {},
) {
  const paidAt = new Date('2026-09-01T12:00:00.000Z')
  const atVenue = method === 'AT_VENUE'
  const count = quantity * tiers.length
  const subtotal = PRICE * count
  const fees = waived ? 0 : FEE * count
  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: ids.publishedEvent.id,
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
    feeGrossCents: FEE * count,
    feeWaivedCents: waived ? FEE * count : 0,
    referralCodeId: referralCode?.id ?? null,
    referralUseReturnedAt: null,
    referralUseReturnCause: null,
    venueDueCents: atVenue ? subtotal : 0,
    venueCancelledBasisCents: 0,
    venueFeeKeptCents: 0,
  }
  const items = tiers.map((tier) => ({
    id: cuid(),
    orderId: order.id,
    ticketTypeId: tier.id,
    quantity,
    unitPriceCents: PRICE,
    subtotalCents: PRICE * quantity,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
    venueDueCents: atVenue ? PRICE * quantity : 0,
    venueCancelledQuantity: 0,
  }))
  const payment =
    order.totalCents > 0
      ? [
          {
            id: cuid(),
            orderId: order.id,
            provider: 'in-memory-payments',
            providerRef: `pi_${reference.toLowerCase().replace(/[^a-z0-9]/gu, '')}`,
            status: 'SUCCEEDED',
            amountCents: order.totalCents,
            currency: CURRENCY,
            createdAt: paidAt,
            updatedAt: paidAt,
          },
        ]
      : []
  const rows = []
  const tickets = []
  const credentials = []
  const predecessors = []
  let position = 0

  for (const item of items) {
    for (let index = 0; index < quantity; index += 1) {
      const issued = ticketRow({
        itemId: item.id,
        ownerUserId: ids.attendee.id,
        dueCents: atVenue ? PRICE : 0,
        code: `${reference}-${position + 1}`,
        paidAt,
      })

      if (passedOn.includes(position)) {
        const spent = { ...issued.row, status: 'TRANSFERRED', credentialHash: null }
        const successor = ticketRow({
          itemId: item.id,
          ownerUserId: holder.id,
          dueCents: issued.row.venueDueCents,
          code: `${reference}-${position + 1}B`,
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

      position += 1
    }
  }

  return {
    rows: { order: [order], orderItem: items, payment, ticket: rows },
    order,
    items,
    tickets,
    credentials,
    predecessors,
  }
}

/**
 * The world, every account the matrix needs, a recipient, and one booking.
 *
 * @param {object} [options] Options for {@link booking}, plus the hooks below.
 * @param {function(object): void} [options.world] Adjust the world before the booking is written.
 * @param {function(object, object): object} [options.extra] More rows, given the world and the booking.
 * @param {object} [options.rateLimit] Rate-limit overrides.
 * @returns {Promise<object>} The harness, the accounts, the recipient and the booking.
 */
async function withBooking({ world: adjust, extra, rateLimit, ...options } = {}) {
  const world = await makeWorld()
  const { ids } = world

  ids.generalAdmission.currency = CURRENCY

  if (adjust) adjust(world)

  const venueAccounts = venueCancellationAccountsFixture(ids)
  const termsAccounts = paymentTermsAccountsFixture(ids)
  const recipient = account(ids, RECIPIENT, 'Meera Shah', 'ATTENDEE')
  const support = account(ids, SUPPORT, 'Sunil Support', 'SUPPORT')
  const bought = booking(ids, { holder: recipient, ...options })

  // Settlement counted every place the booking bought.
  for (const item of bought.items) {
    const tier = world.seed.ticketType.find((row) => row.id === item.ticketTypeId)

    tier.quantitySold = (tier.quantitySold ?? 0) + item.quantity
  }

  addRows(world.seed, venueAccounts.rows)
  addRows(world.seed, termsAccounts.rows)
  addRows(world.seed, { user: [recipient, support] })
  addRows(world.seed, bought.rows)

  if (extra) addRows(world.seed, extra(world, bought))

  const harness = await createTestApp({
    seed: world.seed,
    ids,
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, ...rateLimit },
  })

  enrolForStepUp(harness, [DOOR, 'finance@rangoli.example', 'sam-scanner@rangoli.example', BUYER])

  // Every booking's payment, captured where the in-memory provider can see
  // it, so a refund of it can be sent.
  for (const payment of harness.prisma._store.payment) {
    if (payment.status !== 'SUCCEEDED') continue

    const intent = harness.providers.payments.createIntent({
      amountCents: payment.amountCents,
      currency: payment.currency,
      orderId: payment.orderId,
    })

    harness.providers.payments.capture(intent.id)
    payment.providerRef = intent.id
  }

  return { ...harness, recipient, booking: bought, venueAccounts, termsAccounts }
}

/**
 * Give accounts that hold no second factor one, so they can step up and be
 * refused by the handler rather than by the step-up guard.
 *
 * @param {object} harness From `createTestApp`.
 * @param {object} harness.app The application.
 * @param {object} harness.prisma The stub.
 * @param {string[]} emails The accounts.
 * @returns {void}
 */
function enrolForStepUp({ app, prisma }, emails) {
  const template = prisma._store.mfaFactor.find((factor) => factor.type === 'TOTP')

  for (const email of emails) {
    const user = prisma._store.user.find((row) => row.email === email)

    prisma._store.mfaFactor.push({ ...template, id: cuid(), userId: user.id })
    app.testEnrolledEmails.add(email)
  }
}

/**
 * Signed in, with a second factor given now.
 *
 * @param {object} app The application.
 * @param {string} email Who.
 * @returns {Promise<object>} The headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * POST a cancellation.
 *
 * @param {object} app The application.
 * @param {object} headers Who asks.
 * @param {string} reference The booking.
 * @param {object} payload The body.
 * @returns {Promise<object>} The response.
 */
function cancel(app, headers, reference, payload) {
  return app.inject({
    method: 'POST',
    url: `/v1/orders/${reference}/venue-cancellations`,
    headers,
    payload,
  })
}

/**
 * GET the event's bookings waiting to be paid at the door.
 *
 * @param {object} app The application.
 * @param {object} headers Who asks.
 * @param {string} eventId The event.
 * @param {string} [query] A query string, with its `?`.
 * @returns {Promise<object>} The response.
 */
function unpaid(app, headers, eventId, query = '') {
  return app.inject({
    method: 'GET',
    url: `/v1/events/${eventId}/venue-bookings${query}`,
    headers,
  })
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
 * A stored row by id.
 *
 * @param {object} prisma The stub.
 * @param {string} model The model.
 * @param {string} id Its id.
 * @returns {object} The row.
 */
function stored(prisma, model, id) {
  return rowsOf(prisma, model).find((row) => row.id === id)
}

/**
 * How many rows each model a cancellation could touch holds now.
 *
 * @param {object} prisma The stub.
 * @returns {object} Counts.
 */
function written(prisma) {
  return {
    cancellations: rowsOf(prisma, 'venueBookingCancellation').length,
    // Sign-ins and step-ups are audited too; only what a cancellation writes counts.
    audits: rowsOf(prisma, 'auditLog').filter((row) =>
      [AUDIT_ACTIONS.VENUE_BOOKING_CANCELLED, AUDIT_ACTIONS.REFERRAL_USE_RETURNED].includes(
        row.action,
      ),
    ).length,
    outbox: rowsOf(prisma, 'notificationOutbox').length,
    refunds: rowsOf(prisma, 'refund').length,
    batches: rowsOf(prisma, 'ledgerBatch').length,
    revoked: rowsOf(prisma, 'ticket').filter((row) => row.status === 'REVOKED').length,
  }
}

describe('who may cancel unpaid tickets (SPEC3-XI XU2)', () => {
  it('an OWNER, an organisation ADMIN, a platform ADMIN, a SUPER_ADMIN, and a platform ADMIN who is an organisation ADMIN', async () => {
    const cases = [
      { email: OWNER, authority: 'ORGANIZATION_ROLE', role: 'OWNER', by: 'ORGANISER' },
      { email: ORG_ADMIN, authority: 'ORGANIZATION_ROLE', role: 'ADMIN', by: 'ORGANISER' },
      { email: PLATFORM_ADMIN, authority: 'PLATFORM_ROLE', role: 'ADMIN', by: 'DESI_EVENT' },
      { email: SUPER_ADMIN, authority: 'PLATFORM_ROLE', role: 'SUPER_ADMIN', by: 'DESI_EVENT' },
      // Their own organisation's authority, never the platform's.
      { email: MEMBER_ORG_ADMIN, authority: 'ORGANIZATION_ROLE', role: 'ADMIN', by: 'ORGANISER' },
    ]

    for (const expected of cases) {
      const { app, prisma, booking: bought, ids } = await withBooking()
      const headers = await as(app, expected.email)

      const list = await unpaid(app, headers, ids.publishedEvent.id)

      expect(list.statusCode, `${expected.email} ${list.body}`).toBe(200)

      const response = await cancel(app, headers, bought.order.reference, {
        ticketIds: [bought.tickets[0].id],
        reason: REASON,
      })

      expect(response.statusCode, `${expected.email} ${response.body}`).toBe(200)
      expect(response.json().data.by, expected.email).toBe(expected.by)

      const [row] = rowsOf(prisma, 'venueBookingCancellation')

      expect(row, expected.email).toMatchObject({
        authority: expected.authority,
        role: expected.role,
        cancelledById: rowsOf(prisma, 'user').find((user) => user.email === expected.email).id,
      })

      await app.close()
    }
  })

  it('tells everybody else nothing: 404 from both routes after the step-up, and writes nothing', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking()
    const refused = [
      'farid-finance@rangoli.example', // organisation FINANCE: may ask for refunds, not decide
      'arun@rangoli.example', // MANAGER
      'esha-events@rangoli.example', // EVENT_MANAGER
      DOOR, // STAFF
      'finance@rangoli.example', // VIEWER
      'sam-scanner@rangoli.example', // SCANNER
      'farah-finance@desi-event.example', // FINANCE_ADMIN
      'maya@desi-event.example', // MODERATOR
      SUPPORT, // SUPPORT
      BUYER, // the buyer
    ]
    const before = written(prisma)

    for (const email of refused) {
      const headers = await as(app, email)
      const list = await unpaid(app, headers, ids.publishedEvent.id)
      const response = await cancel(app, headers, bought.order.reference, {
        ticketIds: [bought.tickets[0].id],
        reason: REASON,
      })

      expect(list.statusCode, `${email} ${list.body}`).toBe(404)
      expect(list.json().error.code, email).toBe('NOT_FOUND')
      expect(response.statusCode, `${email} ${response.body}`).toBe(404)
      expect(response.json().error.code, email).toBe('NOT_FOUND')
    }

    expect(written(prisma)).toEqual(before)

    await app.close()
  })

  it('refuses a platform ADMIN who is a STAFF member of the organisation: CONFLICT_OF_INTEREST, and 404 from the list', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking()
    const headers = await as(app, STAFF_ADMIN)
    const before = written(prisma)

    const response = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(403)
    expect(response.json().error.code).toBe('CONFLICT_OF_INTEREST')
    expect((await unpaid(app, headers, ids.publishedEvent.id)).statusCode).toBe(404)
    expect(written(prisma)).toEqual(before)

    await app.close()
  })
})

describe('a recent second factor first (SPEC3-XI §11.1)', () => {
  it('asks for one before answering anything, for a booking that exists and one that does not', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking()
    const headers = bearer(await signIn(app, OWNER))

    // The factor given at sign-in, moved back past both windows.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 16 * 60_000)
    }

    for (const response of [
      await cancel(app, headers, bought.order.reference, {
        ticketIds: [bought.tickets[0].id],
        reason: REASON,
      }),
      await cancel(app, headers, 'DE-NOSUCHONE', { ticketIds: [cuid()], reason: REASON }),
      await unpaid(app, headers, ids.publishedEvent.id),
      await unpaid(app, headers, cuid()),
    ]) {
      expect(response.statusCode, response.body).toBe(403)
      expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    }

    expect(rowsOf(prisma, 'venueBookingCancellation')).toHaveLength(0)

    await app.close()
  })
})

describe('the request (SPEC3-XI XU3, XU10)', () => {
  it('needs 1 to 100 distinct tickets and a reason of 10 to 500 characters', async () => {
    const { app, booking: bought } = await withBooking()
    const headers = await as(app, OWNER)
    const id = bought.tickets[0].id

    for (const body of [
      { ticketIds: [], reason: REASON },
      { ticketIds: Array.from({ length: 101 }, () => cuid()), reason: REASON },
      { ticketIds: [id, id], reason: REASON },
      { ticketIds: [id], reason: 'Too short' },
      { ticketIds: [id], reason: 'x'.repeat(501) },
      { ticketIds: [id] },
    ]) {
      const response = await cancel(app, headers, bought.order.reference, body)

      expect(response.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400)
    }

    // Ten characters, then five hundred, are enough.
    const ten = await cancel(app, headers, bought.order.reference, {
      ticketIds: [id],
      reason: 'Not paid..',
    })

    expect(ten.statusCode, ten.body).toBe(200)

    const fiveHundred = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[1].id],
      reason: 'y'.repeat(500),
    })

    expect(fiveHundred.statusCode, fiveHundred.body).toBe(200)

    await app.close()
  })

  it('answers NOT_A_VENUE_BOOKING for a card order', async () => {
    const { app, prisma, booking: bought } = await withBooking({ method: 'CARD' })
    const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('NOT_A_VENUE_BOOKING')
    expect(response.json().error.message).toBe(
      'This order was paid by card, so it has nothing to pay at the door.',
    )
    expect(rowsOf(prisma, 'venueBookingCancellation')).toHaveLength(0)

    await app.close()
  })

  it('answers TICKET_NOT_IN_BOOKING for a ticket of another booking, or one that does not exist', async () => {
    const {
      app,
      prisma,
      booking: bought,
      ids,
    } = await withBooking({
      extra: (world) => booking(world.ids, { reference: 'DE-UNPAID02', quantity: 1 }).rows,
    })
    const other = rowsOf(prisma, 'ticket').find((row) => row.code === 'DE-UNPAID02-1')
    const headers = await as(app, OWNER)

    for (const ticketIds of [[other.id], [bought.tickets[0].id, other.id], [cuid()]]) {
      const response = await cancel(app, headers, bought.order.reference, {
        ticketIds,
        reason: REASON,
      })

      expect(response.statusCode, response.body).toBe(422)
      expect(response.json().error.code).toBe('TICKET_NOT_IN_BOOKING')
    }

    expect(rowsOf(prisma, 'venueBookingCancellation')).toHaveLength(0)
    expect(ids.publishedEvent.id).toBeTruthy()

    await app.close()
  })
})

describe('when it is allowed (SPEC3-XI XU3, XU4)', () => {
  it('only while the event is live: every other status answers VENUE_CANCEL_NOT_LIVE', async () => {
    for (const status of EVENT_STATUSES) {
      const { app, prisma, booking: bought, ids } = await withBooking()

      stored(prisma, 'event', ids.publishedEvent.id).status = status

      const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
        ticketIds: [bought.tickets[0].id],
        reason: REASON,
      })

      if (LIVE_STATUSES.has(status)) {
        expect(response.statusCode, `${status} ${response.body}`).toBe(200)
      } else {
        expect(response.statusCode, `${status} ${response.body}`).toBe(409)
        expect(response.json().error.code, status).toBe('VENUE_CANCEL_NOT_LIVE')
        expect(rowsOf(prisma, 'venueBookingCancellation'), status).toHaveLength(0)
      }

      await app.close()
    }
  })

  /**
   * Cancel the booking's first ticket after `adjust` has moved the world on.
   *
   * @param {function(object, object): void} adjust Given the stub and the ids.
   * @param {object} [options] Options for {@link withBooking}.
   * @returns {Promise<object>} The response.
   */
  async function cancelAfter(adjust, options = {}) {
    const harness = await withBooking(options)

    adjust(harness.prisma, harness.ids)

    const response = await cancel(
      harness.app,
      await as(harness.app, OWNER),
      harness.booking.order.reference,
      { ticketIds: [harness.booking.tickets[0].id], reason: REASON },
    )

    await harness.app.close()

    return { response, prisma: harness.prisma }
  }

  const past = () => new Date(Date.now() - 60_000)

  /**
   * The published event's one night.
   *
   * @param {object} prisma The stub.
   * @param {object} ids The world's ids.
   * @returns {object} The night.
   */
  const nightOf = (prisma, ids) =>
    rowsOf(prisma, 'eventSession').find((row) => row.eventId === ids.publishedEvent.id)

  it('refuses VENUE_NIGHT_OVER once the ticket’s own night has ended', async () => {
    const { response } = await cancelAfter((prisma, ids) => {
      const night = nightOf(prisma, ids)

      stored(prisma, 'ticketType', ids.generalAdmission.id).eventSessionId = night.id
      night.endsAt = past()
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('VENUE_NIGHT_OVER')
  })

  it('refuses VENUE_NIGHT_OVER for a ticket of a cancelled night', async () => {
    const { response } = await cancelAfter((prisma, ids) => {
      const night = nightOf(prisma, ids)

      stored(prisma, 'ticketType', ids.generalAdmission.id).eventSessionId = night.id
      night.status = 'CANCELLED'
    })

    expect(response.json().error?.code, response.body).toBe('VENUE_NIGHT_OVER')
  })

  it('refuses VENUE_NIGHT_OVER for a ticket good for every night when no night is left', async () => {
    const { response } = await cancelAfter((prisma, ids) => {
      nightOf(prisma, ids).endsAt = past()
    })

    expect(response.json().error?.code, response.body).toBe('VENUE_NIGHT_OVER')
  })

  it('on an event with no nights, allows it before the event ends and refuses VENUE_NIGHT_OVER after', async () => {
    const without = (prisma, ids) => {
      prisma._store.eventSession = rowsOf(prisma, 'eventSession').filter(
        (row) => row.eventId !== ids.publishedEvent.id,
      )
    }

    const before = await cancelAfter(without)

    expect(before.response.statusCode, before.response.body).toBe(200)

    const after = await cancelAfter((prisma, ids) => {
      without(prisma, ids)
      stored(prisma, 'event', ids.publishedEvent.id).endsAt = past()
    })

    expect(after.response.statusCode, after.response.body).toBe(409)
    expect(after.response.json().error.code).toBe('VENUE_NIGHT_OVER')
    expect(rowsOf(after.prisma, 'venueBookingCancellation')).toHaveLength(0)
  })
})

describe('tickets that can no longer be cancelled (SPEC3-XI XU3, XU8, XU6)', () => {
  /**
   * Try to cancel both tickets after `adjust` changed the first.
   *
   * @param {function(object, object): void} adjust Given the stub and the booking.
   * @returns {Promise<object>} The response and the stub.
   */
  async function attempt(adjust) {
    const harness = await withBooking()

    adjust(harness.prisma, harness.booking, harness.ids)

    const before = written(harness.prisma)
    const response = await cancel(
      harness.app,
      await as(harness.app, OWNER),
      harness.booking.order.reference,
      { ticketIds: harness.booking.tickets.map((ticket) => ticket.id), reason: REASON },
    )

    await harness.app.close()

    return { response, before, after: written(harness.prisma), booking: harness.booking }
  }

  it('refuses the whole request, naming the ticket, when one was paid, let in, owes nothing, was passed on or was cancelled', async () => {
    const changes = {
      paid: (prisma, bought) =>
        Object.assign(stored(prisma, 'ticket', bought.tickets[0].id), {
          venuePaymentId: cuid(),
          status: 'CHECKED_IN',
        }),
      admitted: (prisma, bought) => {
        stored(prisma, 'ticket', bought.tickets[0].id).status = 'CHECKED_IN'
        prisma._store.checkIn.push({
          id: cuid(),
          ticketId: bought.tickets[0].id,
          eventSessionId: null,
          checkedInAt: new Date(),
        })
      },
      owesNothing: (prisma, bought) => {
        stored(prisma, 'ticket', bought.tickets[0].id).venueDueCents = 0
      },
      passedOn: (prisma, bought) => {
        stored(prisma, 'ticket', bought.tickets[0].id).status = 'TRANSFERRED'
      },
      cancelled: (prisma, bought) =>
        Object.assign(stored(prisma, 'ticket', bought.tickets[0].id), {
          status: 'REVOKED',
          venueCancellationId: cuid(),
        }),
    }

    for (const [name, change] of Object.entries(changes)) {
      const { response, before, after, booking: bought } = await attempt(change)

      expect(response.statusCode, `${name} ${response.body}`).toBe(409)
      expect(response.json().error.code, name).toBe('VENUE_BOOKING_CHANGED')
      expect(response.json().error.details, name).toEqual({ ticketIds: [bought.tickets[0].id] })
      // All or nothing: the other ticket was not cancelled either.
      expect(after, name).toEqual(before)
    }
  })

  it('refuses REFUND_IN_PROGRESS while a refund of the booking is being processed', async () => {
    const { response, before, after } = await attempt((prisma, bought) => {
      stored(prisma, 'order', bought.order.id).refundPendingCents = FEE
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('REFUND_IN_PROGRESS')
    expect(after).toEqual(before)
  })

  it('refuses VENUE_CANCEL_TAXED for a booking that carries tax on its booking fee', async () => {
    const { response, before, after } = await attempt((prisma, bought) => {
      const order = stored(prisma, 'order', bought.order.id)

      order.taxCents = 50
      order.totalCents += 50
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error).toMatchObject({
      code: 'VENUE_CANCEL_TAXED',
      message: 'This booking carries tax on its booking fee. Refund its tickets instead.',
    })
    expect(after).toEqual(before)
  })
})

describe('the same request again (SPEC3-XI XU10)', () => {
  it('answers the same tickets with their cancellation, replayed and writing nothing; an overlapping set is refused', async () => {
    const { app, prisma, booking: bought } = await withBooking({ quantity: 3 })
    const headers = await as(app, OWNER)
    const first = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id, bought.tickets[1].id],
      reason: REASON,
    })

    expect(first.statusCode, first.body).toBe(200)

    const before = written(prisma)
    const tier = { ...stored(prisma, 'ticketType', bought.items[0].ticketTypeId) }
    const again = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[1].id, bought.tickets[0].id],
      reason: 'Pressed twice at the same moment.',
    })

    expect(again.statusCode, again.body).toBe(200)
    expect(again.json().data).toEqual({ ...first.json().data, replayed: true })
    expect(written(prisma)).toEqual(before)
    expect(stored(prisma, 'ticketType', bought.items[0].ticketTypeId).quantitySold).toBe(
      tier.quantitySold,
    )

    const overlapping = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id, bought.tickets[2].id],
      reason: REASON,
    })

    expect(overlapping.statusCode, overlapping.body).toBe(409)
    expect(overlapping.json().error.code).toBe('VENUE_BOOKING_CHANGED')
    expect(overlapping.json().error.details).toEqual({ ticketIds: [bought.tickets[0].id] })
    expect(written(prisma)).toEqual(before)

    await app.close()
  })
})

describe('what a cancellation writes (SPEC3-XI XU1, XU5, XU6, XU7, §2.2)', () => {
  /**
   * A booking of two: the first ticket offered to the recipient (TRANSFER_PENDING,
   * an offer PENDING) and holding a reserved seat, the second standing.
   *
   * @returns {Promise<object>} The harness, the seat and the offer.
   */
  async function withOfferAndSeat() {
    const seatId = cuid()
    const offerId = cuid()
    const harness = await withBooking({
      extra: (world, bought) => {
        const night = world.seed.eventSession.find(
          (row) => row.eventId === world.ids.publishedEvent.id,
        )

        Object.assign(bought.tickets[0], { status: 'TRANSFER_PENDING', eventSeatId: seatId })

        return {
          eventSeat: [
            {
              id: seatId,
              eventSessionId: night.id,
              seatId: cuid(),
              status: 'SOLD',
              orderItemId: bought.items[0].id,
              holdId: null,
              createdAt: new Date('2026-09-01T12:00:00.000Z'),
              updatedAt: new Date('2026-09-01T12:00:00.000Z'),
            },
          ],
          ticketTransfer: [
            {
              id: offerId,
              ticketId: bought.tickets[0].id,
              fromUserId: world.ids.attendee.id,
              recipientEmail: RECIPIENT,
              status: 'PENDING',
              tokenDigest: 'digest-of-an-offer-nobody-accepted',
              expiresAt: new Date(Date.now() + 86_400_000),
              createdAt: new Date('2026-09-02T12:00:00.000Z'),
              updatedAt: new Date('2026-09-02T12:00:00.000Z'),
            },
          ],
        }
      },
    })

    return { ...harness, seatId, offerId }
  }

  it('withdraws the ticket, its pass, its offer and its seat; frees its place; keeps its share of the fee; refunds nothing', async () => {
    const { app, prisma, booking: bought, seatId, offerId } = await withOfferAndSeat()
    const tierId = bought.items[0].ticketTypeId
    const soldBefore = stored(prisma, 'ticketType', tierId).quantitySold
    const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const data = response.json().data
    const [row] = rowsOf(prisma, 'venueBookingCancellation')

    expect(data).toEqual({
      cancellationId: row.id,
      orderReference: bought.order.reference,
      ticketCount: 1,
      basisCents: PRICE,
      feeKeptCents: FEE,
      currency: CURRENCY,
      cancelledAt: row.createdAt.toISOString(),
      by: 'ORGANISER',
      byName: 'Meera Owner',
      reason: REASON,
      seatsReturned: 1,
      placesReturned: { [tierId]: 1 },
      placesOnSale: 'ALL',
      eventSalesStopped: false,
      replayed: false,
    })
    expect(row).toMatchObject({
      orderId: bought.order.id,
      ticketCount: 1,
      basisCents: PRICE,
      feeKeptCents: FEE,
      currency: CURRENCY,
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
      reason: REASON,
    })

    const ticket = stored(prisma, 'ticket', bought.tickets[0].id)

    expect(ticket).toMatchObject({
      status: 'REVOKED',
      revokedReason: `venue-unpaid:${row.id}`,
      venueCancellationId: row.id,
      credentialHash: null,
      credentialVersion: 2,
      venuePaymentId: null,
    })
    expect(stored(prisma, 'ticketTransfer', offerId)).toMatchObject({ status: 'CANCELLED' })
    expect(stored(prisma, 'eventSeat', seatId)).toMatchObject({
      status: 'AVAILABLE',
      orderItemId: null,
      holdId: null,
    })
    expect(stored(prisma, 'ticketType', tierId).quantitySold).toBe(soldBefore - 1)
    expect(stored(prisma, 'orderItem', bought.items[0].id).venueCancelledQuantity).toBe(1)
    expect(stored(prisma, 'order', bought.order.id)).toMatchObject({
      status: 'PAID',
      venueCancelledBasisCents: PRICE,
      venueFeeKeptCents: FEE,
      refundedCents: 0,
      refundPendingCents: 0,
    })
    // The other ticket stands, untouched.
    expect(stored(prisma, 'ticket', bought.tickets[1].id)).toMatchObject({
      status: 'VALID',
      venueCancellationId: null,
    })
    // Nothing refunded, nothing posted.
    expect(rowsOf(prisma, 'refund')).toHaveLength(0)
    expect(rowsOf(prisma, 'ledgerBatch')).toHaveLength(0)

    await app.close()
  })

  it('takes its locks in the one order: tiers, nights (KEY SHARE), the order, the lines, the tickets, then writes', async () => {
    const { app, prisma, booking: bought } = await withOfferAndSeat()
    const headers = await as(app, OWNER)
    const from = prisma.lockLog.length

    const response = await cancel(app, headers, bought.order.reference, {
      ticketIds: bought.tickets.map((ticket) => ticket.id),
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const log = prisma.lockLog.slice(from)
    const locks = log.filter((entry) => entry.kind === 'lock').map((entry) => entry.table)
    const firstWrite = log.findIndex((entry) => entry.kind === 'write')
    const lastLock = log.map((entry) => entry.kind).lastIndexOf('lock')

    expect(locks).toEqual(['TicketType', 'EventSession', 'Order', 'OrderItem', 'Ticket', 'Ticket'])
    expect(log.find((entry) => entry.table === 'EventSession').mode).toBe('KEY SHARE')
    expect(
      log.filter((entry) => entry.kind === 'lock' && entry.table !== 'EventSession'),
    ).toSatisfy((entries) => entries.every((entry) => entry.mode === 'UPDATE'))
    // The tickets in ascending id order; every lock before the first write.
    const ticketLocks = log
      .filter((entry) => entry.kind === 'lock' && entry.table === 'Ticket')
      .map((entry) => entry.id)

    expect(ticketLocks).toEqual([...ticketLocks].sort())
    expect(lastLock).toBeLessThan(firstWrite)

    await app.close()
  })

  it('takes the referral code last, after every order, line, ticket and seat write, when the booking has ended', async () => {
    const codeId = cuid()
    const {
      app,
      prisma,
      booking: bought,
    } = await withBooking({
      waived: true,
      referralCode: { id: codeId },
      extra: () => ({ referralCode: [referralCodeRow(codeId, 1)] }),
    })
    const from = prisma.lockLog.length

    const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: bought.tickets.map((ticket) => ticket.id),
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const log = prisma.lockLog.slice(from)
    const codeAt = log.findIndex((entry) => entry.table === 'ReferralCode')
    const lastRowWrite = log
      .map((entry) => ['Order', 'OrderItem', 'Ticket', 'EventSeat'].includes(entry.table))
      .lastIndexOf(true)

    expect(codeAt).toBeGreaterThan(-1)
    // The returner's re-lock of the order and its marker come before the code.
    expect(codeAt).toBeGreaterThan(lastRowWrite)
    expect(log.slice(codeAt).every((entry) => entry.table === 'ReferralCode')).toBe(true)

    await app.close()
  })

  it('says which freed places are on sale: ALL with the tier selling, NONE once its window ended, SOME for a mix', async () => {
    const all = await withBooking()
    const allResponse = await cancel(
      all.app,
      await as(all.app, OWNER),
      all.booking.order.reference,
      { ticketIds: [all.booking.tickets[0].id], reason: REASON },
    )

    expect(allResponse.json().data).toMatchObject({ placesOnSale: 'ALL', eventSalesStopped: false })
    await all.app.close()

    const none = await withBooking()

    stored(none.prisma, 'ticketType', none.ids.generalAdmission.id).salesEndAt = new Date(
      Date.now() - 60_000,
    )

    const noneResponse = await cancel(
      none.app,
      await as(none.app, OWNER),
      none.booking.order.reference,
      { ticketIds: [none.booking.tickets[0].id], reason: REASON },
    )

    expect(noneResponse.json().data).toMatchObject({ placesOnSale: 'NONE' })
    await none.app.close()

    // Two tiers on one booking: one selling, one closed.
    const twoTiers = await withTwoTiers()
    const someResponse = await cancel(
      twoTiers.app,
      await as(twoTiers.app, OWNER),
      twoTiers.booking.order.reference,
      { ticketIds: twoTiers.booking.tickets.map((ticket) => ticket.id), reason: REASON },
    )

    expect(someResponse.statusCode, someResponse.body).toBe(200)
    expect(someResponse.json().data).toMatchObject({
      placesOnSale: 'SOME',
      placesReturned: {
        [twoTiers.ids.generalAdmission.id]: 1,
        [twoTiers.ids.vip.id]: 1,
      },
    })
    await twoTiers.app.close()

    // An event whose sales the organiser paused: freed, not on sale, and said so.
    const paused = await withBooking()

    stored(paused.prisma, 'event', paused.ids.publishedEvent.id).status = 'SALES_PAUSED'

    const pausedResponse = await cancel(
      paused.app,
      await as(paused.app, OWNER),
      paused.booking.order.reference,
      { ticketIds: [paused.booking.tickets[0].id], reason: REASON },
    )

    expect(pausedResponse.json().data).toMatchObject({
      placesOnSale: 'NONE',
      eventSalesStopped: true,
    })
    await paused.app.close()
  })
})

/**
 * A booking with one ticket of the general-admission tier, which sells, and
 * one of the VIP tier, whose sales are closed.
 *
 * @returns {Promise<object>} The harness.
 */
async function withTwoTiers() {
  const world = await makeWorld()
  const { ids } = world

  ids.generalAdmission.currency = CURRENCY
  ids.vip.currency = CURRENCY
  ids.vip.status = 'CLOSED'

  const bought = booking(ids, { quantity: 1, tiers: [ids.generalAdmission, ids.vip] })

  for (const item of bought.items) {
    world.seed.ticketType.find((row) => row.id === item.ticketTypeId).quantitySold += 1
  }

  addRows(world.seed, bought.rows)

  const harness = await createTestApp({ seed: world.seed, ids })

  return { ...harness, booking: bought }
}

/**
 * A referral code row as the stub holds one.
 *
 * @param {string} id Its id.
 * @param {number} useCount Uses taken.
 * @returns {object} The row.
 */
function referralCodeRow(id, useCount) {
  const createdAt = new Date('2026-08-01T00:00:00.000Z')

  return {
    id,
    code: 'GARBA-FRIENDS-2026',
    label: 'Friends of the organiser',
    scope: 'ALL_EVENTS',
    expiresAt: null,
    maxUses: null,
    useCount,
    active: true,
    switchedOffAt: null,
    createdById: null,
    updatedById: null,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('who is told (SPEC3-XI XU11, §9.9)', () => {
  it('writes one notice to the buyer and one to each other holder, each saying only what is theirs', async () => {
    const {
      app,
      prisma,
      booking: bought,
      recipient,
    } = await withBooking({
      quantity: 3,
      passedOn: [1],
    })
    const response = await cancel(app, await as(app, PLATFORM_ADMIN), bought.order.reference, {
      ticketIds: [bought.tickets[0].id, bought.tickets[1].id],
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const [row] = rowsOf(prisma, 'venueBookingCancellation')
    const notices = rowsOf(prisma, 'notificationOutbox').filter(
      (notice) => notice.template === 'venue_booking.cancelled',
    )

    expect(notices).toHaveLength(2)

    const buyer = notices.find((notice) => notice.payload.recipient === 'BUYER')
    const holder = notices.find((notice) => notice.payload.recipient === 'HOLDER')

    expect(buyer).toMatchObject({
      recipient: BUYER,
      dedupeKey: `venue-booking-cancelled:${row.id}:buyer`,
      suppressible: false,
      organizationId: bought.order.eventId ? expect.any(String) : null,
    })
    expect(buyer.payload).toEqual({
      eventId: bought.order.eventId,
      eventTitle: expect.any(String),
      recipient: 'BUYER',
      orderReference: bought.order.reference,
      ticketCount: 2,
      dueCents: 2 * PRICE,
      feeKeptCents: 2 * FEE,
      currency: CURRENCY,
      reason: REASON,
      by: 'DESI_EVENT',
      othersRemain: true,
    })
    expect(holder).toMatchObject({
      recipient: RECIPIENT,
      userId: recipient.id,
      dedupeKey: `venue-booking-cancelled:${row.id}:holder:${recipient.id}`,
    })
    expect(holder.payload).toEqual({
      eventId: bought.order.eventId,
      eventTitle: expect.any(String),
      recipient: 'HOLDER',
      ticketCount: 1,
      dueCents: PRICE,
      currency: CURRENCY,
      reason: REASON,
      by: 'DESI_EVENT',
    })

    // No address, no code, and nothing about sales in any payload.
    for (const notice of notices) {
      const text = JSON.stringify(notice.payload)

      expect(text).not.toMatch(/@/u)
      expect(text).not.toMatch(/on ?sale|placesOnSale/iu)
      expect(text).not.toContain(bought.tickets[0].code)
    }

    await app.close()
  })

  it('tells the buyer that no other ticket remains when every one was cancelled', async () => {
    const { app, prisma, booking: bought } = await withBooking()
    const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: bought.tickets.map((ticket) => ticket.id),
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const [notice] = rowsOf(prisma, 'notificationOutbox').filter(
      (row) => row.template === 'venue_booking.cancelled',
    )

    expect(notice.payload).toMatchObject({ othersRemain: false, by: 'ORGANISER' })

    await app.close()
  })
})

describe('the record (SPEC3-XI §4.3)', () => {
  it('audits venue_booking.cancelled with exactly the metadata SPEC3-XI names', async () => {
    const { app, prisma, booking: bought, ids } = await withBooking({ quantity: 3 })
    const chosen = [bought.tickets[2].id, bought.tickets[0].id]
    const response = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: chosen,
      reason: REASON,
    })

    expect(response.statusCode, response.body).toBe(200)

    const [row] = rowsOf(prisma, 'venueBookingCancellation')
    const audits = rowsOf(prisma, 'auditLog').filter(
      (audit) => audit.action === AUDIT_ACTIONS.VENUE_BOOKING_CANCELLED,
    )

    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      entityType: 'VenueBookingCancellation',
      entityId: row.id,
      actorId: ids.owner.id,
    })
    expect(audits[0].metadata).toEqual({
      cancellationId: row.id,
      orderId: bought.order.id,
      eventId: ids.publishedEvent.id,
      organizationId: ids.organization.id,
      ticketIds: [...chosen].sort(),
      ticketCount: 2,
      basisCents: 2 * PRICE,
      feeKeptCents: 2 * FEE,
      currency: CURRENCY,
      seatsReturned: 0,
      placesReturned: { [ids.generalAdmission.id]: 2 },
      placesOnSale: 'ALL',
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
      reason: REASON,
      requestId: expect.any(String),
    })

    await app.close()
  })
})

describe('the list of bookings waiting to be paid at the door (SPEC3-XI §11.2)', () => {
  it('gives the organisation names and the Desi-Event team none', async () => {
    const {
      app,
      prisma,
      booking: bought,
      ids,
      recipient,
    } = await withBooking({
      quantity: 3,
      passedOn: [2],
      extra: (world) => ({
        ...booking(world.ids, { reference: 'DE-CARD0001', method: 'CARD', quantity: 1 }).rows,
      }),
    })

    stored(prisma, 'ticket', bought.tickets[0].id).attendeeName = 'Asha Patel'
    stored(prisma, 'ticket', bought.tickets[1].id).status = 'TRANSFER_PENDING'

    const organisation = await unpaid(app, await as(app, OWNER), ids.publishedEvent.id)

    expect(organisation.statusCode, organisation.body).toBe(200)

    const data = organisation.json().data

    expect(data).toMatchObject({
      eventId: ids.publishedEvent.id,
      eventTitle: ids.publishedEvent.title,
      currency: CURRENCY,
      pagination: { page: 1, total: 1 },
    })
    // The card order owes nothing at the door and is not listed.
    expect(data.bookings).toHaveLength(1)
    expect(data.bookings[0]).toMatchObject({
      orderReference: bought.order.reference,
      buyerName: bought.order.buyerName,
      feesCents: 3 * FEE,
      unpaidTickets: 3,
      unpaidCents: 3 * PRICE,
    })
    expect(data.bookings[0].tickets).toEqual([
      {
        ticketId: bought.tickets[0].id,
        label: 'Ticket 1 of 3',
        attendeeName: 'Asha Patel',
        nightLabel: null,
        everyNight: true,
        dueCents: PRICE,
        heldBy: 'BUYER',
        offerPending: false,
        cancellable: true,
        notCancellable: null,
      },
      {
        ticketId: bought.tickets[1].id,
        label: 'Ticket 2 of 3',
        attendeeName: null,
        nightLabel: null,
        everyNight: true,
        dueCents: PRICE,
        heldBy: 'BUYER',
        offerPending: true,
        cancellable: true,
        notCancellable: null,
      },
      {
        ticketId: bought.tickets[2].id,
        label: 'Ticket 3 of 3',
        attendeeName: recipient.displayName,
        nightLabel: null,
        everyNight: true,
        dueCents: PRICE,
        heldBy: 'SOMEONE_ELSE',
        offerPending: false,
        cancellable: true,
        notCancellable: null,
      },
    ])

    const platform = await unpaid(app, await as(app, PLATFORM_ADMIN), ids.publishedEvent.id)

    expect(platform.statusCode, platform.body).toBe(200)
    expect(platform.json().data.bookings[0].buyerName).toBeNull()

    for (const ticket of platform.json().data.bookings[0].tickets) {
      expect(ticket.attendeeName).toBeNull()
    }

    await app.close()
  })

  it('names one booking by its reference, leaves cancelled tickets out, and marks a ticket whose night is over', async () => {
    const {
      app,
      prisma,
      booking: bought,
      ids,
    } = await withBooking({
      extra: (world) => booking(world.ids, { reference: 'DE-UNPAID02', quantity: 1 }).rows,
    })
    const headers = await as(app, OWNER)

    const cancelled = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const one = await unpaid(
      app,
      headers,
      ids.publishedEvent.id,
      `?order=${bought.order.reference}`,
    )

    expect(one.statusCode, one.body).toBe(200)
    expect(one.json().data.bookings.map((row) => row.orderReference)).toEqual([
      bought.order.reference,
    ])
    expect(one.json().data.bookings[0].tickets.map((ticket) => ticket.ticketId)).toEqual([
      bought.tickets[1].id,
    ])

    rowsOf(prisma, 'eventSession').find((row) => row.eventId === ids.publishedEvent.id).endsAt =
      new Date(Date.now() - 60_000)

    const over = await unpaid(app, headers, ids.publishedEvent.id)

    expect(over.json().data.bookings).toHaveLength(2)

    for (const listed of over.json().data.bookings) {
      for (const ticket of listed.tickets) {
        expect(ticket).toMatchObject({ cancellable: false, notCancellable: 'NIGHT_OVER' })
      }
    }

    await app.close()
  })
})

describe('at the door afterwards (SPEC3-XI XU12)', () => {
  it('refuses UNPAID_CANCELLED by the printed code and after a preview made before, and knows no fresh scan of the old pass', async () => {
    const { app, booking: bought, ids } = await withBooking()
    const door = await signIn(app, DOOR)
    const presented = { credential: bought.credentials[0], expectedEventId: ids.publishedEvent.id }

    // Looked up before the cancellation, confirmed after it.
    const looked = await app.inject({
      method: 'POST',
      url: PREVIEW_URL,
      headers: bearer(door),
      payload: presented,
    })

    expect(looked.statusCode, looked.body).toBe(200)

    const cancelled = await cancel(app, await as(app, OWNER), bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const confirmed = await app.inject({
      method: 'POST',
      url: CHECK_IN_URL,
      headers: bearer(door),
      payload: {
        ...presented,
        previewReference: looked.json().data.previewReference,
        payment: { amountCents: PRICE },
      },
    })

    // A confirmation refuses as every confirmation does: 409, with the reason.
    expect(confirmed.statusCode, confirmed.body).toBe(409)
    expect(confirmed.json().error).toMatchObject({
      reason: 'UNPAID_CANCELLED',
      message: 'This ticket was cancelled because it was not paid for.',
    })

    const byCode = await app.inject({
      method: 'POST',
      url: PREVIEW_URL,
      headers: bearer(door),
      payload: { code: bought.tickets[0].code, expectedEventId: ids.publishedEvent.id },
    })

    expect(byCode.statusCode, byCode.body).toBe(200)
    expect(byCode.json().data).toMatchObject({ outcome: 'REFUSED', refusal: 'UNPAID_CANCELLED' })

    const fresh = await app.inject({
      method: 'POST',
      url: PREVIEW_URL,
      headers: bearer(door),
      payload: presented,
    })

    expect(fresh.statusCode, fresh.body).toBe(404)
    expect(fresh.json().error.message).toBe('No ticket with that pass.')

    await app.close()
  })
})

describe('the referral use (SPEC3-XI XR4)', () => {
  it('is kept while a ticket stands, and given back once when the last unpaid ticket is cancelled', async () => {
    const codeId = cuid()
    const {
      app,
      prisma,
      booking: bought,
    } = await withBooking({
      waived: true,
      referralCode: { id: codeId },
      extra: () => ({ referralCode: [referralCodeRow(codeId, 1)] }),
    })
    const headers = await as(app, OWNER)

    const first = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    expect(first.statusCode, first.body).toBe(200)
    expect(first.json().data.feeKeptCents).toBe(0)
    expect(stored(prisma, 'referralCode', codeId).useCount).toBe(1)
    expect(stored(prisma, 'order', bought.order.id).referralUseReturnedAt).toBeNull()

    const second = await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[1].id],
      reason: REASON,
    })

    expect(second.statusCode, second.body).toBe(200)
    expect(stored(prisma, 'referralCode', codeId).useCount).toBe(0)
    expect(stored(prisma, 'order', bought.order.id)).toMatchObject({
      status: 'PAID',
      referralUseReturnCause: 'VENUE_UNPAID_CANCELLED',
    })

    const returned = rowsOf(prisma, 'auditLog').filter(
      (audit) => audit.action === AUDIT_ACTIONS.REFERRAL_USE_RETURNED,
    )

    expect(returned).toHaveLength(1)
    expect(returned[0].metadata).toEqual({
      referralCodeId: codeId,
      orderId: bought.order.id,
      cause: 'VENUE_UNPAID_CANCELLED',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(returned[0].metadata)).not.toContain('GARBA-FRIENDS-2026')

    await app.close()
  })
})

describe('the budget (SPEC3-XI §4.4)', () => {
  it('draws every cancel from sixty an hour per person', async () => {
    const {
      app,
      booking: bought,
      ids,
    } = await withBooking({
      rateLimit: { venueCancel: { max: 1, timeWindow: '1 hour' } },
    })
    const headers = await as(app, OWNER)
    const body = { ticketIds: [bought.tickets[0].id], reason: REASON }

    expect((await cancel(app, headers, bought.order.reference, body)).statusCode).toBe(200)

    const second = await cancel(app, headers, bought.order.reference, body)

    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('RATE_LIMITED')
    expect((await unpaid(app, headers, ids.publishedEvent.id)).statusCode).toBe(200)

    await app.close()
  })
})

describe('refunds of a booking with a kept share (SPEC3-XI §10.2, XU14)', () => {
  it('never offers a cancelled ticket, refunds exactly the rest, and ends REFUNDED with the kept share counted', async () => {
    const { app, prisma, booking: bought } = await withBooking()
    const headers = await as(app, OWNER)

    await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    const summary = await app.inject({
      method: 'GET',
      url: `/v1/orders/${bought.order.reference}/refunds`,
      headers,
    })

    expect(summary.statusCode, summary.body).toBe(200)
    expect(summary.json().data).toMatchObject({ refundableCents: FEE })
    expect(summary.json().data.lines).toEqual([
      expect.objectContaining({
        orderItemId: bought.items[0].id,
        quantity: 2,
        refundedQuantity: 0,
        pendingQuantity: 0,
        cancelledQuantity: 1,
        refundableQuantity: 1,
      }),
    ])

    // Both tickets asked for: one of them is gone.
    const both = await app.inject({
      method: 'POST',
      url: `/v1/orders/${bought.order.reference}/refunds`,
      headers,
      payload: {
        lines: [{ orderItemId: bought.items[0].id, quantity: 2 }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'kept-share-both-tickets',
      },
    })

    expect(both.statusCode, both.body).toBe(422)

    const requested = await app.inject({
      method: 'POST',
      url: `/v1/orders/${bought.order.reference}/refunds`,
      headers,
      payload: {
        lines: [{ orderItemId: bought.items[0].id, quantity: 1 }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: 'kept-share-other-ticket',
      },
    })

    expect(requested.statusCode, requested.body).toBe(201)
    expect(requested.json().data.amountCents).toBe(FEE)

    const refundId = requested.json().data.id

    for (const step of ['approve', 'submit']) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/refunds/${refundId}/${step}`,
        headers,
        payload: { reason: 'The buyer asked for the rest back.' },
      })

      expect(response.statusCode, `${step} ${response.body}`).toBeLessThan(300)
    }

    // 300 refunded + 300 kept = the 600 paid online: refunded as far as it
    // ever will be, and no ticket stands.
    expect(stored(prisma, 'order', bought.order.id)).toMatchObject({
      status: 'REFUNDED',
      refundedCents: FEE,
      refundPendingCents: 0,
      venueFeeKeptCents: FEE,
    })
    expect(stored(prisma, 'ticket', bought.tickets[1].id).status).not.toBe('VALID')

    await app.close()
  })

  it('keeps the kept share out of the booking fee refunded by hand, and says there is none left once all is kept', async () => {
    const { app, booking: bought } = await withBooking()
    const owner = await as(app, OWNER)

    await cancel(app, owner, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    const admin = await as(app, PLATFORM_ADMIN)
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/platform/orders/${bought.order.reference}/fee`,
      headers: admin,
    })

    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().data).toMatchObject({
      feesCents: 2 * FEE,
      feeKeptCents: FEE,
      refundableFeeCents: FEE,
      feeRefundedCents: 0,
    })

    await cancel(app, owner, bought.order.reference, {
      ticketIds: [bought.tickets[1].id],
      reason: REASON,
    })

    const refused = await app.inject({
      method: 'POST',
      url: `/v1/platform/orders/${bought.order.reference}/fee-refund`,
      headers: admin,
      payload: { reason: 'The buyer asked for the fee back.', expectedRefundableCents: FEE },
    })

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'NO_FEE_TO_REFUND',
      message: 'There is no booking fee left to refund on this order.',
    })

    await app.close()
  })
})

describe('the counts afterwards (SPEC3-XI §9.10)', () => {
  it('counts a cancelled place once, as not sold, and a place sold again once, as sold', async () => {
    const {
      app,
      booking: bought,
      ids,
    } = await withBooking({
      extra: (world) => ({
        // The freed place, sold again to somebody paying by card.
        ...booking(world.ids, { reference: 'DE-RESOLD01', method: 'CARD', quantity: 1 }).rows,
      }),
    })
    const headers = await as(app, OWNER)

    await cancel(app, headers, bought.order.reference, {
      ticketIds: [bought.tickets[0].id],
      reason: REASON,
    })

    const summary = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=${CURRENCY}`,
      headers,
    })

    expect(summary.statusCode, summary.body).toBe(200)

    const tier = summary
      .json()
      .data.sales.byTicketType.find((group) => group.id === ids.generalAdmission.id)

    // Bought 2 + 1, one of the first two cancelled unpaid: 2 sold.
    expect(tier).toMatchObject({
      quantity: 2,
      lineValueCents: 2 * PRICE,
      refundedQuantity: 0,
      cancelledQuantity: 1,
    })
    expect(summary.json().data.venuePayments).toMatchObject({
      ticketsUnpaid: 1,
      unpaidCents: PRICE,
      cancelledUnpaidTickets: 1,
    })

    const csv = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=${CURRENCY}`,
      headers,
    })

    expect(csv.statusCode, csv.body).toBe(200)
    expect(csv.body).toContain('0 refunded, 1 cancelled unpaid')
    expect(csv.body).toContain(
      '1 unpaid ticket booked to pay at the venue was cancelled, and its place was freed.',
    )

    await app.close()
  })
})

describe('revoking tickets (SPEC3-XI §2.3.5, XR4)', () => {
  it('takes the order before the ticket, and gives a waived booking’s use back when its last ticket is withdrawn', async () => {
    const codeId = cuid()
    const {
      app,
      prisma,
      booking: bought,
    } = await withBooking({
      waived: true,
      referralCode: { id: codeId },
      extra: () => ({ referralCode: [referralCodeRow(codeId, 1)] }),
    })
    const token = await signIn(app, 'arun@rangoli.example')
    const revoke = (ticket) =>
      app.inject({
        method: 'POST',
        url: `/v1/tickets/${ticket.id}/revoke`,
        headers: bearer(token),
        payload: { reason: 'Duplicate booking, withdrawn by the organiser.' },
      })
    const from = prisma.lockLog.length

    expect((await revoke(bought.tickets[0])).statusCode).toBe(200)

    const first = prisma.lockLog.slice(from)
    const orderAt = first.findIndex((entry) => entry.table === 'Order' && entry.kind === 'lock')
    const ticketAt = first.findIndex((entry) => entry.table === 'Ticket')

    expect(orderAt).toBeGreaterThan(-1)
    expect(orderAt).toBeLessThan(ticketAt)
    // A ticket still stands: the use is kept.
    expect(stored(prisma, 'referralCode', codeId).useCount).toBe(1)

    expect((await revoke(bought.tickets[1])).statusCode).toBe(200)
    expect(stored(prisma, 'referralCode', codeId).useCount).toBe(0)
    expect(stored(prisma, 'order', bought.order.id)).toMatchObject({
      referralUseReturnCause: 'TICKETS_REVOKED',
    })

    await app.close()
  })
})
