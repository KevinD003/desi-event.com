/**
 * Paying at the venue after the order, against real PostgreSQL (SPEC3 §14.3,
 * SPEC3-XI §14.3, tests 1–16).
 *
 * The door records the payment and the admission in one transaction, taking
 * its locks in SPEC3-XI §2's one order: the night `FOR KEY SHARE`, the order
 * `FOR SHARE`, then the ticket `FOR UPDATE`. Every race here runs two
 * connections against one barrier — a row held from outside, released once
 * PostgreSQL reports both sides waiting behind it — and asserts one outcome
 * and no deadlock (`40P01`) on either side. Each race names, in its title,
 * the lock or constraint it fails without.
 *
 * Every booking is written with Stage A's `atVenueOrder`, priced through
 * `computeOrderTotals` with the site's terms, not through checkout. Every row
 * carries this run's tag; nothing is deleted.
 *
 * Runs against `TEST_DATABASE_URL`; with `REQUIRE_DATABASE` set it fails
 * rather than skips.
 */

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadActor } from '../src/lib/actor.js'
import {
  DOOR_BUSY_SENTENCE,
  DOOR_LOCK_WAIT,
  PREVIEW_TTL_MS,
  confirmAdmission,
  previewAdmission,
  signPreviewReference,
} from '../src/lib/admission.js'
import { conversionFunnel, venuePaymentFigures } from '../src/lib/analytics.js'
import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { CAPTURE_OUTCOMES, settleCheckout } from '../src/lib/checkout.js'
import { OUT_OF_TIME_RETRY_AFTER_SECONDS, databaseRefusal } from '../src/lib/errors.js'
import { findImbalances } from '../src/lib/finance-reporting.js'
import {
  GROUP_DOOR_BUSY_SENTENCE,
  confirmGroupAdmission,
  previewGroupAdmission,
} from '../src/lib/group-admission.js'
import { issueGroupPass } from '../src/lib/group-pass-credentials.js'
import { availableBalance, openDispute, payableCents } from '../src/lib/payouts.js'
import {
  REFUND_OUTCOMES,
  approveRefund,
  markSubmitted,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../src/lib/refunds.js'
import { startSession } from '../src/lib/sessions.js'
import { LOCK_WAIT_MS } from '../src/lib/transaction-budget.js'
import { venueBookingCounts } from '../src/lib/payment-terms.js'
import { mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { VENUE_CANCEL_AUTHORITIES, unpaidVenueBookings } from '../src/lib/venue-bookings.js'
import { venuePaymentsReport } from '../src/lib/venue-payments.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import {
  FEE_ORDER_CURRENCY,
  atVenueOrder,
  pendingZeroTotalOrder,
  referralCodeFixture,
} from './helpers/fee-orders.js'
import { TEST_AUTH_SECRET } from './helpers/fixtures.js'
import { holdRow } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the venue payment suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The secret passes are derived from: the application's own, so its passes and the suite's agree. */
const SECRET = TEST_AUTH_SECRET

/** What the door's services read of the environment. */
const ENV = Object.freeze({ AUTH_SECRET: SECRET })

/** A reason inside every 10–500 character bound. */
const REASON = 'Checked by the venue payment suite.'

/** A ticket's price at the door, in cents. */
const PRICE = 4_000

const providers = createInMemoryProviderRegistry({ payments: { idPrefix: `pivenue${RUN}` } })
const payments = providers.payments

let app
let rawApp
let sequence = 0
let buyer
let recipient
let owner
let scanner
let administrator

/**
 * Raw writes the second application runs for test 6, by name.
 *
 * @type {Map<string, function(): Promise<unknown>>}
 */
const RAW_WRITES = new Map()

/**
 * A tag unique to this run and call.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A user, with a confirmed second factor when `privileged`.
 *
 * @param {string} label Distinguishes them.
 * @param {object} [options] Options.
 * @param {string} [options.role] The platform role.
 * @param {boolean} [options.privileged] Whether to enrol a second factor.
 * @returns {Promise<object>} The user.
 */
async function person(label, { role = 'ATTENDEE', privileged = false } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@venue-payment.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (privileged) {
    await prisma.mfaFactor.create({
      data: {
        userId: user.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  return user
}

/**
 * Bearer headers for a real session whose second factor was confirmed now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function headersFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'venue-payment-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * The actor a request from this user would carry, read now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The actor.
 */
async function actorFor(who) {
  return (await loadActor(prisma, who.id)).actor
}

/**
 * An organisation the suite's owner runs, with the suite's scanner scoped to
 * its event, and one event of `nights` nights a day apart, a $40 tier on each.
 *
 * @param {string} label Distinguishes it.
 * @param {object} [options] Options.
 * @param {number} [options.nights] How many nights; 0 for an event with no `EventSession` rows and one tier.
 * @param {number} [options.startsInDays] When the first night is; negative for one that is over.
 * @returns {Promise<object>} `{ organization, event, nights, tiers, ownerHeaders }`.
 */
async function venueWorld(label, { nights = 1, startsInDays = 30 } = {}) {
  const slug = tag(label)
  const organization = await prisma.organization.create({
    data: {
      name: `Venue payments ${slug}`,
      slug: `venue-payments-${slug}`,
      contactEmail: `hello-${slug}@venue-payment.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Door Hall ${slug}`,
      slug: `door-hall-${slug}`,
      addressLine1: '1 Door Street',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })
  const startsAt = new Date(Date.now() + startsInDays * 86_400_000)
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Door night ${slug}`,
      slug: `door-night-${slug}`,
      summary: 'Seeded for the venue payment suite.',
      description: 'Seeded for the venue payment suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status: 'ON_SALE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + Math.max(nights - 1, 0) * 86_400_000 + 4 * 3_600_000),
      timezone: 'America/Chicago',
      publishedAt: new Date(Date.now() - 40 * 86_400_000),
      salesOpenedAt: new Date(Date.now() - 40 * 86_400_000),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const rows = { organization, event, nights: [], tiers: [] }

  // An event with no nights sells one tier that names none.
  if (nights === 0) {
    rows.tiers.push(
      await prisma.ticketType.create({
        data: {
          eventId: event.id,
          name: `Door ${slug}`,
          priceCents: PRICE,
          currency: FEE_ORDER_CURRENCY,
          quantityTotal: 100,
          maxPerOrder: 10,
          status: 'ON_SALE',
        },
      }),
    )
  }

  for (let night = 0; night < nights; night += 1) {
    const opens = new Date(startsAt.getTime() + night * 86_400_000)
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        label: `Night ${night + 1}`,
        startsAt: opens,
        endsAt: new Date(opens.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity: 200,
      },
    })
    const tier = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        name: `Door ${night + 1} ${slug}`,
        priceCents: PRICE,
        currency: FEE_ORDER_CURRENCY,
        quantityTotal: 100,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })

    rows.nights.push(session)
    rows.tiers.push(tier)
  }

  await prisma.membership.create({
    data: { userId: owner.id, organizationId: organization.id, role: 'OWNER' },
  })

  const scannerMembership = await prisma.membership.create({
    data: { userId: scanner.id, organizationId: organization.id, role: 'SCANNER' },
  })

  await prisma.scannerScope.create({
    data: { membershipId: scannerMembership.id, eventId: event.id },
  })

  return { ...rows, ownerHeaders: await headersFor(owner) }
}

/**
 * A pay-at-the-venue booking of the suite's buyer.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} [options] Options.
 * @param {number} [options.night] The night its one line is for.
 * @param {number} [options.quantity] How many tickets on it.
 * @param {Array<{ticketTypeId: string, quantity: number, unitPriceCents: number}>} [options.lines] Other lines.
 * @param {Array<{index: number, holderId?: string|null}>} [options.paidBy] Tickets paid at the door and let in.
 * @param {Array<string|null>} [options.holders] Tickets passed on.
 * @param {boolean} [options.taxed] Whether the online booking fee carries tax.
 * @returns {Promise<object>} From `atVenueOrder`.
 */
function booking(world, { night = 0, quantity = 2, lines, paidBy, holders, taxed = false } = {}) {
  return atVenueOrder(
    prisma,
    { event: world.event, session: world.nights[night], tiers: {}, promoCode: null },
    {
      tag: tag('booking'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      lines: lines ?? [{ ticketTypeId: world.tiers[night].id, quantity, unitPriceCents: PRICE }],
      paidBy: paidBy ?? null,
      holders: holders ?? null,
      atVenueTaxesBookingFee: taxed,
    },
  )
}

/**
 * A ticket's secure pass at its version.
 *
 * @param {object} ticket The ticket row.
 * @returns {string} The credential.
 */
function passOf(ticket) {
  return mintTicketCredential({
    secret: SECRET,
    ticketId: ticket.id,
    version: ticket.credentialVersion ?? 1,
  })
}

/**
 * What a call came to, error or not: a door refusal, an HTTP answer or a
 * database error, never thrown.
 *
 * @param {Promise<unknown>} call The call.
 * @returns {Promise<object>} `{ status, data?, code?, reason?, error? }`.
 */
async function outcome(call) {
  try {
    const value = await call

    if (value && typeof value.statusCode === 'number' && typeof value.json === 'function') {
      const body = value.body ? safeJson(value.body) : null

      return {
        status: value.statusCode,
        data: body?.data,
        code: body?.error?.code,
        reason: body?.error?.details?.reason,
        body: value.body,
      }
    }

    return { status: 200, data: value }
  } catch (error) {
    if (typeof error?.statusCode === 'number') {
      return {
        status: error.statusCode,
        code: error.code,
        reason: error.details?.reason,
        body: error.message,
      }
    }

    return { status: 0, error: String(error?.message ?? error), body: String(error?.stack ?? '') }
  }
}

/**
 * A body parsed, or null.
 *
 * @param {string} text The body.
 * @returns {object|null} The parsed body.
 */
function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Asserts that no side of a race saw a deadlock or a 500.
 *
 * @param {Array<object>} results From {@link outcome}.
 * @returns {void} Nothing.
 */
function expectNoDeadlock(results) {
  const text = JSON.stringify(results)

  expect(text).not.toMatch(/40P01|[Dd]eadlock/u)

  for (const result of results) {
    // The application answers a deadlock or a write conflict it lost as 409
    // TRY_AGAIN: in these races, that is the deadlock.
    expect(result.code, JSON.stringify(result)).not.toBe('TRY_AGAIN')
    expect(result.status, JSON.stringify(result)).toBeGreaterThan(0)
    expect(result.status, JSON.stringify(result)).toBeLessThan(500)
  }
}

/**
 * How many backends wait, directly or behind another waiter, on `pid`.
 *
 * @param {number} pid The backend holding the barrier.
 * @returns {Promise<number>} The count.
 */
async function waitersBehind(pid) {
  const rows = await prisma.$queryRaw`
    SELECT pid, pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity
    WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`
  const behind = new Set([Number(pid)])
  let grew = true

  while (grew) {
    grew = false

    for (const row of rows) {
      const waiter = Number(row.pid)

      if (!behind.has(waiter) && row.blockers.some((blocker) => behind.has(Number(blocker)))) {
        behind.add(waiter)
        grew = true
      }
    }
  }

  return behind.size - 1
}

/**
 * Wait, by polling `pg_stat_activity`, until `count` backends wait behind the
 * barrier.
 *
 * @param {number} pid The barrier's backend.
 * @param {number} count How many.
 * @param {string} what For the failure message.
 * @returns {Promise<void>} Resolves once they do.
 */
async function untilBehind(pid, count, what) {
  const deadline = Date.now() + 8_000

  while (Date.now() < deadline) {
    if ((await waitersBehind(pid)) >= count) return

    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }

  // What every backend of this database was doing, for the failure message.
  const activity = await prisma.$queryRaw`
    SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers,
           left(query, 120) AS query
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()`

  throw new Error(
    `Never saw ${what} waiting behind the barrier (${pid}) within eight seconds: ${JSON.stringify(
      activity,
      (key, value) => (typeof value === 'bigint' ? Number(value) : value),
    )}`,
  )
}

/**
 * Run two calls against a barrier: hold the row, start `first`, wait for it
 * to queue, start `second`, wait for both, then let go.
 *
 * @param {object} barrier `{ table, id }` of the row to hold.
 * @param {function(): Promise<unknown>} first The first side.
 * @param {function(): Promise<unknown>} second The second side.
 * @returns {Promise<Array<object>>} Both outcomes, first then second.
 */
async function race(barrier, first, second) {
  const held = await holdRow(prisma, barrier.table, barrier.id)
  const one = outcome(first())

  await untilBehind(held.pid, 1, 'the first side')

  const two = outcome(second())

  await untilBehind(held.pid, 2, 'both sides')
  held.release()
  await held.done

  return Promise.all([one, two])
}

/**
 * Look a ticket up at the door as `who` and hand back the confirmation body.
 *
 * @param {object} who The steward.
 * @param {object} ticket The ticket.
 * @param {object} [extra] More of the body (`eventSessionId`).
 * @returns {Promise<object>} The body a confirmation sends, without a payment.
 */
async function looked(who, ticket, extra = {}) {
  const body = { credential: passOf(ticket), ...extra }
  const data = await previewAdmission({ prisma, env: ENV, actor: await actorFor(who), body })

  expect(data.outcome, JSON.stringify(data)).toBe('ADMISSIBLE')

  return { ...body, previewReference: data.previewReference }
}

/**
 * Confirm at the door as `who`.
 *
 * @param {object} who The steward.
 * @param {object} body The confirmation body.
 * @returns {Promise<object>} What `confirmAdmission` returned.
 */
async function confirmAs(who, body) {
  return confirmAdmission({ prisma, env: ENV, actor: await actorFor(who), body })
}

/**
 * The order's door payments.
 *
 * @param {string} orderId The order.
 * @returns {Promise<object[]>} The rows.
 */
function doorPayments(orderId) {
  return prisma.venuePayment.findMany({ where: { orderId }, include: { tickets: true } })
}

/**
 * A ticket as it stands.
 *
 * @param {string} id The ticket.
 * @returns {Promise<object>} The row.
 */
function ticketRow(id) {
  return prisma.ticket.findUnique({ where: { id } })
}

/**
 * The buyer's group pass for an order, issued.
 *
 * @param {object} order The order.
 * @returns {Promise<{id: string, credential: string}>} The pass.
 */
async function groupPassFor(order) {
  const pass = await prisma.groupPass.create({ data: { orderId: order.id } })
  const issued = issueGroupPass({ secret: SECRET, groupPassId: pass.id })

  await prisma.groupPass.update({
    where: { id: pass.id },
    data: {
      credentialHash: issued.credentialHash,
      codeHash: issued.codeHash,
      credentialIssuedAt: new Date(),
    },
  })

  return { id: pass.id, credential: issued.credential }
}

/**
 * A whole refund of an order, requested and approved by the owner, marked
 * submitted and taken by the in-memory provider, ready for `settleRefund`.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} order The order.
 * @returns {Promise<{refund: object, result: object}>} What settlement needs.
 */
async function refundReadyToSettle(world, order) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: order.id } })), items },
      payment,
      lines: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `venue-refund-${tag('refund')}`,
      actorId: owner.id,
      now: new Date(),
    }),
  )

  await prisma.$transaction((tx) =>
    approveRefund(tx, { refund, actorId: owner.id, now: new Date() }),
  )
  await prisma.$transaction(async (tx) =>
    markSubmitted(tx, {
      refund: await tx.refund.findUnique({ where: { id: refund.id } }),
      now: new Date(),
    }),
  )

  const submitted = await prisma.refund.findUnique({ where: { id: refund.id } })
  const result = await submitOutsideTransaction(payments, submitted, payment)

  expect(result.outcome).toBe(REFUND_OUTCOMES.SUCCEEDED)

  return { refund: submitted, result, organizationId: world.organization.id }
}

beforeAll(async () => {
  if (!reachable) return

  const options = {
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  }

  app = await buildApp(options)
  await app.ready()

  // A second instance, for test 6: one route that runs a raw write and lets
  // whatever PostgreSQL refuses reach the application's error mapper.
  rawApp = await buildApp(options)
  rawApp.post('/test-only/raw-write/:name', async (request) => {
    await RAW_WRITES.get(request.params.name)()

    return { data: { written: true } }
  })
  await rawApp.ready()

  buyer = await person('buyer')
  recipient = await person('recipient')
  owner = await person('owner', { role: 'ORGANIZER', privileged: true })
  scanner = await person('scanner', { role: 'ORGANIZER', privileged: true })
  administrator = await person('administrator', { role: 'ADMIN', privileged: true })
})

afterAll(async () => {
  await app?.close()
  await rawApp?.close()
  await prisma.$disconnect().catch(() => {})
})

when()('the door and the money after the order (SPEC3 §14.3)', () => {
  it('1. same ticket, two stewards: one payment, one admission, the other told it is in already (the ticket FOR UPDATE)', async () => {
    const world = await venueWorld('twostewards')
    const { order, tickets } = await booking(world)
    const [ticket] = tickets
    const ownerBody = await looked(owner, ticket)
    const scannerBody = await looked(scanner, ticket)
    const payment = { amountCents: ticket.venueDueCents }

    const [first, second] = await race(
      { table: 'Ticket', id: ticket.id },
      () => confirmAs(owner, { ...ownerBody, payment }),
      () => confirmAs(scanner, { ...scannerBody, payment }),
    )

    expectNoDeadlock([first, second])
    expect(first.status, JSON.stringify(first)).toBe(200)
    expect(second.status, JSON.stringify(second)).toBe(200)
    expect([first.data.outcome, second.data.outcome].sort()).toEqual([
      'ADMITTED',
      'ALREADY_CHECKED_IN',
    ])

    const rows = await doorPayments(order.id)

    expect(rows).toHaveLength(1)
    expect(rows[0].tickets.map((row) => row.id)).toEqual([ticket.id])
    expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(1)

    const admitted = [first, second].find((side) => side.data.outcome === 'ADMITTED')
    const already = [first, second].find((side) => side.data.outcome === 'ALREADY_CHECKED_IN')

    expect(admitted.data.payment).toEqual({
      recordedCents: ticket.venueDueCents,
      venuePaymentId: rows[0].id,
      byThisRequest: true,
    })
    expect(already.data.payment).toEqual({
      recordedCents: ticket.venueDueCents,
      venuePaymentId: rows[0].id,
      byThisRequest: false,
    })
  })

  it('2. a single and a group confirmation naming one ticket: one payment for it, a truthful answer each (the group’s tickets FOR UPDATE)', async () => {
    const world = await venueWorld('singlegroup')
    const { order, tickets } = await booking(world)
    const [first, second] = tickets
    const pass = await groupPassFor(order)
    const single = await looked(owner, first)
    const group = await previewGroupAdmission({
      prisma,
      env: ENV,
      actor: await actorFor(scanner),
      body: { credential: pass.credential },
    })

    expect(group.payment.dueCents).toBe(first.venueDueCents + second.venueDueCents)

    const [one, two] = await race(
      { table: 'Ticket', id: first.id },
      () => confirmAs(owner, { ...single, payment: { amountCents: first.venueDueCents } }),
      async () =>
        confirmGroupAdmission({
          prisma,
          env: ENV,
          actor: await actorFor(scanner),
          body: {
            credential: pass.credential,
            previewReference: group.previewReference,
            ticketIds: [first.id, second.id],
            paymentCents: first.venueDueCents + second.venueDueCents,
          },
        }),
    )

    expectNoDeadlock([one, two])
    expect(one.status, JSON.stringify(one)).toBe(200)
    expect(one.data.outcome).toBe('ADMITTED')
    // The group found its first ticket paid and let in meanwhile: the group
    // changed, nothing of it was recorded, nobody else let in by it.
    expect(two.status, JSON.stringify(two)).toBe(409)
    expect(two.reason ?? two.code).toBe('GROUP_CHANGED')

    const rows = await doorPayments(order.id)
    const forFirst = rows.filter((row) => row.tickets.some((ticket) => ticket.id === first.id))

    expect(forFirst).toHaveLength(1)
    expect(forFirst[0].via).toBe('DOOR_TICKET')
    expect(await prisma.checkIn.count({ where: { ticketId: first.id } })).toBe(1)
    expect((await ticketRow(second.id)).venuePaymentId).toBeNull()
  })

  it('3. the door against a whole refund being settled: no deadlock; the refund settles first and the door refuses (the order before the ticket)', async () => {
    const world = await venueWorld('doorrefund')
    const { order, tickets } = await booking(world)
    const [first, second] = tickets
    const body = await looked(owner, first)
    const ready = await refundReadyToSettle(world, order)

    const [settled, door] = await race(
      { table: 'Order', id: order.id },
      () =>
        prisma.$transaction(async (tx) =>
          settleRefund(tx, {
            refund: ready.refund,
            order: await tx.order.findUnique({ where: { id: order.id } }),
            result: ready.result,
            organizationId: world.organization.id,
            eventStartsAt: world.event.startsAt,
            actorId: owner.id,
            now: new Date(),
          }),
        ),
      () => confirmAs(owner, { ...body, payment: { amountCents: first.venueDueCents } }),
    )

    expectNoDeadlock([settled, door])
    expect(settled.status, JSON.stringify(settled)).toBe(200)
    expect(door.status, JSON.stringify(door)).toBe(409)
    expect(await doorPayments(order.id)).toHaveLength(0)

    for (const ticket of [first, second]) {
      expect((await ticketRow(ticket.id)).status).toBe('REFUNDED')
    }

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'REFUNDED',
      refundedCents: order.totalCents,
    })
  })

  it('3b. the door first, then the whole refund: the ticket let in with its payment, the refund withdraws the other', async () => {
    const world = await venueWorld('doorfirst')
    const { order, tickets } = await booking(world)
    const [first, second] = tickets
    const body = await looked(owner, first)
    const ready = await refundReadyToSettle(world, order)

    const [door, settled] = await race(
      { table: 'Order', id: order.id },
      () => confirmAs(owner, { ...body, payment: { amountCents: first.venueDueCents } }),
      () =>
        prisma.$transaction(async (tx) =>
          settleRefund(tx, {
            refund: ready.refund,
            order: await tx.order.findUnique({ where: { id: order.id } }),
            result: ready.result,
            organizationId: world.organization.id,
            eventStartsAt: world.event.startsAt,
            actorId: owner.id,
            now: new Date(),
          }),
        ),
    )

    expectNoDeadlock([door, settled])
    expect(door.status, JSON.stringify(door)).toBe(200)
    expect(door.data.outcome).toBe('ADMITTED')
    expect(settled.status, JSON.stringify(settled)).toBe(200)
    expect(await ticketRow(first.id)).toMatchObject({ status: 'CHECKED_IN' })
    expect((await ticketRow(first.id)).venuePaymentId).not.toBeNull()
    expect((await ticketRow(second.id)).status).toBe('REFUNDED')
    expect(await doorPayments(order.id)).toHaveLength(1)
  })

  it('4. the door against the cancellation of the same night: no deadlock, and whichever commits first the other follows its rules (the night FOR KEY SHARE)', async () => {
    const world = await venueWorld('doornight', { nights: 2 })
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const body = await looked(scanner, ticket, { eventSessionId: world.nights[0].id })
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancellation`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().data.atVenue).toEqual({
      orders: 1,
      ticketsPaidAtDoor: 0,
      paidAtDoorCents: 0,
    })

    const revision = (await prisma.event.findUnique({ where: { id: world.event.id } })).revision
    const [cancelled, door] = await race(
      { table: 'EventSession', id: world.nights[0].id },
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancel`,
          headers: world.ownerHeaders,
          payload: {
            revision,
            reason: 'The band could not travel that night.',
            confirm: true,
            expectedOrders: preview.json().data.orders,
          },
        }),
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
    )

    expectNoDeadlock([cancelled, door])
    expect(cancelled.status, cancelled.body).toBe(200)
    // Cancelled first: the ticket was withdrawn, so the door refuses it and
    // records nothing.
    expect(door.status, JSON.stringify(door)).toBe(409)
    expect(await doorPayments(order.id)).toHaveLength(0)
    expect((await ticketRow(ticket.id)).status).not.toBe('CHECKED_IN')
  })

  it('4b. the door first, then the night’s cancellation: refused, because somebody was let in', async () => {
    const world = await venueWorld('nightafter', { nights: 2 })
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const body = await looked(scanner, ticket, { eventSessionId: world.nights[0].id })
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancellation`,
      headers: world.ownerHeaders,
    })
    const revision = (await prisma.event.findUnique({ where: { id: world.event.id } })).revision

    const [door, cancelled] = await race(
      { table: 'EventSession', id: world.nights[0].id },
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancel`,
          headers: world.ownerHeaders,
          payload: {
            revision,
            reason: 'The band could not travel that night.',
            confirm: true,
            expectedOrders: preview.json().data.orders,
          },
        }),
    )

    expectNoDeadlock([door, cancelled])
    expect(door.status, JSON.stringify(door)).toBe(200)
    expect(door.data.outcome).toBe('ADMITTED')
    expect(cancelled.status, cancelled.body).toBe(409)
    expect(cancelled.code).toBe('SESSION_STARTED')
    expect(await doorPayments(order.id)).toHaveLength(1)
  })

  it('5. the door against deleting the same finished event with CANCEL_AND_REFUND: no deadlock (the order before the ticket)', async () => {
    const world = await venueWorld('doordelete', { startsInDays: -2 })
    const { order, tickets } = await booking(world)
    const [ticket] = tickets
    const body = await looked(scanner, ticket)
    const event = await prisma.event.findUnique({ where: { id: world.event.id } })
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/deletion`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().data.choices).toContain('CANCEL_AND_REFUND')

    const [deleted, door] = await race(
      { table: 'Order', id: order.id },
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/events/${world.event.id}/delete`,
          headers: world.ownerHeaders,
          payload: {
            revision: event.revision,
            reason: REASON,
            confirmSlug: event.slug,
            expectedOutcome: 'CANCEL_AND_REFUND',
          },
        }),
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
    )

    expectNoDeadlock([deleted, door])
    expect(deleted.status, deleted.body).toBe(200)
    expect(door.status, JSON.stringify(door)).toBe(409)
    expect(await doorPayments(order.id)).toHaveLength(0)
    expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(0)
  })

  it('6. the triggers, answered through the application as 409s, never a 500', async () => {
    const world = await venueWorld('triggers')
    const { order, tickets } = await booking(world, {
      quantity: 3,
      paidBy: [{ index: 0 }],
    })
    const [paid, unpaid, other] = tickets
    const [recorded] = await doorPayments(order.id)
    /**
     * Run one raw write through the second application.
     *
     * @param {string} name What it is.
     * @param {function(): Promise<unknown>} write The write.
     * @returns {Promise<object>} The response.
     */
    const through = async (name, write) => {
      RAW_WRITES.set(name, write)

      return rawApp.inject({ method: 'POST', url: `/test-only/raw-write/${name}` })
    }

    // An admission written straight into the table for a ticket nobody paid
    // for at the door (`check_in_payment_due`).
    const checkIn = await through('check-in', () =>
      prisma.checkIn.create({
        data: {
          ticketId: unpaid.id,
          eventSessionId: world.nights[0].id,
          method: 'QR_SCAN',
          scannedAt: new Date(),
        },
      }),
    )

    expect(checkIn.statusCode, checkIn.body).toBe(409)
    expect(checkIn.json().error.code).toBe('PAYMENT_DUE')

    // A successor that would not owe what its predecessor owed
    // (`ticket_venue_due_successor`, SPEC3-XI's replacement of SPEC3's
    // "raw move to TRANSFER_PENDING"): answered as the transfer acceptance it
    // would race, 409 with TICKET_CHANGED.
    const successor = await through('successor', async () => {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({ where: { id: other.id }, data: { status: 'TRANSFER_PENDING' } })
        await tx.ticket.update({
          where: { id: other.id },
          data: { status: 'TRANSFERRED', credentialHash: null },
        })
        await tx.ticket.create({
          data: {
            orderItemId: other.orderItemId,
            code: `VPS${RUN}${sequence}`.toUpperCase(),
            ownerUserId: recipient.id,
            status: 'VALID',
            supersedesTicketId: other.id,
            venueDueCents: other.venueDueCents - 1,
          },
        })
      })
    })

    expect(successor.statusCode, successor.body).toBe(409)
    expect(successor.json().error, successor.body).toMatchObject({
      code: 'CONFLICT',
      reason: 'TICKET_CHANGED',
    })
    expect((await ticketRow(other.id)).status).toBe('VALID')

    // A ticket's payment changed once recorded (`ticket_venue_payment_fixed`).
    const second = await prisma.venuePayment
      .create({
        data: {
          orderId: order.id,
          eventId: world.event.id,
          eventSessionId: world.nights[0].id,
          organizationId: world.organization.id,
          amountCents: unpaid.venueDueCents,
          currency: FEE_ORDER_CURRENCY,
          ticketCount: 1,
          via: 'DOOR_TICKET',
          authority: 'ORGANIZATION_ROLE',
          role: 'OWNER',
        },
      })
      .catch((error) => error)

    // A payment row on its own does not sum to its tickets: refused at commit.
    expect(databaseRefusal(second)?.code).toBe('PAYMENT_NOT_RECORDED')

    const changed = await through('payment-changed', () =>
      prisma.ticket.update({ where: { id: paid.id }, data: { venuePaymentId: null } }),
    )

    expect(changed.statusCode, changed.body).toBe(409)
    expect(changed.json().error.code).toBe('PAYMENT_NOT_RECORDED')

    // A payment whose tickets do not sum to it, refused at commit.
    const short = await through('payment-short', () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.venuePayment.create({
          data: {
            orderId: order.id,
            eventId: world.event.id,
            eventSessionId: world.nights[0].id,
            organizationId: world.organization.id,
            amountCents: unpaid.venueDueCents + 1,
            currency: FEE_ORDER_CURRENCY,
            ticketCount: 1,
            via: 'DOOR_TICKET',
            authority: 'ORGANIZATION_ROLE',
            role: 'OWNER',
          },
        })

        await tx.ticket.update({ where: { id: unpaid.id }, data: { venuePaymentId: row.id } })
      }),
    )

    expect(short.statusCode, short.body).toBe(409)
    expect(short.json().error.code).toBe('PAYMENT_NOT_RECORDED')
    expect(await doorPayments(order.id)).toEqual([
      expect.objectContaining({ id: recorded.id, amountCents: paid.venueDueCents }),
    ])
  })

  it('7. a finished event with a ticket paid at the door and let in, cancelled and then deleted with CANCEL_AND_REFUND: the booking fee refunded, the door payment kept, the ledger balanced', async () => {
    const world = await venueWorld('finished', { startsInDays: -2 })
    const { order, tickets, venuePayments } = await booking(world, {
      quantity: 2,
      paidBy: [{ index: 0 }],
    })
    const [paid, unpaid] = tickets

    // Somebody was let in, so deleting it now would be "remove after the
    // event" (nothing refunded). Calling it off first makes the deletion
    // cancel-and-refund (SPEC2-XI X-D, rule 4).
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/events/${world.event.id}/cancel`,
      headers: world.ownerHeaders,
      payload: { reasonCode: 'OTHER', reason: 'Called off after the doors closed.' },
    })

    expect(cancel.statusCode, cancel.body).toBe(200)

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/deletion`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().data.outcome).toBe('CANCEL_AND_REFUND')
    expect(preview.json().data.atVenue).toEqual({
      orders: 1,
      ticketsPaidAtDoor: 1,
      paidAtDoorCents: paid.venueDueCents,
    })

    const event = await prisma.event.findUnique({ where: { id: world.event.id } })
    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${world.event.id}/delete`,
      headers: world.ownerHeaders,
      payload: {
        revision: event.revision,
        reason: REASON,
        confirmSlug: event.slug,
        expectedOutcome: 'CANCEL_AND_REFUND',
      },
    })

    expect(deleted.statusCode, deleted.body).toBe(200)

    // Only the booking fee paid online went back.
    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } })

    expect(refunds.filter((row) => row.status === 'SUCCEEDED')).toHaveLength(1)
    expect(
      refunds.reduce((sum, row) => sum + (row.status === 'SUCCEEDED' ? row.amountCents : 0), 0),
    ).toBe(order.totalCents)

    // The door payment stays recorded, the paid ticket stays let in, the
    // unpaid one is withdrawn, and the order says how it was paid.
    expect(await doorPayments(order.id)).toEqual([
      expect.objectContaining({ id: venuePayments[0].id, amountCents: paid.venueDueCents }),
    ])
    expect(await ticketRow(paid.id)).toMatchObject({
      status: 'CHECKED_IN',
      venuePaymentId: venuePayments[0].id,
    })
    expect((await ticketRow(unpaid.id)).status).not.toBe('VALID')
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      paymentMethod: 'AT_VENUE',
      venueDueCents: order.venueDueCents,
      feeGrossCents: order.feeGrossCents,
      refundedCents: order.totalCents,
    })
    expect(
      (await findImbalances(prisma, { organizationId: world.organization.id })).imbalances,
    ).toEqual([])
  })

  it('8. night by night: three nights cancelled in turn refund exactly the online total, every refund line worth 0 online', async () => {
    // A fourth night keeps the event on while the order's three are called
    // off (a night that is the only one left is cancelled with the event).
    const world = await venueWorld('nightbynight', { nights: 4 })
    const { order } = await booking(world, {
      lines: world.tiers.slice(0, 3).map((tier) => ({
        ticketTypeId: tier.id,
        quantity: 1,
        unitPriceCents: PRICE,
      })),
      taxed: true,
    })

    expect(order.totalCents).toBeGreaterThan(0)

    for (const night of world.nights.slice(0, 3)) {
      const preview = await app.inject({
        method: 'GET',
        url: `/v1/events/${world.event.id}/sessions/${night.id}/cancellation`,
        headers: world.ownerHeaders,
      })

      expect(preview.statusCode, preview.body).toBe(200)

      const cancelled = await app.inject({
        method: 'POST',
        url: `/v1/events/${world.event.id}/sessions/${night.id}/cancel`,
        headers: world.ownerHeaders,
        payload: {
          revision: (await prisma.event.findUnique({ where: { id: world.event.id } })).revision,
          reason: 'The band could not travel that night.',
          confirm: true,
          expectedOrders: preview.json().data.orders,
        },
      })

      expect(cancelled.statusCode, cancelled.body).toBe(200)
    }

    const refunds = await prisma.refund.findMany({
      where: { orderId: order.id },
      include: { items: true },
    })

    expect(refunds).toHaveLength(3)
    expect(refunds.every((row) => row.status === 'SUCCEEDED')).toBe(true)
    expect(refunds.reduce((sum, row) => sum + row.amountCents, 0)).toBe(order.totalCents)
    expect(refunds.flatMap((row) => row.items).every((item) => item.amountCents === 0)).toBe(true)
    expect(refunds.flatMap((row) => row.items)).toHaveLength(3)

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    })

    expect(after.refundedCents).toBe(order.totalCents)
    expect(after.refundPendingCents).toBe(0)

    for (const item of after.items) {
      expect(item.refundedQuantity).toBe(item.quantity)
      expect(item.refundedCents).toBeLessThanOrEqual(item.subtotalCents)
    }
  })

  it('9. a booking-fee refund of a booking whose tickets were all let in leaves the order PAID', async () => {
    const world = await venueWorld('feeafter')
    const { order, tickets } = await booking(world, {
      quantity: 2,
      paidBy: [{ index: 0 }, { index: 1 }],
    })
    const headers = await headersFor(administrator)
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/platform/orders/${order.reference}/fee`,
      headers,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const expected = preview.json().data.refundableFeeCents + preview.json().data.taxOnFeeCents

    expect(expected).toBe(order.totalCents)

    const refunded = await app.inject({
      method: 'POST',
      url: `/v1/platform/orders/${order.reference}/fee-refund`,
      headers,
      payload: { reason: REASON, expectedRefundableCents: expected },
    })

    expect(refunded.statusCode, refunded.body).toBe(200)
    expect(refunded.json().data.refund).toMatchObject({
      status: 'SUCCEEDED',
      paymentMethod: 'AT_VENUE',
      paidAtDoorCents: tickets[0].venueDueCents + tickets[1].venueDueCents,
    })
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'PAID',
      refundedCents: order.totalCents,
    })

    for (const ticket of tickets) expect((await ticketRow(ticket.id)).status).toBe('CHECKED_IN')
  })

  it('9b. a booking-fee refund withdraws no ticket and returns no place, and its Refund row and answer say so', async () => {
    // Thirty days out, so a refund that did withdraw tickets would resell
    // their places: the old record said `ticketsRevoked` and
    // `inventoryReturned` true for a refund that touched neither.
    const world = await venueWorld('feeonlyflags')
    const { order, tickets } = await booking(world, { quantity: 2 })
    const headers = await headersFor(administrator)
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/platform/orders/${order.reference}/fee`,
      headers,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const refunded = await app.inject({
      method: 'POST',
      url: `/v1/platform/orders/${order.reference}/fee-refund`,
      headers,
      payload: {
        reason: REASON,
        expectedRefundableCents:
          preview.json().data.refundableFeeCents + preview.json().data.taxOnFeeCents,
      },
    })

    expect(refunded.statusCode, refunded.body).toBe(200)

    const answered = refunded.json().data.refund

    expect(answered).toMatchObject({
      status: 'SUCCEEDED',
      ticketsRevoked: false,
      inventoryReturned: false,
    })
    expect(await prisma.refund.findUnique({ where: { id: answered.id } })).toMatchObject({
      status: 'SUCCEEDED',
      ticketsRevoked: false,
      inventoryReturned: false,
    })

    // What the record says is what happened: every ticket stands, still owing
    // its price at the door, and the order is still the buyer's booking.
    for (const ticket of tickets) {
      expect(await ticketRow(ticket.id)).toMatchObject({ status: 'VALID', venuePaymentId: null })
    }

    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('10. a dispute of a pay-at-the-venue booking fee is held from the booking-fee revenue: the organiser’s payable and balance do not move', async () => {
    const world = await venueWorld('dispute')
    const { order, payment } = await booking(world)
    const before = await availableBalance(prisma, {
      organizationId: world.organization.id,
      currency: FEE_ORDER_CURRENCY,
    })
    const payableBefore = await payableCents(prisma, {
      organizationId: world.organization.id,
      currency: FEE_ORDER_CURRENCY,
    })
    const { dispute } = await prisma.$transaction((tx) =>
      openDispute(tx, {
        payment,
        organizationId: world.organization.id,
        providerDisputeId: `dp_${tag('dispute')}`,
        amountCents: order.totalCents,
        currency: FEE_ORDER_CURRENCY,
        now: new Date(),
      }),
    )
    const batch = await prisma.ledgerBatch.findFirst({
      where: { disputeId: dispute.id },
      include: { entries: { include: { account: true } } },
    })
    const debited = batch.entries.filter((entry) => entry.direction === 'DEBIT')

    expect(debited.map((entry) => entry.account.code)).toEqual(['platform_fee_revenue'])
    expect(batch.entries.map((entry) => entry.account.code)).not.toContain('organizer_payable')
    expect(
      await payableCents(prisma, {
        organizationId: world.organization.id,
        currency: FEE_ORDER_CURRENCY,
      }),
    ).toBe(payableBefore)
    expect(
      await availableBalance(prisma, {
        organizationId: world.organization.id,
        currency: FEE_ORDER_CURRENCY,
      }),
    ).toEqual(before)
  })

  it('11. refunds.request on a pay-at-the-venue booking: the whole withdraws every standing ticket and refunds only the online part; an amount is refused', async () => {
    const world = await venueWorld('requestwhole')
    const { order, tickets } = await booking(world, { quantity: 2 })
    const headers = world.ownerHeaders
    const amount = await app.inject({
      method: 'POST',
      url: `/v1/orders/${order.reference}/refunds`,
      headers,
      payload: {
        amountCents: order.totalCents,
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `venue-amount-${tag('amount')}`,
      },
    })

    expect(amount.statusCode, amount.body).toBe(422)
    expect(amount.json().error.code).toBe('AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS')
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(0)

    const [item] = order.items
    const whole = await app.inject({
      method: 'POST',
      url: `/v1/orders/${order.reference}/refunds`,
      headers,
      payload: {
        lines: [{ orderItemId: item.id, quantity: item.quantity }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `venue-whole-${tag('whole')}`,
      },
    })

    expect(whole.statusCode, whole.body).toBe(201)
    expect(whole.json().data).toMatchObject({
      amountCents: order.totalCents,
      paymentMethod: 'AT_VENUE',
      paidAtDoorCents: 0,
    })

    const row = await prisma.refund.findUnique({ where: { id: whole.json().data.id } })

    expect(row.allocation).toMatchObject({
      form: 'whole',
      whole: true,
      faceValueCents: 0,
      basisCents: order.subtotalCents - order.discountCents,
    })

    // Approved and sent as finance would: then settled, it withdraws every
    // ticket that still stands.
    const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })

    await prisma.$transaction((tx) =>
      approveRefund(tx, { refund: row, actorId: administrator.id, now: new Date() }),
    )
    await prisma.$transaction(async (tx) =>
      markSubmitted(tx, {
        refund: await tx.refund.findUnique({ where: { id: row.id } }),
        now: new Date(),
      }),
    )

    const submitted = await prisma.refund.findUnique({ where: { id: row.id } })
    const result = await submitOutsideTransaction(payments, submitted, payment)

    await prisma.$transaction(async (tx) =>
      settleRefund(tx, {
        refund: submitted,
        order: await tx.order.findUnique({ where: { id: order.id } }),
        result,
        organizationId: world.organization.id,
        eventStartsAt: world.event.startsAt,
        actorId: administrator.id,
        now: new Date(),
      }),
    )

    for (const ticket of tickets) expect((await ticketRow(ticket.id)).status).toBe('REFUNDED')

    // The whole form still records what it did: tickets withdrawn, and their
    // places returned (thirty days out, they resell).
    expect(await prisma.refund.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'SUCCEEDED',
      ticketsRevoked: true,
      inventoryReturned: true,
    })
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'REFUNDED',
      refundedCents: order.totalCents,
    })
    expect(
      (await findImbalances(prisma, { organizationId: world.organization.id })).imbalances,
    ).toEqual([])
  })
})

/**
 * A two-night event whose first night is open now, with a tier good for every
 * night, and the buyer's booking of two of its tickets (no night named).
 *
 * @param {string} label Distinguishes it.
 * @returns {Promise<{world: object, order: object, tickets: object[]}>} The rows.
 */
async function everyNightBooking(label) {
  const world = await venueWorld(label, { nights: 2, startsInDays: 0 })
  const [first] = world.nights
  const opened = new Date(Date.now() - 3_600_000)

  await prisma.eventSession.update({
    where: { id: first.id },
    data: { startsAt: opened, endsAt: new Date(Date.now() + 3 * 3_600_000) },
  })
  await prisma.event.update({ where: { id: world.event.id }, data: { startsAt: opened } })

  const tier = await prisma.ticketType.create({
    data: {
      eventId: world.event.id,
      eventSessionId: null,
      name: `Every night ${tag('tier')}`,
      priceCents: PRICE,
      currency: FEE_ORDER_CURRENCY,
      quantityTotal: 100,
      maxPerOrder: 10,
      status: 'ON_SALE',
    },
  })
  const { order, tickets } = await atVenueOrder(
    prisma,
    { event: world.event, session: { id: null }, tiers: {}, promoCode: null },
    {
      tag: tag('booking'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      lines: [{ ticketTypeId: tier.id, quantity: 2, unitPriceCents: PRICE }],
    },
  )

  return { world, order, tickets }
}

/**
 * Request a lines refund of `quantity` tickets of the order's one line, as the
 * refund dialog sends it, and approve it.
 *
 * @param {object} order The order.
 * @param {number} quantity How many tickets.
 * @returns {Promise<object>} The approved refund.
 */
async function approvedLineRefund(order, quantity) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: order.id } })), items },
      payment,
      lines: [{ orderItemId: items[0].id, quantity }],
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `venue-line-${tag('line')}`,
      actorId: owner.id,
      now: new Date(),
    }),
  )

  await prisma.$transaction((tx) =>
    approveRefund(tx, { refund, actorId: owner.id, now: new Date() }),
  )

  return prisma.refund.findUnique({ where: { id: refund.id } })
}

/**
 * Send an approved refund to the in-memory provider and settle it.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} order The order.
 * @param {object} approved The approved refund.
 * @returns {Promise<void>}
 */
async function sendAndSettle(world, order, approved) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })

  await prisma.$transaction(async (tx) =>
    markSubmitted(tx, {
      refund: await tx.refund.findUnique({ where: { id: approved.id } }),
      now: new Date(),
    }),
  )

  const submitted = await prisma.refund.findUnique({ where: { id: approved.id } })
  const result = await submitOutsideTransaction(payments, submitted, payment)

  expect(result.outcome).toBe(REFUND_OUTCOMES.SUCCEEDED)

  await prisma.$transaction(async (tx) =>
    settleRefund(tx, {
      refund: submitted,
      order: await tx.order.findUnique({ where: { id: order.id } }),
      result,
      organizationId: world.organization.id,
      eventStartsAt: world.event.startsAt,
      actorId: owner.id,
      now: new Date(),
    }),
  )
}

when()('a lines refund beside a ticket good for every night paid at the door', () => {
  it('11b. one ticket of the line refunded after its sibling was paid and let in on night 1: the unpaid ticket is withdrawn, the paid one keeps admitting', async () => {
    const { world, order, tickets } = await everyNightBooking('everynightpaid')
    const [paid, unpaid] = tickets
    const body = await looked(scanner, paid, { eventSessionId: world.nights[0].id })
    const door = await confirmAs(scanner, { ...body, payment: { amountCents: paid.venueDueCents } })

    expect(door.outcome).toBe('ADMITTED')
    // Good for every night: still VALID after it was paid for and let in.
    expect(await ticketRow(paid.id)).toMatchObject({ status: 'VALID' })
    expect((await ticketRow(paid.id)).venuePaymentId).not.toBeNull()

    await sendAndSettle(world, order, await approvedLineRefund(order, 1))

    expect((await ticketRow(paid.id)).status).toBe('VALID')
    expect((await ticketRow(unpaid.id)).status).toBe('REFUNDED')
    expect(
      (await findImbalances(prisma, { organizationId: world.organization.id })).imbalances,
    ).toEqual([])
  })

  it('11c. the refund asked for before the door payment and settled after it: still the unpaid ticket is withdrawn', async () => {
    const { world, order, tickets } = await everyNightBooking('everynightlate')
    const [paid, unpaid] = tickets
    const approved = await approvedLineRefund(order, 1)
    const body = await looked(scanner, paid, { eventSessionId: world.nights[0].id })
    const door = await confirmAs(scanner, { ...body, payment: { amountCents: paid.venueDueCents } })

    expect(door.outcome).toBe('ADMITTED')

    await sendAndSettle(world, order, approved)

    expect((await ticketRow(paid.id)).status).toBe('VALID')
    expect((await ticketRow(paid.id)).venuePaymentId).not.toBeNull()
    expect((await ticketRow(unpaid.id)).status).toBe('REFUNDED')
  })
})

/**
 * A booking of two $40 tickets with its booking fee waived by a referral code:
 * nothing paid online, so nothing is refunded when its event or night is
 * called off.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {number} [night] The night its line is for.
 * @returns {Promise<object>} From `atVenueOrder`.
 */
function waivedBooking(world, night = 0) {
  return atVenueOrder(
    prisma,
    { event: world.event, session: world.nights[night], tiers: {}, promoCode: null },
    {
      tag: tag('booking'),
      payments,
      credentialSecret: SECRET,
      userId: buyer.id,
      waived: true,
      lines: [{ ticketTypeId: world.tiers[night].id, quantity: 2, unitPriceCents: PRICE }],
    },
  )
}

/**
 * The buyer's own read of one order, from the orders list.
 *
 * @param {string} reference The order's reference.
 * @returns {Promise<object>} The order as `GET /v1/orders` lists it.
 */
async function buyerListed(reference) {
  const list = await app.inject({
    method: 'GET',
    url: '/v1/orders',
    headers: await headersFor(buyer),
  })

  expect(list.statusCode, list.body).toBe(200)

  return list.json().data.find((row) => row.reference === reference)
}

when()('a booking that ended with nothing paid owes nothing at the door', () => {
  it('17. its event cancelled, its tickets still VALID: the buyer reads ENDED, and no figure counts it as unpaid', async () => {
    const world = await venueWorld('endedevent')
    const { order, tickets } = await waivedBooking(world)
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${world.event.id}/cancel`,
      headers: world.ownerHeaders,
      payload: { reasonCode: 'OTHER', reason: 'Called off by the venue payment suite.' },
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)
    // Nothing was paid online, so nothing withdrew them.
    for (const ticket of tickets) expect((await ticketRow(ticket.id)).status).toBe('VALID')

    const listed = await buyerListed(order.reference)

    expect(listed.venuePayment).toMatchObject({
      unpaidTickets: 0,
      unpaidCents: 0,
      state: 'ENDED',
    })

    const event = await prisma.event.findUnique({
      where: { id: world.event.id },
      include: { sessions: true },
    })
    const report = await venuePaymentsReport(prisma, {
      event,
      actor: await actorFor(owner),
      reader: 'ORGANISATION',
    })

    expect(report.summary).toMatchObject({
      unpaidTickets: 0,
      unpaidCents: 0,
      notPaidByEndTickets: 0,
      notPaidByEndCents: 0,
    })
    expect(report.unpaidOrders).toEqual([])

    const scope = { organizationId: world.organization.id, eventId: world.event.id }

    expect(await venuePaymentFigures(prisma, { ...scope, currency: 'USD' })).toMatchObject({
      ticketsUnpaid: 0,
      unpaidCents: 0,
    })
    expect((await conversionFunnel(prisma, { ...scope, now: new Date() })).atVenue).toEqual({
      bookedUnpaid: 0,
    })

    const unpaid = await unpaidVenueBookings(prisma, {
      event,
      reader: { authority: VENUE_CANCEL_AUTHORITIES.ORGANIZATION_ROLE },
    })

    expect(unpaid.bookings).toEqual([])
    expect((await venueBookingCounts(prisma, world.event.id)).unpaidTickets).toBe(0)
  })

  it('17b. its only night cancelled, its tickets withdrawn: the buyer reads ENDED, never paid', async () => {
    const world = await venueWorld('endednight', { nights: 2 })
    const { order } = await waivedBooking(world)
    const night = world.nights[0]
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/sessions/${night.id}/cancellation`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const revision = (await prisma.event.findUnique({ where: { id: world.event.id } })).revision
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${world.event.id}/sessions/${night.id}/cancel`,
      headers: world.ownerHeaders,
      payload: {
        revision,
        reason: 'The band could not travel that night.',
        confirm: true,
        expectedOrders: preview.json().data.orders,
      },
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const listed = await buyerListed(order.reference)

    expect(listed.status).toBe('PAID')
    expect(listed.venuePayment).toMatchObject({ unpaidTickets: 0, state: 'ENDED' })
  })
})

when()('a ticket passed on while it still owes at the door (SPEC3-XI §14.3)', () => {
  /**
   * Offer a ticket to the suite's recipient as its buyer.
   *
   * @param {object} ticket The ticket.
   * @returns {Promise<object>} The response.
   */
  async function offer(ticket) {
    return app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers: await headersFor(buyer),
      payload: { toEmail: recipient.email },
    })
  }

  it('14. a transfer acceptance against a door confirmation with payment of the same ticket: one outcome, at most one payment, the successor owes the same (the order line FOR KEY SHARE before the ticket)', async () => {
    const world = await venueWorld('acceptdoor')
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const offered = await offer(ticket)

    expect(offered.statusCode, offered.body).toBe(201)

    const token = offered.json().data.delivery.invitationCode
    const body = await looked(scanner, ticket)
    const recipientHeaders = await headersFor(recipient)

    const [door, accepted] = await race(
      { table: 'Ticket', id: ticket.id },
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
      () =>
        app.inject({
          method: 'POST',
          url: '/v1/ticket-transfers/accept',
          headers: recipientHeaders,
          payload: { token },
        }),
    )

    expectNoDeadlock([door, accepted])
    // The door went first: the ticket is in with its payment, and the
    // acceptance is refused; nobody holds a successor.
    expect(door.status, JSON.stringify(door)).toBe(200)
    expect(door.data.outcome).toBe('ADMITTED')
    expect(accepted.status, accepted.body).toBe(409)
    expect(accepted.code).toBe('CONFLICT')
    expect(accepted.reason ?? safeJson(accepted.body)?.error?.reason).toBe('TICKET_CHANGED')
    expect(await doorPayments(order.id)).toHaveLength(1)
    expect(await prisma.ticket.count({ where: { supersedesTicketId: ticket.id } })).toBe(0)
  })

  it('14b. the acceptance first: the successor owes what the ticket owed, unpaid, and the door refuses the old pass', async () => {
    const world = await venueWorld('acceptfirst')
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const offered = await offer(ticket)
    const token = offered.json().data.delivery.invitationCode
    const body = await looked(scanner, ticket)
    const recipientHeaders = await headersFor(recipient)

    const [accepted, door] = await race(
      { table: 'Ticket', id: ticket.id },
      () =>
        app.inject({
          method: 'POST',
          url: '/v1/ticket-transfers/accept',
          headers: recipientHeaders,
          payload: { token },
        }),
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
    )

    expectNoDeadlock([accepted, door])
    expect(accepted.status, accepted.body).toBe(200)
    expect(door.status, JSON.stringify(door)).toBe(409)
    expect(await doorPayments(order.id)).toHaveLength(0)

    const successor = await prisma.ticket.findFirst({ where: { supersedesTicketId: ticket.id } })

    expect(successor).toMatchObject({
      ownerUserId: recipient.id,
      venueDueCents: ticket.venueDueCents,
      venuePaymentId: null,
      status: 'VALID',
    })
    expect(accepted.data.ticket.venuePayment).toMatchObject({
      dueCents: ticket.venueDueCents,
      paid: false,
    })
  })

  it('15. an offer against a door confirmation with payment: no deadlock, one payment, and nobody can take a ticket that was let in (the offer’s ticket lock and compare-and-set)', async () => {
    const world = await venueWorld('offerdoor')
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const body = await looked(scanner, ticket)
    const buyerHeaders = await headersFor(buyer)

    const [door, offered] = await race(
      { table: 'Ticket', id: ticket.id },
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/tickets/${ticket.id}/transfers`,
          headers: buyerHeaders,
          payload: { toEmail: recipient.email },
        }),
    )

    expectNoDeadlock([door, offered])
    expect(door.status, JSON.stringify(door)).toBe(200)
    expect(door.data.outcome).toBe('ADMITTED')
    // Let in first, so it is not offered.
    expect(offered.status, offered.body).toBe(409)
    expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(0)
    expect(await doorPayments(order.id)).toHaveLength(1)
    expect(await ticketRow(ticket.id)).toMatchObject({ status: 'CHECKED_IN' })
  })

  it('15b. the offer first: the holder can still be let in and pay, and the offer can no longer be taken', async () => {
    const world = await venueWorld('offerfirst')
    const { order, tickets } = await booking(world, { quantity: 1 })
    const [ticket] = tickets
    const body = await looked(scanner, ticket)
    const buyerHeaders = await headersFor(buyer)

    const [offered, door] = await race(
      { table: 'Ticket', id: ticket.id },
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/tickets/${ticket.id}/transfers`,
          headers: buyerHeaders,
          payload: { toEmail: recipient.email },
        }),
      () => confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
    )

    expectNoDeadlock([offered, door])
    expect(offered.status, offered.body).toBe(201)
    expect(door.status, JSON.stringify(door)).toBe(200)
    expect(door.data.outcome).toBe('ADMITTED')
    expect(await doorPayments(order.id)).toHaveLength(1)

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/ticket-transfers/accept',
      headers: await headersFor(recipient),
      payload: { token: offered.data.delivery.invitationCode },
    })

    expect(accepted.statusCode).toBe(409)
    expect(await prisma.ticket.count({ where: { supersedesTicketId: ticket.id } })).toBe(0)
  })
})

when()('the lock fixes of SPEC3-XI §2.3 (tests 12, 13 and 16)', () => {
  /**
   * The event's deletion, previewed now and sent when called, with the
   * outcome the preview gives.
   *
   * @param {object} world From {@link venueWorld}.
   * @returns {Promise<{send: function(): Promise<object>, outcome: string}>} Sends it.
   */
  async function deletion(world) {
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/deletion`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const { outcome, choices } = preview.json().data
    const expectedOutcome = choices?.includes('CANCEL_AND_REFUND')
      ? 'CANCEL_AND_REFUND'
      : (outcome ?? choices?.[0])
    const event = await prisma.event.findUnique({ where: { id: world.event.id } })

    return {
      outcome: expectedOutcome,
      send: () =>
        app.inject({
          method: 'POST',
          url: `/v1/events/${world.event.id}/delete`,
          headers: world.ownerHeaders,
          payload: {
            revision: event.revision,
            reason: REASON,
            confirmSlug: event.slug,
            expectedOutcome,
          },
        }),
    }
  }

  /**
   * The `referral_code.use_returned` audit rows of an order.
   *
   * @param {string} orderId The order.
   * @returns {Promise<object[]>} The rows.
   */
  function returnsOf(orderId) {
    return prisma.auditLog.findMany({
      where: {
        action: AUDIT_ACTIONS.REFERRAL_USE_RETURNED,
        metadata: { path: ['orderId'], equals: orderId },
      },
    })
  }

  it(
    '12. a night-1 door confirmation of a night-2 ticket of an order against night 2’s cancellation, ×20: no deadlock (the night’s paid orders locked before its tickets, §2.3.1)',
    { timeout: 240_000 },
    async () => {
      for (let round = 0; round < 20; round += 1) {
        const world = await venueWorld(`doornighttwo${round}`, { nights: 3 })
        const { order, tickets } = await booking(world, { night: 1, quantity: 1 })
        const [ticket] = tickets
        const steward = await actorFor(scanner)

        // Night 1's door is never shown a night-2 ticket as admissible, so no
        // preview hands it a reference; the confirmation arrives with one
        // signed for night 1 anyway (as a stale or replayed one would), and
        // the door takes its locks before it decides.
        const body = {
          credential: passOf(ticket),
          eventSessionId: world.nights[0].id,
          previewReference: signPreviewReference({
            secret: SECRET,
            ticketId: ticket.id,
            eventId: world.event.id,
            organizationId: world.organization.id,
            actorId: steward.id,
            method: 'QR_SCAN',
            night: world.nights[0].id,
            dueCents: ticket.venueDueCents,
            expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
          }),
          payment: { amountCents: ticket.venueDueCents },
        }
        const preview = await app.inject({
          method: 'GET',
          url: `/v1/events/${world.event.id}/sessions/${world.nights[1].id}/cancellation`,
          headers: world.ownerHeaders,
        })

        expect(preview.statusCode, preview.body).toBe(200)

        const revision = (await prisma.event.findUnique({ where: { id: world.event.id } })).revision
        const cancelNight = () =>
          app.inject({
            method: 'POST',
            url: `/v1/events/${world.event.id}/sessions/${world.nights[1].id}/cancel`,
            headers: world.ownerHeaders,
            payload: {
              revision,
              reason: 'The band could not travel that night.',
              confirm: true,
              expectedOrders: preview.json().data.orders,
            },
          })
        const door = () => confirmAdmission({ prisma, env: ENV, actor: steward, body })

        // The cancellation reaches the ticket first, then the door: before
        // the fix the cancellation held the withdrawn ticket and waited for
        // the order the door held.
        const [cancelled, admitted] = await race(
          { table: 'Ticket', id: ticket.id },
          cancelNight,
          door,
        )

        expectNoDeadlock([cancelled, admitted])
        expect(cancelled.status, cancelled.body).toBe(200)
        expect(admitted.status, JSON.stringify(admitted)).toBe(409)
        expect(await doorPayments(order.id)).toHaveLength(0)
        expect((await ticketRow(ticket.id)).status).not.toBe('CHECKED_IN')
      }
    },
  )

  it(
    '13. a door confirmation on an event with no nights against its deletion, with a waived zero-online booking: no deadlock, the use given back once (every paid order locked before the tickets, §2.3.2)',
    { timeout: 120_000 },
    async () => {
      for (const deletionFirst of [true, false]) {
        const world = await venueWorld(`nightless${deletionFirst ? 'a' : 'b'}`, { nights: 0 })
        const { order, tickets } = await atVenueOrder(
          prisma,
          { event: world.event, session: { id: null }, tiers: {}, promoCode: null },
          {
            tag: tag('waived'),
            payments,
            credentialSecret: SECRET,
            userId: buyer.id,
            lines: [{ ticketTypeId: world.tiers[0].id, quantity: 1, unitPriceCents: PRICE }],
            waived: true,
          },
        )
        const [ticket] = tickets

        expect(order.totalCents).toBe(0)

        const body = await looked(scanner, ticket)
        const sending = await deletion(world)
        const door = () =>
          confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } })

        const results = await race(
          { table: 'Ticket', id: ticket.id },
          deletionFirst ? sending.send : door,
          deletionFirst ? door : sending.send,
        )
        const [deleted, admitted] = deletionFirst ? results : [...results].reverse()

        expectNoDeadlock(results)
        expect(deleted.status, deleted.body).toBe(200)

        const after = await prisma.order.findUnique({ where: { id: order.id } })

        if (deletionFirst) {
          expect(admitted.status, JSON.stringify(admitted)).toBeGreaterThanOrEqual(400)
          expect(await doorPayments(order.id)).toHaveLength(0)
          expect(after.referralUseReturnCause).toBe('EVENT_DELETED')
          expect(await returnsOf(order.id)).toHaveLength(1)
        } else {
          // Let in and paid first: the booking was used, and keeps its use.
          expect(admitted.status, JSON.stringify(admitted)).toBe(200)
          expect(await doorPayments(order.id)).toHaveLength(1)
          expect(after.referralUseReturnedAt).toBeNull()
          expect(await returnsOf(order.id)).toHaveLength(0)
        }
      }
    },
  )

  it(
    '16. deleting with CANCEL_AND_REFUND against the settlement of a waived zero-online booking, both arrival orders, ×20: no deadlock; cancelled and its use given back, or paid, its tickets withdrawn and its use given back (settlement takes its tiers first, §2.3.3)',
    { timeout: 300_000 },
    async () => {
      let codes = 0

      for (const settleFirst of [true, false]) {
        for (let round = 0; round < 20; round += 1) {
          const world = await venueWorld(`settledelete${settleFirst ? 'a' : 'b'}${round}`)

          // A booking with money online, so the deletion refunds.
          await booking(world, { quantity: 1 })

          const { row: code } = await referralCodeFixture(prisma, {
            createdById: administrator.id,
          })
          const { order: pending } = await prisma.$transaction((tx) =>
            pendingZeroTotalOrder(tx, {
              world: { event: world.event, session: world.nights[0] },
              referralCode: code,
              tag: tag('pending'),
              userId: buyer.id,
              lines: [{ ticketTypeId: world.tiers[0].id, quantity: 1, unitPriceCents: PRICE }],
            }),
          )
          const sending = await deletion(world)

          expect(sending.outcome).toBe('CANCEL_AND_REFUND')

          const settle = () =>
            prisma.$transaction(
              (tx) =>
                settleCheckout(tx, {
                  order: pending,
                  payment: null,
                  result: {
                    outcome: CAPTURE_OUTCOMES.SUCCEEDED,
                    intent: null,
                    failureCode: null,
                    rawStatus: 'ZERO_TOTAL',
                  },
                  now: new Date(),
                  generateTicketCode: () => {
                    codes += 1

                    return `DET-SD${RUN}${codes}`.toUpperCase()
                  },
                  credentialSecret: SECRET,
                }),
              { timeout: 15_000, maxWait: 10_000 },
            )

          const results = await race(
            { table: 'TicketType', id: world.tiers[0].id },
            settleFirst ? settle : sending.send,
            settleFirst ? sending.send : settle,
          )
          const [settled, deleted] = settleFirst ? results : [...results].reverse()
          const label = `${settleFirst ? 'settlement' : 'deletion'} first, round ${round}`

          expectNoDeadlock(results)
          expect(deleted.status, `${label}: ${deleted.body}`).toBe(200)

          const after = await prisma.order.findUnique({ where: { id: pending.id } })
          const issued = await prisma.ticket.findMany({
            where: { orderItem: { orderId: pending.id } },
          })

          expect(await returnsOf(pending.id), label).toHaveLength(1)

          if (settleFirst) {
            expect(settled.status, `${label}: ${JSON.stringify(settled)}`).toBe(200)
            expect(after.status, label).toBe('PAID')
            expect(issued.length, label).toBeGreaterThan(0)
            expect(
              issued.every(
                (row) =>
                  row.status === 'CANCELLED' && row.revokedReason.startsWith('event-deleted:'),
              ),
              label,
            ).toBe(true)
            expect(after.referralUseReturnCause, label).toBe('EVENT_DELETED')
          } else {
            expect(after.status, label).toBe('CANCELLED')
            expect(issued, label).toEqual([])
            expect(after.referralUseReturnCause, label).toBe('UNPAID_ORDER_CANCELLED')
          }

          expect(
            (await prisma.referralCode.findUnique({ where: { id: code.id } })).useCount,
            label,
          ).toBe(0)
        }
      }
    },
  )
})

/**
 * Hold one row `FOR UPDATE` from outside for up to a minute, longer than any
 * budget under test, until told to let go.
 *
 * @param {string} table The table.
 * @param {string} id The row.
 * @returns {Promise<{pid: number, release: function(): Promise<void>}>} The holder.
 */
async function holdLong(table, id) {
  let open
  const gate = new Promise((resolve) => {
    open = resolve
  })
  let ready
  const locked = new Promise((resolve, reject) => {
    ready = { resolve, reject }
  })
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id)

      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

      ready.resolve(Number(pid))
      await gate
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  done.catch((error) => ready.reject(error))

  const pid = await locked

  return {
    pid,
    release: async () => {
      open()
      await done
    },
  }
}

/**
 * A call's outcome and when it came, or null when it did not come within
 * `ms` (the row is let go only after this).
 *
 * @param {Promise<unknown>} call The call.
 * @param {number} ms How long to wait for it.
 * @returns {Promise<{answer: object, ms: number}|null>} The outcome and how long it took.
 */
async function answeredWithin(call, ms) {
  const started = Date.now()
  const answer = outcome(call).then((result) => ({ answer: result, ms: Date.now() - started }))

  return Promise.race([
    answer,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), ms)
    }),
  ])
}

when()('a write that cannot wait behind another change (final door review, finding 2)', () => {
  it('18. the single door with a payment, behind its order held by another change: 503 within its lock wait, nobody let in, nothing recorded', async () => {
    const world = await venueWorld('doorbusy')
    const { order, tickets } = await booking(world)
    const [ticket] = tickets
    const body = await looked(scanner, ticket)
    const held = await holdLong('Order', order.id)
    let told

    try {
      told = await answeredWithin(
        confirmAs(scanner, { ...body, payment: { amountCents: ticket.venueDueCents } }),
        DOOR_LOCK_WAIT.statementMs + 5_000,
      )
    } finally {
      await held.release()
    }

    // Answered while the order was still held, after waiting its bound.
    expect(told, 'the door was still waiting on the order').not.toBeNull()
    expect(told.ms).toBeGreaterThanOrEqual(DOOR_LOCK_WAIT.lockMs - 250)
    expect(told.answer).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      body: DOOR_BUSY_SENTENCE,
    })
    expect(await doorPayments(order.id)).toEqual([])
    expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(0)
    expect((await ticketRow(ticket.id)).status).toBe('VALID')

    // Let go, the same steward admits them with the payment, once.
    const again = await outcome(
      confirmAs(scanner, {
        ...(await looked(scanner, ticket)),
        payment: { amountCents: ticket.venueDueCents },
      }),
    )

    expect(again.status, JSON.stringify(again)).toBe(200)
    expect(again.data.outcome).toBe('ADMITTED')
    expect(await doorPayments(order.id)).toHaveLength(1)
  })

  it('18b. the group door with a payment, behind its order held by another change: 503 within its lock wait, nobody let in, nothing recorded', async () => {
    const world = await venueWorld('groupbusy')
    const { order, tickets } = await booking(world)
    const pass = await groupPassFor(order)
    const group = await previewGroupAdmission({
      prisma,
      env: ENV,
      actor: await actorFor(scanner),
      body: { credential: pass.credential },
    })
    const held = await holdLong('Order', order.id)
    let told

    try {
      told = await answeredWithin(
        (async () =>
          confirmGroupAdmission({
            prisma,
            env: ENV,
            actor: await actorFor(scanner),
            body: {
              credential: pass.credential,
              previewReference: group.previewReference,
              ticketIds: tickets.map((ticket) => ticket.id),
              paymentCents: group.payment.dueCents,
            },
          }))(),
        DOOR_LOCK_WAIT.statementMs + 5_000,
      )
    } finally {
      await held.release()
    }

    expect(told, 'the group door was still waiting on the order').not.toBeNull()
    expect(told.answer).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      body: GROUP_DOOR_BUSY_SENTENCE,
    })
    expect(await doorPayments(order.id)).toEqual([])
    expect(
      await prisma.checkIn.count({
        where: { ticketId: { in: tickets.map((ticket) => ticket.id) } },
      }),
    ).toBe(0)
  })

  it(
    '18c. tickets.revoke behind its order held by another change: 503 with its own sentence and Retry-After after its lock wait, the ticket still valid',
    { timeout: 90_000 },
    async () => {
      const world = await venueWorld('revokebusy')
      const { order, tickets } = await booking(world)
      const [ticket] = tickets
      const held = await holdLong('Order', order.id)
      const started = Date.now()
      let told

      try {
        told = await Promise.race([
          app
            .inject({
              method: 'POST',
              url: `/v1/tickets/${ticket.id}/revoke`,
              headers: world.ownerHeaders,
              payload: { reason: REASON },
            })
            .then((response) => ({ response, ms: Date.now() - started })),
          new Promise((resolve) => {
            setTimeout(() => resolve(null), LOCK_WAIT_MS + 20_000)
          }),
        ])
      } finally {
        await held.release()
      }

      expect(told, 'the revocation was still waiting on the order').not.toBeNull()
      expect(told.ms).toBeGreaterThanOrEqual(LOCK_WAIT_MS - 250)
      expect(told.response.statusCode, told.response.body).toBe(503)
      expect(told.response.headers['retry-after']).toBe(String(OUT_OF_TIME_RETRY_AFTER_SECONDS))
      expect(told.response.json().error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message:
          'Another change to this ticket’s order was being saved at the same moment, so the ticket was not revoked. Try again in a moment.',
      })
      expect(told.response.body).not.toMatch(/P20\d\d|55P03|57014|lock timeout|expired transaction/)
      expect((await ticketRow(ticket.id)).status).toBe('VALID')
    },
  )
})
