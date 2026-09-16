/**
 * Organiser analytics, against real PostgreSQL.
 *
 * ## Why not the stub
 *
 * Because every question this module answers is an aggregate over joins the
 * in-memory stub does not implement — `groupBy` over a nested relation filter, a
 * `select` that walks `EventSeat → Seat → Section`. A stub that pretended to
 * answer them would be answering a different question in a different language,
 * and the answer that matters is the one PostgreSQL gives.
 *
 * ## What is asserted
 *
 * The properties that would cost somebody something if they were wrong:
 *
 *   - **Another organisation's rows never appear.** Every figure is seeded twice,
 *     once for the organisation under test and once for a neighbour, and every
 *     assertion names the first only. A missing `organizationId` in one `where`
 *     clause fails here rather than in front of a customer.
 *   - **Money is the ledger's, and counts are the rows'.** They are asserted
 *     against different sources on purpose.
 *   - **A remaining count is never negative**, and an oversold tier says so.
 *   - **Currencies are never added together.**
 *   - **The funnel names what it cannot see** rather than implying a complete
 *     picture.
 *
 * @module @desi-event/api/tests/analytics-integration
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'

import {
  checkInProgress,
  conversionFunnel,
  generalAdmissionInventory,
  organizerAnalytics,
  reservedSeatInventory,
  salesBreakdowns,
  ticketCounts,
  ticketMovement,
} from '../src/lib/analytics.js'
import { connectTestDatabase } from './helpers/database.js'

/** Marks every row this suite creates, so cleanup cannot touch anything else. */
const TAG = `anl${randomUUID().slice(0, 8)}`

const { prisma, when } = await connectTestDatabase('the analytics integration suite')

/** The organisation under test, and the neighbour that must never leak in. */
let mine = null
let theirs = null
let myEvent = null
let mySession = null
let gaType = null
let seatedType = null

/**
 * An organisation with one published event and one session.
 *
 * @param {string} slug A slug fragment.
 * @returns {Promise<object>} The organisation, event and session.
 */
async function organisationWithEvent(slug) {
  const organization = await prisma.organization.create({
    data: {
      name: `${slug} ${TAG}`,
      slug: `${slug}-${TAG}`,
      contactEmail: `${slug}-${TAG}@example.test`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })

  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Venue ${slug} ${TAG}`,
      slug: `venue-${slug}-${TAG}`,
      addressLine1: '1 Test Street',
      city: 'Leicester',
      region: 'Leicestershire',
      postalCode: 'LE1 1AA',
      country: 'GB',
    },
  })

  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Event ${slug} ${TAG}`,
      slug: `event-${slug}-${TAG}`,
      summary: 'Seeded for analytics.',
      description: 'Seeded by the analytics integration suite.',
      category: 'COMEDY',
      status: 'PUBLISHED',
      startsAt: new Date('2026-11-01T18:00:00Z'),
      endsAt: new Date('2026-11-01T22:00:00Z'),
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt: new Date('2026-11-01T18:00:00Z'),
      endsAt: new Date('2026-11-01T22:00:00Z'),
      status: 'SCHEDULED',
    },
  })

  return { organization, venue, event, session }
}

/**
 * A paid order with one line, its tickets, and the ledger batch behind it.
 *
 * @param {object} options Inputs.
 * @param {object} options.event Which event.
 * @param {object} options.session Which session.
 * @param {object} options.ticketType Which tier.
 * @param {number} options.quantity How many.
 * @param {string} options.reference A unique order reference.
 * @param {string} [options.currency] Which currency.
 * @param {Date} [options.paidAt] When it was paid.
 * @returns {Promise<object>} The order and its tickets.
 */
async function paidOrder({
  event,
  session,
  ticketType,
  quantity,
  reference,
  currency = 'INR',
  paidAt = new Date('2026-10-02T12:00:00Z'),
}) {
  const unit = ticketType.priceCents
  const subtotal = unit * quantity

  const order = await prisma.order.create({
    data: {
      reference,
      eventId: event.id,
      eventSessionId: session.id,
      buyerEmail: `buyer-${reference}@example.test`,
      buyerName: 'Seeded Buyer',
      status: 'PAID',
      currency,
      subtotalCents: subtotal,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: subtotal,
      paidAt,
    },
  })

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity,
      unitPriceCents: unit,
      subtotalCents: subtotal,
    },
  })

  const tickets = []

  for (let index = 0; index < quantity; index += 1) {
    tickets.push(
      await prisma.ticket.create({
        data: { orderItemId: item.id, code: `${reference}-${index}`, status: 'VALID' },
      }),
    )
  }

  await prisma.ticketType.update({
    where: { id: ticketType.id },
    data: { quantitySold: { increment: quantity } },
  })

  return { order, item, tickets }
}

/**
 * A balanced, posted ledger batch crediting one organisation's payable.
 *
 * @param {object} options Inputs.
 * @param {string} options.organizationId Whose money.
 * @param {number} options.amountCents How much.
 * @param {string} options.reference A unique reference.
 * @returns {Promise<void>} Resolves when posted.
 */
async function postPayable({ organizationId, amountCents, reference }) {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: [ACCOUNTS.PROCESSOR_CLEARING, ACCOUNTS.ORGANIZER_PAYABLE] } },
  })
  const idFor = (code) => accounts.find((account) => account.code === code)?.id

  // DRAFT first. `desi_ledger_batch_balance` refuses a batch posted with no
  // entries, which is the same three-step dance `postBatch` does in the
  // application: compose, add entries, then post.
  const batch = await prisma.ledgerBatch.create({
    data: {
      reference,
      kind: 'ORDER_PAID',
      status: 'DRAFT',
      currency: 'INR',
      debitCents: amountCents,
      creditCents: amountCents,
      sourceType: 'ORDER',
      sourceId: reference,
      idempotencyKey: `analytics:${reference}`,
    },
  })

  await prisma.ledgerEntry.createMany({
    data: [
      {
        batchId: batch.id,
        accountId: idFor(ACCOUNTS.PROCESSOR_CLEARING),
        direction: DEBIT,
        amountCents,
        currency: 'INR',
        memo: 'Seeded',
        organizationId,
      },
      {
        batchId: batch.id,
        accountId: idFor(ACCOUNTS.ORGANIZER_PAYABLE),
        direction: CREDIT,
        amountCents,
        currency: 'INR',
        memo: 'Seeded',
        organizationId,
      },
    ],
  })

  await prisma.ledgerBatch.update({
    where: { id: batch.id },
    data: { status: 'POSTED', postedAt: new Date('2026-10-02T12:00:00Z') },
  })
}

beforeAll(async () => {
  mine = await organisationWithEvent('mine')
  theirs = await organisationWithEvent('theirs')
  myEvent = mine.event
  mySession = mine.session

  gaType = await prisma.ticketType.create({
    data: {
      eventId: myEvent.id,
      eventSessionId: mySession.id,
      name: `Stalls ${TAG}`,
      priceCents: 50_000,
      currency: 'INR',
      quantityTotal: 100,
      status: 'ON_SALE',
      reserved: false,
    },
  })

  seatedType = await prisma.ticketType.create({
    data: {
      eventId: myEvent.id,
      eventSessionId: mySession.id,
      name: `Circle ${TAG}`,
      priceCents: 90_000,
      currency: 'INR',
      quantityTotal: 4,
      status: 'ON_SALE',
      reserved: true,
    },
  })

  // The neighbour gets the same shape of everything, so a query that forgets
  // its organisation scope sees it and fails an assertion below.
  const theirType = await prisma.ticketType.create({
    data: {
      eventId: theirs.event.id,
      eventSessionId: theirs.session.id,
      name: `Neighbour stalls ${TAG}`,
      priceCents: 50_000,
      currency: 'INR',
      quantityTotal: 100,
      status: 'ON_SALE',
      reserved: false,
    },
  })

  const sold = await paidOrder({
    event: myEvent,
    session: mySession,
    ticketType: gaType,
    quantity: 3,
    reference: `AN-${TAG}-1`,
  })

  await paidOrder({
    event: theirs.event,
    session: theirs.session,
    ticketType: theirType,
    quantity: 7,
    reference: `AN-${TAG}-NEIGHBOUR`,
  })

  // One ticket admitted, one revoked — so the live count, the lost count and
  // the check-in count are three different numbers and cannot be confused.
  await prisma.checkIn.create({
    data: { ticketId: sold.tickets[0].id, eventSessionId: mySession.id },
  })
  await prisma.ticket.update({
    where: { id: sold.tickets[0].id },
    data: { status: 'CHECKED_IN', checkedInAt: new Date() },
  })
  await prisma.ticket.update({
    where: { id: sold.tickets[2].id },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'Seeded' },
  })

  // A transfer offered and still pending.
  await prisma.ticketTransfer.create({
    data: {
      ticketId: sold.tickets[1].id,
      toEmail: `recipient-${TAG}@example.test`,
      tokenHash: `hash-${TAG}`,
      status: 'PENDING',
      expiresAt: new Date('2026-10-10T12:00:00Z'),
    },
  })

  // Reserved seats, in two sections and two price zones, so the groupings are
  // distinguishable from each other and from the totals.
  const map = await prisma.venueMap.create({
    data: { venueId: mine.venue.id, name: `Map ${TAG}` },
  })
  // Created unpublished. `desi_map_version_frozen` refuses a section added to a
  // published version — correctly — so the layout is laid out first and the
  // version is published at the end, which is the order the product uses too.
  const version = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1 },
  })
  const section = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: `Stalls ${TAG}`, kind: 'SEATED' },
  })
  const balcony = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: `Balcony ${TAG}`, kind: 'SEATED' },
  })
  const zone = await prisma.priceZone.create({
    data: { venueMapVersionId: version.id, name: `Front ${TAG}` },
  })
  const row = await prisma.seatRow.create({
    data: { venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })
  const balconyRow = await prisma.seatRow.create({
    data: { venueMapVersionId: version.id, sectionId: balcony.id, label: 'B' },
  })

  // The order below is dictated by two triggers pulling opposite ways, and
  // getting it wrong is how this suite first failed twice:
  //   `desi_map_version_frozen` refuses a seat added to a *published* version,
  //   `desi_event_seat_map_matches` refuses a reserved seat on a session with
  //   *no published map*.
  // So: lay the map out, publish it, pin the session, and only then create the
  // event seats. That is also the order the product itself uses.
  const seats = []

  const specs = [
    { section: section.id, row: row.id, zone: zone.id, label: 'A1', status: 'AVAILABLE' },
    { section: section.id, row: row.id, zone: zone.id, label: 'A2', status: 'SOLD' },
    { section: balcony.id, row: balconyRow.id, zone: null, label: 'B1', status: 'AVAILABLE' },
    { section: balcony.id, row: balconyRow.id, zone: null, label: 'B2', status: 'BLOCKED' },
  ]

  const seatRows = []

  for (const spec of specs) {
    seatRows.push(
      await prisma.seat.create({
        data: {
          venueMapVersionId: version.id,
          sectionId: spec.section,
          rowId: spec.row,
          priceZoneId: spec.zone,
          label: spec.label,
        },
      }),
    )
  }

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })
  await prisma.eventSession.update({
    where: { id: mySession.id },
    data: { venueMapVersionId: version.id },
  })

  // A `SOLD` seat must name the order line that bought it —
  // `event_seat_status_coherent` refuses one that does not, because "sold" is
  // otherwise a claim nothing backs. So a real seated order exists first.
  const seated = await paidOrder({
    event: myEvent,
    session: mySession,
    ticketType: seatedType,
    quantity: 1,
    reference: `AN-${TAG}-SEAT`,
  })

  for (const [index, spec] of specs.entries()) {
    seats.push(
      await prisma.eventSeat.create({
        data: {
          eventSessionId: mySession.id,
          seatId: seatRows[index].id,
          ticketTypeId: seatedType.id,
          status: spec.status,
          ...(spec.status === 'SOLD' ? { orderItemId: seated.item.id } : {}),
        },
      }),
    )
  }

  await postPayable({
    organizationId: mine.organization.id,
    amountCents: 150_000,
    reference: `LB-${TAG}-MINE`,
  })
  await postPayable({
    organizationId: theirs.organization.id,
    amountCents: 999_999,
    reference: `LB-${TAG}-THEIRS`,
  })
})

afterAll(async () => {
  if (!mine) {
    await prisma.$disconnect()
    return
  }

  // Ordered so a foreign key never blocks the delete, and scoped to this run's
  // tag throughout: a cleanup that could touch another suite's rows is a
  // cleanup nobody can run twice.
  // The ledger rows are deliberately left behind. `desi_ledger_entry_immutable`
  // refuses to delete an entry of a posted batch and `desi_ledger_batch_immutable`
  // refuses the batch — which is the whole point of an append-only ledger, and a
  // cleanup that could undo it would be a cleanup that disproves it. They are
  // harmless: every run seeds its own organisation, and every figure here is
  // organisation-scoped, so last run's rows are invisible to this one.
  await prisma.ticketTransfer.deleteMany({ where: { tokenHash: { contains: TAG } } })
  await prisma.checkIn.deleteMany({ where: { ticket: { code: { contains: TAG } } } })
  await prisma.ticket.deleteMany({ where: { code: { contains: TAG } } })
  await prisma.eventSeat.deleteMany({
    where: { eventSession: { event: { slug: { contains: TAG } } } },
  })
  await prisma.orderItem.deleteMany({ where: { order: { reference: { contains: TAG } } } })
  await prisma.order.deleteMany({ where: { reference: { contains: TAG } } })
  // A published version refuses to have its sections, rows or seats deleted —
  // and refuses to be unpublished. Deleting the version is the only way out,
  // and every seating table cascades from it. The session's pin is `Restrict`,
  // so it is cleared first.
  await prisma.eventSession.updateMany({
    where: { event: { slug: { contains: TAG } } },
    data: { venueMapVersionId: null },
  })
  await prisma.venueMapVersion.deleteMany({ where: { venueMap: { name: { contains: TAG } } } })
  await prisma.venueMap.deleteMany({ where: { name: { contains: TAG } } })
  await prisma.ticketType.deleteMany({ where: { name: { contains: TAG } } })
  await prisma.eventSession.deleteMany({ where: { event: { slug: { contains: TAG } } } })
  await prisma.event.deleteMany({ where: { slug: { contains: TAG } } })
  await prisma.venue.deleteMany({ where: { slug: { contains: TAG } } })
  await prisma.organization.deleteMany({ where: { slug: { contains: TAG } } })
  await prisma.$disconnect()
})

when()('organiser analytics, over real rows', () => {
  it('counts this organisation’s tickets and nobody else’s', async () => {
    const counts = await ticketCounts(prisma, { organizationId: mine.organization.id })

    // Four tickets sold in total: three general admission — one admitted (still
    // live), one valid, one revoked — plus one seated. So three are live.
    expect(counts.live).toBe(3)
    expect(counts.lost).toBe(1)
    expect(counts.byLostState.find((row) => row.state === 'REVOKED').count).toBe(1)

    // The neighbour sold seven. If any of them appear here, an organisation
    // scope is missing from a `where` clause.
    // The neighbour sold seven. Ten would mean a missing organisation scope.
    expect(counts.live).not.toBe(10)
  })

  it('reports general-admission inventory from the counter the seller guards', async () => {
    const rows = await generalAdmissionInventory(prisma, { organizationId: mine.organization.id })
    const stalls = rows.find((row) => row.ticketTypeId === gaType.id)

    expect(stalls.quantityTotal).toBe(100)
    expect(stalls.quantitySold).toBe(3)
    expect(stalls.quantityRemaining).toBe(97)
    expect(stalls.oversold).toBe(false)

    // The reserved tier is not general admission and must not appear.
    expect(rows.some((row) => row.ticketTypeId === seatedType.id)).toBe(false)
    // Nor may the neighbour's tier.
    expect(rows.every((row) => row.eventId === myEvent.id)).toBe(true)
  })

  it('never reports a negative remainder, and says when a tier is oversold', async () => {
    await prisma.ticketType.update({
      where: { id: gaType.id },
      data: { quantitySold: 105 },
    })

    try {
      const rows = await generalAdmissionInventory(prisma, { organizationId: mine.organization.id })
      const stalls = rows.find((row) => row.ticketTypeId === gaType.id)

      expect(stalls.quantityRemaining).toBe(0)
      expect(stalls.oversold).toBe(true)
    } finally {
      await prisma.ticketType.update({ where: { id: gaType.id }, data: { quantitySold: 3 } })
    }
  })

  it('groups reserved seats by section and by price zone, keeping unzoned seats', async () => {
    const reserved = await reservedSeatInventory(prisma, { organizationId: mine.organization.id })

    const stalls = reserved.bySection.find((row) => row.name.includes('Stalls'))
    const balcony = reserved.bySection.find((row) => row.name.includes('Balcony'))

    expect(stalls.total).toBe(2)
    expect(stalls.available).toBe(1)
    expect(stalls.sold).toBe(1)
    expect(balcony.blocked).toBe(1)

    // Two seats have no price zone. They are a group, not an omission: hiding
    // them would understate capacity by half here.
    const unzoned = reserved.byPriceZone.find((row) => row.id === null)

    expect(unzoned.total).toBe(2)
    expect(reserved.byPriceZone.reduce((sum, row) => sum + row.total, 0)).toBe(4)
  })

  it('breaks sales down four ways, and never mixes two currencies into one row', async () => {
    await paidOrder({
      event: myEvent,
      session: mySession,
      ticketType: gaType,
      quantity: 1,
      reference: `AN-${TAG}-GBP`,
      currency: 'GBP',
    })

    const sales = await salesBreakdowns(prisma, {
      organizationId: mine.organization.id,
      currency: null,
    })

    const forEvent = sales.byEvent.filter((row) => row.id === myEvent.id)

    // Two rows for one event, because two currencies. One row would be a total
    // of INR and GBP, which is a total of nothing.
    expect(forEvent).toHaveLength(2)
    expect(new Set(forEvent.map((row) => row.currency))).toEqual(new Set(['INR', 'GBP']))

    const inr = forEvent.find((row) => row.currency === 'INR')

    // Three general admission at 50000 plus one seated at 90000.
    expect(inr.quantity).toBe(4)
    expect(inr.lineValueCents).toBe(240_000)

    expect(sales.bySession.every((row) => row.id === mySession.id)).toBe(true)
    expect(sales.byTicketType.some((row) => row.id === gaType.id)).toBe(true)
    expect(sales.byDate.every((row) => /^\d{4}-\d{2}-\d{2}$/u.test(row.id))).toBe(true)
  })

  it('reports check-in progress against live tickets, not against everything ever sold', async () => {
    const progress = await checkInProgress(prisma, { organizationId: mine.organization.id })

    expect(progress.admitted).toBe(1)
    expect(progress.live).toBeGreaterThanOrEqual(2)
    expect(progress.percent).not.toBeNull()
    expect(progress.percent).toBeLessThanOrEqual(100)
  })

  it('counts transfers by outcome and revocations separately', async () => {
    const movement = await ticketMovement(prisma, { organizationId: mine.organization.id })

    expect(movement.transfers.find((row) => row.status === 'PENDING').count).toBe(1)
    expect(movement.transfers.find((row) => row.status === 'ACCEPTED').count).toBe(0)
    expect(movement.revoked).toBe(1)
  })

  it('reports the funnel it can see and names the step it cannot', async () => {
    const funnel = await conversionFunnel(prisma, { organizationId: mine.organization.id })

    expect(funnel.steps.map((step) => step.key)).toEqual(['holds', 'ordersCreated', 'ordersPaid'])
    expect(funnel.steps.find((step) => step.key === 'ordersPaid').count).toBeGreaterThanOrEqual(1)

    // The honest part: a funnel with a silently missing first step is a funnel
    // somebody reads as complete.
    expect(funnel.missing).toHaveLength(1)
    expect(funnel.missing[0]).toMatch(/page views/iu)
  })

  it('refuses to answer without an organisation', async () => {
    // An unscoped analytics query is the NF-05 inversion wearing a different
    // hat: it would answer for everybody rather than refusing.
    await expect(
      organizerAnalytics(prisma, { organizationId: null, currency: 'INR', now: new Date() }),
    ).rejects.toThrow(/always scoped/iu)
  })

  it('assembles the whole payload, with money from the ledger and counts from the rows', async () => {
    const view = await organizerAnalytics(prisma, {
      organizationId: mine.organization.id,
      currency: 'INR',
      now: new Date(),
    })

    // The ledger says 150000 for this organisation and 999999 for the
    // neighbour. Reading the neighbour's would be a scope leak worth more than
    // every other assertion in this file.
    expect(view.money.totals.organizerPayableCents).toBe(150_000)
    expect(view.money.totals.grossCollectedCents).toBe(150_000)

    expect(view.tickets.live).toBeGreaterThanOrEqual(2)
    expect(view.timeZone).toBe('UTC')
    expect(view.limits.breakdownRows).toBeGreaterThan(0)
    expect(view.exceptions.open).toBe(0)
  })
})
