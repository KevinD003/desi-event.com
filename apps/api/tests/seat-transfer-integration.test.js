/**
 * Reserved-seat transfer, against real PostgreSQL: a seat goes with its ticket,
 * and the database keeps one live ticket per seat whatever races it.
 *
 * `docs/adr/0006-reserved-seat-transfer-live-seat-index.md` (superseding ADR
 * 0005's decision) records the rule. `Ticket.eventSeatId` is unique among
 * *live* tickets only — VALID, TRANSFER_PENDING, CHECKED_IN — through the
 * partial index `Ticket_eventSeatId_live_key`. Accepting a transfer moves the
 * live seat in one transaction: the predecessor leaves the predicate
 * (TRANSFERRED) and keeps its pointer as history, and the successor, which
 * copies the seat, enters it. The EventSeat row stays SOLD on the same order
 * line, because it records the line, not the ticket.
 *
 * ADR 0005 deferred this because the index alone would trade a loud 500 for a
 * quiet double admission: a refund that read the line's tickets before an
 * acceptance committed could return the money and leave the successor live.
 * Acceptance and refund now both lock the order line `FOR UPDATE` before they
 * read or move its tickets; the races below prove each order of arrival.
 *
 * Every case that used to prove the block is kept, rewritten to the new rule:
 * the offer is written, the acceptance moves the seat, a second live ticket is
 * still refused. The last case — an acceptance that loses a race commits
 * nothing — is unchanged.
 *
 * Renamed from `seat-transfer-block-integration.test.js`.
 *
 * @module @desi-event/api/tests/seat-transfer-integration
 */

import { createHash } from 'node:crypto'

import { afterAll, expect, it } from 'vitest'

import { SEAT_POLICIES, settleRefund } from '../src/lib/refunds.js'
import {
  TICKET_STATES,
  acceptTransfer,
  admit,
  endTransfer,
  mintTransferToken,
  startTransfer,
} from '../src/lib/tickets.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the seat transfer suite')

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

let sequence = 0

/**
 * A CUID-shaped id unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The id.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`seatblock-${RUN}-${kind}-${sequence}`).digest('hex')

  return `c${BigInt(`0x${digest}`).toString(36).padEnd(24, '0').slice(0, 24)}`
}

/**
 * A holder, a recipient, and one paid ticket — seated or not.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.seated] Whether the ticket holds a reserved seat.
 * @returns {Promise<object>} The rows.
 */
async function world({ seated = true } = {}) {
  const tag = `${RUN}${(sequence += 1).toString(36)}`
  const startsAt = new Date(Date.now() + 86_400_000)
  const endsAt = new Date(startsAt.getTime() + 3_600_000)

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Seat Block ${tag}`,
      slug: `seatblock-${tag}`,
      contactEmail: `sb-${tag}@example.test`,
    },
  })
  const person = (label) =>
    prisma.user.create({
      data: {
        id: id(label),
        email: `${label}-${tag}@example.test`,
        displayName: label,
        passwordHash: 'not-a-hash-this-suite-never-signs-in',
        role: 'ATTENDEE',
        emailVerified: true,
      },
    })
  const holder = await person('holder')
  const recipient = await person('recipient')
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Seat Block Hall',
      slug: `seatblock-venue-${tag}`,
      addressLine1: '1 Test Road',
      city: 'Chennai',
      region: 'TN',
      postalCode: '600001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Seated Night ${tag}`,
      slug: `seatblock-event-${tag}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the seat transfer block suite.',
      description: 'One seat, one holder, one person they would like to give it to.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
    },
  })
  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Stalls',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: 1,
      status: 'ON_SALE',
    },
  })

  let versionId = null
  let seatId = null

  if (seated) {
    const map = await prisma.venueMap.create({
      data: { id: id('map'), venueId: venue.id, name: 'Plan' },
    })
    const version = await prisma.venueMapVersion.create({
      data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: 1 },
    })
    const section = await prisma.section.create({
      data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
    })
    const row = await prisma.seatRow.create({
      data: { id: id('row'), venueMapVersionId: version.id, sectionId: section.id, label: 'C' },
    })
    const seat = await prisma.seat.create({
      data: {
        id: id('seat'),
        venueMapVersionId: version.id,
        sectionId: section.id,
        rowId: row.id,
        label: 'C12',
        sortOrder: 1,
      },
    })

    await prisma.venueMapVersion.update({
      where: { id: version.id },
      data: { publishedAt: new Date() },
    })

    versionId = version.id
    seatId = seat.id
  }

  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      venueMapVersionId: versionId,
    },
  })
  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-SB${tag.toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'holder',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100_000,
      totalCents: 100_000,
      paidAt: new Date(),
    },
  })
  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      unitPriceCents: 100_000,
      subtotalCents: 100_000,
    },
  })
  const eventSeat = seated
    ? await prisma.eventSeat.create({
        data: {
          id: id('eventseat'),
          eventSessionId: session.id,
          seatId,
          ticketTypeId: ticketType.id,
          orderItemId: orderItem.id,
          status: 'SOLD',
        },
      })
    : null
  const ticket = await prisma.ticket.create({
    data: {
      id: id('ticket'),
      orderItemId: orderItem.id,
      code: `DET-SB${tag.toUpperCase()}`,
      ownerUserId: holder.id,
      attendeeName: 'holder',
      eventSeatId: eventSeat?.id ?? null,
      status: TICKET_STATES.VALID,
    },
  })

  return {
    organization,
    event,
    holder,
    recipient,
    session,
    ticketType,
    order,
    orderItem,
    eventSeat,
    ticket,
  }
}

/**
 * Accept, the way the route does.
 *
 * @param {object} transfer The transfer.
 * @param {object} ticket The ticket as read before the transaction.
 * @param {object} recipient Who accepts.
 * @returns {Promise<object>} What acceptTransfer returned.
 */
function accept(transfer, ticket, recipient) {
  return prisma.$transaction((tx) =>
    acceptTransfer(tx, {
      transfer,
      ticket,
      recipient,
      credentialSecret: SECRET,
      generateTicketCode: () =>
        `DET-SBX${(sequence += 1).toString(36).toUpperCase()}${RUN.toUpperCase()}`,
      now: new Date(),
    }),
  )
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

/**
 * Offer the world's ticket to its recipient, the way the route does.
 *
 * @param {object} w From {@link world}.
 * @returns {Promise<{transfer: object, pending: object}>} The invitation and the ticket as it now reads.
 */
async function offer(w) {
  const { tokenHash } = mintTransferToken()

  const outcome = await prisma.$transaction((tx) =>
    startTransfer(tx, {
      ticket: w.ticket,
      toEmail: w.recipient.email,
      fromUserId: w.holder.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
      delivery: 'MANUAL',
      now: new Date(),
    }),
  )

  expect(outcome.started).toBe(true)

  return {
    transfer: outcome.transfer,
    pending: await prisma.ticket.findUnique({ where: { id: w.ticket.id } }),
  }
}

/**
 * A SUBMITTED refund of the world's whole order line, ready to settle.
 *
 * Written directly rather than through the request and provider phases: what
 * is under test here is settlement's locking against acceptance, and the
 * counters are set exactly as `requestRefund` and `markSubmitted` leave them.
 *
 * @param {object} w From {@link world}.
 * @returns {Promise<object>} The refund.
 */
async function submittedRefund(w) {
  const payment = await prisma.payment.create({
    data: {
      id: id('payment'),
      orderId: w.order.id,
      provider: 'in-memory-payments',
      providerRef: `pi_${id('ref')}`,
      status: 'SUCCEEDED',
      amountCents: 100_000,
      currency: 'INR',
    },
  })

  await prisma.order.update({
    where: { id: w.order.id },
    data: { refundPendingCents: { increment: 100_000 } },
  })

  return prisma.refund.create({
    data: {
      id: id('refund'),
      orderId: w.order.id,
      paymentId: payment.id,
      provider: 'in-memory-payments',
      amountCents: 100_000,
      currency: 'INR',
      reason: 'CUSTOMER_REQUEST',
      status: 'SUBMITTED',
      idempotencyKey: id('refund-key'),
      submittedAt: new Date(),
      items: {
        create: [{ orderItemId: w.orderItem.id, quantity: 1, amountCents: 100_000 }],
      },
    },
  })
}

/**
 * Settle a refund inside a transaction, the way the route's last phase does.
 *
 * @param {object} tx A transaction client.
 * @param {object} w From {@link world}.
 * @param {object} refund The SUBMITTED refund.
 * @param {string} [seatPolicy] RESELL or WITHHOLD.
 * @returns {Promise<object>} What `settleRefund` returned.
 */
async function settleIn(tx, w, refund, seatPolicy = SEAT_POLICIES.RESELL) {
  return settleRefund(tx, {
    refund,
    order: await tx.order.findUnique({ where: { id: w.order.id } }),
    result: { providerRefundId: `re_${id('provider-refund')}`, rawStatus: 'SUCCEEDED' },
    organizationId: w.organization.id,
    seatPolicy,
    eventStartsAt: w.event.startsAt,
    actorId: null,
    now: new Date(),
  })
}

/**
 * The tickets that hold a seat now: the database's own predicate.
 *
 * @param {string} eventSeatId The seat.
 * @returns {Promise<Array<object>>} The live rows.
 */
function liveTicketsFor(eventSeatId) {
  return prisma.ticket.findMany({
    where: { eventSeatId, status: { in: ['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'] } },
  })
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
 * Run work in a transaction and hold it open, uncommitted, until released.
 *
 * @param {function(object): Promise<unknown>} work What the transaction does before it waits.
 * @returns {Promise<{release: function(): void, done: Promise<unknown>, pid: number}>} Once the work is done.
 */
async function holding(work) {
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
      const result = await work(tx)

      held(pid)
      await gate

      return result
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  // A work function that throws never reaches `held`; surface its error.
  const pid = await Promise.race([heldPromise, done.then(() => heldPromise)])

  return { release, done, pid }
}

when()('a reserved-seat ticket', () => {
  it('can be offered: the invitation is written, the ticket pending, the seat untouched', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)

    expect(pending.status).toBe('TRANSFER_PENDING')
    expect(pending.eventSeatId).toBe(w.eventSeat.id)
    expect(transfer.status).toBe('PENDING')
    expect(await prisma.eventSeat.findUnique({ where: { id: w.eventSeat.id } })).toMatchObject({
      status: 'SOLD',
      orderItemId: w.orderItem.id,
    })
  })

  it('accepting moves the live seat: the old row keeps it as history, the new one holds it', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)

    const outcome = await accept(transfer, pending, w.recipient)

    expect(outcome.accepted).toBe(true)

    const predecessor = await prisma.ticket.findUnique({ where: { id: w.ticket.id } })
    const successor = await prisma.ticket.findUnique({ where: { id: outcome.ticket.id } })

    expect(predecessor).toMatchObject({
      status: 'TRANSFERRED',
      eventSeatId: w.eventSeat.id,
      credentialHash: null,
    })
    expect(successor).toMatchObject({
      status: 'VALID',
      eventSeatId: w.eventSeat.id,
      ownerUserId: w.recipient.id,
      supersedesTicketId: w.ticket.id,
    })
    expect((await liveTicketsFor(w.eventSeat.id)).map((row) => row.id)).toEqual([successor.id])
    // The seat records the line, not the ticket: still sold, on the same line.
    expect(await prisma.eventSeat.findUnique({ where: { id: w.eventSeat.id } })).toMatchObject({
      status: 'SOLD',
      orderItemId: w.orderItem.id,
    })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ticket.transfer_accepted', entityId: w.ticket.id },
    })

    expect(audit.metadata).toMatchObject({ eventSeatId: w.eventSeat.id, seatCarried: true })
  })

  it('refuses a second live ticket for the seat, while a handed-on or refunded row with the same seat is not refused', async () => {
    const w = await world()

    await expect(
      prisma.ticket.create({
        data: {
          orderItemId: w.ticket.orderItemId,
          code: `DET-SBDUP${RUN.toUpperCase()}`,
          eventSeatId: w.ticket.eventSeatId,
          status: TICKET_STATES.VALID,
          supersedesTicketId: w.ticket.id,
        },
      }),
    ).rejects.toThrow(/Ticket_eventSeatId_live_key/u)

    // History does not collide: rows outside the predicate may share the seat.
    // Shown inside a transaction that is then rolled back, because these rows
    // are not a lineage the services write, and the load suite's settlement
    // invariants — asked of the whole database — would rightly count them.
    const rollback = new Error('rolled back on purpose')

    await expect(
      prisma.$transaction(async (tx) => {
        for (const status of ['TRANSFERRED', 'REFUNDED']) {
          await tx.ticket.create({
            data: {
              orderItemId: w.ticket.orderItemId,
              code: `DET-SBH${status}${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
              eventSeatId: w.ticket.eventSeatId,
              status,
            },
          })
        }

        expect(await tx.ticket.count({ where: { eventSeatId: w.eventSeat.id } })).toBe(3)

        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(await prisma.ticket.count({ where: { eventSeatId: w.eventSeat.id } })).toBe(1)
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(1)

    // The index the rule rests on, by name: the full one is gone, the partial
    // one names the live states. Prisma cannot express it, so a future schema
    // diff could propose dropping it; this is the case that would notice.
    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'Ticket' AND indexname LIKE 'Ticket_eventSeatId%'`
    const names = indexes.map((row) => row.indexname).sort()

    expect(names).toEqual(['Ticket_eventSeatId_idx', 'Ticket_eventSeatId_live_key'])

    const live = indexes.find((row) => row.indexname === 'Ticket_eventSeatId_live_key')

    expect(live.indexdef).toMatch(/UNIQUE/u)
    expect(live.indexdef).toMatch(/VALID/u)
    expect(live.indexdef).toMatch(/TRANSFER_PENDING/u)
    expect(live.indexdef).toMatch(/CHECKED_IN/u)
    expect(live.indexdef).not.toMatch(/TRANSFERRED|REFUNDED/u)
  })

  it('an acceptance and then a refund: the refund waits for the line, then refunds the successor', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)
    const refund = await submittedRefund(w)

    const acceptance = await holding((tx) =>
      acceptTransfer(tx, {
        transfer,
        ticket: pending,
        recipient: w.recipient,
        credentialSecret: SECRET,
        generateTicketCode: () => `DET-SBR${(sequence += 1).toString(36).toUpperCase()}${RUN}`,
        now: new Date(),
      }),
    )

    const settlement = prisma.$transaction((tx) => settleIn(tx, w, refund), {
      timeout: 20_000,
      maxWait: 10_000,
    })

    await untilBlocked(acceptance)
    acceptance.release()

    const accepted = await acceptance.done
    const settled = await settlement

    expect(accepted.accepted).toBe(true)
    expect(settled).toMatchObject({ settled: true, ticketsRevoked: 1, seatsReturned: 1 })
    expect(await prisma.ticket.findUnique({ where: { id: accepted.ticket.id } })).toMatchObject({
      status: 'REFUNDED',
      credentialHash: null,
    })
    // Nobody admits on the seat the money went back for.
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(0)
    expect(await prisma.eventSeat.findUnique({ where: { id: w.eventSeat.id } })).toMatchObject({
      status: 'AVAILABLE',
      orderItemId: null,
    })
  })

  it('a refund and then an acceptance: the acceptance waits, then refuses, and the invitation stays pending', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)
    const refund = await submittedRefund(w)

    const settlement = await holding((tx) => settleIn(tx, w, refund))
    const acceptance = accept(transfer, pending, w.recipient)

    await untilBlocked(settlement)
    settlement.release()

    await expect(settlement.done).resolves.toMatchObject({ settled: true, ticketsRevoked: 1 })
    await expect(acceptance).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'TICKET_CHANGED' },
    })

    expect((await prisma.ticketTransfer.findUnique({ where: { id: transfer.id } })).status).toBe(
      'PENDING',
    )
    expect(await prisma.ticket.count({ where: { supersedesTicketId: w.ticket.id } })).toBe(0)
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(0)
  })

  it('two acceptances of one seated invitation issue one successor', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)

    const results = await Promise.allSettled([
      accept(transfer, pending, w.recipient),
      accept(transfer, pending, w.recipient),
    ])

    const accepted = results.filter(
      (result) => result.status === 'fulfilled' && result.value.accepted,
    )

    expect(accepted).toHaveLength(1)
    expect(await prisma.ticket.count({ where: { supersedesTicketId: w.ticket.id } })).toBe(1)
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(1)
  })

  it('a check-in racing an acceptance: exactly one of them happens', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)

    const results = await Promise.allSettled([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${pending.id} FOR UPDATE`

        return admit(tx, {
          ticket: pending,
          eventSessionId: w.session.id,
          scannedByUserId: w.holder.id,
          method: 'MANUAL_CODE',
          now: new Date(),
        })
      }),
      accept(transfer, pending, w.recipient),
    ])

    const admissions = await prisma.checkIn.count({ where: { ticketId: w.ticket.id } })
    const successors = await prisma.ticket.count({ where: { supersedesTicketId: w.ticket.id } })

    expect(admissions + successors, JSON.stringify(results.map((r) => r.status))).toBe(1)
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(1)
  })

  it('a seat refunded with RESELL can be sold and ticketed again', async () => {
    // The collision ADR 0005 recorded: the refunded row keeps its seat, and
    // under the old full index nothing could ever be issued for it again.
    const w = await world()
    const refund = await submittedRefund(w)

    await prisma.$transaction((tx) => settleIn(tx, w, refund, SEAT_POLICIES.RESELL))

    expect(await prisma.ticket.findUnique({ where: { id: w.ticket.id } })).toMatchObject({
      status: 'REFUNDED',
      eventSeatId: w.eventSeat.id,
    })

    const buyer = w.recipient

    // The tier now has its seat back to sell. The load suite's overselling
    // check counts a refunded line's quantity as sold, so the tier's total is
    // raised to cover both sales — the resale is what is under test here.
    await prisma.ticketType.update({ where: { id: w.ticketType.id }, data: { quantityTotal: 2 } })

    const resale = await prisma.order.create({
      data: {
        id: id('order-resale'),
        reference: `DE-SBRS${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
        eventId: w.event.id,
        eventSessionId: w.session.id,
        userId: buyer.id,
        buyerEmail: buyer.email,
        buyerName: 'recipient',
        status: 'PAID',
        currency: 'INR',
        subtotalCents: 100_000,
        totalCents: 100_000,
        paidAt: new Date(),
      },
    })
    const line = await prisma.orderItem.create({
      data: {
        id: id('line-resale'),
        orderId: resale.id,
        ticketTypeId: w.ticketType.id,
        quantity: 1,
        unitPriceCents: 100_000,
        subtotalCents: 100_000,
      },
    })

    await prisma.eventSeat.update({
      where: { id: w.eventSeat.id },
      data: { status: 'SOLD', orderItemId: line.id },
    })

    const resold = await prisma.ticket.create({
      data: {
        id: id('ticket-resale'),
        orderItemId: line.id,
        code: `DET-SBRS${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
        ownerUserId: buyer.id,
        eventSeatId: w.eventSeat.id,
        status: TICKET_STATES.VALID,
      },
    })

    expect((await liveTicketsFor(w.eventSeat.id)).map((row) => row.id)).toEqual([resold.id])
    expect(await prisma.ticket.count({ where: { eventSeatId: w.eventSeat.id } })).toBe(2)
  })

  it('can still be withdrawn by its sender, as any offer can', async () => {
    const w = await world()
    const { transfer, pending } = await offer(w)

    await prisma.$transaction((tx) =>
      endTransfer(tx, {
        transfer,
        ticket: pending,
        outcome: 'CANCELLED',
        actorId: w.holder.id,
        now: new Date(),
      }),
    )

    expect((await prisma.ticket.findUnique({ where: { id: w.ticket.id } })).status).toBe('VALID')
    expect(await liveTicketsFor(w.eventSeat.id)).toHaveLength(1)
  })
})

when()('an acceptance that loses a race', () => {
  it('rolls back entirely: the invitation stays pending and nobody is issued a ticket', async () => {
    const w = await world({ seated: false })
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket: w.ticket,
        toEmail: w.recipient.email,
        fromUserId: w.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )

    const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })
    // Read before the admission, the way the route reads it before its
    // transaction opens.
    const stale = await prisma.ticket.findUnique({ where: { id: w.ticket.id } })

    await prisma.$transaction((tx) =>
      admit(tx, {
        ticket: stale,
        eventSessionId: w.session.id,
        scannedByUserId: w.holder.id,
        method: 'QR_SCAN',
        now: new Date(),
      }),
    )

    await expect(accept(transfer, stale, w.recipient)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'TICKET_CHANGED' },
    })

    // Before the fix: ACCEPTED, committed, with no successor and the ticket
    // still with the sender.
    expect((await prisma.ticketTransfer.findUnique({ where: { id: transfer.id } })).status).toBe(
      'PENDING',
    )
    expect(await prisma.ticket.count({ where: { supersedesTicketId: w.ticket.id } })).toBe(0)
  })
})
