import { expect, test } from '@playwright/test'

test.describe('listing filters', () => {
  test('choosing a category narrows the listing and updates the URL', async ({ page }) => {
    await page.goto('/events')

    await expect(page.getByTestId('result-count')).toContainText('10 events')

    await page.getByLabel('Category').selectOption('COMEDY')

    await expect(page).toHaveURL(/category=COMEDY/)
    await expect(page.getByTestId('result-count')).toContainText('1 event')
    await expect(page.getByRole('link', { name: 'Desi Comedy Uncensored' })).toBeVisible()
  })

  test('the city filter and the category filter combine', async ({ page }) => {
    await page.goto('/events')

    await page.getByLabel('City').selectOption('London')
    await expect(page).toHaveURL(/city=London/)
    await expect(page.getByTestId('result-count')).toContainText(
      '3 events in London',
    )

    await page.getByLabel('Category').selectOption('COMEDY')
    await expect(page).toHaveURL(/category=COMEDY.*city=London|city=London.*category=COMEDY/)
    await expect(page.getByTestId('result-count')).toContainText('1 event')
  })

  test('a free-text search applies on submit and survives a reload', async ({ page }) => {
    await page.goto('/events')

    await page.getByLabel('Search').fill('garba')
    await page.getByRole('button', { name: 'Apply' }).click()

    await expect(page).toHaveURL(/q=garba/)
    await expect(page.getByTestId('result-count')).toContainText(
      '2 events matching',
    )

    await page.reload()
    await expect(page.getByLabel('Search')).toHaveValue('garba')
    await expect(page.getByTestId('result-count')).toContainText(
      '2 events matching',
    )
  })

  test('a search that matches nothing explains itself instead of showing a blank grid', async ({
    page,
  }) => {
    await page.goto('/events?q=polka')

    await expect(page.getByRole('heading', { name: 'Nothing matches that yet' })).toBeVisible()
    await page.getByRole('link', { name: 'Clear all filters' }).click()

    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByRole('list', { name: 'Matching events' })).toBeVisible()
  })

  test('clearing the filters returns to the canonical listing URL', async ({ page }) => {
    await page.goto('/events?category=COMEDY&city=London')

    await page.getByRole('button', { name: 'Clear' }).click()

    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByLabel('Category')).toHaveValue('')
    await expect(page.getByLabel('City')).toHaveValue('')
  })

  test('a category tile on the home page lands on a filtered listing', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: /^Garba & Dandiya/ }).first().click()

    await expect(page).toHaveURL(/category=GARBA_DANDIYA/)
    await expect(page.getByLabel('Category')).toHaveValue('GARBA_DANDIYA')
  })

  test('the filter bar works as a plain GET form', async ({ page }) => {
    await page.goto('/events')
    const form = page.getByRole('form', { name: 'Filter events' })

    await expect(form).toHaveAttribute('action', '/events')
    await expect(form).toHaveAttribute('method', 'get')
  })
})
