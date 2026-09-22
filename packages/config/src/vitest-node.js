/**
 * Shared Vitest options for Node.js packages (no DOM).
 *
 * Consumers spread this into their own `defineConfig` call so that individual
 * packages can still add plugins or setup files.
 *
 * @module @desi-event/config/vitest-node
 */

/**
 * Coverage thresholds applied to pure-logic packages, where the absence of a
 * compiler makes tests the primary correctness guarantee.
 *
 * @type {{lines: number, functions: number, branches: number, statements: number}}
 */
export const strictCoverageThresholds = {
  lines: 80,
  functions: 80,
  branches: 75,
  statements: 80,
}

/**
 * How long one test may take before it is called hung.
 *
 * Vitest's default is five seconds, and that is wrong for this repository in a
 * way that took two failed verification runs to see. `pnpm run test` fans
 * sixteen Vitest projects out through Turborepo at once; several of them —
 * the refund, reserved-seat and ticket concurrency suites — run *deliberately
 * contended* transactions against real PostgreSQL, taking row locks and racing
 * each other on purpose. On a four-core machine, with sixteen other projects
 * competing, a test whose real work is 300 ms can sit in the run queue long
 * enough to pass five seconds.
 *
 * What that produced was not an honest failure. It was a different test failing
 * on each run — `packages/db` round-tripping a row one time,
 * `refund-concurrency` reserving an order the next — and, because a timed-out
 * file contributes no coverage, `apps/api` branch coverage sliding from 75.09%
 * to 73.25% under its own 75% floor without a line of code changing. Two gates
 * made non-deterministic by a clock.
 *
 * GitHub's runners have **two** cores, so CI would have been worse than this
 * machine, and a required check that flakes is a required check people learn to
 * re-run — which is the exact habit every other document here forbids.
 *
 * Thirty seconds, and the number is a judgement rather than a guess: it is
 * sixty times the median database test and still short enough that a genuinely
 * hung test fails the build in half a minute instead of hanging until the job
 * times out. **No assertion is relaxed by this.** A concurrency test that
 * demands exactly one winner demands it just as strictly with more patience;
 * what changes is only how long the runner waits before deciding nobody is
 * coming.
 *
 * @type {number}
 */
export const DATABASE_FRIENDLY_TIMEOUT_MS = 30_000

/**
 * Build a Vitest `test` options object for a Node package.
 *
 * @param {object} [options] Overrides.
 * @param {string[]} [options.include] Test file globs.
 * @param {string[]} [options.setupFiles] Setup files to run before each suite.
 * @param {object} [options.coverageThresholds] Coverage thresholds to enforce.
 * @param {number} [options.testTimeout] How long one test may take.
 * @returns {object} Vitest `test` configuration.
 */
export function nodeTestConfig(options = {}) {
  const {
    include = ['src/**/*.test.js', 'tests/**/*.test.js'],
    setupFiles = [],
    coverageThresholds = strictCoverageThresholds,
    testTimeout = DATABASE_FRIENDLY_TIMEOUT_MS,
  } = options

  return {
    environment: 'node',
    globals: false,
    include,
    setupFiles,
    restoreMocks: true,
    clearMocks: true,
    testTimeout,
    // The same reasoning applies to `beforeAll`, which is where the database
    // suites seed their fixtures: seeding a world of orders and tickets is more
    // work than any single test in the file that follows it.
    hookTimeout: testTimeout,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'src/index.js'],
      thresholds: coverageThresholds,
    },
  }
}

export default nodeTestConfig
