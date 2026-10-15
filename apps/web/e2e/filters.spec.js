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

  test('the filter bar works as a plain GET form', async ({ page }) => {
    await page.goto('/events')
    const form = page.getByRole('form', { name: 'Filter events' })

    await expect(form).toHaveAttribute('action', '/events')
    await expect(form).toHaveAttribute('method', 'get')
  })
})
