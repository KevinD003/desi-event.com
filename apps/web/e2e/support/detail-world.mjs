/**
 * The world the detail suites share.
 *
 * One seed, one sign-in helper, one teardown. Written once because four specs
 * each building their own would be four chances for them to drift apart about
 * what "an organiser" is — and because the sign-in has a subtlety worth stating
 * in one place rather than four.
 *
 * ## The sign-in subtlety
 *
 * An owner holds a second factor, because the system compels one for privileged
 * roles; a viewer does not, because it does not. So the sign-in below asks for a
 * code only when the form asks for one, rather than assuming either. A helper
 * that assumed a factor would make the viewer cases impossible to write, which
 * is how the count-only tier went untested long enough to be broken.
 *
 * @module e2e/support/detail-world
 */

import { expect } from '@playwright/test'

import { cleanupDetailScreens, seedDetailScreens } from './seed-detail-screens.mjs'
import { cleanupDoor, seedDoor } from './seed-door.mjs'
import {
  PASSWORD,
  cleanupRefusals,
  currentCode,
  forgetCodeUse,
  seedRefusals,
} from './seed-refusals.mjs'

/**
 * Seed everything the four suites need.
 *
 * @param {string} tag A suffix unique to this run.
 * @returns {Promise<object>} The refusals world merged with the commerce rows.
 */
export async function seedDetailWorld(tag) {
  const seeded = await seedRefusals(tag)
  const commerce = await seedDetailScreens({
    tag,
    organizationId: seeded.alphaOrganizationId,
    eventId: seeded.alphaEventId,
    ownerUserId: seeded.alphaOwnerId,
  })

  const door = await seedDoor({
    tag,
    organizationId: seeded.alphaOrganizationId,
    eventId: seeded.alphaEventId,
  })

  return { ...seeded, ...commerce, ...door }
}

/**
 * Remove what a run created, in the order the foreign keys allow.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupDetailWorld(tag) {
  await cleanupDoor(tag)
  await cleanupDetailScreens(tag)
  await cleanupRefusals(tag)
}

/**
 * The refusal the credential limiter answers with, as the sign-in form shows it.
 *
 * @type {RegExp}
 */
const RATE_LIMITED = /Too many requests\. Retry in (\d+) seconds?/u

/**
 * Wait for the first of several outcomes on the sign-in page.
 *
 * @param {object} page The page.
 * @param {Record<string, function(): Promise<unknown>>} outcomes Named waits.
 * @returns {Promise<string>} The name of the one that happened first.
 */
function firstOf(page, outcomes) {
  return Promise.any(Object.entries(outcomes).map(([name, wait]) => wait().then(() => name))).catch(
    () => 'nothing',
  )
}

/**
 * One attempt at signing in.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @returns {Promise<{ok: true}|{ok: false, retryIn: number|null}>} What happened.
 */
async function attemptSignIn(page, email) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const code = page.getByLabel(/^Six-digit code/)
  const refused = page.getByText(RATE_LIMITED)
  const left = () =>
    page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 15_000 })

  // Waited for rather than probed. `isVisible()` answers about the DOM as it
  // is this instant, and this instant is between the first submit and the
  // form re-rendering — so it says "no factor" for an account that has one.
  // Three outcomes are possible, and the first to happen decides.
  let happened = await firstOf(page, {
    challenged: () => code.waitFor({ state: 'visible', timeout: 15_000 }),
    signedIn: left,
    refused: () => refused.waitFor({ state: 'visible', timeout: 15_000 }),
  })

  if (happened === 'challenged') {
    await code.fill(currentCode())
    await page.getByRole('button', { name: 'Sign in' }).click()

    happened = await firstOf(page, {
      signedIn: left,
      refused: () => refused.waitFor({ state: 'visible', timeout: 15_000 }),
    })
  }

  if (happened === 'signedIn') return { ok: true }

  if (happened === 'refused') {
    const [, seconds] = (await refused.textContent()).match(RATE_LIMITED)

    return { ok: false, retryIn: Number(seconds) }
  }

  return { ok: false, retryIn: null }
}

/**
 * Sign one seeded account in, through a second factor only if it has one.
 *
 * ## The credential limiter is honoured, not widened
 *
 * `/v1/auth/login` allows ten attempts a minute per address, and every
 * request from the browser arrives from the same address. The world signs six
 * accounts in before the first spec runs — the owner and the other
 * organisation's owner through a second factor, two requests each — and a spec
 * that signs somebody in again inside the same minute can be refused. That is
 * the limiter working, so the answer is to do what it says: when the form
 * shows "Retry in N seconds", wait N seconds, measured by the server, and try
 * once more. A second refusal fails.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @returns {Promise<void>} Resolves once signed in.
 */
export async function signIn(page, email) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const outcome = await attemptSignIn(page, email)

    if (outcome.ok) {
      await expect(page).not.toHaveURL(/\/sign-in/)

      return
    }

    if (outcome.retryIn === null || attempt === 2) break

    await page.waitForTimeout((outcome.retryIn + 1) * 1_000)
  }

  throw new Error(`Could not sign ${email} in, even after waiting out the credential limiter.`)
}
