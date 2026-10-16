import { expect, test } from '@playwright/test'

test.describe('listing filters', () => {
  test('choosing a category narrows the listing and updates the URL', async ({ page }) => {
    await page.goto('/events')

    await expect(page.getByTestId('result-count')).toContainText('17 events')

    await page.getByLabel('Category').selectOption('MUSIC_CONCERT')

    await expect(page).toHaveURL(/category=MUSIC_CONCERT/)
    await expect(page.getByTestId('result-count')).toContainText('1 event')
    await expect(
      page.getByRole('link', { name: 'Live Garba Band Night with the Mirrorwork Ensemble' }),
    ).toBeVisible()
  })

  test('the city filter and the category filter combine', async ({ page }) => {
    await page.goto('/events')

    await page.getByLabel('City').selectOption('Edison')
    await expect(page).toHaveURL(/city=Edison/)
    await expect(page.getByTestId('result-count')).toContainText('3 events in Edison')

    await page.getByLabel('Category').selectOption('MUSIC_CONCERT')
    await expect(page).toHaveURL(
      /category=MUSIC_CONCERT.*city=Edison|city=Edison.*category=MUSIC_CONCERT/,
    )
    await expect(page.getByTestId('result-count')).toContainText('1 event in Edison')
  })

  test('a free-text search applies on submit and survives a reload', async ({ page }) => {
    await page.goto('/events')

    // "workshop" rather than "garba": nearly every night in the catalogue is a
    // garba night, and a search that narrows seventeen to sixteen proves less
    // than one that narrows it to two.
    await page.getByLabel('Search').fill('workshop')
    await page.getByRole('button', { name: 'Apply' }).click()

    await expect(page).toHaveURL(/q=workshop/)
    await expect(page.getByTestId('result-count')).toContainText('2 events matching')

    await page.reload()
    await expect(page.getByLabel('Search')).toHaveValue('workshop')
    await expect(page.getByTestId('result-count')).toContainText('2 events matching')
  })

  test('a search that matches nothing explains itself instead of showing a blank grid', async ({
    page,
  }) => {
    await page.goto('/events?q=polka')

    await expect(page.getByRole('heading', { name: 'Nothing matches that' })).toBeVisible()
    await page.getByRole('link', { name: 'Clear all filters' }).click()

    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByRole('list', { name: 'Matching events' })).toBeVisible()
  })

  test('clearing the filters returns to the canonical listing URL', async ({ page }) => {
    await page.goto('/events?category=MUSIC_CONCERT&city=Edison')

    await page.getByRole('button', { name: 'Clear' }).click()

    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByLabel('Category')).toHaveValue('')
    await expect(page.getByLabel('City')).toHaveValue('')
  })

  test('a category tile on the home page lands on a filtered listing', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('link', { name: /^Garba & Dandiya/ })
      .first()
      .click()

    await expect(page).toHaveURL(/category=GARBA_DANDIYA/)
    await expect(page.getByLabel('Category')).toHaveValue('GARBA_DANDIYA')
  })

  test('a category chosen before the page has hydrated is still applied', async ({ page }) => {
    // Hold the page's scripts back, so the choice lands on the server's HTML
    // with no handler attached, as it can for a visitor on a slow connection.
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    await page.route(/\/_next\/static\/chunks\/.*\.js(\?|$)/, async (route) => {
      await held
      await route.continue()
    })

    await page.goto('/events', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('result-count')).toContainText('17 events')
    await page.getByLabel('Category').selectOption('MUSIC_CONCERT')

    // Nothing can have answered the choice yet.
    await expect(page).toHaveURL(/\/events$/)

    release()

    await expect(page).toHaveURL(/category=MUSIC_CONCERT/)
    await expect(page.getByTestId('result-count')).toContainText('1 event')
    await expect(page.getByLabel('Category')).toHaveValue('MUSIC_CONCERT')
  })

  test('a state lists only its cities, and a new state clears the city', async ({ page }) => {
    await page.goto('/events')
    await expect(page.locator('form[aria-label="Filter events"]')).toHaveAttribute(
      'data-enhanced',
      'true',
    )

    const region = page.getByLabel('State or province')
    const city = page.getByLabel('City')

    // Grouped under the country, with how many events each state has.
    await expect(region.locator('optgroup[label="United States"]')).toHaveCount(1)
    await expect(region.locator('option[value="US-NJ"]')).toHaveText(/^New Jersey \(\d+\)$/)

    await region.selectOption('US-NJ')
    await expect(page).toHaveURL(/region=US-NJ/)
    await expect(page.getByTestId('result-count')).toContainText('in New Jersey')
    await expect(city.locator('option')).toHaveText([
      'Every city in New Jersey',
      'Edison',
      'Jersey City',
    ])

    await city.selectOption('Edison')
    await expect(page).toHaveURL(/region=US-NJ&city=Edison/)
    await expect(page.getByTestId('result-count')).toContainText('3 events in Edison, NJ')

    await region.selectOption('US-TX')
    await expect(page).toHaveURL(/region=US-TX$/)
    await expect(city).toHaveValue('')
    await expect(page.getByTestId('result-count')).toContainText('in Texas')
    await expect(city.locator('option', { hasText: 'Edison' })).toHaveCount(0)
  })

  test('a city outside the chosen state is dropped, as a form without JavaScript sends it', async ({
    page,
  }) => {
    await page.goto('/events?region=US-TX&city=Edison')

    await expect(page.getByLabel('State or province')).toHaveValue('US-TX')
    await expect(page.getByLabel('City')).toHaveValue('')
    await expect(page.getByTestId('result-count')).toContainText('in Texas')
  })

  test('more filters open from the keyboard and combine with the place', async ({ page }) => {
    await page.goto('/events?region=US-NJ')

    const summary = page.locator('form[aria-label="Filter events"] summary')
    await summary.focus()
    await page.keyboard.press('Enter')

    await page.getByLabel('Format').selectOption('in_person')
    await expect(page).toHaveURL(/region=US-NJ.*format=in_person/)
    await expect(page.getByTestId('result-count')).toContainText('in-person events in New Jersey')

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByLabel('State or province')).toHaveValue('')
    await expect(page.getByLabel('Format')).toHaveValue('')
  })

  test('the filter bar works as a plain GET form', async ({ page }) => {
    await page.goto('/events')
    const form = page.getByRole('form', { name: 'Filter events' })

    await expect(form).toHaveAttribute('action', '/events')
    await expect(form).toHaveAttribute('method', 'get')
  })
})
