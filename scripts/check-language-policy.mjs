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

import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

/** Configuration files that only exist to serve a TypeScript toolchain. */
const TYPESCRIPT_CONFIG_FILES = new Set([
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.build.json',
  'tsconfig.node.json',
  'tsconfig.eslint.json',
])

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
 * @param {string} directory Absolute directory to walk.
 * @param {string[]} [collected] Accumulator.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function walk(directory, collected = []) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)

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
    (entry.paths ?? []).some((prefix) => relativePath === prefix || relativePath.startsWith(prefix)),
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
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
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
  const files = await walk(repoRoot)
  const { exceptions } = await loadExceptions()
  const violations = []
  const notes = []

  for (const absolute of files) {
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
    const base = path.basename(absolute)
    const extension = path.extname(absolute)

    // 1. TypeScript sources and declarations.
    if (TYPESCRIPT_EXTENSIONS.has(extension)) {
      violations.push(
        `${relative}: TypeScript source files are prohibited. Use .js, .mjs, .cjs or .jsx with JSDoc and Zod.`,
      )
      continue
    }

    // 2. TypeScript configuration.
    if (TYPESCRIPT_CONFIG_FILES.has(base)) {
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
        return value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0)
      })

      if (missing.length > 0) {
        violations.push(
          `${relative}: language exception "${covering.id ?? covering.language}" is missing required field(s): ${missing.join(', ')}.`,
        )
        continue
      }

      notes.push(`${relative}: ${language} permitted under exception "${covering.id ?? covering.language}".`)
    }
  }

  violations.push(...(await checkManifests(files)))

  return { violations, scanned: files.length, notes }
}

const asJson = process.argv.includes('--json')

try {
  const { violations, scanned, notes } = await runChecks()

  if (asJson) {
    console.log(JSON.stringify({ ok: violations.length === 0, scanned, violations, notes }, null, 2))
  } else if (violations.length === 0) {
    console.log(`Language policy: OK — ${scanned} files scanned, no violations.`)
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
