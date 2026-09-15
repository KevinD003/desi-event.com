/**
 * The committed OpenAPI artefact must match the route table.
 *
 * This suite is the regression test for finding NF-06. The old check compared a
 * generated document against a document generated the same way, so it agreed
 * with itself no matter what was on disk. These tests assert the new check
 * disagrees with a wrong file — which is the only useful property a drift check
 * has.
 *
 * Each negative case writes its mutation to a temporary file rather than the
 * committed one. A test that edits a tracked artefact and restores it leaves a
 * window in which a crash commits the mutation; a temporary file has no window.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ARTIFACT_PATH,
  artifactVersion,
  canonicalise,
  compareArtifact,
  generateArtifact,
  operationKeys,
  serialiseArtifact,
} from '../src/lib/openapi-artifact.js'

/** A scratch directory for the mutated copies. */
let directory

/** The document the route table currently describes. */
let expected

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'desi-openapi-'))
  expected = await generateArtifact()
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

/**
 * Write a candidate artefact and compare it.
 *
 * @param {string} name File name within the scratch directory.
 * @param {string} contents Exactly what to write.
 * @returns {Promise<object>} The verdict.
 */
async function verdictFor(name, contents) {
  const path = join(directory, name)

  await writeFile(path, contents, 'utf8')

  return compareArtifact({ path })
}

describe('the committed artefact', () => {
  it('is byte-identical to what the route table generates', async () => {
    const verdict = await compareArtifact()

    expect(
      verdict.ok,
      `${ARTIFACT_PATH} is stale: ${verdict.reason}\n` +
        `missing: ${verdict.missing.join(', ') || 'none'}\n` +
        `unexpected: ${verdict.unexpected.join(', ') || 'none'}\n` +
        'Run `pnpm openapi:emit` and commit the result.',
    ).toBe(true)
  })

  it('reports the version from the manifest, not an environment variable', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    expect(await artifactVersion()).toBe(manifest.version)
    expect(expected.info.version).toBe(manifest.version)
  })

  it('describes every route in the contract', async () => {
    const { apiRoutes } = await import('@desi-event/api-contract')

    expect(operationKeys(expected)).toHaveLength(apiRoutes.length)
  })
})

describe('the drift check notices', () => {
  it('a removed operation', async () => {
    const mutated = structuredClone(expected)
    const [path] = Object.keys(mutated.paths)

    delete mutated.paths[path]

    const verdict = await verdictFor('removed.json', serialiseArtifact(mutated))

    expect(verdict.ok).toBe(false)
    expect(verdict.semantic).toBe(false)
    expect(verdict.missing.some((key) => key.endsWith(` ${path}`))).toBe(true)
  })

  it('an operation that exists only in the file', async () => {
    const mutated = structuredClone(expected)

    mutated.paths['/v1/invented'] = {
      get: { operationId: 'invented.get', responses: { 200: { description: 'nothing' } } },
    }

    const verdict = await verdictFor('invented.json', serialiseArtifact(mutated))

    expect(verdict.ok).toBe(false)
    expect(verdict.unexpected).toContain('GET /v1/invented')
  })

  it('a changed description, with the same operations', async () => {
    const mutated = structuredClone(expected)

    mutated.info.title = 'Something Else'

    const verdict = await verdictFor('retitled.json', serialiseArtifact(mutated))

    expect(verdict.ok).toBe(false)
    expect(verdict.semantic).toBe(false)
    expect(verdict.missing).toEqual([])
    expect(verdict.unexpected).toEqual([])
    expect(verdict.reason).toMatch(/same operations with different contents/)
  })

  it('a stale version', async () => {
    const mutated = structuredClone(expected)

    mutated.info.version = '0.0.0-stale'

    const verdict = await verdictFor('stale-version.json', serialiseArtifact(mutated))

    expect(verdict.ok).toBe(false)
  })

  it('reformatting that changes no meaning, and says so', async () => {
    // Minified: identical document, different bytes. The check has to fail —
    // the committed file is what clients read — but it must not claim the API
    // changed, because acting on that would waste somebody's afternoon.
    const verdict = await verdictFor('minified.json', `${JSON.stringify(expected)}\n`)

    expect(verdict.ok).toBe(false)
    expect(verdict.bytes).toBe(false)
    expect(verdict.semantic).toBe(true)
    expect(verdict.reason).toMatch(/same API but is not byte-identical/)
  })

  it('a missing trailing newline', async () => {
    const verdict = await verdictFor('no-newline.json', JSON.stringify(expected, null, 2))

    expect(verdict.ok).toBe(false)
    expect(verdict.semantic).toBe(true)
  })

  it('a file that is not JSON at all', async () => {
    const verdict = await verdictFor('garbage.json', 'this is not a document\n')

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/not valid JSON/)
  })

  it('a file that does not exist', async () => {
    const verdict = await compareArtifact({ path: join(directory, 'absent.json') })

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/missing/)
    expect(verdict.missing.length).toBeGreaterThan(0)
  })
})

describe('canonicalisation', () => {
  it('sorts object keys so key order is not mistaken for a change', () => {
    expect(JSON.stringify(canonicalise({ b: 1, a: 2 }))).toBe(JSON.stringify({ a: 2, b: 1 }))
  })

  it('preserves array order, because an array order is part of the document', () => {
    expect(canonicalise({ tags: ['b', 'a'] })).toEqual({ tags: ['b', 'a'] })
  })

  it('recurses into nested objects inside arrays', () => {
    expect(JSON.stringify(canonicalise([{ z: 1, y: 2 }]))).toBe(JSON.stringify([{ y: 2, z: 1 }]))
  })
})
