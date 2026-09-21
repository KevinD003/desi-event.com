import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * Who may open the privacy surface, and what a refusal is allowed to say.
 *
 * ## Why the file is named this way
 *
 * `detail-privacy.spec.js`, and the prefix is load-bearing rather than
 * cosmetic. `playwright.detail.config.js` collects the `detail-*.spec.js` glob, and
 * the default `playwright.config.js` *ignores* that same glob — a line its own
 * comment says was added "so the fifth one does not repeat it". Any other name
 * would be picked up by the `Browser — public catalogue` job, which
 * deliberately does not start the API, and would fail against an error page.
 *
 * So this file needs no config change, no new CI job and no new matrix entry.
 * That last one matters: the required status contexts are the rendered job
 * names, so adding a leg — or renaming one — would block every merge until
 * branch protection was edited to match.
 *
 * ## What this proves that a unit test cannot
 *
 * The page tests for these screens mock the API at the module boundary, which
 * makes them good at rendering and silent about authorization. Everything here
 * is about the boundary those mocks replace:
 *
 *   - a VIEWER of the same organisation is refused, by the layout, before any
 *     data is fetched;
 *   - an outsider sees their own organisation's queue and not the neighbour's,
 *     with the organisation coming from the path on the server rather than from
 *     anything the browser sent;
 *   - a refusal says what to do and does not echo back what was asked for.
 *
 * ## What is deliberately not here
 *
 * No redaction is performed. The world these fixtures share is reused by four
 * other detail specs, and a completed erasure rewrites rows they read. The
 * redaction path has its own integration coverage against a real database in
 * `apps/api/tests/privacy-redaction-integration.test.js`, which can afford a
 * disposable world; a browser journey that erased somebody here would be
 * buying a screenshot at the cost of every other spec in the job.
 *
 * @module e2e/detail-privacy
 */

/**
 * This run's seeded ids.
 *
 * Read inside each test rather than at module scope, because module scope runs
 * before global setup has written the file.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe('who may open the privacy surface', () => {
  test('an organisation owner reaches the queue', async ({ owner }) => {
    // `OWNER` grants `privacy:redact`, which is what the layout checks. Stated
    // as a journey rather than assumed, because the whole file below is about
    // people who are refused — and a suite that only ever observed refusals
    // would pass just as happily against a surface nobody could reach.
    await owner.goto('/privacy')

    await expect(owner.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(owner.getByRole('heading', { name: 'Not for you' })).toBeHidden()
    await expect(owner.getByRole('navigation', { name: 'Privacy' })).toBeVisible()
  })

  test('a VIEWER of the same organisation is turned away at the layout', async ({ viewer }) => {
    // The refusal happens in `privacy/layout.jsx`, before any page beneath it
    // runs — so no request is made for data this account may not see, and
    // there is nothing for a response to leak. That is a stronger arrangement
    // than fetching and then hiding, and it is what this asserts.
    await viewer.goto('/privacy')

    await expect(viewer.getByRole('heading', { name: 'Not for you' })).toBeVisible()
    await expect(viewer.getByRole('navigation', { name: 'Privacy' })).toBeHidden()

    // It says who can help rather than only that the door is shut.
    await expect(viewer.getByText(/ask whoever runs the organisation/i)).toBeVisible()
    await expect(viewer.getByRole('link', { name: /back to the site/i })).toBeVisible()
  })

  test('the same wall stands in front of the export register', async ({ viewer }) => {
    // The layout guards the whole segment. Asserted on a second child rather
    // than inferred from the first, because "the layout protects everything
    // under it" is exactly the kind of claim that stops being true when
    // somebody adds a route with its own layout.
    await viewer.goto('/privacy/exports')

    await expect(viewer.getByRole('heading', { name: 'Not for you' })).toBeVisible()
    await expect(viewer.getByRole('heading', { name: /export register/i })).toBeHidden()
  })

  test('the retention log is not an organisation screen at all', async ({ owner }) => {
    // `retention:view` is in `PLATFORM_ONLY_CAPABILITIES`, which is asserted at
    // module load never to appear in an organisation role. So the most senior
    // membership there is does not reach this screen — and that is the point
    // of the capability being platform-only rather than a matter of nobody
    // having granted it yet.
    await owner.goto('/retention')

    await expect(owner.getByRole('heading', { name: /retention rehearsals/i })).toBeHidden()
  })
})

test.describe('what a refusal is allowed to say', () => {
  test('the API refuses the queue for a VIEWER, not just the screen', async ({ viewer }) => {
    // The screen and the API are two different refusals, and only one of them
    // is visible in a browser. A layout that hid a surface while the route
    // behind it answered would be a surface anybody could read with `curl`.
    const response = await viewer.request.get(
      `/api/v1/organizations/${ids().alphaOrganizationId}/privacy/requests`,
    )

    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })

  test('an outsider is refused another organisation by the server, not by the query string', async ({
    outsider,
  }) => {
    // The organisation is in the path and resolved on the server. Nothing the
    // browser sends can widen it, which is why the filter form's organisation
    // select is a convenience rather than an authorization input.
    const response = await outsider.request.get(
      `/api/v1/organizations/${ids().alphaOrganizationId}/privacy/requests`,
    )

    expect(response.status()).toBe(403)
  })

  test('a refusal on the register does not echo the identifier it was asked about', async ({
    outsider,
  }) => {
    // `describeRefusal` turns an error into a title and a sentence. The hazard
    // it exists to avoid is a screen that helpfully prints what was requested:
    // on a privacy surface the identifier in the query string may be a person.
    const foreign = ids().alphaOrganizationId

    await outsider.goto(`/privacy/exports?organizationId=${foreign}`)
    await expect(outsider.getByRole('heading', { level: 1 })).toBeVisible()

    const rendered = await outsider.locator('main, body').first().innerText()

    expect(rendered).not.toContain(foreign)
  })
})

test.describe('the export register, read by the organisation that owns it', () => {
  test('offers nothing to download, because there is nothing kept', async ({ owner }) => {
    // Every export is streamed to whoever asked and nothing is stored, so
    // there are no bytes to re-serve — and a register that could hand out a
    // second copy of an export would have become the thing it exists to track.
    await owner.goto('/privacy/exports')
    await expect(owner.getByRole('heading', { name: /export register/i })).toBeVisible()

    expect(await owner.locator('a[download]').count()).toBe(0)
    expect(await owner.locator('a[href*="export.csv"]').count()).toBe(0)
  })

  test('never renders a storage key, whatever the register holds', async ({ owner }) => {
    // `toExportArtifact` reduces `storageKey` to a boolean on the way out, so
    // this is asserting the presenter's rule at the far end of the wire: a
    // storage key in a payload is a storage key in somebody's log file.
    await owner.goto('/privacy/exports')
    await expect(owner.getByRole('heading', { name: /export register/i })).toBeVisible()

    const rendered = await owner.locator('body').innerText()

    expect(rendered).not.toMatch(/s3:\/\//u)
    expect(rendered).not.toMatch(/storageKey/iu)
  })

  test('the filter form submits back to the register, with the register vocabulary', async ({
    owner,
  }) => {
    // Both halves were broken. The form was written for the request queue and
    // hard-coded its action and its state list, so pressing Apply here
    // navigated the operator to a different screen, and the states offered
    // were privacy-request states no export artefact can be in.
    await owner.goto('/privacy/exports')
    await expect(owner.getByRole('heading', { name: /export register/i })).toBeVisible()

    const form = owner.locator('form[method="get"]')

    await expect(form).toHaveAttribute('action', '/privacy/exports')

    const options = await form.locator('select#state option').allInnerTexts()

    expect(options.join(' ')).toMatch(/Invalidated by an erasure/iu)
    // The wrong vocabulary, which is what it used to offer.
    expect(options.join(' ')).not.toMatch(/Awaiting confirmation/iu)
  })

  test('applying a filter keeps the operator on the register', async ({ owner }) => {
    // The end-to-end version of the case above: the assertion that would have
    // caught the defect by using the screen rather than by reading its markup.
    await owner.goto('/privacy/exports')
    await expect(owner.getByRole('heading', { name: /export register/i })).toBeVisible()

    await owner.getByRole('button', { name: 'Apply' }).click()

    await expect(owner).toHaveURL(/\/privacy\/exports/u)
    await expect(owner.getByRole('heading', { name: /export register/i })).toBeVisible()
  })
})
