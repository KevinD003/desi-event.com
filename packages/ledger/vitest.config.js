import { defineConfig } from 'vitest/config'
import { nodeTestConfig } from '@desi-event/config/vitest-node'

export default defineConfig({ test: nodeTestConfig() })
