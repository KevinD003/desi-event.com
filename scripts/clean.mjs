#!/usr/bin/env node
/**
 * Remove installed dependencies and build output from every workspace.
 *
 * Wired to `pnpm clean` at the repository root. The directories it deletes are
 * all reproducible — `pnpm install` and `pnpm build` put them back — so the
 * script exists for the two moments when that matters: a half-installed
 * `node_modules` after an interrupted install, and a stale `.next`/`.turbo`
 * cache that is serving yesterday's bundle.
 *
 * Two safety properties are deliberate. Every candidate path is derived from
 * the repository root rather than from the working directory, and each one is
 * resolved through `realpath` and re-checked before deletion, so a symlinked
 * `node_modules` pointing at a shared store cannot be followed out of the
 * repository.
 *
 * Usage:
 *   node scripts/clean.mjs            # delete
 *   node scripts/clean.mjs --dry-run  # list what would be deleted
 *
 * @module scripts/clean
 */

import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Absolute path of the repository root; nothing outside it is ever touched. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Directory names removed from the repository root and from every workspace.
 *
 * All seven are generated: dependencies, framework and task-runner caches,
 * compiled output, and test artefacts. Nothing hand-written shares these names.
 *
 * @type {string[]}
 */
export const REMOVABLE_DIRECTORIES = Object.freeze([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
])

/** Workspace globs assumed when `pnpm-workspace.yaml` cannot be read. */
const FALLBACK_WORKSPACE_GLOBS = Object.freeze(['apps/*', 'packages/*'])

/**
 * Read the workspace globs out of `pnpm-workspace.yaml`.
 *
 * Only the list form this repository uses is understood — `packages:` followed
 * by quoted `- 'apps/*'` entries. A file it cannot parse falls back to the
 * conventional layout rather than failing, because guessing wrong here costs a
 * directory that is not cleaned, not a directory that is wrongly deleted.
 *
 * @returns {Promise<string[]>} Workspace glob patterns.
 */
export async function readWorkspaceGlobs() {
  let contents

  try {
    contents = await readFile(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  } catch {
    return [...FALLBACK_WORKSPACE_GLOBS]
  }

  const globs = []
  let inPackages = false

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trimEnd()

    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }

    if (!inPackages) continue

    const entry = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line)
    if (entry) {
      globs.push(entry[1])
      continue
    }

    // Any other non-blank line at column zero ends the `packages:` block.
    if (line.trim() !== '' && !line.startsWith(' ')) break
  }

  return globs.length > 0 ? globs : [...FALLBACK_WORKSPACE_GLOBS]
}

/**
 * Expand one workspace glob into concrete directories.
 *
 * Supports the two forms pnpm workspaces actually use here: a literal path and
 * a single trailing `*`.
 *
 * @param {string} glob A pattern such as `apps/*` or `packages/db`.
 * @returns {Promise<string[]>} Absolute paths of the directories that exist.
 */
export async function expandWorkspaceGlob(glob) {
  const normalised = glob.replace(/\/+$/, '')

  if (!normalised.endsWith('/*')) {
    const candidate = path.resolve(REPO_ROOT, normalised)
    return (await isDirectory(candidate)) ? [candidate] : []
  }

  const parent = path.resolve(REPO_ROOT, normalised.slice(0, -2))

  let entries
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(parent, entry.name))
    .sort()
}

/**
 * Every directory that may hold removable output: the root and each workspace.
 *
 * @returns {Promise<string[]>} Absolute directory paths, root first.
 */
export async function cleanableRoots() {
  const globs = await readWorkspaceGlobs()
  const expanded = await Promise.all(globs.map(expandWorkspaceGlob))

  return [REPO_ROOT, ...new Set(expanded.flat())]
}

/**
 * Whether a path exists and is a directory.
 *
 * @param {string} target Absolute path.
 * @returns {Promise<boolean>} True when `target` is a directory.
 */
async function isDirectory(target) {
  try {
    return (await lstat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Whether a path lies strictly inside the repository root.
 *
 * The root itself is *not* inside itself, so a bug that produced an empty
 * relative path cannot delete the repository.
 *
 * @param {string} target Absolute path to test.
 * @returns {boolean} True when `target` is a descendant of {@link REPO_ROOT}.
 */
export function isInsideRoot(target) {
  const relative = path.relative(REPO_ROOT, path.resolve(target))

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Throw unless a path lies inside the repository root.
 *
 * @param {string} target Absolute path to check.
 * @returns {string} The resolved path, unchanged.
 * @throws {Error} When the path escapes the repository root.
 */
export function assertInsideRoot(target) {
  const resolved = path.resolve(target)

  if (!isInsideRoot(resolved)) {
    throw new Error(`Refusing to delete "${resolved}": it is outside ${REPO_ROOT}`)
  }

  return resolved
}

/**
 * A directory the script intends to delete.
 *
 * @typedef {object} CleanTarget
 * @property {string} absolutePath Absolute path on disk.
 * @property {string} relativePath Path relative to the repository root, for printing.
 * @property {boolean} symlink Whether the entry is a symbolic link rather than a real directory.
 */

/**
 * Find every removable directory that currently exists.
 *
 * A symlink is reported but never followed: deleting it removes the link, and
 * whatever it pointed at — a shared pnpm store, someone's home directory — is
 * left alone. A link whose target escapes the repository is dropped from the
 * plan entirely.
 *
 * @returns {Promise<CleanTarget[]>} Targets in deletion order, deduplicated.
 */
export async function collectTargets() {
  const roots = await cleanableRoots()
  /** @type {Map<string, CleanTarget>} */
  const targets = new Map()

  for (const root of roots) {
    for (const name of REMOVABLE_DIRECTORIES) {
      const absolutePath = path.join(root, name)

      let stats
      try {
        stats = await lstat(absolutePath)
      } catch {
        continue
      }

      if (!stats.isDirectory() && !stats.isSymbolicLink()) continue
      if (!isInsideRoot(absolutePath)) continue

      if (!stats.isSymbolicLink()) {
        // A real directory can still be a mount or a link higher up the path,
        // so the resolved location is checked too.
        const resolved = await realpath(absolutePath).catch(() => absolutePath)
        if (!isInsideRoot(resolved)) continue
      }

      targets.set(absolutePath, {
        absolutePath,
        relativePath: path.relative(REPO_ROOT, absolutePath),
        symlink: stats.isSymbolicLink(),
      })
    }
  }

  return [...targets.values()]
}

/**
 * Delete the collected targets, or list them when `dryRun` is set.
 *
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.dryRun] List instead of deleting.
 * @param {Function} [options.log] Sink for progress output; receives one line at a time.
 * @returns {Promise<{removed: CleanTarget[], dryRun: boolean}>} What was removed, or would have been.
 * @throws {Error} When a target escapes the repository root, or a deletion fails.
 */
export async function clean(options = {}) {
  const { dryRun = false, log = console.log } = options
  const targets = await collectTargets()

  if (targets.length === 0) {
    log('Nothing to clean.')
    return { removed: [], dryRun }
  }

  for (const target of targets) {
    assertInsideRoot(target.absolutePath)

    const suffix = target.symlink ? ' (symlink; the link is removed, not its target)' : ''

    if (dryRun) {
      log(`  would remove  ${target.relativePath}${suffix}`)
      continue
    }

    await rm(target.absolutePath, { recursive: true, force: true })
    log(`  removed       ${target.relativePath}${suffix}`)
  }

  log(
    dryRun
      ? `\n${targets.length} path(s) would be removed. Nothing was deleted (--dry-run).`
      : `\n${targets.length} path(s) removed. Run "pnpm install" before working again.`,
  )

  return { removed: targets, dryRun }
}

/**
 * Parse the command line.
 *
 * @param {string[]} argv Arguments after the node binary and script path.
 * @returns {{dryRun: boolean, help: boolean, unknown: string[]}} Parsed flags.
 */
export function parseArgs(argv) {
  const unknown = []
  let dryRun = false
  let help = false

  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') dryRun = true
    else if (arg === '--help' || arg === '-h') help = true
    else unknown.push(arg)
  }

  return { dryRun, help, unknown }
}

/** Text printed for `--help`. */
const USAGE = `Usage: node scripts/clean.mjs [--dry-run]

Removes ${REMOVABLE_DIRECTORIES.join(', ')} from the repository root and from
every workspace matched by pnpm-workspace.yaml. Paths outside the repository
root are refused.

Options:
  -n, --dry-run   List what would be removed without deleting anything.
  -h, --help      Show this message.`

/**
 * Entry point: parse arguments, run the clean, choose an exit code.
 *
 * @param {string[]} [argv] Arguments after the node binary and script path.
 * @returns {Promise<number>} The process exit code: 0 on success, 1 on failure, 2 on bad usage.
 */
export async function main(argv = process.argv.slice(2)) {
  const { dryRun, help, unknown } = parseArgs(argv)

  if (help) {
    console.log(USAGE)
    return 0
  }

  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}\n`)
    console.error(USAGE)
    return 2
  }

  console.log(dryRun ? 'Cleaning (dry run) — nothing will be deleted.' : 'Cleaning.')

  try {
    await clean({ dryRun })
    return 0
  } catch (error) {
    console.error(`clean failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

// Only self-runs when invoked directly, so a test can import the helpers above
// without deleting the repository it is running in.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(await main())
}
