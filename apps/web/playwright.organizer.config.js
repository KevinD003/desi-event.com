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

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.ORGANIZER_E2E_API_PORT ?? 4310)
const webPort = Number(process.env.ORGANIZER_E2E_WEB_PORT ?? 3310)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

/** The database these journeys write to. Disposable by construction. */
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

export default defineConfig({
  testDir: './e2e',
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
