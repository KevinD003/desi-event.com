/**
 * Keyboard focus across filter changes.
 *
 * These assert `document.activeElement`, not appearance. The defect they guard
 * against was invisible in a screenshot: the filter bar was remounted on every
 * change, so a keyboard or screen-reader user who altered the category select
 * was silently dropped at the document body, mid-interaction, with no idea what
 * had happened.
 */

import { expect, test } from '@playwright/test'

/** Desktop and a narrow phone; the filter bar reflows between them. */
const WIDTHS = [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]

/**
 * Report what currently holds focus.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<{tag: string, name: string|null, id: string|null}>} The active element.
 */
function activeElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement

    return {
      tag: element?.tagName?.toLowerCase() ?? null,
      name: element?.getAttribute?.('name') ?? null,
      id: element?.id ?? null,
    }
  })
}

for (const { name, viewport } of WIDTHS) {
  test.describe(`filter focus at ${name} width`, () => {
    test.use({ viewport })

    test('the category select keeps focus after the listing updates', async ({ page }) => {
      await page.goto('/events')

      const category = page.locator('select[name="category"]')
      await category.focus()
      expect((await activeElement(page)).name).toBe('category')

      await category.selectOption({ index: 1 })
      await page.waitForURL(/category=/)

      // The whole point: focus is still on the control the visitor was using.
      const after = await activeElement(page)
      expect(after.tag).toBe('select')
      expect(after.name).toBe('category')
      expect(after.tag).not.toBe('body')
    })

    test('the search box keeps focus and its caret after submitting', async ({ page }) => {
      await page.goto('/events')

      // Before hydration a submit is a plain GET that loads a new page, which
      // is right without JavaScript. Keeping focus is the enhanced form's job,
      // so wait for it.
      await expect(page.locator('form[aria-label="Filter events"]')).toHaveAttribute(
        'data-enhanced',
        'true',
      )

      const search = page.locator('input[name="q"]')
      await search.click()
      await search.fill('garba')
      await search.press('Enter')
      await page.waitForURL(/q=garba/)

      const after = await activeElement(page)
      expect(after.name).toBe('q')
      await expect(search).toHaveValue('garba')
    })

    test('a keyboard-only visitor can filter without ever touching the mouse', async ({ page }) => {
      await page.goto('/events')

      await page.locator('select[name="city"]').focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')

      await page.waitForLoadState('networkidle')

      const after = await activeElement(page)
      expect(after.tag).not.toBe('body')
    })
  })
}

test.describe('announcements and deliberate focus movement', () => {
  test('a polite live region reports the result count', async ({ page }) => {
    await page.goto('/events')

    // Scoped to the filter bar: the sample-data notice is also a status region.
    const live = page.locator(
      'form[aria-label="Filter events"] [role="status"][aria-live="polite"]',
    )
    await expect(live).toHaveCount(1)

    // Empty on first paint: a screen reader is already reading the page, and
    // announcing the initial count would talk over it.
    await expect(live).toHaveText('')

    await page.locator('select[name="category"]').selectOption({ index: 1 })
    await page.waitForURL(/category=/)

    // Both phrasings, because the component writes "1 event matches" and
    // "N events match" — correct English, and a regex that only covered the
    // plural passed for as long as the filtered count happened to be above one.
    await expect(live).toHaveText(/^\d+ events? match(es)? your filters$/)
  })

  test('focus moves to the results only when the visitor asks', async ({ page }) => {
    await page.goto('/events')

    await page.getByRole('link', { name: 'Skip to results' }).click()

    const after = await activeElement(page)
    expect(after.id).toBe('event-results')
  })

  test('filters do not steal focus on load', async ({ page }) => {
    await page.goto('/events?category=WORKSHOP')

    const after = await activeElement(page)
    // Nothing in the filter bar grabs focus by itself.
    expect(['body', 'html']).toContain(after.tag)
  })
})

test.describe('filter focus under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('focus survives a filter change and no content is left invisible', async ({ page }) => {
    await page.goto('/events')

    const category = page.locator('select[name="category"]')
    await category.focus()
    await category.selectOption({ index: 1 })
    await page.waitForURL(/category=/)

    expect((await activeElement(page)).name).toBe('category')

    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-motion]')].filter(
          (element) => Number.parseFloat(getComputedStyle(element).opacity) === 0,
        ).length,
    )

    expect(hidden).toBe(0)
  })
})
