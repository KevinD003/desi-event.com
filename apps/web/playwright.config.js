import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Port the suite starts the application on.
 *
 * Deliberately not 3000: a developer running `pnpm dev` in another terminal
 * should not have their session hijacked — or, worse, have the suite silently
 * test whatever is already listening there.
 */
const port = Number(process.env.WEB_E2E_PORT ?? 3210)

/** Origin every `page.goto('/…')` is resolved against. */
const baseURL = `http://127.0.0.1:${port}`

/**
 * Chromium shipped with the image rather than downloaded by Playwright.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` already points the driver at this directory, so
 * normally nothing needs to be said. But if the preinstalled build's revision
 * does not match the one this Playwright expects, the driver looks for a
 * directory that is not there and fails; pointing `executablePath` straight at
 * the binary sidesteps the revision check entirely.
 *
 * @returns {string|undefined} An absolute path to a Chromium binary, or `undefined` to let Playwright resolve it.
 */
function preinstalledChromium() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return process.env.CHROMIUM_EXECUTABLE_PATH

  const candidates = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // The API is intentionally not started: these tests exercise the site in the
  // state a visitor gets when the listings service is down, which is the state
  // the fallback catalogue exists for.
  webServer: {
    command: `npx next dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
