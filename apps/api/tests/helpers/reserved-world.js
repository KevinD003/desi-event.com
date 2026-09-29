/**
 * A published event with one reserved-seat night sold the way an organiser
 * authors it: two price zones, one reserved tier per zone, and every seat
 * bound to the tier pricing its zone.
 *
 * The older seating fixtures sell seats under the general-admission tier with
 * a price override per seat, which is how the checkout was first built. That
 * never exercised a real reserved tier — `reserved: true`, `quantityTotal: 0`,
 * a price zone — and a real one is what an organiser makes. This world is that.
 *
 *   Stalls, row A: A1 (Front, wheelchair space), A2 (Front), A3 (Front)
 *   Stalls, row B: B1 (Back, companion of A1),   B2 (Back),  B3 (Back, obstructed view)
 *
 * The wheelchair space and its companion sit in different zones on purpose: a
 * companion pulled in from the other zone is sold under its own zone's tier.
 *
 * @module @desi-event/api/tests/helpers/reserved-world
 */

import { createTestApp } from './app.js'
import { makeWorld, minutesFromNow } from './fixtures.js'
import { cuid } from './prisma-stub.js'

/** What a Front seat costs: the Front tier's price. */
export const FRONT_CENTS = 250_000

/** What a Back seat costs: the Back tier's price. */
export const BACK_CENTS = 90_000

/**
 * Build the world and a test app over it.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string>} [options.statuses] Seat label to `EventSeatStatus`.
 * @param {string[]} [options.unbound] Seat labels no tier sells.
 * @param {object} [options.front] Overrides for the Front tier row.
 * @param {object} [options.back] Overrides for the Back tier row.
 * @param {object} [options.session] Overrides for the reserved night's row.
 * @param {object} [options.providers] A provider registry, e.g. to force a decline.
 * @returns {Promise<object>} The harness, plus the ids of everything seated.
 */
export async function reservedWorld({
  statuses = {},
  unbound = [],
  front = {},
  back = {},
  session: sessionOverrides = {},
  providers,
} = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  const venueMapId = cuid()
  const versionId = cuid()
  const sectionId = cuid()
  const rowA = cuid()
  const rowB = cuid()
  const sessionId = cuid()
  const frontZone = { id: cuid(), venueMapVersionId: versionId, name: 'Front', sortOrder: 1 }
  const backZone = { id: cuid(), venueMapVersionId: versionId, name: 'Back', sortOrder: 2 }

  seed.venueMap = [{ id: venueMapId, venueId: ids.venue.id, name: 'Main hall' }]
  seed.venueMapVersion = [
    {
      id: versionId,
      venueMapId,
      version: 1,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      seatCount: 6,
    },
  ]
  seed.section = [
    { id: sectionId, venueMapVersionId: versionId, name: 'Stalls', kind: 'SEATED', sortOrder: 1 },
  ]
  seed.seatRow = [
    { id: rowA, venueMapVersionId: versionId, sectionId, label: 'A', sortOrder: 1 },
    { id: rowB, venueMapVersionId: versionId, sectionId, label: 'B', sortOrder: 2 },
  ]
  seed.priceZone = [
    { ...frontZone, colourToken: 'zone-1' },
    { ...backZone, colourToken: 'zone-2' },
  ]

  /**
   * One seat of the map.
   *
   * @param {string} label The seat label.
   * @param {string} rowId Its row.
   * @param {object} zone Its price zone.
   * @param {number} sortOrder Its place in the row.
   * @param {object} [extra] Accessibility attributes.
   * @returns {object} A `Seat` row.
   */
  const seat = (label, rowId, zone, sortOrder, extra = {}) => ({
    id: cuid(),
    venueMapVersionId: versionId,
    sectionId,
    rowId,
    label,
    sortOrder,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
    priceZoneId: zone.id,
    ...extra,
  })

  const a1 = seat('A1', rowA, frontZone, 1, { accessible: true })
  const seats = [
    a1,
    seat('A2', rowA, frontZone, 2),
    seat('A3', rowA, frontZone, 3),
    seat('B1', rowB, backZone, 1, { companionOfSeatId: a1.id }),
    seat('B2', rowB, backZone, 2),
    seat('B3', rowB, backZone, 3, { obstructedView: true }),
  ]

  seed.seat = seats

  const reservedSession = {
    id: sessionId,
    eventId: ids.publishedEvent.id,
    startsAt: minutesFromNow(60 * 24 * 3),
    endsAt: minutesFromNow(60 * 24 * 3 + 240),
    doorsOpenAt: minutesFromNow(60 * 24 * 3 - 30),
    timezone: 'Asia/Kolkata',
    label: 'Night 2',
    salesStartAt: null,
    salesEndAt: null,
    status: 'SCHEDULED',
    venueMapVersionId: versionId,
    capacity: null,
    sortOrder: 1,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    ...sessionOverrides,
  }

  seed.eventSession.push(reservedSession)

  const tier = (name, zone, priceCents, overrides) => ({
    ...ids.generalAdmission,
    id: cuid(),
    name,
    description: null,
    priceCents,
    quantityTotal: 0,
    quantitySold: 0,
    minPerOrder: 1,
    maxPerOrder: 6,
    reserved: true,
    eventSessionId: sessionId,
    priceZoneId: zone.id,
    sortOrder: 10 + zone.sortOrder,
    ...overrides,
  })

  const frontTier = tier('Front stalls', frontZone, FRONT_CENTS, front)
  const backTier = tier('Back stalls', backZone, BACK_CENTS, back)

  seed.ticketType.push(frontTier, backTier)

  const eventSeatIdByLabel = {}
  const tierByZone = { [frontZone.id]: frontTier.id, [backZone.id]: backTier.id }

  seed.eventSeat = seats.map((row) => {
    const id = cuid()
    eventSeatIdByLabel[row.label] = id

    return {
      id,
      eventSessionId: sessionId,
      seatId: row.id,
      ticketTypeId: unbound.includes(row.label) ? null : tierByZone[row.priceZoneId],
      status: statuses[row.label] ?? 'AVAILABLE',
      holdId: null,
      orderItemId: null,
      priceCentsOverride: null,
      blockedReason: null,
    }
  })

  const harness = await createTestApp({ seed, ids, providers })

  return {
    ...harness,
    sessionId,
    reservedSession,
    frontZone,
    backZone,
    frontTier,
    backTier,
    seats,
    seatIdByLabel: Object.fromEntries(seats.map((row) => [row.label, row.id])),
    eventSeatIdByLabel,
  }
}
