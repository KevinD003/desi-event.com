/**
 * The rule that keeps fresh-database verification away from real data.
 *
 * `verify-fresh-database.mjs` creates a database, migrates it, seeds it,
 * writes to it and drops it. Every one of those is destructive, so the single
 * thing that matters is that it can only ever be pointed at a database nobody
 * is using. That rule lives here, on its own, so it can be tested without
 * running any of the destructive work it guards.
 *
 * The rule: the target's name must match {@link DISPOSABLE_NAME}, and must not
 * be the development or test database whatever it is called. There is no flag
 * that overrides either half.
 *
 * @module @desi-event/db/scripts/disposable-database
 */

import { randomBytes } from 'node:crypto'

/**
 * The only shape of database name this tooling will create, connect to or drop.
 *
 * Deliberately unguessable, and deliberately unlike anything a person would
 * name a database they cared about.
 */
export const DISPOSABLE_NAME = /^desi_event_disposable_[0-9a-f]{16}$/

/**
 * The database name a connection string points at.
 *
 * @param {string} url A PostgreSQL connection string.
 * @returns {string} The database name.
 */
export function databaseName(url) {
  return new URL(url).pathname.replace(/^\//, '')
}

/**
 * A connection string with everything but the database name removed.
 *
 * Safe to print, log, and paste into a report: the host, the user and the
 * password are gone, and what is left is an ephemeral name.
 *
 * @param {string} url A PostgreSQL connection string.
 * @returns {string} A redacted identifier.
 */
export function redactedIdentifier(url) {
  return `postgresql://<redacted>@<redacted>/${databaseName(url)}`
}

/**
 * Point a connection string at a different database on the same server.
 *
 * @param {string} url The template connection string.
 * @param {string} name The database to point at.
 * @returns {string} The rewritten connection string.
 */
export function withDatabase(url, name) {
  const next = new URL(url)
  next.pathname = `/${name}`

  return next.toString()
}

/**
 * A fresh disposable database name.
 *
 * @returns {string} A name matching {@link DISPOSABLE_NAME}.
 */
export function disposableDatabaseName() {
  return `desi_event_disposable_${randomBytes(8).toString('hex')}`
}

/**
 * Refuse anything that is not a disposable database.
 *
 * @param {string} name The database name to check.
 * @returns {string} The same name, when it is disposable.
 * @throws {Error} When the name is not disposable.
 */
export function assertDisposable(name) {
  if (DISPOSABLE_NAME.test(name)) return name

  throw new Error(
    `Refusing to act on "${name}": it is not a disposable database. This tooling only ever ` +
      'touches a database named desi_event_disposable_<16 hex digits>, so it can never ' +
      'migrate, seed, write to, truncate or drop a database anybody is using.',
  )
}

/**
 * Decide which database a verification run should work on.
 *
 * `DATABASE_URL` is read only as a description of the *server*: which host,
 * which port, which credentials. The database it names is never the target.
 *
 * @param {Record<string, string|undefined>} env The environment to read.
 * @returns {{target: string, template: string, name: string}} The disposable URL, the server, and the name.
 * @throws {Error} When no server is configured, or the requested target is not disposable.
 */
export function resolveDisposableTarget(env) {
  const template = env.DATABASE_URL

  if (!template) {
    throw new Error('DATABASE_URL is not set, so there is no server to create a database on.')
  }

  const target = env.FRESH_DATABASE_URL ?? withDatabase(template, disposableDatabaseName())
  const name = databaseName(target)

  assertDisposable(name)

  for (const label of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
    const other = env[label]

    if (other && databaseName(other) === name) {
      throw new Error(`Refusing to run: the target is ${label}. That database is not disposable.`)
    }
  }

  return { target, template, name }
}
