/**
 * Reserved-seat transfer stays blocked — really blocked — and an acceptance
 * that loses a race commits nothing. Against real PostgreSQL.
 *
 * `docs/adr/0005-reserved-seat-transfer.md` records why seated transfer is not
 * implemented in this phase: `Ticket.eventSeatId` is unique over every row,
 * so a successor for the same seat cannot be inserted while the predecessor
 * keeps its pointer, and the safe fix — a partial unique index over live
 * statuses, with the refund and accept paths serialised on the order line —
 * is wider than this phase may take on. What "blocked" meant before this file:
 * the invitation was sent, the ticket moved to TRANSFER_PENDING, and the
 * recipient got a 500 on every attempt to accept until the invitation lapsed.
 * What it means now is below.
 *
 * The last case is the acceptance defect the seat work exposed and that is not
 * about seats: an acceptance that found the ticket changed underneath it
 * returned instead of throwing, which committed the invitation as ACCEPTED
 * with no successor ticket behind it.
 *
 * @module @desi-event/api/tests/seat-transfer-block-integration
 */

import { createHash } from 'node:crypto'

import { afterAll, expect, it } from 'vitest'

import {
  TICKET_STATES,
  acceptTransfer,
  admit,
  endTransfer,
  mintTransferToken,
  startTransfer,
} from '../src/lib/tickets.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the seat transfer block suite')

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

  return { holder, recipient, session, ticket }
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

when()('a reserved-seat ticket', () => {
  it('cannot be offered: nothing is written and nobody is invited', async () => {
    const w = await world()
    const { tokenHash } = mintTransferToken()

    await expect(
      prisma.$transaction((tx) =>
        startTransfer(tx, {
          ticket: w.ticket,
          toEmail: w.recipient.email,
          fromUserId: w.holder.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, details: { reason: 'RESERVED_SEAT' } })

    expect((await prisma.ticket.findUnique({ where: { id: w.ticket.id } })).status).toBe('VALID')
    expect(await prisma.ticketTransfer.count({ where: { ticketId: w.ticket.id } })).toBe(0)
  })

  it('refuses an invitation started before the block with a 409, not a 500, and the sender can withdraw it', async () => {
    const w = await world()
    const { tokenHash } = mintTransferToken()

    // An invitation as the old code left one: sent, and the ticket pending.
    await prisma.ticket.update({ where: { id: w.ticket.id }, data: { status: 'TRANSFER_PENDING' } })
    const transfer = await prisma.ticketTransfer.create({
      data: {
        ticketId: w.ticket.id,
        fromUserId: w.holder.id,
        toEmail: w.recipient.email,
        tokenHash,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    const pending = await prisma.ticket.findUnique({ where: { id: w.ticket.id } })

    await expect(accept(transfer, pending, w.recipient)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'RESERVED_SEAT' },
    })

    expect((await prisma.ticketTransfer.findUnique({ where: { id: transfer.id } })).status).toBe(
      'PENDING',
    )
    expect(await prisma.ticket.count({ where: { supersedesTicketId: w.ticket.id } })).toBe(0)

    // The way out that exists: the sender withdraws, and the ticket is theirs.
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
  })

  it('still carries its seat, uniquely: the defect the block stands in front of is still there', async () => {
    // Recorded so that whoever fixes S-1 has to change this case on purpose.
    // A second ticket row for the same seat — which a successor would be — is
    // refused by the full unique index.
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
    ).rejects.toThrow(/Ticket_eventSeatId_key/u)
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
