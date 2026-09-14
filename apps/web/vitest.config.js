import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { reactTestConfig } from '@desi-event/config/vitest-react'

export default defineConfig({
  plugins: [react()],
  test: {
    ...reactTestConfig(),
    // Playwright owns `e2e/`; Vitest must not try to run those specs.
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
})
