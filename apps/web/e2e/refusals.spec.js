import { expect, test } from '@playwright/test'

import {
  PASSWORD,
  cleanupRefusals,
  currentCode,
  forgetCodeUse,
  seedRefusals,
} from './support/seed-refusals.mjs'

/**
 * Four refusals, walked in a browser.
 *
 * These exist because an earlier report scored them as browser-tested on the
 * strength of API tests. The API tests are good and they stay; they are not
 * evidence that a *person* using the product is refused, which is a different
 * claim and the one the completion gate makes.
 *
 * Each journey attempts the act through the product with a real signed-in
 * session, and then checks that nothing was written. A refusal that leaves a
 * side effect behind is not a refusal.
 *
 * ## On `page.request`
 *
 * Two of these attempt a command the interface does not offer — because the
 * interface correctly does not offer it to that person. `page.request` issues
 * the call from the browser context, carrying that browser's own session
 * cookies, which is the closest a test gets to a determined user opening the
 * developer console. It is not an API test with a forged token: there is no
 * token here that the browser did not earn by signing in.
 */

/** The run suffix, so cleanup can find exactly this run's rows. */
const TAG = process.env.REFUSALS_E2E_TAG ?? `ref${Date.now().toString(36)}`

/** @type {object} */
let seeded

/**
 * One window per account, opened once and kept open.
 *
 * Signing in six times from one address is what a credential-stuffing attempt
 * looks like, and the per-route limiter correctly refuses it. Rather than
 * loosening a security control to suit a test, the suite does what a person
 * does: signs in once and leaves the window open. The global budget is already
 * raised for this suite's shape; the sign-in limiter is a different control
 * with a different job, and it stays where it is.
 *
 * @type {Record<string, {context: object, page: object}>}
 */
const windows = {}

/**
 * Sign one seeded account in, through the second factor its role requires.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @returns {Promise<void>} Resolves once signed in.
 */
async function signIn(page, email) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const code = page.getByLabel(/^Six-digit code/)
  await expect(code).toBeVisible()
  await code.fill(currentCode())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/organizer\/events/)
}

test.describe.serial('what the product refuses, and to whom', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedRefusals(TAG)

    for (const [who, email] of [
      ['alpha', seeded.alphaOwnerEmail],
      ['beta', seeded.betaOwnerEmail],
      ['unverified', seeded.unverifiedOwnerEmail],
    ]) {
      const context = await browser.newContext()
      const page = await context.newPage()

      await signIn(page, email)
      windows[who] = { context, page }
    }
  })

  test.afterAll(async () => {
    for (const window of Object.values(windows)) await window.context?.close()

    await cleanupRefusals(TAG)
  })

  test('journey A: a member of another organisation cannot submit your draft for review', async () => {
    const page = windows.beta.page

    // Beta's owner navigates straight to Alpha's draft. The editor refuses to
    // open it, and — the part worth asserting — refuses in the same words it
    // would use for an id that does not exist. An outsider must not be able to
    // tell "not yours" from "not there", or the refusal becomes a way to
    // enumerate other organisations' drafts.
    await page.goto(`/organizer/events/${seeded.alphaDraftId}`)

    await expect(
      page.getByRole('heading', { name: /that event could not be opened/i }),
    ).toBeVisible()
    await expect(page.getByText(/^No such event\.$/)).toBeVisible()

    // There is no submit control on a page that would not load. So the attempt
    // is made the way a determined user would make it: from this browser, with
    // this browser's session.
    const attempt = await page.request.post(
      `${process.env.REFUSALS_E2E_API_URL ?? 'http://127.0.0.1:4420'}/v1/events/${seeded.alphaDraftId}/submit-review`,
      { data: {}, failOnStatusCode: false },
    )

    expect(attempt.status()).toBeGreaterThanOrEqual(400)
    expect(attempt.status()).toBeLessThan(500)

    // And nothing was written: the draft is still a draft, from the point of
    // view of the person who owns it.
    const owner = windows.alpha.page

    await owner.goto(`/organizer/events/${seeded.alphaDraftId}`)

    await expect(owner.getByText(/^State: Draft/)).toBeVisible()
  })

  test('journey B: an unverified organiser cannot publish, however ready the event is', async () => {
    const page = windows.unverified.page

    await page.goto(`/organizer/events/${seeded.unverifiedEventId}`)

    // The event is approved and complete. The only thing standing between it
    // and a public page is the organisation's verification.
    await expect(page.getByText(/^State: Approved/)).toBeVisible()

    // The lifecycle commands live on the last step, where the checklist is.
    await page.getByRole('button', { name: /Step 7 Review/ }).click()

    // The refusal arrives before the press: the readiness checklist has already
    // asked the server, and the server said no, so the control is disabled and
    // the reason is on the screen. That is the better shape — an organiser is
    // told why rather than finding out by being rejected.
    const publish = page.getByRole('button', { name: /^Publish/ })

    await expect(publish).toBeVisible()
    await expect(publish).toBeDisabled()
    await expect(page.getByText(/verif/i).first()).toBeVisible()

    // And a determined organiser who issues the command anyway, from this
    // browser and this session, is refused by the server too.
    const attempt = await page.request.post(
      `${process.env.REFUSALS_E2E_API_URL ?? 'http://127.0.0.1:4420'}/v1/events/${seeded.unverifiedEventId}/publish`,
      { data: {}, failOnStatusCode: false },
    )

    expect(attempt.status()).toBeGreaterThanOrEqual(400)
    expect(attempt.status()).toBeLessThan(500)

    // Nothing was published. The event is still approved, and has no public page.
    await page.reload()
    await expect(page.getByText(/^State: Approved/)).toBeVisible()

    // Asserted on the content rather than the status. The public catalogue
    // falls back to a sample when the API cannot answer — a deliberate choice
    // so a reader is never shown a broken page — so a 404 here would be a
    // statement about the fallback rather than about the event. What matters is
    // that this event's page is not among the things a stranger can read.
    await page.goto(`/events/unverified-event-${seeded.tag}`)

    await expect(page.getByText(`Unverified Evening ${seeded.tag}`)).toHaveCount(0)
  })

  test('journey C: a draft venue map cannot be referenced, so it can never back a sale', async () => {
    const page = windows.alpha.page

    await page.goto(`/organizer/events/${seeded.alphaDraftId}`)

    await page.getByRole('button', { name: /Step 3 Sessions/ }).click()

    // The select offers published versions only. A draft one is not on it,
    // which is the first of the two refusals.
    const select = page.getByLabel(/seating plan|venue map/i).first()

    if (await select.isVisible().catch(() => false)) {
      const offered = await select.locator('option').allTextContents()

      expect(offered.join(' ')).not.toContain(seeded.draftMapName)
    }

    // The second: naming it anyway, from this browser and this session, is
    // refused. `desi_event_session_map_frozen` refuses the row even if every
    // layer above it were to let the value through, which is why a reserved
    // event can never reach publication with a draft map — the state the gate
    // describes is unreachable rather than merely guarded.
    const attempt = await page.request.post(
      `${process.env.REFUSALS_E2E_API_URL ?? 'http://127.0.0.1:4420'}/v1/events/${seeded.alphaDraftId}/sessions`,
      {
        data: {
          revision: 0,
          startsAt: new Date(Date.now() + 46 * 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 46 * 86_400_000 + 3_600_000).toISOString(),
          timezone: 'Asia/Kolkata',
          venueMapVersionId: seeded.draftMapVersionId,
        },
        failOnStatusCode: false,
      },
    )

    expect(attempt.status()).toBeGreaterThanOrEqual(400)

    // And the event still has no performance backed by that map.
    await page.reload()
    await page.getByRole('button', { name: /Step 3 Sessions/ }).click()
    await expect(page.getByText(seeded.draftMapName)).toHaveCount(0)
  })

  test('journey D: a member of another organisation can neither edit nor publish your event', async () => {
    const page = windows.beta.page

    // Alpha's event is published, so Beta's owner can read it — it is public,
    // and pretending otherwise would be a lie about a page anybody can see.
    // What they cannot do is act on it, and the screen offers them nothing to
    // act with: no lifecycle command is rendered for somebody with no standing
    // in the organisation that owns it.
    await page.goto(`/organizer/events/${seeded.alphaEventId}`)
    await page.getByRole('button', { name: /Step 7 Review/ }).click()

    await expect(page.getByRole('button', { name: /^Publish/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Pause sales/ })).toHaveCount(0)

    const apiUrl = process.env.REFUSALS_E2E_API_URL ?? 'http://127.0.0.1:4420'

    const edit = await page.request.patch(`${apiUrl}/v1/events/${seeded.alphaEventId}`, {
      data: { revision: 0, title: `Renamed by an outsider ${seeded.tag}` },
      failOnStatusCode: false,
    })

    expect(edit.status()).toBeGreaterThanOrEqual(400)
    expect(edit.status()).toBeLessThan(500)

    const publish = await page.request.post(`${apiUrl}/v1/events/${seeded.alphaEventId}/publish`, {
      data: {},
      failOnStatusCode: false,
    })

    expect(publish.status()).toBeGreaterThanOrEqual(400)
    expect(publish.status()).toBeLessThan(500)

    // Nothing was written. The title the owner sees is the one they gave it.
    const owner = windows.alpha.page

    await owner.goto(`/organizer/events/${seeded.alphaEventId}`)

    await expect(owner.getByLabel(/^Title/)).toHaveValue(`Alpha's Evening ${seeded.tag}`)
  })
})
