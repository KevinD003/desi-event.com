/**
 * The responsive and accessibility sweep.
 *
 * Every Phase 2 screen at three widths, at 200% zoom, with motion reduced, and
 * by keyboard alone, with a real scanner run against each one. On its own ports
 * and with the API up, because an organiser screen with no API is a screen
 * showing an error, and sweeping that would be sweeping the error page.
 *
 * @module playwright.sweep.config
 */

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.SWEEP_E2E_API_PORT ?? 4430)
const webPort = Number(process.env.SWEEP_E2E_WEB_PORT ?? 3430)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

/** The database these journeys write to. Disposable by construction. */
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial: one signed-in window is reused across the sweep, because signing
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

  testMatch: '**/accessibility-sweep.spec.js',
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
