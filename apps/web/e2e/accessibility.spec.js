import { expect, test } from '@playwright/test'

/** The pages a visitor actually walks through, checked on every structural rule. */
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'listing', path: '/events' },
  { name: 'filtered listing', path: '/events?category=WORKSHOP' },
  { name: 'event detail', path: '/events/bay-lights-garba-opening' },
  { name: 'checkout', path: '/events/bay-lights-garba-opening/checkout' },
  { name: 'organiser', path: '/organizers/bay-lights-garba-co' },
  { name: 'unverified organiser', path: '/organizers/liberty-bell-navratri' },
  { name: 'venue', path: '/venues/santa-clara-valley-expo' },
  { name: 'not found', path: '/events/no-such-event' },
]

test.describe('accessibility smoke checks', () => {
  for (const { name, path } of PAGES) {
    test(`${name} has exactly one h1 and the three document landmarks`, async ({ page }) => {
      await page.goto(path)

      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('banner')).toHaveCount(1)
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(page.getByRole('contentinfo')).toHaveCount(1)
    })

    test(`${name} names every image and never leaks an error to the visitor`, async ({ page }) => {
      await page.goto(path)

      // Scoped to `main`: the dev server injects its own unlabelled indicator
      // svg into the document, and that is Next's markup, not the site's.
      const images = page.getByRole('main').getByRole('img')
      const count = await images.count()

      expect(count).toBeGreaterThanOrEqual(0)

      for (let index = 0; index < count; index += 1) {
        await expect(images.nth(index)).toHaveAccessibleName(/\S/)
      }

      await expect(page.locator('body')).not.toContainText(/ECONNREFUSED|fetch failed|at Object\./)
    })

    test(`${name} declares its language and a title`, async ({ page }) => {
      await page.goto(path)

      await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
      await expect(page).toHaveTitle(/\S/)
    })

    test(`${name} fits a 360px viewport without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 })
      await page.goto(path)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )

      expect(overflow).toBeLessThanOrEqual(1)
    })
  }

  test('the skip link is the first thing in the tab order and moves focus to the content', async ({
    page,
  }) => {
    await page.goto('/')

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Skip to main content' })

    await expect(skipLink).toBeFocused()
    await expect(skipLink).toBeVisible()

    await skipLink.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()
  })

  test('every filter control is labelled', async ({ page }) => {
    await page.goto('/events')

    for (const label of ['Category', 'City', 'Search']) {
      await expect(page.getByLabel(label)).toBeVisible()
    }
  })

  test('every quantity control is labelled with the tier it belongs to', async ({ page }) => {
    await page.goto('/events/bay-lights-garba-opening/checkout')

    await expect(page.getByLabel('Quantity of VIP')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add one VIP' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove one VIP' })).toBeVisible()
  })

  test('the primary navigation and the listing are exposed as named regions', async ({ page }) => {
    await page.goto('/events')

    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Matching events' })).toBeVisible()
  })

  test('headings on the event page descend without skipping a level', async ({ page }) => {
    await page.goto('/events/bay-lights-garba-opening')

    const levels = await page
      .locator('main h1, main h2, main h3')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))))

    expect(levels[0]).toBe(1)
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1)
    }
  })

  test('keyboard focus is visible on the first interactive element', async ({ page }) => {
    await page.goto('/events')

    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const active = document.activeElement
      if (!active) return null
      const style = getComputedStyle(active)

      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })

    expect(outline).not.toBeNull()
    expect(outline.outlineStyle).not.toBe('none')
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  // A regression guard for a real defect, not a hypothetical one. The server
  // renders markup before it can know the visitor's motion preference, so it
  // inlines `opacity: 0` for the entrance animations. A visitor who prefers
  // reduced motion hydrates into a branch that sets no style, and React leaves
  // the server's inline style in place: every animated element stayed
  // invisible, permanently. CSS under `prefers-reduced-motion` now forces the
  // final state. If that rule is ever dropped, this test fails.
  for (const { name, path } of PAGES) {
    test(`${name} renders no permanently invisible content`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const hidden = await page.evaluate(() =>
        [...document.querySelectorAll('[data-motion]')]
          .filter((element) => Number.parseFloat(getComputedStyle(element).opacity) === 0)
          .map((element) => element.textContent.trim().slice(0, 60)),
      )

      expect(hidden).toEqual([])
    })
  }

  test('the home page hero is readable, not merely present', async ({ page }) => {
    await page.goto('/')

    const hero = page.getByRole('heading', { level: 1 })
    await expect(hero).toBeVisible()
    await expect(hero).toHaveCSS('opacity', '1')
  })
})
