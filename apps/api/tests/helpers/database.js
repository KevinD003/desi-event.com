/**
 * Connecting an integration suite to a real database, and refusing to pretend.
 *
 * Every suite in this directory that needs PostgreSQL has the same problem: a
 * developer without a database running should get a useful message rather than
 * fourteen connection errors, but a *build* without a database running must not
 * report a green tick for tests that never executed.
 *
 * Those two needs pull in opposite directions, and the resolution is one
 * environment variable. `REQUIRE_DATABASE=1` — set by `db:verify:fresh` and by
 * CI — turns an unreachable database from a skip into a failure. Unset, on a
 * laptop, it stays a skip with a warning naming the suite.
 *
 * The probe happens at module scope on purpose. `describe.skip` is decided
 * while the file is being collected, so a flag set in `beforeAll` is still
 * false at that point and every test would skip even against a live database.
 * Top-level await is the only way to make the skip mean what it says.
 *
 * @module @desi-event/api/tests/helpers/database
 */

import { describe } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

/** Where the integration suites look for a database. */
export const TEST_CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/**
 * Whether a build has declared that the database is not optional.
 *
 * @returns {boolean} True when `REQUIRE_DATABASE` is set to anything truthy.
 */
export function databaseIsRequired() {
  const flag = process.env.REQUIRE_DATABASE

  return flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false'
}

/**
 * Hide the password when a connection string has to appear in a message.
 *
 * @param {string} connection A PostgreSQL URL.
 * @returns {string} The same URL with any password replaced.
 */
export function redactedConnection(connection = TEST_CONNECTION) {
  return connection.replace(/:[^:@/]*@/, ':***@')
}

/**
 * Warn about an unreachable database, or refuse to continue without one.
 *
 * For suites that do their own probing. The rule is the same: a laptop gets a
 * warning and a skip, a build that set `REQUIRE_DATABASE` gets a failure,
 * because zero failing tests reads exactly like success.
 *
 * @param {string} label What to call this suite.
 * @param {boolean} reachable Whether the probe answered.
 * @param {string} [connection] The connection string, for the message.
 * @returns {void} Nothing.
 * @throws {Error} When unreachable and `REQUIRE_DATABASE` is set.
 */
export function requireDatabaseOrWarn(label, reachable, connection = TEST_CONNECTION) {
  if (reachable) return

  const where = redactedConnection(connection)

  if (databaseIsRequired()) {
    throw new Error(
      `${label} needs PostgreSQL and ${where} is unreachable. ` +
        'REQUIRE_DATABASE is set, so this is a failure rather than a skip.',
    )
  }

  console.warn(`[api] skipping ${label}: ${where} is unreachable`)
}

/**
 * Connect, probe, and hand back the `describe` this suite should use.
 *
 * @param {string} label What to call this suite in the skip warning.
 * @param {object} [options] Options.
 * @param {string} [options.connection] Override the connection string.
 * @returns {Promise<{prisma: object, reachable: boolean, when: function(): object}>} The client and a `describe`.
 * @throws {Error} When the database is unreachable and `REQUIRE_DATABASE` is set.
 */
export async function connectTestDatabase(label, { connection = TEST_CONNECTION } = {}) {
  const prisma = createPrismaClient({ connectionString: connection })
  const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

  if (!reachable) {
    const where = redactedConnection(connection)

    if (databaseIsRequired()) {
      // A build that asked for the database does not get a green tick for tests
      // that never ran. Thrown at collection time, so the suite fails loudly
      // rather than reporting zero tests, which reads as success.
      throw new Error(
        `${label} needs PostgreSQL and ${where} is unreachable. ` +
          'REQUIRE_DATABASE is set, so this is a failure rather than a skip.',
      )
    }

    console.warn(`[api] skipping ${label}: ${where} is unreachable`)
  }

  return {
    prisma,
    reachable,
    when: () => (reachable ? describe : describe.skip),
  }
}
