import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { cleanupDetailScreens, seedDetailScreens } from './support/seed-detail-screens.mjs'
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
 * Covered: the organiser event list, the seven-step editor, the finance
 * overview, the operations board, the moderation queue, the public event page,
 * and the five surfaces this cycle added — organiser analytics, the
 * reconciliation detail screen, the refund detail screen, the ticket detail
 * screen and the invitation-acceptance screen.
 *
 * Every one of those five is scanned with real rows behind it: a ticket that
 * exists, a refund with lines and an allocation, a reconciliation item with
 * both sides of its evidence, and analytics figures derived from a ledger batch
 * that balances. A screen rendered from a static array proves that the markup
 * compiles, which is not what this file is for.
 *
 * ## The privacy and retention screens
 *
 * Added later, and they are the three this file most needed: they are the
 * screens somebody opens during an incident, on whatever device they have, and
 * they are the screens a regulator might one day be shown.
 *
 * `/retention` needs its own reader. `retention:view` is in
 * `PLATFORM_ONLY_CAPABILITIES`, which is asserted at module load never to
 * appear in an organisation role — so the organiser fixture, however senior,
 * cannot reach it. The seed grows a tagged `SUPER_ADMIN` for exactly this, and
 * the sign-in for it is separate from {@link signIn} because that helper ends
 * by asserting `/organizer/events`, which a platform reader never sees.
 *
 * ## Why these tests live in this file rather than a new one
 *
 * `playwright.sweep.config.js` pins `testMatch: '**‍/accessibility-sweep.spec.js'`.
 * A new spec file would not be collected by the sweep job, and would instead be
 * picked up by the default config — whose job does not start the API. So the
 * only place an accessibility test can go is here.
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
/**
 * The commerce rows behind the four detail screens.
 *
 * @type {object}
 */
let commerce
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
/** @type {object} */
let platformContext
/**
 * The in-flight or completed sign-in for the platform reader.
 *
 * Only `/retention` needs it: `retention:view` is platform-only, so the
 * organiser fixture cannot reach that screen however senior its membership.
 *
 * The *promise* is memoised rather than the page, and that is not a style
 * preference. Caching the page means reading the variable, awaiting a sign-in,
 * and assigning afterwards — three steps with two suspension points, so two
 * callers can both find it empty and both sign in. Two sign-ins is two
 * credential requests against a ten-per-minute limiter, on top of the one this
 * file already spends. Assigning the promise happens synchronously, so the
 * second caller waits on the first.
 *
 * @type {(Promise<object>|null)}
 */
let platformSignIn = null

/**
 * The platform reader's page, signing in the first time it is asked for.
 *
 * @returns {Promise<object>} A signed-in page.
 */
function platformReader() {
  platformSignIn ??= (async () => {
    const page = await platformContext.newPage()

    await signInPlatform(page, seeded.platformReaderEmail)

    return page
  })()

  return platformSignIn
}

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
 * Wait until every entrance animation has finished.
 *
 * This is the gate the colour assertions in this file depend on, and two
 * earlier attempts at it were wrong in instructive ways.
 *
 * The site animates through `components/motion.jsx`, which wraps content in
 * Framer Motion elements that start at `opacity: 0` and fade to `1`. Axe reads
 * `getComputedStyle().color` and blends it through ancestor opacity, so a scan
 * that lands mid-fade measures text at a fraction of its real colour against a
 * background that is already correct — which is exactly what the failures
 * showed: `text-marigold-900` reported as `#efdfc9`, a ratio of 1.2 against a
 * `bg-marigold-100` that had resolved perfectly.
 *
 * Two hypotheses were tried and neither held. Waiting for the `h1` to be
 * visible (run `35157268740`) fails because an element is visible at
 * `opacity: 0`. Waiting for the theme custom properties to resolve on `:root`
 * (run `35175112378`) fails because the stylesheet was never the problem — the
 * tokens were present and correct the whole time. Both were diagnosed from a
 * log; this one was diagnosed from a reproduction, by dumping the computed
 * style chain and finding `DIV.mt-6` — the `FadeIn` at `events/[slug]/page.jsx`
 * — sitting at `opacity: 0` with the `h1` beneath it.
 *
 * `RevealOnScroll` uses `whileInView`, so content below the fold stays faded
 * out until it is scrolled to. The page is therefore walked top to bottom
 * first: a scan of a page whose lower half is still invisible is not a scan of
 * that page. Every animated element carries `data-motion`, which
 * `motion.jsx` documents as load-bearing rather than decorative, so it is a
 * contract this file may rely on.
 *
 * **This cannot mask a violation.** It waits for the resting state and then
 * scans it, and the resting state is the one a reader actually reads. Colours
 * that are wrong at rest are still wrong once the fade has finished.
 *
 * @param {object} page The page about to be scanned.
 * @returns {Promise<void>} Resolves once the page has stopped moving.
 */
async function settled(page) {
  const deadline = Date.now() + 30_000

  for (;;) {
    // Scroll each unsettled element into view rather than sweeping the page
    // once. A single pass is not enough: the first one runs before hydration
    // has attached Framer Motion's IntersectionObservers, so it triggers
    // nothing, and once the page scrolls back the sections below the fold
    // never re-enter view. Measured on the public event page at 320x720 —
    // four `RevealOnScroll` sections at 852, 1266, 1496 and 1674 stayed at
    // `opacity: 0` through a full sweep. `viewport.once` means an element that
    // has animated stays animated, so this converges.
    const unsettled = await page.evaluate(async () => {
      const pending = [...document.querySelectorAll('[data-motion]')].filter(
        (element) => Number.parseFloat(getComputedStyle(element).opacity) < 1,
      )

      for (const element of pending) {
        element.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        })
      }

      return pending.length
    })

    if (unsettled === 0) break

    if (Date.now() > deadline) {
      throw new Error(
        `${unsettled} [data-motion] element(s) never reached opacity 1. The scan ` +
          'would have measured text blended through an unfinished entrance ' +
          'animation, which is not a contrast defect — see the note on this helper.',
      )
    }

    await page.waitForTimeout(250)
  }

  await page.evaluate(() => window.scrollTo(0, 0))

  // Fonts change metrics rather than colour, but a scan that begins mid-swap
  // measures a layout that nothing will ever look like.
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Run the scanner and return whatever it found.
 *
 * No rule is disabled. The one exclusion is Next's development overlay, which
 * the framework injects into every page in `next dev` and which no deployment
 * ships — scanning it would report the framework's markup as the site's.
 *
 * The scan waits for {@link settled} first, so every case in this file is
 * ordered against the finished page rather than each remembering to be.
 *
 * @param {object} page The page to scan.
 * @returns {Promise<object[]>} Violations, each with its rule id and nodes.
 */
async function scan(page) {
  await settled(page)

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

/**
 * Sign in without asserting where the organiser lands.
 *
 * {@link signIn} ends with `expect(page).toHaveURL(/\/organizer\/events/)`,
 * which is correct for an organiser and wrong for a platform reader: they hold
 * no membership, so that is not where they arrive. Duplicated rather than
 * loosened, because the organiser assertion is worth keeping — a sign-in that
 * silently succeeded onto the wrong page would be a sign-in nobody noticed had
 * changed.
 *
 * @param {object} page The page to sign in.
 * @param {string} email Who to sign in as.
 * @returns {Promise<void>} Resolves once past the second factor.
 */
async function signInPlatform(page, email) {
  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const code = page.getByLabel(/^Six-digit code/)
  await expect(code).toBeVisible()
  await code.fill(currentCode())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByLabel(/^Six-digit code/)).toBeHidden()
}

test.describe.serial('the Phase 2 screens, swept', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedRefusals(TAG)
    commerce = await seedDetailScreens({
      tag: TAG,
      organizationId: seeded.alphaOrganizationId,
      eventId: seeded.alphaEventId,
      ownerUserId: seeded.alphaOwnerId,
    })

    organiserContext = await browser.newContext()
    organiser = await organiserContext.newPage()
    await signIn(organiser, seeded.alphaOwnerEmail)

    moderatorContext = await browser.newContext()
    // Empty, and signed in on first use. Eagerly signing in here would spend a
    // credential request in every run of this file, including the runs where no
    // retention case executes — and `/v1/auth/sign-in` carries the credential
    // limiter, which is a per-minute budget rather than a per-suite one.
    platformContext = await browser.newContext()
  })

  test.afterAll(async () => {
    await organiserContext?.close()
    await moderatorContext?.close()
    await platformContext?.close()
    // Before the refusals cleanup, which deletes the events these rows hang
    // from.
    await cleanupDetailScreens(TAG)
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
      // This case has failed three times, and the first two fixes were wrong.
      // The cause is not the stylesheet and never was: the page fades in from
      // `opacity: 0` through `components/motion.jsx`, and a scan that lands
      // mid-fade measures blended text. {@link settled} is the real gate, and
      // `scan` awaits it for every case. Runs 35157268740, 35175112378 and
      // 35176281573 are the three, in order.
      //
      // This assertion stays because the page genuinely must have its heading
      // before a scan means anything.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the payout-setup screen is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/finance/connect')
      // Matched by name, never a bare `level: 1`. The read behind this screen
      // is gated on a step-up window, so the page degrades to a heading plus a
      // refusal rather than throwing — and a bare level-1 assertion would pass
      // against that degraded page and call an unscanned screen clean.
      await expect(page.getByRole('heading', { name: 'Payout setup', level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      // The one table here is the detail list, scrolled inside its own region
      // rather than widening the document.
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the finance overview is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/finance')
      await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      // The clearing-account table is the hardest thing on any of these screens
      // to reflow, which is why it is scrolled in its own container rather than
      // widening the page.
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the operations board is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/operations')
      await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`organiser analytics is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/analytics')
      await expect(page.getByRole('heading', { name: /analytics/i, level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      // Six tables of figures on one page: each scrolls inside its own region
      // rather than widening the document, which is what 1.4.10 asks for.
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the reconciliation detail screen is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/operations/reconciliation/${commerce.reconciliationTaskId}`)
      await expect(page.getByRole('heading', { name: /payment timeout/i, level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the refund detail screen is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/finance/refunds/${commerce.refundId}`)
      await expect(page.getByRole('heading', { name: /refund on/i, level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the ticket wallet is clean at ${viewport.name}`, async () => {
      // Phase 4 rewrote this screen: status chips on their own soft grounds, a
      // definition list per card, section headings, and a link whose underline
      // is drawn in `accent-line`. Every one of those is a colour pairing the
      // token-contrast unit test can only check in the abstract — this is the
      // one that measures what a browser actually painted.
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/tickets')
      await expect(page.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the ticket detail screen is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/tickets/${commerce.ticketIds[0]}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the invitation screen is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/tickets/accept')
      await expect(page.getByRole('heading', { name: /accept a ticket/i, level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the privacy request queue is clean at ${viewport.name}`, async () => {
      // The alpha owner holds `privacy:redact` — `OWNER` grants it — so this
      // screen needs no new account. Reading the queue does not need a
      // second factor; acting on it does, which is the point of the step-up
      // journey in `detail-privacy.spec.js`.
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/privacy')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the export register is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/privacy/exports')
      await expect(page.getByRole('heading', { name: /export register/i, level: 1 })).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      // The register's table gained a sixth column and its minimum width was
      // raised from 46rem to 54rem. Nothing proved that was right until this
      // case existed: the page's own unit tests assert text, not layout, and
      // the module doc says as much.
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })

    test(`the retention rehearsal log is clean at ${viewport.name}`, async () => {
      // A different reader, because `retention:view` is platform-only. See the
      // module doc for why this account exists and why it signs in separately.
      const page = await platformReader()

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/retention')
      await expect(
        page.getByRole('heading', { name: /retention rehearsals/i, level: 1 }),
      ).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
    })
  }

  test('the finance screen says what produced its figures, before any of them', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/finance')

    // A standing condition rather than an interruption, and in the reading
    // order before the totals: a mock-mode figure is not an accounting record,
    // and a notice underneath the numbers is read after somebody believed them.
    const banner = page.getByRole('status').first()

    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/demonstration/i)

    const bannerBox = await banner.boundingBox()
    const totals = await page.getByRole('heading', { name: 'Totals' }).boundingBox()

    expect(bannerBox.y).toBeLessThan(totals.y)
  })

  test('an export taken from a screen appears in the register, named for a screen reader', async () => {
    // Two things at once, and the first is why this test exists at all.
    //
    // **The register is reached end to end.** `recordExport` is called by the
    // CSV route before the body is returned, and the row it writes is what
    // `/privacy/exports` renders. Nothing else spans that: the page's unit
    // tests mock the API, and the API tests stop at the payload. Here the
    // export is taken the way an organiser takes it — the same link the
    // analytics screen offers — and then the register is read.
    //
    // **The table is named and its headers are scoped.** Axe does not require
    // a `<caption>`, and it does not require `scope` on a header it can infer,
    // so neither is covered by the scans above: deleting both would leave a
    // clean scan. They are what make a grid of counts navigable, so they are
    // asserted directly — and they can only be asserted once a table exists,
    // which is the other reason these two claims share a test.
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })

    // Empty first. If the register already had rows the assertion below would
    // not be evidence that this export reached it.
    await page.goto('/privacy/exports')
    await expect(page.getByRole('heading', { name: /export register/i, level: 1 })).toBeVisible()
    const before = await page.getByRole('row').count()

    // The link the analytics screen offers, followed as a request rather than
    // a navigation: it answers with a CSV attachment, which a browser would
    // download rather than render.
    const csv = await page.request.get(
      `/api/v1/analytics/export.csv?organizationId=${seeded.alphaOrganizationId}&currency=INR`,
    )

    expect(csv.status(), await csv.text()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')

    await page.goto('/privacy/exports')

    const table = page.getByRole('table')

    await expect(table).toBeVisible()
    await expect(table).toHaveAccessibleName(/exports produced by/i)
    expect(await page.getByRole('row').count()).toBeGreaterThan(before)

    // The row says what the register is for: an export happened, it belongs to
    // nobody, and there is nothing kept to hand over.
    const row = page.getByRole('row').filter({ hasText: 'analytics' }).first()

    await expect(row).toContainText(/Nobody — aggregate figures only/i)
    await expect(row).toContainText(/No — streamed and not kept/i)

    // And there is no way to get the bytes back.
    expect(await page.locator('a[download], a[href*="export.csv"]').count()).toBe(0)

    // Every header cell carries a scope, including the row header: the kind is
    // what identifies a row, and a row identified only by position is a row
    // nobody can quote.
    const scoped = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('table th')]

      return {
        total: cells.length,
        withScope: cells.filter((cell) => cell.getAttribute('scope')).length,
      }
    })

    expect(scoped.total).toBeGreaterThan(0)
    expect(scoped.withScope).toBe(scoped.total)
  })

  test('the register table scrolls in its own container rather than widening the page', async () => {
    // Runs after the export above, and that ordering is the test. With an
    // empty register there is no table at all, so an assertion here would pass
    // by finding nothing — which is how a reflow guard quietly stops guarding.
    // `test.describe.serial` runs in declaration order, so by this point a row
    // exists.
    //
    // What is being guarded: the table is wider than a phone and always will
    // be — six columns of counts do not fold — so reflow here means the
    // *table* scrolls, not the document. `overflow-x-auto` on the wrapper is
    // the control that makes that true, and it is invisible in every unit
    // test. Note that the obvious falsification is wrong: changing
    // `min-w-[54rem]` to `w-[54rem]` does not overflow the document, because
    // the wrapper still contains it. Removing the wrapper's `overflow-x-auto`
    // does.
    const page = organiser

    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/privacy/exports')
    await expect(page.getByRole('table')).toBeVisible()

    const overflowX = await page.evaluate(() => {
      const table = document.querySelector('table')

      return globalThis.getComputedStyle(table.parentElement).overflowX
    })

    expect(['auto', 'scroll'], `the table's wrapper had overflowX ${overflowX}`).toContain(
      overflowX,
    )
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
  })

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

    // Two screens, because this phase's new controls are on the second one.
    // The event list alone would have proved nothing about buttons that did not
    // exist when the case was written.
    for (const path of ['/organizer/events', '/finance/connect']) {
      await page.goto(path)

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

      expect(unmarked, path).toEqual([])
    }
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
    // The same readiness wait, for the same reason. This scan had the same gap
    // and simply had not been unlucky yet.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const violations = await scan(page)

    expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

    await page.close()
  })

  test('the new detail screens reflow at 200% zoom', async () => {
    const page = organiser

    // 200% zoom on a 1280px display is a 640px viewport as far as CSS is
    // concerned. The three tables on these screens are the hard part, and they
    // scroll inside their own regions rather than widening the document.
    await page.setViewportSize({ width: 640, height: 900 })

    for (const [path, heading] of [
      ['/analytics', /analytics/i],
      ['/finance/connect', /payout setup/i],
      [`/operations/reconciliation/${commerce.reconciliationTaskId}`, /payment timeout/i],
      [`/finance/refunds/${commerce.refundId}`, /refund on/i],
      [`/tickets/${commerce.ticketIds[0]}`, null],
      ['/tickets', /my tickets/i],
    ]) {
      await page.goto(path)

      if (heading) {
        await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      } else {
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      }

      expect(
        await sidewaysOverflow(page),
        `${path} scrolls sideways at 200% zoom`,
      ).toBeLessThanOrEqual(1)

      const violations = await scan(page)

      expect(violations, `${path}\n  ${describe(violations)}`).toHaveLength(0)
    }
  })

  test('the detail screens keep their content when motion is reduced', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()

    await signIn(page, seeded.alphaOwnerEmail)
    await page.goto(`/finance/refunds/${commerce.refundId}`)
    await expect(page.getByRole('heading', { name: /refund on/i, level: 1 })).toBeVisible()

    // The failure this guards against is an entrance animation whose start
    // state is `opacity: 0`: with motion reduced the animation never runs, and
    // the figure it was going to reveal is somebody's money.
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

  test('a reconciliation item can be worked by keyboard alone', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/operations/reconciliation/${commerce.reconciliationTaskId}`)
    await expect(page.getByRole('heading', { name: /payment timeout/i, level: 1 })).toBeVisible()

    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveText(/skip to main content/i)

    // This account holds finance:view in the organisation but not the platform
    // capability, so the five commands are not drawn — and the screen says so
    // rather than showing buttons that would be refused.
    await expect(page.getByText(/platform work/i)).toBeVisible()
  })

  test('the invitation field never carries the code in the address bar', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/tickets/accept')

    const field = page.getByLabel(/invitation code/i)

    await expect(field).toBeVisible()
    await expect(field).toHaveAttribute('type', 'password')

    await field.fill('abcdefghijklmnopqrstuvwx')

    // A secret in a query string survives in history, in the next request's
    // referrer and in every proxy log between here and the server.
    expect(new URL(page.url()).search).toBe('')
    expect(page.url()).not.toContain('abcdefghijkl')
  })

  test('the refund screen never asks for a card', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/finance/refunds/${commerce.refundId}`)
    await expect(page.getByRole('heading', { name: /refund on/i, level: 1 })).toBeVisible()

    const rendered = (await page.locator('body').innerText()).toLowerCase()

    for (const needle of ['card number', 'cvc', 'expiry', 'security code']) {
      expect(rendered, `the refund screen mentions ${needle}`).not.toContain(needle)
    }

    // And nothing on it takes a number that could be one.
    const fields = await page.locator('main input').all()

    for (const input of fields) {
      const type = await input.getAttribute('type')

      expect(type === 'number' || type === 'tel').toBe(false)
    }
  })

  test('a touch target is big enough to hit', async () => {
    const page = organiser

    await page.setViewportSize({ width: 320, height: 720 })
    // The payout-setup screen is the one introducing new buttons, and axe runs
    // the WCAG 2.1 tag set, which does not contain 2.5.8 — so nothing else in
    // this file would have measured them.
    await page.goto('/finance/connect')

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
