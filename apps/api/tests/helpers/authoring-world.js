/**
 * A fixture world for the authoring tests: the ordinary world, plus a published
 * seating map at the fixture venue and a reserved session on the draft event.
 *
 * The map has two published versions. Version one has two price zones, Stalls
 * and Balcony, with three seats each; version two has one zone of its own, so a
 * tier can be pointed at a zone from the wrong version.
 *
 * @module @desi-event/api/tests/helpers/authoring-world
 */

import { makeWorld, minutesFromNow } from './fixtures.js'
import { cuid } from './prisma-stub.js'

/**
 * Build the world.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.prepared] Whether the reserved session's seat rows exist already.
 * @returns {Promise<{seed: object, ids: object}>} The seed and every id a test asserts on.
 */
export async function authoringWorld({ prepared = false } = {}) {
  const { seed, ids } = await makeWorld()

  const venueMapId = cuid()
  const versionId = cuid()
  const otherVersionId = cuid()
  const sectionId = cuid()
  const rowId = cuid()
  const stalls = {
    id: cuid(),
    venueMapVersionId: versionId,
    name: 'Stalls',
    colourToken: 'zone-1',
    sortOrder: 0,
  }
  const balcony = {
    id: cuid(),
    venueMapVersionId: versionId,
    name: 'Balcony',
    colourToken: 'zone-2',
    sortOrder: 1,
  }
  const elsewhere = {
    id: cuid(),
    venueMapVersionId: otherVersionId,
    name: 'Terrace',
    colourToken: 'zone-3',
    sortOrder: 0,
  }

  seed.venueMap = [{ id: venueMapId, venueId: ids.venue.id, name: 'Main hall' }]
  seed.venueMapVersion = [
    {
      id: versionId,
      venueMapId,
      version: 1,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      seatCount: 6,
    },
    {
      id: otherVersionId,
      venueMapId,
      version: 2,
      publishedAt: new Date('2026-02-01T00:00:00Z'),
      seatCount: 0,
    },
  ]
  seed.priceZone = [stalls, balcony, elsewhere]
  seed.section = [
    { id: sectionId, venueMapVersionId: versionId, name: 'Hall', kind: 'SEATED', sortOrder: 1 },
  ]
  seed.seatRow = [{ id: rowId, venueMapVersionId: versionId, sectionId, label: 'A', sortOrder: 1 }]
  seed.seat = Array.from({ length: 6 }, (_, index) => ({
    id: cuid(),
    venueMapVersionId: versionId,
    sectionId,
    rowId,
    label: `A${index + 1}`,
    sortOrder: index + 1,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
    priceZoneId: index < 3 ? stalls.id : balcony.id,
  }))

  const reservedSession = {
    id: cuid(),
    eventId: ids.draftEvent.id,
    startsAt: minutesFromNow(60 * 24 * 61),
    endsAt: minutesFromNow(60 * 24 * 61 + 180),
    doorsOpenAt: null,
    timezone: 'Asia/Kolkata',
    salesStartAt: null,
    salesEndAt: null,
    status: 'SCHEDULED',
    venueMapVersionId: versionId,
    capacity: null,
    sortOrder: 1,
    label: null,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  }

  seed.eventSession.push(reservedSession)

  if (prepared) {
    seed.eventSeat = seed.seat.map((seat) => ({
      id: cuid(),
      eventSessionId: reservedSession.id,
      seatId: seat.id,
      ticketTypeId: null,
      status: 'AVAILABLE',
      holdId: null,
      orderItemId: null,
      priceCentsOverride: null,
      blockedReason: null,
    }))
  }

  return {
    seed,
    ids: {
      ...ids,
      venueMapId,
      versionId,
      otherVersionId,
      stalls,
      balcony,
      elsewhere,
      seats: seed.seat,
      reservedSession,
      gaSession: seed.eventSession.find(
        (row) => row.eventId === ids.draftEvent.id && !row.venueMapVersionId,
      ),
      publishedSession: seed.eventSession.find((row) => row.eventId === ids.publishedEvent.id),
    },
  }
}

/**
 * The event's current revision, which every authoring write must quote back.
 *
 * @param {object} app The Fastify instance.
 * @param {string} eventId The event.
 * @param {object} headers Authenticated headers.
 * @returns {Promise<number>} The revision.
 */
export async function revisionOf(app, eventId, headers) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/events/${eventId}/sessions`,
    headers,
  })

  if (response.statusCode !== 200) {
    throw new Error(`Reading the revision failed: ${response.statusCode} ${response.body}`)
  }

  return response.json().meta.revision
}

/**
 * Audit rows written with an action, oldest first.
 *
 * @param {object} prisma The stub.
 * @param {string} action The action.
 * @returns {object[]} The rows.
 */
export function auditRows(prisma, action) {
  return (prisma._store.auditLog ?? []).filter((row) => row.action === action)
}

/**
 * Put a paid order with one line for a tier into the store.
 *
 * @param {object} prisma The stub.
 * @param {object} options Options.
 * @param {string} options.eventId The event.
 * @param {string} options.ticketTypeId The tier the line is for.
 * @param {number} [options.quantity] How many.
 * @param {string|null} [options.eventSessionId] The order's own session, or null as general-admission checkout writes it.
 * @param {string} [options.status] The order's status.
 * @returns {{order: object, item: object}} The rows.
 */
export function seedOrder(
  prisma,
  { eventId, ticketTypeId, quantity = 1, eventSessionId = null, status = 'PAID' },
) {
  const order = {
    id: cuid(),
    reference: `DE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    eventId,
    eventSessionId,
    userId: null,
    buyerEmail: `buyer-${Math.random().toString(36).slice(2, 8)}@example.com`,
    buyerName: 'A Buyer',
    status,
    currency: 'INR',
    subtotalCents: 1000 * quantity,
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    totalCents: 1000 * quantity,
    promoCodeId: null,
    expiresAt: null,
    paidAt: status === 'PAID' ? new Date() : null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId,
    quantity,
    unitPriceCents: 1000,
    attendeeNames: [],
  }

  prisma._store.order.push(order)
  prisma._store.orderItem.push(item)

  return { order, item }
}

/**
 * Put a live general-admission hold for a tier into the store.
 *
 * @param {object} prisma The stub.
 * @param {object} options Options.
 * @param {string} options.ticketTypeId The tier.
 * @param {number} [options.quantity] How many it keeps off sale.
 * @param {string|null} [options.eventSessionId] The session it reserves against.
 * @returns {object} The hold row.
 */
export function seedHold(prisma, { ticketTypeId, quantity = 1, eventSessionId = null }) {
  const hold = {
    id: cuid(),
    ticketTypeId,
    orderId: null,
    quantity,
    status: 'ACTIVE',
    expiresAt: minutesFromNow(10),
    userId: null,
    guestTokenHash: 'a'.repeat(64),
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    eventSessionId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  prisma._store.ticketHold.push(hold)

  return hold
}
