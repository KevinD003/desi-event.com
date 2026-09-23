import { expect, test } from '@playwright/test'

import { firstSpokenText } from './support/link-text.js'

/**
 * Journey: an event leads to its venue, and the venue page stands on its own.
 *
 * Runs against the fallback catalogue like every spec here, so it also proves
 * the venue link on a fallback-rendered event page leads somewhere rather than
 * to a 404 — which is when internal consistency matters most.
 */
test.describe('event → venue', () => {
  test('a visitor reaches a venue from an event and reads its page', async ({ page }) => {
    await page.goto('/events/bay-lights-garba-opening')

    const where = page.getByRole('region', { name: 'Venue' })
    const venueLink = where.getByRole('link').first()
    const venueName = (await venueLink.textContent())?.trim()

    await venueLink.click()
    await expect(page).toHaveURL(/\/venues\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(venueName)

    await expect(page.getByRole('region', { name: 'Where it is' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Accessibility' })).toBeVisible()
    await expect(page.getByRole('region', { name: /What/ })).toBeVisible()
  })

  test('accessibility claims are readable text, not icons', async ({ page }) => {
    await page.goto('/venues/santa-clara-valley-expo')

    const access = page.getByRole('region', { name: 'Accessibility' })

    await expect(access.getByText('Step-free entrance')).toBeVisible()
    await expect(access.getByText('Accessible toilet')).toBeVisible()
  })

  test('the page renders without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()

    await page.goto('/venues/santa-clara-valley-expo')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Santa Clara Valley Expo')
    await expect(page.getByRole('region', { name: 'Where it is' })).toBeVisible()
    await expect(page.getByText('Step-free entrance')).toBeVisible()
    await expect(page.locator('address')).toContainText('Santa Clara')

    await context.close()
  })

  test('publishes Place structured data', async ({ page }) => {
    await page.goto('/venues/santa-clara-valley-expo')

    const json = JSON.parse(
      await page.locator('script[type="application/ld+json"]').first().textContent(),
    )

    expect(json['@type']).toBe('Place')
    expect(json.address.addressLocality).toBe('Santa Clara')
  })

  test('a venue nobody has is not found, and says nothing about why', async ({ page }) => {
    await page.goto('/venues/no-such-venue-anywhere')

    await expect(page.getByTestId('not-found-view')).toBeVisible()
    await expect(page.getByText(/merged|private|suspend/i)).toHaveCount(0)
  })

  test('the venue page leads back to an event on there', async ({ page }) => {
    await page.goto('/venues/santa-clara-valley-expo')

    const whatsOn = page.getByRole('region', { name: /What/ })
    const link = whatsOn.getByRole('link').first()
    const title = await firstSpokenText(link)

    await link.click()
    await expect(page).toHaveURL(/\/events\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  })

  test('fits a phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto('/venues/santa-clara-valley-expo')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('respects reduced motion, leaving nothing permanently invisible', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()

    await page.goto('/venues/santa-clara-valley-expo')

    await expect(page.getByRole('region', { name: 'Accessibility' })).toBeVisible()
    await expect(page.getByRole('region', { name: /What/ })).toBeVisible()

    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('section, h2')].filter(
          (el) => Number.parseFloat(getComputedStyle(el).opacity) === 0,
        ).length,
    )

    expect(hidden).toBe(0)

    await context.close()
  })
})
