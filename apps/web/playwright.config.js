import { defineConfig, devices } from '@playwright/test'
import { preinstalledChromium } from './e2e/support/chromium.js'

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

const executablePath = preinstalledChromium()

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // Several suites belong to other configs and must not run here.
  //
  // The not-found specs assert compiled-build behaviour and run under
  // playwright.production.config.js against `next start`, not the dev server.
  //
  // The organiser journeys, the refusals, the accessibility sweep and the four
  // detail suites all need a live API and a real database — this config
  // deliberately leaves the API down, because the public site is built to
  // survive that. They run under playwright.organizer.config.js,
  // playwright.events.config.js, playwright.refusals.config.js,
  // playwright.sweep.config.js and playwright.detail.config.js, each of which
  // starts both.
  //
  // The list is a maintenance hazard and a deliberate one: a new spec joins the
  // public suite unless somebody says otherwise, and a public spec that is
  // silently not run is worse than one that fails loudly on its first day.
  //
  // It collected on the four `detail-*` specs exactly as designed. They were
  // added without an entry here, the public job picked them up, and they failed
  // in CI against the API this config deliberately does not start — loudly, on
  // their first day, which is the trade this list makes. `detail-*` is a glob
  // rather than four names so the fifth one does not repeat it.
  testIgnore: [
    '**/not-found.spec.js',
    '**/organizer-venue-maps.spec.js',
    '**/event-lifecycle.spec.js',
    '**/refusals.spec.js',
    '**/accessibility-sweep.spec.js',
    '**/detail-*.spec.js',
  ],
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

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

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
