#!/usr/bin/env node
/**
 * `pnpm import:events:all --as <email> [--apply]`: plan, and with `--apply`
 * import, every listing file this repository carries, in the order that
 * leaves the newest words in place (the owner, 2026-10-16: "Add all the events
 * and publish all of them on live").
 *
 * The files are `packages/db/data/imports/texas-2026.json` (collected 29-30
 * September 2026), then `north-america-2026.json` (curated 15 October 2026).
 * Ten listings are in both, and the second file's are the newer: applied
 * second, they update the drafts the first wrote, and the North America run
 * is the one those ten are approved from. The other order would put the
 * older Texas words back over them.
 *
 * Each file goes through `pnpm import:events` exactly ({@link runImportCommand}):
 * the same account checks, the same plan and, with `--apply`, the same
 * apply, `via: 'cli'`. Without `--apply` each file is planned against what
 * the database holds now, so the second plan shows what it would do if the
 * first were not applied.
 *
 * It never approves or publishes, as `pnpm import:events` never does (ADR
 * 0015): that is "Approve and publish all pending imported events" on
 * `/admin/imports`, by a person with a second factor (ADR 0019).
 *
 * `@file` rather than `@module`: the JSDoc rule refuses a module path with
 * `import-` in it.
 *
 * @file @desi-event/api/scripts/import-events-all
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runImportCommand } from './import-events.mjs'

/** How to call it. */
export const USAGE_ALL = 'Usage: pnpm import:events:all --as <email> [--apply]'

/** Where the bundled listing files are. */
export const IMPORTS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'db',
  'data',
  'imports',
)

/**
 * The bundled files, oldest content first, so the newer file's words are the
 * ones left on a listing both carry.
 *
 * @type {ReadonlyArray<string>}
 */
export const BUNDLED_FILES = Object.freeze(['texas-2026.json', 'north-america-2026.json'])

/**
 * Read the command line.
 *
 * @param {string[]} argv The arguments after the script's name.
 * @returns {{email: string, apply: boolean}} What was asked.
 * @throws {Error} With {@link USAGE_ALL} for anything else, a file name included: the files are fixed.
 */
export function parseImportAllArgs(argv) {
  let email = null
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--apply') {
      apply = true
    } else if (argument === '--as') {
      email = argv[index + 1] ?? null
      index += 1
    } else if (argument.startsWith('--as=')) {
      email = argument.slice('--as='.length)
    } else if (argument === '--') {
      continue
    } else {
      throw new Error(`Unexpected argument ${JSON.stringify(argument)}.\n${USAGE_ALL}`)
    }
  }

  if (!email || email.trim() === '' || email.startsWith('-')) throw new Error(USAGE_ALL)

  return { email: email.trim().toLowerCase(), apply }
}

/**
 * Run the command: each bundled file, in order, through `pnpm import:events`.
 *
 * A file that cannot be imported stops the command before the next one, so
 * the newer file is never applied without the older one before it.
 *
 * @param {object} options Inputs.
 * @param {string[]} options.argv The arguments.
 * @param {object} options.prisma A Prisma client.
 * @param {{log: Function, error: Function}} [options.out] Where lines are written.
 * @param {Date} [options.now] The moment.
 * @param {string} [options.directory] Where the files are; the bundled folder.
 * @param {Function} [options.importOne] One file's command; `runImportCommand` (tests watch what it is sent).
 * @returns {Promise<Array<{file: string, view: object, results: object[]|null}>>} What each file did.
 */
export async function runImportAllCommand(options) {
  const {
    argv,
    prisma,
    out = console,
    now,
    directory = IMPORTS_DIRECTORY,
    importOne = runImportCommand,
  } = options
  const { email, apply } = parseImportAllArgs(argv)
  const done = []

  for (const name of BUNDLED_FILES) {
    const file = path.join(directory, name)

    out.log(`${apply ? 'Importing' : 'Planning'} ${name}:`)

    const { view, results } = await importOne({
      argv: [file, '--as', email, ...(apply ? ['--apply'] : [])],
      prisma,
      out,
      ...(now ? { now } : {}),
    })

    done.push({ file: name, view, results })
  }

  if (apply) {
    const written = done.reduce(
      (sum, step) =>
        sum + (step.results ?? []).filter((result) => result.outcome === 'WRITTEN').length,
      0,
    )

    out.log(
      `Both files are imported (${written} listings written). Every imported event waits for review: on the import page in the web, "Approve and publish all pending imported events" publishes them, with your second factor.`,
    )
  } else {
    out.log('Nothing was imported. Run again with --apply to import both files, in this order.')
  }

  return done
}

/**
 * The process entry point.
 *
 * @returns {Promise<number>} The exit code.
 */
async function main() {
  const { default: dotenv } = await import('dotenv')
  const { loadApiEnv } = await import('@desi-event/schemas/env')
  const { createPrismaClient, disconnectPrisma } = await import('@desi-event/db')

  dotenv.config({ quiet: true })

  const env = loadApiEnv()
  const prisma = createPrismaClient({ connectionString: env.DATABASE_URL })

  const failed = await runImportAllCommand({ argv: process.argv.slice(2), prisma }).then(
    () => false,
    (error) => {
      console.error(error.message)

      return true
    },
  )

  await disconnectPrisma(prisma)

  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code
  })
}
