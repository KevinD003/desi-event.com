import { defineConfig } from 'vitest/config'
import { nodeTestConfig } from '@desi-event/config/vitest-node'

const base = nodeTestConfig({ include: ['src/**/*.test.js', 'tests/**/*.test.js'] })

export default defineConfig({
  test: {
    ...base,
    coverage: {
      ...base.coverage,
      // `main.js` is process wiring: it opens a Prisma client, a Redis socket
      // and signal handlers. Everything it composes is covered directly, and
      // the integration test in `tests/` exercises the composition for real.
      exclude: [...base.coverage.exclude, 'src/main.js'],
    },
  },
})
