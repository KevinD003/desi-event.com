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
  checks.push(await noCrossLineageSupersession(prisma))
  checks.push(await noSurplusAdmissionAuthority(prisma))
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
 * The vocabulary this file uses for a transfer lineage.
 *
 * Stated once, because the checks below are about relationships between ticket
 * rows and an ambiguous word here becomes a settlement or admission defect
 * later.
 *
 * - **chain root** — the ticket issued by checkout. Its `supersedesTicketId` is
 *   null.
 * - **predecessor** — a ticket that another ticket supersedes.
 * - **successor** — the ticket minted to replace a predecessor. Its
 *   `supersedesTicketId` names that predecessor.
 * - **terminal member** (equivalently **current member**) — a ticket with no
 *   successor. It is the row that represents the lineage now.
 *
 * Deliberately not "head": nothing else in this repository defines that word,
 * and it reads as the *root* to as many people as it reads as the terminal.
 */

/**
 * How many offending rows a failure message names before it stops.
 *
 * @type {number}
 */
const NAMED_IN_DETAIL = 5

/**
 * Name the first few offenders and say how many were not named.
 *
 * A failing invariant that reports only a count is a failure somebody has to
 * reproduce before they can even begin: the Phase 2 exact-SHA run said "31
 * line(s)" and finding out which thirty-one meant querying the database by
 * hand. Naming them costs nothing and is bounded, because a genuinely broken
 * run can offend on every line in the table and a log is not a data export.
 *
 * @param {string[]} described One description per offending row.
 * @returns {string} The list, truncated with a count of the rest.
 */
function nameSome(described) {
  const named = described.slice(0, NAMED_IN_DETAIL).join(', ')
  const rest = described.length - NAMED_IN_DETAIL

  return rest > 0 ? `${named}, and ${rest} more` : named
}

/**
 * More admissions against a purchased line than were bought.
 *
 * ## What the earlier form got wrong, and what it was for
 *
 * This check has always existed to catch duplicate settlement: an order line
 * paid once that somehow issued admission twice. That intention is right and is
 * kept. What it did was count ticket **rows** against `OrderItem.quantity`.
 *
 * That was true before transfers and became false when they shipped.
 * `acceptTransfer` mints the recipient's ticket onto the buyer's order item —
 * same `orderItemId`, new row, `supersedesTicketId` naming the predecessor — so
 * that the lineage from the original purchase stays unbroken and auditable. A
 * line for one ticket handed on once therefore holds two rows, and one handed
 * on and back holds three, all legitimately. Counting rows treated those
 * historical members as independent purchased admissions, which they are not.
 *
 * ## What is counted now
 *
 * Terminal members, and the count is scoped to the line. A successor is only
 * accepted as superseding a predecessor when both sit on the **same order
 * item** — otherwise a row on another line could silently mark this line's
 * ticket as historical and remove it from the count, which is a false pass in
 * exactly the shape this check exists to catch. Cross-line supersession is not
 * quietly tolerated either; {@link noCrossLineageSupersession} fails on it.
 *
 * A paid line holding tickets but **no** terminal member is also a failure.
 * That is unreachable through the services and is reachable in the table: the
 * unique index stops two successors sharing a predecessor, but nothing stops
 * A superseding B while B supersedes A, and a cycle would otherwise report zero
 * current members and pass.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noDuplicateSettlement(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `WITH member AS (
       SELECT t."id",
              t."orderItemId",
              NOT EXISTS (
                SELECT 1 FROM "Ticket" successor
                WHERE successor."supersedesTicketId" = t."id"
                  AND successor."orderItemId" = t."orderItemId"
              ) AS is_terminal
       FROM "Ticket" t
     )
     SELECT oi."id",
            oi."quantity",
            count(m."id")::int AS members,
            count(*) FILTER (WHERE m.is_terminal)::int AS terminal
     FROM "OrderItem" oi
     JOIN "Order" o ON o."id" = oi."orderId"
     LEFT JOIN member m ON m."orderItemId" = oi."id"
     WHERE o."status" IN ('PAID', 'REFUNDED')
     GROUP BY oi."id", oi."quantity"
     HAVING count(*) FILTER (WHERE m.is_terminal) > oi."quantity"
         OR (count(m."id") > 0 AND count(*) FILTER (WHERE m.is_terminal) = 0)`,
  )

  // Two different failures, reported as two different sentences. A single
  // disjunctive message ("too many current tickets, or no current member")
  // names whichever one somebody is looking for whether or not it happened,
  // which is how a test can pass against the wrong defect.
  const surplus = rows.filter((row) => row.terminal > row.quantity)
  const stranded = rows.filter((row) => row.members > 0 && row.terminal === 0)

  const said = [
    surplus.length > 0 &&
      `${surplus.length} line(s) hold more current tickets than they sold: ${nameSome(
        surplus.map((row) => `${row.id} (${row.terminal} current, ${row.quantity} sold)`),
      )}`,
    stranded.length > 0 &&
      `${stranded.length} line(s) hold tickets but no current member, which is a lineage cycle: ${nameSome(
        stranded.map((row) => `${row.id} (${row.members} member(s))`),
      )}`,
  ].filter(Boolean)

  return {
    name: 'no duplicate settlement',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'every purchased line holds at most one current ticket per unit sold'
        : said.join('; '),
  }
}

/**
 * A lineage that crosses from one purchased line to another.
 *
 * A transfer replaces a ticket on the line that bought it. A successor sitting
 * on a different order item — or a different order entirely — would mean one
 * purchase's admission had been moved onto another's, which nothing in the
 * services does and nothing in the schema forbids: `supersedesTicketId` is
 * unique and carries a foreign key, so there can be at most one successor and
 * it cannot dangle, but it may name a ticket anywhere in the table.
 *
 * Checked separately rather than folded into the count above, because the two
 * failures need different answers. A line with too many current tickets is an
 * overselling question; a lineage that crossed lines is a data-integrity one.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noCrossLineageSupersession(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT successor."id" AS successor_id, predecessor."id" AS predecessor_id
     FROM "Ticket" successor
     JOIN "Ticket" predecessor ON predecessor."id" = successor."supersedesTicketId"
     WHERE successor."orderItemId" <> predecessor."orderItemId"`,
  )

  return {
    name: 'no cross-lineage supersession',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'every successor replaces a ticket on its own purchased line'
        : `${rows.length} ticket(s) supersede a ticket bought on a different line: ${nameSome(
            rows.map((row) => `${row.successor_id} -> ${row.predecessor_id}`),
          )}`,
  }
}

/**
 * More ways in than were sold.
 *
 * The property the count of terminal members approximates and does not
 * actually measure. What opens a door is a credential: the admission service
 * resolves a presented pass by `credentialHash`, so a row holding a digest is a
 * row somebody can be admitted on, whatever its place in a lineage.
 *
 * Every path that ends a ticket's life clears that digest — `acceptTransfer` on
 * the predecessor, `revokeTicket`, and the refund service — so a healthy
 * lineage of any length holds exactly one. Two live digests inside one lineage
 * is two admissions for one purchase, and the terminal count would report one
 * and pass.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{name: string, ok: boolean, detail: string}>} The result.
 */
async function noSurplusAdmissionAuthority(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT oi."id", oi."quantity", count(t."id")::int AS live
     FROM "OrderItem" oi
     JOIN "Order" o ON o."id" = oi."orderId"
     LEFT JOIN "Ticket" t
       ON t."orderItemId" = oi."id"
      AND t."credentialHash" IS NOT NULL
     WHERE o."status" IN ('PAID', 'REFUNDED')
     GROUP BY oi."id", oi."quantity"
     HAVING count(t."id") > oi."quantity"`,
  )

  return {
    name: 'no surplus admission authority',
    ok: rows.length === 0,
    detail:
      rows.length === 0
        ? 'no purchased line carries more usable passes than it sold'
        : `${rows.length} line(s) carry more usable passes than they sold: ${nameSome(
            rows.map((row) => `${row.id} (${row.live} usable, ${row.quantity} sold)`),
          )}`,
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
