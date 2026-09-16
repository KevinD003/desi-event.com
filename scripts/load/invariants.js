/**
 * What has to be true after a load run, whatever the latency was.
 *
 * These are the reason the suite exists. A load test that only measured
 * response times would pass a build that oversells under contention, settles an
 * order twice, or admits one ticket at two doors — and those are exactly the
 * failures that only appear under contention, which is to say only here.
 *
 * Every check is a query against the database the run just used. None of them
 * asks the application whether it behaved; they ask the rows.
 *
 * A broken invariant fails the run outright. It is not one signal among five —
 * see `judge` in `./metrics.js` — because a run reported as "four of five
 * checks passed" is a run somebody will read the four of.
 *
 * @module scripts/load/invariants
 */

/**
 * Run every invariant against what the database now holds.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} [scope] What to check.
 * @param {string} [scope.eventId] Restrict inventory checks to one event.
 * @returns {Promise<Array<{name: string, ok: boolean, detail: string}>>} One entry per check.
 */
export async function checkInvariants(prisma, scope = {}) {
  const checks = []

  checks.push(await noOverselling(prisma, scope))
  checks.push(await noDoubleSoldSeat(prisma))
  checks.push(await noDuplicateSettlement(prisma))
  checks.push(await noDuplicateLedgerPosting(prisma))
  checks.push(await noDuplicateCheckIn(prisma))
  checks.push(await noOverRefund(prisma))
  checks.push(await everyBatchBalances(prisma))

  return checks
}

/**
 * More tickets sold than exist.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} scope What to check.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noOverselling(prisma, scope) {
  const where = scope.eventId ? { eventId: scope.eventId } : {}
  const types = await prisma.ticketType.findMany({ where })
  const offenders = []

  for (const type of types) {
    const sold = await prisma.orderItem.aggregate({
      where: { ticketTypeId: type.id, order: { status: { in: ['PAID', 'REFUNDED'] } } },
      _sum: { quantity: true },
    })

    const total = sold._sum.quantity ?? 0

    if (total > type.quantityTotal) {
      offenders.push(`${type.id}: ${total} sold against ${type.quantityTotal} available`)
    }
  }

  return {
    name: 'no overselling',
    ok: offenders.length === 0,
    detail: offenders.length === 0 ? 'every tier sold within its own total' : offenders.join('; '),
  }
}

/**
 * One seat, two orders.
 *
 * The `EventSeat.orderItemId` column is what a seated sale writes, and a seat
 * carrying an order line while another line also claims it would be two people
 * in one chair.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noDoubleSoldSeat(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "eventSeatId", count(*)::int AS count
     FROM "Ticket"
     WHERE "eventSeatId" IS NOT NULL AND "status" IN ('VALID', 'TRANSFER_PENDING', 'CHECKED_IN')
     GROUP BY "eventSeatId" HAVING count(*) > 1`,
  )

  return {
    name: 'no seat sold twice',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'every live ticket holds a distinct seat'
        : `${rows.length} seat(s) carry more than one live ticket`,
  }
}

/**
 * One order, two sets of tickets.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noDuplicateSettlement(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT oi."id", oi."quantity", count(t."id")::int AS issued
     FROM "OrderItem" oi
     JOIN "Order" o ON o."id" = oi."orderId"
     LEFT JOIN "Ticket" t ON t."orderItemId" = oi."id"
     WHERE o."status" IN ('PAID', 'REFUNDED')
     GROUP BY oi."id", oi."quantity"
     HAVING count(t."id") > oi."quantity"`,
  )

  return {
    name: 'no duplicate settlement',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'no order line holds more tickets than it bought'
        : `${rows.length} line(s) hold more tickets than they bought`,
  }
}

/**
 * One event, two ledger batches.
 *
 * The idempotency key is unique, so this should be impossible — which is why it
 * is worth asking. A duplicate here would mean the key stopped being derived
 * from the source event.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noDuplicateLedgerPosting(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "kind", "sourceType", "sourceId", count(*)::int AS count
     FROM "LedgerBatch"
     WHERE "status" = 'POSTED' AND "compensatesBatchId" IS NULL
     GROUP BY "kind", "sourceType", "sourceId", "idempotencyKey"
     HAVING count(*) > 1`,
  )

  return {
    name: 'no duplicate ledger posting',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'every source event posted at most one batch of each kind'
        : `${rows.length} source event(s) posted more than one batch`,
  }
}

/**
 * One ticket, two admissions.
 *
 * `CheckIn.ticketId` is unique, so this asks whether that index is still there
 * as much as it asks about the application.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noDuplicateCheckIn(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "ticketId", count(*)::int AS count
     FROM "CheckIn" GROUP BY "ticketId" HAVING count(*) > 1`,
  )

  return {
    name: 'no duplicate check-in',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'every ticket was admitted at most once'
        : `${rows.length} admitted twice`,
  }
}

/**
 * More refunded than was ever paid.
 *
 * A CHECK constraint refuses this, so a failure here means the constraint was
 * dropped or bypassed — worth knowing either way.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noOverRefund(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "reference", "totalCents", "refundedCents", "refundPendingCents"
     FROM "Order"
     WHERE "refundedCents" + "refundPendingCents" > "totalCents"`,
  )

  return {
    name: 'no over-refund',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'no order owes back more than it took'
        : rows
            .map(
              (row) =>
                `${row.reference}: ${row.refundedCents}+${row.refundPendingCents} > ${row.totalCents}`,
            )
            .join('; '),
  }
}

/**
 * A posted batch whose two sides disagree.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function everyBatchBalances(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "reference", "debitCents", "creditCents"
     FROM "LedgerBatch" WHERE "status" = 'POSTED' AND "debitCents" <> "creditCents"`,
  )

  return {
    name: 'every posted batch balances',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'debits equal credits on every posted batch'
        : rows.map((row) => `${row.reference}: ${row.debitCents} vs ${row.creditCents}`).join('; '),
  }
}
