/**
 * The skipped-test checker, checked.
 *
 * `scripts/check-skipped-tests.mjs` is a required CI gate, and for its whole
 * life before this suite it was looking for the wrong word. Vitest's JSON
 * reporter borrows Jest's *shape* but not all of its *vocabulary*: Jest writes
 * `pending` for a case that did not run, Vitest writes `skipped`. The checker
 * matched `pending` and `todo`, so it read every real Vitest report as clean.
 *
 * That is not a theoretical gap. It reported
 *
 *     Skipped-test check: OK — 0 skipped, 0 allow-listed, 0 undeclared.
 *
 * on a report holding five genuinely skipped cases, and would have said the same
 * on the run where 156 cases skipped themselves because PostgreSQL was
 * unreachable — the exact scenario the file's own header says it exists to catch.
 *
 * `language-policy.test.js` states the principle this suite is built on: a
 * checker that passes because it is not looking is worse than no checker,
 * because it reports OK while the thing it exists to prevent sits in the tree.
 * So every case below builds a report a real reporter could have written, runs
 * the real script against it, and asserts on the real exit code.
 *
 * The allow-list is deliberately not exercised. The script resolves it next to
 * itself, so testing that path would mean writing to the repository's real
 * `skipped-tests-allowlist.json` — and a crashed test that leaves an entry
 * behind would weaken the gate it is meant to defend.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const checker = path.join(repoRoot, 'scripts', 'check-skipped-tests.mjs')

/** Temporary directories made by the current test, removed however it ends. */
let made = []

afterEach(() => {
  for (const directory of made) rmSync(directory, { force: true, recursive: true })

  made = []
})

/**
 * One assertion result, shaped as Vitest's JSON reporter writes it.
 *
 * @param {string} title The case name.
 * @param {string} status `passed`, `skipped`, `pending`, `todo` or `failed`.
 * @returns {object} The assertion result.
 */
function assertion(title, status) {
  return { ancestorTitles: ['a suite'], title, status, failureMessages: [] }
}

/**
 * Write a report to a fresh directory and return its path.
 *
 * `numTotalTests` is written because the real reporter writes it and the
 * checker's case counter prefers it — a report that omitted it would exercise a
 * different branch than CI does.
 *
 * @param {ReadonlyArray<object>} assertions The cases in the report.
 * @returns {string} Path to the report on disk.
 */
function report(assertions) {
  const directory = mkdtempSync(path.join(tmpdir(), 'skip-check-'))

  made.push(directory)

  const file = path.join(directory, 'vitest-report.json')

  writeFileSync(
    file,
    JSON.stringify({
      numTotalTests: assertions.length,
      testResults: [{ name: path.join(directory, 'some.test.js'), assertionResults: assertions }],
    }),
    'utf8',
  )

  return file
}

/**
 * Run the real checker over these reports.
 *
 * @param {...string} files Report paths.
 * @returns {{code: number, output: string}} Exit code and combined output.
 */
function check(...files) {
  try {
    const output = execFileSync('node', [checker, ...files], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { code: 0, output }
  } catch (error) {
    return {
      code: error.status,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

describe('the status vocabulary', () => {
  it('fails on `skipped`, which is the word Vitest actually writes', () => {
    const { code, output } = check(
      report([assertion('ran', 'passed'), assertion('did not', 'skipped')]),
    )

    expect(code).toBe(1)
    expect(output).toContain('did not')
  })

  it('still fails on `pending`, which is the word Jest writes', () => {
    const { code } = check(report([assertion('ran', 'passed'), assertion('did not', 'pending')]))

    expect(code).toBe(1)
  })

  it('still fails on `todo`', () => {
    const { code } = check(report([assertion('ran', 'passed'), assertion('did not', 'todo')]))

    expect(code).toBe(1)
  })

  it('passes a report where every case ran', () => {
    const { code, output } = check(report([assertion('one', 'passed'), assertion('two', 'passed')]))

    expect(code).toBe(0)
    expect(output).toContain('0 skipped')
  })

  it('names the file and the full case path, so a reviewer need not go hunting', () => {
    const { output } = check(report([assertion('the case that did not run', 'skipped')]))

    expect(output).toContain('some.test.js')
    expect(output).toContain('a suite > the case that did not run')
  })
})

describe('the count', () => {
  it('reports every skip across several reports, not just the first', () => {
    const { code, output } = check(
      report([assertion('one', 'skipped')]),
      report([assertion('two', 'skipped')]),
    )

    expect(code).toBe(1)
    expect(output).toContain('2 test(s) were skipped')
  })

  it('refuses a report that ran nothing at all', () => {
    const { code, output } = check(report([]))

    expect(code).toBe(1)
    expect(output).toContain('no tests at all')
  })

  it('counts the cases that did run', () => {
    const { output } = check(report([assertion('one', 'passed'), assertion('two', 'passed')]))

    expect(output).toContain('2 case(s) ran')
  })
})

describe('the shape of a real skipped file', () => {
  /**
   * What `describe.skip` produces: every case skipped, none passed.
   *
   * This is the `redis-integration.test.js` case that the old checker read as
   * clean — five cases, `numPendingTests: 5`, `numPassedTests: 0`, and every
   * assertion carrying `status: "skipped"`.
   */
  it('fails a file whose whole suite was skipped', () => {
    const { code, output } = check(
      report([
        assertion('carries a payload through Redis', 'skipped'),
        assertion('applies the queue retry policy', 'skipped'),
        assertion('sweeps real holds', 'skipped'),
        assertion('fails a malformed payload', 'skipped'),
        assertion('registers both repeatable jobs', 'skipped'),
      ]),
    )

    expect(code).toBe(1)
    expect(output).toContain('5 test(s) were skipped')
    expect(output).not.toContain('0 skipped')
  })
})
