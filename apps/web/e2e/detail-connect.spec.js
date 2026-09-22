import { expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'

/**
 * The simulated payout-setup screen, in a browser.
 *
 * The name of this file is the mechanism, not a convention. `detail-*.spec.js`
 * is what `playwright.detail.config.js` collects and what the default config
 * ignores, so this runs in the existing "Browser — commerce and operations
 * detail" job with the API started for it. Any other name would be collected by
 * the default config instead and run in "Browser — public catalogue", whose
 * config deliberately does not start the API, and it would fail on its first CI
 * run. It adds no matrix entry and therefore no required context.
 *
 * ## Why one test signs in again
 *
 * Signing in sets `mfaSatisfiedAt`, so the saved sessions global setup writes
 * carry a step-up window that begins there. The read is gated at
 * `FINANCE_VIEW`, fifteen minutes, which a saved session comfortably survives.
 * The action is gated at `PAYOUT`, five minutes, which it may not — so the one
 * journey that actually moves the simulation opens a fresh context and signs
 * in, rather than asserting conditionally on whether a prompt appeared. The
 * lapsed-window path is covered deterministically in
 * `src/app/finance/connect/connect-actions.test.jsx`.
 *
 * @module e2e/detail-connect
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe('who may open the payout-setup screen', () => {
  test('an organisation owner reaches it and is told immediately that it is simulated', async ({
    owner,
  }) => {
    await owner.goto('/finance/connect')

    await expect(owner.getByRole('heading', { name: 'Payout setup', level: 1 })).toBeVisible()
    await expect(owner.getByText(/everything on this page is simulated/i)).toBeVisible()
    // The denial is on the page itself, not a click away. Somebody who reads
    // only the heading and the first paragraph has still been told.
    await expect(owner.getByText(/no payment provider has been contacted/i).first()).toBeVisible()
  })

  test('a VIEWER of the same organisation is turned away before the screen', async ({ viewer }) => {
    // `finance:view` is what the finance layout checks, and a VIEWER does not
    // hold it — so the refusal happens above this page and no request is made
    // for a state this account may not see.
    await viewer.goto('/finance/connect')

    await expect(viewer.getByRole('heading', { name: 'Not for you' })).toBeVisible()
    await expect(viewer.getByRole('heading', { name: 'Payout setup' })).toBeHidden()
  })

  test('an outsider cannot read another organisation through the query string', async ({
    outsider,
  }) => {
    // The id is theirs to type and the screen intersects it with what the
    // session may manage, so it falls back rather than asking. The API is the
    // control; this asserts the screen does not produce a refusal it could have
    // avoided, and does not show the other organisation either.
    await outsider.goto(`/finance/connect?organizationId=${ids().alphaOrganizationId}`)

    await expect(outsider.getByText(ids().alphaOrganizationId)).toBeHidden()
  })

  test('the API refuses another organisation, not only the screen', async ({ outsider }) => {
    // Two different refusals, and only one of them is visible in a browser. A
    // screen that hid a surface while the route behind it answered would be a
    // surface anybody could read with `curl`.
    const response = await outsider.request.get(
      `/api/v1/organizations/${ids().alphaOrganizationId}/connect`,
    )

    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })
})

test.describe('what the screen says before anything has been simulated', () => {
  test('it names the state without printing the enum', async ({ owner }) => {
    await owner.goto('/finance/connect')

    await expect(owner.getByText('Not simulated yet')).toBeVisible()
    // The raw enum reaching a screen is the failure the vocabulary exists to
    // prevent, so its absence is asserted rather than assumed.
    await expect(owner.getByText('NOT_STARTED')).toBeHidden()
  })

  test('it offers the start and nothing else', async ({ owner }) => {
    await owner.goto('/finance/connect')

    await expect(owner.getByRole('button', { name: /start the simulated setup/i })).toBeVisible()
    await expect(
      owner.getByRole('button', { name: /simulate switching the setup off/i }),
    ).toBeHidden()
  })

  test('it carries no wording that implies a real provider', async ({ owner }) => {
    await owner.goto('/finance/connect')

    const text = await owner.locator('body').innerText()

    for (const phrase of [
      /stripe\s+verified/i,
      /provider\s+verified/i,
      /kyc\s+complete/i,
      /payouts?\s+enabled/i,
      /live\s+account/i,
      /live\s+onboarding/i,
      /real\s+onboarding\s+link/i,
      /real\s+account\s+created/i,
    ]) {
      expect(text, `the screen said something matching ${phrase}`).not.toMatch(phrase)
    }
  })

  test('it links nowhere outside this deployment', async ({ owner }) => {
    await owner.goto('/finance/connect')

    const hrefs = await owner
      .locator('a[href]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))

    for (const href of hrefs) {
      expect(href, `the screen linked to ${href}`).not.toMatch(/stripe\.com/i)
      expect(href, `the screen linked to ${href}`).not.toMatch(/^https?:\/\//i)
    }
  })
})

test.describe('confirming, cancelling and moving the simulation', () => {
  test('the confirmation says what will and will not happen, and cancelling restores focus', async ({
    owner,
  }) => {
    await owner.goto('/finance/connect')

    const trigger = owner.getByRole('button', { name: /start the simulated setup/i })

    await trigger.click()

    await expect(owner.getByText(/contacts no payment provider/i)).toBeVisible()
    await expect(owner.getByText(/produces no link to follow/i)).toBeVisible()

    await owner.getByRole('button', { name: 'Back' }).click()

    // The specific trigger, not merely "something has focus". Losing it to the
    // document body is how a keyboard user ends up at the top of the page after
    // backing out of a consequential step.
    await expect(owner.getByRole('button', { name: /start the simulated setup/i })).toBeFocused()
  })

  test('starting it moves the state, and the screen still refuses to claim anything', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Fresh, so the five-minute PAYOUT window is open. See the module note.
    await signIn(page, world().alphaOwnerEmail)
    await page.goto('/finance/connect')

    await page.getByRole('button', { name: /start the simulated setup/i }).click()
    await page.getByRole('button', { name: 'Record it' }).click()

    await expect(page.getByText('Simulated setup under way')).toBeVisible()
    await expect(page.getByText(/nothing has been submitted anywhere/i)).toBeVisible()

    // The two derived flags, still false, and never worded as enabled.
    await expect(page.getByRole('row', { name: /ability to receive money/i })).toContainText(
      'Not simulated',
    )

    await context.close()
  })

  test('the last step warns that nothing moves out of it', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await signIn(page, world().alphaOwnerEmail)
    await page.goto('/finance/connect')

    // Arrangement, not a conditional assertion: every expectation below runs
    // unconditionally. The disable button is offered from all three
    // non-terminal states, so the only case needing setup is a simulation that
    // was never started — which is what this file looks like when the last
    // journey is run on its own rather than after the one above it.
    const off = page.getByRole('button', { name: /simulate switching the setup off/i })

    if ((await off.count()) === 0) {
      await page.getByRole('button', { name: /start the simulated setup/i }).click()
      await page.getByRole('button', { name: 'Record it' }).click()
    }

    await page.getByRole('button', { name: /simulate switching the setup off/i }).click()

    await expect(page.getByText(/cannot be restarted afterwards/i)).toBeVisible()

    await page.getByRole('button', { name: 'Record it' }).click()

    await expect(page.getByText('Simulated setup switched off')).toBeVisible()
    await expect(page.getByText(/nothing moves it out of that/i)).toBeVisible()
    // Terminal means the buttons are gone, not merely that pressing one fails.
    await expect(page.getByRole('button', { name: /^simulate/i })).toHaveCount(0)

    await context.close()
  })
})
