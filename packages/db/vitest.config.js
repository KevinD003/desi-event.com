import { defineConfig } from 'vitest/config'
import { nodeTestConfig } from '@desi-event/config/vitest-node'

export default defineConfig({
  test: nodeTestConfig({
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    // This package is a thin wrapper around Prisma plus a seed script. Its
    // meaningful assertions run against a live database, which is not present
    // on every machine, so a line-coverage gate here would only be noise.
    coverageThresholds: {},
  }),
})
