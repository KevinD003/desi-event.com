import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { reactTestConfig } from '@desi-event/config/vitest-react'

export default defineConfig({
  plugins: [react()],
  test: reactTestConfig(),
})
