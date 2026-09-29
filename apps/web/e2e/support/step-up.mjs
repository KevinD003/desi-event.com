/**
 * Confirming a second factor, and waiting out the credential budget, in a spec.
 *
 * Two things every browser spec that changes something privileged runs into,
 * written once so that each spec does them the same way.
 *
 * ## Step-up
 *
 * A route whose contract names a step-up policy answers `STEP_UP_REQUIRED`
 * when the session's last confirmation is older than the policy's window, and
 * the window is held by the server. A screen then offers "Confirm it is you"
 * in one of two shapes:
 *
 *   - **Before a read** (`StepUpForRead`): the page says it needs a recent
 *     confirmation and offers "Confirm and continue", which opens the prompt
 *     and reloads the page once it is accepted. {@link confirmIfAsked}.
 *   - **After a refused write** (`StepUpPrompt` drawn in place): the action was
 *     refused, the prompt is shown, and the same request is sent again once it
 *     is accepted. {@link confirmIfPrompted} and {@link confirmStepUp}.
 *
 * Whether a window is still open when a case starts depends on how long the
 * run has taken, so a spec cannot know in advance which way a page will
 * arrive. Answering the prompt when — and only when — it is offered is
 * arrangement, not a conditional assertion: everything asserted afterwards is
 * asserted either way. A step-up is its own endpoint with its own budget, and
 * it never rotates the session, so it is safe in a window whose session was
 * saved by global setup.
 *
 * The code is generated from the seeded factor's secret, and the factor's last
 * code is forgotten first (`forgetCodeUse`), exactly as the sign-in helper
 * does, so a code another case used inside the same thirty seconds is not
 * refused as a replay. Neither the password nor the code may ever reach an
 * address, and every helper here asserts that.
 *
 * ## The credential budget
 *
 * Registration, second-factor enrolment and confirmation, step-up, team
 * invitations and their acceptance share the credential limiter: ten requests a
 * minute per address, deliberately not configurable, and every request from the
 * browser arrives from one address. {@link waitOutCredentialBudget} does what
 * the limiter says rather than widening it: when a step is refused with 429, it
 * makes room in the test's time budget, waits the number of seconds the server
 * stated and tries once more. A step that succeeded is never tried again.
 *
 * @module e2e/support/step-up
 */

import { expect, test } from '@playwright/test'

import { totp } from '@desi-event/auth'

import { RATE_LIMITED } from './detail-world.mjs'
import { PASSWORD, TOTP_SECRET, currentCode, forgetCodeUse } from './seed-refusals.mjs'

/** The prompt's heading, in both of its shapes. */
const PROMPT_HEADING = 'Confirm it is you'

/**
 * Confirm a second factor with the page's own prompt, if and only if the page
 * offers it.
 *
 * For the read-time shape. See the module note: this is arrangement. Whether a
 * window is still open depends on how long the run has taken, and everything
 * asserted afterwards is asserted either way.
 *
 * The offer is drawn on the server and works once React has hydrated it, so
 * the press is repeated until the form it opens is there rather than assumed
 * to have landed.
 *
 * Moved here unchanged from `detail-workspace.spec.js`, which now imports it.
 *
 * @param {object} page The Playwright page, arrived.
 * @returns {Promise<void>} Resolves once the page no longer asks.
 */
export async function confirmIfAsked(page) {
  const offer = page.getByRole('button', { name: 'Confirm and continue', exact: true })

  if ((await offer.count()) === 0) return

  const password = page.getByLabel(/^Your password/u)

  await expect(async () => {
    if (await offer.isVisible()) await offer.click()
    await expect(password).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  // The seeded factor's last code is forgotten first, as the sign-in helper
  // does, so a code another case used inside the same thirty seconds is not
  // refused as a replay.
  await forgetCodeUse()

  const code = currentCode()

  await password.fill(PASSWORD)
  await page.getByLabel(/^Code from your authenticator/u).fill(code)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Confirm it is you' })).toHaveCount(0)

  // Typed into fields and sent in a request body, never in the address.
  expect(page.url(), 'the address carries the password').not.toContain(PASSWORD)
  expect(page.url(), 'the address carries the code').not.toContain(code)
}

/**
 * The open step-up prompt on a page.
 *
 * `StepUpPrompt` is a form named by its own heading, so it is found by role
 * rather than by its fields: two forms on one page each have a password field,
 * and only one of them is this.
 *
 * @param {object} page The Playwright page.
 * @returns {object} A locator for the prompt.
 */
export function stepUpPrompt(page) {
  return page.getByRole('form', { name: PROMPT_HEADING, exact: true })
}

/**
 * Answer an open step-up prompt, and wait for it to close.
 *
 * For the write-time shape, and for a spec that has arranged for the prompt to
 * be open. Fails — with the page's own error in view — when the prompt stays
 * open, because a refused confirmation means the next assertion would be about
 * the wrong page.
 *
 * @param {object} page The Playwright page, with the prompt open.
 * @param {object} [account] Whose factor, when it is not the seeded one.
 * @param {string} [account.password] The account's password.
 * @param {string} [account.secret] The base32 TOTP secret its factor holds, e.g. one a spec read off the enrolment page.
 * @returns {Promise<void>} Resolves once the prompt has closed.
 */
export async function confirmStepUp(page, { password = PASSWORD, secret = TOTP_SECRET } = {}) {
  const prompt = stepUpPrompt(page)

  await expect(prompt).toBeVisible()

  // See the module note: forgotten, then generated, so the code is current and
  // not a replay of one another case used inside the same thirty seconds.
  await forgetCodeUse()

  const code = totp(secret)

  await prompt.getByLabel(/^Your password/u).fill(password)
  await prompt.getByLabel(/^Code from your authenticator/u).fill(code)
  await prompt.getByRole('button', { name: 'Confirm', exact: true }).click()

  await expect(prompt, 'the step-up was not accepted').toHaveCount(0)

  expect(page.url(), 'the address carries the password').not.toContain(password)
  expect(page.url(), 'the address carries the code').not.toContain(code)
}

/**
 * After an action, answer a step-up prompt if one appears, then wait for the
 * action's own outcome.
 *
 * The prompt appears only when the window had lapsed, so whichever of the two
 * appears first decides: the outcome means nothing was asked, and the prompt is
 * answered and the outcome then awaited — the screen sends the refused request
 * again by itself once the confirmation is accepted. Neither within the timeout
 * is a failure that says so.
 *
 * @param {object} page The Playwright page, just after the action.
 * @param {object} outcome A locator that becomes visible when the action has succeeded.
 * @param {object} [options] Options.
 * @param {string} [options.password] The account's password, when it is not the seeded one.
 * @param {string} [options.secret] The account's TOTP secret, when it is not the seeded one.
 * @param {number} [options.timeout] How long to wait for either, in milliseconds.
 * @returns {Promise<boolean>} Whether a prompt was answered.
 */
export async function confirmIfPrompted(page, outcome, { timeout = 15_000, ...account } = {}) {
  const prompt = stepUpPrompt(page)

  const first = await Promise.any([
    prompt.waitFor({ state: 'visible', timeout }).then(() => 'prompted'),
    outcome.waitFor({ state: 'visible', timeout }).then(() => 'done'),
  ]).catch(() => 'nothing')

  if (first === 'nothing') {
    throw new Error(
      `Neither a step-up prompt nor the expected outcome appeared within ${timeout} ms.`,
    )
  }

  if (first === 'prompted') {
    await confirmStepUp(page, account)
    await expect(outcome).toBeVisible({ timeout })
  }

  return first === 'prompted'
}

/**
 * How long a 429 says to wait, in seconds.
 *
 * The `Retry-After` header first, which the web proxy forwards; the API's own
 * "Retry in N seconds" message second; a minute, the limiter's window, when
 * neither is readable.
 *
 * @param {object} response The refused Playwright response.
 * @returns {Promise<number>} Seconds.
 */
async function retryInSeconds(response) {
  const header = Number(response.headers()['retry-after'])

  if (Number.isFinite(header) && header >= 0) return header

  const body = await response.text().catch(() => '')
  const match = body.match(RATE_LIMITED)

  return match ? Number(match[1]) : 60
}

/**
 * The running test's info, or null outside a test or hook.
 *
 * @returns {object|null} Playwright's `TestInfo`.
 */
function runningTestInfo() {
  try {
    return test.info()
  } catch {
    return null
  }
}

/**
 * Run a step that spends the credential budget, waiting out a refusal once.
 *
 * `action` performs the step and resolves once it has succeeded — it throws
 * when the step was refused, since a refused step never reaches the state it
 * waits for. A step that resolved has succeeded, whatever else was answered
 * while it ran, and is never run again: running a registration or an
 * acceptance twice is refused the second time.
 *
 * A step that threw is run again only when the server said why: a 429 on an
 * API path (`options.refusedAt`) seen while it ran. Then the helper waits the
 * time the server stated, plus a second, and runs `action` again. A second
 * refusal fails, as does any failure without one.
 *
 * The wait is added to the test's own time budget first. The limiter's window
 * is a minute and the detail and sweep configs give a test ninety seconds, so
 * a journey that waited inside its budget would time out for having done as
 * it was told.
 *
 * The limiter is honoured, never widened: the budget is ten requests a minute
 * and a deployment cannot change it, so the only thing a suite may do is what a
 * person would — wait.
 *
 * Wrap one credential step at a time — register, then enrol, then accept, each
 * in its own call. A step that is run again must be safe to run again, and a
 * registration that succeeded before an enrolment was refused is not.
 *
 * @param {object} page The Playwright page the step runs on.
 * @param {function(): Promise<*>} action The step.
 * @param {object} [options] Options.
 * @param {number} [options.attempts] How many times to try in all.
 * @param {RegExp} [options.refusedAt] Which paths' 429s count as the step's refusal; every API path unless a spec narrows it to the step's own endpoint.
 * @returns {Promise<*>} What `action` resolved with.
 */
export async function waitOutCredentialBudget(
  page,
  action,
  { attempts = 2, refusedAt = /^\/api\/v1\//u } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    const refusals = []
    const listen = (response) => {
      if (response.status() !== 429) return
      if (!refusedAt.test(new URL(response.url()).pathname)) return

      refusals.push(response)
    }

    page.on('response', listen)

    let failure = null
    let result

    try {
      result = await action()
    } catch (error) {
      failure = error
    } finally {
      page.off('response', listen)
    }

    // Resolved is succeeded. Only a refused step is ever tried again.
    if (failure === null) return result
    if (refusals.length === 0) throw failure

    if (attempt >= attempts) {
      throw new Error(
        `The credential limiter refused this step ${attempts} times, even after waiting as told.`,
        { cause: failure },
      )
    }

    const seconds = await retryInSeconds(refusals[refusals.length - 1])
    const waitMs = (seconds + 1) * 1_000
    const info = runningTestInfo()

    // Zero is "no timeout", which needs no room made.
    if (info !== null && info.timeout > 0) info.setTimeout(info.timeout + waitMs)

    await page.waitForTimeout(waitMs)
  }
}
