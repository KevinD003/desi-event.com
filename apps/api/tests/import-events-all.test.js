import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BUNDLED_FILES,
  IMPORTS_DIRECTORY,
  USAGE_ALL,
  parseImportAllArgs,
  runImportAllCommand,
} from '../scripts/import-events-all.mjs'
import { runImportCommand } from '../scripts/import-events.mjs'
import { makeWorld } from './helpers/fixtures.js'

/**
 * `pnpm import:events:all --as <email> [--apply]` (2026-10-16): both bundled
 * files, the older first so the newer words stay, each through
 * `pnpm import:events` exactly, never approving anything.
 *
 * @file @desi-event/api/tests/import-events-all
 */

const ANIL = 'anil@desi-event.example'

/**
 * Lines written, kept.
 *
 * @returns {{lines: string[], out: {log: Function, error: Function}}} The sink.
 */
function sink() {
  const lines = []

  return { lines, out: { log: (line) => lines.push(line), error: (line) => lines.push(line) } }
}

describe('parseImportAllArgs', () => {
  it('reads the account, in any case and either spelling, and --apply', () => {
    expect(parseImportAllArgs(['--as', ANIL])).toEqual({ email: ANIL, apply: false })
    expect(parseImportAllArgs([`--as=${ANIL.toUpperCase()}`, '--apply'])).toEqual({
      email: ANIL,
      apply: true,
    })
    expect(parseImportAllArgs(['--', '--apply', '--as', ` ${ANIL} `])).toEqual({
      email: ANIL,
      apply: true,
    })
  })

  it('refuses a file, an unknown flag, and a missing or empty account', () => {
    for (const argv of [
      ['texas-2026.json', '--as', ANIL],
      ['--as', ANIL, '--approve'],
      ['--as', ANIL, '--publish'],
      [],
      ['--apply'],
      ['--as'],
      ['--as', '--apply'],
      ['--as='],
    ]) {
      expect(() => parseImportAllArgs(argv), JSON.stringify(argv)).toThrow(
        /Usage: pnpm import:events:all --as <email> \[--apply\]/u,
      )
    }

    expect(USAGE_ALL).toBe('Usage: pnpm import:events:all --as <email> [--apply]')
  })
})

describe('the bundled files and their order', () => {
  it('takes the Texas file first and the newer North America file second', async () => {
    expect(BUNDLED_FILES).toEqual(['texas-2026.json', 'north-america-2026.json'])

    const [texas, northAmerica] = await Promise.all(
      BUNDLED_FILES.map(async (name) =>
        JSON.parse(await readFile(path.join(IMPORTS_DIRECTORY, name), 'utf8')),
      ),
    )

    // Newer content wins: the second file was curated after the first.
    expect(northAmerica.curatedOn > texas.curatedOn).toBe(true)

    // And the two share listings, which is why the order matters.
    const shared = texas.events.filter((event) =>
      northAmerica.events.some((other) => other.sourceId === event.sourceId),
    )

    expect(shared.length).toBeGreaterThan(0)
  })
})

describe('runImportAllCommand', () => {
  it('sends each file through pnpm import:events in order, passing --apply on and nothing else', async () => {
    const sent = []
    const { lines, out } = sink()

    const done = await runImportAllCommand({
      argv: ['--as', ANIL, '--apply'],
      prisma: {},
      out,
      directory: '/data',
      importOne: async (options) => {
        sent.push(options.argv)

        return { view: { id: `run-${sent.length}` }, results: [{ outcome: 'WRITTEN' }] }
      },
    })

    expect(sent).toEqual([
      [path.join('/data', 'texas-2026.json'), '--as', ANIL, '--apply'],
      [path.join('/data', 'north-america-2026.json'), '--as', ANIL, '--apply'],
    ])
    expect(done.map((step) => step.file)).toEqual(BUNDLED_FILES)
    expect(lines.join('\n')).toMatch(/2 listings written/u)
    // It says approval is a person's, in the web, and does none.
    expect(lines.join('\n')).toMatch(
      /"Approve and publish all pending imported events" publishes them, with your second factor/u,
    )
  })

  it('only plans without --apply', async () => {
    const sent = []
    const { lines, out } = sink()

    await runImportAllCommand({
      argv: ['--as', ANIL],
      prisma: {},
      out,
      importOne: async (options) => {
        sent.push(options.argv)

        return { view: {}, results: null }
      },
    })

    expect(sent.every((argv) => !argv.includes('--apply'))).toBe(true)
    expect(lines.at(-1)).toBe(
      'Nothing was imported. Run again with --apply to import both files, in this order.',
    )
  })

  it('stops at a file that cannot be imported, before the newer one', async () => {
    const sent = []

    await expect(
      runImportAllCommand({
        argv: ['--as', ANIL, '--apply'],
        prisma: {},
        out: sink().out,
        importOne: async (options) => {
          sent.push(options.argv[0])
          throw new Error('Nothing was imported.')
        },
      }),
    ).rejects.toThrow('Nothing was imported.')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/texas-2026\.json$/u)
  })

  it('imports both real files on the stub, leaving the shared listings the newer run’s, and approves none', async () => {
    const { seed } = await makeWorld()
    const { createPrismaStub } = await import('./helpers/prisma-stub.js')
    const prisma = createPrismaStub(seed)
    const { out } = sink()
    // Before every listing in either file, so none is skipped as past.
    const now = new Date('2026-09-30T12:00:00Z')
    const sent = []

    const done = await runImportAllCommand({
      argv: ['--as', ANIL, '--apply'],
      prisma,
      out,
      now,
      importOne: (options) => {
        sent.push(options)

        return runImportCommand(options)
      },
    })

    expect(sent.every((options) => options.now === now)).toBe(true)

    const [texasRun, northAmericaRun] = done.map((step) => step.view.id)
    const texas = JSON.parse(
      await readFile(path.join(IMPORTS_DIRECTORY, 'texas-2026.json'), 'utf8'),
    )
    const northAmerica = JSON.parse(
      await readFile(path.join(IMPORTS_DIRECTORY, 'north-america-2026.json'), 'utf8'),
    )
    const shared = texas.events
      .map((event) => event.sourceId)
      .filter((id) => northAmerica.events.some((other) => other.sourceId === id))

    for (const sourceId of shared) {
      const item = prisma._store.eventImportItem.find((row) => row.sourceId === sourceId)
      const event = prisma._store.event.find((row) => row.id === item.eventId)
      const newer = northAmerica.events.find((listing) => listing.sourceId === sourceId)

      expect(item.lastRunId, sourceId).toBe(northAmericaRun)
      expect(event.title, sourceId).toBe(newer.title)
    }

    expect(texasRun).not.toBe(northAmericaRun)

    // Every imported event waits for review: nothing was approved or published.
    const imported = new Set(prisma._store.eventImportItem.map((row) => row.eventId))
    const statuses = new Set(
      prisma._store.event.filter((row) => imported.has(row.id)).map((row) => row.status),
    )

    expect([...statuses]).toEqual(['REVIEW_PENDING'])
    expect(prisma._store.auditLog.some((row) => row.action === 'event.approved')).toBe(false)
    expect(
      prisma._store.auditLog
        .filter((row) => row.action === 'event.imported')
        .every((row) => row.metadata.via === 'cli'),
    ).toBe(true)
  }, 120_000)
})
