/**
 * The fresh-report command, checked against the ways reports have gone stale.
 *
 * `scripts/verify-tests-fresh.mjs` exists because this repository has more than
 * once presented a stale report's numbers as a fresh run's. A command built to
 * stop that is only worth what it refuses, so every case below builds a
 * repository-shaped fixture, drives the real `verifyTestsFresh` with a runner
 * standing in for Turborepo, and asserts on the verdict.
 *
 * The runner is the one seam. Turborepo is replaced, never the judging: a
 * runner that writes nothing is exactly what a Turborepo cache hit is, and a
 * runner that restores yesterday's report with today's timestamp is exactly
 * what a cache holding the report as an output would do. Both are refused, and
 * the tests below are the proof rather than the description.
 *
 * Nothing touches the real repository's reports or allow-list: every fixture is
 * a temporary directory, removed however the test ends.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MTIME_ALLOWANCE_MS,
  buildTurboArgv,
  expectedFromPlan,
  printVerdict,
  verifyTestsFresh,
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

  it('declares the variables the suites read, so Turborepo does not strip them', () => {
    // Before this declaration, REQUIRE_DATABASE set workflow-wide in CI reached
    // no test process: strict environment mode removed it.
    const turbo = JSON.parse(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))

    expect(turbo.globalEnv).toEqual(
      expect.arrayContaining(['REQUIRE_DATABASE', 'TEST_DATABASE_URL']),
    )
  })
})
