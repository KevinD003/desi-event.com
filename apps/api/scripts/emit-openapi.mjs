#!/usr/bin/env node
/**
 * Emit — or check — `openapi.json`.
 *
 * Two modes, and which one runs where is the point of finding NF-06:
 *
 *   - `--check` (what `pnpm build` and `pnpm contract:check` run) compares the
 *     committed artefact against what the route table would generate and fails
 *     if they disagree. It never writes.
 *   - the default (what `pnpm openapi:emit` runs) regenerates the file.
 *
 * Before this split, the build *emitted*, so a stale committed document was
 * silently overwritten and the only trace was a dirty working tree. A check
 * that repairs what it is checking reports nothing, which is how a published
 * contract drifts from the API it claims to describe.
 *
 * The contract is structurally validated first in both modes: a duplicate route
 * id, a colliding path or an unrepresentable schema should fail as itself, not
 * as a confusing diff.
 *
 * @module @desi-event/api/scripts/emit-openapi
 */

import { writeFile } from 'node:fs/promises'
import process from 'node:process'

import { assertContractValid } from '@desi-event/api-contract'

import {
  ARTIFACT_PATH,
  compareArtifact,
  generateArtifact,
  serialiseArtifact,
} from '../src/lib/openapi-artifact.js'

/**
 * How many operations a document describes.
 *
 * @param {object} document An OpenAPI document.
 * @returns {number} The operation count.
 */
function countOperations(document) {
  return Object.values(document.paths ?? {}).reduce(
    (count, item) => count + Object.keys(item ?? {}).length,
    0,
  )
}

/**
 * Generate the document and write it to disk.
 *
 * @param {object} [options] Emit options.
 * @param {string} [options.outFile] Absolute path to write to. Defaults to the committed artefact.
 * @param {string} [options.version] Version reported in `info.version`. Defaults to this package's version.
 * @returns {Promise<{outFile: string, operations: number}>} Where the document was written and how many operations it describes.
 * @throws {Error} When the contract does not validate.
 */
export async function emitOpenApi(options = {}) {
  const { outFile = ARTIFACT_PATH } = options

  assertContractValid()

  const document = await generateArtifact({ version: options.version })

  await writeFile(outFile, serialiseArtifact(document), 'utf8')

  return { outFile, operations: countOperations(document) }
}

/**
 * Check the committed artefact without touching it.
 *
 * @param {object} [options] Check options.
 * @param {string} [options.path] Artefact path.
 * @param {string} [options.version] Version override.
 * @returns {Promise<object>} The verdict from `compareArtifact`.
 * @throws {Error} When the contract does not validate.
 */
export async function checkOpenApi(options = {}) {
  assertContractValid()

  return compareArtifact(options)
}

/**
 * Run as a command.
 *
 * @param {string[]} argv Arguments, excluding node and the script path.
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv) {
  if (argv.includes('--check')) {
    const verdict = await checkOpenApi()

    if (verdict.ok) {
      console.log(`✓ ${ARTIFACT_PATH} is up to date with the route contract.`)
      return 0
    }

    console.error(`✗ the committed OpenAPI artefact is stale:\n\n  ${verdict.reason}\n`)

    for (const key of verdict.missing) console.error(`  missing from the file:  ${key}`)
    for (const key of verdict.unexpected) console.error(`  in the file only:       ${key}`)

    console.error('\nRun `pnpm openapi:emit` and commit the result.')

    return 1
  }

  const { outFile, operations } = await emitOpenApi()

  console.log(`Wrote ${operations} operations to ${outFile}`)

  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2))
}
