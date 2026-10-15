/**
 * The refusal journeys.
 *
 * Four things the product declines to do, walked in a browser by the person it
 * declines them to. They live in their own suite because they need a cast the
 * lifecycle suite deliberately does not have — a second organisation, an
 * unverified one, and a venue map that was never published.
 *
 * Serial, on its own ports, with the API up: every one of these is a refusal
 * only the server can make, and a suite that mocked it would be asserting its
 * own mock.
 *
 * @module playwright.refusals.config
 */

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'
import { API_SERVER_COMMAND, E2E_DATABASE_URL } from './e2e/support/e2e-database.mjs'
import { nextDevServer, withDevRoutes } from './e2e/support/next-dev.mjs'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.REFUSALS_E2E_API_PORT ?? 4420)
const webPort = Number(process.env.REFUSALS_E2E_WEB_PORT ?? 3420)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  // Proves `next dev` routes its pages and the API proxy before any test
  // (`e2e/support/next-dev.mjs`).
  globalSetup: withDevRoutes(),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial: journey A leaves Alpha's draft where journey C expects to find it,
  // and both sign accounts in and out of one rate-limited API.
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

  testMatch: '**/refusals.spec.js',
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
        // Same reasoning as the lifecycle suite: several sign-ins and a series
        // of deliberately refused calls from one address read as an attack to
        // the default budget, correctly. The limit is not disabled and the
        // default is not changed.
        RATE_LIMIT_MAX: '20000',
      },
    },
    // Through the one helper that proves its routes before any test runs
    // (e2e/support/next-dev.mjs); `pnpm ci:check` refuses any other way.
    nextDevServer({ port: webPort, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` } }),
  ],
})
