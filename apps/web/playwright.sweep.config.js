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

import os from 'node:os'
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { preinstalledChromium } from './e2e/support/chromium.js'
import { API_SERVER_COMMAND, E2E_DATABASE_URL } from './e2e/support/e2e-database.mjs'
import { nextDevServer, withDevRoutes } from './e2e/support/next-dev.mjs'

/** Ports distinct from every other suite's, so nothing collides. */
const apiPort = Number(process.env.SWEEP_E2E_API_PORT ?? 4430)
const webPort = Number(process.env.SWEEP_E2E_WEB_PORT ?? 3430)

const baseURL = `http://127.0.0.1:${webPort}`
const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  // Proves `next dev` routes its pages and the API proxy before any test
  // (`e2e/support/next-dev.mjs`).
  globalSetup: withDevRoutes(),
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
        // The imported-event screens are swept after a real import, whose
        // pictures are copied from a directory, never from Sulekha's host
        // (SPEC2-XI §5.I-D): a temporary copy of `e2e/fixtures/import-images`
        // that `seed-import.mjs` makes afresh, apart from the detail suite's.
        // `SWEEP_IMPORT_PICTURE_DIR` there is the same expression.
        IMPORT_IMAGE_SOURCE: 'fixtures',
        IMPORT_IMAGE_FIXTURE_DIR: path.join(os.tmpdir(), 'desi-event-e2e-sweep-import-images'),
      },
    },
    // Through the one helper that proves its routes before any test runs
    // (e2e/support/next-dev.mjs); `pnpm ci:check` refuses any other way.
    nextDevServer({ port: webPort, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}` } }),
  ],
})
