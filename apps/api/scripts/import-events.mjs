#!/usr/bin/env node
/**
 * `pnpm import:events <file> --as <email> [--apply]`: import a listing file
 * from the command line (SPEC2-XI I-G).
 *
 * Without `--apply` it plans the file and prints the plan; nothing but the run
 * is written. With `--apply` it applies the plan: each listing becomes a draft
 * sent for review, with one ticket type per listed price, not yet on sale. The account named by `--as` must hold `event:import` (a
 * platform administrator or super administrator) and must not be suspended;
 * every audit row records it and `via: 'cli'`.
 *
 * It never approves or publishes: that needs a person with a second factor in
 * the web. And it never updates a posted event: `updateFromSource` is always
 * empty from here, so a posted listing that changed stays as it is until an
 * administrator ticks "Update from the listing" on the import page.
 *
 * Nothing is fetched from anywhere: an import file carries no web address, and
 * no picture is copied (2026-10-15). It needs the database and nothing else.
 * Events already past are skipped.
 *
 * `@file` rather than `@module`: the JSDoc rule refuses a module path with
 * `import-` in it.
 *
 * @file @desi-event/api/scripts/import-events
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { CAPABILITIES, can } from '@desi-event/permissions'

import { toActor } from '../src/lib/actor.js'
import { applyImport, previewImport, toRunView } from '../src/lib/event-import.js'

/** How to call it. */
export const USAGE = 'Usage: pnpm import:events <file.json> --as <email> [--apply]'

/**
 * Read the command line.
 *
 * @param {string[]} argv The arguments after the script's name.
 * @returns {{file: string, email: string, apply: boolean}} What was asked.
 * @throws {Error} With {@link USAGE} for anything else.
 */
export function parseImportArgs(argv) {
  let file = null
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
    } else if (argument.startsWith('-') || file !== null) {
      throw new Error(`Unexpected argument ${JSON.stringify(argument)}.\n${USAGE}`)
    } else {
      file = argument
    }
  }

  if (!file || !email) throw new Error(USAGE)

  return { file, email: email.trim().toLowerCase(), apply }
}

/**
 * Run the command.
 *
 * @param {object} options Inputs.
 * @param {string[]} options.argv The arguments.
 * @param {object} options.prisma A Prisma client.
 * @param {{log: Function, error: Function}} [options.out] Where lines are written.
 * @param {Date} [options.now] The moment.
 * @param {Function} [options.apply] The apply function; `applyImport` (tests watch what it is sent).
 * @returns {Promise<object>} What was done: the run's view, and the apply's results.
 * @throws {Error} For an unknown or suspended account, one without `event:import`, or a file that cannot be imported.
 */
export async function runImportCommand(options) {
  const { argv, prisma, out = console, now = new Date(), apply: applyRun = applyImport } = options
  const { file, email, apply } = parseImportArgs(argv)
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) throw new Error(`No account is registered as ${email}.`)

  // The web refuses a suspended account on every request (`plugins/auth.js`);
  // so does this, before anything is planned in its name.
  if (user.suspendedAt) throw new Error('This account is suspended.')

  const memberships = await prisma.membership.findMany({ where: { userId: user.id } })
  const actor = toActor(user, memberships)

  if (!can(actor, CAPABILITIES.EVENT_IMPORT)) {
    throw new Error(`${email} may not import events; a platform administrator may.`)
  }

  let dataset

  try {
    dataset = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${error.message}`, { cause: error })
  }

  let run

  try {
    run = await previewImport(prisma, {
      fileName: path.basename(file),
      dataset,
      actor,
      via: 'cli',
      now,
    })
  } catch (error) {
    if (error?.code !== 'IMPORT_INVALID') throw error

    out.error(error.message)
    for (const problem of error.details?.problems ?? []) out.error(`  - ${problem}`)

    throw new Error('Nothing was imported.', { cause: error })
  }

  const view = await toRunView(prisma, run, now)

  out.log(`Planned ${view.rows.length} listings from ${view.fileName} (run ${view.id}):`)
  for (const row of view.rows) {
    out.log(`  ${row.action.padEnd(18)} ${row.sourceId.padEnd(12)} ${row.title}`)
    if (row.problem) out.log(`      ${row.problem}`)
    if (row.priceCount > 0) {
      const sold = row.soldOutCount > 0 ? `, ${row.soldOutCount} marked sold out (made closed)` : ''

      const types = row.priceCount === 1 ? 'ticket type' : 'ticket types'

      out.log(`      ${row.priceCount} ${types} in ${row.currency}${sold}`)
    }
    for (const note of row.importNotes) out.log(`      Note: ${note}`)
  }

  if (!apply) {
    out.log('Nothing was imported. Run again with --apply to import this plan.')

    return { view, results: null }
  }

  // Never `updateFromSource`: a posted event is updated only from the web,
  // with a second factor.
  const { results } = await applyRun(prisma, {
    run,
    actor,
    planDigest: run.planDigest,
    updateFromSource: [],
    via: 'cli',
    now,
  })

  const written = results.filter((result) => result.outcome === 'WRITTEN').length
  const refused = results.filter((result) => result.outcome === 'REFUSED')

  out.log(`Imported ${written} listings; ${refused.length} refused.`)
  for (const result of refused) out.log(`  ${result.sourceId}: ${result.code} ${result.message}`)
  out.log(
    'Imported events wait for review: approve and publish them on the import page in the web, with your second factor. Approving one puts its ticket types on sale.',
  )

  return { view, results }
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

  const failed = await runImportCommand({ argv: process.argv.slice(2), prisma }).then(
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
