/**
 * The committed OpenAPI artefact, and whether it still tells the truth.
 *
 * `openapi.json` is checked into the repository because it is the published
 * contract: clients read it, reviewers diff it, and a change to it is the
 * visible half of a change to the API. That only works if the committed file
 * matches what the route table would generate. Until this module existed it
 * did not have to:
 *
 *   - `pnpm contract:check` validated the route table against a document it
 *     generated from that same route table. The two always agreed, so the check
 *     was structurally incapable of noticing that the *file on disk* disagreed.
 *   - `pnpm build` ran the emitter, so a stale artefact was silently rewritten
 *     rather than reported. The only symptom was a dirty working tree, which is
 *     easy to commit past and easy to miss in CI.
 *
 * That was finding NF-06. The fix is this module plus two wiring changes: the
 * build now *checks* instead of writing, and `contract:check` runs the check.
 * Regenerating is a separate, explicit command — `pnpm openapi:emit` — because
 * the moment a check can fix itself it stops being a check.
 *
 * Two comparisons are made, and they answer different questions:
 *
 *   - **Semantic**: does the committed document describe the same API, ignoring
 *     key order? A route table reordered without changing any route is a
 *     semantic no-op, and saying so is more useful than "the bytes differ".
 *   - **Byte**: is the file exactly what the emitter would write? This catches
 *     hand-editing, a stale `info.version`, and formatting drift that a
 *     structural comparison would forgive.
 *
 * @module @desi-event/api/lib/openapi-artifact
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDocument } from '../plugins/docs.js'

/** The `apps/api` directory, resolved from this module rather than the cwd. */
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Where the committed artefact lives.
 *
 * Absolute, and derived from this file's location: a check that depends on the
 * working directory passes or fails depending on where it was run from, which
 * is the opposite of what a check is for.
 *
 * @type {string}
 */
export const ARTIFACT_PATH = resolve(APP_DIR, 'openapi.json')

/**
 * The version the artefact should report.
 *
 * Read from the manifest rather than `npm_package_version`, which is only set
 * when a package manager runs the script. Without this, `node
 * scripts/emit-openapi.mjs` and `pnpm openapi:emit` would write different
 * versions and the committed document would flip back and forth between them.
 *
 * @returns {Promise<string>} The version declared in `apps/api/package.json`.
 */
export async function artifactVersion() {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'package.json'), 'utf8'))

  return manifest.version
}

/**
 * Serialise a document exactly as the emitter writes it.
 *
 * One function so that the writer and the checker cannot disagree about
 * indentation or the trailing newline. If they disagreed, every build would
 * report drift and the check would be turned off within a week.
 *
 * @param {object} document An OpenAPI document.
 * @returns {string} The file contents, trailing newline included.
 */
export function serialiseArtifact(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * The document the route table currently describes.
 *
 * @param {object} [options] Options.
 * @param {string} [options.version] Override the version, for tests.
 * @returns {Promise<object>} A freshly generated OpenAPI document.
 */
export async function generateArtifact({ version } = {}) {
  return buildDocument({ version: version ?? (await artifactVersion()) })
}

/**
 * A value with every object key in sorted order, recursively.
 *
 * Used only for the semantic comparison. Arrays keep their order — the order of
 * a `tags` array or a `required` list is part of the document, and sorting
 * those would hide a real change.
 *
 * @param {unknown} value Any JSON value.
 * @returns {unknown} The same value with object keys sorted.
 */
export function canonicalise(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalise(item))

  if (!value || typeof value !== 'object') return value

  const sorted = {}

  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalise(/** @type {Record<string, unknown>} */ (value)[key])
  }

  return sorted
}

/**
 * Every operation in a document, as `METHOD /path` strings.
 *
 * The comparison reports these rather than a character offset, because "the
 * committed document is missing POST /v1/refunds" is actionable and "the files
 * differ at byte 214,882" is not.
 *
 * @param {object} document An OpenAPI document.
 * @returns {string[]} Sorted operation keys.
 */
export function operationKeys(document) {
  const keys = []

  for (const [path, item] of Object.entries(document?.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      keys.push(`${method.toUpperCase()} ${path}`)
    }
  }

  return keys.sort()
}

/**
 * Compare the committed artefact against what the route table would generate.
 *
 * Deliberately returns a verdict rather than throwing: the callers are a build
 * step and a test, and both want to describe the problem rather than propagate
 * a stack trace.
 *
 * @param {object} [options] Options.
 * @param {string} [options.path] Artefact path. Defaults to the committed one.
 * @param {string} [options.version] Version override, for tests.
 * @returns {Promise<{ok: boolean, reason: string|null, missing: string[], unexpected: string[], semantic: boolean, bytes: boolean}>} The verdict.
 */
export async function compareArtifact({ path = ARTIFACT_PATH, version } = {}) {
  const expected = await generateArtifact({ version })
  const expectedText = serialiseArtifact(expected)

  let actualText

  try {
    actualText = await readFile(path, 'utf8')
  } catch {
    return {
      ok: false,
      reason: `the committed artefact is missing: ${path}`,
      missing: operationKeys(expected),
      unexpected: [],
      semantic: false,
      bytes: false,
    }
  }

  let actual

  try {
    actual = JSON.parse(actualText)
  } catch (error) {
    return {
      ok: false,
      reason: `the committed artefact is not valid JSON: ${String(error?.message ?? error)}`,
      missing: [],
      unexpected: [],
      semantic: false,
      bytes: false,
    }
  }

  const bytes = actualText === expectedText
  const semantic = JSON.stringify(canonicalise(actual)) === JSON.stringify(canonicalise(expected))

  if (bytes) {
    return { ok: true, reason: null, missing: [], unexpected: [], semantic: true, bytes: true }
  }

  const expectedOps = new Set(operationKeys(expected))
  const actualOps = new Set(operationKeys(actual))
  const missing = [...expectedOps].filter((key) => !actualOps.has(key))
  const unexpected = [...actualOps].filter((key) => !expectedOps.has(key))

  // Three distinct failures, and the operator does something different in each
  // case, so they are named differently rather than folded into "it differs".
  const reason = semantic
    ? 'the committed artefact describes the same API but is not byte-identical — regenerate it'
    : missing.length || unexpected.length
      ? 'the committed artefact describes a different set of operations'
      : 'the committed artefact describes the same operations with different contents'

  return { ok: false, reason, missing, unexpected, semantic, bytes }
}
