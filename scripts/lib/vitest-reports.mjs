/**
 * Reading Vitest JSON reports, in one place.
 *
 * Two commands read these files — `check-skipped-tests.mjs`, which judges
 * whatever reports it is handed, and `verify-tests-fresh.mjs`, which produces
 * them and then refuses any it cannot prove this run wrote. They must agree on
 * what "did not run" means, and the history of this repository is the argument
 * for defining that once: the checker matched Jest's `pending` for its whole
 * early life while Vitest writes `skipped`, and reported `0 skipped` on reports
 * holding skipped cases. A second copy of the vocabulary is a second place for
 * that to happen.
 *
 * Nothing here spawns a process or decides an exit code. Callers do that.
 *
 * @module scripts/lib/vitest-reports
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** What every package's Vitest JSON report is called. */
export const REPORT_NAME = 'vitest-report.json'

/**
 * The assertion statuses that mean "this case did not run".
 *
 * Vitest's JSON reporter copies Jest's shape but not all of its vocabulary:
 * Jest writes `pending` for a skipped case, Vitest writes **`skipped`**. All
 * three spellings are listed rather than only the one this Vitest emits — an
 * extra string costs nothing, the wrong one costs a guard that prints OK while
 * looking at nothing.
 *
 * @type {ReadonlyArray<string>}
 */
export const DID_NOT_RUN = Object.freeze(['skipped', 'pending', 'todo'])

/**
 * The assertion statuses that mean "this case ran".
 *
 * @type {ReadonlyArray<string>}
 */
export const RAN = Object.freeze(['passed', 'failed'])

/**
 * Directories never searched for reports.
 *
 * `node_modules` holds other projects' fixtures; the rest are build and cache
 * output where a report could only ever be a copy.
 *
 * @type {ReadonlySet<string>}
 */
const NOT_SEARCHED = new Set(['node_modules', '.git', '.next', '.turbo', 'coverage', 'dist'])

/**
 * Why a report could not be read at all.
 *
 * Distinct from a report that was read and found wanting: a missing, empty or
 * malformed file is not evidence of anything, and has to be reported as such
 * rather than counted as zero tests.
 */
export class ReportError extends Error {
  /**
   * @param {'missing'|'empty'|'malformed'} kind What went wrong.
   * @param {string} file The report.
   * @param {string} message Why.
   */
  constructor(kind, file, message) {
    super(message)
    this.name = 'ReportError'
    this.kind = kind
    this.file = file
  }
}

/**
 * Read the allow-list, refusing an entry that does not explain itself.
 *
 * An array of `{ pattern, reason }`. `pattern` is matched as a substring
 * against `"<file> > <full case name>"`; `reason` is prose a reviewer reads.
 *
 * @param {string} file Path to the allow-list.
 * @returns {Array<{pattern: string, reason: string}>} The declared exemptions.
 * @throws {Error} When the file is malformed or an entry has no reason.
 */
export function readAllowlist(file) {
  let parsed

  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []

    throw new Error(`${file} is not readable JSON: ${error.message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must be an array of { pattern, reason }`)
  }

  for (const entry of parsed) {
    if (typeof entry?.pattern !== 'string' || entry.pattern.trim() === '') {
      throw new Error(`${file} has an entry with no pattern`)
    }

    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 10) {
      throw new Error(
        `${file} entry "${entry.pattern}" has no reason. An exemption nobody explained is one nobody will revisit.`,
      )
    }
  }

  return parsed
}

/**
 * Read one report, telling missing from empty from malformed.
 *
 * Structural only: a report with `testResults` is well-formed here whatever it
 * contains. Whether it is *fresh* is the caller's question — this function is
 * shared with a checker that is handed reports it did not produce.
 *
 * @param {string} file Path to the report.
 * @returns {object} The parsed report.
 * @throws {ReportError} When the file is missing, empty or not a report.
 */
export function readReport(file) {
  if (!existsSync(file)) throw new ReportError('missing', file, 'no report was written')

  const text = readFileSync(file, 'utf8')

  if (text.trim() === '') throw new ReportError('empty', file, 'the report is empty')

  let report

  try {
    report = JSON.parse(text)
  } catch (error) {
    throw new ReportError('malformed', file, `the report is not JSON: ${error.message}`)
  }

  if (report === null || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    throw new ReportError('malformed', file, 'the report has no testResults array')
  }

  // Every entry is read below as an object with a status. A null, a number or
  // a case without a status would otherwise crash the count instead of being
  // refused as the unreadable report it is.
  for (const [index, suite] of report.testResults.entries()) {
    if (suite === null || typeof suite !== 'object') {
      throw new ReportError('malformed', file, `testResults[${index}] is not an object`)
    }

    if (suite.assertionResults !== undefined && !Array.isArray(suite.assertionResults)) {
      throw new ReportError(
        'malformed',
        file,
        `testResults[${index}] has no assertionResults array`,
      )
    }

    for (const assertion of suite.assertionResults ?? []) {
      if (
        assertion === null ||
        typeof assertion !== 'object' ||
        typeof assertion.status !== 'string'
      ) {
        throw new ReportError('malformed', file, `a case in testResults[${index}] has no status`)
      }
    }
  }

  return report
}

/**
 * How many cases a report says it holds.
 *
 * `numTotalTests` when the reporter wrote it, otherwise a count of assertion
 * results — the fallback exists for reports written by hand in tests.
 *
 * @param {object} report A parsed report.
 * @returns {number} The case count.
 */
export function casesIn(report) {
  if (typeof report.numTotalTests === 'number') return report.numTotalTests

  let counted = 0

  for (const suite of report.testResults ?? []) counted += (suite.assertionResults ?? []).length

  return counted
}

/**
 * The full name of one case, as a reviewer would search for it.
 *
 * @param {object} assertion An assertion result.
 * @returns {string} Ancestors and title, joined.
 */
function caseName(assertion) {
  return [...(assertion.ancestorTitles ?? []), assertion.title].join(' > ')
}

/**
 * Every case in a report that did not run.
 *
 * @param {object} report A parsed report.
 * @param {string} file The report's path, used when a suite carries no name.
 * @param {string} [relativeTo] Directory the returned file paths are relative to.
 * @returns {Array<{name: string, file: string, status: string}>} What did not run.
 */
export function skippedIn(report, file, relativeTo = process.cwd()) {
  const skipped = []

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (DID_NOT_RUN.includes(assertion.status)) {
        skipped.push({
          name: caseName(assertion),
          file: path.relative(relativeTo, suite.name ?? file),
          status: assertion.status,
        })
      }
    }
  }

  return skipped
}

/**
 * Every case whose status is neither a run (`passed`, `failed`) nor one of the
 * ways of not running ({@link DID_NOT_RUN}).
 *
 * Counted nowhere else, such a case would be neither a pass, a failure nor a
 * skip, and a report of nothing but those would read as clean.
 *
 * @param {object} report A parsed report.
 * @param {string} file The report's path, used when a suite carries no name.
 * @param {string} [relativeTo] Directory the returned file paths are relative to.
 * @returns {Array<{name: string, file: string, status: string}>} The unrecognised cases.
 */
export function unrecognisedIn(report, file, relativeTo = process.cwd()) {
  const unknown = []

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (!RAN.includes(assertion.status) && !DID_NOT_RUN.includes(assertion.status)) {
        unknown.push({
          name: caseName(assertion),
          file: path.relative(relativeTo, suite.name ?? file),
          status: assertion.status,
        })
      }
    }
  }

  return unknown
}

/**
 * Test files marked failed although none of their cases failed: a hook, an
 * import or the file itself broke outside any case.
 *
 * @param {object} report A parsed report.
 * @param {string} [relativeTo] Directory the returned paths are relative to.
 * @returns {Array<{file: string, message: string}>} Each such file, and what it said.
 */
export function failedOutsideCasesIn(report, relativeTo = process.cwd()) {
  return (report.testResults ?? [])
    .filter(
      (suite) =>
        suite.status === 'failed' &&
        !(suite.assertionResults ?? []).some((assertion) => assertion.status === 'failed'),
    )
    .map((suite) => ({
      file: path.relative(relativeTo, suite.name ?? '(unnamed suite)'),
      message: typeof suite.message === 'string' ? suite.message.split('\n')[0].trim() : '',
    }))
}

/**
 * Test files in a report that collected no cases.
 *
 * A package-level count catches a package that ran nothing; this catches one
 * file that ran nothing inside a package that ran plenty, which a package total
 * hides completely.
 *
 * @param {object} report A parsed report.
 * @param {string} [relativeTo] Directory the returned paths are relative to.
 * @returns {string[]} Paths of files with no cases.
 */
export function emptyFilesIn(report, relativeTo = process.cwd()) {
  return (report.testResults ?? [])
    .filter((suite) => (suite.assertionResults ?? []).length === 0)
    .map((suite) => path.relative(relativeTo, suite.name ?? '(unnamed suite)'))
}

/**
 * Per-status totals for one report, counted from its assertions.
 *
 * @param {object} report A parsed report.
 * @returns {{files: number, tests: number, passed: number, failed: number, skipped: number}} The totals.
 */
export function totalsIn(report) {
  const totals = { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 }

  for (const suite of report.testResults ?? []) {
    totals.files += 1

    for (const assertion of suite.assertionResults ?? []) {
      totals.tests += 1

      if (assertion.status === 'passed') totals.passed += 1
      else if (assertion.status === 'failed') totals.failed += 1
      else if (DID_NOT_RUN.includes(assertion.status)) totals.skipped += 1
    }
  }

  return totals
}

/**
 * Every report under a directory, however deep, and every directory link the
 * walk did not follow.
 *
 * Symbolic links are never followed: one can point back up the tree or out of
 * the repository altogether. They are not passed over in silence either,
 * because a walk that skips them cannot see what they hold. A link named like a
 * report is returned as a report, so it is deleted as one (the link, not what
 * it points at) and refused as one. A link to a directory is returned in
 * `linkedDirectories` for the caller to refuse: a report behind it can be
 * neither deleted nor noticed. A link to anything else cannot hold a report.
 *
 * @param {string} root Where to start.
 * @returns {{reports: string[], linkedDirectories: string[]}} Absolute paths, sorted.
 */
export function findReports(root) {
  const reports = []
  const linkedDirectories = []

  /**
   * Walk one directory.
   *
   * @param {string} directory The directory.
   * @returns {void}
   */
  function walk(directory) {
    let entries

    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        if (!NOT_SEARCHED.has(entry.name)) walk(full)
      } else if (entry.name === REPORT_NAME && (entry.isFile() || entry.isSymbolicLink())) {
        reports.push(full)
      } else if (entry.isSymbolicLink() && !NOT_SEARCHED.has(entry.name)) {
        let target

        try {
          target = statSync(full)
        } catch {
          // A dangling or looping link leads nowhere a report could be.
          continue
        }

        if (target.isDirectory()) linkedDirectories.push(full)
      }
    }
  }

  walk(path.resolve(root))

  return { reports: reports.sort(), linkedDirectories: linkedDirectories.sort() }
}

/**
 * When a file was last written, in epoch milliseconds.
 *
 * @param {string} file The file.
 * @returns {number} Its modification time.
 */
export function writtenAt(file) {
  return statSync(file).mtimeMs
}
