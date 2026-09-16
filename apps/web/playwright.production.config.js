/**
 * The production-build browser suite.
 *
 * The not-found behaviour this suite covers differs between `next dev` and a
 * compiled build, and the build is the one that ships — so these specs are run
 * against `next start` over a freshly compiled `.next`, never against the dev
 * server. `reuseExistingServer: false` is the guard that makes that true: if
 * anything already owns the port, Playwright refuses to start rather than
 * quietly testing a stale server someone left running.
 *
 * @module playwright.production.config
 */

import { defineConfig, devices } from '@playwright/test'
import { preinstalledChromium } from './e2e/support/chromium.js'

/** Port the production suite starts the application on. Distinct from the dev suite's. */
const port = Number(process.env.WEB_E2E_PROD_PORT ?? 3220)

/** Origin every `page.goto('/…')` is resolved against. */
const baseURL = `http://127.0.0.1:${port}`

const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/not-found.spec.js',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // The sandbox's outbound proxy must not be consulted for localhost.
      args: ['--no-proxy-server'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The API is intentionally not started: these tests exercise the site in the
  // state a visitor gets when the listings service is down, which is the state
  // the fallback catalogue exists for.
  webServer: {
    command: `npx next start --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { NODE_ENV: 'production' },
  },
})
