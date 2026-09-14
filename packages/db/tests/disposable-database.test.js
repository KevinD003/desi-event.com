/**
 * The guard that keeps fresh-database verification away from real data.
 *
 * `verify-fresh-database.mjs` creates, migrates, seeds, writes to and drops a
 * database. Every one of those is destructive, so the only thing that has to be
 * true is that it cannot be pointed anywhere else. That is what these tests
 * hold — without running any of the destructive work.
 */

import { describe, expect, it } from 'vitest'

import {
  assertDisposable,
  databaseName,
  disposableDatabaseName,
  redactedIdentifier,
  resolveDisposableTarget,
  withDatabase,
} from '../scripts/disposable-database.mjs'

const DEV = 'postgresql://desi:hunter2@127.0.0.1:5432/desi_event?schema=public'
const TEST = 'postgresql://desi:hunter2@127.0.0.1:5432/desi_event_test?schema=public'

describe('assertDisposable', () => {
  it('accepts a generated disposable name', () => {
    expect(assertDisposable(disposableDatabaseName())).toMatch(
      /^desi_event_disposable_[0-9a-f]{16}$/,
    )
  })

  it.each([
    'desi_event',
    'desi_event_test',
    'postgres',
    'template1',
    'desi_event_disposable',
    'desi_event_disposable_',
    'desi_event_disposable_notahexstring',
    'desi_event_disposable_9b3161d0bfb6314', // fifteen digits
    'prod_desi_event_disposable_9b3161d0bfb6314a',
  ])('refuses %s', (name) => {
    expect(() => assertDisposable(name)).toThrow(/not a disposable database/)
  })
})

describe('resolveDisposableTarget', () => {
  it('generates a disposable database on the server DATABASE_URL names', () => {
    const { target, template, name } = resolveDisposableTarget({ DATABASE_URL: DEV })

    expect(template).toBe(DEV)
    expect(name).toMatch(/^desi_event_disposable_[0-9a-f]{16}$/)
    expect(new URL(target).host).toBe(new URL(DEV).host)
    expect(databaseName(target)).not.toBe(databaseName(DEV))
  })

  it('never returns the same database twice', () => {
    const first = resolveDisposableTarget({ DATABASE_URL: DEV })
    const second = resolveDisposableTarget({ DATABASE_URL: DEV })

    expect(first.name).not.toBe(second.name)
  })

  it('refuses a requested target that is not disposable', () => {
    expect(() => resolveDisposableTarget({ DATABASE_URL: DEV, FRESH_DATABASE_URL: DEV })).toThrow(
      /not a disposable database/,
    )
  })

  it('refuses the development database by name even when it is called something else', () => {
    const renamed =
      'postgresql://desi:hunter2@127.0.0.1:5432/desi_event_disposable_0123456789abcdef'

    expect(() =>
      resolveDisposableTarget({ DATABASE_URL: renamed, FRESH_DATABASE_URL: renamed }),
    ).toThrow(/the target is DATABASE_URL/)
  })

  it('refuses the test database', () => {
    const renamed =
      'postgresql://desi:hunter2@127.0.0.1:5432/desi_event_disposable_0123456789abcdef'

    expect(() =>
      resolveDisposableTarget({
        DATABASE_URL: DEV,
        TEST_DATABASE_URL: renamed,
        FRESH_DATABASE_URL: renamed,
      }),
    ).toThrow(/the target is TEST_DATABASE_URL/)
  })

  it('refuses to run with no server configured at all', () => {
    expect(() => resolveDisposableTarget({})).toThrow(/DATABASE_URL is not set/)
  })
})

describe('redactedIdentifier', () => {
  it('keeps the database name and nothing else', () => {
    expect(redactedIdentifier(DEV)).toBe('postgresql://<redacted>@<redacted>/desi_event')
  })

  it('never carries a password, a user or a host', () => {
    const identifier = redactedIdentifier(TEST)

    expect(identifier).not.toContain('hunter2')
    expect(identifier).not.toContain('desi:')
    expect(identifier).not.toContain('127.0.0.1')
    expect(identifier).not.toContain('5432')
  })
})

describe('withDatabase', () => {
  it('changes only the database', () => {
    const moved = withDatabase(DEV, 'desi_event_disposable_0123456789abcdef')

    expect(new URL(moved).host).toBe(new URL(DEV).host)
    expect(databaseName(moved)).toBe('desi_event_disposable_0123456789abcdef')
  })
})
