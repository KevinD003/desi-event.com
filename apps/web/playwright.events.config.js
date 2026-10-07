/**
 * The event-lifecycle journeys.
 *
 * Thirty journeys against a real API, a real browser and a disposable
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
import { API_SERVER_COMMAND, E2E_DATABASE_URL } from './e2e/support/e2e-database.mjs'
import { nextDevServer, withDevRoutes } from './e2e/support/next-dev.mjs'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.EVENTS_E2E_API_PORT ?? 4410)
const webPort = Number(process.env.EVENTS_E2E_WEB_PORT ?? 3410)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  // Proves `next dev` routes its pages and the API proxy before any test
  // (`e2e/support/next-dev.mjs`).
  globalSetup: withDevRoutes(),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial, and in file order: the thirty journeys walk one event from a blank
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
      // Migrates the browser suites' database first, creating it when it is missing.
      command: API_SERVER_COMMAND,
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
        // The browser suites' own database, never the unit suites' (`e2e-database.mjs`).
        DATABASE_URL: E2E_DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
        JWT_SECRET: 'e2e-only-secret-that-is-long-enough-32-chars',
        AUTH_SECRET: 'e2e-only-auth-secret-that-is-long-enough-32',
        JWT_EXPIRES_IN: '7d',
        WEB_ORIGIN: baseURL,
        CORS_ORIGIN: baseURL,
        SECURE_COOKIES: 'false',
        // Thirty journeys drive a whole product lifecycle from one address in
        // about two minutes, which the default budget correctly reads as a
        // scraper. The limit is not disabled and the default is not changed —
        // this suite is a different deployment shape, which is exactly why the
        // budget is an environment variable rather than a constant.
        RATE_LIMIT_MAX: '20000',
      },
    },
    // Through the one helper that proves its routes before any test runs
    // (e2e/support/next-dev.mjs); `pnpm ci:check` refuses any other way.
    nextDevServer({ port: webPort, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` } }),
  ],
})
