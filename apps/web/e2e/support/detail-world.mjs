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
import { assertTagFree, cleanupFeatureWorld, seedFeatureWorld } from './seed-feature-world.mjs'
import {
  PASSWORD,
  cleanupRefusals,
  currentCode,
  forgetCodeUse,
  seedRefusals,
} from './seed-refusals.mjs'

/**
 * The organisations `seed-refusals.mjs` creates under a tag, by slug fragment.
 *
 * Created rather than upserted there, so a second seed of a tag they are still
 * under fails on a unique slug; {@link seedDetailWorld} asks first instead.
 *
 * @type {ReadonlyArray<string>}
 */
const REFUSALS_ORGANIZATIONS = Object.freeze(['alpha', 'beta', 'unverified'])

/**
 * Seed everything the four suites need.
 *
 * The feature world (`seed-feature-world.mjs`) is seeded beside the rest under
 * the same tag, and never inside alpha or beta: the specs that use it change
 * privileges, publish and sell, and alpha's and beta's counts are pinned by
 * specs that run after them. Its keys join the world only if none of them is
 * already taken, because a spread that let one seed overwrite another's id
 * would send a spec to the wrong row without a word.
 *
 * The tag is judged before any seed writes a row: its shape (3 to 24
 * lower-case letters and digits, which the feature world's addresses and order
 * references need), and whether a world is still there under it — the ledger
 * keeps alpha, and gamma once a spec pays under it, so a tag pinned with
 * `DETAIL_E2E_TAG` serves one run. A refusal then leaves nothing behind. A
 * seed that fails after writing takes its own rows away again, since global
 * teardown, finding no world file, would not.
 *
 * @param {string} tag A suffix unique to this run.
 * @returns {Promise<object>} The refusals world merged with the commerce rows.
 */
export async function seedDetailWorld(tag) {
  await assertTagFree(tag, {
    alsoOrganizations: REFUSALS_ORGANIZATIONS.map((slug) => `${slug}-${tag}`),
  })

  try {
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

    const merged = { ...seeded, ...commerce, ...door }
    const feature = await seedFeatureWorld({ tag })
    const taken = Object.keys(feature).filter((key) => Object.hasOwn(merged, key))

    if (taken.length > 0) {
      throw new Error(`The feature world would overwrite detail-world keys: ${taken.join(', ')}.`)
    }

    return { ...merged, ...feature }
  } catch (error) {
    // Everything under the tag is this call's own: the tag was free above.
    await cleanupDetailWorld(tag).catch(() => {})

    throw error
  }
}

/**
 * Remove what a run created, in the order the foreign keys allow.
 *
 * The feature world goes first: the refusals teardown finds organisations by
 * tag too, and would otherwise reach gamma's events while their orders still
 * pin them.
 *
 * @param {string} tag The run suffix.
 * @returns {Promise<void>} Resolves when done.
 */
export async function cleanupDetailWorld(tag) {
  await cleanupFeatureWorld(tag)
  await cleanupDoor(tag)
  await cleanupDetailScreens(tag)
  await cleanupRefusals(tag)
}

/**
 * The refusal the credential limiter answers with, as the sign-in form shows it.
 *
 * It is the API's own message, so `step-up.mjs` reads the same words out of a
 * refused response body when a form shows them in other words.
 *
 * @type {RegExp}
 */
export const RATE_LIMITED = /Too many requests\. Retry in (\d+) seconds?/u

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
 * request from the browser arrives from the same address. The world signs ten
 * accounts in before the first spec runs — four of them through a second
 * factor, two requests each — so global setup is itself refused once, and a
 * spec that signs somebody in again inside the same minute can be too. That is
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
