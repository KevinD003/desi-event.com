import { expect, test } from '@playwright/test'

/**
 * Journey: an event page leads to its organiser, and the organiser page stands
 * on its own.
 *
 * Runs against the fallback catalogue, like every spec in this directory — the
 * API is deliberately not started, so this also proves the organiser link on a
 * fallback-rendered event page leads somewhere rather than to a 404.
 */
test.describe('event → organiser', () => {
  test('a visitor can reach an organiser from an event and read their page', async ({ page }) => {
    await page.goto('/events/qawwali-under-the-banyan')

    const presentedBy = page.getByRole('region', { name: 'Presented by' })
    const organiserLink = presentedBy.getByRole('link').first()
    const organiserName = (await organiserLink.textContent())?.trim()

    await organiserLink.click()
    await expect(page).toHaveURL(/\/organizers\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(organiserName)

    await expect(page.getByRole('region', { name: 'Upcoming events' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Previously' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Refunds' })).toBeVisible()
  })

  test('an organiser page leads back to one of their events', async ({ page }) => {
    await page.goto('/organizers/swar-sadhana-trust')

    const upcoming = page.getByRole('region', { name: 'Upcoming events' })
    const eventLink = upcoming.getByRole('link').first()
    // The link carries the title and the date; the first span is the title.
    const title = (await eventLink.locator('span').first().textContent())?.trim()

    await eventLink.click()
    await expect(page).toHaveURL(/\/events\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  })

  test('the badge appears only for an organiser who has it', async ({ page }) => {
    await page.goto('/organizers/swar-sadhana-trust')
    await expect(page.getByText('Verified organiser')).toBeVisible()

    // Masala Arts London is UNVERIFIED in the catalogue, and the page says
    // nothing at all rather than saying something softer.
    await page.goto('/organizers/masala-arts-london')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Masala Arts London')
    await expect(page.getByText('Verified organiser')).toHaveCount(0)
    await expect(page.getByText(/pending|awaiting verification/i)).toHaveCount(0)
  })

  test('the page is readable with JavaScript turned off', async ({ browser }) => {
    // The one thing this page must survive: a visitor on a bad connection
    // checking an organiser before spending money.
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()

    await page.goto('/organizers/swar-sadhana-trust')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Swar Sadhana Trust')
    await expect(page.getByRole('region', { name: 'Upcoming events' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Refunds' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Margam/ })).toBeVisible()

    await context.close()
  })

  test('an organiser nobody has is not found, and says nothing about why', async ({ page }) => {
    await page.goto('/organizers/no-such-organiser-anywhere')

    await expect(page.getByTestId('not-found-view')).toBeVisible()
    await expect(page.getByText(/suspend|revok|under review|moderat/i)).toHaveCount(0)
  })

  test('no organiser contact address is published on the page', async ({ page }) => {
    await page.goto('/organizers/swar-sadhana-trust')

    // The whole page, footer included: the footer once carried an invented
    // address for organisers, and no address on this site reaches anybody.
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0)
    await expect(page.getByText(/@swarsadhana\.example/)).toHaveCount(0)
  })
})
