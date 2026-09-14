/**
 * Reduced motion, on every public page, under every condition that matters.
 *
 * The defect this guards against was invisible to a screenshot diff and to
 * every unit test: the server renders before it can know the visitor's motion
 * preference, so it inlines `opacity: 0` for the entrance animations. A visitor
 * who prefers reduced motion hydrated into a branch that set no style at all,
 * and React left the server's inline style in place. Twenty-one elements —
 * the hero among them — stayed invisible permanently.
 *
 * The fix is a CSS rule, because CSS is the only layer here that cannot
 * disagree with the server. These tests exist to make sure it stays.
 */

import { expect, test } from '@playwright/test'

/** Every page a visitor can reach without signing in. */
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'listing', path: '/events' },
  { name: 'filtered listing', path: '/events?category=COMEDY' },
  { name: 'searched listing', path: '/events?q=garba' },
  { name: 'event detail', path: '/events/qawwali-under-the-banyan' },
  { name: 'checkout', path: '/events/qawwali-under-the-banyan/checkout' },
  { name: 'not found', path: '/events/no-such-event-at-all' },
]

const WIDTHS = [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]

/**
 * Elements still invisible after each one has been scrolled into view.
 *
 * Under reduced motion nothing should ever be hidden, so this is called with no
 * scrolling needed. Under no-preference, below-the-fold content is legitimately
 * at opacity 0 until its reveal fires — so each candidate is scrolled to
 * individually and re-checked. Stepping past an element does not reliably
 * trigger its observer; bringing it into view does.
 *
 * @param {object} page The Playwright page.
 * @param {object} [options] Options.
 * @param {boolean} [options.reveal] Scroll each hidden element into view before judging.
 * @returns {Promise<string[]>} A description of each element that is still hidden.
 */
async function stillHidden(page, { reveal = false } = {}) {
  const describe = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-motion]')]
        .map((element, index) => ({ element, index }))
        .filter(({ element }) => Number.parseFloat(getComputedStyle(element).opacity) === 0)
        .map(({ index }) => index),
    )

  let candidates = await describe()

  if (reveal && candidates.length > 0) {
    for (const index of candidates) {
      await page.evaluate((target) => {
        const element = document.querySelectorAll('[data-motion]')[target]
        element?.scrollIntoView({ block: 'center', behavior: 'instant' })
      }, index)
      await page.waitForTimeout(120)
    }

    await page.waitForTimeout(500)
    candidates = await describe()
  }

  return page.evaluate(
    (indexes) =>
      indexes.map((index) => {
        const element = document.querySelectorAll('[data-motion]')[index]
        return `${element.tagName}: ${element.textContent.trim().slice(0, 40)}`
      }),
    candidates,
  )
}

for (const { name: width, viewport } of WIDTHS) {
  test.describe(`reduced motion at ${width} width`, () => {
    test.use({ reducedMotion: 'reduce', viewport })

    for (const { name, path } of PAGES) {
      test(`${name} leaves no content hidden`, async ({ page }) => {
        await page.goto(path)
        await page.waitForLoadState('networkidle')

        expect(await stillHidden(page)).toEqual([])
      })
    }

    test('content stays visible across a client-side route navigation', async ({ page }) => {
      // Hydration is the risky moment, and a client-side navigation re-runs it
      // for the new route without a fresh document.
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await page
        .getByRole('link', { name: /browse every event/i })
        .first()
        .click()
      await page.waitForURL(/\/events/)
      await page.waitForLoadState('networkidle')

      expect(await stillHidden(page)).toEqual([])

      await page.goBack()
      await page.waitForLoadState('networkidle')

      expect(await stillHidden(page)).toEqual([])
    })
  })
}

test.describe('no-preference is unaffected', () => {
  test.use({ reducedMotion: 'no-preference' })

  for (const { name, path } of PAGES) {
    test(`${name} reveals everything once it is scrolled into view`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      // Below-the-fold elements are legitimately at opacity 0 until revealed.
      // This fails only if something stays hidden after being scrolled to,
      // which is the actual defect: content that never appears.
      expect(await stillHidden(page, { reveal: true })).toEqual([])
    })
  }
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  // Every page except the not-found route, which Next does not server-render
  // when `notFound()` is thrown from a force-dynamic page: it emits
  // `<html id="__next_error__">` with the content in the RSC payload only.
  // Tracked as a known limitation in POST_EFDA577_CORRECTIVE_REPORT.md.
  const SERVER_RENDERED = PAGES.filter(({ name }) => name !== 'not found')

  for (const { name, path } of SERVER_RENDERED) {
    test(`${name} is readable with no JavaScript at all`, async ({ page }) => {
      // The server-rendered document is what a visitor sees before hydration,
      // and all they will ever see if the bundle fails to load. Entrance
      // animations never run, so anything rendered at opacity 0 would stay
      // that way: `@media (scripting: none)` forces the final state.
      await page.goto(path)

      const hidden = await page.evaluate(
        () =>
          [...document.querySelectorAll('[data-motion]')].filter(
            (element) => Number.parseFloat(getComputedStyle(element).opacity) === 0,
          ).length,
      )

      expect(hidden).toBe(0)

      // And the page still says something.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  }

  test('an unrouted path still server-renders its 404', async ({ page }) => {
    // Next's own not-found page does server-render, which is what makes the
    // force-dynamic case above a gap rather than a framework limitation.
    const response = await page.goto('/totally-unknown-path')

    expect(response.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
