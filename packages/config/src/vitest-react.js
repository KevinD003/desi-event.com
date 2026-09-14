/**
 * Shared Vitest options for React packages rendered under jsdom.
 *
 * The React plugin itself is supplied by the consuming package so that this
 * preset stays free of build-tool dependencies.
 *
 * @module @desi-event/config/vitest-react
 */

/**
 * Build a Vitest `test` options object for a React package.
 *
 * @param {object} [options] Overrides.
 * @param {string[]} [options.include] Test file globs.
 * @param {string[]} [options.setupFiles] Setup files, typically registering jest-dom matchers.
 * @returns {object} Vitest `test` configuration.
 */
export function reactTestConfig(options = {}) {
  const {
    include = ['src/**/*.test.jsx', 'src/**/*.test.js', 'tests/**/*.test.jsx'],
    setupFiles = ['./vitest.setup.js'],
  } = options

  return {
    environment: 'jsdom',
    globals: false,
    include,
    setupFiles,
    restoreMocks: true,
    clearMocks: true,
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/index.js'],
    },
  }
}

export default reactTestConfig
