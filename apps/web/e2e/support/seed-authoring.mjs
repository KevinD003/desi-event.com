/**
 * Three of gamma's events for the authoring journeys that need a state the
 * lifecycle story never passes through on its own.
 *
 *   - **A draft** with one general-admission night on gamma's venue, whose
 *     published balcony plan the journey gives a second, seated night — the
 *     way to a reserved ticket type priced by a zone.
 *   - **A live event with sales**: on sale, one night of twenty, a ticket type
 *     "General" at $35 of which two are sold (a paid order, issued the way
 *     checkout issues one), and an unsold draft type "Spare". What a live
 *     event may and may not change depends on what has been sold, so the
 *     sales are real rows.
 *   - **A rejected event**, with the moderator's reason on it and in its
 *     history, to be reworked as a draft.
 *
 * All three hang from gamma (`seed-feature-world.mjs`), never alpha or beta,
 * whose counts later specs pin. The buyer of the two tickets is an account of
 * its own, so no wallet another spec reads grows by a ticket.
 *
 * ## Cleanup
 *
 * Each event goes with everything hanging from it: tickets, the order, seats,
 * ticket types, nights and the moderation history. The buyer's sessions go;
 * the account stays, and so do its audit rows.
 * The audit rows deliberately stay: `desi_audit_log_immutable` refuses an
 * UPDATE or a DELETE on `AuditLog`, and deleting an account would be an update
 * of its audit rows.
 *
 * @module e2e/support/seed-authoring
 */

import { createPrismaClient } from '@desi-event/db'

import { hashPassword } from '@desi-event/auth'

import {
  FEATURE_CURRENCY,
  FEATURE_TIME_ZONE,
  checkedTag,
  seedPaidOrder,
} from './seed-feature-world.mjs'
import { CONNECTION, PASSWORD } from './seed-refusals.mjs'

/** One day, in milliseconds. */
const DAY_MS = 86_400_000

/** The live event's one ticket type on sale, as the journey reads it. */
export const LIVE_TIER = Object.freeze({ name: 'General', priceCents: 3_500, total: 10, sold: 2 })

/** The live event's unsold draft ticket type. */
export const SPARE_TIER = 'Spare'

/** Why the rejected event was rejected. */
export const REJECTION_REASON = 'The description promises a headliner who is not booked.'

/**
 * The three events' titles and slugs, and the buyer's address.
 *
 * @param {string} tag The run suffix.
 * @returns {{draft: {title: string, slug: string}, live: {title: string, slug: string}, rejected: {title: string, slug: string}, buyerEmail: string}} The names.
 */
export function authoringNames(tag) {
  checkedTag(tag)

  return {
    draft: { title: `Gamma Balcony Draft ${tag}`, slug: `gamma-authoring-draft-${tag}` },
    live: { title: `Gamma Live Evening ${tag}`, slug: `gamma-authoring-live-${tag}` },
    rejected: { title: `Gamma Rejected Evening ${tag}`, slug: `gamma-authoring-rejected-${tag}` },
    buyerEmail: `authoring-buyer-${tag}@attendee.test`,
  }
}

/**
 * A night, as UTC instants: doors, start and end, 7 pm to midnight in New
 * York's summer (an hour earlier in its winter).
 *
 * @param {number} daysAhead How many days from today.
 * @returns {{doorsOpenAt: Date, startsAt: Date, endsAt: Date}} The instants.
 */
function night(daysAhead) {
  const day = new Date(Date.now() + daysAhead * DAY_MS)
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())

  return {
    doorsOpenAt: new Date(midnight + 23 * 3_600_000),
    startsAt: new Date(midnight + 23.5 * 3_600_000),
    endsAt: new Date(midnight + 28 * 3_600_000),
  }
}

/** Every event here has the three policies review asks for. */
const POLICIES = Object.freeze({
  entry: 'Doors open half an hour before. Bring the pass on your phone.',
  refund: 'Refunds up to seven days before the night.',
  conduct: 'Be kind to each other and to the floor.',
})

/**
 * Seed the three events.
 *
 * @param {object} options Options.
 * @param {string} options.tag The run suffix.
 * @param {string} options.organizationId Gamma's organisation.
 * @param {string} options.venueId Gamma's venue, whose balcony plan is published.
 * @returns {Promise<{draftEventId: string, liveEventId: string, rejectedEventId: string, buyerId: string}>} The ids.
 */
export async function seedAuthoring({ tag, organizationId, venueId }) {
  const names = authoringNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })
  const now = new Date()

  /**
   * An event under gamma, at its venue.
   *
   * @param {object} fields What differs.
   * @returns {Promise<object>} The event.
   */
  const event = (fields) =>
    prisma.event.create({
      data: {
        organizationId,
        venueId,
        timezone: FEATURE_TIME_ZONE,
        category: 'GARBA_DANDIYA',
        summary: 'A night of garba at the hall.',
        description: 'A general-admission floor with a live band, for one night.',
        policies: POLICIES,
        ...fields,
      },
    })

  let buyer

  try {
    buyer = await prisma.user.upsert({
      where: { email: names.buyerEmail },
      update: {
        passwordHash: await hashPassword(PASSWORD),
        displayName: 'Ishaan Kapoor',
        role: 'ATTENDEE',
        emailVerified: true,
      },
      create: {
        email: names.buyerEmail,
        passwordHash: await hashPassword(PASSWORD),
        displayName: 'Ishaan Kapoor',
        role: 'ATTENDEE',
        emailVerified: true,
      },
    })

    // ------------------------------------------------------------ the draft

    const draftNight = night(80)
    const draft = await event({
      ...names.draft,
      status: 'DRAFT',
      startsAt: draftNight.startsAt,
      endsAt: night(81).endsAt,
    })

    await prisma.eventSession.create({
      data: {
        eventId: draft.id,
        ...draftNight,
        timezone: FEATURE_TIME_ZONE,
        capacity: 50,
        sortOrder: 0,
        label: 'Floor night',
      },
    })

    // ------------------------------------------------------- live, with sales

    const liveNight = night(85)
    const live = await event({
      ...names.live,
      status: 'ON_SALE',
      publishedAt: now,
      salesOpenedAt: now,
      startsAt: liveNight.startsAt,
      endsAt: liveNight.endsAt,
    })
    const liveSession = await prisma.eventSession.create({
      data: {
        eventId: live.id,
        ...liveNight,
        timezone: FEATURE_TIME_ZONE,
        status: 'ON_SALE',
        capacity: 20,
        sortOrder: 0,
      },
    })
    const general = await prisma.ticketType.create({
      data: {
        eventId: live.id,
        eventSessionId: liveSession.id,
        name: LIVE_TIER.name,
        priceCents: LIVE_TIER.priceCents,
        currency: FEATURE_CURRENCY,
        quantityTotal: LIVE_TIER.total,
        status: 'ON_SALE',
        sortOrder: 0,
      },
    })

    await prisma.ticketType.create({
      data: {
        eventId: live.id,
        eventSessionId: liveSession.id,
        name: SPARE_TIER,
        priceCents: 2_000,
        currency: FEATURE_CURRENCY,
        quantityTotal: 5,
        status: 'DRAFT',
        sortOrder: 1,
      },
    })

    // ------------------------------------------------------------- rejected

    const rejectedNight = night(90)
    const rejected = await event({
      ...names.rejected,
      status: 'REJECTED',
      moderationNote: REJECTION_REASON,
      startsAt: rejectedNight.startsAt,
      endsAt: rejectedNight.endsAt,
    })

    await prisma.eventSession.create({
      data: {
        eventId: rejected.id,
        ...rejectedNight,
        timezone: FEATURE_TIME_ZONE,
        capacity: 40,
        sortOrder: 0,
      },
    })
    await prisma.eventModerationAction.create({
      data: {
        eventId: rejected.id,
        fromStatus: 'REVIEW_PENDING',
        toStatus: 'REJECTED',
        reason: REJECTION_REASON,
      },
    })

    await prisma.$disconnect()

    // Two sold, issued the way settlement issues them; its own connection.
    const tag4 = tag.toUpperCase().slice(-8)

    await seedPaidOrder({
      reference: `DE-AU${tag4}`,
      codePrefix: `DE-AUT-${tag4}-`,
      eventId: live.id,
      eventSessionId: liveSession.id,
      ticketTypeId: general.id,
      buyer: { id: buyer.id, email: buyer.email, displayName: buyer.displayName },
      attendeeNames: ['Ishaan Kapoor', 'Lata Kapoor'],
      unitPriceCents: LIVE_TIER.priceCents,
    })

    return {
      draftEventId: draft.id,
      liveEventId: live.id,
      rejectedEventId: rejected.id,
      buyerId: buyer.id,
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Remove the three events and everything hanging from them.
 *
 * Safe to run twice, and after a journey that stopped part-way.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupAuthoring(tag) {
  const names = authoringNames(tag)
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const events = await prisma.event.findMany({
      where: { slug: { in: [names.draft.slug, names.live.slug, names.rejected.slug] } },
    })

    for (const event of events) {
      await prisma.ticketHold
        .deleteMany({ where: { ticketType: { eventId: event.id } } })
        .catch(() => {})

      const orders = await prisma.order.findMany({
        where: { eventId: event.id },
        include: { items: true },
      })

      for (const order of orders) {
        const itemIds = order.items.map((item) => item.id)

        await prisma.ticket.deleteMany({ where: { orderItemId: { in: itemIds } } }).catch(() => {})
        await prisma.orderItem.deleteMany({ where: { orderId: order.id } }).catch(() => {})
        await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => {})
        await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
      }

      const sessions = await prisma.eventSession.findMany({ where: { eventId: event.id } })

      for (const session of sessions) {
        await prisma.eventSeat.deleteMany({ where: { eventSessionId: session.id } }).catch(() => {})
      }

      await prisma.notificationOutbox
        .deleteMany({ where: { dedupeKey: { contains: event.id } } })
        .catch(() => {})
      await prisma.ticketType.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId: event.id } }).catch(() => {})
      await prisma.eventModerationAction
        .deleteMany({ where: { eventId: event.id } })
        .catch(() => {})
      await prisma.event.delete({ where: { id: event.id } }).catch(() => {})
    }

    await prisma.session
      .deleteMany({ where: { user: { email: names.buyerEmail } } })
      .catch(() => {})
  } finally {
    await prisma.$disconnect()
  }
}
