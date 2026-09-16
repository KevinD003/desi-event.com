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
 * three accounts these suites need are signed in here, once, and their sessions
 * are saved for the specs to adopt.
 *
 * Nothing in the four specs changes anybody's privileges, so no session is
 * rotated underneath them — which is the condition that makes a saved session
 * safe to reuse, and the reason the sweep next door keeps a live window instead.
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
 * @param {string} who One of `owner`, `beta`, `viewer`.
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

  const browser = await chromium.launch({
    executablePath: config.projects[0].use.launchOptions?.executablePath,
    args: ['--no-proxy-server'],
  })

  try {
    for (const [who, email] of [
      ['owner', world.alphaOwnerEmail],
      ['beta', world.betaOwnerEmail],
      ['viewer', world.viewerEmail],
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
