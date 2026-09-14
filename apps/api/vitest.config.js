import { defineConfig } from 'vitest/config'
import { nodeTestConfig } from '@desi-event/config/vitest-node'

export default defineConfig({
  test: nodeTestConfig({ include: ['tests/**/*.test.js', 'src/**/*.test.js'] }),
})
