/**
 * The organiser journeys.
 *
 * The only suite here that runs against a real API and a real database. Every
 * other Playwright config in this repository deliberately leaves the API down,
 * because the public site is built to survive that; an organiser screen is not,
 * and must not be — showing somebody a venue list that is not their venue list
 * would invite them to act on fiction.
 *
 * So this config starts the API, starts the web application pointed at it, and
 * the suite seeds and removes its own rows around each run. It runs serially:
 * the journeys share a seeded organisation, and the point of several of them is
 * what happens when two writers collide, which is not something to leave to
 * worker scheduling.
 *
 * @module playwright.organizer.config
 */

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'
import { API_SERVER_COMMAND, E2E_DATABASE_URL } from './e2e/support/e2e-database.mjs'
import { nextDevServer, withDevRoutes } from './e2e/support/next-dev.mjs'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.ORGANIZER_E2E_API_PORT ?? 4310)
const webPort = Number(process.env.ORGANIZER_E2E_WEB_PORT ?? 3310)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  // Proves `next dev` routes its pages and the API proxy before any test
  // (`e2e/support/next-dev.mjs`).
  globalSetup: withDevRoutes(),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial: the journeys share seeded rows, and two of them are about
  // collisions that worker scheduling would otherwise decide.
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

  // One project. The suite signs in once inside a context it keeps open for
  // the whole run, because sessions rotate and a saved storageState goes stale
  // — see the note in the spec.
  testMatch: '**/organizer-venue-maps.spec.js',
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
        // Long enough for the schema, and obviously not a real secret.
        JWT_SECRET: 'e2e-only-secret-that-is-long-enough-32-chars',
        AUTH_SECRET: 'e2e-only-auth-secret-that-is-long-enough-32',
        JWT_EXPIRES_IN: '7d',
        // The browser talks to the web origin; the API must accept it.
        WEB_ORIGIN: baseURL,
        CORS_ORIGIN: baseURL,
        // Loopback HTTP, so the __Host- prefix cannot apply. The proxy keeps
        // the cookie same-origin regardless, which is the point.
        SECURE_COOKIES: 'false',
      },
    },
    // Through the one helper that proves its routes before any test runs
    // (e2e/support/next-dev.mjs); `pnpm ci:check` refuses any other way.
    nextDevServer({ port: webPort, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` } }),
  ],
})
