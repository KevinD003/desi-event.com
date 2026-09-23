/**
 * The fresh-report command, checked against the ways reports have gone stale.
 *
 * `scripts/verify-tests-fresh.mjs` exists because this repository has more than
 * once presented a stale report's numbers as a fresh run's. A command built to
 * stop that is only worth what it refuses, so every case below builds a
 * repository-shaped fixture, drives the real `verifyTestsFresh` with a runner
 * standing in for Turborepo, and asserts on the verdict.
 *
 * The runner is the main seam. Turborepo is replaced, never the judging: a
 * runner that writes nothing is exactly what a Turborepo cache hit is, and a
 * runner that restores yesterday's report with today's timestamp is exactly
 * what a cache holding the report as an output would do. Both are refused, and
 * the tests below are the proof rather than the description. The other seam is
 * the function that deletes one report, replaced only to make it fail.
 *
 * Nothing touches the real repository's reports or allow-list: every fixture is
 * a temporary directory, removed however the test ends.
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MTIME_ALLOWANCE_MS,
  SUMMARY_PATH,
  buildTurboArgv,
  expectedFromPlan,
  printVerdict,
  verifyTestsFresh,
  writeSummary,
} from '../../../scripts/verify-tests-fresh.mjs'
import { REPORT_NAME } from '../../../scripts/lib/vitest-reports.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A fixed clock for the run, so "before" and "after" mean something exact. */
const RUN_STARTS = Date.parse('2026-09-22T12:00:00.000Z')

/** Fixture roots made by the current test. */
let made = []

afterEach(() => {
  for (const directory of made) rmSync(directory, { force: true, recursive: true })

  made = []
})

/**
 * A repository-shaped fixture with two packages.
 *
 * @returns {{root: string, expected: Array<{name: string, directory: string}>}} The fixture.
 */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-fresh-'))

  made.push(root)

  const expected = ['alpha', 'beta'].map((name) => {
    const directory = path.join(root, 'packages', name)

    mkdirSync(directory, { recursive: true })

    return { name: `@fixture/${name}`, directory }
  })

  return { root, expected }
}

/**
 * A temporary directory outside the fixture, removed with it.
 *
 * @returns {string} Its path.
 */
function elsewhere() {
  const directory = mkdtempSync(path.join(tmpdir(), 'verify-fresh-elsewhere-'))

  made.push(directory)

  return directory
}

/**
 * Whether anything, a dangling link included, is at a path.
 *
 * @param {string} file The path.
 * @returns {boolean} True when something is there.
 */
function present(file) {
  try {
    lstatSync(file)

    return true
  } catch {
    return false
  }
}

/**
 * One assertion result, as Vitest's JSON reporter writes it.
 *
 * @param {string} title The case name.
 * @param {string} [status] Its status.
 * @returns {object} The assertion.
 */
function assertion(title, status = 'passed') {
  return { ancestorTitles: ['a suite'], title, status, failureMessages: [] }
}

/**
 * A report as Vitest writes one, with the fields the command reads.
 *
 * @param {string} directory The package directory.
 * @param {object} [options] Options.
 * @param {number} [options.startTime] When the described run began.
 * @param {Array<object>} [options.assertions] The cases.
 * @param {object} [options.extra] Fields merged over the top level.
 * @returns {object} The report.
 */
function reportFor(
  directory,
  { startTime = RUN_STARTS + 1_000, assertions = [assertion('works')], extra = {} } = {},
) {
  const failed = assertions.filter((a) => a.status === 'failed').length

  return {
    numTotalTests: assertions.length,
    numPassedTests: assertions.filter((a) => a.status === 'passed').length,
    numFailedTests: failed,
    numPendingTests: assertions.filter((a) => a.status === 'skipped' || a.status === 'pending')
      .length,
    numTodoTests: assertions.filter((a) => a.status === 'todo').length,
    startTime,
    success: failed === 0,
    testResults: [
      { name: path.join(directory, 'src', 'thing.test.js'), assertionResults: assertions },
    ],
    ...extra,
  }
}

/**
 * Write a report and set its modification time.
 *
 * @param {string} directory The package directory.
 * @param {object|string} content The report, or raw text.
 * @param {number} [mtime] The modification time, epoch milliseconds.
 * @returns {string} The report path.
 */
function write(directory, content, mtime = RUN_STARTS + 5_000) {
  const file = path.join(directory, REPORT_NAME)

  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  utimesSync(file, mtime / 1_000, mtime / 1_000)

  return file
}

/**
 * A runner that behaves as a clean, successful Turborepo run.
 *
 * @param {Array<{directory: string}>} expected The packages.
 * @param {function(string): (object|string|null)} [contentFor] Report per directory; null writes none.
 * @param {number} [exitCode] What the run exits with.
 * @returns {function(): Promise<number>} The runner.
 */
function runner(expected, contentFor = (directory) => reportFor(directory), exitCode = 0) {
  return async () => {
    for (const { directory } of expected) {
      const content = contentFor(directory)

      if (content !== null) write(directory, content)
    }

    return exitCode
  }
}

/**
 * Run the command against a fixture with a fixed clock.
 *
 * @param {object} options What `verifyTestsFresh` takes, minus the clock.
 * @returns {Promise<object>} The verdict.
 */
function verify(options) {
  return verifyTestsFresh({ now: () => RUN_STARTS, ...options })
}

describe('a clean run', () => {
  it('passes, and counts every package and every case', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        reportFor(d, { assertions: [assertion('a'), assertion('b')] }),
      ),
    })

    expect(verdict.problems).toEqual([])
    expect(verdict.exitCode).toBe(0)
    expect(verdict.totals).toMatchObject({ packages: 2, files: 2, tests: 4, passed: 4, failed: 0 })
  })

  it('prints a table and an OK line a CI log reader can find', async () => {
    const { root, expected } = fixture()
    const verdict = await verify({ root, expected, runTests: runner(expected) })
    const lines = []

    printVerdict(verdict, (line) => lines.push(line))

    const text = lines.join('\n')

    expect(text).toContain('@fixture/alpha')
    expect(text).toContain('@fixture/beta')
    expect(text).toMatch(/Fresh-report verification: OK — 2 case\(s\) ran across 2 fresh report/u)
  })
})

describe('what it deletes before running', () => {
  it('removes every existing report, so nothing old can be read as new', async () => {
    const { root, expected } = fixture()
    const stray = path.join(root, 'apps', 'old')

    mkdirSync(stray, { recursive: true })

    for (const { directory } of [...expected, { directory: stray }]) {
      write(directory, reportFor(directory), RUN_STARTS - 86_400_000)
    }

    const onDiskWhenTheRunStarted = []

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        // Observed from inside the run, before it writes anything.
        for (const { directory } of [...expected, { directory: stray }]) {
          onDiskWhenTheRunStarted.push(existsSync(path.join(directory, REPORT_NAME)))
        }

        return runner(expected)()
      },
    })

    expect(onDiskWhenTheRunStarted).toEqual([false, false, false])
    expect(verdict.deleted).toHaveLength(3)
    expect(verdict.problems).toEqual([])
  })

  it('deletes a report that is a symbolic link — the link, not what it points at', async () => {
    // A walk that asks only "is this a file?" never sees a link, so the old
    // report behind it survived the deletion step, and Vitest then wrote this
    // run's report through the link into someone else's file.
    const { root, expected } = fixture()
    const target = path.join(elsewhere(), REPORT_NAME)
    const link = path.join(expected[0].directory, REPORT_NAME)
    const old = JSON.stringify(reportFor(expected[0].directory, { startTime: RUN_STARTS - 60_000 }))

    writeFileSync(target, old, 'utf8')
    symlinkSync(target, link)

    let linkWhenTheRunStarted

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        linkWhenTheRunStarted = present(link)

        return runner(expected)()
      },
    })

    expect(linkWhenTheRunStarted).toBe(false)
    expect(verdict.deleted).toContain(link)
    expect(readFileSync(target, 'utf8')).toBe(old)
    expect(verdict.problems).toEqual([])
  })

  it.each(['EACCES', 'EPERM', 'EBUSY'])(
    'refuses the run, before it starts, when a report cannot be deleted (%s)',
    async (failure) => {
      // A read-only directory does not stop root, which some runners are, so
      // the failure is injected where the command deletes. The report is left
      // in place, and judging a run against it is what this command exists to
      // stop.
      const { root, expected } = fixture()

      write(expected[0].directory, reportFor(expected[0].directory), RUN_STARTS - 60_000)

      let ran = false

      const verdict = await verify({
        root,
        expected,
        remove: (file) => {
          throw Object.assign(new Error(`${failure}: refused, unlink '${file}'`), {
            code: failure,
          })
        },
        runTests: async () => {
          ran = true

          return runner(expected)()
        },
      })

      expect(ran).toBe(false)
      expect(verdict.exitCode).toBe(1)
      expect(verdict.runStartedAt).toBeNull()
      expect(verdict.problems).toEqual([
        expect.stringMatching(
          new RegExp(
            `^could not delete packages/alpha/vitest-report\\.json before the run \\(${failure}: refused`,
            'u',
          ),
        ),
      ])

      const lines = []

      printVerdict(verdict, (line) => lines.push(line))

      const text = lines.join('\n')

      expect(text).toContain('The test run was not started; 0 report(s) deleted beforehand.')
      expect(text).toMatch(/✗ Fresh-report verification refused this run \(1 problem\(s\)\)/u)
    },
  )

  it('treats a report that vanished before it could be deleted as deleted', async () => {
    const { root, expected } = fixture()

    write(expected[0].directory, reportFor(expected[0].directory), RUN_STARTS - 60_000)

    const verdict = await verify({
      root,
      expected,
      remove: (file) => {
        rmSync(file)
        throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${file}'`), {
          code: 'ENOENT',
        })
      },
      runTests: runner(expected),
    })

    expect(verdict.problems).toEqual([])
    expect(verdict.exitCode).toBe(0)
  })

  it('refuses the run, before it starts, when a directory link hides what is behind it', async () => {
    // The scan does not follow a link to a directory — it could lead back up
    // the tree or out of the repository — so a report behind one could be
    // neither deleted nor noticed. That is said, not passed over.
    const { root, expected } = fixture()
    const hidden = elsewhere()

    writeFileSync(path.join(hidden, REPORT_NAME), JSON.stringify(reportFor(hidden)), 'utf8')
    symlinkSync(hidden, path.join(root, 'packages', 'linked'))

    let ran = false

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        ran = true

        return runner(expected)()
      },
    })

    expect(ran).toBe(false)
    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /packages\/linked is a symbolic link to a directory, which the report scan does not follow/u,
    )
    expect(existsSync(path.join(hidden, REPORT_NAME))).toBe(true)
  })
})

describe('the stale-report failure modes', () => {
  it('refuses a missing report — what a Turborepo cache hit leaves behind', async () => {
    // A cache hit replays logs and restores `coverage/**`. It never runs Vitest,
    // so it writes no report. The old report was deleted before the run, so
    // the package is simply missing — and that is refused, not counted as zero.
    const { root, expected } = fixture()

    for (const { directory } of expected)
      write(directory, reportFor(directory), RUN_STARTS - 60_000)

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => (d === expected[0].directory ? null : reportFor(d))),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /@fixture\/alpha: expected a report and none was written/u,
    )
  })

  it('refuses a cached result that leaves an old report unchanged on disk', async () => {
    // The same cache hit, but with the deletion step bypassed — as it would be
    // if somebody ran only the judging half by hand. The file is yesterday's in
    // every sense: written before the run, describing a run before this one.
    const { root, expected } = fixture()
    const yesterday = RUN_STARTS - 86_400_000

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        // Put the old report back exactly as it was, as though never deleted.
        for (const { directory } of expected) {
          write(directory, reportFor(directory, { startTime: yesterday }), yesterday)
        }

        return 0
      },
    })

    const said = verdict.problems.join('\n')

    expect(verdict.exitCode).toBe(1)
    expect(said).toMatch(/last written .* before this run began/u)
    expect(said).toMatch(/describes a run that started .* before this one/u)
  })

  it('refuses a report restored with a fresh timestamp and old contents', async () => {
    // What a cache holding the report as an output would do: the file is
    // written now, so its modification time is fresh, and everything inside it
    // is from an earlier run. Only the startTime Vitest records can tell.
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => reportFor(d, { startTime: RUN_STARTS - 3_600_000 })),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(/a replayed or restored report/u)
  })

  it('refuses a report with no startTime, because its age cannot be proved', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => ({ ...reportFor(d), startTime: undefined })),
    })

    expect(verdict.problems.join('\n')).toMatch(/carries no startTime/u)
  })

  it('refuses a report stamped a year in the future', async () => {
    // Held only to the run's start, a startTime of next year passed: it is
    // after the run began. No run this command started can have begun later
    // than the moment its report is judged.
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => reportFor(d, { startTime: RUN_STARTS + 365 * 86_400_000 })),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /@fixture\/alpha: the report describes a run that started 2027-09-22T12:00:00\.000Z, after this one was judged at .* a report stamped in the future/u,
    )
  })

  it('judges the future from when the report is read, not from when the run began', async () => {
    // A real run takes minutes, and every report in it starts after the run
    // does. The bound is the moment of judging plus the allowance.
    const judgedAt = RUN_STARTS + 600_000

    /**
     * Verify with a clock that reads the run's start, then the moment of judging.
     *
     * @param {number} startTime The startTime every report carries.
     * @returns {Promise<object>} The verdict.
     */
    async function judged(startTime) {
      const { root, expected } = fixture()
      const readings = [RUN_STARTS, judgedAt]

      return verify({
        root,
        expected,
        now: () => readings.shift(),
        runTests: runner(expected, (d) => reportFor(d, { startTime })),
      })
    }

    expect((await judged(RUN_STARTS + 300_000)).problems).toEqual([])
    expect((await judged(judgedAt + MTIME_ALLOWANCE_MS)).problems).toEqual([])

    const beyond = await judged(judgedAt + MTIME_ALLOWANCE_MS + 1)

    expect(beyond.exitCode).toBe(1)
    expect(beyond.problems.join('\n')).toMatch(/a report stamped in the future/u)
  })

  it('allows a modification time a coarse filesystem rounded down, and no more', async () => {
    const { root, expected } = fixture()

    const within = await verify({
      root,
      expected,
      runTests: async () => {
        for (const { directory } of expected) {
          write(directory, reportFor(directory), RUN_STARTS - MTIME_ALLOWANCE_MS + 1)
        }

        return 0
      },
    })

    expect(within.problems).toEqual([])

    const beyond = await verify({
      root,
      expected,
      runTests: async () => {
        for (const { directory } of expected) {
          write(directory, reportFor(directory), RUN_STARTS - MTIME_ALLOWANCE_MS - 1)
        }

        return 0
      },
    })

    expect(beyond.exitCode).toBe(1)
  })
})

describe('reports that cannot be read', () => {
  it('refuses a malformed report', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        d === expected[0].directory ? '{"testResults": [' : reportFor(d),
      ),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(/@fixture\/alpha: the report is malformed/u)
  })

  it('refuses valid JSON that is not a report', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        d === expected[1].directory ? { hello: 'world' } : reportFor(d),
      ),
    })

    expect(verdict.problems.join('\n')).toMatch(
      /@fixture\/beta: the report is malformed \(the report has no testResults array\)/u,
    )
  })

  it('refuses an empty report', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => (d === expected[0].directory ? '' : reportFor(d))),
    })

    expect(verdict.problems.join('\n')).toMatch(/@fixture\/alpha: the report is empty/u)
  })
})

describe('what a report may not contain', () => {
  it('refuses a report containing skipped tests', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        reportFor(d, { assertions: [assertion('ran'), assertion('did not', 'skipped')] }),
      ),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(/skipped, not allow-listed: .*a suite > did not/u)
  })

  it('refuses `todo` and Jest’s `pending` too', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        reportFor(d, {
          assertions:
            d === expected[0].directory
              ? [assertion('ran'), assertion('later', 'todo')]
              : [assertion('ran'), assertion('old word', 'pending')],
        }),
      ),
    })

    const said = verdict.problems.join('\n')

    expect(said).toMatch(/todo, not allow-listed/u)
    expect(said).toMatch(/pending, not allow-listed/u)
  })

  it('accepts a skip that is allow-listed with a reason, and says so', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      allowlist: [
        { pattern: 'a suite > deliberately', reason: 'Needs hardware this runner lacks.' },
      ],
      runTests: runner(expected, (d) =>
        reportFor(d, { assertions: [assertion('ran'), assertion('deliberately', 'skipped')] }),
      ),
    })

    expect(verdict.problems).toEqual([])
    expect(verdict.packages[0].allowed.join('\n')).toContain('Needs hardware this runner lacks.')
  })

  it('refuses a failed test even when the run itself exited zero', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        reportFor(d, { assertions: [assertion('broke', 'failed')] }),
      ),
    })

    expect(verdict.problems.join('\n')).toMatch(/1 test\(s\) failed/u)
  })

  it('refuses a package that ran no tests at all', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        d === expected[0].directory
          ? { ...reportFor(d, { assertions: [] }), testResults: [] }
          : reportFor(d),
      ),
    })

    expect(verdict.problems.join('\n')).toMatch(/@fixture\/alpha: the package ran no tests at all/u)
  })

  it('refuses one test file with no tests inside a package that ran plenty', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => {
        const report = reportFor(d, { assertions: [assertion('a'), assertion('b')] })

        report.testResults.push({
          name: path.join(d, 'src', 'hollow.test.js'),
          assertionResults: [],
        })

        return report
      }),
    })

    expect(verdict.problems.join('\n')).toMatch(
      /a test file collected no tests: .*hollow\.test\.js/u,
    )
  })

  it('refuses a report whose counters disagree with the cases it lists', async () => {
    // How the checker went blind once: the reporter counted skipped cases under
    // a status word nobody was matching. Counters that exceed the listed skips
    // mean the vocabulary has moved again.
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => reportFor(d, { extra: { numPendingTests: 3 } })),
    })

    expect(verdict.problems.join('\n')).toMatch(
      /counts 3 pending or todo case\(s\) but lists only 0/u,
    )
  })

  it.each([
    ['numTotalTests', 10, /counts 10 case\(s\) \(numTotalTests\) but lists 1/u],
    ['numPassedTests', 0, /counts 0 passed case\(s\) \(numPassedTests\) but lists 1/u],
    ['numFailedTests', 2, /counts 2 failed case\(s\) \(numFailedTests\) but lists 0/u],
  ])(
    'refuses a report whose %s disagrees with the cases it lists',
    async (counter, value, said) => {
      const { root, expected } = fixture()

      const verdict = await verify({
        root,
        expected,
        runTests: runner(expected, (d) => reportFor(d, { extra: { [counter]: value } })),
      })

      expect(verdict.exitCode).toBe(1)
      expect(verdict.problems.join('\n')).toMatch(said)
    },
  )

  it('refuses a case whose status it does not know, rather than counting it as nothing', async () => {
    // Vitest 5 cannot write one today; a later reporter could, and a report of
    // nothing but such cases would otherwise pass, fail and skip nothing.
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        reportFor(d, { assertions: [assertion('ran'), assertion('switched off', 'disabled')] }),
      ),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /a case with a status this checker does not know \("disabled"\).*a suite > switched off/u,
    )
  })

  it('refuses a test file that failed outside its cases, though every case passed', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => {
        const report = reportFor(d, { extra: { success: false, numFailedTestSuites: 1 } })

        report.testResults[0].status = 'failed'
        report.testResults[0].message = 'afterAll hook failed\n    at teardown'

        return report
      }),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /a test file failed outside its cases \(afterAll hook failed\): .*thing\.test\.js/u,
    )
  })

  it('refuses a report that says the run did not succeed, even with nothing marked failed', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => reportFor(d, { extra: { success: false } })),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /the report says the run did not succeed, though no case or file is marked failed/u,
    )
  })

  it.each([
    ['a null entry', { testResults: [null] }, /testResults\[0\] is not an object/u],
    [
      'a case with no status',
      { testResults: [{ name: 'x.test.js', assertionResults: [{ title: 'no status' }] }] },
      /a case in testResults\[0\] has no status/u,
    ],
    [
      'cases that are not a list',
      { testResults: [{ name: 'x.test.js', assertionResults: 'nope' }] },
      /testResults\[0\] has no assertionResults array/u,
    ],
  ])('refuses %s as malformed instead of crashing on it', async (_, broken, said) => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) =>
        d === expected[1].directory ? { ...reportFor(d), ...broken } : reportFor(d),
      ),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(said)
  })
})

describe('which packages must report', () => {
  it('refuses a package expected to run that produced no report', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => (d === expected[1].directory ? null : reportFor(d))),
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.packages[1].totals).toBeNull()
    expect(verdict.problems.join('\n')).toMatch(
      /@fixture\/beta: expected a report and none was written/u,
    )
  })

  it('refuses a report that appeared where no package was expected to write one', async () => {
    const { root, expected } = fixture()
    const unexpected = path.join(root, 'packages', 'gamma')

    mkdirSync(unexpected, { recursive: true })

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        await runner(expected)()
        write(unexpected, reportFor(unexpected))

        return 0
      },
    })

    expect(verdict.problems.join('\n')).toMatch(/appeared where no package was expected.*gamma/u)
  })

  it('refuses a report that is a symbolic link, even to a report this run wrote', async () => {
    // Every timestamp behind the link is fresh: it is the other package's
    // report. Vitest writes a file, so a link is something else's doing.
    const { root, expected } = fixture()
    const [alpha, beta] = expected

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        const betaReport = write(beta.directory, reportFor(beta.directory))

        symlinkSync(betaReport, path.join(alpha.directory, REPORT_NAME))

        return 0
      },
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.packages[0].totals).toBeNull()
    expect(verdict.problems).toEqual([
      '@fixture/alpha: the report is a symbolic link, not a file this run wrote — ' +
        'packages/alpha/vitest-report.json',
    ])
  })

  it('refuses a symbolic-link report that appeared where no package was expected', async () => {
    const { root, expected } = fixture()
    const unexpected = path.join(root, 'packages', 'gamma')

    mkdirSync(unexpected, { recursive: true })

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        await runner(expected)()
        symlinkSync(
          path.join(expected[1].directory, REPORT_NAME),
          path.join(unexpected, REPORT_NAME),
        )

        return 0
      },
    })

    expect(verdict.problems.join('\n')).toMatch(
      /appeared where no package was expected to write one: packages\/gamma\/vitest-report\.json/u,
    )
  })

  it('refuses a directory link that appeared during the run', async () => {
    const { root, expected } = fixture()
    const hidden = elsewhere()

    const verdict = await verify({
      root,
      expected,
      runTests: async () => {
        await runner(expected)()
        writeFileSync(path.join(hidden, REPORT_NAME), JSON.stringify(reportFor(hidden)), 'utf8')
        symlinkSync(hidden, path.join(root, 'packages', 'gamma'))

        return 0
      },
    })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems.join('\n')).toMatch(
      /packages\/gamma is a symbolic link to a directory, which the report scan does not follow/u,
    )
  })

  it('reads the expected set from Turborepo’s plan, ignoring tasks with no script', () => {
    const plan = {
      tasks: [
        { task: 'test', package: '@x/b', directory: 'packages/b', command: 'vitest run' },
        { task: 'test', package: '@x/a', directory: 'apps/a', command: 'vitest run' },
        { task: 'test', package: '@x/none', directory: 'packages/none', command: '<NONEXISTENT>' },
        { task: 'build', package: '@x/a', directory: 'apps/a', command: 'next build' },
      ],
    }

    expect(expectedFromPlan(plan, '/repo')).toEqual([
      { name: '@x/a', directory: path.resolve('/repo', 'apps/a') },
      { name: '@x/b', directory: path.resolve('/repo', 'packages/b') },
    ])
  })
})

describe('the summary CI prints last', () => {
  it('holds the table and the OK line, exactly as printed', async () => {
    const { root, expected } = fixture()
    const verdict = await verify({ root, expected, runTests: runner(expected) })
    const file = path.join(root, SUMMARY_PATH)
    const lines = []

    printVerdict(verdict, (line) => lines.push(line))
    writeSummary(verdict, file)

    const summary = readFileSync(file, 'utf8')

    expect(summary).toBe(`${lines.join('\n')}\n`)
    expect(summary).toMatch(/^package +files +tests +passed +failed +skipped {2}verdict$/mu)
    expect(summary).toMatch(/^@fixture\/alpha +1 +1 +1 +0 +0 {2}ok$/mu)
    expect(summary).toMatch(/^@fixture\/beta +1 +1 +1 +0 +0 {2}ok$/mu)
    expect(summary).toMatch(
      /Fresh-report verification: OK — 2 case\(s\) ran across 2 fresh report/u,
    )
  })

  it('holds the refusal when the run is refused', async () => {
    const { root, expected } = fixture()
    const verdict = await verify({
      root,
      expected,
      runTests: runner(expected, (d) => (d === expected[0].directory ? null : reportFor(d))),
    })
    const file = path.join(root, SUMMARY_PATH)

    writeSummary(verdict, file)

    const summary = readFileSync(file, 'utf8')

    expect(summary).toMatch(/^@fixture\/alpha .* REFUSED$/mu)
    expect(summary).toContain('✗ Fresh-report verification refused this run (1 problem(s)):')
    expect(summary).toContain('@fixture/alpha: expected a report and none was written')
    expect(summary).not.toContain('Fresh-report verification: OK')
  })

  it('lives where git ignores it, and is what CI prints', () => {
    const ignored = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split('\n')
    const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')

    expect(ignored).toContain(`${SUMMARY_PATH.split('/')[0]}/`)
    expect(workflow).toContain(`run: cat ${SUMMARY_PATH}\n`)
  })
})

describe('the run itself', () => {
  it('fails when the test run fails, even if every report is clean', async () => {
    const { root, expected } = fixture()

    const verdict = await verify({ root, expected, runTests: runner(expected, undefined, 1) })

    expect(verdict.exitCode).toBe(1)
    expect(verdict.problems[0]).toBe('the test run exited 1')
  })

  it('gives Turborepo its own flags and Vitest its own, and never the other way round', () => {
    // `pnpm run test -- --force` once handed `--force` to Vitest, which refused
    // it. The vector is built, not typed, and this pins which side of `--`
    // each flag lands on.
    const argv = buildTurboArgv()
    const split = argv.indexOf('--')
    const forTurbo = argv.slice(0, split)
    const forVitest = argv.slice(split + 1)

    expect(split).toBeGreaterThan(0)
    expect(forTurbo).toEqual(['run', 'test', '--force'])
    expect(forVitest).toEqual([
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${REPORT_NAME}`,
    ])
    expect(forVitest).not.toContain('--force')
    expect(forTurbo.some((arg) => arg.startsWith('--reporter'))).toBe(false)
  })

  it('awaits one child process and polls nothing', () => {
    // `until ! pgrep -f "playwright test"` matched its own shell and waited
    // forever. The command spawns once and listens for `close`.
    const source = readFileSync(path.join(repoRoot, 'scripts', 'verify-tests-fresh.mjs'), 'utf8')
    const code = source.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')

    expect(code).not.toMatch(/pgrep|setInterval|\bps\s+aux/u)
    expect(code).toMatch(/child\.on\('close'/u)
  })

  it('is what CI runs, and CI produces reports no other way', () => {
    const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
    const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts

    expect(scripts['verify:tests:fresh']).toBe('node scripts/verify-tests-fresh.mjs')
    expect(workflow).toContain('run: pnpm run verify:tests:fresh')
    expect(workflow).not.toMatch(/outputFile(\.json)?=vitest-report\.json/u)
    expect(scripts['test:report']).toBeUndefined()
  })

  it('is what the local pre-push gate runs, in place of a cacheable test run', () => {
    // `pnpm verify` ran `pnpm run test`, which Turborepo may answer from its
    // cache and which judges no report at all.
    const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
    const chain = scripts.verify.split(' && ')

    expect(chain).toContain('pnpm run verify:tests:fresh')
    expect(chain).not.toContain('pnpm run test')
    expect(chain.indexOf('pnpm run lint')).toBeLessThan(
      chain.indexOf('pnpm run verify:tests:fresh'),
    )
    expect(chain.indexOf('pnpm run verify:tests:fresh')).toBeLessThan(
      chain.indexOf('pnpm run build'),
    )
  })

  it('declares the variables the suites read, so Turborepo does not strip them', () => {
    // Before this declaration, REQUIRE_DATABASE set workflow-wide in CI reached
    // no test process: strict environment mode removed it.
    const turbo = JSON.parse(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))

    expect(turbo.globalEnv).toEqual(
      expect.arrayContaining(['REQUIRE_DATABASE', 'TEST_DATABASE_URL']),
    )
  })
})

describe('ci:check, on where the verdict lands', () => {
  const checker = path.join(repoRoot, 'scripts', 'check-ci-invariants.mjs')
  const committed = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  const summaryStep = '      - name: Fresh-report summary\n' + `        run: cat ${SUMMARY_PATH}\n`

  /**
   * Run the real checker against a copy of the committed workflow, changed.
   *
   * The checker reads `.github/workflows` and `turbo.json` from its working
   * directory, so the copy is a directory holding just those.
   *
   * @param {function(string): string} [change] Rewrites the workflow text.
   * @returns {{code: number, output: string}} Exit code and combined output.
   */
  function check(change = (text) => text) {
    const root = mkdtempSync(path.join(tmpdir(), 'ci-check-'))
    const workflows = path.join(root, '.github', 'workflows')
    const workflow = change(committed)

    made.push(root)
    expect(committed).toContain(summaryStep)
    mkdirSync(workflows, { recursive: true })
    writeFileSync(path.join(workflows, 'ci.yml'), workflow, 'utf8')
    copyFileSync(path.join(repoRoot, 'turbo.json'), path.join(root, 'turbo.json'))

    try {
      const output = execFileSync('node', [checker], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      return { code: 0, output }
    } catch (error) {
      return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  it('holds for the workflow as committed', () => {
    const { code, output } = check()

    expect(code).toBe(0)
    expect(output).toContain(`the verify job ends by printing ${SUMMARY_PATH}`)
  })

  it('refuses a verify job that never prints the summary', () => {
    const { code, output } = check((text) => text.replace(summaryStep, ''))

    expect(code).toBe(1)
    expect(output).toContain(`the verify job has no step that runs exactly "cat ${SUMMARY_PATH}"`)
  })

  it('refuses a summary step that cannot fail when the file is missing', () => {
    const { code, output } = check((text) =>
      text.replace(`run: cat ${SUMMARY_PATH}\n`, `run: cat ${SUMMARY_PATH} || true\n`),
    )

    expect(code).toBe(1)
    expect(output).toContain(`the verify job has no step that runs exactly "cat ${SUMMARY_PATH}"`)
  })

  it('refuses a summary printed before the command that writes it', () => {
    const fresh = '      - name: Test, with fresh reports and no undeclared skip\n'
    const { code, output } = check((text) =>
      text.replace(summaryStep, '').replace(fresh, `${summaryStep}\n${fresh}`),
    )

    expect(code).toBe(1)
    expect(output).toContain(
      `"cat ${SUMMARY_PATH}" runs before "pnpm run verify:tests:fresh" in the verify job`,
    )
  })

  it('refuses a step that would run after the summary on a green run', () => {
    const { code, output } = check((text) =>
      text.replace(summaryStep, `${summaryStep}\n      - name: Late\n        run: echo late\n`),
    )

    expect(code).toBe(1)
    expect(output).toContain(`"Late" run(s) after "cat ${SUMMARY_PATH}" on a green run`)
  })

  it('refuses a summary step a condition could skip on a green run', () => {
    const { code, output } = check((text) =>
      text.replace(
        summaryStep,
        summaryStep.replace('        run:', '        if: failure()\n        run:'),
      ),
    )

    expect(code).toBe(1)
    expect(output).toContain(
      `"cat ${SUMMARY_PATH}" carries "if: failure()", so a green run may skip it`,
    )
  })

  it('refuses a summary step whose failure would be swallowed', () => {
    const { code, output } = check((text) =>
      text.replace(summaryStep, `${summaryStep}        continue-on-error: true\n`),
    )

    expect(code).toBe(1)
    expect(output).toContain(
      `"cat ${SUMMARY_PATH}" carries "continue-on-error: true", so a missing summary would not fail the job`,
    )
  })
})
