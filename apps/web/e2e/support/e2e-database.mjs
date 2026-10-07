/**
 * The one database the browser suites write to, and never the unit suites'.
 *
 * The browser suites seed, sign in and roll visits up in a real database, and
 * the roll-up is global: it takes the one roll-up lease and purges every raw
 * visit older than two days, wherever it came from. Until this module, every
 * suite with an API defaulted to `TEST_DATABASE_URL`, `desi_event_test` — the
 * database `pnpm verify:tests:fresh` runs the Vitest suites in. CI never ran
 * the two side by side (each browser job has a database of its own), but a
 * local gate did, and one roll-up fired 2.5 or 5 seconds into the worker's
 * real-PostgreSQL roll-up suite failed it (Stage E review, area REL).
 *
 * So the browser suites have a database of their own:
 * `E2E_DATABASE_URL`, by default `desi_event_e2e` on the local server. They no
 * longer read `TEST_DATABASE_URL` at all — in a shell that has exported `.env`
 * it names the unit suites' database. Each config's API server migrates its
 * database before it starts (`migrate:deploy` creates it when it is missing,
 * and changes nothing when it is current), so no step has to be remembered.
 * And a URL naming a database the unit suites use — `desi_event_test`, or a
 * private `desi_event_test_…` one — is refused when a config or seed loads,
 * whatever the variable says.
 *
 * Nothing here connects to anything: it reads the environment and returns a
 * string. `src/lib/e2e-database.test.js` drives it.
 *
 * @module e2e/support/e2e-database
 */

/** The browser suites' database when `E2E_DATABASE_URL` is not set. */
export const DEFAULT_E2E_DATABASE_URL =
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_e2e?schema=public'

/**
 * The unit suites' databases: `desi_event_test`, which `.env`, CI's verify job
 * and `pnpm verify:tests:fresh` use, and the private `desi_event_test_…` ones
 * a contributor runs them in.
 */
export const UNIT_TEST_DATABASE = /^desi_event_test(?:_|$)/u

/**
 * The database a PostgreSQL URL names.
 *
 * @param {string} url The URL.
 * @returns {string} Its database, or the empty string when it names none.
 */
function databaseOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//u, ''))
  } catch {
    throw new Error(`E2E_DATABASE_URL is not a URL: ${JSON.stringify(url)}.`)
  }
}

/**
 * The browser suites' database URL, refusing the unit suites' databases.
 *
 * @param {Record<string, string|undefined>} env The environment. Only `E2E_DATABASE_URL` is read.
 * @returns {string} The URL to seed and serve from.
 * @throws {Error} When the URL names no database, or one the Vitest suites use.
 */
export function e2eDatabaseUrl(env) {
  const url = env.E2E_DATABASE_URL || DEFAULT_E2E_DATABASE_URL
  const database = databaseOf(url)

  if (database === '' || UNIT_TEST_DATABASE.test(database)) {
    throw new Error(
      `The browser suites refuse database "${database}": the Vitest suites use it, and a ` +
        'browser run beside them would roll up and purge their visits. Point E2E_DATABASE_URL ' +
        'at a database of its own (by default desi_event_e2e).',
    )
  }

  return url
}

/** The URL every browser config and seed uses, read once. */
export const E2E_DATABASE_URL = e2eDatabaseUrl(process.env)

/** Migrate the database `DATABASE_URL` names, creating it when it is missing. */
const MIGRATE = 'pnpm --filter @desi-event/db run migrate:deploy'

/**
 * The command a config's API server runs: migrate the browser suites'
 * database, then serve. Run from `apps/api`, with `DATABASE_URL` set to
 * {@link E2E_DATABASE_URL} in the server's environment. Asked twice when the
 * first fails, because two configs started together on a machine without the
 * database both try to create it, and one of them loses; the second attempt
 * finds it, and Prisma's migration lock lets one of them migrate at a time.
 */
export const API_SERVER_COMMAND = `(${MIGRATE} || ${MIGRATE}) && node src/server.js`
