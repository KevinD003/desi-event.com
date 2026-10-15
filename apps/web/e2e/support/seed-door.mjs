/**
 * The people and tickets the door screens need.
 *
 * - A **scanner**, scoped to the alpha event and nothing else. SCANNER is not a
 *   privileged role, so it signs in without a second factor, as a steward on
 *   a borrowed phone would.
 * - A **steward** with STAFF and no scope — a door role that admits nobody,
 *   which is what the empty state is for.
 * - A **holder** who can sign in and open their own ticket's pass.
 * - A paid order of door tickets, each issued the way checkout issues one:
 *   with a credential derived from the API's `AUTH_SECRET`, of which only the
 *   digest is stored. The last carries a very long name, for the layout cases.
 *
 * These tickets are the door's own. The other detail suites use the tickets
 * `seed-detail-screens.mjs` makes and expect them unadmitted; admitting one of
 * those here would break them in file order.
 *
 * @module e2e/support/seed-door
 */

import { createPrismaClient } from '@desi-event/db'

import { hashPassword } from '@desi-event/auth'

import { issueTicketCredential } from '../../../api/src/lib/ticket-credentials.js'
import { AUTH_SECRET, CONNECTION, PASSWORD } from './seed-refusals.mjs'

/** How many door tickets the order carries. */
export const DOOR_TICKETS = 6

/** The name on the last ticket: long enough to wrap at every width. */
export const LONG_NAME =
  'Venkatalakshmi Subrahmanyam Chandrasekharan-Raghunathan Bhattacharya Srinivasaraghavan'

/**
 * Seed the door world.
 *
 * @param {object} options Options.
 * @param {string} options.tag The run suffix.
 * @param {string} options.organizationId The alpha organisation.
 * @param {string} options.eventId The alpha event.
 * @returns {Promise<object>} Emails, codes and ticket ids.
 */
export async function seedDoor({ tag, organizationId, eventId }) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const passwordHash = await hashPassword(PASSWORD)

  /**
   * A signed-in-able account, upserted: fixture users outlive a run, because
   * the audit log's immutability refuses the update deleting one would make.
   *
   * @param {string} email The address.
   * @param {string} displayName The name.
   * @param {string} role The platform role.
   * @returns {Promise<object>} The user.
   */
  const account = (email, displayName, role) =>
    prisma.user.upsert({
      where: { email },
      update: { passwordHash, displayName, role, emailVerified: true },
      create: { email, passwordHash, displayName, role, emailVerified: true },
    })

  const scanner = await account(`scanner-${tag}@organiser.test`, 'Door Scanner', 'ORGANIZER')
  const steward = await account(`steward-${tag}@organiser.test`, 'Unassigned Steward', 'ORGANIZER')
  const holder = await account(`door-holder-${tag}@attendee.test`, 'Asha Door', 'ATTENDEE')

  const scannerMembership = await prisma.membership.upsert({
    where: { userId_organizationId: { userId: scanner.id, organizationId } },
    update: { role: 'SCANNER' },
    create: { userId: scanner.id, organizationId, role: 'SCANNER' },
  })

  await prisma.scannerScope.upsert({
    where: { membershipId_eventId: { membershipId: scannerMembership.id, eventId } },
    update: {},
    create: { membershipId: scannerMembership.id, eventId },
  })

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: steward.id, organizationId } },
    update: { role: 'STAFF' },
    create: { userId: steward.id, organizationId, role: 'STAFF' },
  })

  const ticketType = await prisma.ticketType.findFirst({ where: { eventId } })

  const order = await prisma.order.create({
    data: {
      reference: `DE-DOOR${tag.slice(-4).toUpperCase()}`,
      eventId,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'Asha Door',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100_000 * DOOR_TICKETS,
      totalCents: 100_000 * DOOR_TICKETS,
      paidAt: new Date(),
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: DOOR_TICKETS,
      unitPriceCents: 100_000,
      subtotalCents: 100_000 * DOOR_TICKETS,
    },
  })

  const tickets = []

  for (let index = 0; index < DOOR_TICKETS; index += 1) {
    const created = await prisma.ticket.create({
      data: {
        orderItemId: orderItem.id,
        code: `DE-DOOR-${tag}-${index}`.toUpperCase(),
        ownerUserId: holder.id,
        attendeeName: index === DOOR_TICKETS - 1 ? LONG_NAME : `Asha Door ${index + 1}`,
        status: 'VALID',
      },
    })

    // The digest only. The credential itself is never written anywhere: the
    // holder's pass screen derives it again, which is the path under test.
    const { credentialHash } = issueTicketCredential({
      secret: AUTH_SECRET,
      ticketId: created.id,
      version: 1,
    })

    await prisma.ticket.update({
      where: { id: created.id },
      data: { credentialHash, credentialVersion: 1, credentialIssuedAt: new Date() },
    })

    tickets.push(created)
  }

  await prisma.$disconnect()

  return {
    scannerEmail: scanner.email,
    stewardEmail: steward.email,
    holderEmail: holder.email,
    doorOrderId: order.id,
    doorTicketIds: tickets.map((ticket) => ticket.id),
    doorCodes: tickets.map((ticket) => ticket.code),
  }
}

/**
 * Remove the door's order and tickets, and the scanner's scope.
 *
 * Tickets go first, and their check-ins with them by cascade; then the order.
 * The accounts stay, for the reason `seedDoor` upserts them.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupDoor(tag) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const reference = `DE-DOOR${tag.slice(-4).toUpperCase()}`

  try {
    const order = await prisma.order.findUnique({ where: { reference } })

    if (order) {
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } })

      await prisma.ticket.deleteMany({
        where: { orderItemId: { in: items.map((item) => item.id) } },
      })
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } })
      await prisma.order.delete({ where: { id: order.id } })
    }

    await prisma.membership.deleteMany({
      where: {
        user: { email: { in: [`scanner-${tag}@organiser.test`, `steward-${tag}@organiser.test`] } },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}
