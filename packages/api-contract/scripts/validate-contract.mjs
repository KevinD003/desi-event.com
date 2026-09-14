#!/usr/bin/env node
/**
 * Fail the build when the API contract is incoherent.
 *
 * Wired to `pnpm --filter @desi-event/api-contract validate`. Run it in CI
 * before anything is generated from the route table: a duplicated id, two
 * routes on one method+path, a missing schema or a document that does not meet
 * OpenAPI 3.1 all stop here rather than reaching a client.
 *
 * Exit codes: 0 valid, 1 invalid, 2 the contract could not even be loaded.
 *
 * @module @desi-event/api-contract/scripts/validate-contract
 */

import process from 'node:process'
import { writeFile } from 'node:fs/promises'

/**
 * Parse the command line.
 *
 * @param {string[]} argv Raw arguments, excluding node and the script path.
 * @returns {{json: boolean, out: string|null}} Parsed flags.
 */
function parseArgs(argv) {
  let json = false
  let out = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--json') json = true
    else if (arg === '--out') {
      out = argv[index + 1] ?? null
      index += 1
    } else if (arg.startsWith('--out=')) out = arg.slice('--out='.length)
  }

  return { json, out }
}

/**
 * Validate the contract and report the outcome on stdout/stderr.
 *
 * @param {string[]} [argv] Command-line arguments.
 * @returns {Promise<number>} The process exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const { json, out } = parseArgs(argv)

  let validateContract
  let apiRoutes

  try {
    const contract = await import('../src/index.js')
    validateContract = contract.validateContract
    apiRoutes = contract.apiRoutes
  } catch (error) {
    console.error('Could not load @desi-event/api-contract:')
    console.error(error?.stack ?? error)
    return 2
  }

  const result = validateContract()

  if (json) {
    console.log(JSON.stringify({ ok: result.ok, routeCount: result.routeCount, issues: result.issues }, null, 2))
  }

  if (!result.ok) {
    console.error(`✗ API contract is invalid — ${result.issues.length} issue(s):\n`)

    for (const issue of result.issues) {
      const where = issue.routeId ? ` (${issue.routeId})` : ''
      console.error(`  [${issue.code}]${where} ${issue.message}`)
    }

    console.error('\nFix packages/api-contract/src/routes.js and run this again.')
    return 1
  }

  if (out && result.document) {
    await writeFile(out, `${JSON.stringify(result.document, null, 2)}\n`, 'utf8')
    console.log(`  wrote ${out}`)
  }

  const operations = Object.values(result.document.paths).reduce(
    (total, item) => total + Object.keys(item).length,
    0,
  )

  if (!json) {
    console.log(
      `✓ API contract is valid: ${apiRoutes.length} routes, ${operations} OpenAPI operations, ` +
        `${Object.keys(result.document.paths).length} paths.`,
    )
  }

  return 0
}

process.exitCode = await main()
