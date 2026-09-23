import AxeBuilder from '@axe-core/playwright'
import { createPrismaClient } from '@desi-event/db'
import { expect, test } from '@playwright/test'

import { cleanupDetailScreens, seedDetailScreens } from './support/seed-detail-screens.mjs'
import { DOOR_TICKETS, LONG_NAME, cleanupDoor, seedDoor } from './support/seed-door.mjs'
import {
  CONNECTION,
  PASSWORD,
  TOTP_SECRET,
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
 * ## The Phase 4 surfaces
 *
 * Phase 4 added a public discovery layer (the three directories, the
 * limitations page, sign-in, registration and checkout), the attendee's own
 * pages under `/account`, and three workspace lists (the team, the refund list
 * and the reconciliation list) plus the platform's notification queue. The
 * last block of this file sweeps every one of them at the seven widths the
 * door is held to and at 200% zoom, scans four of those sizes, and holds each
 * page to one level-one heading and a titled document.
 *
 * Each page is swept with real rows on it, and each case says which before it
 * measures anything: a Live Music count read from the API, the alpha
 * organisation among the organisers, the seeded order in the history and on
 * its own page, the door scanner's scope on the team screen, the seeded refund
 * and reconciliation item in their lists. A page that degraded to a refusal
 * would fail that first, rather than being scanned and called clean.
 *
 * Two rows are written for the block and deleted after it, in the way the
 * world's own seeds write theirs: a shared venue with a long name and eight
 * accessibility claims, because the anonymous venue directory is otherwise
 * empty in a fresh database and a directory with no card in it reflows
 * trivially; and one dead-lettered outbox message, because nothing in this
 * world enqueues mail and the queue's sixty-rem table would otherwise never be
 * drawn at 320.
 *
 * The public pages are opened in a window nobody has signed in to — sign-in
 * and registration redirect a signed-in visitor, so they cannot be swept any
 * other way — and no case in the block signs anybody in. The attendee and
 * workspace pages reuse the organiser's window (the alpha owner holds the
 * seeded order), and the notification queue reuses the platform reader's.
 *
 * Two cases close the block. At 320 the header's four ways into the catalogue
 * are behind a menu button, so a keyboard has to reach the button, open it and
 * walk the links, and Escape has to bring focus back. And with motion reduced,
 * nothing inside the home page's animated content may run for longer than
 * the stylesheet's 0.01 ms, or be left short of its resting state.
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
/**
 * The door's people and tickets.
 *
 * @type {object}
 */
let door
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

  // Signing in with no `next` lands on the account page (Phase 4; it used to
  // be the organiser's event list whoever signed in).
  await expect(page).toHaveURL(/\/account$/)
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
 * {@link signIn} ends by asserting where the account lands. That was the
 * organiser's event list until Phase 4, which was wrong for a platform reader:
 * they hold no membership, so that was not where they arrived. Duplicated rather than
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

/**
 * Sign in an account that holds no second factor.
 *
 * A ticket holder and a SCANNER are not privileged roles, so nothing compels
 * enrolment and the form never asks. {@link signIn} waits for the challenge,
 * which would never come.
 *
 * @param {object} page The page to sign in.
 * @param {string} email Who to sign in as.
 * @returns {Promise<void>} Resolves once signed in.
 */
async function signInWithoutFactor(page, email) {
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 15_000 })
}

/**
 * Every width the door screen is checked at.
 *
 * The sweep's three, plus the four the Phase 3 brief names: 375 and 390 are
 * the phones a steward is most likely to be holding, 1024 a tablet held
 * landscape at a desk, 1440 a laptop at a box office.
 *
 * @type {ReadonlyArray<{width: number, height: number}>}
 */
const DOOR_WIDTHS = Object.freeze(
  [320, 375, 390, 768, 1024, 1280, 1440].map((width) => ({ width, height: 900 })),
)

/**
 * The 200% zoom case, as the layout sees it.
 *
 * Playwright sets a viewport in CSS pixels, and a 1280 × 900 window at 200%
 * zoom lays out at 640 × 450 CSS pixels, so this is that window. The earlier
 * zoom cases in this file keep the height at 900, which is a taller window
 * than any 200% zoom produces; the Phase 4 block halves both, so each page is
 * reflowed and scanned in the window somebody zoomed in actually has.
 *
 * @type {Readonly<{width: number, height: number}>}
 */
const ZOOM_200 = Object.freeze({ width: 640, height: 450 })

/**
 * The widths the scanner runs at in the Phase 4 block.
 *
 * Every size is measured for reflow; four are scanned — the narrowest, the
 * tablet, the laptop and the zoomed window — because a scan costs seconds and
 * the other three widths differ from their neighbours in layout, not in
 * markup.
 *
 * @type {ReadonlySet<number>}
 */
const SCANNED_WIDTHS = new Set([320, 768, 1280, ZOOM_200.width])

/**
 * Every size a Phase 4 surface is measured at: the door's seven, then zoom.
 *
 * @type {ReadonlyArray<{width: number, height: number, label: string}>}
 */
const PHASE_4_SIZES = Object.freeze([
  ...DOOR_WIDTHS.map((size) => ({ ...size, label: `${size.width} px` })),
  { ...ZOOM_200, label: '200% zoom (640 × 450)' },
])

/** The seeded published event's title, as `seed-refusals.mjs` writes it. */
const EVENT_TITLE = `Alpha's Evening ${TAG}`

/** The seeded published event's slug. */
const EVENT_SLUG = `alpha-event-${TAG}`

/** The sample catalogue's notice: its absence is the sign the API answered. */
const SAMPLE_NOTICE = 'Showing our sample programme'

/**
 * The shared venue the Phase 4 block writes, and the claims it asserts.
 *
 * Shared — no organisation — because `GET /v1/venues` keeps an organisation's
 * own venues out of an anonymous caller's list, so the world's venues never
 * reach the directory. In a city named for this run, so the directory can be
 * narrowed to exactly this card. The name is long and the claims are many
 * because a card that wraps is the case worth measuring at 320. Each claim is
 * paired with the words `lib/accessibility.js` shows for it, written out
 * rather than imported: a test that read the table it checks would agree
 * with any table.
 *
 * @type {Readonly<{name: string, slug: string, city: string, claims: ReadonlyArray<Array<string>>}>}
 */
const SWEEP_VENUE = Object.freeze({
  name: `Shri Shanmukhananda Fine Arts and Sangeetha Sabha Auditorium ${TAG}`,
  slug: `sweep-auditorium-${TAG}`,
  city: `Sweep Test Town ${TAG}`,
  claims: Object.freeze([
    ['STEP_FREE_ENTRANCE', 'Step-free entrance'],
    ['STEP_FREE_TO_SEATING', 'Step-free route to the seating'],
    ['ACCESSIBLE_TOILET', 'Accessible toilet'],
    ['WHEELCHAIR_SPACES', 'Wheelchair spaces'],
    ['HEARING_LOOP', 'Hearing loop'],
    ['SIGN_LANGUAGE', 'Sign language interpretation'],
    ['ASSISTANCE_DOGS_WELCOME', 'Assistance dogs welcome'],
    ['LIFT_ACCESS', 'Lift access'],
  ]),
})

/**
 * The outbox message the Phase 4 block writes.
 *
 * The recipient is fictional, on a `.test` domain, and the marker is what the
 * payload carries. The queue says neither recipients nor contents are shown,
 * so neither may appear anywhere in what the page sends.
 *
 * @type {Readonly<{template: string, dedupeKey: string, recipient: string, marker: string}>}
 */
const OUTBOX_PROBE = Object.freeze({
  template: `sweep-probe-${TAG}`,
  dedupeKey: `sweep-probe:${TAG}`,
  recipient: `outbox-sweep-${TAG}@attendee.test`,
  marker: `sweep-payload-${TAG}`,
})

/**
 * The header's four ways into the catalogue, in order.
 *
 * `PUBLIC_ITEMS` in `lib/navigation.js`, written out for the same reason as
 * the venue's claims.
 *
 * @type {ReadonlyArray<{label: string, path: string}>}
 */
const HEADER_ENTRIES = Object.freeze([
  { label: 'Discover events', path: '/events' },
  { label: 'Categories', path: '/categories' },
  { label: 'Venues', path: '/venues' },
  { label: 'Organisers', path: '/organizers' },
])

/**
 * What no page may carry, in its markup or its address.
 *
 * The page's markup includes the streamed server-component payload, so a field
 * handed to a client component is caught here even when nothing draws it. The
 * printed ticket codes are on the list because a code is what the door looks a
 * ticket up by; the order page's own module doc says it never renders one.
 *
 * @type {ReadonlyArray<Array<string>>}
 */
const SECRETS = Object.freeze([
  ['credentialHash', 'a credential digest field'],
  ['ticket-pass-v1', 'the pass derivation label'],
  [TOTP_SECRET, 'the seeded TOTP secret'],
  [TOTP_SECRET.match(/.{1,4}/gu).join(' '), 'the seeded TOTP secret, grouped for typing'],
  [PASSWORD, 'the seeded password'],
  [`DE-SWP-${TAG}-`, 'a seeded ticket’s printed code'],
  [`DE-DOOR-${TAG.toUpperCase()}-`, 'a door ticket’s printed code'],
])

/**
 * A visitor's window: a context nobody has signed in to, opened by the Phase 4
 * block for the public pages.
 *
 * @type {object}
 */
let visitorContext
/**
 * The one page in {@link visitorContext}.
 *
 * @type {object}
 */
let visitor

/**
 * Assert that neither the page nor its address carries a secret.
 *
 * @param {object} page The page.
 * @param {string} where What the page is, for the message.
 * @returns {Promise<void>} Resolves when checked.
 */
async function expectNoSecrets(page, where) {
  const markup = await page.content()
  const address = decodeURIComponent(page.url())

  for (const [needle, what] of SECRETS) {
    expect(markup, `${where} carries ${what}`).not.toContain(needle)
    expect(address, `the address bar on ${where} carries ${what}`).not.toContain(needle)
  }
}

/**
 * The text of every level-one heading in the document.
 *
 * Read from the document itself rather than through a locator, because
 * Playwright's CSS engine reaches into open shadow roots, and Next's
 * development overlay is one — its markup is not the page's.
 *
 * @param {object} page The page.
 * @returns {Promise<string[]>} Each heading's text, whitespace collapsed.
 */
function levelOneHeadings(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].map((heading) =>
      heading.textContent.replace(/\s+/gu, ' ').trim(),
    ),
  )
}

/**
 * The window a surface is opened in.
 *
 * @param {'visitor'|'organiser'|'platform'} kind Whose.
 * @returns {Promise<object>} The page.
 */
async function windowFor(kind) {
  if (kind === 'visitor') return visitor
  if (kind === 'platform') return platformReader()

  return organiser
}

/**
 * Choose one General admission ticket at checkout.
 *
 * Retried until the quantity reads 1, because a click that lands before the
 * basket hydrates does nothing. The click is only repeated while the quantity
 * is still 0, so a late press cannot choose two.
 *
 * @param {object} page The page, on the checkout.
 * @returns {Promise<void>} Resolves once one ticket is chosen.
 */
async function chooseOneTicket(page) {
  const quantity = page.getByLabel('Quantity of General admission')
  const add = page.getByRole('button', { name: 'Add one General admission', exact: true })

  await expect(quantity).toHaveValue('0')

  await expect(async () => {
    if ((await quantity.inputValue()) === '0') await add.click()

    await expect(quantity).toHaveValue('1', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/**
 * Open the header's narrow-viewport menu, however early the first press was.
 *
 * A press that lands before hydration does nothing, because the server's
 * button has no handler yet. The press is repeated only while the button still
 * says it is closed, so a late one cannot close the menu again.
 *
 * @param {object} page The page.
 * @param {function(): Promise<void>} press How to press it: a click or a key.
 * @returns {Promise<void>} Resolves once the menu says it is open.
 */
async function openMenu(page, press) {
  const menu = page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true })

  await expect(async () => {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await press()

    await expect(menu).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/**
 * @typedef {object} SweptSurface
 * @property {string} name What the page is, for the test title.
 * @property {'visitor'|'organiser'|'platform'} window Whose window it is opened in.
 * @property {function(): string} path Where it is.
 * @property {function(): string} heading Its one level-one heading, exactly.
 * @property {function(): string} title Its document title, before the site's suffix.
 * @property {function(object): Promise<void>} arrived Waits for, and asserts, what makes it real.
 */

/**
 * The Phase 4 surfaces, each with the rows that make it more than markup.
 *
 * Paths, headings and titles are functions because the seeded ids exist only
 * once `beforeAll` has run, and this list is read when the file is collected.
 * Every heading and title is the page's own, from its source.
 *
 * @type {ReadonlyArray<SweptSurface>}
 */
const PHASE_4_SURFACES = Object.freeze([
  {
    name: 'the category directory',
    window: 'visitor',
    path: () => '/categories',
    heading: () => 'Browse by category',
    title: () => 'Categories',
    async arrived(page) {
      // The facets came from the API, not the sample catalogue, and Live Music
      // has at least one listed event: the alpha event is MUSIC_CONCERT and
      // PUBLISHED. At least one, not exactly one — other runs' events may be
      // in the same database — so "Nothing listed right now" is what fails.
      await expect(page.getByText(SAMPLE_NOTICE)).toHaveCount(0)

      const music = page
        .getByRole('list', { name: 'Event categories', exact: true })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Live Music', exact: true }) })

      await expect(music.getByTestId('category-count')).toHaveText(/^\d[\d,]* events?$/u)
    },
  },
  {
    name: 'the venue directory',
    window: 'visitor',
    path: () => `/venues?city=${encodeURIComponent(SWEEP_VENUE.city)}`,
    heading: () => 'Venues',
    title: () => 'Venues',
    async arrived(page) {
      // The summary is drawn only when the API answered; a failed read is a
      // refusal with no summary at all.
      await expect(page.getByTestId('venue-summary')).toHaveText('1 venue on this page')

      const card = page
        .getByRole('list', { name: 'Venues', exact: true })
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: SWEEP_VENUE.name, exact: true }) })

      await expect(
        card
          .getByRole('list', { name: `Accessibility at ${SWEEP_VENUE.name}`, exact: true })
          .getByRole('listitem'),
      ).toHaveText(SWEEP_VENUE.claims.map(([, label]) => label))
      await expect(card).toContainText('The venue adds an accessibility note on its page.')
    },
  },
  {
    name: 'the organiser directory',
    window: 'visitor',
    path: () => '/organizers',
    heading: () => 'Organisers',
    title: () => 'Organisers',
    async arrived(page) {
      await expect(page.getByText(SAMPLE_NOTICE)).toHaveCount(0)
      await expect(
        page
          .getByRole('list', { name: 'Organisers', exact: true })
          .getByRole('link', { name: `Alpha Collective ${TAG}`, exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'the limitations page',
    window: 'visitor',
    path: () => '/limitations',
    heading: () => 'What this site does not do',
    title: () => 'What this site does not do',
    async arrived(page) {
      // Asks nothing of the API: every statement is a property of the build.
      await expect(
        page.getByRole('heading', { level: 2, name: 'Email', exact: true }),
      ).toBeVisible()
      await expect(page.getByText('EXTERNAL VERIFICATION PENDING', { exact: true })).toBeVisible()
    },
  },
  {
    name: 'the registration page',
    window: 'visitor',
    path: () => '/register',
    heading: () => 'Create an account',
    title: () => 'Create an account',
    async arrived(page) {
      // Still here: a session would have been redirected onwards.
      await expect(page).toHaveURL((url) => url.pathname === '/register')
      await expect(page.getByLabel('Your name')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
    },
  },
  {
    name: 'the sign-in page',
    window: 'visitor',
    path: () => '/sign-in',
    heading: () => 'Sign in',
    title: () => 'Sign in',
    async arrived(page) {
      await expect(page).toHaveURL((url) => url.pathname === '/sign-in')
      await expect(page.getByLabel('Email address')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
      // The second factor is asked for only after a password is accepted.
      await expect(page.getByLabel(/^Six-digit code/u)).toHaveCount(0)
    },
  },
  {
    name: 'the alpha event’s checkout, signed out',
    window: 'visitor',
    path: () => `/events/${EVENT_SLUG}/checkout`,
    heading: () => `Tickets for ${EVENT_TITLE}`,
    title: () => `Tickets for ${EVENT_TITLE}`,
    async arrived(page) {
      const notice = page.getByTestId('payment-mode-notice')

      await expect(notice).toContainText('Payments on this site are simulated')
      await expect(notice).toContainText('You will not be asked for a card, no money moves')

      // Swept with a ticket chosen, which is the state only a visitor sees: a
      // summary priced from the seeded tier and a link to sign in instead of
      // a reserve button.
      await chooseOneTicket(page)

      await expect(page.getByTestId('summary-subtotal')).toHaveText('₹1,000.00')
      await expect(page.getByRole('link', { name: 'Sign in to buy', exact: true })).toHaveAttribute(
        'href',
        `/sign-in?next=${encodeURIComponent(`/events/${EVENT_SLUG}/checkout`)}`,
      )
      await expect(page.getByRole('button', { name: 'Reserve tickets', exact: true })).toHaveCount(
        0,
      )
      await expect(page.getByRole('button', { name: /^Pay /u })).toHaveCount(0)
    },
  },
  {
    name: 'the order history',
    window: 'organiser',
    path: () => '/account/orders',
    heading: () => 'Your orders',
    title: () => 'Orders',
    async arrived(page) {
      await expect(page.getByText('Payments on this site are simulated.')).toBeVisible()

      const card = page.getByRole('listitem').filter({ hasText: commerce.orderReference })

      await expect(card.getByRole('link', { name: EVENT_TITLE, exact: true })).toBeVisible()
      await expect(card).toContainText('Paid — simulated')
    },
  },
  {
    name: 'the seeded order',
    window: 'organiser',
    path: () => `/account/orders/${encodeURIComponent(commerce.orderReference)}`,
    heading: () => EVENT_TITLE,
    title: () => 'Order',
    async arrived(page) {
      await expect(page.getByRole('region', { name: 'The order', exact: true })).toContainText(
        commerce.orderReference,
      )
      await expect(
        page.getByText('Simulated payment — no card was charged and no money moved.', {
          exact: true,
        }),
      ).toBeVisible()
      // Both seeded tickets, linked because this account holds them — and by
      // position, never by the code the order payload carries for each.
      await expect(
        page.getByRole('region', { name: 'Tickets on this order', exact: true }).getByRole('link'),
      ).toHaveText(['Ticket 1 of 2', 'Ticket 2 of 2'])
    },
  },
  {
    name: 'the transfers page',
    window: 'organiser',
    path: () => '/account/transfers',
    heading: () => 'Transfers',
    title: () => 'Transfers',
    async arrived(page) {
      // Both of the owner's tickets are bought and never offered, so the
      // wallet read comes back with nothing to arrange. The accept section is
      // drawn only when that read succeeded.
      await expect(page.getByText('Nothing handed on or received', { exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Accept a ticket', exact: true })).toBeVisible()
    },
  },
  {
    name: 'the account security page',
    window: 'organiser',
    path: () => '/account/security',
    heading: () => 'Account security',
    title: () => 'Account security',
    async arrived(page) {
      // The seeded confirmed factor, and the session this window is using.
      await expect(
        page.getByRole('region', { name: 'Two-step sign-in', exact: true }),
      ).toContainText(
        'On. Signing in asks for a code from your authenticator app as well as your password.',
      )
      await expect(
        page.getByRole('region', { name: 'Where you are signed in', exact: true }),
      ).toContainText('This session')
    },
  },
  {
    name: 'the account privacy page',
    window: 'organiser',
    path: () => '/account/privacy',
    heading: () => 'Privacy',
    title: () => 'Privacy',
    async arrived(page) {
      // Static prose inside the account area, which admitted this session: the
      // header names the person the API says is signed in.
      await expect(
        page
          .getByRole('banner')
          .getByRole('button', { name: 'Alpha Collective Owner, account', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('region', { name: 'What cannot be done from here', exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'the team screen',
    window: 'organiser',
    path: () => '/organizer/team',
    heading: () => 'Team and roles',
    title: () => 'Team and roles',
    async arrived(page) {
      // The door seed's scanner, with the scope it wrote, named by its event.
      const scanner = page
        .getByRole('region', { name: 'Members', exact: true })
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: 'Door Scanner', exact: true }) })

      // The role by its own cell: the seeded name is "Door Scanner", which
      // differs from the role's words only in case, so a row-wide match would
      // be one capital letter away from matching the name instead.
      await expect(scanner.getByRole('cell', { name: 'Door scanner', exact: true })).toBeVisible()
      await expect(scanner).toContainText(`Admits to: ${EVENT_TITLE}`)
    },
  },
  {
    name: 'the refund list',
    window: 'organiser',
    path: () => '/finance/refunds',
    heading: () => 'Refunds',
    title: () => 'Refunds',
    async arrived(page) {
      await expect(page.getByRole('status').filter({ hasText: 'Demonstration data' })).toBeVisible()

      const row = page
        .getByRole('region', { name: 'Refunds', exact: true })
        .getByRole('row')
        .filter({ hasText: commerce.orderReference })

      await expect(
        row.getByRole('link', { name: `Refund on ${commerce.orderReference}`, exact: true }),
      ).toBeVisible()
      await expect(row).toContainText('Requested')
      await expect(row).toContainText('₹1,000.00')
    },
  },
  {
    name: 'the reconciliation list',
    window: 'organiser',
    path: () => '/operations/reconciliation',
    heading: () => 'Reconciliation',
    title: () => 'Reconciliation',
    async arrived(page) {
      // Seeded open, and ninety-six hours old, so the API bands it overdue.
      const row = page
        .getByRole('region', { name: 'Reconciliation items', exact: true })
        .getByRole('row')
        .filter({ hasText: commerce.orderReference })

      await expect(row.getByRole('link', { name: 'Payment timeout', exact: true })).toBeVisible()
      await expect(row).toContainText('Open')
      await expect(row).toContainText('Overdue')
    },
  },
  {
    name: 'the notification queue',
    window: 'platform',
    path: () => '/operations/notifications',
    heading: () => 'Notification queue',
    title: () => 'Notification queue',
    async arrived(page) {
      const row = page
        .getByRole('region', { name: 'Notification queue', exact: true })
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: OUTBOX_PROBE.template, exact: true }) })

      await expect(row).toContainText('Dead letter')
      await expect(row).toContainText('5 of 5')

      // The page says neither recipients nor contents are shown.
      const markup = await page.content()

      expect(markup, 'the queue carries a recipient address').not.toContain(OUTBOX_PROBE.recipient)
      expect(markup, 'the queue carries a message payload').not.toContain(OUTBOX_PROBE.marker)
    },
  },
])

test.describe.serial('the Phase 2 screens, swept', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedRefusals(TAG)
    commerce = await seedDetailScreens({
      tag: TAG,
      organizationId: seeded.alphaOrganizationId,
      eventId: seeded.alphaEventId,
      ownerUserId: seeded.alphaOwnerId,
    })
    door = await seedDoor({
      tag: TAG,
      organizationId: seeded.alphaOrganizationId,
      eventId: seeded.alphaEventId,
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
    await cleanupDoor(TAG)
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
    const banner = page
      .getByRole('status')
      .filter({ hasText: /demonstration/i })
      .first()

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
      ['/organizer/check-in', /check-in/i],
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

  test('the check-in screen is clean at every door width, idle and with a long name on it', async () => {
    const page = organiser
    // The last door ticket carries the long name. Looked up, never admitted:
    // a lookup writes nothing, so this file changes no ticket.
    const longNameCode = door.doorCodes[DOOR_TICKETS - 1]

    for (const size of DOOR_WIDTHS) {
      await page.setViewportSize(size)
      await page.goto('/organizer/check-in')
      await expect(page.getByRole('heading', { name: 'Check-in', level: 1 })).toBeVisible()

      let violations = await scan(page)

      expect(violations, `idle at ${size.width}\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page), `idle at ${size.width}`).toBeLessThanOrEqual(1)

      await page.getByLabel('Printed ticket code').fill(longNameCode)
      await page.getByRole('button', { name: 'Look up' }).click()
      await expect(
        page.getByRole('heading', { name: 'Check the ticket, then admit' }),
      ).toBeFocused()
      await expect(page.getByText(LONG_NAME, { exact: true })).toBeVisible()

      violations = await scan(page)

      expect(violations, `preview at ${size.width}\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page), `preview at ${size.width}`).toBeLessThanOrEqual(1)

      await page.getByRole('button', { name: 'Cancel' }).click()
    }
  })

  test('the check-in screen is clean when no camera can be had', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('refused by the sweep', 'NotAllowedError')
      }
    })
    await signInWithoutFactor(page, door.scannerEmail)
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/organizer/check-in')
    await page.getByRole('button', { name: 'Scan the QR pass' }).click()
    await page.getByRole('button', { name: 'Start camera' }).click()
    await expect(page.getByText(/camera permission was refused/iu)).toBeVisible()

    const violations = await scan(page)

    expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

    await context.close()
  })

  test('the check-in screen does not move, and hides nothing, when motion is reduced', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()

    await signInWithoutFactor(page, door.scannerEmail)
    await page.goto('/organizer/check-in')
    await page.getByLabel('Printed ticket code').fill(door.doorCodes[DOOR_TICKETS - 1])
    await page.getByRole('button', { name: 'Look up' }).click()
    await expect(page.getByRole('heading', { name: 'Check the ticket, then admit' })).toBeVisible()

    const moving = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' && !(animation instanceof CSSTransition),
          ).length,
    )
    const invisible = await page.evaluate(
      () =>
        [...document.querySelectorAll('main *')].filter((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) === 0
          )
        }).length,
    )

    expect(moving).toBe(0)
    expect(invisible).toBe(0)

    await context.close()
  })

  test('the holder’s pass is clean, at the narrowest width and the widest', async ({ browser }) => {
    // This case scans the panel a pass is drawn in, and it never draws a real
    // one. This configuration keeps screenshots of a failing test's pages, and
    // a screenshot of a pass is a ticket. Closing the context does not stop
    // that: Playwright 1.63 takes a screenshot of every page in a context as
    // the context closes and keeps it if the test failed, and on a timeout it
    // screenshots every page still open. `screenshot`, `trace` and `video` are
    // worker-scoped, so `test.use` cannot turn them off for this one case
    // while the rest of the sweep keeps them.
    //
    // So the pass request is answered here, before it can leave the browser,
    // with a value that is plainly not a credential. It has a real pass's
    // length and alphabet, so the drawing is the size a real one is. The real
    // round trip — drawn, decoded, scanned, admitted — is in
    // `detail-organizer-checkin.spec.js`, whose file-level `test.use` turns
    // screenshots, traces and video off.
    const context = await browser.newContext()
    const ticketId = door.doorTicketIds[0]
    const synthetic = 'SWEEP-NOT-A-CREDENTIAL-'.padEnd(43, 'x')
    const passRequests = []
    let answered = 0

    context.on('request', (request) => {
      if (/^\/api\/v1\/tickets\/[^/]+\/pass$/u.test(new URL(request.url()).pathname)) {
        passRequests.push(request.url())
      }
    })
    // Every ticket's pass path, not only this one's: no real pass can reach
    // this page, whichever ticket it asks for.
    await context.route('**/api/v1/tickets/*/pass', async (route) => {
      answered += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store, private' },
        body: JSON.stringify({
          data: { ticketId, credential: synthetic, credentialVersion: 1, issuedAt: null },
        }),
      })
    })

    try {
      const page = await context.newPage()

      await signInWithoutFactor(page, door.holderEmail)

      for (const [index, width] of [320, 1440].entries()) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/tickets/${ticketId}`)
        await page.getByRole('button', { name: 'Show my entry pass' }).click()
        await expect(page.getByRole('img', { name: /entry pass, as a qr code/iu })).toBeVisible()

        // Every pass request this page made was answered by the route above,
        // so the server's pass was never fetched.
        expect(answered, `pass requests answered here at ${width}`).toBe(index + 1)
        expect(passRequests, `pass requests made at ${width}`).toHaveLength(index + 1)

        const violations = await scan(page)

        expect(violations, `pass at ${width}\n  ${describe(violations)}`).toHaveLength(0)
        expect(await sidewaysOverflow(page), `pass at ${width}`).toBeLessThanOrEqual(1)

        await page.getByRole('button', { name: 'Hide pass' }).click()
      }
    } finally {
      await context.close()
    }
  })

  test.describe('the Phase 4 surfaces, swept', () => {
    test.beforeAll(async ({ browser }) => {
      const prisma = createPrismaClient({ connectionString: CONNECTION })

      // Upserted, so a run re-started with the same `SWEEP_E2E_TAG` after one
      // that stopped before its `afterAll` finds these rows rather than
      // failing on their unique keys. (A failure inside this serial group
      // skips the cases after it; it does not re-run this hook.)
      try {
        const venue = {
          name: SWEEP_VENUE.name,
          addressLine1: '1 Sweep Road',
          city: SWEEP_VENUE.city,
          region: 'Maharashtra',
          postalCode: '400001',
          // No organisation: a shared venue, which is what the anonymous
          // directory lists.
          organizationId: null,
          provenance: 'moderator',
          accessibility: {
            features: SWEEP_VENUE.claims.map(([code]) => code),
            note: 'The step-free entrance is at Gate 3; ring the bell there for the lift.',
          },
        }

        await prisma.venue.upsert({
          where: { slug: SWEEP_VENUE.slug },
          update: venue,
          create: { slug: SWEEP_VENUE.slug, ...venue },
        })

        const { template, dedupeKey, recipient, marker } = OUTBOX_PROBE
        const message = {
          template,
          channel: 'EMAIL',
          recipient,
          payload: { note: marker },
          status: 'DEAD_LETTER',
          attempts: 5,
          maxAttempts: 5,
          // Older than anything else in the queue, so it heads the first page:
          // dead letters come first, longest-waiting first.
          scheduledFor: new Date('1999-01-01T00:00:00.000Z'),
          lastAttemptAt: new Date(Date.now() - 3_600_000),
          failureCategory: 'PERMANENT',
          lastError: 'the simulated mail service refused the sweep’s probe message',
        }

        await prisma.notificationOutbox.upsert({
          where: { dedupeKey },
          update: message,
          create: { dedupeKey, ...message },
        })
      } finally {
        await prisma.$disconnect()
      }

      // Nobody signs in here, and nobody ever will: the public pages are what
      // a visitor sees, and sign-in and registration redirect anybody else.
      visitorContext = await browser.newContext()
      visitor = await visitorContext.newPage()
    })

    test.afterAll(async () => {
      await visitorContext?.close()

      const prisma = createPrismaClient({ connectionString: CONNECTION })

      // Nothing references either row, so both deletes succeed.
      try {
        await prisma.venue.deleteMany({ where: { slug: SWEEP_VENUE.slug } })
        await prisma.notificationOutbox.deleteMany({ where: { dedupeKey: OUTBOX_PROBE.dedupeKey } })
      } finally {
        await prisma.$disconnect()
      }
    })

    for (const surface of PHASE_4_SURFACES) {
      test(`${surface.name} reflows at every width and at 200% zoom, and scans clean`, async () => {
        const page = await windowFor(surface.window)
        const path = surface.path()
        const heading = surface.heading()

        // Opened once, at the narrowest width, and resized from there: the
        // state a case sets up on arrival — a ticket chosen at checkout — is
        // then measured at every size rather than rebuilt for each.
        await page.setViewportSize(DOOR_WIDTHS[0])
        await page.goto(path)
        await expect(
          page.getByRole('heading', { level: 1, name: heading, exact: true }),
        ).toBeVisible()

        await surface.arrived(page)

        await expect(page).toHaveTitle(`${surface.title()} · Desi-Event`)
        // Exactly one, and it is the page's own: a second level-one heading
        // from a shell or a state component would be a second "what is this
        // page" for anybody navigating by headings.
        expect(await levelOneHeadings(page), `${path}'s level-one headings`).toEqual([heading])

        for (const size of PHASE_4_SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height })

          expect(
            await sidewaysOverflow(page),
            `${path} scrolls sideways at ${size.label}`,
          ).toBeLessThanOrEqual(1)

          if (SCANNED_WIDTHS.has(size.width)) {
            const violations = await scan(page)

            expect(violations, `${path} at ${size.label}\n  ${describe(violations)}`).toHaveLength(
              0,
            )
          }
        }

        await expectNoSecrets(page, path)
      })
    }

    test('at 320 px the header’s way into the catalogue is reached, opened and walked by keyboard', async () => {
      // `components/primary-nav.jsx`: below 768 px the four discovery links
      // are not drawn in the header row at all; a disclosure button reveals
      // them. So what a keyboard has to reach is that button, and then the
      // links it reveals — and the focus contract the component states:
      // opening moves focus into the sheet, Escape closes it and puts focus
      // back on the button.
      const page = visitor
      const banner = page.getByRole('banner')
      const menu = banner.getByRole('button', { name: 'Menu', exact: true })

      await page.setViewportSize(DOOR_WIDTHS[0])
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // Not in the row at this width, so the menu is the only way to them.
      for (const entry of HEADER_ENTRIES) {
        await expect(banner.getByRole('link', { name: entry.label, exact: true })).toHaveCount(0)
      }

      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('link', { name: 'Skip to main content', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(banner.getByRole('link', { name: 'Desi-Event', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(menu).toBeFocused()
      await expect(menu).toHaveAttribute('aria-expanded', 'false')

      await openMenu(page, () => page.keyboard.press('Enter'))

      const sheet = page.locator(`[id="${await menu.getAttribute('aria-controls')}"]`)

      await expect(sheet).toBeFocused()

      // The open sheet's navigation is the only one named Primary that is
      // drawn: the row's is `display: none` at this width.
      const nav = banner.getByRole('navigation', { name: 'Primary', exact: true })

      for (const entry of HEADER_ENTRIES) {
        await page.keyboard.press('Tab')

        const link = nav.getByRole('link', { name: entry.label, exact: true })

        await expect(link).toBeFocused()
        await expect(link).toHaveAttribute('href', entry.path)
      }

      // Open, the sheet adds a column of links to the header; it must not
      // widen the page to do it.
      expect(await sidewaysOverflow(page), 'the open menu at 320 px').toBeLessThanOrEqual(1)

      await page.keyboard.press('Escape')

      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await expect(menu).toBeFocused()
      await expect(sheet).toHaveCount(0)
    })

    test('with motion reduced, nothing on the home page moves for longer than 0.01 ms or stays hidden', async () => {
      // The contract is in two places. `components/motion.jsx` renders the
      // plain element, with no animation at all, when the platform asks for
      // reduced motion; the shared stylesheet's reduced-motion block cuts
      // every CSS animation and transition to 0.01 ms and forces every
      // `[data-motion]` element to its resting state. Either one failing
      // leaves something moving, or something invisible, on the home page.
      const page = await visitorContext.newPage()

      try {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        // Narrow, for the menu button below.
        await page.setViewportSize({ width: 375, height: 900 })
        await page.goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        ).toBe(true)

        // Hydrated before anything is measured: an entrance animation can only
        // start once Framer Motion is running in the page, so measuring the
        // server's markup alone could not see one. The menu opening proves the
        // client has taken over.
        const menu = page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true })

        await openMenu(page, () => menu.click())
        await page.keyboard.press('Escape')
        await expect(menu).toHaveAttribute('aria-expanded', 'false')

        const found = await page.evaluate(async (limit) => {
          const frames = () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            })
          const name = (element) => {
            const classes =
              typeof element.className === 'string'
                ? element.className.trim().split(/\s+/u).slice(0, 3).join('.')
                : ''

            return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`
          }
          // "1e-05s", "150ms" or a comma-separated list of either, in ms.
          const toMs = (value) =>
            Math.max(
              0,
              ...value.split(',').map((part) => {
                const trimmed = part.trim()
                const number = Number.parseFloat(trimmed)

                return trimmed.endsWith('ms') ? number : number * 1000
              }),
            )
          const tooLong = (ms) => ms - limit > 1e-6

          const animated = [...document.querySelectorAll('[data-motion]')]
          const running = new Set()

          // Each one scrolled into view, because the ones below the fold would
          // only begin their entrance once they are seen.
          for (const element of animated) {
            element.scrollIntoView({ block: 'center' })
            await frames()

            for (const animation of document.getAnimations()) {
              const target = animation.effect?.target

              if (
                animation.playState === 'running' &&
                target?.closest?.('[data-motion]') &&
                tooLong(animation.effect.getComputedTiming().endTime)
              ) {
                running.add(
                  `${name(target)}: ${animation.constructor.name} running for ${animation.effect.getComputedTiming().endTime} ms`,
                )
              }
            }
          }

          window.scrollTo(0, 0)

          const slow = []

          for (const element of document.querySelectorAll('[data-motion], [data-motion] *')) {
            const style = getComputedStyle(element)
            const transition = toMs(style.transitionDuration)
            const animation = style.animationName === 'none' ? 0 : toMs(style.animationDuration)

            if (tooLong(transition) || tooLong(animation)) {
              slow.push(
                `${name(element)}: transition ${style.transitionDuration}, animation ${style.animationName} ${style.animationDuration}`,
              )
            }
          }

          const unsettled = animated
            .filter((element) => {
              const style = getComputedStyle(element)

              return Number.parseFloat(style.opacity) < 1 || style.transform !== 'none'
            })
            .map(name)

          return { count: animated.length, running: [...running], slow, unsettled }
        }, 0.01)

        // Not vacuous: the home page's hero and sections are animated content.
        expect(found.count, 'the home page has [data-motion] content').toBeGreaterThan(0)
        expect(found.running, 'animations still running under reduced motion').toEqual([])
        expect(found.slow, 'transitions or animations longer than 0.01 ms').toEqual([])
        expect(found.unsettled, '[data-motion] content not at rest').toEqual([])
      } finally {
        await page.close()
      }
    })
  })
})
