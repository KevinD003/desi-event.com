import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * Organiser analytics, against real rows.
 *
 * What this proves that a unit test cannot: that the figure on the page came
 * out of the ledger the seed posted, that the export is the same data under the
 * same allow list, and that an account holding `report:view` without
 * `finance:view` gets the counts and *does not receive* the money — not that
 * the money is hidden from it, which is a different and much weaker claim.
 *
 * @module e2e/detail-analytics
 */

/** What the seeded ledger says was collected, in minor units. */
const COLLECTED_CENTS = 200_000

/**
 * This run's seeded ids.
 *
 * Read inside each test rather than at module scope, because module scope runs
 * before global setup has written the file.
 *
 * @returns {object} The world.
 */
const ids = () => world()

test.describe('organiser analytics', () => {
  test('reports what the ledger says', async ({ owner }) => {
    await owner.goto(`/analytics?organizationId=${ids().alphaOrganizationId}`)
    await expect(owner.getByRole('heading', { level: 1 })).toBeVisible()

    await expect(owner.getByRole('heading', { name: /money, from the ledger/i })).toBeVisible()

    const rendered = await owner.locator('main').innerText()

    // 200,000 minor units, posted as a balanced batch by the seed and read back
    // out of `organizer_payable` and friends rather than off the order.
    expect(rendered).toMatch(/2,000\.00|2000\.00/u)
  })

  test('names the step it cannot count instead of estimating it', async ({ owner }) => {
    await owner.goto(`/analytics?organizationId=${ids().alphaOrganizationId}`)

    const rendered = await owner.locator('main').innerText()

    // Nothing here records a page view, so the step everybody means by
    // "conversion" does not exist as data. Saying so is the honest answer;
    // deriving it from order counts would be inventing a metric.
    expect(rendered.toLowerCase()).toContain('page views')
    expect(rendered).toMatch(/tickets held/i)
    expect(rendered).toMatch(/orders paid/i)
  })

  test('says which mode produced the figures', async ({ owner }) => {
    await owner.goto(`/analytics?organizationId=${ids().alphaOrganizationId}`)

    const rendered = await owner.locator('main').innerText()

    expect(rendered).toMatch(/demo|no money moved/i)
  })

  test('keeps the chosen organisation in the address, so the view can be shared', async ({
    owner,
  }) => {
    await owner.goto(`/analytics?organizationId=${ids().alphaOrganizationId}&currency=INR`)

    const url = new URL(owner.url())

    expect(url.searchParams.get('organizationId')).toBe(ids().alphaOrganizationId)
    expect(url.searchParams.get('currency')).toBe('INR')
  })

  test('exports a spreadsheet with no buyer, no card and no provider reference', async ({
    owner,
  }) => {
    const response = await owner.request.get(
      `/api/v1/analytics/export.csv?organizationId=${ids().alphaOrganizationId}&currency=INR`,
    )

    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')

    const body = await response.text()
    const [header] = body.split('\r\n')

    expect(header).toBe('Section,Item,Code,Quantity,Amount (minor units),Currency,Note')

    for (const needle of ['holder-', '@attendee.test', 'Ticket Holder', 'mock_', 'card', 'cvc']) {
      expect(body.toLowerCase(), `the export carries ${needle}`).not.toContain(needle.toLowerCase())
    }
  })

  test('gives a viewer the counts and does not send them the money', async ({ viewer }) => {
    await viewer.goto(`/analytics?organizationId=${ids().alphaOrganizationId}`)
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible()

    const rendered = await viewer.locator('main').innerText()
    const html = await viewer.content()

    expect(rendered).toMatch(/money figures are not included/i)
    // Absent from the payload, not from the markup. If the server had sent the
    // figure and the screen hidden it, the number would still be in the HTML.
    expect(html).not.toContain(String(COLLECTED_CENTS))
    expect(html).not.toMatch(/2,000\.00/u)

    // The counts survive, which is what the capability actually grants — and
    // this account holds no second factor, because VIEWER is not a privileged
    // role and nothing compels one.
    expect(rendered).toMatch(/live tickets/i)
  })

  test('refuses an organisation it was not asked to substitute', async ({ owner }) => {
    await owner.goto(`/analytics?organizationId=${ids().betaOrganizationId}`)

    const rendered = await owner.locator('body').innerText()

    // Refused rather than quietly replaced with this account's own. An address
    // naming one organisation and showing another's figures is how somebody
    // bookmarks, shares or screenshots a number attributed to the wrong one.
    expect(rendered).toMatch(/not for you/i)
    expect(rendered).not.toMatch(/2,000\.00/u)
  })
})
