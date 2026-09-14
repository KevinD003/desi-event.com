#!/usr/bin/env node
/**
 * Emit `openapi.json` from the route contract.
 *
 * Wired to both `pnpm build` and `pnpm openapi:emit`, so the published document
 * is a build artefact rather than a file somebody remembers to regenerate. The
 * contract is structurally validated first: a route with a duplicate id, a
 * colliding path or an unrepresentable schema fails the build here instead of
 * producing a document that lies.
 *
 * @module @desi-event/api/scripts/emit-openapi
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertContractValid } from '@desi-event/api-contract'

import { buildDocument } from '../src/plugins/docs.js'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read this package's version from its manifest.
 *
 * @returns {Promise<string>} The version string declared in package.json.
 */
async function packageVersion() {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'package.json'), 'utf8'))

  return manifest.version
}

/**
 * Generate the document and write it to disk.
 *
 * @param {object} [options] Emit options.
 * @param {string} [options.outFile] Absolute path to write to. Defaults to `openapi.json` in the app directory.
 * @param {string} [options.version] Version reported in `info.version`. Defaults to this package's version.
 * @returns {Promise<{outFile: string, operations: number}>} Where the document was written and how many operations it describes.
 * @throws {Error} When the contract does not validate.
 */
export async function emitOpenApi(options = {}) {
  const { outFile = resolve(APP_DIR, 'openapi.json') } = options

  // Read the manifest rather than trusting `npm_package_version`: that variable
  // is only set when a package manager runs the script, so `node
  // scripts/emit-openapi.mjs` would otherwise emit a different version than
  // `pnpm build` and the committed document would flip back and forth.
  const version = options.version ?? (await packageVersion())

  assertContractValid()

  const document = buildDocument({ version })
  const operations = Object.values(document.paths).reduce(
    (count, item) => count + Object.keys(item).length,
    0,
  )

  await writeFile(outFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  return { outFile, operations }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  emitOpenApi()
    .then(({ outFile, operations }) => {
      console.log(`Wrote ${operations} operations to ${outFile}`)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
