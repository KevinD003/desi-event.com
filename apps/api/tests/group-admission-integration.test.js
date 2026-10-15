/**
 * Group admission at the door, against a real database.
 *
 * `tickets.test.js` proves the group routes' wiring against the stub. What is
 * here is what only PostgreSQL can answer: whether the order, group-pass and
 * ticket locks really serialise a group confirmation against another one, a
 * single-ticket confirmation, a refund and a transfer; whether the unique
 * `CheckIn.ticketId` keeps every ticket to one admission; whether the trigger
 * `desi_check_in_group_pass_matches` refuses what it says it refuses; and
 * whether mixed door and refund traffic on one order ever deadlocks.
 *
 * Every order here is bought on one line per ticket, so a refund can name the
 * exact ticket it gives back. Refunds are settled through the real
 * `settleRefund`, with the request and provider phases written directly — the
 * locking under test lives in settlement.
 *
 * Nothing is deleted afterwards, as in the sibling suites: every row carries a
 * per-run suffix, the ledger and audit log are append-only, and every row left
 * behind is a shape the services produce, so the load suite's database-wide
 * settlement invariants accept it.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/group-admission-integration
 */

import { createHash } from 'node:crypto'

import { afterAll, expect, it } from 'vitest'

import { loadActor } from '../src/lib/actor.js'
import { confirmAdmission, previewAdmission } from '../src/lib/admission.js'
import { confirmGroupAdmission, previewGroupAdmission } from '../src/lib/group-admission.js'
import { retrieveGroupPass, rotateGroupPass } from '../src/lib/group-passes.js'
import { SEAT_POLICIES, settleRefund } from '../src/lib/refunds.js'
import {
  TICKET_STATES,
  acceptTransfer,
  mintTransferToken,
  startTransfer,
} from '../src/lib/tickets.js'
import { issueTicketCredential } from '../src/lib/ticket-credentials.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the group admission suite')

/** A suffix unique to this run. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the key derivations, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

const ENV = Object.freeze({ AUTH_SECRET: SECRET })

/** What each ticket costs. */
const PRICE_CENTS = 50_000

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`group-${RUN}-${kind}-${sequence}`).digest('hex')

  return `c${BigInt(`0x${digest}`).toString(36).padEnd(24, '0').slice(0, 24)}`
}

/**
 * A short unique token.
 *
 * @returns {string} The token.
 */
function unique() {
  sequence += 1

  return `${RUN}${sequence.toString(36)}`
}

/**
 * A user.
 *
 * @param {string} label What they are for.
 * @param {string} [role] Their platform role.
 * @returns {Promise<object>} The user.
 */
function user(label, role = 'ORGANIZER') {
  return prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${unique()}@group.example`,
      displayName: label,
      passwordHash: 'not-a-hash-this-suite-never-signs-in',
      role,
      emailVerified: true,
    },
  })
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
 * An organisation, a published event, and a paid order of `count` tickets on
 * one line each, bought by `holder`'s account, with the group pass taken out.
 *
 * @param {object} [options] Options.
 * @param {number} [options.count] How many tickets.
 * @returns {Promise<object>} Everything.
 */
async function world({ count = 3 } = {}) {
  const tag = unique()
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Group Home ${tag}`,
      slug: `group-home-${tag}`,
      contactEmail: `group-${tag}@group.example`,
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Group Hall',
      slug: `group-venue-${tag}`,
      addressLine1: '1 Door Street',
      city: 'Pune',
      region: 'MH',
      postalCode: '411001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })
  const startsAt = new Date(Date.now() + 72 * 3_600_000)
  const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000)
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Group Night ${tag}`,
      slug: `group-event-${tag}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the group admission suite.',
      description: 'A party of friends, one QR, and a steward.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
    },
  })
  const session = await prisma.eventSession.create({
    data: { id: id('session'), eventId: event.id, startsAt, endsAt, timezone: 'Asia/Kolkata' },
  })
  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Standing',
      priceCents: PRICE_CENTS,
      currency: 'INR',
      quantityTotal: count,
      status: 'ON_SALE',
    },
  })
  const holder = await user('holder', 'ATTENDEE')
  const totalCents = PRICE_CENTS * count
  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-G${tag.toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'holder',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: totalCents,
      totalCents,
      paidAt: new Date(),
    },
  })
  const payment = await prisma.payment.create({
    data: {
      id: id('payment'),
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: `pi_group_${unique()}`,
      status: 'SUCCEEDED',
      amountCents: totalCents,
      currency: 'INR',
    },
  })

  const tickets = []
  const lines = []

  for (let index = 0; index < count; index += 1) {
    const line = await prisma.orderItem.create({
      data: {
        id: id(`line-${index}`),
        orderId: order.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        unitPriceCents: PRICE_CENTS,
        subtotalCents: PRICE_CENTS,
      },
    })
    const ticketId = id(`ticket-${index}`)
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId,
      version: 1,
    })
    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        orderItemId: line.id,
        code: `DET-G${unique().toUpperCase()}`,
        credentialHash,
        credentialVersion: 1,
        credentialIssuedAt: new Date(),
        attendeeName: `Guest ${index + 1}`,
        ownerUserId: holder.id,
        status: TICKET_STATES.VALID,
      },
    })

    lines.push(line)
    tickets.push({ ...ticket, credential })
  }

  const steward = await user('steward')
  const membership = await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: steward.id,
      organizationId: organization.id,
      role: 'SCANNER',
    },
  })

  await prisma.scannerScope.create({ data: { membershipId: membership.id, eventId: event.id } })

  const secondSteward = await user('second-steward')
  const secondMembership = await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: secondSteward.id,
      organizationId: organization.id,
      role: 'SCANNER',
    },
  })

  await prisma.scannerScope.create({
    data: { membershipId: secondMembership.id, eventId: event.id },
  })

  const pass = await retrieveGroupPass({
    prisma,
    env: ENV,
    actor: await actorFor(holder),
    reference: order.reference,
  })

  return {
    organization,
    event,
    session,
    ticketType,
    holder,
    order,
    payment,
    lines,
    tickets,
    steward,
    secondSteward,
    pass,
  }
}

/**
 * Run a door call and describe what came back, error or not.
 *
 * @param {Promise<object>} call A preview or confirmation.
 * @returns {Promise<{status: number, data?: object, reason?: string, message?: string}>} The outcome.
 */
async function outcome(call) {
  try {
    return { status: 200, data: await call }
  } catch (error) {
    if (typeof error?.statusCode !== 'number') throw error

    return { status: error.statusCode, reason: error.details?.reason, message: error.message }
  }
}

/**
 * Preview a group as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function groupPreviewAs(who, body) {
  return outcome(previewGroupAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Confirm a group as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function groupConfirmAs(who, body) {
  return outcome(confirmGroupAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Preview a group, assert something is admissible, and hand back a confirmation body.
 *
 * @param {object} who The user.
 * @param {object} presentation `{ credential }` or `{ code }`.
 * @param {string[]} [ticketIds] Which to admit; every admissible one by default.
 * @returns {Promise<object>} The confirmation body.
 */
async function groupPreviewed(who, presentation, ticketIds) {
  const looked = await groupPreviewAs(who, presentation)

  expect(looked.status, looked.message).toBe(200)
  expect(looked.data.previewReference).toEqual(expect.any(String))

  return {
    ...presentation,
    previewReference: looked.data.previewReference,
    ticketIds:
      ticketIds ??
      looked.data.tickets
        .filter((ticket) => ticket.outcome === 'ADMISSIBLE')
        .map((ticket) => ticket.ticketId),
  }
}

/**
 * How many admissions a set of tickets has.
 *
 * @param {Array<{id: string}>} tickets The tickets.
 * @returns {Promise<number>} The `CheckIn` count.
 */
function admissions(tickets) {
  return prisma.checkIn.count({ where: { ticketId: { in: tickets.map((ticket) => ticket.id) } } })
}

/**
 * A SUBMITTED refund of some of the world's lines, ready to settle.
 *
 * @param {object} w From {@link world}.
 * @param {Array<object>} lines Which lines.
 * @returns {Promise<object>} The refund.
 */
async function submittedRefund(w, lines) {
  const amountCents = PRICE_CENTS * lines.length

  await prisma.order.update({
    where: { id: w.order.id },
    data: { refundPendingCents: { increment: amountCents } },
  })

  return prisma.refund.create({
    data: {
      id: id('refund'),
      orderId: w.order.id,
      paymentId: w.payment.id,
      provider: 'in-memory-payments',
      amountCents,
      currency: 'INR',
      reason: 'CUSTOMER_REQUEST',
      status: 'SUBMITTED',
      idempotencyKey: id('refund-key'),
      submittedAt: new Date(),
      items: {
        create: lines.map((line) => ({
          orderItemId: line.id,
          quantity: 1,
          amountCents: PRICE_CENTS,
        })),
      },
    },
  })
}

/**
 * Settle a refund, as the route's last phase does.
 *
 * @param {object} w From {@link world}.
 * @param {object} refund The SUBMITTED refund.
 * @returns {Promise<object>} What `settleRefund` returned.
 */
function settle(w, refund) {
  return prisma.$transaction(
    async (tx) =>
      settleRefund(tx, {
        refund,
        order: await tx.order.findUnique({ where: { id: w.order.id } }),
        result: { providerRefundId: `re_${id('provider-refund')}`, rawStatus: 'SUCCEEDED' },
        organizationId: w.organization.id,
        seatPolicy: SEAT_POLICIES.RESELL,
        eventStartsAt: w.event.startsAt,
        actorId: null,
        now: new Date(),
      }),
    { timeout: 20_000, maxWait: 10_000 },
  )
}

/**
 * Wait until PostgreSQL reports a session blocked by the holder's transaction.
 *
 * @param {{pid: number}} holder From {@link holding}.
 * @returns {Promise<void>} Resolves once a session is blocked by it.
 * @throws {Error} After five seconds without one.
 */
async function untilBlocked(holder) {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    const [{ waiting }] = await prisma.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND ${holder.pid}::int = ANY (pg_blocking_pids(pid))`

    if (waiting > 0) return

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`No session was blocked by backend ${holder.pid} within five seconds.`)
}

/**
 * Hold a lock in a transaction until told to let go.
 *
 * @param {function(object): Promise<void>} take Takes the lock.
 * @returns {Promise<{release: function(): void, done: Promise<void>, pid: number}>} Once it is held.
 */
async function holding(take) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let held
  const heldPromise = new Promise((resolve) => {
    held = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

      await take(tx)
      held(pid)
      await gate
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  const pid = await heldPromise

  return { release, done, pid }
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('a group preview', () => {
  it('1. writes no admission and changes no ticket', async () => {
    const w = await world()
    const before = await prisma.ticket.findMany({
      where: { id: { in: w.tickets.map((ticket) => ticket.id) } },
      orderBy: { id: 'asc' },
    })

    const looked = await groupPreviewAs(w.steward, { credential: w.pass.credential })

    expect(looked.status, looked.message).toBe(200)
    expect(looked.data).toMatchObject({
      outcome: 'ADMISSIBLE',
      method: 'QR_SCAN',
      counts: { admissible: 3, alreadyIn: 0, refused: 0 },
    })
    expect(await admissions(w.tickets)).toBe(0)
    expect(
      await prisma.ticket.findMany({
        where: { id: { in: w.tickets.map((ticket) => ticket.id) } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before)
  })
})

when()('a group confirmation', () => {
  it('2. admits the selected tickets in one transaction, each recording the group pass', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })

    const admitted = await groupConfirmAs(w.steward, body)

    expect(admitted.status, admitted.message).toBe(200)
    expect(admitted.data).toMatchObject({ outcome: 'ADMITTED', admitted: 3, method: 'QR_SCAN' })

    const rows = await prisma.checkIn.findMany({
      where: { ticketId: { in: w.tickets.map((ticket) => ticket.id) } },
    })
    const pass = await prisma.groupPass.findUnique({ where: { orderId: w.order.id } })

    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.groupPassId === pass.id && row.method === 'QR_SCAN')).toBe(true)
    expect(
      await prisma.ticket.count({
        where: { id: { in: w.tickets.map((ticket) => ticket.id) }, status: 'CHECKED_IN' },
      }),
    ).toBe(3)
    expect(
      await prisma.auditLog.count({
        where: { action: 'ticket.group_admitted', entityId: pass.id },
      }),
    ).toBe(1)
  })

  it('3. two confirmations racing on one group admit every ticket once, and the loser is told they are in', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })

    const [first, second] = await Promise.all([
      groupConfirmAs(w.steward, body),
      groupConfirmAs(w.steward, body),
    ])

    expect([first.status, second.status]).toEqual([200, 200])
    expect([first.data.outcome, second.data.outcome].sort()).toEqual([
      'ADMITTED',
      'ALREADY_CHECKED_IN',
    ])

    const loser = first.data.outcome === 'ADMITTED' ? second.data : first.data

    expect(loser.alreadyIn).toBe(3)
    expect(loser.tickets.every((ticket) => ticket.checkedInByYou)).toBe(true)
    expect(await admissions(w.tickets)).toBe(3)
  })

  it('4. a group confirmation racing a single-ticket confirmation on an overlapping ticket admits it once', async () => {
    const w = await world()
    const [overlap] = w.tickets
    const groupBody = await groupPreviewed(w.steward, { code: w.pass.groupCode })
    const single = await outcome(
      previewAdmission({
        prisma,
        env: ENV,
        actor: await actorFor(w.secondSteward),
        body: { code: overlap.code },
      }),
    )

    expect(single.status).toBe(200)

    const [group, one] = await Promise.all([
      groupConfirmAs(w.steward, groupBody),
      outcome(
        confirmAdmission({
          prisma,
          env: ENV,
          actor: await actorFor(w.secondSteward),
          body: { code: overlap.code, previewReference: single.data.previewReference },
        }),
      ),
    ])

    expect(group.status, group.message).toBe(200)
    expect(one.status, one.message).toBe(200)
    expect(await prisma.checkIn.count({ where: { ticketId: overlap.id } })).toBe(1)
    expect(await admissions(w.tickets)).toBe(3)
  })

  it('5. a ticket refunded between preview and confirmation refuses the whole group with GROUP_CHANGED', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })

    await settle(w, await submittedRefund(w, [w.lines[1]]))

    const refused = await groupConfirmAs(w.steward, body)

    expect(refused).toMatchObject({ status: 409, reason: 'GROUP_CHANGED' })
    expect(await admissions(w.tickets)).toBe(0)
  })

  it('6. a ticket handed on between preview and confirmation refuses the group, and the next lookup shows it handed on', async () => {
    const w = await world()
    const recipient = await user('recipient', 'ATTENDEE')
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })
    const { tokenHash } = mintTransferToken()
    const started = await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket: w.tickets[2],
        toEmail: recipient.email,
        fromUserId: w.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )
    const pending = await prisma.ticket.findUnique({ where: { id: w.tickets[2].id } })
    const accepted = await prisma.$transaction((tx) =>
      acceptTransfer(tx, {
        transfer: started.transfer,
        ticket: pending,
        recipient,
        credentialSecret: SECRET,
        generateTicketCode: () => `DET-GX${unique().toUpperCase()}`,
        now: new Date(),
      }),
    )

    expect(accepted.accepted).toBe(true)

    const refused = await groupConfirmAs(w.steward, body)

    expect(refused).toMatchObject({ status: 409, reason: 'GROUP_CHANGED' })
    expect(await admissions(w.tickets)).toBe(0)

    const again = await groupPreviewAs(w.steward, { credential: w.pass.credential })
    const listed = again.data.tickets.map((ticket) => ticket.ticketId)

    expect(again.data.handedOn).toBe(1)
    expect(listed).not.toContain(accepted.ticket.id)
    expect(listed).not.toContain(w.tickets[2].id)
    expect(again.data.counts.admissible).toBe(2)
  })

  it('7. admits two of three, then the third later by the typed group code', async () => {
    const w = await world()
    const chosen = [w.tickets[0].id, w.tickets[1].id]
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential }, chosen)

    const first = await groupConfirmAs(w.steward, body)

    expect(first.data).toMatchObject({ admitted: 2, alreadyIn: 0 })

    const later = await groupPreviewAs(w.steward, { code: w.pass.groupCode })

    expect(later.data).toMatchObject({
      method: 'MANUAL_CODE',
      counts: { admissible: 1, alreadyIn: 2, refused: 0 },
    })

    const last = await groupConfirmAs(w.steward, {
      code: w.pass.groupCode,
      previewReference: later.data.previewReference,
      ticketIds: [w.tickets[2].id],
    })

    expect(last.data).toMatchObject({ admitted: 1, method: 'MANUAL_CODE' })
    expect(await prisma.checkIn.findFirst({ where: { ticketId: w.tickets[2].id } })).toMatchObject({
      method: 'MANUAL_CODE',
    })
    expect(await admissions(w.tickets)).toBe(3)
  })

  it('8. a pass replaced between preview and confirmation confirms nothing', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })

    await rotateGroupPass({
      prisma,
      env: ENV,
      actor: await actorFor(w.holder),
      reference: w.order.reference,
    })

    const refused = await groupConfirmAs(w.steward, body)

    expect(refused).toMatchObject({ status: 409, reason: 'PREVIEW_MISMATCH' })
    expect(await admissions(w.tickets)).toBe(0)
  })

  it('9. an out-of-scope scanner is told nothing; a platform super-administrator is admitted', async () => {
    const w = await world()
    const outsider = await user('outsider')
    const rival = await prisma.organization.create({
      data: {
        id: id('rival'),
        name: `Rival ${unique()}`,
        slug: `group-rival-${unique()}`,
        contactEmail: `rival-${unique()}@group.example`,
      },
    })

    await prisma.membership.create({
      data: { id: id('membership'), userId: outsider.id, organizationId: rival.id, role: 'OWNER' },
    })

    const real = await groupPreviewAs(outsider, { credential: w.pass.credential })
    const invented = await groupPreviewAs(outsider, { credential: `G1.${'Z'.repeat(43)}` })

    expect(real.status).toBe(404)
    expect(real.message).toBe(invented.message)

    const platform = await user('platform', 'SUPER_ADMIN')
    const body = await groupPreviewed(platform, { code: w.pass.groupCode })
    const admitted = await groupConfirmAs(platform, body)

    expect(admitted.status, admitted.message).toBe(200)
    expect(await admissions(w.tickets)).toBe(3)
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ticket.admission_platform_authority',
          entityType: 'Event',
          entityId: w.event.id,
        },
      }),
    ).toBe(2)
  })
})

when()('the group-pass trigger', () => {
  it('10. refuses a group admission of another order’s ticket, or of one the buyer no longer holds', async () => {
    const w = await world({ count: 2 })
    const other = await world({ count: 2 })
    const pass = await prisma.groupPass.findUnique({ where: { orderId: w.order.id } })

    await expect(
      prisma.checkIn.create({
        data: {
          ticketId: other.tickets[0].id,
          method: 'QR_SCAN',
          groupPassId: pass.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/group pass .* does not cover ticket/u)

    // Owned by somebody else now (written directly, as a writer that forgot
    // the transfer rules would): the pass's buyer no longer holds it.
    const stranger = await user('stranger', 'ATTENDEE')

    await prisma.ticket.update({
      where: { id: w.tickets[1].id },
      data: { ownerUserId: stranger.id },
    })

    await expect(
      prisma.checkIn.create({
        data: {
          ticketId: w.tickets[1].id,
          method: 'QR_SCAN',
          groupPassId: pass.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/not held by the group pass/u)

    await prisma.ticket.update({
      where: { id: w.tickets[1].id },
      data: { ownerUserId: w.holder.id },
    })

    expect(await admissions([...w.tickets, ...other.tickets])).toBe(0)
  })
})

when()('group admission against refunds', () => {
  it('11. a refund settling while a group confirmation runs never leaves a ticket both refunded and admitted', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })
    const refund = await submittedRefund(w, w.lines)

    // The confirmation holds the order FOR SHARE; the refund's order update
    // waits for it, then revokes only what is still unadmitted.
    const holder = await holding(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${w.order.id} FOR SHARE`
    })
    const confirmation = groupConfirmAs(w.steward, body)
    const settlement = settle(w, refund)

    await untilBlocked(holder)
    holder.release()
    await holder.done

    const [confirmed, settled] = await Promise.allSettled([confirmation, settlement])

    expect(settled.status).toBe('fulfilled')
    expect(confirmed.status).toBe('fulfilled')

    const after = await prisma.ticket.findMany({
      where: { id: { in: w.tickets.map((ticket) => ticket.id) } },
      include: { checkIns: true },
    })

    for (const ticket of after) {
      // Exactly one outcome per ticket: admitted, or refunded.
      expect(['CHECKED_IN', 'REFUNDED'], ticket.id).toContain(ticket.status)
      // Once: one admission row, or none.
      expect(ticket.checkIns.length, ticket.id).toBe(ticket.status === 'CHECKED_IN' ? 1 : 0)
    }
  })

  it('12. mixed group, single and refund traffic on one order never deadlocks', async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const w = await world()
      const groupBody = await groupPreviewed(w.steward, { credential: w.pass.credential })
      const single = await outcome(
        previewAdmission({
          prisma,
          env: ENV,
          actor: await actorFor(w.secondSteward),
          body: { code: w.tickets[0].code },
        }),
      )
      const refund = await submittedRefund(w, [w.lines[2]])

      const results = await Promise.allSettled([
        groupConfirmAs(w.steward, groupBody),
        outcome(
          confirmAdmission({
            prisma,
            env: ENV,
            actor: await actorFor(w.secondSteward),
            body: { code: w.tickets[0].code, previewReference: single.data.previewReference },
          }),
        ),
        settle(w, refund),
      ])

      for (const result of results) {
        const reason = result.status === 'rejected' ? result.reason : null
        const text = `${reason?.code ?? ''} ${reason?.message ?? ''}`

        expect(text, `iteration ${iteration}`).not.toMatch(/40P01|P2034|[Dd]eadlock/u)
        expect(result.status, `iteration ${iteration}: ${text}`).toBe('fulfilled')
      }

      // Each door answer is a door answer: admitted, already in, or the
      // group changed under it.
      for (const door of [results[0].value, results[1].value]) {
        expect([200, 409], `iteration ${iteration}`).toContain(door.status)
      }

      expect(await prisma.checkIn.count({ where: { ticketId: w.tickets[0].id } })).toBe(1)

      const refunded = await prisma.ticket.findUnique({
        where: { id: w.tickets[2].id },
        include: { checkIns: true },
      })

      expect(refunded.checkIns.length).toBe(refunded.status === 'CHECKED_IN' ? 1 : 0)
    }
  }, 60_000)
})

when()('a group confirmation re-reads who is asking', () => {
  /**
   * The refusal audit a group confirmation writes, for this pass.
   *
   * @param {object} w From {@link world}.
   * @returns {Promise<Array<object>>} The rows.
   */
  async function refusalsOf(w) {
    const pass = await prisma.groupPass.findUnique({ where: { orderId: w.order.id } })

    return prisma.auditLog.findMany({
      where: { action: 'ticket.admission_refused', entityType: 'GroupPass', entityId: pass.id },
    })
  }

  it('13. a scope withdrawn between the lookup and the confirmation refuses it with a 403, audited, admitting nobody', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential })

    // Still a SCANNER of the organisation, so the cheap up-front check passes;
    // only the scope for this event is gone, which only the re-read sees.
    await prisma.scannerScope.deleteMany({
      where: { membership: { userId: w.steward.id }, eventId: w.event.id },
    })

    const refused = await groupConfirmAs(w.steward, body)

    expect(refused).toMatchObject({
      status: 403,
      message: 'You are no longer authorised to admit to this event.',
    })
    expect(await admissions(w.tickets)).toBe(0)
    expect(
      await prisma.ticket.count({
        where: { id: { in: w.tickets.map((ticket) => ticket.id) }, status: 'VALID' },
      }),
    ).toBe(3)

    const audited = await refusalsOf(w)

    expect(audited).toHaveLength(1)
    expect(audited[0]).toMatchObject({
      actorId: w.steward.id,
      metadata: {
        operation: 'group_check_in',
        reason: 'NOT_AUTHORISED_FOR_EVENT',
        method: 'QR_SCAN',
      },
    })
  })

  it('14. a steward suspended between the lookup and the confirmation is refused, admitting nobody', async () => {
    const w = await world()
    const body = await groupPreviewed(w.steward, { code: w.pass.groupCode })
    // The actor as the request carried it when it started: the sign-in check
    // ran before the suspension landed.
    const actor = await actorFor(w.steward)

    await prisma.user.update({ where: { id: w.steward.id }, data: { suspendedAt: new Date() } })

    const refused = await outcome(confirmGroupAdmission({ prisma, env: ENV, actor, body }))

    expect(refused.status).toBe(403)
    expect(await admissions(w.tickets)).toBe(0)
    expect((await refusalsOf(w)).map((row) => row.metadata.reason)).toEqual([
      'NOT_AUTHORISED_FOR_EVENT',
    ])
  })
})

when()('a group lookup with somebody who no longer admits', () => {
  it('15. lists a refunded ticket as refused with its reason, and signs only the admissible ones', async () => {
    const w = await world()

    await settle(w, await submittedRefund(w, [w.lines[1]]))

    const looked = await groupPreviewAs(w.steward, { credential: w.pass.credential })

    expect(looked.status, looked.message).toBe(200)
    expect(looked.data).toMatchObject({
      outcome: 'ADMISSIBLE',
      counts: { admissible: 2, alreadyIn: 0, refused: 1 },
    })

    const byId = new Map(looked.data.tickets.map((ticket) => [ticket.ticketId, ticket]))

    expect(byId.get(w.tickets[1].id)).toMatchObject({ outcome: 'REFUSED', refusal: 'REFUNDED' })
    expect(byId.get(w.tickets[0].id)).toMatchObject({ outcome: 'ADMISSIBLE', refusal: null })

    // The reference names the two admissible tickets and not the refunded one,
    // so naming it is refused before anything is locked — as a mismatch with
    // the lookup, not as a group that changed since.
    const widened = await groupConfirmAs(w.steward, {
      credential: w.pass.credential,
      previewReference: looked.data.previewReference,
      ticketIds: [w.tickets[0].id, w.tickets[1].id],
    })

    expect(widened).toMatchObject({ status: 409, reason: 'PREVIEW_MISMATCH' })
    expect(await admissions(w.tickets)).toBe(0)

    const admitted = await groupConfirmAs(w.steward, {
      credential: w.pass.credential,
      previewReference: looked.data.previewReference,
      ticketIds: [w.tickets[0].id, w.tickets[2].id],
    })

    expect(admitted.status, admitted.message).toBe(200)
    expect(admitted.data).toMatchObject({ outcome: 'ADMITTED', admitted: 2 })
  })

  it('16. a group nobody in which admits gets no reference at all', async () => {
    const w = await world()

    await settle(w, await submittedRefund(w, w.lines))

    const looked = await groupPreviewAs(w.steward, { credential: w.pass.credential })

    expect(looked.status, looked.message).toBe(200)
    expect(looked.data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'REFUNDED',
      counts: { admissible: 0, alreadyIn: 0, refused: 3 },
      previewReference: null,
      previewExpiresAt: null,
    })
    expect(looked.data.tickets.every((ticket) => ticket.refusal === 'REFUNDED')).toBe(true)
  })
})

when()('a group pass after most of its group is in', () => {
  it('17. still shows for the last guest, and stops (and cannot be replaced) once nobody on it admits', async () => {
    const w = await world()
    const buyer = await actorFor(w.holder)
    const body = await groupPreviewed(w.steward, { credential: w.pass.credential }, [
      w.tickets[0].id,
      w.tickets[1].id,
    ])

    expect((await groupConfirmAs(w.steward, body)).status).toBe(200)

    // One guest still to come. The pass taken out for three still shows, for
    // the one it still admits, with the same QR and code as before.
    const again = await outcome(
      retrieveGroupPass({ prisma, env: ENV, actor: buyer, reference: w.order.reference }),
    )

    expect(again.status, again.message).toBe(200)
    expect(again.data).toMatchObject({
      admits: 1,
      credential: w.pass.credential,
      groupCode: w.pass.groupCode,
    })
    expect(again.data.tickets.map((ticket) => ticket.id)).toEqual([w.tickets[2].id])

    // It can still be replaced while it admits somebody.
    const replaced = await outcome(
      rotateGroupPass({ prisma, env: ENV, actor: buyer, reference: w.order.reference }),
    )

    expect(replaced.status, replaced.message).toBe(200)

    const current = await retrieveGroupPass({
      prisma,
      env: ENV,
      actor: buyer,
      reference: w.order.reference,
    })
    const last = await groupPreviewed(w.steward, { code: current.groupCode })

    expect(last.ticketIds).toEqual([w.tickets[2].id])
    expect((await groupConfirmAs(w.steward, last)).status).toBe(200)

    // Everybody is in: nothing to show, and nothing to replace — a new code
    // could not be shown to anybody.
    const none = await outcome(
      retrieveGroupPass({ prisma, env: ENV, actor: buyer, reference: w.order.reference }),
    )
    const version = (await prisma.groupPass.findUnique({ where: { orderId: w.order.id } }))
      .credentialVersion
    const rotateNone = await outcome(
      rotateGroupPass({ prisma, env: ENV, actor: buyer, reference: w.order.reference }),
    )

    expect(none).toMatchObject({ status: 409, reason: 'TOO_FEW_TICKETS' })
    expect(rotateNone).toMatchObject({ status: 409, reason: 'TOO_FEW_TICKETS' })
    expect(
      (await prisma.groupPass.findUnique({ where: { orderId: w.order.id } })).credentialVersion,
    ).toBe(version)
  })

  it('18. is still not taken out for the first time for a single ticket', async () => {
    const w = await world({ count: 2 })
    const pass = await prisma.groupPass.findUnique({ where: { orderId: w.order.id } })
    const buyer = await actorFor(w.holder)

    // Forget the pass the world took out, then leave one ticket admitting.
    await prisma.groupPass.delete({ where: { id: pass.id } })
    await settle(w, await submittedRefund(w, [w.lines[0]]))

    const first = await outcome(
      retrieveGroupPass({ prisma, env: ENV, actor: buyer, reference: w.order.reference }),
    )

    expect(first).toMatchObject({ status: 409, reason: 'TOO_FEW_TICKETS' })
    expect(await prisma.groupPass.count({ where: { orderId: w.order.id } })).toBe(0)
  })
})
