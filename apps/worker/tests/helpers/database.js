/**
 * Connecting a worker integration suite to a real database.
 *
 * A near-copy of `apps/api/tests/helpers/database.js`, and the duplication is
 * deliberate rather than an oversight: `apps/worker` cannot import from
 * `apps/api`, and promoting twenty lines of test plumbing into a shared package
 * would give the worker a dependency on the API's test conventions in order to
 * avoid copying a probe.
 *
 * The rule it enforces is the one that matters and is worth restating in full.
 * A developer with no database running should get a skip and a message; a
 * **build** with no database running must not get a green tick for tests that
 * never executed. `REQUIRE_DATABASE=1`, set by `db:verify:fresh` and by CI,
 * turns the skip into a failure. Zero failing tests reads exactly like success,
 * which is why the difference is a thrown error and not a louder warning.
 *
 * The probe is at module scope because `describe.skip` is decided during
 * collection: a flag set in `beforeAll` is still false by then, and every test
 * would skip even against a live database.
 *
 * @module worker/tests/helpers/database
 */

import { describe } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

/** Where the worker integration suites look for a database. */
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
      throw new Error(
        `${label} needs PostgreSQL and ${where} is unreachable. ` +
          'REQUIRE_DATABASE is set, so this is a failure rather than a skip.',
      )
    }

    console.warn(`[worker] skipping ${label}: ${where} is unreachable`)
  }

  return {
    prisma,
    reachable,
    when: () => (reachable ? describe : describe.skip),
  }
}
