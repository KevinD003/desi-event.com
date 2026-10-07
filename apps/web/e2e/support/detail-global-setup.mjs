/**
 * Seed once, sign in once, for the whole detail run.
 *
 * ## Why this exists rather than a `beforeAll` per spec
 *
 * Credential endpoints keep a budget of ten requests a minute, per address, and
 * that budget is deliberately not configurable — a deployment may widen the
 * general one, because a hundred real visitors behind a shared egress address
 * arrive as one caller, but nothing may widen the one protecting passwords.
 *
 * Four specs each signing two accounts in is sixteen requests to `/auth/login`
 * inside a minute, and the limiter refuses the last of them. It is right to.
 * The fix is to stop signing in repeatedly, not to turn the control off: the
 * ten accounts these suites need are signed in here, once, and their sessions
 * are saved for the specs to adopt.
 *
 * Ten accounts is fourteen requests — the four with a second factor (alpha's
 * owner, beta's owner, the platform reader and gamma's owner) take two each —
 * so the limiter refuses one of them, once, every run. `signIn` then waits the
 * seconds the server states, at most a minute, and carries on. That minute is
 * the price of three more saved sessions, and it is paid in global setup, once,
 * rather than by every spec that needs one of them.
 *
 * Nothing in the specs changes the privileges of an account signed in here, so
 * no session is rotated underneath them — which is the condition that makes a
 * saved session safe to reuse, and the reason the sweep next door keeps a live
 * window instead. A spec that changes somebody's privileges registers a fresh
 * account for it, or uses the feature world's role target, whom nothing here
 * signs in.
 *
 * ## The tag
 *
 * Every row the run seeds carries it. `DETAIL_E2E_TAG` sets it, for a run
 * whose rows you want to find; otherwise it is `dtl` and the time in base 36.
 * It must be 3 to 24 lower-case letters and digits — the feature world puts it
 * in addresses and order references — and it serves one run: the ledger keeps
 * the organisations a run paid under, so a second run with the same tag is
 * refused before anything is written. `seedDetailWorld` checks both first.
 *
 * @module e2e/support/detail-global-setup
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { chromium } from '@playwright/test'

import { seedDetailWorld, signIn } from './detail-world.mjs'

/** Where the world and the saved sessions are left for the specs. */
export const STATE_DIR = path.join(process.cwd(), 'test-results', 'detail-world')

/** The file holding this run's ids. */
export const WORLD_FILE = path.join(STATE_DIR, 'world.json')

/**
 * The path a signed-in account's session is saved to.
 *
 * @param {string} who One of `owner`, `beta`, `viewer`, `scanner`, `steward`, `holder`, `platform`, `gamma`, `giver`, `taker`.
 * @returns {string} A file path.
 */
export function statePath(who) {
  return path.join(STATE_DIR, `${who}.json`)
}

/**
 * Seed, sign in, and write everything to disk.
 *
 * @param {object} config The resolved Playwright config, for the base URL.
 * @returns {Promise<void>} Resolves when the run can start.
 */
export default async function globalSetup(config) {
  const tag = process.env.DETAIL_E2E_TAG ?? `dtl${Date.now().toString(36)}`
  const baseURL = config.projects[0].use.baseURL

  const world = await seedDetailWorld(tag)

  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(WORLD_FILE, JSON.stringify({ ...world, tag }, null, 2))

  // The routes this signs in through were proved before this ran: the
  // config lists `dev-routes-setup.mjs` first (`next-dev.mjs`).

  const browser = await chromium.launch({
    executablePath: config.projects[0].use.launchOptions?.executablePath,
    args: ['--no-proxy-server'],
  })

  try {
    for (const [who, email] of [
      ['owner', world.alphaOwnerEmail],
      ['beta', world.betaOwnerEmail],
      ['viewer', world.viewerEmail],
      ['scanner', world.scannerEmail],
      ['steward', world.stewardEmail],
      ['holder', world.holderEmail],
      // Platform-scoped screens (the notification outbox, every organisation's
      // reconciliation items) are behind `reconciliation:manage`, which no
      // organisation role carries; the seed's SUPER_ADMIN reader is the one
      // account that reaches them.
      ['platform', world.platformReaderEmail],
      // The feature world's (`seed-feature-world.mjs`): gamma's owner, through
      // a second factor, and the two attendees a ticket is handed between.
      // Last, so the one wait the limiter imposes comes after the sessions
      // every existing spec needs are already saved.
      ['gamma', world.gammaOwnerEmail],
      ['giver', world.giverEmail],
      ['taker', world.takerEmail],
    ]) {
      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()

      await signIn(page, email)
      await context.storageState({ path: statePath(who) })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
