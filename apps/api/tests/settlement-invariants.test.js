/**
 * The reliability suite's settlement invariants, against rows it would meet.
 *
 * ## Why these exist
 *
 * `noDuplicateSettlement` failed the Phase 2 exact-SHA CI run. It counted
 * ticket **rows** against `OrderItem.quantity`, which was true before transfers
 * existed and false afterwards: `acceptTransfer` mints the successor onto the
 * buyer's own order item so the lineage stays unbroken, so a line for one
 * ticket handed on legitimately holds two rows.
 *
 * Correcting it to count terminal members is not self-evidently the right
 * safety property, and a query that merely makes the current fixture pass is
 * worth nothing. These cases are the argument that it is right: each is a shape
 * the corrected check has to accept or reject, and three of them were holes in
 * the first correction rather than hypotheticals.
 *
 * ## The property under test
 *
 * For each purchased order line, the number of independent current ticket
 * chains — and so the greatest number of tickets that could carry current
 * admission authority — must not exceed the quantity bought.
 *
 * ## Vocabulary
 *
 * Chain root, predecessor, successor, terminal member — defined at the top of
 * `scripts/load/invariants.js` and used here exactly as defined. A terminal
 * member is deliberately not called a chain head.
 *
 * ## Why real PostgreSQL
 *
 * Three cases turn on relational behaviour a stub cannot have: the unique index
 * that makes branching impossible, the foreign key that makes an orphan
 * impossible, and a cycle, which is insertable precisely because neither of
 * those forbids it.
 *
 * ## Why the checks run database-wide here, and what is scoped
 *
 * The settlement checks are asked of the whole database, because that is the
 * production safety question and because scoping them to this suite's own rows
 * would have hidden the very regression that failed CI. Only `noOverselling`
 * is given a scope, and only because it walks every ticket type in the
 * catalogue one aggregate at a time — 25 seconds against this database, against
 * 130 ms for the settlement check. Scoping it keeps it running without making
 * every case in this file wait for a question no case here is asking.
 *
 * @module @desi-event/api/tests/settlement-invariants
 */

import { afterAll, afterEach, expect, it } from 'vitest'

import { checkInvariants } from '../../../scripts/load/invariants.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the settlement invariant suite')

/** A stem unique to this run, so two runs and two workers cannot collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** What every row this suite creates is named, so teardown can find them all. */
const PREFIX = `inv${RUN}`.replace(/[^a-z0-9]/gu, '')

let sequence = 0

/**
 * A unique identifier for this run, shaped like one Prisma would generate.
 *
 * The counter goes at the end at a fixed width on purpose. Padding a variable
 * stem out to 25 characters with zeroes made `…event1` and `…event10` the same
 * string, which is a duplicate-key failure two hundred rows into the run and
 * reads like anything but an identifier bug.
 *
 * @param {string} kind What it names.
 * @returns {string} A 25-character identifier.
 */
function id(kind) {
  sequence += 1

  const stem = `${PREFIX}${kind}`.replace(/[^a-z0-9]/gu, '')

  return `${stem.padEnd(21, 'x').slice(0, 21)}${String(sequence).padStart(4, '0')}`
}

/**
 * A paid order line with `quantity` sold and no tickets yet.
 *
 * @param {number} quantity How many were bought.
 * @returns {Promise<{order: object, orderItem: object, eventId: string}>} The line.
 */
async function paidLine(quantity) {
  const nonce = sequence + 1

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Settlement ${nonce}`,
      slug: `${PREFIX}-org-${nonce}`,
      contactEmail: `${PREFIX}-${nonce}@desi-event.example`,
    },
  })

  const startsAt = new Date(Date.now() + 86_400_000)

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      title: `Settlement night ${nonce}`,
      slug: `${PREFIX}-event-${nonce}`,
      category: 'MUSIC_CONCERT',
      summary: 'One purchased line, and what may hang from it.',
      description: 'Built by the settlement invariant suite.',
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
      quantityTotal: Math.max(quantity, 1),
      status: 'ON_SALE',
    },
  })

  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-${PREFIX}-${nonce}`.toUpperCase().slice(0, 30),
      eventId: event.id,
      buyerEmail: `${PREFIX}-${nonce}@desi-event.example`,
      buyerName: 'The Buyer',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100_000 * quantity,
      totalCents: 100_000 * quantity,
      paidAt: new Date(),
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity,
      unitPriceCents: 100_000,
      subtotalCents: 100_000 * quantity,
    },
  })

  return { order, orderItem, eventId: event.id, ticketTypeId: ticketType.id }
}

/**
 * One ticket on a line.
 *
 * @param {string} orderItemId Which line.
 * @param {object} [options] Options.
 * @param {string|null} [options.supersedes] The predecessor this replaces.
 * @param {boolean} [options.live] Whether it carries a usable credential.
 * @param {string} [options.status] Its state.
 * @param {string|null} [options.eventSeatId] The reserved seat it admits to.
 * @returns {Promise<object>} The ticket.
 */
async function ticket(
  orderItemId,
  { supersedes = null, live = true, status = 'VALID', eventSeatId = null } = {},
) {
  const nonce = sequence + 1

  return prisma.ticket.create({
    data: {
      id: id('tkt'),
      orderItemId,
      code: `DE-${PREFIX}-${nonce}`.toUpperCase().slice(0, 30),
      status,
      supersedesTicketId: supersedes,
      eventSeatId,
      // Unique per row, because `Ticket.credentialHash` is unique: two tickets
      // cannot share one credential, which is exactly why case 12 has to hold
      // two *different* live credentials to be the hazard it is.
      credentialHash: live ? `${nonce}`.padStart(64, 'a') : null,
      credentialVersion: 1,
      credentialIssuedAt: live ? new Date() : null,
    },
  })
}

/**
 * One numbered seat, on a session of the event a line was bought against.
 *
 * The chain from venue to event seat is long and none of it is optional: a
 * `Ticket.eventSeatId` is a foreign key to `EventSeat`, which needs a session
 * and a seat, which needs a row, a section and a published map version. Case
 * 14 is about what the schema does with that column, so a stubbed seat would
 * answer the wrong question.
 *
 * @param {string} eventId The event to hang a session from.
 * @param {string} ticketTypeId The tier the seat is sold at.
 * @param {string} orderItemId The line it was sold on.
 * @returns {Promise<object>} The event seat.
 */
async function reservedSeat(eventId, ticketTypeId, orderItemId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } })

  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: event.organizationId,
      name: 'Settlement Hall',
      slug: `${PREFIX}-venue-${sequence}`,
      addressLine1: '1 Test Road',
      city: 'Chennai',
      region: 'TN',
      postalCode: '600001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })

  const map = await prisma.venueMap.create({
    data: { id: id('map'), venueId: venue.id, name: 'Settlement Hall plan' },
  })

  const version = await prisma.venueMapVersion.create({
    data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: 1 },
  })

  const section = await prisma.section.create({
    data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })

  const row = await prisma.seatRow.create({
    data: { id: id('row'), venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })

  const seat = await prisma.seat.create({
    data: {
      id: id('seat'),
      venueMapVersionId: version.id,
      sectionId: section.id,
      rowId: row.id,
      label: 'A1',
      sortOrder: 1,
    },
  })

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: 'Asia/Kolkata',
      venueMapVersionId: version.id,
    },
  })

  // `event_seat_status_coherent` requires a SOLD seat to name the line it was
  // sold on. A seat sold to nobody is not a state the table allows, which is
  // the right constraint and worth meeting rather than working around.
  return prisma.eventSeat.create({
    data: {
      id: id('eventseat'),
      eventSessionId: session.id,
      seatId: seat.id,
      ticketTypeId,
      orderItemId,
      status: 'SOLD',
    },
  })
}

/**
 * Run every invariant and return them by name.
 *
 * The whole set, not the one function under discussion: a correction that
 * silenced one check by breaking another would pass a narrower test.
 *
 * @param {string} eventId Which event `noOverselling` should walk.
 * @returns {Promise<Map<string, {name: string, ok: boolean, detail: string}>>} The results.
 */
async function checkAll(eventId) {
  const results = await checkInvariants(prisma, { eventId })

  expect(results, 'the invariant set changed shape').toHaveLength(9)

  return new Map(results.map((result) => [result.name, result]))
}

/**
 * Undo what the invariants read, whether or not a case got that far.
 *
 * Teardown at all is unusual here — the sibling real-database suites leave
 * their rows, because the test database is disposable — and it is not optional
 * for this one. These checks ask the whole database, the rejection cases plant
 * violations on purpose, and CI runs the same checks again in the reliability
 * step *after* the suite. A planted row left behind would fail that step, on a
 * defect that does not exist.
 *
 * What is not removed is case 14's seat layout: a published map version is
 * frozen by `desi_seat_frozen_and_coherent` and cannot be unpublished by
 * `desi_map_version_publish_once`, so its seats, rows, sections and venue
 * cannot be deleted — deliberately, because people have bought against that
 * plan. No invariant reads any of it. What is removed is everything they do
 * read.
 */
async function teardown() {
  const like = `${PREFIX}%`

  await prisma.$executeRaw`UPDATE "Ticket" SET "supersedesTicketId" = NULL WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "Ticket" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "EventSeat" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "EventSession" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "OrderItem" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "Order" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "TicketType" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "Event" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "Venue" WHERE "id" LIKE ${like}`
  await prisma.$executeRaw`DELETE FROM "Organization" WHERE "id" LIKE ${like}`
}

// Per case, not per file. Each case below asks a question of the whole
// database, so a case that leaves a planted violation behind would answer the
// next case's question for it — and the rejection cases plant violations on
// purpose.
afterEach(teardown)

afterAll(async () => {
  await teardown()
  await prisma.$disconnect().catch(() => {})
})

when()('a lineage the services can actually produce', () => {
  it('1 — one bought, never transferred, passes', async () => {
    const { orderItem, eventId } = await paidLine(1)

    await ticket(orderItem.id)

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
    expect(checks.get('no cross-lineage supersession').ok).toBe(true)
  })

  it('2 — one bought, transferred once, passes', async () => {
    // Two rows, one terminal member. The row-counting form failed exactly here,
    // which is what broke the Phase 2 exact-SHA run.
    const { orderItem, eventId } = await paidLine(1)
    const root = await ticket(orderItem.id, { live: false, status: 'TRANSFERRED' })

    await ticket(orderItem.id, { supersedes: root.id })

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
  })

  it('3 — one bought, transferred repeatedly, passes', async () => {
    // Four rows, one terminal member. A chain, not a fan-out. Every hop but the
    // last has had its credential invalidated, which is what handing a ticket
    // on does.
    const { orderItem, eventId } = await paidLine(1)

    let previous = await ticket(orderItem.id, { live: false, status: 'TRANSFERRED' })

    for (let hop = 0; hop < 3; hop += 1) {
      previous = await ticket(orderItem.id, {
        supersedes: previous.id,
        live: hop === 2,
        status: hop === 2 ? 'VALID' : 'TRANSFERRED',
      })
    }

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
  })

  it('4 — two bought, each with its own chain, passes', async () => {
    // The case a naive "one terminal member per line" rule would reject, and
    // the reason the check compares against quantity rather than against one.
    const { orderItem, eventId } = await paidLine(2)

    for (let unit = 0; unit < 2; unit += 1) {
      const root = await ticket(orderItem.id, { live: false, status: 'TRANSFERRED' })

      await ticket(orderItem.id, { supersedes: root.id })
    }

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
  })

  it('13 — a refunded lineage keeps its history and no usable pass', async () => {
    // Historical rows must not read as an oversell, and a refunded lineage must
    // retain no way in. Both halves matter: the first was the regression, the
    // second is the property the first correction could have hidden.
    const { orderItem, eventId } = await paidLine(1)
    const root = await ticket(orderItem.id, { live: false, status: 'TRANSFERRED' })

    await ticket(orderItem.id, { supersedes: root.id, live: false, status: 'REFUNDED' })

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
  })
})

when()('shapes the invariants must reject', () => {
  it('5 — two independent tickets against a quantity of one fails', async () => {
    const { orderItem, eventId } = await paidLine(1)

    await ticket(orderItem.id)
    await ticket(orderItem.id)

    const result = (await checkAll(eventId)).get('no duplicate settlement')

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/more current tickets than they sold/u)
    expect(result.detail, 'reported as a surplus, not as a cycle').not.toMatch(/no current member/u)
    expect(result.detail, 'names the line').toContain(orderItem.id)
  })

  it('12 — two usable passes inside one lineage fails', async () => {
    // The shape terminal-counting cannot see. One chain, one terminal member —
    // and two rows a scanner would resolve, because what opens a door is a
    // credential rather than a place in a lineage. This is why the row shape
    // and the admission authority are two checks and not one.
    const { orderItem, eventId } = await paidLine(1)
    const root = await ticket(orderItem.id, { live: true, status: 'TRANSFERRED' })

    await ticket(orderItem.id, { supersedes: root.id, live: true })

    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok, 'the row shape is legitimate').toBe(true)

    const result = checks.get('no surplus admission authority')

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/more usable passes than they sold/u)
    expect(result.detail).toContain(orderItem.id)
  })

  it('8 — a successor on another purchased line fails', async () => {
    // And it must fail *as itself*. Before the successor lookup was scoped to
    // the line, this row marked the other line's ticket historical and removed
    // it from that line's count — a silent pass in the exact shape the check
    // exists to catch.
    const first = await paidLine(1)
    const second = await paidLine(1)

    const reachedAcross = await ticket(first.orderItem.id, { live: false })

    await ticket(second.orderItem.id, { supersedes: reachedAcross.id })
    await ticket(second.orderItem.id)

    const checks = await checkAll(first.eventId)
    const crossing = checks.get('no cross-lineage supersession')

    expect(crossing.ok).toBe(false)
    expect(crossing.detail).toMatch(/bought on a different line/u)

    // And the line reached across still counts its own ticket, so the second
    // line reads as the two current tickets it holds.
    const settlement = checks.get('no duplicate settlement')

    expect(settlement.ok, 'the second line holds two current tickets').toBe(false)
    expect(settlement.detail).toContain(second.orderItem.id)
  })

  it('8b — a reach across another line cannot hide that line’s own over-issue', async () => {
    // The case that isolates *why* the successor lookup is scoped to the line.
    //
    // Case 8 above fails either way: the line reached across drops to no
    // current member at all, so the cycle clause catches it even when the
    // lookup is unscoped. Mutation testing showed that — the unscoped form
    // passed every case in this file, which made case 8 an argument for the
    // scoping that the scoping did not need.
    //
    // Three independent tickets against two sold is an over-issue on any
    // reading. Reaching across from another line marks one of them historical
    // if the lookup is unscoped, leaving two current against two sold: a line
    // that silently passes while holding three ways in. Scoped, the foreign
    // successor is not a successor here, the line reads three, and it fails.
    const line = await paidLine(2)
    const elsewhere = await paidLine(1)

    await ticket(line.orderItem.id)
    await ticket(line.orderItem.id)

    const reachedAcross = await ticket(line.orderItem.id)

    await ticket(elsewhere.orderItem.id, { supersedes: reachedAcross.id, live: false })

    const checks = await checkAll(line.eventId)
    const settlement = checks.get('no duplicate settlement')

    expect(settlement.ok, 'three current tickets against two sold').toBe(false)
    expect(settlement.detail).toMatch(/more current tickets than they sold/u)
    expect(settlement.detail).toContain(`${line.orderItem.id} (3 current, 2 sold)`)
  })

  it('11 — a cycle fails rather than reporting no current member', async () => {
    // Insertable: the unique index stops two successors sharing a predecessor
    // and the foreign key stops a dangling reference, but neither forbids A
    // superseding B while B supersedes A. Every member then has a successor, so
    // a bare terminal count reports zero for the line and passes it.
    const { orderItem, eventId } = await paidLine(1)
    const first = await ticket(orderItem.id, { live: false })
    const second = await ticket(orderItem.id, { supersedes: first.id, live: false })

    await prisma.ticket.update({
      where: { id: first.id },
      data: { supersedesTicketId: second.id },
    })

    const result = (await checkAll(eventId)).get('no duplicate settlement')

    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/no current member/u)
    // And as a cycle rather than as a surplus. One disjunctive sentence naming
    // both failures would have satisfied the line above without the check ever
    // having distinguished them.
    expect(result.detail, 'reported as a cycle, not as a surplus').not.toMatch(
      /more current tickets than they sold/u,
    )
    expect(result.detail, 'names the line').toContain(orderItem.id)
  })
})

when()('what the database guarantees on its own', () => {
  it('6 and 7 — two successors cannot share one predecessor', async () => {
    // `Ticket_supersedesTicketId_key`, a unique index declared in
    // 20260915010000_phase2_commerce_and_operations. Branching a lineage and
    // creating a duplicate successor are the same write, and the database
    // refuses it — so the invariant does not have to look for either. This
    // proves the guarantee rather than assuming it.
    const { orderItem } = await paidLine(2)
    const root = await ticket(orderItem.id, { live: false })

    await ticket(orderItem.id, { supersedes: root.id })

    await expect(ticket(orderItem.id, { supersedes: root.id })).rejects.toThrow(
      /Unique constraint failed on the constraint: `Ticket_supersedesTicketId_key`/u,
    )
  })

  it('10 — a successor cannot name a ticket that does not exist', async () => {
    // `Ticket_supersedesTicketId_fkey`, same migration. An orphaned lineage
    // reference is not a state the invariant has to detect because it is not a
    // state the table permits.
    const { orderItem } = await paidLine(1)

    await expect(
      ticket(orderItem.id, { supersedes: 'ticket-that-was-never-issued' }),
    ).rejects.toThrow(
      /Foreign key constraint violated on the constraint: `Ticket_supersedesTicketId_fkey`/u,
    )
  })

  it('14 — a reserved seat cannot be carried down a lineage at all', async () => {
    // Not a case the settlement invariant passes. A case it never meets.
    //
    // `acceptTransfer` mints the successor with `eventSeatId: ticket.eventSeatId`
    // (apps/api/src/lib/tickets.js) while the predecessor still holds that seat,
    // and nothing on the predecessor clears it — the transition writes only
    // `credentialHash` and `credentialVersion`. `Ticket.eventSeatId` is unique,
    // so that create violates `Ticket_eventSeatId_key` and the whole transfer
    // transaction aborts. This is the defect already recorded as BLOCKED —
    // UNIQUE-SEAT TRANSFER DEFECT, demonstrated here rather than asserted from
    // reading the code.
    //
    // The consequence for the invariant has to be said plainly: **no seated
    // lineage of more than one member can exist in the table**, so every
    // settlement check passing on seated lines says nothing whatever about
    // whether reserved-seat transfer is correct. It is not coverage. A case
    // that built a seated chain by hand and watched the invariant accept it
    // would read as though this worked, which is the one thing case 14 must not
    // do. When the defect is fixed, this case fails, and that is the point:
    // whoever fixes it is told that the invariant now has a shape to check.
    const { orderItem, eventId, ticketTypeId } = await paidLine(1)
    const seat = await reservedSeat(eventId, ticketTypeId, orderItem.id)

    const seated = await ticket(orderItem.id, { eventSeatId: seat.id, live: false })

    await expect(
      ticket(orderItem.id, { supersedes: seated.id, eventSeatId: seat.id }),
    ).rejects.toThrow(/Unique constraint failed on the constraint: `Ticket_eventSeatId_key`/u)

    // And the line is left exactly as a blocked transfer leaves it: the one
    // ticket that was issued, still current, still the only way in.
    const checks = await checkAll(eventId)

    expect(checks.get('no duplicate settlement').ok).toBe(true)
    expect(checks.get('no surplus admission authority').ok).toBe(true)
  })

  it('10b — deleting a predecessor nulls the reference rather than orphaning it', async () => {
    // The same foreign key, `ON DELETE SET NULL`. The successor survives as its
    // own chain root; it does not become a row pointing at nothing.
    const { orderItem } = await paidLine(1)
    const root = await ticket(orderItem.id, { live: false })
    const successor = await ticket(orderItem.id, { supersedes: root.id })

    await prisma.ticket.delete({ where: { id: root.id } })

    const after = await prisma.ticket.findUnique({ where: { id: successor.id } })

    expect(after.supersedesTicketId).toBeNull()
  })
})
