#!/usr/bin/env node
/**
 * Run every package's tests, and refuse any report this run cannot prove it wrote.
 *
 *     pnpm verify:tests:fresh
 *
 * ## Why this exists
 *
 * This repository has reported a stale number as a fresh one more than once,
 * and each time by a different route. The incidents are recorded in
 * `docs/PHASE4_IMPLEMENTATION_REPORT.md` and are not repeated in full here; the
 * mechanisms are what matter, because each one is something this command now
 * refuses:
 *
 * 1. **A cache hit rewrites nothing.** Turborepo's `test` task declares
 *    `coverage/**` as its output and not `vitest-report.json`. On a cache hit it
 *    replays the logs and restores coverage, and never runs Vitest — so the
 *    report left on disk by some earlier run stays exactly where it was, and the
 *    skipped-test checker reads it as though it were this run's.
 * 2. **`--force` to the wrong program.** `pnpm run test -- --force` hands
 *    `--force` to Vitest, which refuses it as an unknown option. The flag that
 *    bypasses the cache belongs to Turborepo, before the `--`.
 * 3. **A plain replay produced one report instead of sixteen,** and a checker
 *    handed one report checks one package.
 * 4. **A waiter that waited on itself.** `until ! pgrep -f "playwright test"`
 *    matches the command line of the shell running it, so it never finishes.
 *
 * ## What it guarantees
 *
 * 1. Every `vitest-report.json` in the repository is deleted before anything runs,
 *    a symbolic link included (the link, not what it points at). A report that
 *    cannot be deleted, or a directory link the scan does not follow, refuses
 *    the run before it starts, with the path named.
 * 2. The run's start is recorded, and every report must have been written after it.
 * 3. Every test task runs: Turborepo is invoked with `--force`, so nothing is replayed.
 * 4. Vitest gets the reporter flags CI needs, after the `--`, and Turborepo gets
 *    none of them.
 * 5. Every package Turborepo would test must produce a report, and no report may
 *    appear anywhere else.
 * 6. A report that is missing, empty, malformed, a symbolic link, or older than
 *    the run is refused. "Older" is judged twice: by the file's modification
 *    time, and by the `startTime` Vitest writes inside it — the second is what
 *    catches a report a cache *restored* with a fresh timestamp and old
 *    contents. A `startTime` later than the moment the report is judged is
 *    refused too: no run this command started can have begun in the future.
 * 7. A skipped, pending or todo case, a failed case, a package with no cases and
 *    a test file with no cases are all refused unless allow-listed in
 *    `scripts/skipped-tests-allowlist.json`. With no allow-list escape: a case
 *    with a status this command does not know, a test file that failed outside
 *    its cases, a report that says its run did not succeed, a report whose
 *    counters disagree with the cases it lists, and a report whose entries are
 *    not well-formed (refused as malformed rather than crashing the count).
 * 8. Totals are printed per package and for the repository, and the same lines
 *    are written to `test-results/verify-tests-fresh.txt`. CI prints that file
 *    in the last step a green verify job runs, so the table ends the log
 *    instead of sitting thousands of lines above its end.
 * 9. CI runs this command and nothing else to produce and judge reports;
 *    `scripts/check-ci-invariants.mjs` refuses a workflow that does otherwise.
 * 10. It exits nonzero if Turborepo fails, or if any of the above does not hold.
 * 11. Nothing is polled. The test run is one child process, awaited on its
 *     `close` event.
 *
 * `REQUIRE_DATABASE=1` is set for the child, as CI sets it. That variable only
 * reaches Vitest because `turbo.json` declares it in `globalEnv`; before that
 * declaration Turborepo's strict environment mode removed it from every test
 * process, in CI included.
 *
 * @module scripts/verify-tests-fresh
 */

import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  REPORT_NAME,
  ReportError,
  casesIn,
  emptyFilesIn,
  failedOutsideCasesIn,
  findReports,
  readAllowlist,
  readReport,
  skippedIn,
  totalsIn,
  unrecognisedIn,
  writtenAt,
} from './lib/vitest-reports.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/** The allow-list shared with `check-skipped-tests.mjs`. */
export const ALLOWLIST = path.join(HERE, 'skipped-tests-allowlist.json')

/**
 * Where the verdict is also written, relative to the repository root.
 *
 * `test-results/` is already ignored by git, Prettier and the language policy,
 * and `pnpm clean` removes it. CI prints this file with `cat` in the last step
 * a green verify job runs, and `check-ci-invariants.mjs` reads this constant to
 * check that it does.
 */
export const SUMMARY_PATH = 'test-results/verify-tests-fresh.txt'

/**
 * How far a report's modification time may trail the run's start.
 *
 * Some filesystems keep modification times to the second. A report written in
 * the first second of a run could otherwise read as older than the run itself.
 * A genuinely stale report is minutes or days old, so a two-second allowance
 * costs nothing — and the `startTime` inside the report, which Vitest records
 * to the millisecond, is held to the run's start with no allowance at all.
 *
 * The same allowance bounds `startTime` from above: a report may not describe a
 * run that began later than the moment it is judged. Both clocks are this
 * machine's, so the allowance only absorbs a clock step between the two reads.
 */
export const MTIME_ALLOWANCE_MS = 2_000

/** Arguments for Turborepo: the task, and the flag that refuses its cache. */
export const TURBO_ARGS = Object.freeze(['run', 'test', '--force'])

/**
 * Arguments for Vitest, the same ones CI's report-producing step always passed.
 *
 * `default` keeps the human-readable output; `json` writes the report.
 */
export const VITEST_ARGS = Object.freeze([
  '--reporter=default',
  '--reporter=json',
  `--outputFile.json=${REPORT_NAME}`,
])

/**
 * The full argument vector for the test run.
 *
 * Everything before `--` is Turborepo's and everything after is Vitest's. That
 * is the whole of the forwarding rule, and it is built here rather than typed,
 * so it cannot be typed wrong.
 *
 * @returns {string[]} Arguments for `turbo`.
 */
export function buildTurboArgv() {
  return [...TURBO_ARGS, '--', ...VITEST_ARGS]
}

/**
 * The packages a test run is expected to report on, from Turborepo's own plan.
 *
 * Asking Turborepo rather than listing packages here means a new package with a
 * `test` script is expected the day it is added, and one removed stops being
 * expected — without anybody remembering to edit a list.
 *
 * @param {object} plan The parsed output of `turbo run test --dry=json`.
 * @param {string} root The repository root the plan's directories are relative to.
 * @returns {Array<{name: string, directory: string}>} Expected packages, sorted by name.
 */
export function expectedFromPlan(plan, root) {
  return (plan?.tasks ?? [])
    .filter((task) => task.task === 'test' && task.command && task.command !== '<NONEXISTENT>')
    .map((task) => ({ name: task.package, directory: path.resolve(root, task.directory) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Run a command and collect its standard output.
 *
 * @param {string} command The program.
 * @param {string[]} args Its arguments.
 * @param {object} options Spawn options.
 * @returns {Promise<{code: number, stdout: string}>} The exit code and output.
 */
function capture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })
}

/**
 * Ask Turborepo which packages it would test.
 *
 * @param {string} root The repository root.
 * @returns {Promise<Array<{name: string, directory: string}>>} Expected packages.
 * @throws {Error} When Turborepo cannot produce a plan.
 */
export async function expectedPackages(root) {
  const { code, stdout } = await capture('pnpm', ['exec', 'turbo', 'run', 'test', '--dry=json'], {
    cwd: root,
  })

  if (code !== 0) throw new Error(`turbo could not plan the test run (exit ${code})`)

  return expectedFromPlan(JSON.parse(stdout), root)
}

/**
 * Run the real test suite: one child process, awaited, never polled.
 *
 * @param {string} root The repository root.
 * @returns {Promise<number>} Turborepo's exit code.
 */
export function runTurbo(root) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'turbo', ...buildTurboArgv()], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, REQUIRE_DATABASE: '1' },
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/**
 * Delete one file. A symbolic link is itself removed, never what it points at.
 *
 * @param {string} file The file.
 * @returns {void}
 */
function removeFile(file) {
  rmSync(file, { force: true })
}

/**
 * Why a directory link stops the command, naming it.
 *
 * @param {string} root The repository root, for relative paths.
 * @param {string} directory The link.
 * @returns {string} The problem.
 */
function unfollowedLink(root, directory) {
  return (
    `${path.relative(root, directory)} is a symbolic link to a directory, which the report scan ` +
    `does not follow — a report behind it could be neither deleted before the run nor noticed after it`
  )
}

/**
 * Whether a path is a symbolic link, without following it.
 *
 * @param {string} file The path.
 * @returns {boolean} True for a link, false for anything else or nothing.
 */
function isSymbolicLink(file) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Delete every report under the root.
 *
 * Nothing is thrown. A report already gone is what deletion wanted; any other
 * failure to delete one is returned as a problem naming the file, because a
 * report left in place is one an earlier run wrote. A directory link the scan
 * does not follow is returned as a problem too, because what is behind it was
 * not deleted either.
 *
 * @param {string} root The repository root.
 * @param {function(string): void} [remove] Deletes one file.
 * @returns {{deleted: string[], problems: string[]}} What was deleted, and what stops the run.
 */
export function deleteReports(root, remove = removeFile) {
  const { reports, linkedDirectories } = findReports(root)
  const deleted = []
  const problems = linkedDirectories.map((directory) => unfollowedLink(root, directory))

  for (const file of reports) {
    try {
      remove(file)
      deleted.push(file)
    } catch (error) {
      if (error?.code === 'ENOENT') continue

      problems.push(
        `could not delete ${path.relative(root, file)} before the run (${error?.message ?? error}) — ` +
          `a report left from an earlier run could be judged as this one's`,
      )
    }
  }

  return { deleted, problems }
}

/**
 * Whether an exemption covers a subject.
 *
 * @param {Array<{pattern: string, reason: string}>} allowlist The exemptions.
 * @param {string} subject `"<file> > <case>"`.
 * @returns {{pattern: string, reason: string}|undefined} The exemption, if any.
 */
function exemptionFor(allowlist, subject) {
  return allowlist.find((entry) => subject.includes(entry.pattern))
}

/**
 * Judge one package's report.
 *
 * @param {object} options Options.
 * @param {{name: string, directory: string}} options.pkg The package.
 * @param {number} options.runStartedAt When the run began, epoch milliseconds.
 * @param {number} [options.inspectedAt] When the report is judged, epoch milliseconds.
 * @param {Array<{pattern: string, reason: string}>} options.allowlist The exemptions.
 * @param {string} options.root The repository root, for relative paths.
 * @returns {{name: string, file: string, totals: object|null, problems: string[], allowed: string[]}} The verdict.
 */
export function inspectPackage({ pkg, runStartedAt, inspectedAt = Date.now(), allowlist, root }) {
  const file = path.join(pkg.directory, REPORT_NAME)
  const where = path.relative(root, file)
  const problems = []
  const allowed = []

  // Vitest writes a file. A link was put there by something else, and whatever
  // it points at is not evidence this package's run wrote anything.
  if (isSymbolicLink(file)) {
    return {
      name: pkg.name,
      file: where,
      totals: null,
      problems: [`the report is a symbolic link, not a file this run wrote — ${where}`],
      allowed,
    }
  }

  let report

  try {
    report = readReport(file)
  } catch (error) {
    if (!(error instanceof ReportError)) throw error

    const said = {
      missing: `expected a report and none was written — ${where}`,
      empty: `the report is empty — ${where}`,
      malformed: `the report is malformed (${error.message}) — ${where}`,
    }

    return { name: pkg.name, file: where, totals: null, problems: [said[error.kind]], allowed }
  }

  const written = writtenAt(file)

  if (written + MTIME_ALLOWANCE_MS < runStartedAt) {
    problems.push(
      `the report was last written ${new Date(written).toISOString()}, before this run began at ` +
        `${new Date(runStartedAt).toISOString()} — ${where}`,
    )
  }

  if (typeof report.startTime !== 'number' || !Number.isFinite(report.startTime)) {
    problems.push(`the report carries no startTime, so its age cannot be proved — ${where}`)
  } else if (report.startTime < runStartedAt) {
    problems.push(
      `the report describes a run that started ${new Date(report.startTime).toISOString()}, ` +
        `before this one — a replayed or restored report — ${where}`,
    )
  } else if (report.startTime > inspectedAt + MTIME_ALLOWANCE_MS) {
    problems.push(
      `the report describes a run that started ${new Date(report.startTime).toISOString()}, ` +
        `after this one was judged at ${new Date(inspectedAt).toISOString()} — ` +
        `a report stamped in the future — ${where}`,
    )
  }

  const totals = totalsIn(report)

  if (casesIn(report) === 0 || totals.tests === 0) {
    problems.push(`the package ran no tests at all — ${where}`)
  }

  if (
    totals.failed > 0 ||
    (typeof report.numFailedTests === 'number' && report.numFailedTests > 0)
  ) {
    problems.push(
      `${Math.max(totals.failed, report.numFailedTests ?? 0)} test(s) failed — ${where}`,
    )
  }

  for (const entry of skippedIn(report, file, root)) {
    const subject = `${entry.file} > ${entry.name}`
    const exemption = exemptionFor(allowlist, subject)

    if (exemption) allowed.push(`${subject} (${exemption.reason})`)
    else problems.push(`${entry.status}, not allow-listed: ${subject}`)
  }

  // No allow-list escape for either: an unknown status is not a skip anyone
  // declared, and a file that broke outside its cases did not pass.
  for (const entry of unrecognisedIn(report, file, root)) {
    problems.push(
      `a case with a status this checker does not know ("${entry.status}"), so it neither ` +
        `passed nor was declared skipped: ${entry.file} > ${entry.name}`,
    )
  }

  const brokenFiles = failedOutsideCasesIn(report, root)

  for (const broken of brokenFiles) {
    problems.push(
      `a test file failed outside its cases${broken.message ? ` (${broken.message})` : ''}: ${broken.file}`,
    )
  }

  if (report.success === false && totals.failed === 0 && brokenFiles.length === 0) {
    problems.push(
      `the report says the run did not succeed, though no case or file is marked failed — ${where}`,
    )
  }

  for (const empty of emptyFilesIn(report, root)) {
    const subject = `${empty} > (no tests in this file)`
    const exemption = exemptionFor(allowlist, subject)

    if (exemption) allowed.push(`${subject} (${exemption.reason})`)
    else problems.push(`a test file collected no tests: ${empty}`)
  }

  // The reporter's own counters, against the assertions actually listed. They
  // disagree only when the report's vocabulary has moved away from the one read
  // above, which is precisely how this checker once went blind for a whole
  // phase. Better to fail on the disagreement than to trust either side.
  for (const [counter, listed, what] of [
    ['numTotalTests', totals.tests, 'case(s)'],
    ['numPassedTests', totals.passed, 'passed case(s)'],
    ['numFailedTests', totals.failed, 'failed case(s)'],
  ]) {
    if (typeof report[counter] === 'number' && report[counter] !== listed) {
      problems.push(
        `the report counts ${report[counter]} ${what} (${counter}) but lists ${listed} — ${where}`,
      )
    }
  }

  const counted = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0)

  if (counted > totals.skipped) {
    problems.push(
      `the report counts ${counted} pending or todo case(s) but lists only ${totals.skipped} — ` +
        `its status vocabulary has changed — ${where}`,
    )
  }

  return { name: pkg.name, file: where, totals, problems, allowed }
}

/**
 * Delete, run, and judge.
 *
 * Every dependency that touches the outside world is a parameter, so the whole
 * sequence can be exercised against a fixture tree with a test runner that
 * pretends to be Turborepo — including one that behaves as a cache hit does.
 *
 * @param {object} options Options.
 * @param {string} options.root The repository root.
 * @param {Array<{name: string, directory: string}>} options.expected Packages that must report.
 * @param {function(): Promise<number>} options.runTests Runs the suite; resolves to an exit code.
 * @param {Array<{pattern: string, reason: string}>} [options.allowlist] Exemptions.
 * @param {function(): number} [options.now] The clock.
 * @param {function(string): void} [options.remove] Deletes one report before the run.
 * @returns {Promise<{exitCode: number, runStartedAt: number|null, deleted: string[], packages: object[], problems: string[], totals: object}>} The verdict; `runStartedAt` is null when the run was refused before it started.
 */
export async function verifyTestsFresh({
  root,
  expected,
  runTests,
  allowlist = [],
  now = Date.now,
  remove = removeFile,
}) {
  const { deleted, problems: beforeRun } = deleteReports(root, remove)

  if (beforeRun.length > 0) {
    return {
      exitCode: 1,
      runStartedAt: null,
      deleted,
      packages: [],
      problems: beforeRun,
      totals: { packages: 0, files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 },
    }
  }

  const runStartedAt = now()
  const exit = await runTests()
  const inspectedAt = now()

  const packages = expected.map((pkg) =>
    inspectPackage({ pkg, runStartedAt, inspectedAt, allowlist, root }),
  )
  const problems = packages.flatMap((result) => result.problems.map((p) => `${result.name}: ${p}`))

  const expectedFiles = new Set(expected.map((pkg) => path.join(pkg.directory, REPORT_NAME)))
  const afterRun = findReports(root)

  for (const file of afterRun.reports) {
    if (!expectedFiles.has(file)) {
      problems.push(
        `a report appeared where no package was expected to write one: ${path.relative(root, file)}`,
      )
    }
  }

  for (const directory of afterRun.linkedDirectories) {
    problems.push(unfollowedLink(root, directory))
  }

  if (exit !== 0) problems.unshift(`the test run exited ${exit}`)

  const totals = { packages: packages.length, files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 }

  for (const result of packages) {
    if (!result.totals) continue

    for (const key of ['files', 'tests', 'passed', 'failed', 'skipped']) {
      totals[key] += result.totals[key]
    }
  }

  return {
    exitCode: problems.length === 0 ? 0 : 1,
    runStartedAt,
    deleted,
    packages,
    problems,
    totals,
  }
}

/**
 * Print the verdict as a table a person can read in a CI log.
 *
 * @param {object} verdict What `verifyTestsFresh` returned.
 * @param {function(string): void} [write] Where lines go.
 * @returns {void}
 */
export function printVerdict(verdict, write = (line) => console.log(line)) {
  const width = Math.max(8, ...verdict.packages.map((result) => result.name.length))
  const cell = (value) => String(value).padStart(7)

  write('')
  write(
    `${'package'.padEnd(width)} ${cell('files')} ${cell('tests')} ${cell('passed')} ` +
      `${cell('failed')} ${cell('skipped')}  verdict`,
  )

  for (const result of verdict.packages) {
    const t = result.totals

    write(
      `${result.name.padEnd(width)} ` +
        (t
          ? `${cell(t.files)} ${cell(t.tests)} ${cell(t.passed)} ${cell(t.failed)} ${cell(t.skipped)}`
          : `${cell('—')} ${cell('—')} ${cell('—')} ${cell('—')} ${cell('—')}`) +
        `  ${result.problems.length === 0 ? 'ok' : 'REFUSED'}`,
    )
  }

  const t = verdict.totals

  write(
    `${'total'.padEnd(width)} ${cell(t.files)} ${cell(t.tests)} ${cell(t.passed)} ` +
      `${cell(t.failed)} ${cell(t.skipped)}  ${t.packages} package(s)`,
  )

  for (const result of verdict.packages) {
    for (const line of result.allowed) write(`  allowed: ${line}`)
  }

  write('')
  write(
    verdict.runStartedAt === null
      ? `The test run was not started; ${verdict.deleted.length} report(s) deleted beforehand.`
      : `Run started ${new Date(verdict.runStartedAt).toISOString()}; ` +
          `${verdict.deleted.length} report(s) deleted beforehand.`,
  )

  if (verdict.problems.length === 0) {
    write(
      `Fresh-report verification: OK — ${t.tests} case(s) ran across ${t.packages} fresh report(s); ` +
        `0 failed, 0 skipped, 0 undeclared.`,
    )

    return
  }

  write('')
  write(`✗ Fresh-report verification refused this run (${verdict.problems.length} problem(s)):`)

  for (const problem of verdict.problems) write(`  - ${problem}`)
}

/**
 * Write the lines `printVerdict` prints to a file.
 *
 * The test step's output is thousands of lines long, and its table sits that
 * far above the end of the verify job's log, where a reader of the log's tail
 * never reaches it. The last step of a green verify job prints this file, so
 * the same lines end the log. One renderer writes both, so the file cannot say
 * what the log did not.
 *
 * @param {object} verdict What `verifyTestsFresh` returned.
 * @param {string} file Where to write it.
 * @returns {void}
 */
export function writeSummary(verdict, file) {
  const lines = []

  printVerdict(verdict, (line) => lines.push(line))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * The command.
 *
 * @returns {Promise<number>} A process exit code.
 */
async function main() {
  const summary = path.join(ROOT, SUMMARY_PATH)

  // A summary an earlier run left must not outlive a run that stops before
  // writing its own: CI would print the old one as this run's.
  try {
    rmSync(summary, { force: true })
  } catch (error) {
    console.error(`✗ could not remove the previous summary, ${SUMMARY_PATH}: ${error.message}`)

    return 2
  }

  let allowlist

  try {
    allowlist = readAllowlist(ALLOWLIST)
  } catch (error) {
    console.error(`✗ ${error.message}`)

    return 2
  }

  const expected = await expectedPackages(ROOT)

  if (expected.length === 0) {
    console.error('✗ turbo planned no test tasks, so there is nothing to verify.')

    return 2
  }

  const verdict = await verifyTestsFresh({
    root: ROOT,
    expected,
    allowlist,
    runTests: () => runTurbo(ROOT),
  })

  printVerdict(verdict)

  try {
    writeSummary(verdict, summary)
  } catch (error) {
    console.error(`✗ could not write the summary CI prints, ${SUMMARY_PATH}: ${error.message}`)

    return 2
  }

  return verdict.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(await main())
}
