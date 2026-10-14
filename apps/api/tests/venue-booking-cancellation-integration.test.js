/**
 * Cancelling unpaid pay-at-the-venue tickets, against real PostgreSQL
 * (SPEC3-XI §14.3, C1–C15).
 *
 * The cancellation takes its locks in SPEC3-XI §2.2's order: the tickets'
 * tiers (sorted, `FOR UPDATE`), their nights (`FOR KEY SHARE`), the order
 * (`FOR UPDATE`), the tickets' lines, the tickets; then it decides everything
 * again from rows read under those locks. Every race here runs its sides
 * against one barrier — a row held from outside, released once PostgreSQL
 * reports every side waiting behind it — and asserts one outcome and no
 * deadlock (`40P01`) on any side. Each race names, in its title, the lock or
 * the condition it fails without.
 *
 * Bookings are written with Stage A's `atVenueOrder` (priced through
 * `computeOrderTotals` with the site's terms), or placed through
 * `orders.create` where the test is about what checkout reads. Every row
 * carries this run's tag; nothing is deleted.
 *
 * Runs against `TEST_DATABASE_URL`; with `REQUIRE_DATABASE` set it fails
 * rather than skips.
 */

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadActor } from '../src/lib/actor.js'
import { confirmAdmission, previewAdmission } from '../src/lib/admission.js'
import { prepareInventory } from '../src/lib/event-authoring.js'
import { findImbalances } from '../src/lib/finance-reporting.js'
import { confirmGroupAdmission, previewGroupAdmission } from '../src/lib/group-admission.js'
import { issueGroupPass } from '../src/lib/group-pass-credentials.js'
import {
  REFUND_OUTCOMES,
  approveRefund,
  markSubmitted,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../src/lib/refunds.js'
import { startSession } from '../src/lib/sessions.js'
import { mintTicketCredential } from '../src/lib/ticket-credentials.js'
import { cancelUnpaidVenueTickets } from '../src/lib/venue-bookings.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { FEE_ORDER_CURRENCY, atVenueOrder, referralCodeFixture } from './helpers/fee-orders.js'
import { TEST_AUTH_SECRET } from './helpers/fixtures.js'
import { holdRow } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the unpaid cancellation suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The secret passes are derived from: the application's own, so its passes and the suite's agree. */
const SECRET = TEST_AUTH_SECRET

/** What the door's services read of the environment. */
const ENV = Object.freeze({ AUTH_SECRET: SECRET })

/** A reason inside every 10–500 character bound. */
const REASON = 'Not paid for at the door; checked by the suite.'

/** A ticket's price at the door, in cents. */
const PRICE = 4_000

/** How many times a race the spec marks ×20 is run, per arrival order. */
const ROUNDS = 20

/** The states a refund that still counts against the order is in. */
const COUNTED_REFUNDS = [
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'SUCCEEDED',
  'TIMEOUT',
  'RECONCILIATION_REQUIRED',
]

const providers = createInMemoryProviderRegistry({ payments: { idPrefix: `picancel${RUN}` } })
const payments = providers.payments

let app
let sequence = 0
let buyer
let recipient
let owner
let scanner
let administrator

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
      email: `${label}-${RUN}@unpaid-cancellation.example`,
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
    key: 'unpaid-cancellation-suite-pseudonymisation-key',
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
 * @param {number} [options.nights] How many nights; 0 for an event with no `EventSession` rows.
 * @param {number} [options.startsInDays] When the first night is.
 * @param {number} [options.quantityTotal] Each tier's places.
 * @param {number} [options.capacity] Each night's capacity.
 * @param {boolean} [options.everyNight] Whether to add a tier valid every night.
 * @returns {Promise<object>} `{ organization, venue, event, nights, tiers, everyNightTier, ownerHeaders }`.
 */
async function venueWorld(
  label,
  { nights = 1, startsInDays = 30, quantityTotal = 100, capacity = 200, everyNight = false } = {},
) {
  const slug = tag(label)
  const organization = await prisma.organization.create({
    data: {
      name: `Unpaid cancellations ${slug}`,
      slug: `unpaid-cancellations-${slug}`,
      contactEmail: `hello-${slug}@unpaid-cancellation.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Unpaid Hall ${slug}`,
      slug: `unpaid-hall-${slug}`,
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
      title: `Unpaid night ${slug}`,
      slug: `unpaid-night-${slug}`,
      summary: 'Seeded for the unpaid cancellation suite.',
      description: 'Seeded for the unpaid cancellation suite, long enough to be plausible.',
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
  const rows = { organization, venue, event, nights: [], tiers: [], everyNightTier: null }

  for (let night = 0; night < nights; night += 1) {
    const opens = new Date(startsAt.getTime() + night * 86_400_000)
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        label: `Night ${night + 1}`,
        startsAt: opens,
        endsAt: new Date(opens.getTime() + 4 * 3_600_000),
        timezone: 'America/Chicago',
        capacity,
      },
    })

    rows.nights.push(session)
    rows.tiers.push(await tierOf(event, session.id, `Door ${night + 1} ${slug}`, quantityTotal))
  }

  if (nights === 0) rows.tiers.push(await tierOf(event, null, `Door ${slug}`, quantityTotal))

  if (everyNight) {
    rows.everyNightTier = await tierOf(event, null, `Every night ${slug}`, quantityTotal)
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
 * A $40 tier of an event.
 *
 * @param {object} event The event.
 * @param {string|null} eventSessionId Its night, or null for every night.
 * @param {string} name Its name.
 * @param {number} quantityTotal Its places.
 * @returns {Promise<object>} The tier.
 */
function tierOf(event, eventSessionId, name, quantityTotal) {
  return prisma.ticketType.create({
    data: {
      eventId: event.id,
      eventSessionId,
      name,
      priceCents: PRICE,
      currency: FEE_ORDER_CURRENCY,
      quantityTotal,
      maxPerOrder: 10,
      status: 'ON_SALE',
    },
  })
}

/**
 * A pay-at-the-venue booking of the suite's buyer.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} [options] Options.
 * @param {number} [options.night] The night its one line is for.
 * @param {number} [options.quantity] How many tickets on it.
 * @param {Array<{ticketTypeId: string, quantity: number, unitPriceCents: number}>} [options.lines] Other lines.
 * @param {string|null} [options.userId] The buyer.
 * @returns {Promise<object>} From `atVenueOrder`.
 */
function booking(world, { night = 0, quantity = 2, lines, userId = buyer.id } = {}) {
  return atVenueOrder(
    prisma,
    {
      event: world.event,
      session: world.nights[night] ?? { id: null },
      tiers: {},
      promoCode: null,
    },
    {
      tag: tag('booking'),
      payments,
      credentialSecret: SECRET,
      userId,
      lines: lines ?? [{ ticketTypeId: world.tiers[night].id, quantity, unitPriceCents: PRICE }],
    },
  )
}

/**
 * Cancel unpaid tickets of a booking as `as`, through the library the route
 * calls (the route adds the step-up and its rate limit, which a race of
 * twenty would spend).
 *
 * @param {object} order The booking.
 * @param {Array<object|string>} tickets The tickets, or their ids.
 * @param {object} [options] Options.
 * @param {object} [options.actor] The actor; the suite's owner unless given.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} The response payload.
 */
async function cancel(order, tickets, { actor, now } = {}) {
  return cancelUnpaidVenueTickets(prisma, {
    reference: order.reference,
    ticketIds: tickets.map((ticket) => ticket.id ?? ticket),
    reason: REASON,
    actor: actor ?? (await actorFor(owner)),
    now: now ?? new Date(),
    requestId: `req-${tag('cancel')}`,
  })
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
 * @returns {Promise<object>} `{ status, data?, code?, reason?, details?, error? }`.
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
        reason: body?.error?.details?.reason ?? body?.error?.reason,
        details: body?.error?.details,
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
        details: error.details,
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

  expect(text).not.toMatch(/40P01|deadlock/iu)

  for (const result of results) {
    // The application answers a deadlock or a write conflict it lost as 409
    // TRY_AGAIN or 503: in these races, that is the deadlock.
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
async function untilBehind(pid, count, what, finished = () => null) {
  const deadline = Date.now() + 8_000

  while (Date.now() < deadline) {
    if ((await waitersBehind(pid)) >= count) return

    const early = finished()

    // A side that answered without waiting never reached the barrier.
    if (early) throw new Error(`${what} answered without waiting: ${JSON.stringify(early)}`)

    await new Promise((resolve) => {
      setTimeout(resolve, 15)
    })
  }

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
 * Run calls against a barrier: hold the row, start each side in turn once
 * the ones before it queue, wait for all of them, then let go.
 *
 * @param {object} barrier `{ table, id, mode? }` of the row to hold.
 * @param {...function(): Promise<unknown>} sides The sides, in arrival order.
 * @returns {Promise<Array<object>>} Every outcome, in the order given.
 */
async function race(barrier, ...sides) {
  const held = await holdRow(prisma, barrier.table, barrier.id, { mode: barrier.mode })
  const started = []

  const answered = []

  try {
    for (const [index, side] of sides.entries()) {
      started.push(
        outcome(side()).then((result) => {
          answered[index] = result

          return result
        }),
      )
      await untilBehind(
        held.pid,
        index + 1,
        `side ${index + 1} of ${sides.length}`,
        () => answered.find(Boolean) ?? null,
      )
    }
  } finally {
    held.release()
    await held.done
  }

  return Promise.all(started)
}

/**
 * Look a ticket up at the door as `who` and hand back the confirmation body.
 *
 * @param {object} who The steward.
 * @param {object} ticket The ticket.
 * @returns {Promise<object>} The body a confirmation sends, without a payment.
 */
async function looked(who, ticket) {
  const body = { credential: passOf(ticket) }
  const data = await previewAdmission({ prisma, env: ENV, actor: await actorFor(who), body })

  expect(data.outcome, JSON.stringify(data)).toBe('ADMISSIBLE')

  return { ...body, previewReference: data.previewReference }
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
 * A tier as it stands.
 *
 * @param {string} id The tier.
 * @returns {Promise<object>} The row.
 */
function tierRow(id) {
  return prisma.ticketType.findUnique({ where: { id } })
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
 * An order as it stands, with its lines.
 *
 * @param {string} id The order.
 * @returns {Promise<object>} The row.
 */
function orderRow(id) {
  return prisma.order.findUnique({ where: { id }, include: { items: true } })
}

/**
 * What of an order's online money is spoken for: the refunds that count
 * against it and the booking fee kept by cancellations.
 *
 * @param {string} orderId The order.
 * @returns {Promise<{refunds: number, kept: number, total: number}>} Cents.
 */
async function moneyOf(orderId) {
  const order = await orderRow(orderId)
  const refunds = await prisma.refund.findMany({
    where: { orderId, status: { in: COUNTED_REFUNDS } },
  })
  const cancellations = await prisma.venueBookingCancellation.findMany({ where: { orderId } })

  expect(order.venueFeeKeptCents).toBe(
    cancellations.reduce((sum, row) => sum + row.feeKeptCents, 0),
  )

  return {
    refunds: refunds.reduce((sum, row) => sum + row.amountCents, 0),
    kept: order.venueFeeKeptCents,
    total: order.totalCents,
  }
}

/**
 * Asserts that what was refunded and kept of an order never passes what was
 * paid online.
 *
 * @param {string} orderId The order.
 * @returns {Promise<object>} From {@link moneyOf}.
 */
async function expectWithinOnlineTotal(orderId) {
  const money = await moneyOf(orderId)

  expect(money.refunds + money.kept, JSON.stringify(money)).toBeLessThanOrEqual(money.total)

  return money
}

/**
 * A whole refund of a booking, requested and approved by the owner, marked
 * submitted and taken by the in-memory provider: ready for `settleRefund`.
 *
 * @param {object} order The order.
 * @returns {Promise<{refund: object, result: object}>} What settlement needs.
 */
async function refundReady(order) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: order.id } })), items },
      payment,
      lines: items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `cancel-suite-${tag('refund')}`,
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

  return { refund: submitted, result }
}

/**
 * Settle a refund as `refunds.submit` settles one.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} order The order.
 * @param {{refund: object, result: object}} ready From {@link refundReady}.
 * @returns {Promise<object>} What `settleRefund` returned.
 */
function settled(world, order, ready) {
  return prisma.$transaction(async (tx) =>
    settleRefund(tx, {
      refund: ready.refund,
      order: await tx.order.findUnique({ where: { id: order.id } }),
      result: ready.result,
      organizationId: world.organization.id,
      eventStartsAt: world.event.startsAt,
      actorId: owner.id,
      now: new Date(),
    }),
  )
}

/**
 * The night's cancellation, previewed now and sent when called.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} night The night.
 * @returns {Promise<function(): Promise<object>>} Sends it.
 */
async function nightCancellation(world, night) {
  const preview = await app.inject({
    method: 'GET',
    url: `/v1/events/${world.event.id}/sessions/${night.id}/cancellation`,
    headers: world.ownerHeaders,
  })

  expect(preview.statusCode, preview.body).toBe(200)

  const revision = (await prisma.event.findUnique({ where: { id: world.event.id } })).revision

  return () =>
    app.inject({
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
}

/**
 * The event's deletion with CANCEL_AND_REFUND, previewed now and sent when
 * called.
 *
 * @param {object} world From {@link venueWorld}.
 * @returns {Promise<function(): Promise<object>>} Sends it.
 */
async function deletion(world) {
  const preview = await app.inject({
    method: 'GET',
    url: `/v1/events/${world.event.id}/deletion`,
    headers: world.ownerHeaders,
  })

  expect(preview.statusCode, preview.body).toBe(200)
  expect(preview.json().data.outcome).toBe('CANCEL_AND_REFUND')

  const event = await prisma.event.findUnique({ where: { id: world.event.id } })

  return () =>
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
    })
}

/**
 * Switch paying at the venue on for an event, as a platform administrator.
 *
 * @param {string} eventId The event.
 * @returns {Promise<void>} Resolves once on.
 */
async function venuePaymentOn(eventId) {
  const switched = await app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/venue-payment`,
    headers: await headersFor(administrator),
    payload: {
      reason: REASON,
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    },
  })

  expect(switched.statusCode, switched.body).toBe(200)
}

/**
 * A buyer with a session.
 *
 * @param {string} label Distinguishes them.
 * @returns {Promise<{user: object, headers: object}>} The account and its headers.
 */
async function shopper(label) {
  const user = await person(label)

  return { user, headers: await headersFor(user) }
}

/**
 * Place a card order through `orders.create`.
 *
 * @param {object} who From {@link shopper}.
 * @param {string} eventId The event.
 * @param {string} ticketTypeId The tier.
 * @param {object} [extra] More of the body (`holdIds`, `paymentMethod`).
 * @returns {Promise<object>} The inject result.
 */
function placeOrder(who, eventId, ticketTypeId, extra = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: who.headers,
    payload: {
      eventId,
      buyerEmail: who.user.email,
      buyerName: who.user.displayName,
      items: [{ ticketTypeId, quantity: 1 }],
      ...extra,
    },
  })
}

/**
 * Hold one general-admission place, as nobody in particular.
 *
 * @param {string} ticketTypeId The tier.
 * @returns {Promise<object>} The inject result.
 */
function holdOne(ticketTypeId) {
  return app.inject({
    method: 'POST',
    url: '/v1/holds',
    payload: { ticketTypeId, quantity: 1 },
  })
}

/**
 * Let every live hold of a tier lapse, as the clock would.
 *
 * @param {string} ticketTypeId The tier.
 * @returns {Promise<void>} Resolves once done.
 */
async function lapseHolds(ticketTypeId) {
  await prisma.ticketHold.updateMany({
    where: { ticketTypeId, status: 'ACTIVE' },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  })
}

/**
 * The tickets of a tier that still stand or were let in.
 *
 * @param {string} ticketTypeId The tier.
 * @returns {Promise<number>} The count.
 */
function liveTicketsOf(ticketTypeId) {
  return prisma.ticket.count({
    where: {
      orderItem: { ticketTypeId },
      status: { in: ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'] },
    },
  })
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers,
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      quote: { max: 10_000, timeWindow: '1 minute' },
      paymentTerms: { max: 10_000, timeWindow: '1 minute' },
    },
  })
  await app.ready()

  buyer = await person('buyer')
  recipient = await person('recipient')
  owner = await person('owner', { role: 'ORGANIZER', privileged: true })
  scanner = await person('scanner', { role: 'ORGANIZER', privileged: true })
  administrator = await person('administrator', { role: 'ADMIN', privileged: true })
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect().catch(() => {})
})

when()('cancelling unpaid tickets against the door (SPEC3-XI §14.3 C1, C2)', () => {
  it(
    'C1. cancel against a single door confirmation with payment of the same ticket, both arrival orders, ×20: one outcome each time (the order FOR UPDATE against the door’s FOR SHARE)',
    { timeout: 240_000 },
    async () => {
      const world = await venueWorld('c1')
      const actor = await actorFor(owner)
      const tier = world.tiers[0]

      for (const cancelFirst of [true, false]) {
        for (let round = 0; round < ROUNDS; round += 1) {
          const { order, tickets } = await booking(world, { quantity: 1 })
          const [ticket] = tickets
          const body = await looked(scanner, ticket)
          const scannerActor = await actorFor(scanner)
          const soldBefore = (await tierRow(tier.id)).quantitySold
          const cancelling = () => cancel(order, [ticket], { actor })
          const door = () =>
            confirmAdmission({
              prisma,
              env: ENV,
              actor: scannerActor,
              body: { ...body, payment: { amountCents: ticket.venueDueCents } },
            })
          const [first, second] = await race(
            { table: 'Order', id: order.id },
            cancelFirst ? cancelling : door,
            cancelFirst ? door : cancelling,
          )
          const cancelled = cancelFirst ? first : second
          const admitted = cancelFirst ? second : first
          const label = `${cancelFirst ? 'cancel' : 'door'} first, round ${round}`

          expectNoDeadlock([first, second])

          const payments = await prisma.venuePayment.count({ where: { orderId: order.id } })
          const stored = await ticketRow(ticket.id)
          const sold = (await tierRow(tier.id)).quantitySold

          if (cancelFirst) {
            expect(cancelled.status, label).toBe(200)
            expect(cancelled.data.ticketCount).toBe(1)
            expect(admitted.status, `${label}: ${JSON.stringify(admitted)}`).toBe(409)
            expect(admitted.reason, label).toBe('UNPAID_CANCELLED')
            expect(payments).toBe(0)
            expect(stored.status).toBe('REVOKED')
            expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(0)
            expect(sold).toBe(soldBefore - 1)
          } else {
            expect(admitted.status, `${label}: ${JSON.stringify(admitted)}`).toBe(200)
            expect(admitted.data.outcome).toBe('ADMITTED')
            expect(cancelled.status, `${label}: ${JSON.stringify(cancelled)}`).toBe(409)
            expect(cancelled.code).toBe('VENUE_BOOKING_CHANGED')
            expect(cancelled.details.ticketIds).toEqual([ticket.id])
            expect(payments).toBe(1)
            expect(stored.status).toBe('CHECKED_IN')
            expect(sold).toBe(soldBefore)
          }
        }
      }
    },
  )

  it(
    'C2. cancel against a group confirmation naming the ticket, both arrival orders, ×20: the group changed, or the booking did (the order FOR UPDATE against the group’s FOR SHARE)',
    { timeout: 240_000 },
    async () => {
      const world = await venueWorld('c2')
      const actor = await actorFor(owner)
      const scannerActor = await actorFor(scanner)
      const tier = world.tiers[0]

      for (const cancelFirst of [true, false]) {
        for (let round = 0; round < ROUNDS; round += 1) {
          const { order, tickets } = await booking(world, { quantity: 2 })
          const [named, other] = tickets
          const pass = await groupPassFor(order)
          const group = await previewGroupAdmission({
            prisma,
            env: ENV,
            actor: scannerActor,
            body: { credential: pass.credential },
          })
          const soldBefore = (await tierRow(tier.id)).quantitySold
          const cancelling = () => cancel(order, [named], { actor })
          const door = () =>
            confirmGroupAdmission({
              prisma,
              env: ENV,
              actor: scannerActor,
              body: {
                credential: pass.credential,
                previewReference: group.previewReference,
                ticketIds: [named.id, other.id],
                paymentCents: named.venueDueCents + other.venueDueCents,
              },
            })
          const [first, second] = await race(
            { table: 'Order', id: order.id },
            cancelFirst ? cancelling : door,
            cancelFirst ? door : cancelling,
          )
          const cancelled = cancelFirst ? first : second
          const admitted = cancelFirst ? second : first
          const label = `${cancelFirst ? 'cancel' : 'group'} first, round ${round}`

          expectNoDeadlock([first, second])

          const paymentRows = await prisma.venuePayment.findMany({
            where: { orderId: order.id },
            include: { tickets: true },
          })
          const sold = (await tierRow(tier.id)).quantitySold

          if (cancelFirst) {
            expect(cancelled.status, label).toBe(200)
            expect(admitted.status, `${label}: ${JSON.stringify(admitted)}`).toBe(409)
            expect(admitted.reason ?? admitted.code, label).toBe('GROUP_CHANGED')
            expect(paymentRows).toHaveLength(0)
            expect((await ticketRow(named.id)).status).toBe('REVOKED')
            expect((await ticketRow(other.id)).status).toBe('VALID')
            expect(sold).toBe(soldBefore - 1)
          } else {
            expect(admitted.status, `${label}: ${JSON.stringify(admitted)}`).toBe(200)
            expect(cancelled.status, `${label}: ${JSON.stringify(cancelled)}`).toBe(409)
            expect(cancelled.code).toBe('VENUE_BOOKING_CHANGED')
            expect(paymentRows).toHaveLength(1)
            expect(paymentRows[0].tickets.map((row) => row.id).sort()).toEqual(
              [named.id, other.id].sort(),
            )
            expect((await ticketRow(named.id)).status).toBe('CHECKED_IN')
            expect(sold).toBe(soldBefore)
          }
        }
      }
    },
  )
})

when()('cancelling unpaid tickets against a night, the event and itself (C3–C6)', () => {
  it(
    'C3. cancel against the cancellation of the ticket’s night, both arrival orders: no deadlock, and refunds and kept never pass the online total (serialised at the night’s tier)',
    { timeout: 120_000 },
    async () => {
      for (const cancelFirst of [true, false]) {
        const world = await venueWorld(`c3${cancelFirst ? 'a' : 'b'}`, { nights: 2 })
        const { order, tickets } = await booking(world, { night: 1, quantity: 2 })
        const [named, other] = tickets
        const actor = await actorFor(owner)
        const sendNight = await nightCancellation(world, world.nights[1])
        const cancelling = () => cancel(order, [named], { actor })

        const [first, second] = await race(
          { table: 'TicketType', id: world.tiers[1].id },
          cancelFirst ? cancelling : sendNight,
          cancelFirst ? sendNight : cancelling,
        )
        const cancelled = cancelFirst ? first : second
        const night = cancelFirst ? second : first

        expectNoDeadlock([first, second])
        expect(night.status, night.body).toBe(200)

        const money = await expectWithinOnlineTotal(order.id)

        if (cancelFirst) {
          expect(cancelled.status).toBe(200)
          expect(money.kept).toBe(cancelled.data.feeKeptCents)
          expect((await ticketRow(named.id)).status).toBe('REVOKED')
          expect((await ticketRow(named.id)).venueCancellationId).toBe(
            cancelled.data.cancellationId,
          )
        } else {
          expect(cancelled.status, JSON.stringify(cancelled)).toBe(409)
          // The night's refund is asked for in its transaction and sent after
          // it: until then the booking has a refund in flight (XU8).
          expect(['VENUE_BOOKING_CHANGED', 'VENUE_NIGHT_OVER', 'REFUND_IN_PROGRESS']).toContain(
            cancelled.code,
          )
          expect(money.kept).toBe(0)
        }

        // The night's cancellation withdrew what was left and refunded the
        // rest of the online part: refunds and kept come to it exactly.
        expect(money.refunds + money.kept).toBe(money.total)
        expect((await ticketRow(other.id)).status).not.toBe('VALID')
      }
    },
  )

  it(
    'C3b. an every-night ticket cancelled against the cancellation of another night of the same order, both arrival orders: no deadlock, nothing past the online total (the order FOR UPDATE in both)',
    { timeout: 120_000 },
    async () => {
      for (const cancelFirst of [true, false]) {
        const world = await venueWorld(`c3e${cancelFirst ? 'a' : 'b'}`, {
          nights: 3,
          everyNight: true,
        })
        const { order, tickets } = await booking(world, {
          lines: [
            { ticketTypeId: world.everyNightTier.id, quantity: 1, unitPriceCents: PRICE },
            { ticketTypeId: world.tiers[1].id, quantity: 1, unitPriceCents: PRICE },
          ],
        })
        const pass = tickets.find((ticket) =>
          order.items.some(
            (item) =>
              item.id === ticket.orderItemId && item.ticketTypeId === world.everyNightTier.id,
          ),
        )
        const actor = await actorFor(owner)
        const sendNight = await nightCancellation(world, world.nights[1])
        const cancelling = () => cancel(order, [pass], { actor })

        const [first, second] = await race(
          { table: 'Order', id: order.id },
          cancelFirst ? cancelling : sendNight,
          cancelFirst ? sendNight : cancelling,
        )

        expectNoDeadlock([first, second])

        const night = cancelFirst ? second : first
        const cancelled = cancelFirst ? first : second

        expect(night.status, night.body).toBe(200)
        expect([200, 409]).toContain(cancelled.status)
        await expectWithinOnlineTotal(order.id)
      }
    },
  )

  it(
    'C3c. a whole refund settling against the cancellation of the booking’s night, and against the deletion, both arrival orders: no deadlock (the order’s night before the order)',
    { timeout: 120_000 },
    async () => {
      for (const against of ['night', 'deletion']) {
        for (const settleFirst of [true, false]) {
          const world = await venueWorld(`c3c${against}${settleFirst ? 'a' : 'b'}`, { nights: 2 })
          const { order } = await booking(world, { night: 1, quantity: 2 })
          const ready = await refundReady(order)
          const other =
            against === 'night'
              ? await nightCancellation(world, world.nights[1])
              : await deletion(world)
          const settling = () => settled(world, order, ready)

          const [first, second] = await race(
            { table: 'Order', id: order.id },
            settleFirst ? settling : other,
            settleFirst ? other : settling,
          )

          expectNoDeadlock([first, second])

          const money = await expectWithinOnlineTotal(order.id)

          expect(money.refunds).toBe(order.totalCents)
        }
      }
    },
  )

  it(
    'C4. cancel against deleting the event with CANCEL_AND_REFUND, both arrival orders: no deadlock; the deletion refunds everything but the kept share (serialised at the tier)',
    { timeout: 120_000 },
    async () => {
      for (const cancelFirst of [true, false]) {
        const world = await venueWorld(`c4${cancelFirst ? 'a' : 'b'}`)
        const { order, tickets } = await booking(world, { quantity: 2 })
        const [named, other] = tickets
        const actor = await actorFor(owner)
        const sendDeletion = await deletion(world)
        const cancelling = () => cancel(order, [named], { actor })

        const [first, second] = await race(
          { table: 'TicketType', id: world.tiers[0].id },
          cancelFirst ? cancelling : sendDeletion,
          cancelFirst ? sendDeletion : cancelling,
        )
        const cancelled = cancelFirst ? first : second
        const deleted = cancelFirst ? second : first

        expectNoDeadlock([first, second])
        expect(deleted.status, deleted.body).toBe(200)

        const after = await orderRow(order.id)
        const money = await expectWithinOnlineTotal(order.id)

        if (cancelFirst) {
          expect(cancelled.status).toBe(200)
          expect(cancelled.data.feeKeptCents).toBeGreaterThan(0)
          expect(money.refunds).toBe(order.totalCents - cancelled.data.feeKeptCents)
        } else {
          expect(cancelled.status, JSON.stringify(cancelled)).toBe(409)
          expect(cancelled.code).toBe('VENUE_CANCEL_NOT_LIVE')
          expect(money.kept).toBe(0)
          expect(money.refunds).toBe(order.totalCents)
        }

        // `order_venue_kept_within_total` held: refunded and kept make the total.
        expect(after.refundedCents + after.venueFeeKeptCents).toBe(after.totalCents)
        expect((await ticketRow(other.id)).status).not.toBe('VALID')
      }
    },
  )

  it(
    'C5. cancel, the night’s cancellation and the deletion at once, every arrival order, ×20: no deadlock, every ticket ends one way, nothing past the online total',
    { timeout: 300_000 },
    async () => {
      const orders = [
        ['cancel', 'night', 'delete'],
        ['cancel', 'delete', 'night'],
        ['night', 'cancel', 'delete'],
        ['night', 'delete', 'cancel'],
        ['delete', 'cancel', 'night'],
        ['delete', 'night', 'cancel'],
      ]
      for (let round = 0; round < ROUNDS; round += 1) {
        const arrival = orders[round % orders.length]
        const world = await venueWorld(`c5r${round}`, { nights: 2 })
        const actor = await actorFor(owner)
        const { order, tickets } = await booking(world, { night: 1, quantity: 2 })
        const [named] = tickets
        const sides = {
          cancel: () => cancel(order, [named], { actor }),
          night: await nightCancellation(world, world.nights[1]),
          delete: await deletion(world),
        }
        const results = await race(
          { table: 'TicketType', id: world.tiers[1].id },
          ...arrival.map((name) => sides[name]),
        )
        const by = Object.fromEntries(arrival.map((name, index) => [name, results[index]]))
        const label = `${arrival.join(' → ')}, round ${round}`

        expectNoDeadlock(results)
        // The night and the deletion both hold the event first: the second
        // of them finds it changed.
        expect(
          [by.night.status, by.delete.status].filter((status) => status === 200).length,
          `${label}: ${JSON.stringify(by)}`,
        ).toBeGreaterThanOrEqual(1)

        for (const ticket of tickets) {
          const stored = await ticketRow(ticket.id)

          expect(['VALID', 'TRANSFER_PENDING'], label).not.toContain(stored.status)
          expect(stored.revokedReason ?? stored.status, label).toBeTruthy()
          // Cancelled as unpaid exactly when the cancellation's mark is on it.
          expect(
            (stored.revokedReason ?? '').startsWith('venue-unpaid:'),
            `${label}: ${JSON.stringify(stored)}`,
          ).toBe(stored.venueCancellationId !== null)
        }

        if (by.cancel.status === 200) {
          expect((await ticketRow(named.id)).venueCancellationId).toBe(
            by.cancel.data.cancellationId,
          )
        }

        await expectWithinOnlineTotal(order.id)
      }
    },
  )

  it(
    'C6. two cancels at once: the same tickets are written once; disjoint tickets of one order both go through, and together they keep the whole fee exactly (serialised at the tier)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c6')
      const actor = await actorFor(owner)

      // The same set: one cancellation written, the other answers it again.
      {
        const { order, tickets } = await booking(world, { quantity: 2 })
        const [named] = tickets
        const results = await race(
          { table: 'Order', id: order.id },
          () => cancel(order, [named], { actor }),
          () => cancel(order, [named], { actor }),
        )

        expectNoDeadlock(results)
        expect(await prisma.venueBookingCancellation.count({ where: { orderId: order.id } })).toBe(
          1,
        )
        expect(results[0].status).toBe(200)
        expect(results[0].data.replayed).toBe(false)

        if (results[1].status === 200) {
          expect(results[1].data).toMatchObject({
            replayed: true,
            cancellationId: results[0].data.cancellationId,
          })
        } else {
          expect(results[1].status).toBe(409)
        }
      }

      // Disjoint sets that together are the whole booking: the fee is kept in
      // full, to the cent, whichever goes first.
      for (const quantity of [3, 7]) {
        const { order, tickets } = await booking(world, { quantity })
        const [one, ...rest] = tickets
        const results = await race(
          { table: 'TicketType', id: world.tiers[0].id },
          () => cancel(order, [one], { actor }),
          () => cancel(order, rest, { actor }),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])

        const after = await orderRow(order.id)

        expect(results[0].data.feeKeptCents + results[1].data.feeKeptCents).toBe(order.feesCents)
        expect(after.venueFeeKeptCents).toBe(order.feesCents)
        expect(after.venueCancelledBasisCents).toBe(order.venueDueCents)
        expect(after.items[0].venueCancelledQuantity).toBe(quantity)
      }

      // Disjoint sets that leave a ticket standing: both go through, and only a
      // share of the fee is kept.
      {
        const { order, tickets } = await booking(world, { quantity: 3 })
        const results = await race(
          { table: 'TicketType', id: world.tiers[0].id },
          () => cancel(order, [tickets[0]], { actor }),
          () => cancel(order, [tickets[1]], { actor }),
        )

        expectNoDeadlock(results)
        expect(results.map((result) => result.status)).toEqual([200, 200])

        const after = await orderRow(order.id)

        expect(after.venueFeeKeptCents).toBeLessThan(order.feesCents)
        expect((await ticketRow(tickets[2].id)).status).toBe('VALID')
      }
    },
  )
})

when()('cancelling unpaid tickets against passing them on and refunds (C7, C8, C14)', () => {
  /**
   * Offer a ticket to the suite's recipient as its buyer.
   *
   * @param {object} ticket The ticket.
   * @param {object} headers The buyer's headers.
   * @returns {Promise<object>} The response.
   */
  function offer(ticket, headers) {
    return app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers,
      payload: { toEmail: recipient.email },
    })
  }

  it(
    'C7. cancel against a transfer acceptance of the same ticket, both arrival orders: the successor stands or the ticket is cancelled, never a live successor of a cancelled ticket (the order line FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c7')
      const actor = await actorFor(owner)
      const buyerHeaders = await headersFor(buyer)
      const recipientHeaders = await headersFor(recipient)

      for (const cancelFirst of [true, false]) {
        const { order, tickets } = await booking(world, { quantity: 1 })
        const [ticket] = tickets
        const offered = await offer(ticket, buyerHeaders)

        expect(offered.statusCode, offered.body).toBe(201)

        const token = offered.json().data.delivery.invitationCode
        const cancelling = () => cancel(order, [ticket], { actor })
        const accepting = () =>
          app.inject({
            method: 'POST',
            url: '/v1/ticket-transfers/accept',
            headers: recipientHeaders,
            payload: { token },
          })
        const [first, second] = await race(
          { table: 'OrderItem', id: ticket.orderItemId },
          cancelFirst ? cancelling : accepting,
          cancelFirst ? accepting : cancelling,
        )
        const cancelled = cancelFirst ? first : second
        const accepted = cancelFirst ? second : first

        expectNoDeadlock([first, second])

        const successors = await prisma.ticket.findMany({
          where: { supersedesTicketId: ticket.id },
        })

        if (cancelFirst) {
          expect(cancelled.status).toBe(200)
          expect(accepted.status, accepted.body).toBe(409)
          expect((await ticketRow(ticket.id)).status).toBe('REVOKED')
          expect(successors).toEqual([])
          expect(
            await prisma.ticketTransfer.count({
              where: { ticketId: ticket.id, status: 'PENDING' },
            }),
          ).toBe(0)
        } else {
          expect(accepted.status, accepted.body).toBe(200)
          expect(cancelled.status, JSON.stringify(cancelled)).toBe(409)
          expect(cancelled.code).toBe('VENUE_BOOKING_CHANGED')
          expect((await ticketRow(ticket.id)).status).toBe('TRANSFERRED')
          expect(successors).toHaveLength(1)
          expect(successors[0]).toMatchObject({
            status: 'VALID',
            venueDueCents: ticket.venueDueCents,
            venueCancellationId: null,
          })
        }
      }
    },
  )

  /**
   * The event's deletion with the outcome its preview gives (a booking that
   * paid nothing online leaves nothing to refund, so REMOVE), previewed now
   * and sent when called.
   *
   * @param {object} world From {@link venueWorld}.
   * @returns {Promise<function(): Promise<object>>} Sends it.
   */
  async function deletionAsPreviewed(world) {
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/deletion`,
      headers: world.ownerHeaders,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const { outcome } = preview.json().data
    const event = await prisma.event.findUnique({ where: { id: world.event.id } })

    expect(outcome).toBeTruthy()

    return () =>
      app.inject({
        method: 'POST',
        url: `/v1/events/${world.event.id}/delete`,
        headers: world.ownerHeaders,
        payload: {
          revision: event.revision,
          reason: REASON,
          confirmSlug: event.slug,
          expectedOutcome: outcome,
        },
      })
  }

  it(
    'C7b. a night’s cancellation, and the event’s deletion, against a transfer acceptance of a ticket on that night, both arrival orders: no deadlock, and no ticket left standing — the successor withdrawn too, or the acceptance refused (the paid orders’ lines FOR KEY SHARE, then the tickets read again, SPEC3-XI §2.3.1, §2.3.2)',
    { timeout: 120_000 },
    async () => {
      const buyerHeaders = await headersFor(buyer)
      const recipientHeaders = await headersFor(recipient)

      for (const ender of ['night', 'deletion']) {
        for (const enderFirst of [true, false]) {
          const label = `${ender} ${enderFirst ? 'first' : 'second'}`
          // Two nights, so the second can be cancelled; the booking is for it.
          const world = await venueWorld(`c7b${ender[0]}${enderFirst ? 'f' : 's'}`, {
            nights: 2,
          })
          const night = world.nights[1]
          // A booking whose fee a referral code waived: nothing to refund
          // online (the night's ZERO plan), so no refund settling afterwards
          // can withdraw a ticket the cancellation itself missed.
          const { row: referralCode } = await referralCodeFixture(prisma, {
            createdById: administrator.id,
          })
          const { order, tickets } = await atVenueOrder(
            prisma,
            { event: world.event, session: night, tiers: {}, promoCode: null },
            {
              tag: tag('waived'),
              payments,
              credentialSecret: SECRET,
              userId: buyer.id,
              lines: [{ ticketTypeId: world.tiers[1].id, quantity: 1, unitPriceCents: PRICE }],
              referralCode,
              waived: true,
            },
          )
          const [ticket] = tickets

          expect(order.totalCents).toBe(0)

          const offered = await offer(ticket, buyerHeaders)

          expect(offered.statusCode, offered.body).toBe(201)

          const token = offered.json().data.delivery.invitationCode
          const ending =
            ender === 'night'
              ? await nightCancellation(world, night)
              : await deletionAsPreviewed(world)
          const accepting = () =>
            app.inject({
              method: 'POST',
              url: '/v1/ticket-transfers/accept',
              headers: recipientHeaders,
              payload: { token },
            })
          // The ticket held from outside: an acceptance arriving first holds
          // the line and waits here for the ticket; a cancellation or a
          // deletion arriving first holds the line `FOR KEY SHARE` and waits
          // here to withdraw the ticket.
          const [first, second] = await race(
            { table: 'Ticket', id: ticket.id },
            enderFirst ? ending : accepting,
            enderFirst ? accepting : ending,
          )
          const ended = enderFirst ? first : second
          const accepted = enderFirst ? second : first

          expectNoDeadlock([first, second])
          expect(ended.status, `${label}: ${ended.body}`).toBe(200)

          if (ender === 'night') {
            expect((await prisma.eventSession.findUnique({ where: { id: night.id } })).status).toBe(
              'CANCELLED',
            )
          }

          const successors = await prisma.ticket.findMany({
            where: { supersedesTicketId: ticket.id },
          })
          const standing = await prisma.ticket.count({
            where: {
              orderItemId: ticket.orderItemId,
              status: { in: ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'] },
            },
          })

          expect(standing, label).toBe(0)

          if (enderFirst) {
            expect(accepted.status, `${label}: ${accepted.body}`).toBeGreaterThanOrEqual(400)
            expect(accepted.status, `${label}: ${accepted.body}`).toBeLessThan(500)
            expect((await ticketRow(ticket.id)).status, label).toBe('CANCELLED')
            expect(successors, label).toEqual([])
          } else {
            expect(accepted.status, `${label}: ${accepted.body}`).toBe(200)
            expect((await ticketRow(ticket.id)).status, label).toBe('TRANSFERRED')
            expect(successors, label).toHaveLength(1)
            expect(successors[0].status, label).toBe('CANCELLED')
          }

          expect(
            await prisma.ticketTransfer.count({
              where: { ticketId: ticket.id, status: 'PENDING' },
            }),
            label,
          ).toBe(0)
        }
      }
    },
  )

  it(
    'C7c. a night’s cancellation, and the event’s deletion, against a transfer offer of a ticket on that night, both arrival orders: the ticket is withdrawn and no offer is left PENDING on it — an offer committed while the withdrawal waited on the ticket is ended with it (offers ended from what the conditional update withdrew, never from a read before it)',
    { timeout: 120_000 },
    async () => {
      const buyerHeaders = await headersFor(buyer)

      for (const ender of ['night', 'deletion']) {
        for (const offerFirst of [true, false]) {
          const label = `${ender}, offer ${offerFirst ? 'first' : 'second'}`
          // Two nights, so the second can be cancelled; the booking is for it.
          const world = await venueWorld(`c7c${ender[0]}${offerFirst ? 'f' : 's'}`, {
            nights: 2,
          })
          const night = world.nights[1]
          // A booking whose fee a referral code waived: nothing to refund
          // online, so no refund settling afterwards touches the ticket, and
          // what is left is what the withdrawal itself did.
          const { row: referralCode } = await referralCodeFixture(prisma, {
            createdById: administrator.id,
          })
          const { order, tickets } = await atVenueOrder(
            prisma,
            { event: world.event, session: night, tiers: {}, promoCode: null },
            {
              tag: tag('waived'),
              payments,
              credentialSecret: SECRET,
              userId: buyer.id,
              lines: [{ ticketTypeId: world.tiers[1].id, quantity: 1, unitPriceCents: PRICE }],
              referralCode,
              waived: true,
            },
          )
          const [ticket] = tickets

          expect(order.totalCents).toBe(0)
          expect(ticket.status).toBe('VALID')

          const ending =
            ender === 'night'
              ? await nightCancellation(world, night)
              : await deletionAsPreviewed(world)
          const offering = () => offer(ticket, buyerHeaders)
          // The ticket held from outside. An offer arriving first waits here
          // for the ticket's lock and commits as soon as it is let go; the
          // cancellation or deletion behind it has already read the ticket as
          // VALID and waits here to withdraw it. Arriving first, the ending
          // withdraws the ticket and the offer finds it gone.
          const [first, second] = await race(
            { table: 'Ticket', id: ticket.id },
            offerFirst ? offering : ending,
            offerFirst ? ending : offering,
          )
          const offered = offerFirst ? first : second
          const ended = offerFirst ? second : first

          expectNoDeadlock([first, second])
          expect(ended.status, `${label}: ${ended.body}`).toBe(200)

          if (offerFirst) {
            expect(offered.status, `${label}: ${offered.body}`).toBe(201)
          } else {
            expect(offered.status, `${label}: ${offered.body}`).toBe(409)
          }

          const after = await ticketRow(ticket.id)

          expect(after.status, label).toBe('CANCELLED')
          expect(after.credentialHash, label).toBeNull()

          // Never a PENDING offer on a ticket that no longer stands (the
          // invariant C14 holds for a cancellation of unpaid tickets).
          const offers = await prisma.ticketTransfer.findMany({ where: { ticketId: ticket.id } })

          expect(
            offers.filter((row) => row.status === 'PENDING'),
            label,
          ).toEqual([])

          if (offerFirst) {
            expect(
              offers.map((row) => row.status),
              label,
            ).toEqual(['CANCELLED'])
            expect(offers[0].cancelledAt, label).not.toBeNull()
          } else {
            expect(offers, label).toEqual([])
          }
        }
      }
    },
  )

  it(
    'C7d. the holder a ticket was passed to reads why it was cancelled, on their wallet and their ticket, and never who by name (SPEC3-XI XU10, §9.11)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c7d')
      const actor = await actorFor(owner)
      const buyerHeaders = await headersFor(buyer)
      const recipientHeaders = await headersFor(recipient)
      const { order, tickets } = await booking(world, { quantity: 1 })
      const [ticket] = tickets
      const offered = await offer(ticket, buyerHeaders)

      expect(offered.statusCode, offered.body).toBe(201)

      const accepted = await app.inject({
        method: 'POST',
        url: '/v1/ticket-transfers/accept',
        headers: recipientHeaders,
        payload: { token: offered.json().data.delivery.invitationCode },
      })

      expect(accepted.statusCode, accepted.body).toBe(200)

      const [successor] = await prisma.ticket.findMany({
        where: { supersedesTicketId: ticket.id },
      })

      await cancel(order, [successor], { actor })

      const wallet = await app.inject({
        method: 'GET',
        url: '/v1/tickets',
        headers: recipientHeaders,
      })
      const one = await app.inject({
        method: 'GET',
        url: `/v1/tickets/${successor.id}`,
        headers: recipientHeaders,
      })

      expect(wallet.statusCode, wallet.body).toBe(200)
      expect(one.statusCode, one.body).toBe(200)

      const expected = { at: expect.any(String), by: 'ORGANISER', reason: REASON }
      const row = wallet.json().data.find((candidate) => candidate.id === successor.id)

      expect(row.venuePayment.cancelled).toEqual(expected)
      expect(one.json().data.ticket.venuePayment.cancelled).toEqual(expected)
      // The cancellation's marker (`venue-unpaid:<id>`) is not a reason anybody
      // gave, so the wallet does not offer it as one.
      expect(row.revokedReason).toBeNull()
    },
  )

  it(
    'C8. cancel against refunds.request on the same order, both arrival orders: REFUND_IN_PROGRESS, or the refund leaves the kept share out (the order FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c8')
      const actor = await actorFor(owner)

      for (const cancelFirst of [true, false]) {
        const { order, tickets } = await booking(world, { quantity: 2 })
        const [named] = tickets
        const [item] = order.items
        const cancelling = () => cancel(order, [named], { actor })
        const requesting = () =>
          app.inject({
            method: 'POST',
            url: `/v1/orders/${order.reference}/refunds`,
            headers: world.ownerHeaders,
            payload: {
              lines: [{ orderItemId: item.id, quantity: 1 }],
              reason: 'CUSTOMER_REQUEST',
              idempotencyKey: `c8-${tag('refund')}`,
            },
          })
        const [first, second] = await race(
          { table: 'Order', id: order.id },
          cancelFirst ? cancelling : requesting,
          cancelFirst ? requesting : cancelling,
        )
        const cancelled = cancelFirst ? first : second
        const requested = cancelFirst ? second : first

        expectNoDeadlock([first, second])
        expect(requested.status, requested.body).toBe(201)

        const money = await expectWithinOnlineTotal(order.id)

        if (cancelFirst) {
          expect(cancelled.status).toBe(200)
          // The last ticket's refund is everything left: the total less the
          // fee kept for the cancelled one.
          expect(requested.data.amountCents).toBe(order.totalCents - cancelled.data.feeKeptCents)
          expect(money.refunds + money.kept).toBe(order.totalCents)
        } else {
          expect(cancelled.status, JSON.stringify(cancelled)).toBe(409)
          expect(cancelled.code).toBe('REFUND_IN_PROGRESS')
          expect(money.kept).toBe(0)
          expect((await ticketRow(named.id)).status).toBe('VALID')
        }
      }
    },
  )

  it(
    'C14. cancel against an offer to pass the same ticket on, both arrival orders, ×20: the offer is withdrawn with the ticket, or refused; never a pending offer on a cancelled ticket (the ticket FOR UPDATE)',
    { timeout: 240_000 },
    async () => {
      const world = await venueWorld('c14')
      const actor = await actorFor(owner)
      const buyerHeaders = await headersFor(buyer)

      for (const cancelFirst of [true, false]) {
        for (let round = 0; round < ROUNDS; round += 1) {
          const { order, tickets } = await booking(world, { quantity: 1 })
          const [ticket] = tickets
          const cancelling = () => cancel(order, [ticket], { actor })
          const offering = () => offer(ticket, buyerHeaders)
          const [first, second] = await race(
            { table: 'Ticket', id: ticket.id },
            cancelFirst ? cancelling : offering,
            cancelFirst ? offering : cancelling,
          )
          const cancelled = cancelFirst ? first : second
          const offered = cancelFirst ? second : first
          const label = `${cancelFirst ? 'cancel' : 'offer'} first, round ${round}`

          expectNoDeadlock([first, second])
          expect(cancelled.status, `${label}: ${JSON.stringify(cancelled)}`).toBe(200)
          expect((await ticketRow(ticket.id)).status).toBe('REVOKED')

          const transfers = await prisma.ticketTransfer.findMany({
            where: { ticketId: ticket.id },
          })

          expect(
            transfers.filter((row) => row.status === 'PENDING'),
            label,
          ).toEqual([])

          if (cancelFirst) {
            expect(offered.status, `${label}: ${offered.body}`).toBe(409)
            expect(transfers, label).toEqual([])
          } else {
            expect(offered.status, `${label}: ${offered.body}`).toBe(201)
            expect(
              transfers.map((row) => row.status),
              label,
            ).toEqual(['CANCELLED'])
          }
        }
      }
    },
  )
})

when()('the places a cancellation gives back (C9–C13, C15)', () => {
  it(
    'C9. a place given back by a tier of one: two buyers racing for it through holds, then through orders.create, get it once (the tier FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c9', { quantityTotal: 1 })
      const tier = world.tiers[0]
      const { order, tickets } = await booking(world, { quantity: 1 })

      expect((await tierRow(tier.id)).quantitySold).toBe(1)

      const refused = await holdOne(tier.id)

      expect(refused.statusCode, refused.body).toBe(409)

      const cancelled = await outcome(cancel(order, tickets))

      expect(cancelled.status).toBe(200)
      expect(cancelled.data.placesReturned).toEqual({ [tier.id]: 1 })
      expect(cancelled.data.placesOnSale).toBe('ALL')
      expect((await tierRow(tier.id)).quantitySold).toBe(0)

      // Through the hold path.
      const holds = await race(
        { table: 'TicketType', id: tier.id },
        () => holdOne(tier.id),
        () => holdOne(tier.id),
      )

      expectNoDeadlock(holds)
      expect(holds.map((result) => result.status).sort()).toEqual([201, 409])

      // Through checkout, once the hold has lapsed.
      await lapseHolds(tier.id)

      const buyers = [await shopper('c9a'), await shopper('c9b')]
      const placed = await race(
        { table: 'TicketType', id: tier.id },
        () => placeOrder(buyers[0], world.event.id, tier.id),
        () => placeOrder(buyers[1], world.event.id, tier.id),
      )

      expectNoDeadlock(placed)
      expect(placed.map((result) => result.status).sort()).toEqual([201, 409])

      const stored = await tierRow(tier.id)

      expect(stored.quantitySold).toBeLessThanOrEqual(stored.quantityTotal)
      expect(stored.quantitySold).toBeGreaterThanOrEqual(await liveTicketsOf(tier.id))
      expect(stored.quantitySold).toBe(1)
    },
  )

  it(
    'C10. a seat given back: two buyers racing for it through the seat-hold path, one wins, and a sale of it keeps one live ticket on the seat (Ticket_eventSeatId_live_key)',
    { timeout: 120_000 },
    async () => {
      const seated = await seatedWorld('c10')
      const first = await shopper('c10owner')
      const held = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${seated.session.id}/holds`,
        headers: first.headers,
        payload: { seatIds: [seated.seatId] },
      })

      expect(held.statusCode, held.body).toBe(201)

      const booked = await placeOrder(first, seated.event.id, seated.tier.id, {
        holdIds: [held.json().data.id],
        paymentMethod: 'AT_VENUE',
      })

      expect(booked.statusCode, booked.body).toBe(201)

      const order = await prisma.order.findUnique({ where: { id: booked.json().data.id } })
      const [ticket] = await prisma.ticket.findMany({ where: { orderItem: { orderId: order.id } } })

      expect(ticket.eventSeatId).toBe(seated.eventSeatId)

      const cancelled = await outcome(cancel(order, [ticket]))

      expect(cancelled.status, JSON.stringify(cancelled)).toBe(200)
      expect(cancelled.data.seatsReturned).toBe(1)
      expect(
        await prisma.eventSeat.findUnique({ where: { id: seated.eventSeatId } }),
      ).toMatchObject({
        status: 'AVAILABLE',
        holdId: null,
      })

      const racers = [await shopper('c10a'), await shopper('c10b')]
      const holds = await race(
        { table: 'EventSession', id: seated.session.id },
        ...racers.map(
          (racer) => () =>
            app.inject({
              method: 'POST',
              url: `/v1/sessions/${seated.session.id}/holds`,
              headers: racer.headers,
              payload: { seatIds: [seated.seatId] },
            }),
        ),
      )

      expectNoDeadlock(holds)
      expect(holds.map((result) => result.status).sort()).toEqual([201, 422])
      expect(holds.find((result) => result.status === 422).code).toBe('SEAT_UNAVAILABLE')

      const winner = racers[holds.findIndex((result) => result.status === 201)]
      const winning = holds.find((result) => result.status === 201)
      const sold = await placeOrder(winner, seated.event.id, seated.tier.id, {
        holdIds: [winning.data.id],
      })

      expect(sold.statusCode, sold.body).toBe(201)
      expect(
        await prisma.ticket.findMany({
          where: {
            eventSeatId: seated.eventSeatId,
            status: { in: ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'] },
          },
        }),
      ).toHaveLength(1)
      expect(
        await prisma.eventSeat.findUnique({ where: { id: seated.eventSeatId } }),
      ).toMatchObject({
        status: 'SOLD',
      })
    },
  )

  it(
    'C11. one of two cancelled, then the event deleted: the refund is exactly the other share, refunded and kept make the total, the ledger balances and the fee kept belongs to The Desi Events',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c11')
      const { order, tickets } = await booking(world, { quantity: 2 })
      const cancelled = await cancel(order, [tickets[0]])

      expect(cancelled.feeKeptCents).toBeGreaterThan(0)
      expect(cancelled.feeKeptCents).toBeLessThan(order.feesCents)

      const sendDeletion = await deletion(world)
      const deleted = await sendDeletion()

      expect(deleted.statusCode, deleted.body).toBe(200)

      const refunds = await prisma.refund.findMany({ where: { orderId: order.id } })

      expect(refunds).toHaveLength(1)
      expect(refunds[0]).toMatchObject({
        status: 'SUCCEEDED',
        amountCents: order.totalCents - cancelled.feeKeptCents,
      })

      const after = await orderRow(order.id)

      expect(after.refundedCents + after.venueFeeKeptCents).toBe(after.totalCents)
      expect(after.venueFeeKeptCents).toBe(cancelled.feeKeptCents)
      expect(
        (await findImbalances(prisma, { organizationId: world.organization.id })).imbalances,
      ).toEqual([])

      // What the fee revenue of The Desi Events holds of this order, net: the fee kept.
      const entries = await prisma.ledgerEntry.findMany({
        where: {
          account: { code: 'platform_fee_revenue' },
          batch: {
            OR: [{ orderId: order.id }, { refundId: { in: refunds.map((row) => row.id) } }],
          },
        },
      })
      const net = entries.reduce(
        (sum, entry) =>
          sum + (entry.direction === 'CREDIT' ? entry.amountCents : -entry.amountCents),
        0,
      )

      expect(net).toBe(cancelled.feeKeptCents)
    },
  )

  it(
    'C12. a night of two filled by two unpaid tickets: one cancelled, then a hold for it succeeds once and a second is refused, and the same through orders.create (the night FOR UPDATE)',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c12', { capacity: 2 })
      const tier = world.tiers[0]
      const night = world.nights[0]
      const { order, tickets } = await booking(world, { quantity: 2 })

      expect((await holdOne(tier.id)).statusCode).toBe(409)
      expect((await outcome(cancel(order, [tickets[0]]))).status).toBe(200)

      const holds = await race(
        { table: 'EventSession', id: night.id },
        () => holdOne(tier.id),
        () => holdOne(tier.id),
      )

      expectNoDeadlock(holds)
      expect(holds.map((result) => result.status).sort()).toEqual([201, 409])

      await lapseHolds(tier.id)

      const buyers = [await shopper('c12a'), await shopper('c12b')]
      const placed = await race(
        { table: 'EventSession', id: night.id },
        () => placeOrder(buyers[0], world.event.id, tier.id),
        () => placeOrder(buyers[1], world.event.id, tier.id),
      )

      expectNoDeadlock(placed)
      expect(placed.map((result) => result.status).sort()).toEqual([201, 409])
      expect((await tierRow(tier.id)).quantitySold).toBe(2)
      expect(await liveTicketsOf(tier.id)).toBe(2)
    },
  )

  it(
    'C13. an event with no nights: a ticket cancelled before it ends, another refused once it has ended, and the freed place bought once',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c13', { nights: 0, quantityTotal: 2 })
      const tier = world.tiers[0]

      expect(await prisma.eventSession.count({ where: { eventId: world.event.id } })).toBe(0)

      const { order, tickets } = await booking(world, { quantity: 2 })
      const first = await outcome(cancel(order, [tickets[0]]))

      expect(first.status, JSON.stringify(first)).toBe(200)

      const late = await outcome(
        cancel(order, [tickets[1]], { now: new Date(world.event.endsAt.getTime() + 60_000) }),
      )

      expect(late.status).toBe(409)
      expect(late.code).toBe('VENUE_NIGHT_OVER')
      expect((await ticketRow(tickets[1].id)).status).toBe('VALID')

      const buyers = [await shopper('c13a'), await shopper('c13b')]
      const placed = await race(
        { table: 'TicketType', id: tier.id },
        () => placeOrder(buyers[0], world.event.id, tier.id),
        () => placeOrder(buyers[1], world.event.id, tier.id),
      )

      expectNoDeadlock(placed)
      expect(placed.map((result) => result.status).sort()).toEqual([201, 409])
      expect((await tierRow(tier.id)).quantitySold).toBe(2)
    },
  )

  it(
    'C15. places on sale read from the database: a tier whose sales have closed answers NONE and takes no hold; moved open again, a hold goes through',
    { timeout: 120_000 },
    async () => {
      const world = await venueWorld('c15')
      const tier = world.tiers[0]
      const { order, tickets } = await booking(world, { quantity: 1 })

      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { salesEndAt: new Date(Date.now() - 60_000) },
      })

      const cancelled = await outcome(cancel(order, tickets))

      expect(cancelled.status).toBe(200)
      expect(cancelled.data.placesOnSale).toBe('NONE')

      const stored = await tierRow(tier.id)

      // In stock, but not on sale.
      expect(stored.quantitySold).toBeLessThan(stored.quantityTotal)
      expect((await holdOne(tier.id)).statusCode).toBeGreaterThanOrEqual(400)

      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { salesEndAt: new Date(Date.now() + 7 * 86_400_000) },
      })

      expect((await holdOne(tier.id)).statusCode).toBe(201)
    },
  )
})

/**
 * A seated event with one night, one reserved tier and two seats, prepared
 * and on sale, with paying at the venue switched on.
 *
 * @param {string} label Distinguishes it.
 * @returns {Promise<object>} `{ event, session, tier, seatId, eventSeatId }`.
 */
async function seatedWorld(label) {
  const world = await venueWorld(label, { nights: 0 })
  const slug = tag(label)
  const map = await prisma.venueMap.create({
    data: { venueId: world.venue.id, name: `Plan ${slug}` },
  })
  const version = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1, seatCount: 2 },
  })
  const section = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })
  const row = await prisma.seatRow.create({
    data: { venueMapVersionId: version.id, sectionId: section.id, label: 'A', sortOrder: 1 },
  })
  const zone = await prisma.priceZone.create({
    data: { venueMapVersionId: version.id, name: 'Front', sortOrder: 1 },
  })
  const seats = []

  for (const [index, seatLabel] of ['A1', 'A2'].entries()) {
    seats.push(
      await prisma.seat.create({
        data: {
          venueMapVersionId: version.id,
          sectionId: section.id,
          rowId: row.id,
          label: seatLabel,
          sortOrder: index + 1,
          priceZoneId: zone.id,
        },
      }),
    )
  }

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: world.event.id,
      startsAt: world.event.startsAt,
      endsAt: world.event.endsAt,
      timezone: 'America/Chicago',
      label: 'Night 1',
      venueMapVersionId: version.id,
    },
  })
  const tier = await prisma.ticketType.create({
    data: {
      eventId: world.event.id,
      name: `Front ${slug}`,
      priceCents: PRICE,
      currency: FEE_ORDER_CURRENCY,
      quantityTotal: 0,
      maxPerOrder: 6,
      status: 'ON_SALE',
      reserved: true,
      eventSessionId: session.id,
      priceZoneId: zone.id,
    },
  })

  // The general-admission tier the world came with is not this test's.
  await prisma.ticketType.update({ where: { id: world.tiers[0].id }, data: { status: 'CLOSED' } })
  await prepareInventory(prisma, {
    event: { ...world.event, sessions: [session] },
    sessionId: session.id,
    actor: await actorFor(owner),
  })
  await venuePaymentOn(world.event.id)

  const eventSeat = await prisma.eventSeat.findFirst({
    where: { eventSessionId: session.id, seatId: seats[0].id },
  })

  return {
    event: world.event,
    session,
    tier,
    seatId: seats[0].id,
    eventSeatId: eventSeat.id,
  }
}

/**
 * A 50 % promo code for the world's event.
 *
 * @param {object} world From {@link venueWorld}.
 * @returns {Promise<object>} The promo code row.
 */
function halfOffFor(world) {
  return prisma.promoCode.create({
    data: {
      organizationId: world.organization.id,
      eventId: world.event.id,
      code: `HALF${tag('promo')}`.toUpperCase().slice(0, 32),
      type: 'PERCENTAGE',
      value: 5000,
    },
  })
}

/**
 * A lines refund of `quantity` tickets of the order's one line, requested,
 * approved, sent and settled as `refunds.submit` settles one.
 *
 * @param {object} world From {@link venueWorld}.
 * @param {object} order The order.
 * @param {number} quantity How many tickets.
 * @returns {Promise<object>} The refund row, settled.
 */
async function lineRefundSettled(world, order, quantity) {
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } })
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } })
  const { refund } = await prisma.$transaction(async (tx) =>
    requestRefund(tx, {
      order: { ...(await tx.order.findUnique({ where: { id: order.id } })), items },
      payment,
      lines: [{ orderItemId: items[0].id, quantity }],
      reason: 'CUSTOMER_REQUEST',
      idempotencyKey: `cancel-suite-line-${tag('refund')}`,
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
  await settled(world, order, { refund: submitted, result })

  return prisma.refund.findUnique({ where: { id: refund.id } })
}

when()('the last share of a booking fee split unevenly by a promo code (C16)', () => {
  it(
    'C16. 4 × $40.01 at 50 % off: the cheaper two cancelled unpaid and the other two refunded by name, in both orders, give back or keep every cent of the fee',
    { timeout: 120_000 },
    async () => {
      for (const cancelFirst of [true, false]) {
        const world = await venueWorld(cancelFirst ? 'c16cancel' : 'c16refund')

        await prisma.ticketType.update({
          where: { id: world.tiers[0].id },
          data: { priceCents: 4_001 },
        })

        const promoCode = await halfOffFor(world)
        const { order, tickets } = await atVenueOrder(
          prisma,
          { event: world.event, session: world.nights[0], tiers: {}, promoCode },
          {
            tag: tag('booking'),
            payments,
            credentialSecret: SECRET,
            userId: buyer.id,
            withPromo: true,
            lines: [{ ticketTypeId: world.tiers[0].id, quantity: 4, unitPriceCents: 4_001 }],
          },
        )
        // The line's door price, 8002, splits 2001/2001/2000/2000 by ticket
        // but 2001/2000/2001/2000 by position: the two ways disagree by a cent.
        const dues = tickets.map((ticket) => ticket.venueDueCents)

        expect(dues).toEqual([2001, 2001, 2000, 2000])
        expect(order.feesCents).toBeGreaterThan(0)

        const cheaper = tickets.filter((ticket) => ticket.venueDueCents === 2000)
        const label = cancelFirst ? 'cancel first' : 'refund first'

        if (cancelFirst) {
          await cancel(order, cheaper)
          await lineRefundSettled(world, order, 2)
        } else {
          await lineRefundSettled(world, order, 2)
          await cancel(order, cheaper)
        }

        const money = await moneyOf(order.id)
        const row = await orderRow(order.id)

        // Every cent of the fee is either kept or given back: none stranded.
        expect(money.refunds + money.kept, `${label}: ${JSON.stringify(money)}`).toBe(
          order.totalCents,
        )

        for (const ticket of tickets) {
          expect(['REFUNDED', 'REVOKED']).toContain((await ticketRow(ticket.id)).status)
        }

        // A refund settling the last tickets ends the order REFUNDED; a
        // cancellation never moves the order (XU7), so it stays PAID with
        // nothing left to refund.
        expect(row.status, label).toBe(cancelFirst ? 'REFUNDED' : 'PAID')
        expect(row.totalCents - row.refundedCents - row.venueFeeKeptCents).toBe(0)
        expect(
          (await findImbalances(prisma, { organizationId: world.organization.id })).imbalances,
        ).toEqual([])
      }
    },
  )
})

/**
 * The buyer's notice of one cancellation, as the outbox holds it.
 *
 * @param {object} order The booking.
 * @param {'BUYER'|'HOLDER'} recipient Whose.
 * @returns {Promise<object[]>} The payloads, oldest first.
 */
async function cancellationNotices(order, recipient) {
  const rows = await prisma.notificationOutbox.findMany({
    where: { template: 'venue_booking.cancelled' },
    orderBy: { createdAt: 'asc' },
  })

  return rows
    .map((row) => row.payload)
    .filter(
      (payload) =>
        payload?.recipient === recipient &&
        payload?.eventId === order.eventId &&
        (recipient === 'HOLDER' || payload?.orderReference === order.reference),
    )
}

when()(
  'what the buyer is told about money (codes review: fee refunded by hand, tickets passed on)',
  () => {
    it(
      'C17. a booking fee refunded by hand, then an unpaid ticket cancelled, then its night cancelled: the dialog reads no fee held, and no notice says nothing was paid online',
      { timeout: 120_000 },
      async () => {
        const world = await venueWorld('c17', { nights: 2 })
        const { order, tickets } = await booking(world, { quantity: 3 })

        expect(order.totalCents).toBeGreaterThan(0)
        expect(order.feesCents).toBe(order.totalCents)

        // The finance team at The Desi Events refunds the whole booking fee by hand.
        const finance = await person(`finance${tag('c17')}`, {
          role: 'FINANCE_ADMIN',
          privileged: true,
        })
        const financeHeaders = await headersFor(finance)
        const preview = await app.inject({
          method: 'GET',
          url: `/v1/platform/orders/${order.reference}/fee`,
          headers: financeHeaders,
        })

        expect(preview.statusCode, preview.body).toBe(200)

        const figures = preview.json().data
        const refund = await app.inject({
          method: 'POST',
          url: `/v1/platform/orders/${order.reference}/fee-refund`,
          headers: financeHeaders,
          payload: {
            reason: 'Goodwill: the buyer was charged the fee twice.',
            expectedRefundableCents: figures.refundableFeeCents + figures.taxOnFeeCents,
          },
        })

        expect(refund.statusCode, refund.body).toBe(200)
        expect(refund.json().data.refund).toMatchObject({
          status: 'SUCCEEDED',
          amountCents: order.totalCents,
        })

        // The cancel dialog reads what the booking still holds, not what it paid.
        const listed = await app.inject({
          method: 'GET',
          url: `/v1/events/${world.event.id}/venue-bookings`,
          headers: world.ownerHeaders,
        })

        expect(listed.statusCode, listed.body).toBe(200)

        const [listedBooking] = listed
          .json()
          .data.bookings.filter((row) => row.orderReference === order.reference)

        expect(listedBooking).toMatchObject({ feesCents: order.feesCents, feeHeldCents: 0 })

        // One unpaid ticket cancelled: nothing is left to keep.
        const cancelled = await cancel(order, [tickets[0]])

        expect(cancelled.feeKeptCents).toBe(0)

        const [notice] = await cancellationNotices(order, 'BUYER')

        expect(notice).toMatchObject({
          ticketCount: 1,
          dueCents: PRICE,
          passedOnTickets: 0,
          passedOnDueCents: 0,
          feeKeptCents: 0,
          onlineFee: 'REFUNDED_EARLIER',
          othersRemain: true,
        })

        // The buyer's order still says it paid online, which is what the order
        // page reads to tell the two apart.
        const read = await app.inject({
          method: 'GET',
          url: `/v1/orders/${order.reference}`,
          headers: await headersFor(buyer),
        })

        expect(read.statusCode, read.body).toBe(200)
        expect(read.json().data.totalCents).toBe(order.totalCents)
        expect(read.json().data.venueCancellations).toEqual([
          expect.objectContaining({
            ticketCount: 1,
            basisCents: PRICE,
            passedOnTickets: 0,
            passedOnBasisCents: 0,
            feeKeptCents: 0,
          }),
        ])

        // Then the night itself is cancelled: the other two tickets are withdrawn.
        const nightPreview = await app.inject({
          method: 'GET',
          url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancellation`,
          headers: world.ownerHeaders,
        })

        expect(nightPreview.statusCode, nightPreview.body).toBe(200)

        const { revision } = await prisma.event.findUnique({ where: { id: world.event.id } })
        const night = await app.inject({
          method: 'POST',
          url: `/v1/events/${world.event.id}/sessions/${world.nights[0].id}/cancel`,
          headers: world.ownerHeaders,
          payload: {
            revision,
            reason: 'The band could not travel that night.',
            confirm: true,
            expectedOrders: nightPreview.json().data.orders,
          },
        })

        expect(night.statusCode, night.body).toBe(200)

        const nightNotice = await prisma.notificationOutbox.findFirst({
          where: {
            template: 'event.session_cancelled',
            dedupeKey: `session-cancelled:${world.nights[0].id}:${order.id}`,
          },
        })

        expect(nightNotice?.payload).toMatchObject({
          atVenue: true,
          outcome: 'FEE_REFUNDED_EARLIER',
          onlineRefund: 'ALREADY_REFUNDED',
        })
      },
    )

    it(
      'C18. a booking that paid nothing online, and one whose fee is still held, are told so when unpaid tickets are cancelled',
      { timeout: 120_000 },
      async () => {
        const world = await venueWorld('c18')
        const waived = await atVenueOrder(
          prisma,
          { event: world.event, session: world.nights[0], tiers: {}, promoCode: null },
          {
            tag: tag('booking'),
            payments,
            credentialSecret: SECRET,
            userId: buyer.id,
            waived: true,
            lines: [{ ticketTypeId: world.tiers[0].id, quantity: 1, unitPriceCents: PRICE }],
          },
        )
        const held = await booking(world, { quantity: 2 })

        expect(waived.order.totalCents).toBe(0)

        await cancel(waived.order, waived.tickets)
        await cancel(held.order, [held.tickets[0]])

        expect(await cancellationNotices(waived.order, 'BUYER')).toEqual([
          expect.objectContaining({ feeKeptCents: 0, onlineFee: 'NONE_PAID' }),
        ])
        expect(await cancellationNotices(held.order, 'BUYER')).toEqual([
          expect.objectContaining({ feeKeptCents: expect.any(Number), onlineFee: 'KEPT' }),
        ])
        expect((await cancellationNotices(held.order, 'BUYER'))[0].feeKeptCents).toBeGreaterThan(0)
      },
    )

    it(
      'C19. a ticket passed on and the buyer’s own cancelled together: the buyer is told only their own is no longer owed by them, and the order says how many were passed on',
      { timeout: 120_000 },
      async () => {
        const world = await venueWorld('c19')
        const { order, tickets } = await atVenueOrder(
          prisma,
          { event: world.event, session: world.nights[0], tiers: {}, promoCode: null },
          {
            tag: tag('booking'),
            payments,
            credentialSecret: SECRET,
            userId: buyer.id,
            holders: [null, recipient.id],
            lines: [{ ticketTypeId: world.tiers[0].id, quantity: 2, unitPriceCents: PRICE }],
          },
        )

        expect(tickets.map((ticket) => ticket.ownerUserId)).toEqual([buyer.id, recipient.id])

        const cancelled = await cancel(order, tickets)

        expect(cancelled).toMatchObject({ ticketCount: 2, basisCents: 2 * PRICE })

        expect(await cancellationNotices(order, 'BUYER')).toEqual([
          expect.objectContaining({
            ticketCount: 1,
            dueCents: PRICE,
            passedOnTickets: 1,
            passedOnDueCents: PRICE,
            othersRemain: false,
          }),
        ])

        const holderNotices = (await cancellationNotices(order, 'HOLDER')).filter(
          (payload) => payload.eventTitle === world.event.title,
        )

        expect(holderNotices).toEqual([
          expect.objectContaining({ ticketCount: 1, dueCents: PRICE }),
        ])

        const read = await app.inject({
          method: 'GET',
          url: `/v1/orders/${order.reference}`,
          headers: await headersFor(buyer),
        })

        expect(read.statusCode, read.body).toBe(200)
        expect(read.json().data.venueCancellations).toEqual([
          expect.objectContaining({
            ticketCount: 2,
            basisCents: 2 * PRICE,
            passedOnTickets: 1,
            passedOnBasisCents: PRICE,
          }),
        ])
      },
    )
  },
)
