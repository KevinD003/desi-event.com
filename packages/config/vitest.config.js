import { defineConfig } from 'vitest/config'

import { nodeTestConfig } from './src/vitest-node.js'

export default defineConfig({
  test: nodeTestConfig({
    include: ['tests/**/*.test.js'],
    // This package ships presets, not logic; the suite here exercises the
    // repository's policy tooling instead, so per-file coverage thresholds
    // would measure the wrong thing.
    coverageThresholds: undefined,
  }),
})
