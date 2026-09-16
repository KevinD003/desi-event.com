/**
 * The world the four detail suites share.
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

  return { ...seeded, ...commerce }
}

/**
 * Remove what a run created, in the order the foreign keys allow.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupDetailWorld(tag) {
  await cleanupDetailScreens(tag)
  await cleanupRefusals(tag)
}

/**
 * Sign one seeded account in, through a second factor only if it has one.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @returns {Promise<void>} Resolves once signed in.
 */
export async function signIn(page, email) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const code = page.getByLabel(/^Six-digit code/)

  // Waited for rather than probed. `isVisible()` answers about the DOM as it is
  // this instant, and this instant is between the first submit and the form
  // re-rendering — so it says "no factor" for an account that has one, and the
  // sign-in silently half-finishes. A bounded wait asks the right question:
  // does the challenge appear at all?
  const challenged = await code
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)

  if (challenged) {
    await code.fill(currentCode())
    await page.getByRole('button', { name: 'Sign in' }).click()
  }

  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/sign-in/)
}
