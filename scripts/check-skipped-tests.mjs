#!/usr/bin/env node
/**
 * Fail when a test skipped itself and nobody said it was allowed to.
 *
 * A skipped test reports as neither a pass nor a failure, and a summary line
 * that says "0 failed" is read as success by everybody who does not count the
 * other column. That is how a suite that could not reach its database ends up
 * being described as green — the defect this repository has already made once,
 * and the reason `REQUIRE_DATABASE` exists.
 *
 * `REQUIRE_DATABASE` covers the suites that know they need PostgreSQL. This
 * covers everything else: a `it.skip` left behind after debugging, a
 * `describe.skipIf` whose condition quietly became true, a case commented out
 * during a rush. Each one is fine to have, and each one has to be *declared*,
 * which is what the allow-list is for.
 *
 * ## The allow-list
 *
 * `scripts/skipped-tests-allowlist.json`: an array of `{ pattern, reason }`.
 * `pattern` is matched against `"<file> > <full test name>"` as a substring,
 * and `reason` is prose a reviewer reads. An entry with no reason is refused,
 * because an allow-list whose entries do not say why is a list of things
 * nobody will ever revisit.
 *
 * ## Usage
 *
 *     node scripts/check-skipped-tests.mjs <report.json> [...]
 *
 * Each argument is a Vitest JSON report. Vitest writes one per package, so CI
 * passes several.
 *
 * @module scripts/check-skipped-tests
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ALLOWLIST = path.join(HERE, 'skipped-tests-allowlist.json')

/**
 * Read the allow-list, refusing an entry that does not explain itself.
 *
 * @returns {Array<{pattern: string, reason: string}>} The declared exemptions.
 * @throws {Error} When the file is malformed or an entry has no reason.
 */
function readAllowlist() {
  let parsed

  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []

    throw new Error(`${ALLOWLIST} is not readable JSON: ${error.message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${ALLOWLIST} must be an array of { pattern, reason }`)
  }

  for (const entry of parsed) {
    if (typeof entry?.pattern !== 'string' || entry.pattern.trim() === '') {
      throw new Error(`${ALLOWLIST} has an entry with no pattern`)
    }

    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 10) {
      throw new Error(
        `${ALLOWLIST} entry "${entry.pattern}" has no reason. An exemption nobody explained is one nobody will revisit.`,
      )
    }
  }

  return parsed
}

/**
 * How many cases actually ran in one report.
 *
 * Zero is a failure, not a pass.
 *
 * A test command that runs nothing prints a green summary and exits zero, and
 * a required check that can pass by running nothing is a required check that
 * will one day pass by running nothing — a renamed directory, a `testMatch`
 * that stopped matching, a filter left on the command line. Counting is the
 * only thing that notices.
 *
 * @param {string} file Path to the report.
 * @returns {number} Cases that passed, failed or were skipped.
 */
function casesIn(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'))

  if (typeof report.numTotalTests === 'number') return report.numTotalTests

  let counted = 0

  for (const suite of report.testResults ?? []) {
    counted += (suite.assertionResults ?? []).length
  }

  return counted
}

/**
 * The assertion statuses that mean "this case did not run".
 *
 * Vitest's JSON reporter copies Jest's *shape* but not all of its *vocabulary*.
 * Jest writes `pending` for a skipped case; Vitest writes **`skipped`**. This
 * checker was written to Jest's spelling, so from the day it was added until the
 * day this constant replaced it, it matched a status Vitest never emits — and a
 * status nobody matches is a skip nobody counts.
 *
 * It was not a near miss. The checker reported `0 skipped, 0 undeclared` on a
 * report containing five genuinely skipped cases, and would have reported the
 * same on the run where 156 cases skipped themselves because PostgreSQL was
 * unreachable. The zero-test half of this file worked throughout; only this half
 * was blind.
 *
 * All three spellings are listed rather than only the one this version of Vitest
 * emits. An extra string costs nothing; the wrong one costs a guard that prints
 * OK while looking at nothing.
 *
 * @type {ReadonlyArray<string>}
 */
const DID_NOT_RUN = Object.freeze(['skipped', 'pending', 'todo'])

/**
 * Every case in one Vitest JSON report that did not run.
 *
 * @param {string} file Path to the report.
 * @returns {Array<{name: string, file: string}>} What was not run.
 */
function skippedIn(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const skipped = []

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (DID_NOT_RUN.includes(assertion.status)) {
        skipped.push({
          name: [...(assertion.ancestorTitles ?? []), assertion.title].join(' > '),
          file: path.relative(process.cwd(), suite.name ?? file),
        })
      }
    }
  }

  return skipped
}

/**
 * Run the check.
 *
 * @returns {number} A process exit code.
 */
function main() {
  const reports = process.argv.slice(2)

  if (reports.length === 0) {
    console.error('usage: node scripts/check-skipped-tests.mjs <report.json> [...]')

    return 2
  }

  let allowlist

  try {
    allowlist = readAllowlist()
  } catch (error) {
    console.error(`✗ ${error.message}`)

    return 2
  }

  const undeclared = []
  const declared = []
  const empty = []
  let total = 0
  let ran = 0

  for (const report of reports) {
    let skipped

    try {
      skipped = skippedIn(report)

      const cases = casesIn(report)

      ran += cases

      if (cases === 0) empty.push(report)
    } catch (error) {
      console.error(`✗ could not read ${report}: ${error.message}`)

      return 2
    }

    for (const entry of skipped) {
      total += 1

      const subject = `${entry.file} > ${entry.name}`
      const exemption = allowlist.find((candidate) => subject.includes(candidate.pattern))

      if (exemption) declared.push({ ...entry, reason: exemption.reason })
      else undeclared.push(entry)
    }
  }

  for (const entry of declared) {
    console.log(`  allowed: ${entry.file} > ${entry.name}`)
    console.log(`           ${entry.reason}`)
  }

  if (empty.length > 0) {
    console.error(`\n✗ ${empty.length} report(s) contain no tests at all:\n`)

    for (const report of empty) console.error(`  ${path.relative(process.cwd(), report)}`)

    console.error(
      `\nA suite that runs nothing prints a green summary and exits zero. Either the` +
        `\nfiles moved, a pattern stopped matching, or a filter was left on the command` +
        `\nline — and none of those is a passing build.`,
    )

    return 1
  }

  if (undeclared.length > 0) {
    console.error(`\n✗ ${undeclared.length} test(s) were skipped and not allow-listed:\n`)

    for (const entry of undeclared) {
      console.error(`  ${entry.file} > ${entry.name}`)
    }

    console.error(
      `\nA skipped test reports as neither a pass nor a failure, so a build that skips one` +
        `\nstill reads as green. Either make it run, or add it to ${path.relative(process.cwd(), ALLOWLIST)}` +
        `\nwith a reason a reviewer can weigh.`,
    )

    return 1
  }

  console.log(
    `\nSkipped-test check: OK — ${ran} case(s) ran across ${reports.length} report(s); ` +
      `${total} skipped, ${declared.length} allow-listed, 0 undeclared.`,
  )

  return 0
}

process.exit(main())
