/**
 * Row locks as a timing device, for the race tests against PostgreSQL.
 *
 * Two requests racing through `Promise.all` reach their locks in whatever
 * order the scheduler picks, so a test that means "B lands while A waits" has
 * to arrange it. One row is held locked in a transaction of the test's own;
 * the racing requests queue behind it in the order the test starts them, which
 * PostgreSQL keeps; then the row is let go.
 *
 * Waiters are found by pid through `pg_blocking_pids`, so another suite's lock
 * wait in the same database is never mistaken for one of these.
 *
 * @module @desi-event/api/tests/helpers/row-locks
 */

/** The tables a test may hold a row of. Named, because a table is an identifier. */
const TABLES = new Set(['Membership', 'Invitation', 'Order', 'OrderItem'])

/**
 * Hold one row locked until told to let go.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} table The table, one of {@link TABLES}.
 * @param {string} id The row's id.
 * @returns {Promise<{release: function(): void, done: Promise<void>, pid: number}>} Resolves once held.
 */
export async function holdRow(prisma, table, id) {
  if (!TABLES.has(table)) throw new Error(`No lock helper for the table ${table}.`)

  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let held
  const heldPromise = new Promise((resolve) => {
    held = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id)
      held(pid)
      await gate
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  return { release, done, pid: await heldPromise }
}

/**
 * The backends PostgreSQL reports as waiting on any of `pids`.
 *
 * @param {object} prisma The Prisma client.
 * @param {number[]} pids The blocking backends.
 * @returns {Promise<number[]>} The waiting backends.
 */
export async function waitingOn(prisma, pids) {
  const rows = await prisma.$queryRaw`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND pg_blocking_pids(pid) && ${pids}::int[]`

  return rows.map((row) => Number(row.pid))
}

/**
 * Wait until `count` backends are waiting on the given ones.
 *
 * @param {object} prisma The Prisma client.
 * @param {function(): number[]} pids The blocking backends, re-read each poll.
 * @param {number} count How many waiters to wait for.
 * @param {string} what What is being waited for, for the failure message.
 * @returns {Promise<number[]>} The waiters.
 * @throws {Error} After five seconds without them.
 */
export async function untilWaiting(prisma, pids, count, what) {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    const waiting = await waitingOn(prisma, pids())

    if (waiting.length >= count) return waiting

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`Never saw ${what} waiting on a lock within five seconds.`)
}
