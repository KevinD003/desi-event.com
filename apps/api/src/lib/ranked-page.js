/**
 * A page of a queue with the work that still needs somebody first.
 *
 * The refund, reconciliation and notification queues each said "unresolved
 * first" (or "trouble first") and each ordered by `status: 'asc'`. On
 * PostgreSQL that sorts an enum by its declaration order, not by its name, and
 * the declaration order of all three puts settled states among or ahead of the
 * open ones: a refund `TIMEOUT` sorted after `SUCCEEDED`, a reconciliation item
 * that was `ESCALATED` after every `RESOLVED` one, and a `DEAD_LETTER` after
 * every message that was sent. On a busy queue the items the page exists for
 * were on its last pages. The in-memory test stub sorts enum values as strings,
 * which is why no test noticed.
 *
 * Prisma cannot order by an expression, so the rank is applied as two reads:
 * the rows in the first tier, then the rest, with the page's window laid across
 * the two. Each read is an ordinary indexed `findMany`, pagination stays exact,
 * and nothing depends on how an enum happens to be declared.
 *
 * The two reads are not one snapshot. A row that changes tier between them can
 * appear on two adjacent pages or on neither, which is the same guarantee the
 * separate `count` beside every list already gives, and a queue view is re-read
 * rather than trusted.
 *
 * @module @desi-event/api/lib/ranked-page
 */

/**
 * @typedef {object} RankedPageOptions
 * @property {object} where The list's filter.
 * @property {string} field The status column the tiers are drawn on.
 * @property {ReadonlyArray<string>} first The values that make up the first tier.
 * @property {Array<object>} orderBy The order within each tier.
 * @property {number} skip Rows before this page, across both tiers.
 * @property {number} take Rows on this page.
 * @property {object} [include] Relations to load, passed through.
 */

/**
 * Read one page, the first tier before everything else.
 *
 * @param {object} delegate A Prisma model delegate, such as `prisma.refund`.
 * @param {RankedPageOptions} options What to read.
 * @returns {Promise<object[]>} The page's rows, in rank order.
 */
export async function readRankedPage(delegate, options) {
  const { where, field, first, orderBy, skip, take, include } = options
  const values = [...first]

  const firstTier = { AND: [where, { [field]: { in: values } }] }
  const rest = { AND: [where, { [field]: { notIn: values } }] }
  const extra = include ? { include } : {}

  const inFirst = await delegate.count({ where: firstTier })
  const rows = []

  if (skip < inFirst) {
    rows.push(...(await delegate.findMany({ where: firstTier, orderBy, skip, take, ...extra })))
  }

  const remaining = take - rows.length

  if (remaining > 0) {
    rows.push(
      ...(await delegate.findMany({
        where: rest,
        orderBy,
        skip: Math.max(0, skip - inFirst),
        take: remaining,
        ...extra,
      })),
    )
  }

  return rows
}
