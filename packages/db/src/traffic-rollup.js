/**
 * The traffic roll-up: add raw visit rows up into daily totals, and delete the
 * raw rows once they are added up and two days old.
 *
 * One implementation, used by the worker's `roll-up-traffic` job, the browser
 * suites' support code and the database verifiers. It imports no other
 * workspace package, so any of them can load it without pulling in the API.
 *
 * ## Why this deletes, when the retention rehearsal cannot
 *
 * The retention machinery is built so that it cannot delete anything: its
 * durations are proposals awaiting legal review. The raw visit rows are a
 * different thing. They hold an event, a kind, a place, a category, a UTC day
 * and a keyed digest whose key (the day's salt) is itself deleted when the day
 * ends — no address, browser string, URL or account. Once a day's rows are added
 * up the daily totals are the record, and deleting the raw rows is data
 * minimisation, not a retention decision about personal data. This is the one
 * deletion on a timer in the repository.
 *
 * ## Two clocks
 *
 * `now` is the **business instant**: which day is today, which days may be
 * purged, and `computedAt`. A test may inject a past `now` to prove a purge.
 * `clock` is the **lease clock** and is always read fresh: the lease is claimed,
 * re-checked and renewed against `clock()`, never against `now`, so an injected
 * instant can never make a live lease look expired or an expired one live.
 *
 * ## One run
 *
 * 1. Claim the singleton lease (`TrafficRollupState`), or return unclaimed.
 * 2. For each UTC day that still has raw rows, oldest first, one transaction:
 *    re-check and renew the lease under its row lock (count 0 means another
 *    worker took it: stop, `LEASE_LOST`); recompute that day's `TrafficDaily`
 *    rows from all of the day's raw rows (values set, never added to, which is
 *    what makes a run idempotent); and, for a day two or more days old, delete
 *    the first `PURGE_BATCH_ROWS` of the day's raw rows in the same
 *    transaction. A day with more raw rows than that is purged by further
 *    transactions of one batch each, every one re-checking and renewing the
 *    lease first.
 * 3. Delete the salts of days before today.
 * 4. Release the lease, recording `lastCompletedAt` when the run finished.
 *
 * A day with no raw rows is never touched, so a purged day's totals can never
 * be recomputed to zero.
 *
 * ## A busy day
 *
 * Every transaction is given a limit of half the lease (never less than
 * Prisma's own five seconds): a busy day's sums can take longer than Prisma's
 * default, and a day rolled back on every run would hold up every day after it.
 * Half the lease leaves the next renewal room to find the lease still live.
 *
 * Totals computed two or more days after their day are **final**: every raw row
 * of that day had been written by then, so they count all of them. The upsert
 * never overwrites final totals (except demonstration figures). That is what
 * makes a purge cut short safe: if a run stops between batches, the next run
 * finds the day's remaining raw rows, leaves its final totals as they are, and
 * deletes the rest — it never recomputes the totals from a part of the day.
 *
 * A day that fails is logged (its date and the error code) and the run carries
 * on with the later days; it then gives the lease back without recording a
 * completion, so the pages say the figures are stale, and rethrows the first
 * failure so the queue records it. A lost lease still stops the run at once.
 *
 * Logs carry counts, dates and error codes only.
 *
 * @module @desi-event/db/traffic-rollup
 */

/** The one state row's id; the migration inserts it, and a CHECK refuses another. */
export const ROLLUP_STATE_ID = 'traffic-rollup'

/** Raw rows of day D are deleted once D is this many days before today, or more. */
export const RAW_KEEP_DAYS = 2

/** How long a claimed lease lasts before another worker may take it over. */
export const DEFAULT_LEASE_MS = 300_000

/** Raw rows deleted by one purge statement; a busy day is purged in batches of this. */
export const PURGE_BATCH_ROWS = 50_000

/** Prisma's default interactive-transaction limit: the least a step is given. */
const PRISMA_DEFAULT_TIMEOUT_MS = 5_000

/** How long a step may wait for a connection from the pool. */
const TRANSACTION_MAX_WAIT_MS = 10_000

const DAY_MS = 86_400_000

/**
 * A UTC calendar day.
 *
 * @param {Date} date An instant.
 * @returns {string} `YYYY-MM-DD`.
 */
export function utcDay(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * The instant a UTC day starts, as the `@db.Date` columns take it.
 *
 * @param {string} day `YYYY-MM-DD`.
 * @returns {Date} Midnight UTC.
 */
export function dayDate(day) {
  return new Date(`${day}T00:00:00.000Z`)
}

/**
 * Check the lease length a caller asked for.
 *
 * @param {unknown} leaseMs Milliseconds.
 * @returns {number} The same number.
 * @throws {TypeError} When it is not a positive whole number.
 */
function assertLeaseMs(leaseMs) {
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError('The traffic roll-up lease must be a positive number of milliseconds.')
  }

  return leaseMs
}

/**
 * The limits every transaction of a run is given.
 *
 * Half the lease, and never less than Prisma's own five seconds: long enough
 * for a busy day's sums, short enough that the lease renewed at a step's start
 * is still live when the next step renews it.
 *
 * @param {number} leaseMs The run's lease length.
 * @returns {{maxWait: number, timeout: number}} Prisma `$transaction` options.
 * @throws {TypeError} When `leaseMs` is not a positive whole number.
 */
export function rollupTransactionOptions(leaseMs) {
  return {
    maxWait: TRANSACTION_MAX_WAIT_MS,
    timeout: Math.max(PRISMA_DEFAULT_TIMEOUT_MS, Math.floor(assertLeaseMs(leaseMs) / 2)),
  }
}

/**
 * Claim the roll-up's lease if nobody holds it, or the holder's has expired.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.workerId Who is claiming.
 * @param {function(): Date} [params.clock] The lease clock.
 * @param {number} [params.leaseMs] How long the lease lasts.
 * @returns {Promise<boolean>} Whether this worker now holds it.
 */
export async function claimTrafficRollupLease(
  prisma,
  { workerId, clock = () => new Date(), leaseMs = DEFAULT_LEASE_MS },
) {
  // The migration inserted the row; this covers a database somebody truncated.
  await prisma.trafficRollupState.createMany({
    data: [{ id: ROLLUP_STATE_ID }],
    skipDuplicates: true,
  })

  const at = clock()
  const { count } = await prisma.trafficRollupState.updateMany({
    where: {
      id: ROLLUP_STATE_ID,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: at } }],
    },
    data: { leaseOwner: workerId, leaseExpiresAt: new Date(at.getTime() + leaseMs) },
  })

  return count === 1
}

/**
 * Give the lease back, if this worker still holds it.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.workerId Who is releasing.
 * @param {boolean} params.completed Whether the run finished, which records `lastCompletedAt`.
 * @param {function(): Date} [params.clock] The lease clock; the completion is when it really finished.
 * @returns {Promise<boolean>} Whether a lease was released.
 */
export async function releaseTrafficRollupLease(
  prisma,
  { workerId, completed, clock = () => new Date() },
) {
  const { count } = await prisma.trafficRollupState.updateMany({
    where: { id: ROLLUP_STATE_ID, leaseOwner: workerId },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(completed ? { lastCompletedAt: clock() } : {}),
    },
  })

  return count === 1
}

/**
 * Recompute one UTC day's totals from that day's raw rows.
 *
 * Values are set, never added to, so running it twice gives the same rows. A
 * real count always replaces a demonstration row and clears its flag.
 *
 * Final totals — computed `RAW_KEEP_DAYS` or more days after their day, when
 * every raw row of the day had been written — are never overwritten. A purge
 * cut short between batches leaves only part of a day's raw rows, and sums of
 * that part must not replace the sums of the whole day.
 *
 * @param {object} tx A transaction client.
 * @param {object} params Inputs.
 * @param {string} params.day `YYYY-MM-DD`.
 * @param {Date} params.now The business instant, recorded as `computedAt`.
 * @returns {Promise<number>} Rows written.
 */
export async function rollUpTrafficDay(tx, { day, now }) {
  return tx.$executeRaw`
    INSERT INTO "TrafficDaily" (
      "eventId", "day", "views", "visitors", "anonymousViews",
      "viewsDirect", "viewsInternal", "viewsSearch", "viewsSocial", "viewsOther",
      "cardClicks", "cardClicksHome", "cardClicksListing", "cardClicksSearch",
      "ticketClicks", "seatClicks", "ticketClickVisitors",
      "websiteRedirects", "websiteRedirectVisitors", "demonstration", "computedAt")
    SELECT "eventId", "day",
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW'),
      count(DISTINCT "visitorHash") FILTER (WHERE "kind" = 'PAGE_VIEW'),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "visitorHash" IS NULL),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "source" = 'DIRECT'),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "source" = 'INTERNAL'),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "source" = 'SEARCH'),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "source" = 'SOCIAL'),
      count(*) FILTER (WHERE "kind" = 'PAGE_VIEW' AND "source" = 'OTHER'),
      count(*) FILTER (WHERE "kind" = 'CARD_CLICK'),
      count(*) FILTER (WHERE "kind" = 'CARD_CLICK' AND "placement" = 'HOME'),
      count(*) FILTER (WHERE "kind" = 'CARD_CLICK' AND "placement" = 'LISTING'),
      count(*) FILTER (WHERE "kind" = 'CARD_CLICK' AND "placement" = 'SEARCH'),
      count(*) FILTER (WHERE "kind" = 'TICKETS_CLICK'),
      count(*) FILTER (WHERE "kind" = 'SEATS_CLICK'),
      count(DISTINCT "visitorHash") FILTER (WHERE "kind" IN ('TICKETS_CLICK', 'SEATS_CLICK')),
      count(*) FILTER (WHERE "kind" = 'WEBSITE_REDIRECT'),
      count(DISTINCT "visitorHash") FILTER (WHERE "kind" = 'WEBSITE_REDIRECT'),
      false,
      ${now}
    FROM "TrafficEvent"
    WHERE "day" = ${day}::date
    GROUP BY "eventId", "day"
    ON CONFLICT ("eventId", "day") DO UPDATE SET
      "views" = EXCLUDED."views",
      "visitors" = EXCLUDED."visitors",
      "anonymousViews" = EXCLUDED."anonymousViews",
      "viewsDirect" = EXCLUDED."viewsDirect",
      "viewsInternal" = EXCLUDED."viewsInternal",
      "viewsSearch" = EXCLUDED."viewsSearch",
      "viewsSocial" = EXCLUDED."viewsSocial",
      "viewsOther" = EXCLUDED."viewsOther",
      "cardClicks" = EXCLUDED."cardClicks",
      "cardClicksHome" = EXCLUDED."cardClicksHome",
      "cardClicksListing" = EXCLUDED."cardClicksListing",
      "cardClicksSearch" = EXCLUDED."cardClicksSearch",
      "ticketClicks" = EXCLUDED."ticketClicks",
      "seatClicks" = EXCLUDED."seatClicks",
      "ticketClickVisitors" = EXCLUDED."ticketClickVisitors",
      "websiteRedirects" = EXCLUDED."websiteRedirects",
      "websiteRedirectVisitors" = EXCLUDED."websiteRedirectVisitors",
      "demonstration" = false,
      "computedAt" = EXCLUDED."computedAt"
    WHERE "TrafficDaily"."demonstration"
      OR "TrafficDaily"."computedAt" < "TrafficDaily"."day" + ${RAW_KEEP_DAYS}::integer`
}

/**
 * Delete up to one batch of a day's raw rows.
 *
 * Only ever called for a day whose totals are final — made so by this run's
 * upsert, or by an earlier run's — so every row it deletes has been counted.
 *
 * @param {object} tx A transaction client.
 * @param {object} params Inputs.
 * @param {string} params.day `YYYY-MM-DD`.
 * @param {number} [params.rows] The most rows to delete.
 * @returns {Promise<number>} Rows deleted.
 */
export async function purgeTrafficDayBatch(tx, { day, rows = PURGE_BATCH_ROWS }) {
  // The LIMIT bounds what one statement deletes and holds locked; the rows
  // are then deleted by address (`ctid = ANY (ARRAY(…))`, a TID scan).
  return tx.$executeRaw`
    DELETE FROM "TrafficEvent"
    WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM "TrafficEvent" WHERE "day" = ${day}::date LIMIT ${rows}::integer))`
}

/**
 * Thrown inside a day's transaction when the lease is no longer this worker's.
 *
 * @returns {Error} The error.
 */
function leaseLost() {
  return Object.assign(new Error('traffic roll-up lease lost'), { code: 'LEASE_LOST' })
}

/**
 * Re-check and renew the lease in one statement, under the state row's lock.
 *
 * A worker whose lease lapsed and was taken over stops here, before it writes
 * or deletes anything more.
 *
 * @param {object} tx A transaction client.
 * @param {object} params Inputs.
 * @param {string} params.workerId The lease holder.
 * @param {function(): Date} params.clock The lease clock.
 * @param {number} params.leaseMs How long the renewed lease lasts.
 * @returns {Promise<void>}
 * @throws {Error} `LEASE_LOST` when the lease is no longer this worker's.
 */
async function renewLease(tx, { workerId, clock, leaseMs }) {
  const renewed = await tx.trafficRollupState.updateMany({
    where: { id: ROLLUP_STATE_ID, leaseOwner: workerId, leaseExpiresAt: { gt: clock() } },
    data: { leaseExpiresAt: new Date(clock().getTime() + leaseMs) },
  })

  if (renewed.count === 0) throw leaseLost()
}

/**
 * Add one day up and, when it is old enough, purge its raw rows.
 *
 * The first transaction renews the lease, recomputes the day and deletes the
 * first batch; a busy day's later batches each take a transaction of their
 * own, renewing the lease first. Rows deleted are added to `summary` as each
 * batch commits, so a day cut short still reports what it deleted.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.day `YYYY-MM-DD`.
 * @param {Date} params.now The business instant.
 * @param {boolean} params.purge Whether the day is old enough to purge.
 * @param {number} params.batchRows Rows per purge statement.
 * @param {object} params.lease `{ workerId, clock, leaseMs }` for `renewLease`.
 * @param {object} params.options Prisma `$transaction` options.
 * @param {object} params.summary The run's summary; `rowsPurged` grows.
 * @returns {Promise<void>}
 */
async function rollUpAndPurgeDay(prisma, { day, now, purge, batchRows, lease, options, summary }) {
  let deleted = Number(
    await prisma.$transaction(async (tx) => {
      await renewLease(tx, lease)
      await rollUpTrafficDay(tx, { day, now })

      return purge ? purgeTrafficDayBatch(tx, { day, rows: batchRows }) : 0
    }, options),
  )

  summary.rowsPurged += deleted

  while (purge && deleted >= batchRows) {
    deleted = Number(
      await prisma.$transaction(async (tx) => {
        await renewLease(tx, lease)

        return purgeTrafficDayBatch(tx, { day, rows: batchRows })
      }, options),
    )
    summary.rowsPurged += deleted
  }
}

/**
 * One whole roll-up run.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.workerId Who is running it; recorded as the lease owner.
 * @param {Date} [params.now] The business instant: today, what may be purged, `computedAt`.
 * @param {function(): Date} [params.clock] The lease clock, read fresh every time.
 * @param {number} [params.leaseMs] How long the lease lasts between renewals.
 * @param {number} [params.purgeBatchRows] Raw rows deleted per purge statement.
 * @param {object} [params.logger] A pino-style logger; given counts, dates and error codes only.
 * @returns {Promise<{claimed: boolean, leaseLost: boolean, days: number, rowsPurged: number, saltsDiscarded: number}>} What was done.
 * @throws {TypeError} When `workerId`, `leaseMs` or `purgeBatchRows` is unusable.
 * @throws {Error} The first day's failure, after every later day was tried and the lease given back.
 */
export async function runTrafficRollup(
  prisma,
  {
    workerId,
    now = new Date(),
    clock = () => new Date(),
    leaseMs = DEFAULT_LEASE_MS,
    purgeBatchRows = PURGE_BATCH_ROWS,
    logger = null,
  } = {},
) {
  if (typeof workerId !== 'string' || workerId.trim().length === 0) {
    throw new TypeError('The traffic roll-up needs a non-empty workerId.')
  }

  const options = rollupTransactionOptions(leaseMs)

  if (!Number.isInteger(purgeBatchRows) || purgeBatchRows <= 0) {
    throw new TypeError('The traffic roll-up purge batch must be a positive number of rows.')
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('The traffic roll-up needs a valid business instant.')
  }

  const summary = { claimed: false, leaseLost: false, days: 0, rowsPurged: 0, saltsDiscarded: 0 }

  if (!(await claimTrafficRollupLease(prisma, { workerId, clock, leaseMs }))) return summary

  summary.claimed = true

  const today = utcDay(now)
  const purgeThrough = utcDay(new Date(now.getTime() - RAW_KEEP_DAYS * DAY_MS))
  const lease = { workerId, clock, leaseMs }
  let firstFailure = null

  try {
    const days = await prisma.$queryRaw`
      SELECT DISTINCT to_char("day", 'YYYY-MM-DD') AS "day" FROM "TrafficEvent" ORDER BY 1`

    for (const { day } of days) {
      try {
        await rollUpAndPurgeDay(prisma, {
          day,
          now,
          purge: day <= purgeThrough,
          batchRows: purgeBatchRows,
          lease,
          options,
          summary,
        })
        summary.days += 1
      } catch (error) {
        if (error?.code === 'LEASE_LOST') throw error

        // One day that cannot be finished must not hold the later days back.
        firstFailure ??= error
        logger?.error?.(
          { day, code: error?.code ?? null },
          'traffic roll-up could not finish a day; carrying on with the later days',
        )
      }
    }

    // A salt of a day that is over can rebuild no code any more once it is
    // gone; the API also deletes them when it makes the next day's.
    const discarded = await prisma.trafficSalt.deleteMany({
      where: { day: { lt: dayDate(today) } },
    })

    summary.saltsDiscarded = discarded.count
  } catch (error) {
    if (error?.code !== 'LEASE_LOST') {
      await releaseTrafficRollupLease(prisma, { workerId, completed: false, clock }).catch(() => {})
      throw error
    }

    summary.leaseLost = true
    logger?.warn?.(
      { days: summary.days, rowsPurged: summary.rowsPurged },
      'traffic roll-up stopped: another worker took over the lease',
    )

    return summary
  }

  // A run with a day left unfinished is not a completed run: the figures'
  // freshness stays where the last whole run left it.
  await releaseTrafficRollupLease(prisma, { workerId, completed: firstFailure === null, clock })

  if (firstFailure) throw firstFailure

  return summary
}
