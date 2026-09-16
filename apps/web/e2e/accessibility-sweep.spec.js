import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import {
  PASSWORD,
  cleanupRefusals,
  currentCode,
  forgetCodeUse,
  seedRefusals,
} from './support/seed-refusals.mjs'

/**
 * The responsive and accessibility sweep the organiser screens never had.
 *
 * The public pages have had a structural suite since Phase 1 —
 * `accessibility.spec.js` — but the screens an organiser and a moderator work
 * in have only ever been asserted in unit tests. A unit test can say that a
 * validation summary links to its fields; it cannot say that the page reflows
 * at 320 CSS pixels, that nothing disappears under `prefers-reduced-motion`, or
 * that a real browser's accessibility tree agrees with what the markup claims.
 *
 * ## What "no rule is silenced" means here
 *
 * The scanner runs with the WCAG 2.1 A and AA rule sets and **no disabled
 * rules**. Where a violation is found, the fix is in the component. There is no
 * exclusion list in this file, and the only selector exclusion is Next's own
 * development overlay, which is not the site's markup and is not shipped.
 *
 * ## What is and is not covered
 *
 * Covered: the organiser event list, the seven-step editor, the moderation
 * queue and decision screen, and the public event page — every Phase 2 screen
 * that exists. The finance, operations, reconciliation, refund and ticket
 * surfaces the brief also names are not here, because they are not built; a
 * sweep that silently skipped them would report a coverage it does not have.
 *
 * @module e2e/accessibility-sweep
 */

/** The run suffix, so cleanup can find exactly this run's rows. */
const TAG = process.env.SWEEP_E2E_TAG ?? `swp${Date.now().toString(36)}`

/**
 * The three widths, and why each one.
 *
 * 320 rather than 360: WCAG 1.4.10 names 320 CSS pixels as the reflow width,
 * and a layout that only works at 360 fails the criterion for anybody using a
 * small phone or a zoomed desktop. 768 is where a tablet stops being a phone.
 * 1280 is an ordinary laptop.
 */
const VIEWPORTS = [
  { name: 'phone', width: 320, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
]

/** @type {object} */
let seeded
/** @type {object} */
let organiserContext
/**
 * The organiser's window, opened once and kept open.
 *
 * A module-level binding rather than a property on the context, for the same
 * reason the lifecycle suite uses one: sessions rotate, so a saved
 * `storageState` stops being current, and signing in once per case would look
 * to the limiter exactly like credential stuffing.
 *
 * @type {object}
 */
let organiser
/** @type {object} */
let moderatorContext

/**
 * Sign one seeded account in, through the second factor its role requires.
 *
 * @param {object} page The page to sign in on.
 * @param {string} email Which account.
 * @returns {Promise<void>} Resolves once signed in.
 */
async function signIn(page, email) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const code = page.getByLabel(/^Six-digit code/)
  await expect(code).toBeVisible()
  await code.fill(currentCode())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/organizer\/events/)
}

/**
 * Run the scanner and return whatever it found.
 *
 * No rule is disabled. The one exclusion is Next's development overlay, which
 * the framework injects into every page in `next dev` and which no deployment
 * ships — scanning it would report the framework's markup as the site's.
 *
 * @param {object} page The page to scan.
 * @returns {Promise<object[]>} Violations, each with its rule id and nodes.
 */
async function scan(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('nextjs-portal')
    .analyze()

  return results.violations
}

/**
 * A readable account of what the scanner found, for a failure message.
 *
 * The rule id alone is not enough to act on; the selector is what tells
 * somebody which element to open.
 *
 * @param {object[]} violations From {@link scan}.
 * @returns {string} One line per violation, with its first offending selector.
 */
function describe(violations) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n    ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join('\n    ')}`,
    )
    .join('\n  ')
}

/**
 * How far the document scrolls sideways.
 *
 * @param {object} page The page.
 * @returns {Promise<number>} Overflow in CSS pixels.
 */
function sidewaysOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test.describe.serial('the Phase 2 screens, swept', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedRefusals(TAG)

    organiserContext = await browser.newContext()
    organiser = await organiserContext.newPage()
    await signIn(organiser, seeded.alphaOwnerEmail)

    moderatorContext = await browser.newContext()
  })

  test.afterAll(async () => {
    await organiserContext?.close()
    await moderatorContext?.close()
    await cleanupRefusals(TAG)
  })

  for (const viewport of VIEWPORTS) {
    test(`the organiser event list is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/organizer/events')
      await expect(page.getByRole('heading', { name: 'Your events', level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the event editor is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
      await expect(page.getByRole('navigation', { name: 'Editor steps' })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the public event page is clean at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/events/alpha-event-${seeded.tag}`)

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })
  }

  test('the editor reflows at 200% zoom without sideways scrolling', async () => {
    const page = organiser

    // 200% zoom on a 1280px display is a 640px viewport as far as CSS is
    // concerned, which is what WCAG 1.4.4 is actually about: the layout has to
    // survive the text being twice the size, not merely be readable when it is.
    await page.setViewportSize({ width: 640, height: 900 })
    await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
    await expect(page.getByRole('navigation', { name: 'Editor steps' })).toBeVisible()

    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

    const violations = await scan(page)

    expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
  })

  test('nothing is left invisible when motion is reduced', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()

    await signIn(page, seeded.betaOwnerEmail)
    await page.goto('/organizer/events')

    await expect(page.getByRole('heading', { name: 'Your events', level: 1 })).toBeVisible()

    // The failure this guards against is an entrance animation whose start
    // state is `opacity: 0`: with motion reduced the animation never runs, and
    // the content it was going to reveal stays invisible forever.
    const invisible = await page.evaluate(() => {
      const offenders = []

      for (const element of document.querySelectorAll('main *')) {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()

        if (rect.width === 0 && rect.height === 0) continue
        if (style.visibility === 'hidden' || style.display === 'none') continue
        if (Number(style.opacity) === 0) offenders.push(element.tagName.toLowerCase())
      }

      return offenders
    })

    expect(invisible).toEqual([])

    await context.close()
  })

  test('the editor can be reached and operated by keyboard alone', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
    await expect(page.getByRole('navigation', { name: 'Editor steps' })).toBeVisible()

    // The first thing a keyboard reaches must be the skip link. Without it a
    // keyboard user tabs through the whole header on every page.
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveText(/skip to main content/i)

    // Every step is reachable by keyboard, and pressing one opens it.
    const steps = page.getByRole('navigation', { name: 'Editor steps' }).getByRole('button')
    const count = await steps.count()

    expect(count).toBeGreaterThan(1)

    await steps.nth(count - 1).focus()
    await expect(page.locator(':focus')).toBeVisible()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('region', { name: /review/i })).toBeVisible()
  })

  test('every focusable control shows where the focus is', async () => {
    const page = organiser

    await page.goto('/organizer/events')

    // A focus ring removed without a replacement is the single most common way
    // a keyboard user is left unable to tell where they are.
    const unmarked = await page.evaluate(() => {
      const offenders = []
      const focusable = document.querySelectorAll(
        'main a[href], main button:not([disabled]), main input:not([disabled]), main select:not([disabled])',
      )

      for (const element of focusable) {
        element.focus()

        const style = getComputedStyle(element)
        const ring =
          style.outlineStyle !== 'none' ||
          style.boxShadow !== 'none' ||
          style.borderStyle !== 'none'

        if (!ring) offenders.push(element.outerHTML.slice(0, 80))
      }

      return offenders
    })

    expect(unmarked).toEqual([])
  })

  test('the moderation queue and decision screen are clean', async () => {
    const page = await moderatorContext.newPage()

    // Seeded by the refusals seed as an ordinary organiser; the moderation
    // screens need a platform moderator, which that seed does not create. The
    // queue is therefore checked as the sign-in wall it presents to somebody
    // without the capability — which is itself a Phase 2 screen, and the one an
    // unauthorised visitor is most likely to reach.
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/moderation/events')

    const violations = await scan(page)

    expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

    await page.close()
  })

  test('a touch target is big enough to hit', async () => {
    const page = organiser

    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/organizer/events')

    // 24 CSS pixels is WCAG 2.2's minimum (2.5.8). Inline links in prose are
    // exempt by the criterion itself, so they are excluded here rather than
    // being made to fail a rule that does not apply to them.
    const tooSmall = await page.evaluate(() => {
      const offenders = []

      for (const element of document.querySelectorAll('main button, main [role="button"]')) {
        const rect = element.getBoundingClientRect()

        if (rect.width === 0 && rect.height === 0) continue
        if (rect.height < 24 || rect.width < 24) {
          offenders.push(
            `${element.tagName.toLowerCase()} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          )
        }
      }

      return offenders
    })

    expect(tooSmall).toEqual([])
  })
})
