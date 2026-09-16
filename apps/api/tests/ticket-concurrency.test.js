/**
 * The four ways a ticket's life can race, against a real database.
 *
 * Every one of these turns on something PostgreSQL does and a stub cannot: a
 * unique index on `CheckIn.ticketId` that makes two scanners produce one
 * admission, a conditional `UPDATE` whose affected count comes back short, and
 * the `desi_check_in_ticket_admissible` trigger that refuses a row for a ticket
 * the application should never have offered.
 *
 * The brief names four:
 *
 *   - Two scanners racing result in one successful check-in.
 *   - Transfer racing with check-in produces one valid terminal outcome.
 *   - Refund racing with transfer is safely resolved.
 *   - Check-in succeeds at most once.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips, because a suite that skipped reads exactly like a suite that
 * passed.
 *
 * @module @desi-event/api/tests/ticket-concurrency
 */

import { createHash } from 'node:crypto'

import { afterAll, expect, it } from 'vitest'

import {
  TICKET_STATES,
  acceptTransfer,
  admit,
  endTransfer,
  mintTransferToken,
  revokeTicket,
  startTransfer,
} from '../src/lib/tickets.js'
import { issueTicketCredential } from '../src/lib/ticket-credentials.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the ticket concurrency suite')

/** A suffix unique to this run, so two runs cannot collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

let sequence = 0

/**
 * A unique identifier for this run, shaped like one Prisma would generate.
 *
 * @param {string} kind What it names.
 * @returns {string} A 25-character CUID-shaped identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`ticketrace-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A published event, a paid order, and one issued ticket.
 *
 * General admission rather than reserved: none of these races is about seats,
 * and a seat map would be four more tables for nothing.
 *
 * @param {object} [options] Options.
 * @param {number} [options.tickets] How many tickets to issue.
 * @returns {Promise<object>} The rows the races need.
 */
async function buildIssuedTickets({ tickets: count = 1 } = {}) {
  const startsAt = new Date(Date.now() + 86_400_000)

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Door Collective ${RUN}`,
      slug: `ticketrace-${RUN}-org-${(sequence += 1).toString(36)}`,
      contactEmail: `door-${RUN}@desi-event.example`,
    },
  })

  const holder = await prisma.user.create({
    data: {
      id: id('holder'),
      email: `holder-${RUN}-${(sequence += 1).toString(36)}@desi-event.example`,
      displayName: 'The Holder',
      passwordHash: 'not-a-hash-this-suite-never-signs-in',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })

  const recipient = await prisma.user.create({
    data: {
      id: id('recipient'),
      email: `recipient-${RUN}-${(sequence += 1).toString(36)}@desi-event.example`,
      displayName: 'The Recipient',
      passwordHash: 'not-a-hash-this-suite-never-signs-in',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Door Hall',
      slug: `ticketrace-${RUN}-venue-${(sequence += 1).toString(36)}`,
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
      title: `Door Night ${RUN}`,
      slug: `ticketrace-${RUN}-event-${(sequence += 1).toString(36)}`,
      category: 'MUSIC_CONCERT',
      summary: 'A queue, two scanners, and one ticket.',
      description: 'Built by the ticket concurrency suite.',
      status: 'PUBLISHED',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'Asia/Kolkata',
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Standing',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: count,
      status: 'ON_SALE',
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'Asia/Kolkata',
    },
  })

  const totalCents = 100_000 * count

  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'The Holder',
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
      providerRef: `pi_${RUN}_${(sequence += 1).toString(36)}`,
      status: 'SUCCEEDED',
      amountCents: totalCents,
      currency: 'INR',
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: count,
      unitPriceCents: 100_000,
      subtotalCents: totalCents,
    },
  })

  const issued = []

  for (let index = 0; index < count; index += 1) {
    const ticketId = id(`ticket-${index}`)
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId,
      version: 1,
    })

    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        orderItemId: orderItem.id,
        code: `DET-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}${index}`,
        credentialHash,
        credentialVersion: 1,
        credentialIssuedAt: new Date(),
        attendeeName: 'The Holder',
        ownerUserId: holder.id,
        status: TICKET_STATES.VALID,
      },
    })

    issued.push({ ...ticket, credential })
  }

  return { organization, event, session, order, payment, orderItem, holder, recipient, issued }
}

/**
 * Admit a ticket the way the route does, swallowing the unique violation.
 *
 * @param {object} ticket The ticket, as it was read.
 * @param {string} scannedByUserId Who is holding the scanner.
 * @param {string|null} eventSessionId Which performance.
 * @returns {Promise<{admitted: boolean}>} What happened.
 */
function scan(ticket, scannedByUserId, eventSessionId) {
  return prisma
    .$transaction((tx) =>
      admit(tx, {
        ticket,
        eventSessionId,
        scannedByUserId,
        scannerId: `scanner-${scannedByUserId}`,
        now: new Date(),
      }),
    )
    .catch((error) => {
      // Two ways to lose: the unique index fired because somebody else admitted
      // this ticket, or the ticket moved on underneath the scan. Both leave the
      // caller without an admission, and neither is an unhandled error.
      if (error?.code === 'P2002') return { admitted: false, checkIn: null }
      if (error?.statusCode === 409) return { admitted: false, checkIn: null }

      throw error
    })
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('two scanners reaching for one ticket', () => {
  it('admits it once, and writes one attendance row', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    const results = await Promise.allSettled([
      scan(ticket, world.holder.id, world.session.id),
      scan(ticket, world.recipient.id, world.session.id),
    ])

    const admitted = results.filter(
      (result) => result.status === 'fulfilled' && result.value.admitted,
    )

    expect(admitted).toHaveLength(1)

    // The row that actually decides it. `CheckIn.ticketId` is unique, so two
    // scanners produce one attendance however the application behaved.
    const checkIns = await prisma.checkIn.findMany({ where: { ticketId: ticket.id } })

    expect(checkIns).toHaveLength(1)

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(after.status).toBe(TICKET_STATES.CHECKED_IN)
    expect(after.checkedInAt).not.toBeNull()
  })

  it('admits it once across five simultaneous scans', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => scan(ticket, world.holder.id, world.session.id)),
    )

    const admitted = results.filter(
      (result) => result.status === 'fulfilled' && result.value.admitted,
    )

    expect(admitted).toHaveLength(1)
    expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(1)
  })

  it('refuses a second attendance row even when one is written directly', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    await scan(ticket, world.holder.id, world.session.id)

    // Not through the service: the question is whether the database refuses it,
    // and a test that only asked the service would be asking the service
    // whether it agrees with itself.
    await expect(
      prisma.checkIn.create({
        data: {
          id: id('checkin'),
          ticketId: ticket.id,
          eventSessionId: world.session.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow()
  })
})

when()('a transfer racing a check-in', () => {
  it('leaves exactly one terminal outcome, whichever wins', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued
    const { tokenHash } = mintTransferToken()

    const [transferResult, scanResult] = await Promise.allSettled([
      prisma.$transaction((tx) =>
        startTransfer(tx, {
          ticket,
          toEmail: world.recipient.email,
          fromUserId: world.holder.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
          now: new Date(),
        }),
      ),
      scan(ticket, world.holder.id, world.session.id),
    ])

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // One of two coherent endings, never a third. Either the invitation went
    // out and the ticket is TRANSFER_PENDING, or the holder walked in and it is
    // CHECKED_IN — and the ticket is never both.
    expect([TICKET_STATES.TRANSFER_PENDING, TICKET_STATES.CHECKED_IN]).toContain(after.status)

    const checkIns = await prisma.checkIn.count({ where: { ticketId: ticket.id } })

    if (after.status === TICKET_STATES.CHECKED_IN) expect(checkIns).toBe(1)

    // Both calls resolved. Neither threw an unhandled error at the other's
    // expense, which is what a door and a phone doing this at once looks like.
    expect(transferResult.status === 'fulfilled' || scanResult.status === 'fulfilled').toBe(true)
  })

  it('still admits the holder while an invitation stands', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket,
        toEmail: world.recipient.email,
        fromUserId: world.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )

    const pending = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(pending.status).toBe(TICKET_STATES.TRANSFER_PENDING)

    // An invitation nobody accepted must not leave a paying attendee at the
    // door. This is the case that rule exists for.
    const { admitted } = await scan(pending, world.holder.id, world.session.id)

    expect(admitted).toBe(true)
  })

  it('will not accept a transfer for a ticket that went through the door', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket,
        toEmail: world.recipient.email,
        fromUserId: world.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )

    const pending = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    await scan(pending, world.holder.id, world.session.id)

    const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })
    const admitted = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // CHECKED_IN is terminal, so the transition table refuses it. The person
    // holding the ticket already came in; handing it on afterwards would mint a
    // second pass for a seat somebody is sitting in.
    await expect(
      prisma.$transaction((tx) =>
        acceptTransfer(tx, {
          transfer,
          ticket: admitted,
          recipient: world.recipient,
          credentialSecret: SECRET,
          generateTicketCode: () => `DET-${RUN.toUpperCase()}TX${(sequence += 1).toString(36)}`,
          now: new Date(),
        }),
      ),
    ).rejects.toThrow(/checked in ticket cannot become transferred/i)

    expect(await prisma.ticket.count({ where: { supersedesTicketId: ticket.id } })).toBe(0)
  })
})

when()('a revocation racing a check-in', () => {
  it('produces one outcome, and the loser changes nothing', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    const [revocation, admission] = await Promise.allSettled([
      prisma.$transaction((tx) =>
        revokeTicket(tx, {
          ticket,
          reason: 'Withdrawn while somebody was at the door.',
          actorId: world.holder.id,
          now: new Date(),
        }),
      ),
      scan(ticket, world.holder.id, world.session.id),
    ])

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect([TICKET_STATES.REVOKED, TICKET_STATES.CHECKED_IN]).toContain(after.status)

    if (after.status === TICKET_STATES.REVOKED) {
      // Nobody was admitted on a revoked ticket.
      expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(0)
      expect(after.credentialHash).toBeNull()
    } else {
      expect(await prisma.checkIn.count({ where: { ticketId: ticket.id } })).toBe(1)
    }

    expect(revocation.status === 'fulfilled' || admission.status === 'fulfilled').toBe(true)
  })

  it('refuses the door outright once a revocation has landed', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    await prisma.$transaction((tx) =>
      revokeTicket(tx, {
        ticket,
        reason: 'Withdrawn before the doors opened.',
        actorId: world.holder.id,
        now: new Date(),
      }),
    )

    const revoked = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // The database refuses it, not the application: the trigger is what makes
    // this true for code nobody has written yet.
    await expect(
      prisma.checkIn.create({
        data: {
          id: id('checkin'),
          ticketId: revoked.id,
          eventSessionId: world.session.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/admissible|revoked/i)
  })
})

when()('a refund racing a transfer', () => {
  it('does not leave a live pass on a refunded ticket', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket,
        toEmail: world.recipient.email,
        fromUserId: world.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )

    const pending = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })

    // The refund path revokes a TRANSFER_PENDING ticket as readily as a VALID
    // one — see `revokeAndReturn` — so the refund lands first here.
    const [refund, acceptance] = await Promise.allSettled([
      prisma.ticket.updateMany({
        where: { id: pending.id, status: TICKET_STATES.TRANSFER_PENDING },
        data: {
          status: TICKET_STATES.REFUNDED,
          revokedAt: new Date(),
          revokedReason: 'refund',
          credentialHash: null,
        },
      }),
      prisma
        .$transaction((tx) =>
          acceptTransfer(tx, {
            transfer,
            ticket: pending,
            recipient: world.recipient,
            credentialSecret: SECRET,
            generateTicketCode: () => `DET-${RUN.toUpperCase()}RF${(sequence += 1).toString(36)}`,
            now: new Date(),
          }),
        )
        .catch((error) => ({ failed: String(error?.message ?? error) })),
    ])

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const minted = await prisma.ticket.findMany({ where: { supersedesTicketId: ticket.id } })

    expect(refund.status).toBe('fulfilled')

    if (after.status === TICKET_STATES.REFUNDED) {
      // The pass is dead and nothing was minted against it. A new ticket here
      // would be a pass for a seat the buyer has been paid back for.
      expect(after.credentialHash).toBeNull()
      expect(minted).toHaveLength(0)
    } else {
      // The transfer won: the old ticket is TRANSFERRED and the new one holds a
      // live pass. Whatever refund settlement then runs sees a ticket it cannot
      // revoke, which is the case `revokeAndReturn` counts rather than assumes.
      expect(after.status).toBe(TICKET_STATES.TRANSFERRED)
      expect(after.credentialHash).toBeNull()
      expect(minted).toHaveLength(1)
    }

    expect(acceptance.status).toBe('fulfilled')
  })

  it('will not admit anybody on a refunded ticket, by pass or by code', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: TICKET_STATES.REFUNDED, credentialHash: null },
    })

    const refunded = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    await expect(
      prisma.checkIn.create({
        data: {
          id: id('checkin'),
          ticketId: refunded.id,
          eventSessionId: world.session.id,
          scannedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/admissible|refunded/i)
  })
})

when()('an invitation that lapses', () => {
  it('puts the ticket back and cannot be accepted afterwards', async () => {
    const world = await buildIssuedTickets()
    const [ticket] = world.issued
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket,
        toEmail: world.recipient.email,
        fromUserId: world.holder.id,
        tokenHash,
        // Already lapsed when it was written, which is what a sweep finds.
        expiresAt: new Date(Date.now() - 1000),
        now: new Date(),
      }),
    )

    const pending = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })

    const ended = await prisma.$transaction((tx) =>
      endTransfer(tx, { transfer, ticket: pending, outcome: 'EXPIRED', now: new Date() }),
    )

    expect(ended).toBe(true)

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    // Exactly where it was. The holder keeps a working pass.
    expect(after.status).toBe(TICKET_STATES.VALID)
    expect(after.credentialHash).not.toBeNull()

    // And ending it twice ends it once.
    const again = await prisma.$transaction((tx) =>
      endTransfer(tx, { transfer, ticket: after, outcome: 'EXPIRED', now: new Date() }),
    )

    expect(again).toBe(false)
  })
})
