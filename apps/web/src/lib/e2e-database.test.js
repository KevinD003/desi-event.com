/**
 * The browser suites write to a database of their own, never the one the
 * Vitest suites run in.
 *
 * A browser run's traffic roll-up takes the global roll-up lease and purges
 * every raw visit older than two days. Fired into the database the worker's
 * real-PostgreSQL roll-up suite was using, it failed that suite (Stage E
 * review, area REL) — and every config with an API used to default to that
 * database. `e2e/support/e2e-database.mjs` now decides the URL for all of
 * them; this pins how it decides, and that nothing in the browser suites
 * reaches for the unit suites' database around it.
 *
 * @module lib/e2e-database.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  API_SERVER_COMMAND,
  DEFAULT_E2E_DATABASE_URL,
  e2eDatabaseUrl,
} from '../../e2e/support/e2e-database.mjs'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * A database URL on the local server.
 *
 * @param {string} name The database.
 * @returns {string} The URL.
 */
const url = (name) => `postgresql://desi:desi@127.0.0.1:5432/${name}?schema=public`

/**
 * Every file under a directory, recursively.
 *
 * @param {string} directory Where to look.
 * @returns {string[]} Absolute paths.
 */
function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('which database the browser suites use', () => {
  it('uses desi_event_e2e when nothing says otherwise', () => {
    expect(e2eDatabaseUrl({})).toBe(DEFAULT_E2E_DATABASE_URL)
    expect(DEFAULT_E2E_DATABASE_URL).toBe(url('desi_event_e2e'))
  })

  it('never reads TEST_DATABASE_URL, which an exported .env points at the unit suites’ database', () => {
    expect(e2eDatabaseUrl({ TEST_DATABASE_URL: url('desi_event_test') })).toBe(
      DEFAULT_E2E_DATABASE_URL,
    )
    // As a harness that names the browser database there for older configs.
    expect(e2eDatabaseUrl({ TEST_DATABASE_URL: url('desi_event_e2e') })).toBe(
      DEFAULT_E2E_DATABASE_URL,
    )
  })

  it('uses E2E_DATABASE_URL when it names a database of its own', () => {
    expect(e2eDatabaseUrl({ E2E_DATABASE_URL: url('desi_event_e2e_detail') })).toBe(
      url('desi_event_e2e_detail'),
    )
  })

  it('refuses the unit suites’ databases, the shared one and the private ones', () => {
    for (const name of ['desi_event_test', 'desi_event_test_f_rel']) {
      expect(() => e2eDatabaseUrl({ E2E_DATABASE_URL: url(name) })).toThrow(
        new RegExp(`refuse database "${name}"`, 'u'),
      )
    }

    // A name that only starts the same way is not one of theirs.
    expect(e2eDatabaseUrl({ E2E_DATABASE_URL: url('desi_event_tests_e2e') })).toBe(
      url('desi_event_tests_e2e'),
    )
  })

  it('refuses a URL naming no database, or no URL at all', () => {
    expect(() =>
      e2eDatabaseUrl({ E2E_DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432' }),
    ).toThrow(/refuse database ""/u)
    expect(() => e2eDatabaseUrl({ E2E_DATABASE_URL: 'desi_event_e2e' })).toThrow(/is not a URL/u)
  })

  it('migrates the database before the API serves from it, asking twice', () => {
    expect(API_SERVER_COMMAND).toBe(
      '(pnpm --filter @desi-event/db run migrate:deploy || pnpm --filter @desi-event/db run migrate:deploy) && node src/server.js',
    )
  })
})

describe('nothing in the browser suites reaches for the unit suites’ database', () => {
  const configs = readdirSync(webRoot)
    .filter((name) => /^playwright(\..+)?\.config\.js$/u.test(name))
    .map((name) => join(webRoot, name))
  const sources = [...configs, ...filesUnder(join(webRoot, 'e2e'))]
    .filter((path) => /\.(?:c|m)?js$/u.test(path))
    .filter((path) => !path.endsWith(join('e2e', 'support', 'e2e-database.mjs')))

  it('reads no TEST_DATABASE_URL and names no desi_event_test outside the module that refuses them', () => {
    const offenders = sources
      .filter((path) => /TEST_DATABASE_URL|desi_event_test/u.test(readFileSync(path, 'utf8')))
      .map((path) => relative(webRoot, path))

    expect(offenders).toEqual([])
  })

  it('serves every config’s API from the browser suites’ database, migrated first', () => {
    const withApi = configs.filter((path) => readFileSync(path, 'utf8').includes('DATABASE_URL'))

    expect(withApi.length).toBeGreaterThanOrEqual(5)

    for (const path of withApi) {
      const source = readFileSync(path, 'utf8')

      expect(source, relative(webRoot, path)).toContain('DATABASE_URL: E2E_DATABASE_URL,')
      expect(source, relative(webRoot, path)).toContain('command: API_SERVER_COMMAND,')
      expect(source, relative(webRoot, path)).not.toContain("command: 'node src/server.js'")
    }
  })
})
