/**
 * The four detail surfaces, exercised as behaviour rather than as markup.
 *
 * The sweep next door proves these screens are usable. This one proves they are
 * *true*: that the figures on the analytics page come out of the ledger, that a
 * reconciliation item shows both sides of its evidence and no provider payload,
 * that a refund screen never asks for a card and offers only the step its state
 * allows, and that offering a ticket creates a real pending transfer whose
 * recipient is shown by its domain alone and whose invitation never reaches a
 * web address.
 *
 * Four specs, one config. Four Playwright configs would mean four API processes
 * and four Next servers on a two-core runner, which is the failure mode the
 * browser matrix already exists to avoid. The four are separately runnable —
 * `test:e2e:analytics` and its three siblings — so a single surface can be
 * driven without the other three.
 *
 * @module playwright.detail.config
 */

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.DETAIL_E2E_API_PORT ?? 4440)
const webPort = Number(process.env.DETAIL_E2E_WEB_PORT ?? 3440)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

/** The database these journeys write to. Disposable by construction. */
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

export default defineConfig({
  testDir: './e2e',
  // Seeded once and signed in once for the whole run. Credential endpoints keep
  // a budget of ten requests a minute that a deployment deliberately cannot
  // widen, and four specs each signing two accounts in is sixteen — correctly
  // refused. See `e2e/support/detail-global-setup.mjs`.
  globalSetup: './e2e/support/detail-global-setup.mjs',
  globalTeardown: './e2e/support/detail-global-teardown.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial: one signed-in window is reused across each spec, because signing
  // in once per case would look like credential stuffing to the limiter that
  // correctly exists to notice it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-proxy-server'],
    },
  },

  testMatch: process.env.DETAIL_E2E_SPEC ?? '**/detail-*.spec.js',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node src/server.js',
      cwd: new URL('../api', import.meta.url).pathname,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        API_PORT: String(apiPort),
        API_HOST: '127.0.0.1',
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
        JWT_SECRET: 'e2e-only-secret-that-is-long-enough-32-chars',
        AUTH_SECRET: 'e2e-only-auth-secret-that-is-long-enough-32',
        JWT_EXPIRES_IN: '7d',
        WEB_ORIGIN: baseURL,
        CORS_ORIGIN: baseURL,
        SECURE_COOKIES: 'false',
        // Same reasoning as the lifecycle suite: several sign-ins and a series
        // of deliberately refused calls from one address read as an attack to
        // the default budget, correctly. The limit is not disabled and the
        // default is not changed.
        RATE_LIMIT_MAX: '20000',
      },
    },
    {
      command: `npx next dev --port ${webPort}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` },
    },
  ],
})
