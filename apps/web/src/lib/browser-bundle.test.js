/**
 * What the browser is given, checked at the import graph rather than the bundle.
 *
 * Finding NF-15 shipped the platform's password hashing to every visitor and
 * crashed the checkout page, and nothing in the repository noticed either half.
 * These tests are that missing notice. They walk the real import graph from the
 * files a browser actually loads and fail with the chain named, so the next
 * time somebody imports a barrel for one constant the failure says which
 * constant and which barrel.
 *
 * @module lib/browser-bundle.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN,
  forbiddenReason,
  reachableFrom,
  resolveSpecifier,
  specifiersIn,
} from './browser-bundle.js'

/** The workspace root. */
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../../..')

/**
 * Every file under a directory, recursively.
 *
 * @param {string} directory A repo-relative directory.
 * @returns {string[]} Repo-relative file paths.
 */
function filesUnder(directory) {
  const found = []

  for (const entry of readdirSync(resolve(ROOT, directory))) {
    const path = join(directory, entry)

    if (statSync(resolve(ROOT, path)).isDirectory()) {
      found.push(...filesUnder(path))
      continue
    }

    found.push(path)
  }

  return found
}

/**
 * Every module a browser loads: the client components, and what the pages hand
 * them.
 *
 * Derived by reading the `'use client'` directive rather than from a list, so a
 * component added tomorrow is covered without anybody remembering to add it
 * here — which is the failure mode that let NF-15 through in the first place.
 *
 * @returns {string[]} Repo-relative entry points.
 */
function browserEntryPoints() {
  const sources = filesUnder('apps/web/src').filter(
    (file) => (file.endsWith('.js') || file.endsWith('.jsx')) && !file.includes('.test.'),
  )

  return sources.filter((file) => {
    const head = readFileSync(resolve(ROOT, file), 'utf8').slice(0, 200)

    return /^\s*['"]use client['"]/m.test(head)
  })
}

describe('what reaches the browser', () => {
  it('finds the client components rather than trusting a list', () => {
    const entries = browserEntryPoints()

    expect(entries.length).toBeGreaterThan(3)
    expect(entries).toContain('apps/web/src/components/checkout-basket.jsx')
  })

  it('gives the browser nothing it must not have', () => {
    // The whole finding in one assertion. `api-client.js` is included as an
    // entry point in its own right: it is imported by client components and is
    // the exact path NF-15 travelled.
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']
    const reached = reachableFrom(entries)

    const leaks = [...reached]
      .map(([file, chain]) => ({ file, chain, reason: forbiddenReason(file) }))
      .filter((candidate) => candidate.reason)

    expect(
      leaks.map((leak) => `${leak.file}\n  reached by: ${leak.chain.join(' -> ')}\n  ${leak.reason}`),
    ).toEqual([])
  })

  it('reaches the contract client, so the walk is really walking', () => {
    // A guard that silently reaches nothing would pass forever. This asserts
    // the walk arrives where it should before the assertion above means much.
    const reached = reachableFrom(['apps/web/src/lib/api-client.js'])

    expect([...reached.keys()]).toContain('packages/api-contract/src/index.js')
    expect([...reached.keys()]).toContain('packages/api-contract/src/client.js')
  })

  it('would catch the defect it was written for', () => {
    // The adversarial half: feed the walker the module that leaked and confirm
    // it is still recognised. Without this, a later edit to FORBIDDEN could
    // empty the rule set and every other test here would still pass.
    const reached = reachableFrom(['packages/api-contract/src/validate.js'])

    expect(forbiddenReason('packages/auth/src/password.js')).toMatch(/scrypt/)
    expect(forbiddenReason('packages/auth/src/index.js')).toMatch(/barrel/)
    // And the fixed module no longer arrives there.
    expect([...reached.keys()]).not.toContain('packages/auth/src/index.js')
  })

  it('names a reason for every rule, so a refusal can be acted on', () => {
    for (const [prefix, reason] of Object.entries(FORBIDDEN)) {
      expect(reason.length, prefix).toBeGreaterThan(20)
    }
  })
})

describe('the walker itself', () => {
  it('sees static imports, re-exports and dynamic imports', () => {
    const source = [
      "import { a } from './a.js'",
      "export * from './b.js'",
      "export { c } from './c.js'",
      "const d = await import('./d.js')",
      "import x from '@desi-event/auth'",
    ].join('\n')

    expect(specifiersIn(source)).toEqual([
      './a.js',
      './b.js',
      './c.js',
      './d.js',
      '@desi-event/auth',
    ])
  })

  it('resolves a workspace subpath the way an exports map does', () => {
    expect(resolveSpecifier('@desi-event/auth/sessions', 'packages/api-contract/src/validate.js')).toBe(
      'packages/auth/src/sessions.js',
    )
    expect(resolveSpecifier('@desi-event/auth', 'packages/api-contract/src/validate.js')).toBe(
      'packages/auth/src/index.js',
    )
  })

  it('resolves a relative specifier against the importing file', () => {
    expect(resolveSpecifier('./client.js', 'packages/api-contract/src/index.js')).toBe(
      'packages/api-contract/src/client.js',
    )
  })

  it('ignores a third-party specifier, which is not its problem', () => {
    expect(resolveSpecifier('react', 'apps/web/src/components/ui.jsx')).toBeNull()
    expect(resolveSpecifier('zod', 'packages/schemas/src/index.js')).toBeNull()
  })

  it('uses no computed import specifier anywhere a browser can reach', () => {
    // The walker reads source text, so a specifier built at runtime would be
    // invisible to it. This asserts the assumption rather than hoping.
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']

    for (const file of reachableFrom(entries).keys()) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')

      expect(source, `${file} builds an import specifier at runtime`).not.toMatch(
        /import\(\s*(?!['"])[^)]/,
      )
    }
  })

  it('walks from a real path rather than the working directory', () => {
    // A guard that depends on the cwd passes in one runner and fails in another.
    expect(relative(ROOT, resolve(ROOT, 'apps/web'))).toBe('apps/web')
  })
})
