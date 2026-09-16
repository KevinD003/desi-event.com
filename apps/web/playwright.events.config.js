/**
 * The event-lifecycle journeys.
 *
 * Twenty journeys against a real API, a real browser and a disposable
 * database. Like the venue-map suite and unlike every public suite here, the
 * API is up: an organiser screen has no fallback and must not have one, and
 * half of what these journeys check is a refusal that only the server can make.
 *
 * Serial, on its own ports. Several journeys are about what happens when two
 * writers collide, or when an event moves from one lifecycle state to the next,
 * and neither is something to leave to worker scheduling.
 *
 * @module playwright.events.config
 */

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.EVENTS_E2E_API_PORT ?? 4410)
const webPort = Number(process.env.EVENTS_E2E_WEB_PORT ?? 3410)

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
  // Serial, and in file order: the twenty journeys walk one event from a blank
  // list to a cancellation, which is the thing being tested.
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

  testMatch: '**/event-lifecycle.spec.js',
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
        // Twenty journeys drive a whole product lifecycle from one address in
        // about a minute, which the default budget correctly reads as a
        // scraper. The limit is not disabled and the default is not changed —
        // this suite is a different deployment shape, which is exactly why the
        // budget is an environment variable rather than a constant.
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
