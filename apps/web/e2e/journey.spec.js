import { expect, test } from '@playwright/test'

test.describe('home → events → event → checkout', () => {
  test('a visitor can get from the home page to a priced basket', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nine nights of garba')

    await page.getByRole('link', { name: 'Browse every event' }).click()
    await expect(page).toHaveURL(/\/events$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('What’s on')

    const listing = page.getByRole('list', { name: 'Matching events' })
    await expect(listing).toBeVisible()

    const firstCard = listing.getByRole('listitem').first()
    const eventLink = firstCard.getByRole('link').first()
    const eventTitle = (await eventLink.textContent())?.trim()

    await eventLink.click()
    await expect(page).toHaveURL(/\/events\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(eventTitle)

    await expect(page.getByRole('heading', { name: 'About this event' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Venue' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Ticket types' })).toBeVisible()

    await page.getByRole('link', { name: 'Choose tickets' }).click()
    await expect(page).toHaveURL(/\/checkout$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Tickets for ${eventTitle}`)

    const continueButton = page.getByRole('button', { name: /Select tickets to continue/ })
    await expect(continueButton).toBeDisabled()

    const total = page.getByTestId('summary-total')
    const emptyTotal = await total.textContent()

    await page
      .getByRole('button', { name: /^Add one / })
      .first()
      .click()

    await expect(total).not.toHaveText(emptyTotal)
    await expect(page.getByRole('button', { name: 'Reserve tickets' })).toBeEnabled()
    await expect(page.getByText(/1 ticket for /)).toBeVisible()
  })

  test('the event title on a card matches the page it leads to', async ({ page }) => {
    await page.goto('/events/qawwali-under-the-banyan')

    await expect(page).toHaveTitle(/Qawwali Under the Banyan/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Qawwali Under the Banyan')
    await expect(page.getByText('Jio World Garden', { exact: true })).toBeVisible()
  })

  test('quantities respect what is left and what the organiser allows', async ({ page }) => {
    await page.goto('/events/qawwali-under-the-banyan/checkout')

    const addLawn = page.getByRole('button', { name: 'Add one Lawn Entry' })
    const lawnQuantity = page.getByLabel('Quantity of Lawn Entry')

    for (let click = 0; click < 12; click += 1) {
      if (await addLawn.isDisabled()) break
      await addLawn.click()
    }

    await expect(addLawn).toBeDisabled()
    await expect(lawnQuantity).toHaveValue('10')

    await page.getByRole('button', { name: 'Remove one Lawn Entry' }).click()
    await expect(addLawn).toBeEnabled()
    await expect(lawnQuantity).toHaveValue('9')
  })

  test('a sold-out tier cannot be added to the basket', async ({ page }) => {
    await page.goto('/events/qawwali-under-the-banyan/checkout')

    await expect(page.getByLabel('Quantity of Mehfil Floor — Front Cushions')).toHaveCount(0)
    await expect(page.getByText('Sold out').first()).toBeVisible()
  })

  test('an unknown event answers with the not-found page, not a stack trace', async ({ page }) => {
    const response = await page.goto('/events/this-event-does-not-exist')

    // 200 rather than 404, and deliberately so: Next.js 16.3.5 buys the 404
    // status by failing the render, and a failed render has no body. The page
    // a visitor can read was judged worth more than the status code, and the
    // page carries 'noindex, nofollow' so nothing indexes it. An unmatched
    // URL — which the router refuses rather than the renderer — still answers
    // a genuine 404; e2e/not-found.spec.js holds both halves.
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not on the bill')
    await expect(page.getByRole('link', { name: 'Browse every event' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('ECONNREFUSED')
  })
})
