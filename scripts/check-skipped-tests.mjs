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

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { casesIn, readAllowlist, readReport, skippedIn } from './lib/vitest-reports.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ALLOWLIST = path.join(HERE, 'skipped-tests-allowlist.json')

/*
 * The allow-list reader, the case counter and the "did not run" vocabulary live
 * in ./lib/vitest-reports.mjs, shared with verify-tests-fresh.mjs. Two copies of
 * the vocabulary is how this checker once matched `pending` for its whole early
 * life while Vitest wrote `skipped` — see the library's header.
 */

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
    allowlist = readAllowlist(ALLOWLIST)
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
      const parsed = readReport(report)

      skipped = skippedIn(parsed, report)

      const cases = casesIn(parsed)

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
