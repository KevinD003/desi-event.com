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
 * Build a Vitest `test` options object for a Node package.
 *
 * @param {object} [options] Overrides.
 * @param {string[]} [options.include] Test file globs.
 * @param {string[]} [options.setupFiles] Setup files to run before each suite.
 * @param {object} [options.coverageThresholds] Coverage thresholds to enforce.
 * @returns {object} Vitest `test` configuration.
 */
export function nodeTestConfig(options = {}) {
  const {
    include = ['src/**/*.test.js', 'tests/**/*.test.js'],
    setupFiles = [],
    coverageThresholds = strictCoverageThresholds,
  } = options

  return {
    environment: 'node',
    globals: false,
    include,
    setupFiles,
    restoreMocks: true,
    clearMocks: true,
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
