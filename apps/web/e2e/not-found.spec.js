/**
 * The not-found experience, measured against a compiled production build.
 *
 * The defect these tests were written for: every URL that resolved to a route
 * but not to a resource — `/events/<unknown-slug>` and its checkout step —
 * answered with a document whose `<body>` was empty. The not-found copy existed
 * only inside the Flight payload, so a visitor saw it only once the browser had
 * downloaded, parsed and hydrated the app, and a visitor without JavaScript
 * never saw it at all.
 *
 * The cause is in Next.js 16.3.5 rather than in this app: `notFound()` is
 * handled by the renderer's error-recovery path, which emits
 * `<html id="__next_error__">` with nothing inside it. That was reproduced with
 * and without `force-dynamic`, with and without a Suspense or `loading.js`
 * boundary, with a segment-local `not-found.js`, with `experimental
 * .globalNotFound` enabled, from a Server Component and from a Client
 * Component, and in a pristine single-page application built on the same
 * installed version. In every case the body was empty.
 *
 * So the routes render the not-found view themselves. These tests hold the two
 * things that actually matter — the page is in the *first* response, and it
 * does not need JavaScript — plus the SEO guarantees that go with answering a
 * missing resource at all.
 *
 * @module e2e/not-found
 */

import { expect, test } from '@playwright/test'

/** The one heading every missing resource shows, whatever went missing. */
const HEADING = 'This one is not on the bill'

/** An event the fallback catalogue always holds, used to prove valid routes still work. */
const VALID_EVENT = '/events/qawwali-under-the-banyan'

/**
 * Every URL that must answer with the not-found page, and the status it returns.
 *
 * The two statuses are not a slip. A URL matching no route at all is refused by
 * the router, which then renders `app/not-found.jsx` through the ordinary path:
 * genuine 404, complete body. A URL that matches a route whose *resource* is
 * missing cannot have both in Next.js 16.3.5 — `notFound()` buys the 404 by
 * failing the render, and a failed render has no body. These routes therefore
 * render the page and carry `noindex, nofollow` instead, which is the trade
 * that leaves a visitor with something to read.
 *
 * `/organizers/*` and `/venues/*` have no route in Phase 1, so they are
 * unmatched URLs rather than missing resources. They are listed because they
 * are the URLs a reviewer will try.
 */
const MISSING = [
  { name: 'unknown event slug', path: '/events/no-such-event-at-all', status: 200 },
  { name: 'unknown event checkout', path: '/events/no-such-event-at-all/checkout', status: 200 },
  { name: 'unknown organiser slug', path: '/organizers/nobody', status: 404 },
  { name: 'unknown venue slug', path: '/venues/nowhere', status: 404 },
  { name: 'completely unmatched URL', path: '/totally-unmatched-url', status: 404 },
]

/**
 * The part of a document a visitor could actually see, with scripts removed.
 *
 * Anything inside a `<script>` is the Flight payload, which is exactly what the
 * broken version had and what these tests must not accept as evidence.
 *
 * @param {string} html A complete HTML document.
 * @returns {string} The same document with every script element removed.
 */
function withoutScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '')
}

test.describe('the initial response', () => {
  for (const { name, path, status } of MISSING) {
    test(`${name} answers with the not-found page and no JavaScript involved`, async ({
      request,
    }) => {
      const response = await request.get(path)
      const html = await response.text()
      const visible = withoutScripts(html)

      expect(response.status()).toBe(status)

      // The defect, precisely: an error shell rather than a page.
      expect(html).not.toContain('__next_error__')

      // Visible copy, in the first response, outside every script tag.
      expect(visible).toContain(HEADING)
      expect(visible).toContain('The page you were looking for')

      // A way out: discovery, search, and home.
      expect(visible).toContain('href="/events"')
      expect(visible).toContain('href="/events#filter-q"')
      expect(visible).toContain('href="/"')

      // Not indexable.
      expect(visible).toMatch(/name="robots"[^>]*content="[^"]*noindex/)

      // No structured data claiming a missing event exists.
      expect(html).not.toContain('application/ld+json')

      // No canonical pointing at a page that is not there.
      expect(visible).not.toMatch(/rel="canonical"/)
    })
  }

  test('a valid event page is untouched by the fix', async ({ request }) => {
    const response = await request.get(VALID_EVENT)
    const visible = withoutScripts(await response.text())

    expect(response.status()).toBe(200)
    expect(visible).not.toContain(HEADING)
    expect(visible).toContain('Qawwali')
    expect(visible).toMatch(/rel="canonical"[^>]*qawwali-under-the-banyan/)
  })
})

test.describe('without client-side JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  for (const { name, path } of MISSING) {
    test(`${name} is readable and its links work`, async ({ page }) => {
      await page.goto(path)

      await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible()

      // The URL the visitor typed is still the URL they are on: nothing
      // redirected them anywhere.
      expect(new URL(page.url()).pathname).toBe(path)

      await page.getByRole('link', { name: 'Browse every event' }).click()
      await expect(page).toHaveURL(/\/events$/)
    })
  }
})

test.describe('in a browser', () => {
  for (const { name, path } of MISSING) {
    test(`${name} renders cleanly, with no console or page errors`, async ({ page }) => {
      /** @type {string[]} */
      const problems = []

      // A 404 status on the document is the point of three of these URLs, and
      // Chromium reports it as a console error. Asset failures are the thing
      // worth failing on, so those are checked from the response side instead.
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (message.text().startsWith('Failed to load resource')) return

        problems.push(`console: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
      page.on('response', (response) => {
        if (!response.url().includes('/_next/')) return
        if (response.status() < 400) return

        problems.push(`asset ${response.status()}: ${response.url()}`)
      })

      await page.goto(path)

      await expect(page.getByTestId('not-found-view')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Search events' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible()

      expect(problems).toEqual([])
    })
  }

  test('the site still works either side of a missing resource', async ({ page }) => {
    await page.goto('/events')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.goto(VALID_EVENT)
    await expect(page.getByTestId('not-found-view')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a missing resource is legible and does not scroll sideways', async ({ page }) => {
    await page.goto('/events/no-such-event-at-all')

    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('a missing resource is fully visible, never mid-animation', async ({ page }) => {
    await page.goto('/events/no-such-event-at-all')

    const view = page.getByTestId('not-found-view')
    await expect(view).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible()

    // Nothing in this view animates, so nothing in it can be left transparent
    // or displaced by an entrance that never runs.
    const faded = await view.evaluate(
      (root) =>
        [root, ...root.querySelectorAll('*')].filter((element) => {
          const style = getComputedStyle(element)

          return Number(style.opacity) < 1 || style.visibility === 'hidden'
        }).length,
    )
    expect(faded).toBe(0)

    await expect(view.locator('[data-motion]')).toHaveCount(0)
  })
})
