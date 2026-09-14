#!/usr/bin/env node
/**
 * Desi-Event language policy enforcement.
 *
 * The repository is JavaScript-only (see `docs/language-policy.md`). Written
 * rules drift; this script is the executable version of them and runs in CI and
 * from `pnpm verify`.
 *
 * It fails the build when it finds:
 *   1. TypeScript sources, declarations or configuration.
 *   2. TypeScript-specific tooling in any package manifest.
 *   3. Hand-written standalone `.html` application pages.
 *   4. jQuery or other DOM-manipulation-as-architecture dependencies.
 *   5. Source files in another programming language that are not registered in
 *      `docs/language-exceptions.json` with the documentation Rule 21 requires.
 *
 * Usage:
 *   node scripts/check-language-policy.mjs [--json]
 */

import { readFile, readdir, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Directories never scanned: dependencies, build output and generated code. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  'playwright-report',
  'test-results',
  '.pnpm-store',
])

/** TypeScript source and declaration extensions. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/**
 * Configuration files that only exist to serve a TypeScript toolchain.
 *
 * A pattern rather than a list of names: projects routinely carry
 * `tsconfig.app.json`, `tsconfig.spec.json`, `tsconfig.vitest.json` and others,
 * and an exact-match list quietly lets every variant through.
 */
const TYPESCRIPT_CONFIG_PATTERN = /^tsconfig(\..+)?\.json$/

/**
 * Dependency names that pull a TypeScript toolchain into the repository.
 * Prefix entries match any package beginning with that string.
 */
const FORBIDDEN_DEPENDENCIES = [
  { match: 'typescript', reason: 'the TypeScript compiler' },
  { match: 'ts-node', reason: 'a TypeScript runtime' },
  { match: 'tsx', reason: 'a TypeScript runtime' },
  { match: 'ts-jest', reason: 'a TypeScript test transformer' },
  { match: 'tsup', reason: 'a TypeScript bundler' },
  { match: 'typedoc', reason: 'a TypeScript documentation generator' },
  { match: 'ttypescript', reason: 'a TypeScript compiler wrapper' },
  { prefix: '@typescript-eslint/', reason: 'TypeScript-specific lint tooling' },
  // The ESLint 9 flat-config package that supersedes @typescript-eslint/*.
  // Catching only the scoped names would miss the modern spelling entirely.
  { match: 'typescript-eslint', reason: 'TypeScript-specific lint tooling' },
  { match: '@tsconfig/node22', reason: 'shared TypeScript compiler configuration' },
  { prefix: '@tsconfig/', reason: 'shared TypeScript compiler configuration' },
  { prefix: '@types/', reason: 'hand-installed TypeScript declaration packages' },
  { match: 'jquery', reason: 'DOM manipulation as application architecture' },
  { match: '@types/jquery', reason: 'jQuery type declarations' },
  { match: 'backbone', reason: 'a non-React UI architecture' },
]

/**
 * Non-JavaScript source extensions. Presence is not automatically a failure:
 * Rule 7 permits other languages, but Rule 21 requires each one to be
 * registered with a documented justification.
 */
const OTHER_LANGUAGE_EXTENSIONS = new Map([
  ['.py', 'Python'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.kts', 'Kotlin'],
  ['.swift', 'Swift'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.cs', 'C#'],
  ['.rb', 'Ruby'],
  ['.php', 'PHP'],
  ['.scala', 'Scala'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
])

/** Fields Rule 21 requires before another language may enter the repository. */
const REQUIRED_EXCEPTION_FIELDS = [
  'id',
  'language',
  'paths',
  'reason',
  'owner',
  'deployment',
  'securityBoundary',
  'operationalCost',
  'integrationContract',
  'approvedOn',
]

/**
 * `.html` files that are legitimately not hand-written application pages:
 * fixtures and tooling templates. Framework-generated HTML never lands in the
 * repository, so this list stays short.
 */
const ALLOWED_HTML_PATHS = new Set([])

/**
 * Recursively collect every file path in the repository, skipping dependency
 * and build directories.
 *
 * Only used when the repository is not a git checkout. Symlinked entries are
 * followed as files rather than silently dropped: a symlink named `app.ts` is
 * still TypeScript in the tree.
 *
 * @param {string} directory Absolute directory to walk.
 * @param {string[]} [collected] Accumulator.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function walk(directory, collected = []) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)

    if (entry.isSymbolicLink()) {
      const target = await lstat(absolute).catch(() => null)
      if (target) collected.push(absolute)
      continue
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await walk(absolute, collected)
      continue
    }

    if (entry.isFile()) collected.push(absolute)
  }

  return collected
}

/**
 * List the files git knows about: everything committed, plus everything
 * untracked that is not ignored.
 *
 * This is the set the policy actually governs. Walking the filesystem meant
 * skipping directories by name — `build`, `dist`, `generated`, `coverage` —
 * which is fine for throwaway output but means a committed
 * `packages/thing/build/index.ts` was never looked at. Asking git removes the
 * guesswork: ignored build output is excluded because it is ignored, and
 * anything committed is checked no matter what the directory is called.
 *
 * @returns {string[] | null} Absolute paths, or `null` when this is not a git checkout.
 */
function gitFiles() {
  try {
    const stdout = execFileSync(
      'git',
      ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    )

    const files = stdout
      .split('\0')
      .filter(Boolean)
      .map((relative) => path.join(repoRoot, relative))
      .filter((absolute) => existsSync(absolute))

    return files.length > 0 ? files : null
  } catch {
    return null
  }
}

/**
 * Collect the files to check, preferring git's view of the repository.
 *
 * @returns {Promise<{files: string[], source: string}>} The file list and how it was obtained.
 */
async function collectFiles() {
  const tracked = gitFiles()

  if (tracked) return { files: tracked, source: 'git' }

  return { files: await walk(repoRoot), source: 'filesystem' }
}

/**
 * Load the registry of approved non-JavaScript components.
 *
 * @returns {Promise<{exceptions: object[]}>} Parsed registry, empty when absent.
 */
async function loadExceptions() {
  const registryPath = path.join(repoRoot, 'docs', 'language-exceptions.json')

  if (!existsSync(registryPath)) return { exceptions: [] }

  const raw = await readFile(registryPath, 'utf8')

  try {
    const parsed = JSON.parse(raw)
    return { exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [] }
  } catch (error) {
    throw new Error(`docs/language-exceptions.json is not valid JSON: ${error.message}`)
  }
}

/**
 * Decide whether a repository-relative path is covered by a registry entry.
 *
 * @param {string} relativePath Path relative to the repository root.
 * @param {object[]} exceptions Registry entries.
 * @returns {object | undefined} The covering entry, if any.
 */
function findCoveringException(relativePath, exceptions) {
  return exceptions.find((entry) =>
    (entry.paths ?? []).some(
      (prefix) => relativePath === prefix || relativePath.startsWith(prefix),
    ),
  )
}

/**
 * Inspect every package manifest for forbidden tooling.
 *
 * @param {string[]} files All repository files.
 * @returns {Promise<string[]>} Violation messages.
 */
async function checkManifests(files) {
  const violations = []
  const manifests = files.filter((file) => path.basename(file) === 'package.json')

  for (const manifest of manifests) {
    const relative = path.relative(repoRoot, manifest)
    let parsed

    try {
      parsed = JSON.parse(await readFile(manifest, 'utf8'))
    } catch (error) {
      violations.push(`${relative}: not valid JSON (${error.message})`)
      continue
    }

    const dependencyNames = new Set()
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const name of Object.keys(parsed[field] ?? {})) dependencyNames.add(name)
    }

    for (const name of dependencyNames) {
      const rule = FORBIDDEN_DEPENDENCIES.find((candidate) =>
        candidate.prefix ? name.startsWith(candidate.prefix) : name === candidate.match,
      )

      if (rule) {
        violations.push(
          `${relative}: depends on "${name}" — ${rule.reason} is prohibited by the language policy.`,
        )
      }
    }
  }

  return violations
}

/**
 * Run every policy check.
 *
 * @returns {Promise<{violations: string[], scanned: number, notes: string[]}>} Result summary.
 */
async function runChecks() {
  const { files, source } = await collectFiles()
  const { exceptions } = await loadExceptions()
  const violations = []
  const notes = []

  for (const absolute of files) {
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
    // Compared in lower case throughout. Linux filesystems are case-sensitive,
    // so `Sneaky.TS` is a perfectly valid filename that an extension list
    // written in lower case would wave straight through — and it is still
    // TypeScript. macOS and Windows would additionally treat it as the same
    // file as `sneaky.ts`, so a repository checked out on either would hide the
    // problem entirely.
    const base = path.basename(absolute).toLowerCase()
    const extension = path.extname(absolute).toLowerCase()

    // 1. TypeScript sources and declarations. `.d.ts` ends in `.ts` and is
    // caught here too; it is named separately in the message because a hand
    // written declaration file is a different mistake from a hand written
    // source file.
    if (TYPESCRIPT_EXTENSIONS.has(extension)) {
      violations.push(
        base.endsWith('.d.ts')
          ? `${relative}: hand-written TypeScript declaration files are prohibited. Describe shapes with JSDoc @typedef instead.`
          : `${relative}: TypeScript source files are prohibited. Use .js, .mjs, .cjs or .jsx with JSDoc and Zod.`,
      )
      continue
    }

    // 2. TypeScript configuration.
    if (TYPESCRIPT_CONFIG_PATTERN.test(base)) {
      violations.push(`${relative}: TypeScript configuration is prohibited.`)
      continue
    }

    // 3. Hand-written standalone HTML application pages.
    if (extension === '.html' && !ALLOWED_HTML_PATHS.has(relative)) {
      violations.push(
        `${relative}: standalone .html pages are prohibited. Build pages as React components and JSX.`,
      )
      continue
    }

    // 4. Other programming languages need a documented exception.
    if (OTHER_LANGUAGE_EXTENSIONS.has(extension)) {
      const language = OTHER_LANGUAGE_EXTENSIONS.get(extension)
      const covering = findCoveringException(relative, exceptions)

      if (!covering) {
        violations.push(
          `${relative}: ${language} source is present but not registered in docs/language-exceptions.json. ` +
            'Rule 21 requires reason, ownership, deployment, security boundary and operational cost to be documented first.',
        )
        continue
      }

      const missing = REQUIRED_EXCEPTION_FIELDS.filter((field) => {
        const value = covering[field]
        return (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        )
      })

      if (missing.length > 0) {
        violations.push(
          `${relative}: language exception "${covering.id ?? covering.language}" is missing required field(s): ${missing.join(', ')}.`,
        )
        continue
      }

      notes.push(
        `${relative}: ${language} permitted under exception "${covering.id ?? covering.language}".`,
      )
    }
  }

  violations.push(...(await checkManifests(files)))

  return { violations, scanned: files.length, notes, source }
}

const asJson = process.argv.includes('--json')

try {
  const { violations, scanned, notes, source } = await runChecks()

  if (asJson) {
    console.log(
      JSON.stringify({ ok: violations.length === 0, scanned, source, violations, notes }, null, 2),
    )
  } else if (violations.length === 0) {
    console.log(`Language policy: OK — ${scanned} files scanned via ${source}, no violations.`)
    for (const note of notes) console.log(`  note: ${note}`)
  } else {
    console.error(`Language policy: ${violations.length} violation(s) across ${scanned} files.\n`)
    for (const violation of violations) console.error(`  ✗ ${violation}`)
    console.error('\nSee docs/language-policy.md for the rules and the exception process.')
  }

  process.exit(violations.length === 0 ? 0 : 1)
} catch (error) {
  console.error(`Language policy check failed to run: ${error.message}`)
  process.exit(2)
}
