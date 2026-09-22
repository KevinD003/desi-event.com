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
import { WALLET_INCLUDE, toOrder, toWalletTicket } from '../src/lib/presenters.js'
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

when()('ownership after a handover', () => {
  /**
   * Read an order the way `orders.get` reads one.
   *
   * @param {string} orderId Which order.
   * @returns {Promise<object>} The presented payload.
   */
  async function readOrder(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { tickets: true } },
        event: { include: { venue: true, organization: true, ticketTypes: true } },
      },
    })

    return toOrder(order)
  }

  /**
   * Read somebody's wallet the way `tickets.listMine` reads one.
   *
   * @param {string} userId Whose.
   * @returns {Promise<object[]>} The presented rows.
   */
  async function readWallet(userId) {
    const rows = await prisma.ticket.findMany({
      where: { ownerUserId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: WALLET_INCLUDE,
    })

    return rows.map((row) => toWalletTicket(row, { viewerUserId: userId }))
  }

  it('moves the ticket between wallets and keeps it off the wrong order', async () => {
    // The stubbed suite proves the presenter. This proves the presenter against
    // rows PostgreSQL actually wrote, through the real `acceptTransfer`, with
    // the real foreign keys — including the one that makes the leak possible:
    // the minted ticket hangs off the sender's `orderItemId`.
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

    const accepted = await prisma.$transaction((tx) =>
      acceptTransfer(tx, {
        transfer,
        ticket: pending,
        recipient: world.recipient,
        credentialSecret: SECRET,
        generateTicketCode: () => `DET-${RUN.toUpperCase()}OW${(sequence += 1).toString(36)}`,
        now: new Date(),
      }),
    )

    expect(accepted.accepted).toBe(true)

    const minted = accepted.ticket

    // The fact that makes this worth testing against a real database: one order
    // item, two ticket rows, two different owners.
    expect(minted.orderItemId).toBe(ticket.orderItemId)

    const order = await readOrder(world.order.id)
    const ids = order.tickets.map((row) => row.id)

    expect(ids).toEqual([ticket.id])
    expect(ids).not.toContain(minted.id)
    expect(order.tickets[0].purchaserHolding).toBe('TRANSFERRED_AWAY')
    // Derived from the status, which is the only column that moved. The
    // sender's row still carries their own id in `ownerUserId` after an
    // accepted transfer, so a predicate over the owner columns would call this
    // ticket theirs — against a real database, not just in the stub.
    expect(order.tickets[0].supersededByLaterTicket).toBe(true)
    expect(JSON.stringify(order)).not.toContain(minted.code)

    const senderWallet = await readWallet(world.holder.id)
    const recipientWallet = await readWallet(world.recipient.id)

    expect(senderWallet.map((row) => row.id)).toEqual([ticket.id])
    expect(senderWallet[0].admits).toBe(false)
    expect(senderWallet[0].holderRelationship).toBe('PURCHASED')

    expect(recipientWallet.map((row) => row.id)).toEqual([minted.id])
    expect(recipientWallet[0].admits).toBe(true)
    // Bought by somebody else, so the order behind it is not theirs to see.
    expect(recipientWallet[0].holderRelationship).toBe('RECEIVED')
    expect(recipientWallet[0].orderReference).toBeNull()
    expect(JSON.stringify(recipientWallet)).not.toContain(world.order.reference)
  })

  it('hands one invitation to one person when two accepts race', async () => {
    // Both callers read the same PENDING row and both try to take it. The
    // conditional `updateMany` inside `acceptTransfer` is what decides, and the
    // thing that must not happen is two tickets minted against one invitation —
    // two live passes for one seat.
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

    /**
     * Accept, the way the route does, swallowing a losing race.
     *
     * @param {string} suffix Distinguishes the generated codes.
     * @returns {Promise<object>} The outcome, or the error as data.
     */
    const accept = (suffix) =>
      prisma
        .$transaction((tx) =>
          acceptTransfer(tx, {
            transfer,
            ticket: pending,
            recipient: world.recipient,
            credentialSecret: SECRET,
            generateTicketCode: () =>
              `DET-${RUN.toUpperCase()}${suffix}${(sequence += 1).toString(36)}`,
            now: new Date(),
          }),
        )
        .catch((error) => ({ accepted: false, failed: String(error?.message ?? error) }))

    const outcomes = await Promise.all([accept('R1'), accept('R2')])

    expect(outcomes.filter((outcome) => outcome.accepted)).toHaveLength(1)

    const minted = await prisma.ticket.findMany({ where: { supersedesTicketId: ticket.id } })

    expect(minted).toHaveLength(1)

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(after.status).toBe(TICKET_STATES.TRANSFERRED)
    // The sender's pass is dead whichever caller won.
    expect(after.credentialHash).toBeNull()

    // And exactly one wallet gained exactly one ticket.
    const recipientWallet = await readWallet(world.recipient.id)

    expect(recipientWallet).toHaveLength(1)
    expect(recipientWallet[0].id).toBe(minted[0].id)

    // The settlement property, asked of the line the race ran on.
    //
    // This is the shape that broke the reliability check: the winner mints onto
    // the buyer's own order item, so the line legitimately holds more rows than
    // it sold. What must stay true is not the row count but the count of
    // *current* chains — tickets on this line with no successor on this line —
    // and of usable passes. One of each, for one sold, however the race went.
    //
    // Counted here rather than by calling `checkInvariants`, which asks the
    // whole database: `settlement-invariants.test.js` is what proves the query
    // right, and a database-wide assertion in this file would answer for rows
    // that a concurrently running suite owns. What this case has to establish is
    // that a raced accept leaves one current chain, and that is a question about
    // this line.
    const onTheLine = await prisma.ticket.findMany({
      where: { orderItemId: world.orderItem.id },
      select: { id: true, supersedesTicketId: true, credentialHash: true },
    })

    const superseded = new Set(onTheLine.map((row) => row.supersedesTicketId).filter(Boolean))
    const current = onTheLine.filter((row) => !superseded.has(row.id))
    const usable = onTheLine.filter((row) => row.credentialHash !== null)

    expect(onTheLine.length, 'the predecessor is kept, so the lineage is auditable').toBe(2)
    expect(
      current.map((row) => row.id),
      'one current chain for one sold',
    ).toEqual([minted[0].id])
    expect(
      usable.map((row) => row.id),
      'one way in for one sold',
    ).toEqual([minted[0].id])
  })

  it('does not let a declined invitation move ownership', async () => {
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

    await prisma.$transaction((tx) =>
      endTransfer(tx, {
        transfer,
        ticket: pending,
        outcome: 'DECLINED',
        actorId: world.recipient.id,
        now: new Date(),
      }),
    )

    const senderWallet = await readWallet(world.holder.id)
    const recipientWallet = await readWallet(world.recipient.id)

    expect(senderWallet.map((row) => row.id)).toEqual([ticket.id])
    expect(senderWallet[0].admits).toBe(true)
    expect(senderWallet[0].pendingTransfer).toBeNull()
    expect(recipientWallet).toHaveLength(0)

    // The sender's pass still matches what is stored, which is the property a
    // declined invitation has to preserve: nothing was rotated.
    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(after.credentialHash).toBe(pending.credentialHash)
    expect(after.credentialVersion).toBe(pending.credentialVersion)
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
