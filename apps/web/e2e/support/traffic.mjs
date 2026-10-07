/**
 * Visit counting, as the browser specs drive it.
 *
 * The site counts a visit in two steps: a beacon writes a raw row, and the
 * roll-up (`@desi-event/db/traffic-rollup`, the worker's `roll-up-traffic`
 * job) adds the raw rows up into the daily totals every screen reads. No
 * worker runs beside the browser suites, so a spec adds up what it caused
 * itself, with the very function the worker calls — never by writing a total
 * of its own. That is the whole of this file's reach into the traffic tables:
 * it reads their column names, and it runs the roll-up.
 *
 * Not a `seed-*.mjs` file, and so not in `lib/e2e-seed-invariants.test.js`
 * (SPEC2-XI O15): it seeds nothing and deletes nothing a spec created. The
 * raw rows and daily totals hang from events by cascade, so whatever cleans
 * up an event takes its visits with it.
 *
 * @module e2e/support/traffic
 */

import { createPrismaClient } from '@desi-event/db'
import { runTrafficRollup } from '@desi-event/db/traffic-rollup'

import { CONNECTION } from './seed-refusals.mjs'

/** The tables visit counting keeps. */
export const TRAFFIC_TABLES = Object.freeze([
  'TrafficEvent',
  'TrafficDaily',
  'TrafficSalt',
  'TrafficRollupState',
])

/**
 * Add up every raw visit row now, as the worker's job would.
 *
 * The worker's own entry point, with the business instant left as now and the
 * lease clock real. The roll-up is idempotent — it sets each day's totals
 * from that day's raw rows, never adds to them — so calling it again changes
 * nothing that was already added up. A lease held by another run (an earlier
 * one that stopped mid-run) is waited out for up to the lease's own length,
 * because a roll-up that did not run would leave every figure a spec reads
 * where it was.
 *
 * @returns {Promise<object>} The roll-up's summary: `{claimed, days, rowsPurged, …}`.
 * @throws {Error} When the roll-up could not be claimed or did not finish.
 */
export async function rollUpTrafficNow() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const deadline = Date.now() + 330_000

    for (;;) {
      const summary = await runTrafficRollup(prisma, { workerId: 'e2e-traffic', now: new Date() })

      if (summary.claimed && !summary.leaseLost) return summary

      if (Date.now() > deadline) {
        throw new Error('The traffic roll-up could not be run: another holder kept its lease.')
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 2_000)
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Every column of the four traffic tables, as `table.column`.
 *
 * Read from `information_schema`, so the answer is the database's, not the
 * schema file's: what a visit could ever leave behind is what these columns
 * can hold.
 *
 * @returns {Promise<string[]>} The columns, sorted.
 */
export async function trafficColumns() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const rows = await prisma.$queryRaw`
      SELECT table_name AS "table", column_name AS "column"
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY (${[...TRAFFIC_TABLES]}::text[])
       ORDER BY 1, 2`

    return rows.map((row) => `${row.table}.${row.column}`)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A distinctive but ordinary desktop browser's user agent.
 *
 * Not a robot's — nothing in it matches the counting's robot pattern — and
 * carrying the tag, so this run's visitor has a visitor code of its own and is
 * counted apart from every other window, all of which share the device's
 * agent and the loopback address.
 *
 * @param {string} tag The run suffix.
 * @returns {string} The user agent.
 */
export function VISITOR_AGENT(tag) {
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 DesiEventVisit/${tag}`
}

/**
 * The default headless browser's user agent, which the counting takes for a
 * robot and stores nothing for.
 *
 * @returns {string} The user agent.
 */
export function HEADLESS_AGENT() {
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36'
}
