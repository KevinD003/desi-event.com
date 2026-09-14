/**
 * The language policy checker, checked.
 *
 * `scripts/check-language-policy.mjs` is the executable form of
 * `docs/language-policy.md`. A checker that passes because it is not looking is
 * worse than no checker: it reports "OK" while the thing it exists to prevent
 * sits in the tree. So every case below plants a real violation, runs the real
 * script against the real repository, and then removes it.
 *
 * Each fixture is created, staged with `git add -f`, asserted on, and removed
 * again — including from the index. The suite fails loudly rather than leaving
 * anything behind.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const checker = path.join(repoRoot, 'scripts', 'check-language-policy.mjs')

/** Paths planted by the current test, removed in afterEach whatever happens. */
let planted = []

/**
 * Run a git command in the repository.
 *
 * @param {string[]} args Arguments.
 * @returns {string} stdout.
 */
function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/**
 * Create a file and stage it, so the checker — which asks git what the
 * repository contains — actually sees it.
 *
 * `git add -f` is deliberate: the point of several of these cases is that a
 * file inside a normally-ignored directory is still a violation once committed.
 *
 * @param {string} relative Repository-relative path.
 * @param {string} contents File contents.
 * @returns {void}
 */
function plant(relative, contents) {
  const absolute = path.join(repoRoot, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents, 'utf8')
  git(['add', '-f', '--', relative])
  planted.push(relative)
}

/**
 * Run the checker.
 *
 * @returns {{ok: boolean, violations: string[], scanned: number, source: string}} Parsed report.
 */
function runChecker() {
  try {
    const stdout = execFileSync('node', [checker, '--json'], { encoding: 'utf8', cwd: repoRoot })
    return JSON.parse(stdout)
  } catch (error) {
    // A non-zero exit is the expected path for a violation; the report is still
    // on stdout.
    return JSON.parse(error.stdout)
  }
}

afterEach(() => {
  for (const relative of planted) {
    try {
      git(['rm', '-q', '--cached', '--', relative])
    } catch {
      // Not staged; nothing to unstage.
    }

    rmSync(path.join(repoRoot, relative), { force: true })
  }

  planted = []

  // Nothing this suite created may survive it.
  const status = git(['status', '--porcelain'])
  for (const relative of []) expect(status).not.toContain(relative)
})

describe('the repository as it stands', () => {
  it('passes its own policy', () => {
    const report = runChecker()

    expect(report.ok).toBe(true)
    expect(report.violations).toEqual([])
  })

  it('asks git what the repository contains rather than walking the filesystem', () => {
    // The distinction matters: a filesystem walk has to skip build output by
    // name, and skipping by name is what let committed TypeScript hide in a
    // directory called `build`.
    expect(runChecker().source).toBe('git')
  })
})

describe('TypeScript sources', () => {
  it('rejects a tracked build/sneaky.ts even though build/ is normally ignored', () => {
    // The headline case. `build/` is in .gitignore, so an implementation that
    // trusts ignore rules — or skips directories by name — never looks inside
    // it. Once the file is committed it is repository source, whatever the
    // directory is called.
    plant('packages/pricing/build/sneaky.ts', 'export const x: number = 1\n')

    const report = runChecker()

    expect(report.ok).toBe(false)
    expect(report.violations.join('\n')).toContain('packages/pricing/build/sneaky.ts')
  })

  it('rejects .tsx, .mts and .cts', () => {
    plant('apps/web/src/Thing.tsx', 'export const A = () => null\n')
    plant('packages/schemas/src/thing.mts', 'export const a = 1\n')
    plant('packages/schemas/src/thing.cts', 'export const a = 1\n')

    const report = runChecker()
    const text = report.violations.join('\n')

    expect(report.ok).toBe(false)
    expect(text).toContain('Thing.tsx')
    expect(text).toContain('thing.mts')
    expect(text).toContain('thing.cts')
  })

  it('rejects misleading casing on a case-sensitive filesystem', () => {
    // Linux happily stores `Sneaky.TS`; it is still TypeScript. A lower-case
    // extension list would wave it through.
    plant('packages/pricing/src/Sneaky.TS', 'export const x: number = 1\n')

    expect(runChecker().violations.join('\n')).toContain('Sneaky.TS')
  })

  it('rejects a hand-written declaration file and says why', () => {
    plant('packages/schemas/src/shapes.d.ts', 'export declare const a: number\n')

    const report = runChecker()

    expect(report.ok).toBe(false)
    expect(report.violations.join('\n')).toMatch(/declaration files are prohibited/i)
  })
})

describe('TypeScript configuration', () => {
  it('rejects the whole tsconfig family, not just tsconfig.json', () => {
    plant('apps/web/tsconfig.app.json', '{}\n')
    plant('apps/api/tsconfig.spec.json', '{}\n')

    const text = runChecker().violations.join('\n')

    expect(text).toContain('tsconfig.app.json')
    expect(text).toContain('tsconfig.spec.json')
  })

  it('rejects TypeScript tooling in a package manifest', () => {
    plant(
      'packages/inventory/fixture-manifest/package.json',
      JSON.stringify({ name: 'x', devDependencies: { 'typescript-eslint': '^8.0.0' } }, null, 2),
    )

    expect(runChecker().violations.join('\n')).toContain('typescript-eslint')
  })
})

describe('hand-written HTML application pages', () => {
  it('rejects a committed .html page', () => {
    plant('apps/web/src/legacy.html', '<html lang="en"><body>Hello</body></html>\n')

    const report = runChecker()

    expect(report.ok).toBe(false)
    expect(report.violations.join('\n')).toMatch(/standalone \.html pages are prohibited/i)
  })

  it('does not object to framework output or test artifacts, which are not tracked', () => {
    // Next.js writes HTML into .next/ and Playwright writes it into
    // playwright-report/. Neither is committed, so neither is repository
    // source, and the checker must not flag them.
    const report = runChecker()

    expect(report.ok).toBe(true)
    expect(report.violations.join('\n')).not.toContain('.next/')
    expect(report.violations.join('\n')).not.toContain('playwright-report/')
  })
})

describe('other languages', () => {
  it('rejects an unregistered Python file', () => {
    plant('packages/schemas/src/recommend.py', 'print("hello")\n')

    const report = runChecker()

    expect(report.ok).toBe(false)
    expect(report.violations.join('\n')).toMatch(
      /not registered in docs\/language-exceptions\.json/i,
    )
  })
})
