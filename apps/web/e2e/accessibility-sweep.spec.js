import AxeBuilder from '@axe-core/playwright'
import { createPrismaClient } from '@desi-event/db'
import { expect, test } from '@playwright/test'

import { COMPANY_CHANNELS } from './support/company-contact.js'
import { signIn as signInWaitingOutTheLimiter } from './support/detail-world.mjs'
import { cleanupDetailScreens, seedDetailScreens } from './support/seed-detail-screens.mjs'
import { DOOR_TICKETS, LONG_NAME, cleanupDoor, seedDoor } from './support/seed-door.mjs'
import {
  BOX_SEATS,
  GROUP_GUESTS,
  cleanupFeatureWorld,
  seedEventContent,
  seedFeatureWorld,
  seedPostponedEvent,
} from './support/seed-feature-world.mjs'
import { removePictures, seedPictures } from './support/seed-media.mjs'
import {
  cleanupOnboarding,
  onboardingNames,
  seedAdministrator,
  seedWaitingInvitation,
} from './support/seed-onboarding.mjs'
import { inviteOrganiser } from './support/organiser-invitations.mjs'
import {
  CONNECTION,
  PASSWORD,
  TOTP_SECRET,
  cleanupRefusals,
  currentCode,
  forgetCodeUse,
  seedRefusals,
} from './support/seed-refusals.mjs'
import {
  cleanupFullControl,
  fullControlNames,
  seedFullControl,
} from './support/seed-full-control.mjs'
import {
  buildImportDataset,
  cleanupImport,
  importNames,
  planOnlyDataset,
  platformHeldExists,
  seedImport,
} from './support/seed-import.mjs'
import {
  cleanupVenuePayments,
  endNightOf,
  finishPastNight,
  seedVenuePayments,
  ticketsOf,
  venuePaymentNames,
} from './support/seed-venue-payments.mjs'
import {
  confirmIfAsked,
  confirmStepUp,
  stepUpPrompt,
  waitOutCredentialBudget,
} from './support/step-up.mjs'
import { VISITOR_AGENT, rollUpTrafficNow } from './support/traffic.mjs'

// The feature-completion cases below put a team invitation code and an order's
// group pass on the screen — the one sanctioned exception to "no credential
// on a page", shown once to the person who hands it over. A screenshot, a
// trace or a film of either is a working credential in a CI artefact, and
// these options are worker-scoped, so they cannot be turned off for those
// cases alone: they are off for the whole file.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

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
 * ## The onboarding screens
 *
 * Organisers join only by an invitation from the team at The Desi Events, so the
 * Phase 4 block also sweeps the screens of that path: the invitations list
 * with an invitation waiting in it (seeded, its code made and dropped), the
 * invite form filled in, the panel a new invitation's code is shown in with
 * the message to send and its controls walked by keyboard, the page where the
 * invitation is accepted, and People and roles as a platform administrator
 * sees it — the search, without the platform-role change (ADR 0018). The
 * invitation the panel case issues goes to an address
 * nobody signs in as, and the block's teardown removes it.
 *
 * ## The website link and the visit counts
 *
 * The Phase 4 block also sweeps the organiser's website link and the visit
 * figures: the administrators' list of website links in each of its five
 * states (the "Off" one with a link the block decides and leaves off on
 * gamma's online event), the switch's panel on a review page with the link
 * on and with an address waiting and its box to tick, the organiser's
 * read-only status in the editor, the public page's link, and the route's
 * two pages of its own — the 404 for a link that is off, and the 503 shown
 * when the lookup cannot be made, reached by a window with a browser
 * description of its own using up its minute's lookups (so nobody else's
 * are refused). Then an event's and an organisation's visits as the organiser
 * reads them, and every event's visits as a platform administrator does,
 * after one visit the block counts and adds up with the roll-up the worker
 * runs (`support/traffic.mjs`), so the chart is drawn with a bar in it.
 *
 * ## The feature-completion screens
 *
 * The editor's tickets, pictures, line-up and guest steps and the panel that
 * changes a live event's date are measured in the per-viewport loop; the
 * organisation pages, the organisation checks and the platform's people and
 * roles join the Phase 4 block. The pictures have a block of their own,
 * because a Media step, a moderator's review and a public page with no picture
 * on them measure nothing about pictures: it writes a cover and a gallery
 * straight into the store for alpha's draft (waiting for review) and gamma's
 * public event (approved), scans all three pages at every viewport, and
 * removes them again.
 *
 * The block also sweeps the screens that commerce and the door added: the
 * page where a team invitation code is typed, the team screen with a freshly
 * issued code on it, the promo codes screen with a code in its table, the
 * seat picker as a stranger sees it, a signed-in checkout with a code applied
 * and a name box per ticket, the platform administrator's filtered door, an
 * order with its group pass shown, and the door with that group looked up.
 * The code and the pass are real, which is why this file turns screenshots,
 * traces and video off at its top level. After the block, the seat grid, the
 * door's filter and the group pass's controls are worked from the keyboard
 * alone, and the editor's ticket form is scanned with its reserved-seating
 * block open, on gamma's balcony concert, whose nights sit on a seat plan.
 *
 * ## Why these tests live in this file rather than a new one
 *
 * `playwright.sweep.config.js` pins `testMatch: '**‍/accessibility-sweep.spec.js'`.
 * A new spec file would not be collected by the sweep job, and would instead be
 * picked up by the default config — whose job does not start the API. So the
 * only place an accessibility test can go is here. `pnpm ci:check` now refuses
 * a spec that no CI job collects, or that two do
 * (`scripts/lib/spec-collection.mjs`), so that mistake fails before a browser
 * starts rather than in the wrong job.
 *
 * @module e2e/accessibility-sweep
 */

/**
 * The run suffix, so cleanup can find exactly this run's rows.
 *
 * 3 to 24 lower-case letters and digits, as the feature world requires of a
 * `SWEEP_E2E_TAG` too, and good for one run: see `seed-feature-world.mjs`.
 */
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

/**
 * What the pictures block's pictures show, as their organisers described them.
 *
 * Long enough to wrap at 320, which is part of what is being measured.
 */
const SWEEP_PICTURES = Object.freeze({
  draftCover: 'The courtyard at dusk, with lanterns strung between the trees',
  draftGallery: Object.freeze([
    'Musicians tuning up on a low stage',
    'The first row of the audience, cross-legged on durries',
  ]),
  liveCover: 'Dancers circling a lit garbo under string lights',
  liveGallery: Object.freeze([
    'The first circle of dancers, before the music starts',
    'Children learning the steps at the edge of the floor',
  ]),
})

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
/**
 * The feature world's rows under this file's tag: gamma, the waiting
 * organisation, the role target (`seed-feature-world.mjs`).
 *
 * @type {object}
 */
let feature
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
 * The feature world's giver, signed in on first use: the buyer of the group
 * order whose pass the Phase 4 block draws. No second factor, one credential
 * request, spent only when a case needs the window.
 *
 * @type {(Promise<object>|null)}
 */
let giverSignIn = null
/** @type {object} */
let giverContext
/**
 * The group code the giver's order page showed, for the door case after it.
 *
 * @type {string|null}
 */
let shownGroupCode = null
/**
 * The public page content written onto alpha's published event
 * (`eventContent` in `seed-feature-world.mjs`).
 *
 * @type {object}
 */
let content
/**
 * The one performer, slot and question written onto alpha's draft.
 *
 * @type {object}
 */
let draftContent
/**
 * Gamma's postponed event, for the form that brings it back.
 *
 * @type {{eventId: string, title: string, slug: string}}
 */
let postponed
/**
 * Gamma's owner, signed in on first use, for the postponed event's editor.
 * Memoised as a promise for the reason {@link platformSignIn} gives.
 *
 * @type {(Promise<object>|null)}
 */
let gammaSignIn = null
/** @type {object} */
let gammaContext
/**
 * The unverified organisation's owner, signed in on first use: an owner whose
 * organisation has not been checked, as somebody who has just made one sees
 * its page. Memoised as a promise for the reason {@link platformSignIn} gives.
 *
 * @type {(Promise<object>|null)}
 */
let unverifiedSignIn = null
/** @type {object} */
let unverifiedContext
/**
 * The platform administrator's sign-in, made the first time a case asks for
 * the window: an ADMIN, which no other window here is, for People and roles as
 * a platform administrator sees it (ADR 0018). Memoised as a promise for the
 * reason {@link platformReader} gives.
 *
 * @type {(Promise<object>|null)}
 */
let administratorSignIn = null
/** @type {object} */
let administratorContext
/**
 * A window whose website-link lookups have used up their minute's budget, so
 * the route's "Website link unavailable" page is what it is shown. Its own
 * browser description gives it a budget of its own: nobody else's lookups are
 * refused. Memoised as a promise for the reason {@link platformReader} gives.
 *
 * @type {(Promise<object>|null)}
 */
let lookupLimitedSignIn = null
/** @type {object} */
let lookupLimitedContext
/**
 * The organiser invitation the Phase 4 block seeds waiting, whose code nobody
 * holds (`seedWaitingInvitation`), so the invitations list is measured with a
 * row in it.
 *
 * @type {{id: string, email: string, organizationName: string}}
 */
let waitingInvitation
/**
 * The organiser invitation a case issues, to measure the code panel and its
 * message: an address under this file's tag that nobody signs in as, so the
 * code is never used. Removed with the block (`cleanupOnboarding`).
 *
 * @type {Readonly<{email: string, organizationName: string, note: string}>}
 */
const SWEEP_ORGANISER = Object.freeze({
  email: `onboard-sweep-${TAG}@organiser.test`,
  organizationName: `Onboard Sweep ${TAG} ગરબા`,
  note: 'नमस्ते! Your organiser invitation is below.',
})
/**
 * A promo code the Phase 4 block writes for alpha, so the promo codes screen
 * is measured with a row in its table, and removes again.
 *
 * @type {string}
 */
const SWEEP_PROMO_CODE = `SWEEP10${TAG.toUpperCase()}`

/**
 * The giver's page, signing in the first time it is asked for.
 *
 * Memoised as a promise for the reason {@link platformReader} gives.
 *
 * @returns {Promise<object>} A signed-in page.
 */
function giverWindow() {
  giverSignIn ??= (async () => {
    const page = await giverContext.newPage()

    await signInWaitingOutTheLimiter(page, feature.giverEmail)

    return page
  })()

  return giverSignIn
}

/**
 * Gamma's owner's page, signing in the first time it is asked for.
 *
 * @returns {Promise<object>} A signed-in page.
 */
function gammaOwnerWindow() {
  gammaSignIn ??= (async () => {
    const page = await gammaContext.newPage()

    await signInWaitingOutTheLimiter(page, feature.gammaOwnerEmail)

    return page
  })()

  return gammaSignIn
}

/**
 * The platform administrator's page, signing in the first time it is asked
 * for.
 *
 * @returns {Promise<object>} A signed-in page.
 */
function administratorWindow() {
  administratorSignIn ??= (async () => {
    const page = await administratorContext.newPage()

    await signInWaitingOutTheLimiter(page, onboardingNames(TAG).adminEmail)

    return page
  })()

  return administratorSignIn
}

/**
 * The unverified organisation's owner's page, signing in the first time it is
 * asked for.
 *
 * @returns {Promise<object>} A signed-in page.
 */
function unverifiedOwnerWindow() {
  unverifiedSignIn ??= (async () => {
    const page = await unverifiedContext.newPage()

    await signInWaitingOutTheLimiter(page, seeded.unverifiedOwnerEmail)

    return page
  })()

  return unverifiedSignIn
}

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
 * Every scroll here is instant, and the page is read back until it has
 * stopped moving before the scan starts. The site sets
 * `scroll-behavior: smooth` on the root (`app/globals.css`), and a scroll
 * that names no behaviour inherits it: `scrollTo(0, 0)` returns before the
 * page has moved at all, and the page then glides to the top over the next few
 * hundred milliseconds — while the scanner measures it. Reproduced on the form
 * that brings a postponed event back, at 768 × 1024, where the form taking
 * focus leaves the page scrolled to 668: after the old `scrollTo(0, 0)` the
 * scan began at 668 in 12 scans out of 12, and 2 of them reported a
 * `target-size` violation on whichever editor step was passing under the
 * sticky header's brand link at that frame ("partially obscured, 181px by
 * 14.7px"). Scrolled to the top instantly, the same page at the same width
 * scanned clean 12 times out of 12 — at rest, nothing overlaps those steps.
 *
 * **This cannot mask a violation.** It waits for the resting state and then
 * scans it, and the resting state is the one a reader actually reads. Colours
 * that are wrong at rest are still wrong once the fade has finished, and a
 * target that is covered at rest is still covered.
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
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
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

  // Instant, then read back until two readings, each two frames on, agree: see
  // the note above on what the smooth default did to the scan. Not "until it
  // reads 0". With focus on something below the fold — the check-in preview's
  // heading, at 320 wide — Chrome's scroll anchoring moves the page back down
  // by a few pixels in the frame after the jump, and stays there; with
  // `overflow-anchor: none` the same jump stays at 0. Where the page comes to
  // rest is the page, and it was where the old smooth scroll ended up too.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))

  let previous = null

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)))
            }),
        )
        const resting = current === previous

        previous = current

        return resting
      },
      { message: 'the page never stopped scrolling before the scan', intervals: [100] },
    )
    .toBe(true)

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
 * @param {string} [within] A selector to scan only part of the page; the
 *   whole page when left out.
 * @returns {Promise<object[]>} Violations, each with its rule id and nodes.
 */
async function scan(page, within) {
  await settled(page)

  // WCAG 2.2's tags as well as 2.0's and 2.1's: the standard this site is
  // held to is 2.2 AA. In axe 4.13 that adds one rule, `target-size` (2.5.8),
  // to every scan — the hand-written touch-target case below measures the
  // same criterion on the controls a steward's thumb actually hits.
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .exclude('nextjs-portal')
  const results = await (within ? builder.include(within) : builder).analyze()

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
 * Where the keyboard focus is now, and whether focus draws anything there.
 *
 * A stop is marked when focus itself draws something the same control does
 * not draw at rest: an outline, or a ring of box-shadow. What a control draws
 * anyway says nothing about focus — every design-system field and button
 * carries a resting box-shadow, and many a border — so the resting style is
 * compared away rather than counted. An outline or a ring counts only when it
 * can be seen: a style other than `none`, a width, a colour that is not
 * transparent.
 *
 * The control at rest is read from a shallow copy of it, put beside it for
 * the moment of the reading and taken away again: the same element, classes
 * and attributes, never focused. Its `id`, `name`, `checked`, `autofocus` and
 * `form` are taken off first, so the copy cannot join a radio group, take a
 * label or be submitted.
 *
 * A date or time field is one element with several stops inside it; each is
 * judged, because focus on its later stops is drawn by a different rule
 * (`:focus-within`, `app/globals.css`) from focus on the first.
 *
 * Transitions focus started are finished before reading, so a ring that fades
 * in is read where it comes to rest.
 *
 * @param {object} page The page.
 * @param {string} [scope] The landmark a stop must be inside to be judged:
 *   `main` unless a case walks another one, such as the footer.
 * @returns {Promise<{done?: true, outside?: true, marked?: boolean, what?: string}>} The stop.
 */
function focusStop(page, scope = 'main') {
  return page.evaluate((scopeSelector) => {
    const element = document.activeElement
    const main = document.querySelector(scopeSelector)

    if (!element || element === document.body) return { done: true }
    if (!main?.contains(element)) return { outside: true }

    for (const animation of element.getAnimations()) {
      if (animation instanceof CSSTransition) animation.finish()
    }

    /**
     * Whether a computed colour draws nothing.
     *
     * @param {string} colour A computed colour.
     * @returns {boolean} True when fully transparent.
     */
    const transparent = (colour) => {
      const value = colour.trim()

      if (value === 'transparent') return true

      const slash = value.match(/\/\s*([\d.]+)%?\s*\)$/u)

      if (slash) return Number.parseFloat(slash[1]) === 0

      const rgba = value.match(/^rgba\(([^)]*)\)$/u)

      return Boolean(rgba) && Number.parseFloat(rgba[1].split(',')[3]) === 0
    }

    /**
     * The outline a style draws, or null when it draws none.
     *
     * @param {CSSStyleDeclaration} style A computed style.
     * @returns {string|null} The outline, as one string.
     */
    const outline = (style) =>
      ['none', 'hidden'].includes(style.outlineStyle) ||
      Number.parseFloat(style.outlineWidth) < 1 ||
      transparent(style.outlineColor)
        ? null
        : [style.outlineStyle, style.outlineWidth, style.outlineColor, style.outlineOffset].join(
            ' ',
          )

    /**
     * The box-shadow layers a style draws: each with a colour that shows and
     * some size, so a zero-sized or transparent placeholder is not a ring.
     *
     * @param {string} value A computed `box-shadow`.
     * @returns {string[]} The visible layers.
     */
    const rings = (value) => {
      if (!value || value === 'none') return []

      const layers = []
      let depth = 0
      let start = 0

      for (let at = 0; at < value.length; at += 1) {
        if (value[at] === '(') depth += 1
        else if (value[at] === ')') depth -= 1
        else if (value[at] === ',' && depth === 0) {
          layers.push(value.slice(start, at).trim())
          start = at + 1
        }
      }

      layers.push(value.slice(start).trim())

      return layers.filter((layer) => {
        const colour =
          layer.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|transparent/u)?.[0] ??
          'currentcolor'
        const sizes = layer.replace(colour, '').match(/-?[\d.]+px/gu) ?? []

        return !transparent(colour) && sizes.some((size) => Number.parseFloat(size) !== 0)
      })
    }

    /**
     * What a computed style draws that focus could have added.
     *
     * @param {CSSStyleDeclaration} style A computed style.
     * @returns {{outline: string|null, rings: string[]}} The outline and rings.
     */
    const drawn = (style) => ({ outline: outline(style), rings: rings(style.boxShadow) })

    const focused = drawn(getComputedStyle(element))
    const copy = element.cloneNode(false)

    for (const attribute of ['id', 'name', 'checked', 'autofocus', 'form']) {
      copy.removeAttribute(attribute)
    }

    element.after(copy)

    const rest = drawn(getComputedStyle(copy))

    copy.remove()

    window.sweepStops ??= new WeakMap()

    const before = window.sweepStops.get(element) ?? 0

    window.sweepStops.set(element, before + 1)

    const outlined = focused.outline !== null && focused.outline !== rest.outline
    const ringed = focused.rings.some((ring) => !rest.rings.includes(ring))

    return {
      marked: outlined || ringed,
      what: `${element.outerHTML.slice(0, 100)}${before > 0 ? ` (stop ${before + 1} inside it)` : ''}`,
    }
  }, scope)
}

/**
 * Tab from the top of a page through its main region, as somebody without a
 * mouse does, judging every stop with {@link focusStop}.
 *
 * @param {object} page The page, arrived.
 * @param {number} [presses] The most Tab presses to make.
 * @returns {Promise<Array<{marked: boolean, what: string}>>} The stops inside `main`, in order.
 */
async function walkMain(page, presses = 60) {
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
  })

  const stops = []

  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab')

    const stop = await focusStop(page)

    if (stop.done) break
    if (stop.outside) {
      if (stops.length > 0) break
      continue
    }

    stops.push(stop)
  }

  return stops
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
 * The website link the Phase 4 block decides on gamma's online event, left off
 * by link-admin, so the website links' "Off" list has a row in it. Gamma's
 * other two public events arrive with an address waiting and a link on
 * (`seed-feature-world.mjs`).
 *
 * @type {Readonly<{url: string, reason: string}>}
 */
const SWEEP_OFF_LINK = Object.freeze({
  url: `https://gamma-online-${TAG}.test/`,
  reason: 'Left off for the sweep: the stream has its own page.',
})

/**
 * The browser description of the window whose lookups are refused: ordinary,
 * and its own, so its budget is too.
 *
 * @type {string}
 */
const LOOKUP_LIMITED_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 DesiEventSweepLookup/${TAG}`

/**
 * The website links' five lists, the title of an event each is measured with
 * (a function, for the reason {@link PHASE_4_SURFACES} gives), searched by
 * this run's tag so other runs' rows stay out.
 *
 * @type {ReadonlyArray<{state: string, label: string, title: function(): string}>}
 */
const WEBSITE_LIST_STATES = Object.freeze([
  { state: 'waiting', label: 'Waiting for a decision', title: () => feature.gammaGaEventTitle },
  // Alpha's draft, whose address the block's content seed left waiting.
  { state: 'drafts', label: 'Drafts and others', title: () => `Alpha's Draft ${TAG}` },
  { state: 'on', label: 'On', title: () => feature.gammaSeatedEventTitle },
  { state: 'off', label: 'Off', title: () => feature.gammaOnlineEventTitle },
  { state: 'all', label: 'All', title: () => feature.gammaSeatedEventTitle },
])

/**
 * A page that has asked where gamma's seated event's website link goes until
 * the lookup refused it for the minute, and then once more.
 *
 * The lookup's abuse ceiling is 120 a minute per visitor. Asked from a script
 * — no fetch metadata — every lookup is served and none is counted.
 *
 * @returns {Promise<object>} The page.
 */
function lookupLimitedWindow() {
  lookupLimitedSignIn ??= (async () => {
    const page = await lookupLimitedContext.newPage()
    const path = `/events/${feature.gammaSeatedEventSlug}/website`
    let refused = false

    for (let sent = 0; sent < 140 && !refused; sent += 1) {
      const response = await page.request.get(path, {
        maxRedirects: 0,
        headers: { 'user-agent': LOOKUP_LIMITED_AGENT },
      })

      refused = response.status() === 503

      if (!refused) expect(response.status(), 'a lookup within the budget').toBe(302)
    }

    expect(refused, 'the lookup was never refused for the minute').toBe(true)

    return page
  })()

  return lookupLimitedSignIn
}

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
 * @param {'visitor'|'organiser'|'platform'|'giver'|'unverified'|'administrator'|'gamma'|'limited'} kind Whose.
 * @returns {Promise<object>} The page.
 */
async function windowFor(kind) {
  if (kind === 'visitor') return visitor
  if (kind === 'platform') return platformReader()
  if (kind === 'giver') return giverWindow()
  if (kind === 'unverified') return unverifiedOwnerWindow()
  if (kind === 'administrator') return administratorWindow()
  if (kind === 'gamma') return gammaOwnerWindow()
  if (kind === 'limited') return lookupLimitedWindow()

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
 * @property {'visitor'|'organiser'|'platform'|'giver'} window Whose window it is opened in.
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
    heading: () => 'Who is putting on the nights',
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
      // Two entries carry that status now: real payments, and email, which
      // this build sends only through an SMTP server its operator configures
      // and which has been tested only against a local one (SPEC2).
      const pending = page.getByText('EXTERNAL VERIFICATION PENDING', { exact: true })

      await expect(pending).toHaveCount(2)
      for (const id of ['payments', 'email']) {
        await expect(
          page.locator(`[id="${id}"]`).getByText('EXTERNAL VERIFICATION PENDING', { exact: true }),
        ).toBeVisible()
      }
    },
  },
  {
    name: 'the contact page',
    window: 'visitor',
    path: () => '/contact',
    heading: () => 'Contact The Desi Events',
    title: () => 'Contact',
    async arrived(page) {
      // Asks nothing of the API: the channels are the company's own, written
      // once in `lib/contact.js`. Each is a link showing its full address,
      // which is the longest text this page has to fit into 320 px.
      const channels = page.getByRole('list', { name: 'Ways to reach the team', exact: true })

      await expect(channels.getByRole('listitem')).toHaveCount(COMPANY_CHANNELS.length)
      for (const channel of COMPANY_CHANNELS) {
        await expect(
          channels.getByRole('link', { name: channel.pageName, exact: true }),
        ).toHaveAttribute('href', channel.href)
      }
      // No form: nothing on the page sends a message.
      await expect(page.locator('main form')).toHaveCount(0)
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
  {
    name: 'the page where an organiser invitation is accepted',
    window: 'organiser',
    path: () => '/account/organizations/new',
    heading: () => 'Accept an organiser invitation',
    title: () => 'Accept an organiser invitation',
    async arrived(page) {
      // Nothing is sent from here: the form is measured as it first appears.
      // Organisations are started only by accepting an invitation, so this is
      // the page the account area's link leads to, and it creates nothing by
      // itself.
      const form = page.getByRole('form', { name: 'Accept an organiser invitation', exact: true })

      await expect(form.getByLabel(/^Invitation code/u)).toHaveAttribute('type', 'password')
      await expect(form.getByLabel(/^Time zone/u)).toBeVisible()
      await expect(form.getByLabel(/^Web address on this site/u)).toBeVisible()
      await expect(
        form.getByRole('button', { name: 'Accept the invitation', exact: true }),
      ).toBeEnabled()
    },
  },
  {
    name: 'the organiser invitations, with one waiting',
    window: 'platform',
    path: () => '/admin/organizer-invitations',
    heading: () => 'Organiser invitations',
    title: () => 'Organiser invitations',
    async arrived(page) {
      // The seeded row, whose code nobody holds: waiting, with its row's two
      // actions, and how its code went out.
      const row = page
        .getByRole('table', { name: /^Organiser invitations, /u })
        .getByRole('row')
        .filter({ hasText: waitingInvitation.email })

      await expect(row).toContainText('Waiting')
      await expect(row).toContainText(`New organisation: ${waitingInvitation.organizationName}`)
      await expect(row).toContainText('Shown once to whoever sent it')
      await expect(
        row.getByRole('button', { name: `Issue a new code for ${waitingInvitation.email}` }),
      ).toBeVisible()
      await expect(
        row.getByRole('button', { name: `Withdraw the invitation to ${waitingInvitation.email}` }),
      ).toBeVisible()
    },
  },
  {
    name: 'the organiser invite form, filled in',
    window: 'platform',
    path: () => '/admin/organizer-invitations',
    heading: () => 'Organiser invitations',
    title: () => 'Organiser invitations',
    async arrived(page) {
      // Every box written, the longest ones with text in scripts other than
      // Latin, and nothing sent: the button is measured, never pressed.
      const form = page.getByRole('form', { name: 'Invite an organiser', exact: true })

      await form.getByLabel(/^Their email address/u).fill(SWEEP_ORGANISER.email)
      await form.getByLabel(/^Organisation name/u).fill(SWEEP_ORGANISER.organizationName)
      await form
        .getByLabel(/^Public description of the organisation/u)
        .fill('Garba and dandiya nights in Houston since 2018, run by volunteers.')
      await form
        .getByLabel(/^The organisation’s website/u)
        .fill(`https://onboard-sweep-${TAG}.example.test/`)
      await form.getByLabel(/^A note for them/u).fill(SWEEP_ORGANISER.note)
      await expect(
        form.getByRole('button', { name: 'Create the invitation', exact: true }),
      ).toBeEnabled()
    },
  },
  {
    name: 'a new organiser invitation’s code, with the message to send',
    window: 'platform',
    path: () => '/admin/organizer-invitations',
    heading: () => 'Organiser invitations',
    title: () => 'Organiser invitations',
    async arrived(page) {
      // A real invitation, to an address nobody signs in as, so the panel is
      // measured as an administrator sees it — the code, the message with it,
      // and both copy buttons. This file keeps no screenshot, trace or film.
      const { panel } = await inviteOrganiser(page, {
        email: SWEEP_ORGANISER.email,
        organizationName: SWEEP_ORGANISER.organizationName,
        note: SWEEP_ORGANISER.note,
      })

      await expect(panel.getByLabel('Message to send them', { exact: true })).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Copy the code', exact: true })).toBeVisible()
      await expect(
        panel.getByRole('button', { name: 'Copy the message', exact: true }),
      ).toBeVisible()

      // Reached from the keyboard alone: from the focused heading, Tab walks
      // to the code, the message, and the three buttons in turn.
      await expect(
        panel.getByRole('heading', {
          name: `Organiser invitation code for ${SWEEP_ORGANISER.email}`,
        }),
      ).toBeFocused()

      for (const control of [
        panel.getByLabel('Invitation code', { exact: true }),
        panel.getByLabel('Message to send them', { exact: true }),
        panel.getByRole('button', { name: 'Copy the code', exact: true }),
        panel.getByRole('button', { name: 'Copy the message', exact: true }),
        panel.getByRole('button', { name: 'I have handed it over', exact: true }),
      ]) {
        await page.keyboard.press('Tab')
        await expect(control).toBeFocused()
      }
    },
  },
  {
    name: 'people and roles, as a platform administrator',
    window: 'administrator',
    path: () => '/admin/users',
    heading: () => 'People and roles',
    title: () => 'People and roles',
    async arrived(page) {
      // ADR 0018: the page is the platform administrator's too, with the one
      // thing it may not do — change a platform role — said, not offered.
      await expect(
        page.getByText(/Changing a platform role is for super administrators\./u),
      ).toBeVisible()
      await expect(page.getByRole('form', { name: 'Find an account', exact: true })).toBeVisible()
    },
  },
  {
    name: 'an organisation’s own page, with its verification',
    window: 'organiser',
    path: () => '/organizer/organization',
    heading: () => `Alpha Collective ${TAG}`,
    title: () => 'Organisation',
    async arrived(page) {
      const verification = page.getByRole('region', { name: 'Verification', exact: true })

      await expect(verification.getByText('Verification: Verified')).toBeVisible()
    },
  },
  {
    name: 'an unverified organisation’s own page, as its owner sees it',
    window: 'unverified',
    path: () => '/organizer/organization',
    heading: () => `Unverified Collective ${TAG}`,
    title: () => 'Organisation',
    async arrived(page) {
      // What somebody who has just made an organisation sees: unverified, and
      // the form that asks for a check, measured as it first appears. Nothing
      // is sent.
      const verification = page.getByRole('region', { name: 'Verification', exact: true })

      await expect(verification.getByText('Verification: Unverified')).toBeVisible()

      const ask = page.getByRole('form', { name: 'Ask for verification', exact: true })

      await expect(ask.getByLabel(/^A note for the moderator/u)).toBeVisible()
      await expect(
        ask.getByRole('button', { name: 'Ask for verification', exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'the organisation checks queue',
    window: 'platform',
    path: () => '/moderation/organizations',
    heading: () => 'Organisation checks',
    title: () => 'Organisation checks',
    async arrived(page) {
      await expect(
        page.getByRole('link', { name: feature.pendingOrganizationName, exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'an organisation waiting for its check',
    window: 'platform',
    path: () => `/moderation/organizations/${encodeURIComponent(feature.pendingOrganizationId)}`,
    heading: () => feature.pendingOrganizationName,
    title: () => 'Check an organisation',
    async arrived(page) {
      // The decisions a moderator has from here, offered and not pressed.
      const decisions = page.getByRole('group', { name: 'Decisions', exact: true })

      await expect(decisions.getByRole('button', { name: 'Verify', exact: true })).toBeVisible()
      await expect(page.getByText('State: Waiting for a moderator').first()).toBeVisible()
    },
  },
  {
    name: 'an organisation waiting for its check, with the decision to verify it open',
    window: 'platform',
    path: () => `/moderation/organizations/${encodeURIComponent(feature.pendingOrganizationId)}`,
    heading: () => feature.pendingOrganizationName,
    title: () => 'Check an organisation',
    async arrived(page) {
      // Opened, not recorded: the decision form is measured with its reason
      // field and its button, and nothing is sent.
      const verify = page
        .getByRole('group', { name: 'Decisions', exact: true })
        .getByRole('button', { name: 'Verify', exact: true })
      const decision = page.getByRole('group', {
        name: `Verify: ${feature.pendingOrganizationName}`,
      })

      await expect(async () => {
        if ((await decision.count()) === 0) await verify.click()
        await expect(decision).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(decision.getByLabel(/^Reason/u)).toBeVisible()
      await expect(
        decision.getByRole('button', { name: 'Record: verify', exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'people and roles, with an account found',
    window: 'platform',
    path: () => '/admin/users',
    heading: () => 'People and roles',
    title: () => 'People and roles',
    async arrived(page) {
      const search = page.getByRole('form', { name: 'Find an account', exact: true })

      // Searched in the request body; nothing is changed.
      await search.getByLabel(/^Email address, name or account id/u).fill(feature.roleTargetEmail)
      await search.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page.getByRole('article', { name: 'Role Target' })).toContainText(
        'Platform role: Attendee',
      )
    },
  },
  {
    name: 'people and roles, with the role change and the membership forms open',
    window: 'platform',
    path: () => '/admin/users',
    heading: () => 'People and roles',
    title: () => 'People and roles',
    async arrived(page) {
      const search = page.getByRole('form', { name: 'Find an account', exact: true })

      await search.getByLabel(/^Email address, name or account id/u).fill(feature.roleTargetEmail)
      await search.getByRole('button', { name: 'Search', exact: true }).click()

      const card = page.getByRole('article', { name: 'Role Target' })

      await expect(card).toContainText('Platform role: Attendee')

      // Both forms opened, filled with nothing, and measured; neither is sent.
      await card.getByRole('button', { name: 'Change Role Target’s platform role' }).click()
      await expect(card.getByLabel(/^New platform role/u)).toBeVisible()
      await card.getByRole('button', { name: 'Put Role Target into an organisation' }).click()
      await expect(
        card
          .getByRole('form', { name: 'Find an organisation' })
          .getByLabel(/^Organisation name or web address/u),
      ).toBeVisible()
      await expect(card.getByLabel(/^New platform role/u)).toBeVisible()
    },
  },
  {
    name: 'the page where a team invitation code is typed',
    window: 'organiser',
    path: () => '/account/invitations',
    heading: () => 'Join an organisation',
    title: () => 'Join an organisation',
    async arrived(page) {
      // Measured as it first appears: nothing is typed or sent.
      const form = page.getByRole('form', { name: 'Join with a code', exact: true })

      await expect(form.getByLabel(/^Invitation code/u)).toBeVisible()
      await expect(form.getByLabel(/^Invitation code/u)).toHaveValue('')
    },
  },
  {
    name: 'the team screen with a freshly issued invitation code on it',
    window: 'organiser',
    path: () => '/organizer/team',
    heading: () => 'Team and roles',
    title: () => 'Team and roles',
    async arrived(page) {
      // A real invitation, to an address of this run's own, so the panel is
      // the one a person sees: the code, its field and its instructions.
      const invitee = `sweep-invitee-${TAG}@attendee.test`
      const form = page.getByRole('form', { name: 'Invite somebody', exact: true })

      await form.getByLabel(/^Their email address/u).fill(invitee)
      await waitOutCredentialBudget(
        page,
        async () => {
          await form.getByRole('button', { name: 'Invite them', exact: true }).click()
          await expect(
            page.getByRole('region', { name: `Invitation code for ${invitee}`, exact: true }),
          ).toBeVisible()
        },
        { refusedAt: /\/invitations$/u },
      )

      const panel = page.getByRole('region', {
        name: `Invitation code for ${invitee}`,
        exact: true,
      })

      await expect(panel.getByLabel('Invitation code', { exact: true })).toHaveAttribute(
        'readonly',
        '',
      )
      await expect(
        panel.getByRole('button', { name: 'I have handed it over', exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'the promo codes screen, with a code in its table',
    window: 'organiser',
    path: () =>
      `/organizer/promo-codes?organizationId=${encodeURIComponent(seeded.alphaOrganizationId)}`,
    heading: () => 'Promo codes',
    title: () => 'Promo codes',
    async arrived(page) {
      const row = page
        .getByRole('table')
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: SWEEP_PROMO_CODE, exact: true }) })

      await expect(row).toContainText('10% off')
      await expect(row).toContainText('Active')
      await expect(
        page.getByRole('form', { name: 'Make a promo code', exact: true }).getByLabel('Code', {
          exact: true,
        }),
      ).toBeVisible()
    },
  },
  {
    name: 'the seat picker, signed out',
    window: 'visitor',
    path: () => `/events/${feature.gammaSeatedEventSlug}/seats/${feature.gammaSeatedSessionIds[0]}`,
    heading: () => `Choose seats for ${feature.gammaSeatedEventTitle}`,
    title: () => `Choose seats for ${feature.gammaSeatedEventTitle}`,
    async arrived(page) {
      const grid = page.getByRole('grid', { name: 'Balcony', exact: true })
      const boxes = page.getByRole('grid', { name: 'Boxes', exact: true })

      await expect(page.getByRole('heading', { name: 'What the seats show' })).toBeVisible()
      await expect(grid.getByRole('button')).toHaveCount(12)
      // The giver's seat, sold, and said to be in words.
      await expect(grid.getByRole('button', { name: /^Seat A3, .*, unavailable$/u })).toHaveCount(1)
      // The boxes: every symbol the legend explains is on the map, and the
      // restricted seat's note is printed under its section — all of it
      // measured with the rest.
      await expect(boxes.getByRole('button')).toHaveCount(BOX_SEATS.length)

      for (const kind of [
        /, wheelchair space, available$/u,
        /, companion seat, available$/u,
        /, obstructed view, available$/u,
        /, restricted, available$/u,
        /^Seat K5, .*, unavailable$/u,
      ]) {
        await expect(boxes.getByRole('button', { name: kind })).toHaveCount(1)
      }

      await expect(
        page.getByRole('listitem').filter({
          hasText: BOX_SEATS.find((box) => box.restrictionNote).restrictionNote,
        }),
      ).toBeVisible()
      await expect(page.getByLabel('Price zone', { exact: true })).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Sign in to reserve', exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: /^Reserve /u })).toHaveCount(0)
    },
  },
  {
    name: 'a signed-in checkout with a promo code applied and a name box for each ticket',
    window: 'organiser',
    path: () => `/events/${feature.gammaGaEventSlug}/checkout`,
    heading: () => `Tickets for ${feature.gammaGaEventTitle}`,
    title: () => `Tickets for ${feature.gammaGaEventTitle}`,
    async arrived(page) {
      const tier = 'General admission, night 1'
      const quantity = page.getByLabel(`Quantity of ${tier}`)
      const add = page.getByRole('button', { name: `Add one ${tier}`, exact: true })

      await expect(async () => {
        if ((await quantity.inputValue()) === '0') await add.click()

        await expect(quantity).toHaveValue('1', { timeout: 1_000 })
      }).toPass({ timeout: 15_000 })

      // Held for the length of a hold and never paid for: it lapses by itself.
      await page.getByRole('button', { name: 'Reserve tickets', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Tickets held' })).toBeVisible()

      const summary = page.getByRole('region', { name: 'Order summary', exact: true })

      await summary.getByLabel('Promo code').fill(feature.gammaPromoCode)
      await summary.getByRole('button', { name: 'Apply', exact: true }).click()
      await expect(summary).toContainText(`${feature.gammaPromoCode} applied: 10% off.`)
      await expect(summary.getByTestId('summary-discount')).toBeVisible()
      await expect(
        page.getByRole('group', { name: 'Who is going?', exact: true }).getByRole('textbox'),
      ).toHaveCount(1)
    },
  },
  {
    name: 'the platform administrator’s door, filtered to one organisation',
    window: 'platform',
    path: () =>
      `/organizer/check-in?organizationId=${encodeURIComponent(feature.gammaOrganizationId)}`,
    heading: () => 'Check-in',
    title: () => 'Check-in',
    async arrived(page) {
      const filter = page.getByRole('search', { name: 'Find an event', exact: true })

      await expect(filter.getByLabel('Organisation', { exact: true })).toHaveValue(
        feature.gammaOrganizationId,
      )
      await expect(
        page.getByRole('status').filter({ hasText: 'Platform administrator authority' }),
      ).toBeVisible()
      await expect(
        page
          .getByLabel('Event you are admitting to')
          .locator('option', { hasText: feature.gammaGaEventTitle }),
      ).toHaveCount(1)
    },
  },
  {
    name: 'an order with its group pass shown',
    window: 'giver',
    path: () => `/account/orders/${encodeURIComponent(feature.groupOrderReference)}`,
    heading: () => feature.gammaGaEventTitle,
    title: () => 'Order',
    async arrived(page) {
      const section = page.getByRole('region', { name: 'Group pass (admits 3)', exact: true })

      await section.getByRole('button', { name: 'Show group pass', exact: true }).click()
      await expect(
        page.getByRole('img', { name: 'Group entry pass for 3 people, as a QR code' }),
      ).toBeVisible()
      await expect(section.getByRole('button', { name: 'Hide group pass' })).toBeFocused()

      // Read for the door case next, which types it.
      shownGroupCode = (await section.innerText()).match(/DEG-[2-9A-HJ-NP-Z]{12}/u)?.[0] ?? null
      expect(shownGroupCode, 'the order page shows no group code').not.toBeNull()
    },
  },
  {
    name: 'the door with a group pass looked up',
    window: 'platform',
    path: () =>
      `/organizer/check-in?organizationId=${encodeURIComponent(feature.gammaOrganizationId)}&q=${encodeURIComponent('Garba Nights')}`,
    heading: () => 'Check-in',
    title: () => 'Check-in',
    async arrived(page) {
      expect(shownGroupCode, 'the order case before this one showed no code').not.toBeNull()

      // The garba has two nights and the group's tickets are for the second:
      // the door says which night it is admitting to, and refuses a lookup
      // until it is told. Retried until the choice holds, because a choice
      // made before the page hydrates is undone by it.
      const night = page.getByLabel('Night you are admitting to')
      const nightValue = await night
        .locator('option', { hasText: /^Night 2 · /u })
        .getAttribute('value')

      await expect(async () => {
        await night.selectOption(nightValue)
        await expect(night).toHaveValue(nightValue, { timeout: 1_000 })
      }).toPass({ timeout: 15_000 })

      // Looked up, not admitted: the card is measured with every guest ticked.
      await page.getByLabel(/^Printed ticket code/u).fill(shownGroupCode)
      await page.getByRole('button', { name: 'Look up', exact: true }).click()

      const card = page
        .getByRole('region')
        .filter({ has: page.getByRole('heading', { name: 'Check the group, then admit' }) })

      await expect(card).toBeVisible()

      for (const guest of GROUP_GUESTS) {
        await expect(
          card.getByRole('checkbox', { name: new RegExp(`^${guest}`, 'u') }),
        ).toBeChecked()
      }

      await expect(card.getByRole('button', { name: 'Admit 3', exact: true })).toBeVisible()
    },
  },
  ...WEBSITE_LIST_STATES.map(({ state, label, title }) => ({
    name: `the website links, listing “${label}”`,
    window: 'platform',
    path: () =>
      `/moderation/websites?${new URLSearchParams({
        ...(state === 'waiting' ? {} : { state }),
        q: TAG,
      })}`,
    heading: () => 'Website links',
    title: () => 'Website links',
    async arrived(page) {
      await expect(
        page
          .getByRole('navigation', { name: 'Filter by state', exact: true })
          .getByRole('link', { name: label, exact: true }),
      ).toHaveAttribute('aria-current', 'page')

      // Measured with a row in it: an event of this run's in each list.
      const row = page
        .getByRole('main')
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { level: 2, name: title(), exact: true }) })

      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Address: https://')
    },
  })),
  {
    name: 'an event’s review page, with its website link on',
    window: 'platform',
    path: () => `/moderation/events/${encodeURIComponent(feature.gammaSeatedEventId)}`,
    heading: () => feature.gammaSeatedEventTitle,
    title: () => 'Review an event',
    async arrived(page) {
      const panel = page.getByRole('region', { name: 'Website link', exact: true })

      await expect(panel).toContainText(`Turned on by ${feature.linkAdminName}.`)
      await expect(
        panel.getByRole('button', { name: 'Turn the link off', exact: true }),
      ).toBeEnabled()
      await expect(panel.getByLabel(/^Reason/u)).toBeVisible()
    },
  },
  {
    name: 'an event’s review page, with an address waiting for the website link',
    window: 'platform',
    path: () => `/moderation/events/${encodeURIComponent(feature.gammaGaEventId)}`,
    heading: () => feature.gammaGaEventTitle,
    title: () => 'Review an event',
    async arrived(page) {
      const panel = page.getByRole('region', { name: 'Website link', exact: true })

      await expect(panel.getByText('Waiting since', { exact: true })).toBeVisible()
      await expect(
        panel.getByLabel('I have opened this address and it is the organiser’s own site.'),
      ).toBeVisible()
      await expect(
        panel.getByRole('button', { name: 'Turn the link on', exact: true }),
      ).toBeEnabled()
    },
  },
  {
    name: 'the editor’s guest information, with the website link on',
    window: 'gamma',
    path: () => `/organizer/events/${encodeURIComponent(feature.gammaSeatedEventId)}`,
    heading: () => feature.gammaSeatedEventTitle,
    title: () => 'Edit event',
    async arrived(page) {
      // The step buttons answer only once the editor has hydrated.
      await expect(
        page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
      ).toBeAttached()

      const step = page
        .getByRole('navigation', { name: 'Editor steps' })
        .getByRole('button', { name: /Guest information$/u })

      await step.click()
      await expect(step).toHaveAttribute('aria-current', 'step')
      await expect(page.getByRole('textbox', { name: 'Your website' })).toHaveValue(
        feature.gammaSeatedWebsiteUrl,
      )
      await expect(
        page.getByRole('group', { name: 'Website link on your event page', exact: true }),
      ).toContainText(`${feature.linkAdminName} of the team at The Desi Events turned it on`)
    },
  },
  {
    name: 'an event’s public page, with the organiser’s website link',
    window: 'visitor',
    path: () => `/events/${feature.gammaSeatedEventSlug}`,
    heading: () => feature.gammaSeatedEventTitle,
    title: () => feature.gammaSeatedEventTitle,
    async arrived(page) {
      await expect(
        page.getByRole('link', { name: 'Visit the organiser’s website', exact: true }),
      ).toHaveAttribute('href', `/events/${feature.gammaSeatedEventSlug}/website`)
      await expect(page.locator('#website-link-note')).toContainText(
        'The Desi Events counts the visit without recording your address, browser or account.',
      )
    },
  },
  {
    name: 'the website link’s page when the link is off',
    window: 'visitor',
    path: () => `/events/${feature.gammaGaEventSlug}/website`,
    heading: () => 'This website link is not available',
    title: () => 'Website link not available',
    async arrived(page) {
      // The page a navigation is shown is the one 404 every other case gets.
      const response = await page.request.get(`/events/${feature.gammaGaEventSlug}/website`, {
        maxRedirects: 0,
      })

      expect(response.status()).toBe(404)
      await expect(page.getByRole('link', { name: 'Back to the event' })).toBeVisible()
    },
  },
  {
    name: 'the website link’s page when the lookup cannot be made',
    window: 'limited',
    path: () => `/events/${feature.gammaSeatedEventSlug}/website`,
    heading: () => 'Website link unavailable',
    title: () => 'Website link unavailable',
    async arrived(page) {
      const response = await page.request.get(`/events/${feature.gammaSeatedEventSlug}/website`, {
        maxRedirects: 0,
        headers: { 'user-agent': LOOKUP_LIMITED_AGENT },
      })

      // Unavailable, and how long to wait passed on — never "too many".
      expect(response.status()).toBe(503)
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0)
      expect(response.headers().location).toBeUndefined()
      await expect(
        page.getByText(
          'The Desi Events could not look up where this link goes just now. Try again from the event page in a minute.',
          { exact: true },
        ),
      ).toBeVisible()
    },
  },
  {
    name: 'an event’s visits, as its organiser reads them',
    window: 'gamma',
    path: () =>
      `/analytics?${new URLSearchParams({
        organizationId: feature.gammaOrganizationId,
        eventId: feature.gammaGaEventId,
        range: '7',
      })}`,
    heading: () => `Analytics for ${feature.gammaGaEventTitle}`,
    title: () => 'Analytics',
    async arrived(page) {
      // Drawn from the visit the block counted, so the chart is measured
      // with bars in it, not as the sentence an empty period gets.
      await expect(
        page.getByRole('img', { name: 'Page views and visitors per day (UTC)', exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('table', { name: 'Visits per day (UTC)' })).toBeVisible()
      await expect(
        page.getByRole('table', { name: 'Where page views came from', exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/^Website link: Off\./u)).toBeVisible()
    },
  },
  {
    name: 'an organisation’s visits, with its events',
    window: 'gamma',
    path: () => `/analytics?organizationId=${encodeURIComponent(feature.gammaOrganizationId)}`,
    heading: () => 'Analytics',
    title: () => 'Analytics',
    async arrived(page) {
      await expect(
        page
          .getByRole('table', { name: 'Your events in this period', exact: true })
          .getByRole('link', { name: feature.gammaGaEventTitle, exact: true }),
      ).toBeVisible()
    },
  },
  {
    name: 'every event’s visits, as a platform administrator reads them',
    window: 'administrator',
    path: () => `/analytics/events?${new URLSearchParams({ range: '7', q: TAG })}`,
    heading: () => 'Every event’s visits',
    title: () => 'Every event’s visits',
    async arrived(page) {
      await expect(
        page
          .getByRole('table', { name: 'Events, newest start first', exact: true })
          .getByRole('link', { name: feature.gammaGaEventTitle, exact: true }),
      ).toBeVisible()
      await expect(
        page
          .getByRole('table', { name: 'Most visited in this period', exact: true })
          .getByRole('link', { name: feature.gammaGaEventTitle, exact: true }),
      ).toBeVisible()
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
    // Gamma, its nights and seats, the giver and taker and the waiting
    // organisation, under this file's own tag and never inside alpha: where
    // the sweep's cases for the feature-completion screens find their rows.
    feature = await seedFeatureWorld({ tag: TAG })
    // Every section an organiser can add to an event's page, on the public
    // event this file scans at each width, and one of each repeating row on
    // alpha's draft, so the editor's line-up and guest steps are measured
    // with rows in them. The refusals cleanup removes alpha's events with it.
    content = await seedEventContent(seeded.alphaEventId, TAG)
    draftContent = await seedEventContent(seeded.alphaDraftId, TAG, { rows: 'one' })
    // A postponed event, for the form that brings one back — under gamma, not
    // alpha: a postponed event is on its organisation's door list, and alpha's
    // door cases expect alpha's one event to be chosen for them. The feature
    // world's cleanup removes gamma's events with it.
    postponed = await seedPostponedEvent({ fromEventId: feature.gammaGaEventId, tag: TAG })
    // Empty until the reschedule cases ask for gamma's owner.
    gammaContext = await browser.newContext()

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
    await gammaContext?.close()
    // Before the refusals cleanup, which deletes the events these rows hang
    // from — and the feature world first, since the refusals cleanup finds
    // organisations by tag too.
    await cleanupFeatureWorld(TAG)
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

    test(`the editor's tickets, pictures, line-up and guest steps are clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
      // The step buttons answer only once the editor has hydrated.
      await expect(
        page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
      ).toBeAttached()

      const steps = page.getByRole('navigation', { name: 'Editor steps' })

      // Each measured as it first opens: nothing is typed into alpha's draft,
      // whose content later cases read. The draft carries one performer, one
      // slot and one question (`seedEventContent`), so the line-up and guest
      // steps are measured with their repeating rows drawn, not empty.
      for (const [step, heading, drawn] of [
        [/^Step 3\s*Sessions$/u, 'Sessions', null],
        [/^Step 4\s*Tickets$/u, 'Tickets', null],
        [/^Step 5\s*Policies and access$/u, 'Policies and access', null],
        [/^Step 6\s*Media$/u, 'Media', null],
        [
          /^Step 7\s*Line-up and running order$/u,
          'Line-up and running order',
          draftContent.performers[0].name,
        ],
        [/^Step 8\s*Guest information$/u, 'Guest information', draftContent.faq[0].question],
      ]) {
        const button = steps.getByRole('button', { name: step })

        await button.click()
        await expect(button).toHaveAttribute('aria-current', 'step')
        await expect(
          page.getByRole('heading', { level: 2, name: heading, exact: true }),
        ).toBeVisible()

        if (drawn) {
          // The seeded row is drawn, so what is measured holds one.
          await expect
            .poll(
              () =>
                page
                  .locator('main')
                  .evaluate(
                    (main, value) =>
                      [...main.querySelectorAll('input, textarea')].some(
                        (field) => field.value === value,
                      ),
                    drawn,
                  ),
              { message: `${heading} draws its seeded row` },
            )
            .toBe(true)
        }

        const violations = await scan(page)

        expect(
          violations,
          `${heading} at ${viewport.name}\n  ${describe(violations)}`,
        ).toHaveLength(0)
        expect(await sidewaysOverflow(page), `${heading} at ${viewport.name}`).toBeLessThanOrEqual(
          1,
        )
      }
    })

    test(`the change of date, place or terms on a live event is clean at ${viewport.name}`, async () => {
      const page = organiser

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/organizer/events/${seeded.alphaEventId}`)
      await expect(
        page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
      ).toBeAttached()

      const schedule = page
        .getByRole('navigation', { name: 'Editor steps' })
        .getByRole('button', { name: /^Step 2\s*When and where$/u })

      await schedule.click()
      await expect(schedule).toHaveAttribute('aria-current', 'step')
      await page.getByRole('button', { name: 'Change date, place or terms…', exact: true }).click()

      const panel = page.getByRole('region', { name: 'Change date, place or terms', exact: true })

      // Opened, measured and closed again: nothing is saved.
      await expect(panel.getByLabel(/^Why this is changing/u)).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

      await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(panel).toHaveCount(0)
    })

    test(`the form that brings a postponed event back is clean at ${viewport.name}`, async () => {
      const page = await gammaOwnerWindow()

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/organizer/events/${postponed.eventId}`)
      await expect(
        page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
      ).toBeAttached()

      const review = page
        .getByRole('navigation', { name: 'Editor steps' })
        .getByRole('button', { name: /^Step 9\s*Review$/u })

      await review.click()
      await expect(review).toHaveAttribute('aria-current', 'step')
      await page
        .getByRole('button', { name: 'Set a new date and bring it back', exact: true })
        .click()

      const form = page.getByRole('region', {
        name: 'Set a new date and bring it back',
        exact: true,
      })

      // Opened, measured and closed again: nothing is saved, and the event
      // stays postponed for the next width.
      await expect(form.getByLabel(/^New start/u)).toBeVisible()
      await expect(form.getByLabel(/^Session 1 starts/u)).toBeVisible()

      const violations = await scan(page)

      expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)

      await form.getByRole('button', { name: 'Not now', exact: true }).click()
      await expect(form).toHaveCount(0)
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

      // Every section an organiser can add is drawn (`seedEventContent`), so
      // the scan reads them all: the line-up with its bios, the running order,
      // the questions, the dress code, the way there, the contact, the links
      // and the sponsor.
      await expect(page.getByRole('heading', { level: 3, name: 'Line-up' })).toBeVisible()
      await expect(page.getByText(content.performers[0].bio)).toBeVisible()

      for (const section of [
        'Running order',
        'Dress code',
        'Getting there',
        'Questions people ask',
        'Contact the organiser',
        'Links',
        'Supported by',
      ]) {
        await expect(
          page.getByRole('heading', { level: 2, name: section, exact: true }),
          section,
        ).toBeVisible()
      }

      await expect(page.locator('main time').first()).toBeAttached()
      await expect(page.getByText(content.faq[0].question)).toBeVisible()

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

  test.describe("an event's pictures, swept", () => {
    test.beforeAll(async () => {
      // Written for this block and removed after it, as the Phase 4 block's
      // rows are: alpha's draft gets a cover and two gallery pictures waiting
      // for review, as an upload leaves them, and gamma's public event an
      // approved cover and gallery, as a moderator leaves them. The cases
      // before this block measured the Media step empty; the ones after it
      // meet no pictures. What an upload does to a picture on its way in is
      // `detail-event-media.spec.js`'s to prove.
      await removePictures(seeded.alphaDraftId)
      await removePictures(feature.gammaGaEventId)
      await seedPictures({
        eventId: seeded.alphaDraftId,
        status: 'PENDING',
        coverAlt: SWEEP_PICTURES.draftCover,
        galleryAlts: SWEEP_PICTURES.draftGallery,
      })
      await seedPictures({
        eventId: feature.gammaGaEventId,
        status: 'APPROVED',
        coverAlt: SWEEP_PICTURES.liveCover,
        galleryAlts: SWEEP_PICTURES.liveGallery,
      })
    })

    test.afterAll(async () => {
      await removePictures(seeded.alphaDraftId)
      await removePictures(feature.gammaGaEventId)
    })

    for (const viewport of VIEWPORTS) {
      test(`the Media step with a cover and a gallery is clean at ${viewport.name}`, async () => {
        const page = organiser

        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
        // The step buttons answer only once the editor has hydrated.
        await expect(
          page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
        ).toBeAttached()

        const media = page
          .getByRole('navigation', { name: 'Editor steps' })
          .getByRole('button', { name: /^Step 6\s*Media$/u })

        await media.click()
        await expect(media).toHaveAttribute('aria-current', 'step')

        // Measured with its pictures drawn, each with its controls: the state
        // an organiser works in once something is uploaded.
        const cover = page.getByRole('listitem', { name: 'The cover', exact: true })
        const last = page.getByRole('listitem', { name: 'Picture 2 of 2', exact: true })

        await expect(cover.getByRole('img', { name: SWEEP_PICTURES.draftCover })).toBeVisible()
        await expect(cover).toContainText('Waiting for review')
        await expect(last.getByRole('img')).toHaveAttribute('alt', SWEEP_PICTURES.draftGallery[1])

        const violations = await scan(page)

        expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
      })

      test(`the moderator's review of an event's pictures is clean at ${viewport.name}`, async () => {
        const page = await platformReader()

        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/moderation/events/${seeded.alphaDraftId}`)
        await expect(
          page.getByRole('heading', { level: 1, name: `Alpha's Draft ${TAG}`, exact: true }),
        ).toBeVisible()

        // Every picture, described in words beside the picture, with the one
        // decision it can take. Nothing is pressed.
        const cards = page.getByRole('listitem').filter({ has: page.getByRole('img') })

        await expect(cards).toHaveCount(3)

        for (const alt of [SWEEP_PICTURES.draftCover, ...SWEEP_PICTURES.draftGallery]) {
          const card = cards.filter({ hasText: alt })

          await expect(card.getByRole('img')).toHaveAttribute('alt', alt)
          await expect(
            card.getByRole('button', { name: 'Reject this picture', exact: true }),
          ).toBeVisible()
        }

        const violations = await scan(page)

        expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
      })

      test(`the public event page with a cover and a gallery is clean at ${viewport.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/events/${feature.gammaGaEventSlug}`)
        await expect(
          page.getByRole('heading', { level: 1, name: feature.gammaGaEventTitle, exact: true }),
        ).toBeVisible()

        // The cover in place of the poster, and the gallery under its heading.
        await expect(
          page.getByRole('img', { name: SWEEP_PICTURES.liveCover, exact: true }).first(),
        ).toBeVisible()

        const gallery = page.getByRole('region', { name: 'Pictures', exact: true })

        await expect(gallery.getByRole('img')).toHaveCount(SWEEP_PICTURES.liveGallery.length)

        const violations = await scan(page)

        expect(violations, `\n  ${describe(violations)}`).toHaveLength(0)
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1)
      })
    }
  })

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

  test('the colour register follows a soft navigation, both ways', async ({ browser }) => {
    // The root layout sets `data-register` from the request path and is not
    // rendered again on a client navigation, so a `<Link>` between a public
    // page and a signed-in area used to leave <body> in the register it was
    // loaded in. `components/register-sync.jsx` now moves it.
    const context = await browser.newContext()
    const page = await context.newPage()

    await signIn(page, seeded.betaOwnerEmail)
    // Signing in may finish with a full load of the account page; let it
    // land before counting loads, so only the two moves below are counted.
    await page.waitForLoadState('load')
    await expect(page.locator('body')).toHaveAttribute('data-register', 'courtyard')

    // Out: the brand link to the home page is a soft navigation.
    const loads = []
    page.on('load', () => loads.push(page.url()))
    await page
      .getByRole('banner')
      .getByRole('link', { name: 'The Desi Events', exact: true })
      .click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('body')).not.toHaveAttribute('data-register')

    // And back in, through the account menu's link to the wallet.
    await page.getByRole('button', { name: /, account$/ }).click()
    await page.getByRole('link', { name: 'My tickets', exact: true }).click()
    await expect(page).toHaveURL(/\/tickets$/)
    await expect(page.locator('body')).toHaveAttribute('data-register', 'courtyard')

    // Neither move was a full page load, or this would prove nothing.
    expect(loads).toEqual([])
    // And the ground really changed: the courtyard paints its own page colour.
    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.goBack()
    await expect(page.locator('body')).not.toHaveAttribute('data-register')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
      ground,
    )

    await context.close()
  })

  test('the editor can be reached and operated by keyboard alone', async () => {
    const page = organiser

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/organizer/events/${seeded.alphaDraftId}`)
    await expect(page.getByRole('navigation', { name: 'Editor steps' })).toBeVisible()
    // The steps open only once the editor has hydrated; Enter on one before
    // then reaches a button with no handler yet.
    await expect(
      page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
    ).toBeAttached()

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
      await expect(page.locator('main h1')).toBeVisible()

      // A focus ring removed without a replacement is the single most common way
      // a keyboard user is left unable to tell where they are. Walked by Tab,
      // as a keyboard user arrives, and judged by what focus adds: a border or
      // a resting shadow that was there anyway is not a ring (`focusStop`).
      const stops = await walkMain(page, 120)

      expect(stops.length, `${path}: Tab reached nothing in main`).toBeGreaterThan(0)
      expect(
        stops.filter((stop) => !stop.marked).map((stop) => stop.what),
        `${path}: stops that show no focus`,
      ).toEqual([])
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
    // one. A screenshot of a pass is a ticket, and Playwright takes one of
    // every open page when a test fails or times out. This file now turns
    // screenshots, traces and video off at its top level (its team-code and
    // group-pass cases need that), and the pass is still answered here, so
    // that this case is safe on its own terms too and never depends on the
    // file's settings to keep a real pass out of an artefact.
    //
    // So the pass request is answered here, before it can leave the browser,
    // with a value that is plainly not a credential. It has a real pass's
    // length and alphabet, so the drawing is the size a real one is. The real
    // round trip — drawn, decoded, scanned, admitted — is in
    // `detail-organizer-checkin.spec.js`.
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

        // One of alpha's own, so its promo codes screen has a row to reflow.
        const code = {
          organizationId: seeded.alphaOrganizationId,
          type: 'PERCENTAGE',
          value: 1_000,
          active: true,
        }

        await prisma.promoCode.upsert({
          where: {
            organizationId_code: {
              organizationId: seeded.alphaOrganizationId,
              code: SWEEP_PROMO_CODE,
            },
          },
          update: code,
          create: { code: SWEEP_PROMO_CODE, ...code },
        })

        // A website link decided and left off, on gamma's online event, so
        // the website links' "Off" list has a row. Written as the world
        // writes its links (in the application only `lib/website-redirect.js`
        // does); the address is the one decided on, so nothing waits. The
        // feature world's cleanup removes the event, and this with it.
        await prisma.event.update({
          where: { id: feature.gammaOnlineEventId },
          data: {
            websiteUrl: SWEEP_OFF_LINK.url,
            websiteDecidedUrl: SWEEP_OFF_LINK.url,
            websiteRedirectEnabled: false,
            websiteRedirectChangedAt: new Date(),
            websiteRedirectChangedById: feature.linkAdminId,
            websiteRedirectReason: SWEEP_OFF_LINK.reason,
          },
        })
      } finally {
        await prisma.$disconnect()
      }

      // A platform administrator, for the page that refuses one, and an
      // organiser invitation waiting, whose code nobody holds, for the list.
      await seedAdministrator(TAG)
      waitingInvitation = await seedWaitingInvitation({
        tag: TAG,
        invitedById: seeded.platformReaderId,
      })

      // Nobody signs in here, and nobody ever will: the public pages are what
      // a visitor sees, and sign-in and registration redirect anybody else.
      visitorContext = await browser.newContext()
      visitor = await visitorContext.newPage()
      // Empty until a case asks for the giver.
      giverContext = await browser.newContext()
      // Empty until a case asks for the unverified organisation's owner.
      unverifiedContext = await browser.newContext()
      // Empty until a case asks for the platform administrator.
      administratorContext = await browser.newContext()
      // Empty until the case that needs the lookup refused asks for it.
      lookupLimitedContext = await browser.newContext({ userAgent: LOOKUP_LIMITED_AGENT })

      // One counted visit to gamma's general-admission event, added up the
      // way the worker would, so its analytics are measured with a chart and
      // a day's row rather than the sentence an empty period gets. A browser
      // description of its own, so the visit is counted whatever the device
      // in the config says about being headless.
      const counted = await browser.newContext({ userAgent: VISITOR_AGENT(TAG) })

      try {
        const page = await counted.newPage()
        const view = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === '/api/v1/traffic/beacons' &&
            JSON.parse(request.postData() ?? '{}').kind === 'PAGE_VIEW',
        )

        await page.goto(`/events/${feature.gammaGaEventSlug}`)
        expect((await (await view).response())?.status()).toBe(202)
      } finally {
        await counted.close()
      }

      await rollUpTrafficNow()
    })

    test.afterAll(async () => {
      await visitorContext?.close()
      await giverContext?.close()
      await unverifiedContext?.close()
      await administratorContext?.close()
      await lookupLimitedContext?.close()

      // The organiser invitations the block seeded and issued, and the
      // administrator's sessions and factor.
      await cleanupOnboarding(TAG)

      const prisma = createPrismaClient({ connectionString: CONNECTION })

      // Nothing references these rows — the promo code was never used — so
      // every delete succeeds.
      try {
        await prisma.venue.deleteMany({ where: { slug: SWEEP_VENUE.slug } })
        await prisma.notificationOutbox.deleteMany({ where: { dedupeKey: OUTBOX_PROBE.dedupeKey } })
        await prisma.promoCode.deleteMany({
          where: { organizationId: seeded.alphaOrganizationId, code: SWEEP_PROMO_CODE },
        })
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

        await expect(page).toHaveTitle(`${surface.title()} · The Desi Events`)
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
      // `components/primary-nav.jsx`: below 1024 px the four discovery links
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
      // The brand link is the logo, named by its alternative text alone.
      const brand = banner.getByRole('link', { name: 'The Desi Events', exact: true })

      await expect(brand).toBeFocused()
      await expect(brand.getByRole('img', { name: 'The Desi Events', exact: true })).toHaveCount(1)
      // Then in the order the row is drawn at this width: the account control
      // sits between the logo and Menu, so focus reaches it before Menu
      // rather than jumping back up the row after the sheet (WCAG 2.4.3).
      // Signed out it is two links, "Sign in" and then "Sign up", both on
      // the logo's line at this width.
      await page.keyboard.press('Tab')
      await expect(banner.getByRole('link', { name: 'Sign in', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(banner.getByRole('link', { name: 'Sign up', exact: true })).toBeFocused()
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

      // The sheet is the last thing in the header, drawn last and reached
      // last: nothing in the row above it comes after it in the tab order.
      const afterSheet = await page.evaluate(
        (sheetId) => {
          const sheetNode = document.getElementById(sheetId)
          const header = sheetNode.closest('header')
          const focusable = [...header.querySelectorAll('a[href], button, [tabindex="0"]')]

          return focusable.filter(
            (node) =>
              sheetNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING &&
              !sheetNode.contains(node),
          ).length
        },
        await menu.getAttribute('aria-controls'),
      )

      expect(afterSheet, 'header controls after the open sheet').toBe(0)

      // Open, the sheet adds a column of links to the header; it must not
      // widen the page to do it.
      expect(await sidewaysOverflow(page), 'the open menu at 320 px').toBeLessThanOrEqual(1)

      await page.keyboard.press('Escape')

      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await expect(menu).toBeFocused()
      await expect(sheet).toHaveCount(0)
    })

    test('the footer’s Contact row, at phone and desktop widths, fits, scans clean, is big enough to hit and is walked by keyboard', async () => {
      // The footer is on every page; the limitations page asks nothing of the
      // API, so what is measured is the footer and nothing that might fail.
      // The Contact row is a row of its own, not a sixth column: the email
      // address is wider than a column of the wide grid, and a row wraps.
      const page = visitor

      for (const size of [VIEWPORTS[0], VIEWPORTS[2]]) {
        const where = `the footer’s Contact row at ${size.width} px`

        await page.setViewportSize({ width: size.width, height: size.height })
        await page.goto('/limitations')
        await expect(
          page.getByRole('heading', { level: 1, name: 'What this site does not do', exact: true }),
        ).toBeVisible()

        const footer = page.getByRole('contentinfo')
        const heading = footer.getByRole('heading', { level: 2, name: 'Contact', exact: true })
        const row = footer.getByRole('list', { name: 'Contact', exact: true })
        const links = row.getByRole('link')

        await expect(heading).toBeVisible()
        // Every channel, named for where it goes, and then the contact page.
        await expect(links).toHaveCount(COMPANY_CHANNELS.length + 1)
        for (const [index, channel] of COMPANY_CHANNELS.entries()) {
          await expect(links.nth(index)).toHaveAccessibleName(channel.footerName)
          await expect(links.nth(index)).toHaveAttribute('href', channel.href)
        }
        await expect(links.last()).toHaveAccessibleName('Contact page')
        await expect(links.last()).toHaveAttribute('href', '/contact')

        await row.scrollIntoViewIfNeeded()

        expect(await sidewaysOverflow(page), `${where} scrolls sideways`).toBeLessThanOrEqual(1)

        // Each link whole inside the window, its text not cut off, at least
        // 44 px tall as every footer link is, and none drawn over another.
        const boxes = await links.evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect()

            return {
              name: element.getAttribute('aria-label') ?? element.textContent.trim(),
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
              cut: element.scrollWidth > element.clientWidth + 1,
            }
          }),
        )

        for (const box of boxes) {
          expect(box.left, `${box.name} starts off the screen in ${where}`).toBeGreaterThanOrEqual(
            0,
          )
          expect(box.right, `${box.name} runs off the screen in ${where}`).toBeLessThanOrEqual(
            size.width,
          )
          expect(box.cut, `${box.name}’s text is cut off in ${where}`).toBe(false)
          expect(box.height, `${box.name} is too short to hit in ${where}`).toBeGreaterThanOrEqual(
            44,
          )
          expect(box.width, `${box.name} is too narrow to hit in ${where}`).toBeGreaterThanOrEqual(
            24,
          )
        }

        for (const [index, one] of boxes.entries()) {
          for (const other of boxes.slice(index + 1)) {
            const apart =
              one.right <= other.left ||
              other.right <= one.left ||
              one.bottom <= other.top ||
              other.bottom <= one.top

            expect(apart, `${one.name} and ${other.name} overlap in ${where}`).toBe(true)
          }
        }

        // The footer scanned on its own, so a fault in it is named as the
        // footer's (the whole page is scanned with the contact page above).
        const violations = await scan(page, 'footer')

        expect(
          violations,
          `the footer at ${size.width} px\n  ${describe(violations)}`,
        ).toHaveLength(0)

        // By keyboard, from the row's heading: each link in turn, in the
        // order it is drawn, each showing where the focus is.
        await heading.evaluate((element) => {
          if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
          element.focus()
        })

        for (const [index, box] of boxes.entries()) {
          await page.keyboard.press('Tab')
          await expect(links.nth(index)).toBeFocused()

          const stop = await focusStop(page, 'footer')

          expect(stop.marked, `${box.name} shows no focus in ${where}`).toBe(true)
        }

        await heading.evaluate((element) => element.removeAttribute('tabindex'))
      }

      await page.setViewportSize({ width: 1280, height: 900 })
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

    test('with motion reduced, a seat changes at once, and nothing on the seat picker moves for longer than 0.01 ms', async () => {
      // Every seat carries a colour transition (`components/seat-picker.jsx`).
      // It is measured first with no preference, so the check below cannot pass
      // on a picker that simply has no transitions; then with motion reduced,
      // where the shared stylesheet cuts every transition and animation to
      // 0.01 ms. A seat is chosen in between, so a change of state is what is
      // measured, not only a page at rest.
      const path = `/events/${feature.gammaSeatedEventSlug}/seats/${feature.gammaSeatedSessionIds[1]}`
      const page = await visitorContext.newPage()

      /**
       * The longest transition and animation on each seat and on everything
       * else in the main region, in milliseconds, and any animation running
       * longer than the limit.
       *
       * @param {number} limit The most a reduced-motion reader may be shown, in ms.
       * @returns {Promise<{seats: number, seatTransition: number, slow: string[], running: string[]}>} What was found.
       */
      const measure = (limit) =>
        page.evaluate((most) => {
          // "1e-05s", "120ms" or a comma-separated list of either, in ms.
          const toMs = (value) =>
            Math.max(
              0,
              ...value.split(',').map((part) => {
                const trimmed = part.trim()
                const number = Number.parseFloat(trimmed)

                return trimmed.endsWith('ms') ? number : number * 1000
              }),
            )
          const tooLong = (ms) => ms - most > 1e-6
          const seats = [...document.querySelectorAll('main [role="grid"] button')]
          const slow = []

          for (const element of document.querySelectorAll('main, main *')) {
            const style = getComputedStyle(element)
            const transition = toMs(style.transitionDuration)
            const animation = style.animationName === 'none' ? 0 : toMs(style.animationDuration)

            if (tooLong(transition) || tooLong(animation)) {
              slow.push(
                `${element.tagName.toLowerCase()} ${element.getAttribute('aria-label') ?? ''}: transition ${style.transitionDuration}, animation ${style.animationName} ${style.animationDuration}`.trim(),
              )
            }
          }

          const running = document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                tooLong(animation.effect?.getComputedTiming().endTime ?? 0),
            )
            .map(
              (animation) =>
                `${animation.constructor.name} on ${animation.effect?.target?.tagName}`,
            )

          return {
            seats: seats.length,
            seatTransition: Math.max(
              0,
              ...seats.map((seat) => toMs(getComputedStyle(seat).transitionDuration)),
            ),
            slow,
            running,
          }
        }, limit)

      try {
        await page.setViewportSize({ width: 390, height: 844 })

        // Not vacuous: without the preference, a seat does transition.
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.goto(path)
        await expect(page.getByRole('grid', { name: 'Balcony', exact: true })).toBeVisible()

        const moving = await measure(0.01)

        expect(moving.seats, 'the picker has seats to measure').toBeGreaterThan(0)
        expect(
          moving.seatTransition,
          'a seat transitions when motion is not reduced',
        ).toBeGreaterThan(0.01)

        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(path)

        const grid = page.getByRole('grid', { name: 'Balcony', exact: true })
        const seat = grid.getByRole('button', { name: /^Seat B1, /u })

        await expect(grid).toBeVisible()
        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        ).toBe(true)
        // Hydrated before a seat is pressed.
        await expect(
          page.getByRole('link', { name: 'Sign in to reserve', exact: true }),
        ).toBeVisible()

        await expect(async () => {
          if ((await seat.getAttribute('aria-pressed')) !== 'true') await seat.click()
          await expect(seat).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 })
        }).toPass({ timeout: 15_000 })

        const still = await measure(0.01)

        expect(still.seats).toBe(moving.seats)
        expect(still.slow, 'transitions or animations longer than 0.01 ms').toEqual([])
        expect(still.running, 'animations still running under reduced motion').toEqual([])

        // And back: the choice is the page's alone, nothing was held.
        await seat.click()
        await expect(seat).toHaveAttribute('aria-pressed', 'false')
      } finally {
        await page.close()
      }
    })

    test('the seat grid is reached and worked by keyboard alone, and says what changed', async () => {
      const page = visitor

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(
        `/events/${feature.gammaSeatedEventSlug}/seats/${feature.gammaSeatedSessionIds[1]}`,
      )

      const grid = page.getByRole('grid', { name: 'Balcony', exact: true })
      const seat = (label) =>
        grid.getByRole('button', { name: new RegExp(`^Seat ${label}, `, 'u') })

      await expect(grid).toBeVisible()
      // The grid answers only once it has hydrated.
      await expect(
        page.getByRole('link', { name: 'Sign in to reserve', exact: true }),
      ).toBeVisible()

      // One tab stop for the whole grid: Tab lands on its first seat.
      let onSeat = false

      for (let press = 0; press < 60 && !onSeat; press += 1) {
        await page.keyboard.press('Tab')
        onSeat = await page.evaluate(() =>
          /^Seat [A-Z]\d+, /u.test(document.activeElement?.getAttribute('aria-label') ?? ''),
        )
      }

      expect(onSeat, 'Tab never reached the seat grid').toBe(true)
      await expect(seat('A1')).toBeFocused()

      // Where the focus is, is drawn: a ring, not the browser's default alone.
      const ring = await seat('A1').evaluate((node) => getComputedStyle(node).boxShadow)

      expect(ring, 'the focused seat draws no ring').not.toBe('none')

      await page.keyboard.press('ArrowRight')
      await expect(seat('A2')).toBeFocused()
      await page.keyboard.press('End')
      await expect(seat('A6')).toBeFocused()
      await page.keyboard.press('PageDown')
      await expect(seat('B6')).toBeFocused()
      await page.keyboard.press('Space')
      await expect(seat('B6')).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page
          .getByRole('region', { name: 'Your selection', exact: true })
          .getByRole('status')
          .first(),
      ).toHaveText('Seat B6 added. 1 seat selected.')
      await page.keyboard.press('Space')
      await expect(seat('B6')).toHaveAttribute('aria-pressed', 'false')

      // Tab leaves the grid in one press, rather than walking every seat: to
      // the next section's grid, which is one stop too, and past it.
      const boxes = page.getByRole('grid', { name: 'Boxes', exact: true })

      await page.keyboard.press('Tab')
      await expect(grid.locator(':focus')).toHaveCount(0)
      await expect(boxes.getByRole('button', { name: /^Seat K1, /u })).toBeFocused()
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() =>
          /^Seat [A-Z]\d+, /u.test(document.activeElement?.getAttribute('aria-label') ?? ''),
        ),
        'Tab walked into another seat instead of leaving the grid',
      ).toBe(false)
    })

    test('the door’s filter is worked by keyboard alone', async () => {
      const page = await platformReader()

      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/organizer/check-in')

      const filter = page.getByRole('search', { name: 'Find an event', exact: true })
      const organisation = filter.getByLabel('Organisation', { exact: true })

      await expect(organisation).toBeVisible()

      await organisation.focus()
      await page.keyboard.type(`Gamma Collective ${TAG}`)
      await expect(organisation).toHaveValue(feature.gammaOrganizationId)
      await page.keyboard.press('Tab')
      await expect(filter.getByLabel('Event or organisation name')).toBeFocused()
      // Two words: a single word would be shaped like a referral code, which
      // this file never types key by key (e2e-code-hygiene).
      await page.keyboard.type('Balcony Concert')
      await page.keyboard.press('Tab')
      await expect(filter.getByRole('button', { name: 'Show events', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')

      await page.waitForURL(
        (url) =>
          url.searchParams.get('organizationId') === feature.gammaOrganizationId &&
          url.searchParams.get('q') === 'Balcony Concert',
      )
      await expect(
        page
          .getByRole('region', { name: 'Event', exact: true })
          .getByText(feature.gammaSeatedEventTitle, { exact: true }),
      ).toBeVisible()
    })

    test('the group pass is shown and hidden by keyboard alone, with focus kept on its controls', async () => {
      const page = await giverWindow()

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/account/orders/${encodeURIComponent(feature.groupOrderReference)}`)

      const section = page.getByRole('region', { name: 'Group pass (admits 3)', exact: true })
      const show = section.getByRole('button', { name: 'Show group pass', exact: true })

      await expect(show).toBeVisible()
      await show.focus()
      await page.keyboard.press('Enter')

      const hide = section.getByRole('button', { name: 'Hide group pass', exact: true })

      await expect(hide).toBeFocused()
      await expect(page.getByRole('img', { name: /group entry pass/iu })).toBeVisible()
      await page.keyboard.press('Enter')

      await expect(show).toBeFocused()
      await expect(page.getByRole('img', { name: /group entry pass/iu })).toHaveCount(0)
    })

    test('the feature-completion screens are walked by keyboard, every stop showing where the focus is', async () => {
      // Tab from the top of each page through everything in its main region,
      // as somebody without a mouse does. Every stop must draw a ring or an
      // outline that focus put there — one the control draws anyway, like the
      // resting shadow on every field and button or a border, says nothing
      // about focus (`focusStop`) — and each page must have stops to walk: a
      // page whose controls Tab cannot reach would pass the first rule with
      // nothing to check.
      //
      // A date-and-time field is one control with several stops inside it —
      // each part of the date, then its calendar button — and every one of
      // them is judged: on the later ones the field draws its ring through
      // `:focus-within`, which is exactly where it once drew none.
      const screens = [
        ['organiser', '/account/organizations/new'],
        ['organiser', '/organizer/organization'],
        ['organiser', '/account/invitations'],
        ['organiser', '/organizer/team'],
        [
          'organiser',
          `/organizer/promo-codes?organizationId=${encodeURIComponent(seeded.alphaOrganizationId)}`,
        ],
        ['platform', '/moderation/organizations'],
        [
          'platform',
          `/moderation/organizations/${encodeURIComponent(feature.pendingOrganizationId)}`,
        ],
        ['platform', '/admin/users'],
        // The filters, the name search, the invite form and each waiting
        // row's two actions.
        ['platform', '/admin/organizer-invitations'],
        [
          'platform',
          `/organizer/check-in?organizationId=${encodeURIComponent(feature.gammaOrganizationId)}`,
        ],
        [
          'visitor',
          `/events/${feature.gammaSeatedEventSlug}/seats/${feature.gammaSeatedSessionIds[0]}`,
        ],
      ]

      for (const [kind, path] of screens) {
        const page = await windowFor(kind)

        await page.setViewportSize({ width: 1280, height: 900 })
        await page.goto(path)
        await expect(page.locator('main h1')).toBeVisible()

        // The rings are the stylesheet's and the order is the document's, so
        // the server's markup is what is walked; nothing waits on a script.
        const stops = await walkMain(page)

        expect(stops.length, `${path}: Tab reached nothing in main`).toBeGreaterThan(0)
        expect(
          stops.filter((stop) => !stop.marked).map((stop) => stop.what),
          `${path}: stops that show no focus`,
        ).toEqual([])
      }
    })

    test('the editor’s ticket form is clean with its reserved-seating block open', async ({
      browser,
    }) => {
      // Gamma's balcony concert: its nights sit on a published seat plan, so
      // the reserved-seating choice is live there (alpha's draft has no such
      // night, which is why the per-viewport editor cases cannot open it).
      // Opened and measured; nothing is added.
      const context = await browser.newContext()

      try {
        const page = await context.newPage()

        await signInWaitingOutTheLimiter(page, feature.gammaOwnerEmail)

        for (const viewport of VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await page.goto(`/organizer/events/${feature.gammaSeatedEventId}`)
          await expect(
            page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
          ).toBeAttached()

          const step = page
            .getByRole('navigation', { name: 'Editor steps' })
            .getByRole('button', { name: /^Step 4\s*Tickets$/u })

          await step.click()
          await expect(step).toHaveAttribute('aria-current', 'step')

          const add = page
            .locator('div')
            .filter({ has: page.getByRole('heading', { name: 'Add a ticket type', exact: true }) })
            .last()

          await add.getByLabel(/^Reserved seating/u).check()
          await expect(add.getByLabel(/^Which session/u)).toBeVisible()
          await expect(add.getByLabel(/^Price zone/u)).toBeVisible()

          const violations = await scan(page)

          expect(violations, `at ${viewport.name}\n  ${describe(violations)}`).toHaveLength(0)
          expect(await sidewaysOverflow(page), `at ${viewport.name}`).toBeLessThanOrEqual(1)
        }
      } finally {
        await context.close()
      }
    })
  })
})

/**
 * Full control of posted events (SPEC2-XI area X), swept: every dialog and
 * page it adds, in the state that makes it more than markup, at every width
 * and at 200% zoom, scanned clean, and walked by keyboard.
 *
 * Its own world (`support/seed-full-control.mjs`, `{ sweep: true }`): two
 * organisations with their events, a deleted one, one in every deletion
 * outcome, paid orders written the way settlement writes them, two change
 * notices on an order, and a new cover and a gallery picture waiting for the
 * team at The Desi Events. Nothing here is deleted, cancelled or restored: each
 * dialog is opened, read and measured, and closed again. The one write is
 * the sitting the platform administrator opens, to measure the editor's
 * banner; it changes no privilege and is the seed's own event's.
 */
/**
 * Measure the page as it stands at every size: no sideways scroll, and a
 * clean scan at the scanned widths.
 *
 * @param {object} page The page, in the state being measured.
 * @param {string} where What it is, for the messages.
 * @returns {Promise<void>} Resolves once measured.
 */
async function measuredEverywhere(page, where) {
  for (const size of PHASE_4_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })

    expect(
      await sidewaysOverflow(page),
      `${where} scrolls sideways at ${size.label}`,
    ).toBeLessThanOrEqual(1)

    if (SCANNED_WIDTHS.has(size.width)) {
      const violations = await scan(page)

      expect(violations, `${where} at ${size.label}\n  ${describe(violations)}`).toHaveLength(0)
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 })
}

/**
 * Walk a region by keyboard from its heading: every stop inside it shows
 * where the focus is, and Tab leaves it only after its last control.
 *
 * @param {object} page The page.
 * @param {object} region The region's locator, open.
 * @param {string} where What it is, for the messages.
 * @returns {Promise<string[]>} What each stop was, in order.
 */
async function walkedByKeyboard(page, region, where) {
  // From its heading, as a keyboard user arrives: a dialog moves focus
  // there itself; a form's heading is made a starting point here.
  await region.evaluate((element) => {
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6')

    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus()
  })

  const stops = []

  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab')

    const inside = await region.evaluate((element) => element.contains(document.activeElement))

    if (!inside) break

    const stop = await focusStop(page)

    stops.push(stop)
  }

  expect(stops.length, `${where}: Tab reached nothing inside it`).toBeGreaterThan(0)
  expect(
    stops.filter((stop) => !stop.marked).map((stop) => stop.what),
    `${where}: stops that show no focus`,
  ).toEqual([])

  return stops.map((stop) => stop.what)
}

test.describe.serial('full control of posted events, swept', () => {
  /** The seeded ids. @type {object} */
  let control
  /** Each signed-in window, opened the first time a case asks. */
  const controlWindows = {}
  /** Every context this block opened. @type {object[]} */
  const controlContexts = []

  /**
   * This run's full-control names.
   *
   * @returns {object} The names.
   */
  const controlNames = () => fullControlNames(TAG)

  /**
   * A window signed in as one of the block's accounts, opened once.
   *
   * @param {object} browser The browser under test.
   * @param {'owner'|'admin'|'buyer'} who Which account.
   * @returns {Promise<object>} A signed-in page.
   */
  function controlWindow(browser, who) {
    controlWindows[who] ??= (async () => {
      const context = await browser.newContext()
      const page = await context.newPage()

      controlContexts.push(context)
      await signInWaitingOutTheLimiter(page, controlNames()[`${who}Email`])

      return page
    })()

    return controlWindows[who]
  }

  /**
   * Open an event's editor on one step, at the narrowest width.
   *
   * @param {object} page The editor's page.
   * @param {string} eventId Which event.
   * @param {RegExp} step The step button's name.
   * @param {string} [base] `/organizer/events` or `/admin/events`.
   * @returns {Promise<void>} Resolves once the step is open.
   */
  async function editorStep(page, eventId, step, base = '/organizer/events') {
    await page.setViewportSize(DOOR_WIDTHS[0])
    await page.goto(`${base}/${eventId}`)
    await expect(
      page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
    ).toBeAttached()

    const button = page
      .getByRole('navigation', { name: 'Editor steps' })
      .getByRole('button', { name: step })

    await button.click()
    await expect(button).toHaveAttribute('aria-current', 'step')
  }

  /**
   * Open the delete dialog on an editor's Review step, preview read.
   *
   * @param {object} page The organiser's page.
   * @param {object} event The event's ids.
   * @returns {Promise<object>} The dialog's region.
   */
  async function deleteDialogOn(page, event) {
    await editorStep(page, event.id, /review/iu)
    await page.getByRole('button', { name: 'Delete this event…', exact: true }).click()

    const dialog = page.getByRole('region', { name: `Delete “${event.title}”` })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)
    // Focus is on its heading, so a keyboard user starts there.
    await expect(dialog.getByRole('heading', { level: 3 })).toBeFocused()

    return dialog
  }

  test.beforeAll(async () => {
    control = await seedFullControl(TAG, { sweep: true })
  })

  test.afterAll(async () => {
    for (const context of controlContexts) await context.close().catch(() => {})

    await cleanupFullControl(TAG)
  })

  test('the delete dialog for an event nobody bought reflows, scans clean and is walked by keyboard', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')
    const dialog = await deleteDialogOn(owner, control.events.unsoldLive)

    await expect(dialog).toContainText('Nobody has bought a ticket to this event.')
    await expect(
      dialog.getByRole('button', { name: 'Delete this event', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(owner, 'the delete dialog (nothing sold)')
    await walkedByKeyboard(owner, dialog, 'the delete dialog (nothing sold)')
  })

  test('the delete dialog for a sold event, with a mistyped address, reflows and scans clean', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')
    const event = control.events.soldToDelete
    const dialog = await deleteDialogOn(owner, event)

    await expect(dialog).toContainText(
      'Deleting this event cancels it, refunds what is left of each of the 2 paid orders',
    )

    // The summary of what to fix, linked to each box, is measured too.
    await dialog.getByLabel(/^Type the event’s web address/u).fill(`${event.slug}-not`)
    await dialog.getByRole('button', { name: 'Cancel, refund and delete', exact: true }).click()
    await expect(
      dialog.getByRole('link', {
        name: 'That is not this event’s web address. Type it exactly as shown.',
      }),
    ).toBeVisible()

    await measuredEverywhere(owner, 'the delete dialog (sold, with its error summary)')
    await walkedByKeyboard(owner, dialog, 'the delete dialog (sold)')
  })

  test('the delete dialog for an event that has taken place reflows and scans clean', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')
    const dialog = await deleteDialogOn(owner, control.sweep.completed)

    await expect(dialog).toContainText(
      'This event has taken place. Deleting it takes its page and listing off the site. The 1 order and their tickets stay as they are and nobody is refunded.',
    )

    await measuredEverywhere(owner, 'the delete dialog (taken place)')
    await walkedByKeyboard(owner, dialog, 'the delete dialog (taken place)')
  })

  test('the delete dialog asks whether a finished event took place in a radio group worked by keyboard', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')
    const dialog = await deleteDialogOn(owner, control.sweep.finished)
    const group = dialog.getByRole('group', {
      name: 'Nobody was checked in through The Desi Events, so say what happened:',
    })
    const tookPlace = group.getByRole('radio', {
      name: 'It took place: take its page down and refund nobody',
    })
    const didNot = group.getByRole('radio', {
      name: 'It did not take place: cancel it and refund every order',
    })

    await expect(group.getByRole('radio')).toHaveCount(2)

    // Reached by Tab, moved by the arrow keys, and the sentences and the
    // button follow the choice.
    const stops = await walkedByKeyboard(owner, dialog, 'the delete dialog (choice)')

    expect(
      stops.some((stop) => stop.includes('type="radio"')),
      'Tab reached the choice',
    ).toBe(true)

    await tookPlace.focus()
    await owner.keyboard.press('Space')
    await expect(tookPlace).toBeChecked()
    await expect(dialog).toContainText('This event has taken place.')
    await expect(
      dialog.getByRole('button', { name: 'Delete this event', exact: true }),
    ).toBeVisible()

    await owner.keyboard.press('ArrowDown')
    await expect(didNot).toBeChecked()
    await expect(didNot).toBeFocused()
    await expect(dialog).toContainText('Deleting this event cancels it, refunds what is left')
    await expect(
      dialog.getByRole('button', { name: 'Cancel, refund and delete', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(owner, 'the delete dialog (choice)')
  })

  test('the delete dialog’s refusal, while a night runs, reflows and scans clean', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')
    const dialog = await deleteDialogOn(owner, control.sweep.inProgress)

    await expect(dialog.getByText('This event cannot be deleted now')).toBeVisible()
    await expect(dialog).toContainText('A night of this event has started or is about to.')
    await expect(dialog.getByRole('button', { name: /delete/iu })).toHaveCount(0)

    await measuredEverywhere(owner, 'the delete dialog (refused)')
    await walkedByKeyboard(owner, dialog, 'the delete dialog (refused)')
  })

  test('the cancel-night dialog reflows, scans clean and is walked by keyboard', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')

    await editorStep(owner, control.events.multiNight.id, /^step 3/iu)

    const night = owner
      .getByRole('region', { name: 'Sessions', exact: true })
      .getByRole('listitem')
      .filter({ has: owner.getByRole('heading', { name: /^Night 2\b/u }) })

    await night.getByRole('button', { name: 'Cancel this night…' }).click()

    const dialog = owner.getByRole('region', { name: /^Cancel the night of /u })

    await expect(dialog.getByLabel(/^Why is this night being cancelled\?/u)).toBeVisible()
    await expect(dialog).toContainText('1 paid order for this night is refunded')
    await expect(dialog.getByRole('heading', { level: 4 })).toBeFocused()

    await measuredEverywhere(owner, 'the cancel-night dialog')
    await walkedByKeyboard(owner, dialog, 'the cancel-night dialog')
  })

  test('a deleted event’s record reflows and scans clean', async ({ browser }) => {
    const owner = await controlWindow(browser, 'owner')

    await owner.setViewportSize(DOOR_WIDTHS[0])
    await owner.goto(`/organizer/events/${control.events.deletedRestore.id}`)
    await expect(owner.getByRole('heading', { name: 'This event was deleted' })).toBeVisible()
    await expect(owner.locator('main')).toContainText(
      'Only the team at The Desi Events can restore a deleted event.',
    )

    await measuredEverywhere(owner, 'the deleted event’s record')
  })

  test('the live editor with a change to the date waiting for a reason reflows and scans clean', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')

    await editorStep(owner, control.events.liveSold.id, /^step 2/iu)

    const starts = owner.getByRole('region', { name: 'When and where' }).getByLabel(/^Starts/u)
    const before = await starts.inputValue()
    const [day, clock] = before.split('T')

    await starts.fill(
      `${day}T${String(Number(clock.slice(0, 2)) - 1).padStart(2, '0')}${clock.slice(2)}`,
    )

    const callout = owner.getByRole('region', {
      name: 'Not saved: a change to the date, place or terms',
    })

    await expect(callout).toContainText('You changed the start time.')
    await measuredEverywhere(owner, 'the live editor with the callout')

    await callout.getByRole('button', { name: 'Confirm these changes…' }).click()

    const panel = owner.getByRole('region', {
      name: 'Confirm the change to the date, place or terms',
    })

    await expect(panel).toContainText(/The start time: .+ → .+/u)
    await measuredEverywhere(owner, 'the live editor with the change to confirm')
  })

  test('the ticket form with the re-price sentence reflows and scans clean', async ({
    browser,
  }) => {
    const owner = await controlWindow(browser, 'owner')

    await editorStep(owner, control.events.liveSold.id, /^step 4/iu)

    const tier = owner
      .getByRole('region', { name: 'Tickets', exact: true })
      .getByRole('listitem')
      .filter({ hasText: /^General admission/u })

    await tier.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(tier).toContainText(
      'People who already bought keep what they paid: 2 sold at $35.00. A new price applies to the next buyer.',
    )
    await expect(tier.getByLabel(/^Face value/u)).toBeEnabled()

    await measuredEverywhere(owner, 'the ticket form with the re-price sentence')
  })

  test('an order page with change notices reflows and scans clean', async ({ browser }) => {
    const buyer = await controlWindow(browser, 'buyer')

    await buyer.setViewportSize(DOOR_WIDTHS[0])
    await buyer.goto(`/account/orders/${control.sweep.orders.liveSold.reference}`)

    const changes = buyer.getByRole('region', { name: 'Changes since you bought' })

    await expect(changes).toContainText('The event changed')
    await expect(changes).toContainText('A night changed')
    await expect(changes).toContainText('Changed by the team at The Desi Events.')

    await measuredEverywhere(buyer, 'the order page with change notices')
  })

  test('All events, for the team at The Desi Events, reflows and scans clean', async ({
    browser,
  }) => {
    const admin = await controlWindow(browser, 'admin')

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/events?q=${encodeURIComponent(`Control`)}`)
    await expect(admin.getByRole('heading', { level: 1, name: 'All events' })).toBeVisible()
    await expect(
      admin
        .getByRole('row')
        .filter({ hasText: control.events.otherLive.title })
        .getByRole('link', { name: /^Open in the editor/u }),
    ).toBeVisible()

    await measuredEverywhere(admin, 'All events')
  })

  test('Pictures waiting, with a new cover beside the current one, reflows and scans clean', async ({
    browser,
  }) => {
    const admin = await controlWindow(browser, 'admin')

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto('/moderation/pictures')
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Pictures waiting for a decision' }),
    ).toBeVisible()
    await expect(admin.getByText('Replaces the current cover').first()).toBeVisible()

    await measuredEverywhere(admin, 'Pictures waiting')
  })

  test('the restore dialog reflows, scans clean and is walked by keyboard', async ({ browser }) => {
    const admin = await controlWindow(browser, 'admin')
    const event = control.events.deletedRestore

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/events/${event.id}`)
    await admin.getByRole('button', { name: 'Restore…', exact: true }).click()

    const dialog = admin.getByRole('region', { name: `Restore “${event.title}”` })

    await expect(dialog).toContainText('It comes back paused: the organiser reopens sales.')
    await expect(dialog.getByRole('heading', { level: 3 })).toBeFocused()

    await measuredEverywhere(admin, 'the restore dialog')
    await walkedByKeyboard(admin, dialog, 'the restore dialog')
  })

  test('the form that opens a sitting reflows and scans clean', async ({ browser }) => {
    const admin = await controlWindow(browser, 'admin')

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/events/${control.events.otherLive.id}`)

    const form = admin.getByRole('region', {
      name: 'Edit this event as the team at The Desi Events',
      exact: true,
    })

    await expect(form.getByLabel(/^Why are you editing this event\?/u)).toBeVisible()

    await measuredEverywhere(admin, 'the form that opens a sitting')
    await walkedByKeyboard(admin, form, 'the form that opens a sitting')
  })

  test('the editor under a sitting, with its banner, reflows and scans clean', async ({
    browser,
  }) => {
    const admin = await controlWindow(browser, 'admin')
    const event = control.events.otherLive

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/events/${event.id}`)

    const form = admin.getByRole('region', {
      name: 'Edit this event as the team at The Desi Events',
      exact: true,
    })

    await form
      .getByLabel(/^Why are you editing this event\?/u)
      .fill('Measuring the editor the team at The Desi Events edits in.')

    const opened = admin.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/platform/events/${event.id}/edit` &&
        response.ok(),
      { timeout: 45_000 },
    )

    await form.getByRole('button', { name: 'Open for editing', exact: true }).click()

    const first = await Promise.race([
      opened.then(() => 'opened'),
      stepUpPrompt(admin)
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => 'prompted'),
    ])

    if (first === 'prompted') await confirmStepUp(admin)

    await opened
    await expect(admin.getByText('Editing as the team at The Desi Events').first()).toBeVisible()
    await expect(admin.getByRole('button', { name: 'Stop editing', exact: true })).toBeVisible()

    await measuredEverywhere(admin, 'the editor under a sitting')

    // Closed again, so nothing is left open on the event.
    await admin.getByRole('button', { name: 'Stop editing', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events$/u)
  })
})

test.describe.serial('imported events, swept', () => {
  /** What the block's setup imported, approved and planned. */
  const imported = {}
  /** Every context this block opened. @type {object[]} */
  const importContexts = []
  /** The administrator's window, opened once. @type {Promise<object>|null} */
  let importAdminWindow = null
  /** Whether "The Desi Events" (the platform-held organisation) was there before this block imported anything. */
  let importHeldBefore = true

  /**
   * This run's import names.
   *
   * @returns {object} The names.
   */
  const names = () => importNames(TAG)

  /**
   * The platform administrator who imports, signed in once.
   *
   * @param {object} browser The browser under test.
   * @returns {Promise<object>} A signed-in page.
   */
  function importAdmin(browser) {
    importAdminWindow ??= (async () => {
      const context = await browser.newContext()
      const page = await context.newPage()

      importContexts.push(context)
      await signInWaitingOutTheLimiter(page, names().adminEmail)

      return page
    })()

    return importAdminWindow
  }

  /**
   * Send one request to the API from the page, through the web's proxy with
   * its session and CSRF token, confirming a second factor through the API
   * and sending it once more when one is asked for.
   *
   * @param {object} page The administrator's page.
   * @param {string} method The HTTP method.
   * @param {string} path The API path.
   * @param {object} [body] The JSON body.
   * @returns {Promise<{status: number, data: object|null, text: string}>} The answer.
   */
  async function importApi(page, method, path, body) {
    const send = (verb, address, sent) =>
      page.evaluate(
        async ({ verb: how, address: where, sent: payload }) => {
          const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
          const response = await fetch(where, {
            method: how,
            headers: {
              'content-type': 'application/json',
              ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
            },
            body: payload === undefined ? undefined : JSON.stringify(payload),
          })
          const text = await response.text()
          let parsed = null

          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }

          return {
            status: response.status,
            code: parsed?.error?.code ?? null,
            data: parsed?.data ?? null,
            text,
          }
        },
        { verb, address, sent },
      )

    const first = await send(method, path, body)

    if (first.code !== 'STEP_UP_REQUIRED') return first

    await forgetCodeUse()

    const confirmed = await send('POST', '/api/v1/auth/step-up', {
      password: PASSWORD,
      code: currentCode(),
    })

    expect(confirmed.status, confirmed.text).toBe(200)

    return send(method, path, body)
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)

    // Whatever a stopped attempt left under this tag goes first.
    await cleanupImport(TAG)

    importHeldBefore = await platformHeldExists()
    await seedImport(TAG)

    // Imported, applied and one event approved, through the same requests the
    // run page sends, so every state the cases measure is a real one: a run
    // applied with events waiting for review, a published import on sale
    // here, and a plan nobody has applied. Nothing is copied from anywhere:
    // an import contacts no other site.
    const admin = await importAdmin(browser)

    await admin.goto('/admin/imports')

    const dataset = buildImportDataset(TAG)
    const planned = await importApi(admin, 'POST', '/api/v1/platform/imports', {
      fileName: names().fileName,
      dataset,
    })

    expect(planned.status, planned.text).toBe(201)

    const applied = await importApi(
      admin,
      'POST',
      `/api/v1/platform/imports/${planned.data.id}/apply`,
      { planDigest: planned.data.planDigest, updateFromSource: [] },
    )

    expect(applied.status, applied.text).toBe(200)

    const garba = applied.data.rows.find(
      (row) => row.sourceId === names().listings.garba.sourceId,
    ).event
    const approved = await importApi(
      admin,
      'POST',
      `/api/v1/platform/imports/${planned.data.id}/approve`,
      { items: [{ eventId: garba.id, revision: garba.revision }] },
    )

    expect(approved.status, approved.text).toBe(200)
    expect(approved.data.results[0].outcome).toBe('PUBLISHED')

    const plan = await importApi(admin, 'POST', '/api/v1/platform/imports', {
      fileName: names().updateFileName,
      dataset: planOnlyDataset(TAG),
    })

    expect(plan.status, plan.text).toBe(201)

    Object.assign(imported, {
      appliedRunId: planned.data.id,
      planRunId: plan.data.id,
      published: { id: garba.id, slug: garba.slug, title: garba.title },
    })
  })

  test.afterAll(async () => {
    for (const context of importContexts) await context.close().catch(() => {})

    await cleanupImport(TAG, { removePlatformHeld: !importHeldBefore })
  })

  test('Imports, with its runs and the upload form’s error summary, reflows, scans clean and is walked by keyboard', async ({
    browser,
  }) => {
    const admin = await importAdmin(browser)

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto('/admin/imports')
    await expect(admin.getByRole('heading', { level: 1, name: 'Imports' })).toBeVisible()
    await expect(admin.getByRole('table', { name: 'Imports, newest first' })).toContainText(
      names().fileName,
    )

    await measuredEverywhere(admin, 'Imports')

    // A file that is not JSON: refused in the browser, with a summary linked
    // to the field. Pressed once React holds the form, or the browser would
    // send the form to its own address instead.
    const form = admin.getByRole('form', { name: 'Plan an import', exact: true })
    const field = form.getByLabel(/^Listing file/u)

    await expect
      .poll(() =>
        field.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))),
      )
      .toBe(true)
    await field.setInputFiles({
      name: 'listings.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "format": ', 'utf8'),
    })
    await form.getByRole('button', { name: 'Plan this import', exact: true }).click()
    await expect(form.getByRole('link', { name: /^This file is not valid JSON/u })).toBeVisible()

    await measuredEverywhere(admin, 'Imports, with the upload refused')
    await walkedByKeyboard(
      admin,
      admin.getByRole('region', { name: 'Plan an import' }),
      'the upload form',
    )
  })

  test('a plan nobody has applied reflows, scans clean and is walked by keyboard', async ({
    browser,
  }) => {
    const admin = await importAdmin(browser)
    const { planOnly } = names().listings

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/imports/${imported.planRunId}`)
    await expect(admin.getByText('Planned, not applied').first()).toBeVisible()

    const table = admin.getByRole('table', { name: /^The plan for /u })

    await expect(table.getByRole('row').filter({ hasText: planOnly.title })).toContainText(
      'A personal phone number was removed from the description.',
    )
    await expect(
      admin.getByRole('button', { name: 'Import this 1 event', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(admin, 'the plan')
    await walkedByKeyboard(admin, admin.locator('main'), 'the plan')
  })

  test('an applied run, with events to approve and their ticket types, reflows and scans clean', async ({
    browser,
  }) => {
    const admin = await importAdmin(browser)
    const { concert, garba } = names().listings

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/imports/${imported.appliedRunId}`)

    const table = admin.getByRole('table', { name: /^The plan for /u })
    const concertRow = table.getByRole('row').filter({ hasText: concert.title })

    await expect(concertRow).toContainText('No price listed, so no ticket type')
    await expect(table.getByRole('row').filter({ hasText: garba.title })).toContainText(
      /\d of 4 ticket types on sale/u,
    )
    await expect(table.getByRole('columnheader', { name: 'Pictures' })).toHaveCount(0)

    const tick = admin.getByRole('checkbox', { name: `Approve “${concert.title}”` })

    await expect
      .poll(() =>
        tick.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))),
      )
      .toBe(true)
    await tick.check()
    await expect(
      admin.getByRole('button', { name: 'Approve and publish 1 event', exact: true }),
    ).toBeEnabled()
    await expect(admin.getByRole('button', { name: /retry pictures/iu })).toHaveCount(0)

    await measuredEverywhere(admin, 'the applied run')
    await walkedByKeyboard(admin, admin.locator('main'), 'the applied run')
  })

  test('the dialog that moves an imported event, with its search and its error summary, reflows, scans clean and is walked by keyboard', async ({
    browser,
  }) => {
    const admin = await importAdmin(browser)
    const event = imported.published

    await admin.setViewportSize(DOOR_WIDTHS[0])
    await admin.goto(`/admin/events/${event.id}`)

    const section = admin.getByRole('region', { name: 'Imported from a listing', exact: true })
    const opener = section.getByRole('button', { name: 'Move to an organisation…', exact: true })

    await expect
      .poll(() =>
        opener.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))),
      )
      .toBe(true)
    await opener.click()

    const heading = admin.getByRole('heading', { name: `Move “${event.title}” to an organisation` })

    await expect(heading).toBeFocused()
    await expect(section).toContainText(
      'The organisation is not asked before the event moves. Agree it with them first.',
    )

    const dialog = section.getByRole('form', { name: 'Move this event', exact: true })

    await dialog.getByRole('searchbox', { name: /^Find the organisation/u }).fill(names().gammaName)
    await dialog.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(
      dialog.getByRole('radio', { name: `${names().gammaName} (${names().gammaSlug})` }),
    ).toBeVisible()

    // Pressed with nothing chosen: the summary links each problem to its field.
    await dialog.getByRole('button', { name: 'Move the event', exact: true }).click()
    await expect(
      dialog.getByRole('link', { name: 'Choose the organisation to move it to.' }),
    ).toBeVisible()

    await measuredEverywhere(admin, 'the move dialog')
    await walkedByKeyboard(admin, section, 'the move dialog')
  })

  test('an imported event’s page and its card reflow and scan clean', async ({ browser }) => {
    const context = await browser.newContext()
    const visitor = await context.newPage()
    const event = imported.published

    importContexts.push(context)
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: event.title })).toBeVisible()

    const tickets = visitor.locator('#tickets')
    const reserve = tickets.getByRole('link', {
      name: 'Reserve on WhatsApp, opens WhatsApp in a new tab',
      exact: true,
    })

    // Sold here, through the checkout, beside the company's WhatsApp chat.
    await expect(tickets.getByRole('link', { name: /choose tickets/iu })).toBeVisible()
    await expect(reserve).toBeVisible()
    await expect(reserve).toHaveAttribute('href', /^https:\/\/wa\.me\/19726949043\?text=/u)
    await expect(reserve).toHaveAccessibleDescription(
      'Opens a WhatsApp chat with the team at The Desi Events, with a message about this event ready for you to send.',
    )
    await expect(visitor.getByRole('link', { name: 'Buy tickets', exact: true })).toHaveCount(0)
    expect(await visitor.content()).not.toMatch(/sulekha/iu)

    await measuredEverywhere(visitor, 'the imported event’s page')

    await visitor.goto(`/events?q=${encodeURIComponent(event.title)}`)

    const card = visitor
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('link', { name: event.title, exact: true }) })

    await expect(card).toContainText(names().listings.garba.presentedBy)
    await expect(card).not.toContainText(/sulekha|No price listed/iu)

    await measuredEverywhere(visitor, 'the imported event’s card')
  })
})

/**
 * Booking fees, referral codes and paying at the venue (SPEC3 §14.7,
 * SPEC3-XI §14.7), swept.
 *
 * The block seeds its own organisation, people and events
 * (`seed-venue-payments.mjs`) and builds every state it measures through the
 * requests the screens send: paying at the venue switched on for the
 * general-admission event and off again for the Toronto one, two referral
 * codes made by the administrator, bookings paid at the venue, one ticket
 * cancelled unpaid, one paid at the door and one passed on, and a finished
 * night called off and refunded. Each screen is then measured at every size
 * and scanned. A referral code is only ever read from the API's answer and
 * typed from a variable; nothing here writes one down.
 */
test.describe.serial('booking fees, referral codes and paying at the venue, swept', () => {
  // Each case measures several screens at every size.
  test.describe.configure({ timeout: 300_000 })

  /** What the block's setup made. */
  const venue = {}
  /** Each signed-in window, opened once. */
  const venueWindows = {}
  /** Every context this block opened. @type {object[]} */
  const venueContexts = []

  /**
   * This run's names.
   *
   * @returns {object} The names.
   */
  const venueNames = () => venuePaymentNames(TAG)

  /** Which account each window signs in as. */
  const VENUE_EMAILS = Object.freeze({
    admin: 'adminEmail',
    owner: 'ownerEmail',
    scanner: 'scannerEmail',
    buyer1: 'buyer1Email',
    buyer2: 'buyer2Email',
    buyer3: 'buyer3Email',
  })

  /**
   * A window signed in as one of the block's accounts, opened once.
   *
   * @param {object} browser The browser under test.
   * @param {string} who A key of `VENUE_EMAILS`.
   * @returns {Promise<object>} A signed-in page.
   */
  function venueWindow(browser, who) {
    venueWindows[who] ??= (async () => {
      const context = await browser.newContext()
      const page = await context.newPage()

      venueContexts.push(context)
      await signInWaitingOutTheLimiter(page, venueNames()[VENUE_EMAILS[who]])

      return page
    })()

    return venueWindows[who]
  }

  /**
   * Send one request to the API from the page, through the web's proxy with
   * its session and CSRF token, confirming a second factor through the API
   * and sending it once more when one is asked for.
   *
   * @param {object} page The signed-in page.
   * @param {string} method The HTTP method.
   * @param {string} path The API path, starting `/api/v1/`.
   * @param {object} [body] The JSON body.
   * @param {Record<string, string>} [headers] Extra request headers.
   * @returns {Promise<{status: number, code: string|null, data: object|null, text: string}>} The answer.
   */
  async function venueApi(page, method, path, body, headers = {}) {
    const send = (verb, address, sent) =>
      page.evaluate(
        async ({ verb: how, address: where, sent: payload, extra }) => {
          const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
          const response = await fetch(where, {
            method: how,
            headers: {
              'content-type': 'application/json',
              ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
              ...extra,
            },
            body: payload === undefined ? undefined : JSON.stringify(payload),
          })
          const text = await response.text()
          let parsed = null

          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }

          return {
            status: response.status,
            code: parsed?.error?.code ?? null,
            data: parsed?.data ?? null,
            text,
          }
        },
        { verb, address, sent, extra: headers },
      )

    const first = await send(method, path, body)

    if (first.code !== 'STEP_UP_REQUIRED') return first

    await forgetCodeUse()

    const confirmed = await send('POST', '/api/v1/auth/step-up', {
      password: PASSWORD,
      code: currentCode(),
    })

    expect(confirmed.status, confirmed.text).toBe(200)

    return send(method, path, body)
  }

  /**
   * Book tickets paid at the venue the way the checkout does: hold them,
   * price the basket, and place the order with the quoted figures.
   *
   * @param {object} page The buyer's page, signed in.
   * @param {object} options What to book.
   * @param {object} options.event The event, as seeded.
   * @param {number} options.quantity How many of its first tier.
   * @param {string} options.buyer Which buyer (`buyer1`…).
   * @param {string} [options.withCode] A referral code to apply, as read from the API.
   * @returns {Promise<string>} The order's reference.
   */
  async function bookAtVenue(page, { event, quantity, buyer, withCode }) {
    const items = [{ ticketTypeId: event.tiers[0], quantity }]
    const hold = await venueApi(page, 'POST', '/api/v1/holds', items[0])

    expect(hold.status, hold.text).toBe(201)

    const priced = {
      eventId: event.id,
      items,
      holdIds: [hold.data.id],
      paymentMethod: 'AT_VENUE',
      ...(withCode ? { referralCode: withCode } : {}),
    }
    const quote = await venueApi(page, 'POST', '/api/v1/orders/quote', priced)

    expect(quote.status, quote.text).toBe(200)

    const order = await venueApi(
      page,
      'POST',
      '/api/v1/orders',
      {
        ...priced,
        buyerEmail: venueNames()[`${buyer}Email`],
        buyerName: venueNames()[`${buyer}Name`],
        expectedTotalCents: quote.data.totalCents,
        expectedVenueDueCents: quote.data.venueDueCents,
      },
      { 'idempotency-key': `sweep-venue-${TAG}-${buyer}-${event.id}-${Date.now()}` },
    )

    expect(order.status, order.text).toBe(201)

    return order.data.reference
  }

  /**
   * Press a control whose request may be refused for a second factor, and
   * answer the prompt if it comes.
   *
   * @param {object} page The page.
   * @param {Function} press Presses the control.
   * @param {object} done A locator that shows once the request succeeded.
   * @returns {Promise<void>} Resolves once done shows.
   */
  async function pressAnswering(page, press, done) {
    await press()

    const first = await Promise.race([
      done.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'done'),
      stepUpPrompt(page)
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => 'prompted'),
    ])

    if (first === 'prompted') await confirmStepUp(page)
    await expect(done).toBeVisible()
  }

  /**
   * Open the door on one event.
   *
   * @param {object} page The steward's page.
   * @param {string} title The event's title.
   * @returns {Promise<void>} Resolves once the door is open.
   */
  async function openVenueDoor(page, title) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/organizer/check-in')
    await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()

    const choose = page.getByLabel('Event you are admitting to')
    const value = await choose.locator('option', { hasText: title }).getAttribute('value')

    await expect(async () => {
      await choose.selectOption(value)
      await expect(page.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
        timeout: 1_000,
      })
    }).toPass({ timeout: 15_000 })
  }

  /**
   * Type a printed ticket or group code at the door and look it up.
   *
   * @param {object} page The steward's page.
   * @param {string} printed The printed code.
   * @returns {Promise<void>} Resolves once sent.
   */
  async function lookUp(page, printed) {
    await page.getByLabel(/^Printed ticket code/u).fill(printed)
    await page.getByRole('button', { name: 'Look up', exact: true }).click()
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(360_000)

    const seeded = await seedVenuePayments(TAG)
    const { ga, twoNights, toronto, pastNight } = seeded.events

    Object.assign(venue, { seeded })

    // The administrator switches paying at the venue on for the
    // general-admission event, and off again for the Toronto one, so both a
    // live switch and a history are there to read.
    const admin = await venueWindow(browser, 'admin')

    await admin.goto('/admin/referral-codes')

    const switchedOn = await venueApi(
      admin,
      'POST',
      `/api/v1/platform/events/${ga.id}/venue-payment`,
      {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
        reason: 'Agreed with the organiser for the sweep.',
      },
    )

    expect(switchedOn.status, switchedOn.text).toBe(200)

    const switchedOff = await venueApi(
      admin,
      'POST',
      `/api/v1/platform/events/${toronto.id}/venue-payment`,
      {
        enabled: false,
        seen: { enabled: true, limit: 50 },
        reason: 'The organiser asked for card payments only.',
      },
    )

    expect(switchedOff.status, switchedOff.text).toBe(200)

    // Two codes: one for the general-admission event, one for the two-night
    // event only (refused at the general-admission checkout).
    const forGa = await venueApi(admin, 'POST', '/api/v1/platform/referral-codes', {
      generate: true,
      scope: 'SELECTED_EVENTS',
      eventIds: [ga.id],
      maxUses: 3,
    })

    expect(forGa.status, forGa.text).toBe(201)

    const forOther = await venueApi(admin, 'POST', '/api/v1/platform/referral-codes', {
      generate: true,
      scope: 'SELECTED_EVENTS',
      eventIds: [twoNights.id],
    })

    expect(forOther.status, forOther.text).toBe(201)

    const gaCode = forGa.data.referralCode
    const otherCode = forOther.data.referralCode

    // buyer2 books one ticket with the code, and the team at The Desi Events cancels
    // it unpaid: a cancellation block, a cancelled wallet ticket, a door
    // refusal and a use given back.
    const buyer2 = await venueWindow(browser, 'buyer2')

    await buyer2.goto('/tickets')
    const b2Ga = await bookAtVenue(buyer2, {
      event: ga,
      quantity: 1,
      buyer: 'buyer2',
      withCode: gaCode,
    })

    const [cancelled] = await ticketsOf(b2Ga)
    const cancel = await venueApi(admin, 'POST', `/api/v1/orders/${b2Ga}/venue-cancellations`, {
      ticketIds: [cancelled.id],
      reason: 'Not paid for, and the hall needs the place.',
    })

    expect(cancel.status, cancel.text).toBe(200)

    // buyer3 books two: one is paid at the door and the other passed on, by
    // the cases below.
    const buyer3 = await venueWindow(browser, 'buyer3')

    await buyer3.goto('/tickets')
    const b3Ga = await bookAtVenue(buyer3, { event: ga, quantity: 2, buyer: 'buyer3' })

    // buyer2 books the past night and pays at the door during it, and the
    // organiser then calls it off: a delete dialog that says who holds that
    // money, and (once the refund is sent, below) an order refunded with
    // money paid at the door.
    const b2Past = await bookAtVenue(buyer2, { event: pastNight, quantity: 1, buyer: 'buyer2' })

    const { paidCents } = await finishPastNight(TAG, b2Past)

    expect(paidCents).toBe(2_500)

    const owner = await venueWindow(browser, 'owner')

    await owner.goto('/organizer/events')

    const calledOff = await venueApi(owner, 'POST', `/api/v1/events/${pastNight.id}/cancel`, {
      reasonCode: 'VENUE_UNAVAILABLE',
      reason: 'The hall cannot open, so the night is called off.',
    })

    expect(calledOff.status, calledOff.text).toBe(200)

    Object.assign(venue, {
      gaCode,
      otherCode,
      b2Ga,
      b3Ga,
      b2Past,
      cancelledCode: cancelled.code,
    })
  })

  test.afterAll(async () => {
    for (const context of venueContexts) await context.close().catch(() => {})

    await cleanupVenuePayments(TAG)
  })

  test('the referral codes list, with rows and filtered to nothing, and a code with a use given back', async ({
    browser,
  }) => {
    const admin = await venueWindow(browser, 'admin')

    await admin.goto('/admin/referral-codes')
    await expect(admin.getByRole('heading', { level: 1, name: 'Referral codes' })).toBeVisible()

    const row = admin.getByRole('row').filter({ hasText: venue.gaCode })

    await expect(row).toContainText('1 placed, 1 given back')

    await measuredEverywhere(admin, 'the referral codes list')

    // Expired codes for the Toronto event: this block makes none, so the list
    // is empty and says so, in the filtered list's own sentence.
    await admin.goto(
      `/admin/referral-codes?status=EXPIRED&eventId=${encodeURIComponent(venue.seeded.events.toronto.id)}`,
    )
    await expect(admin.getByRole('heading', { level: 1, name: 'Referral codes' })).toBeVisible()
    await expect(admin.getByRole('row').filter({ hasText: venue.gaCode })).toHaveCount(0)
    await expect(admin.getByText('No referral code matches these filters.')).toBeVisible()
    await expect(admin.getByRole('table', { name: 'Referral codes', exact: true })).toHaveCount(0)

    await measuredEverywhere(admin, 'the referral codes list, filtered to nothing')

    await admin.goto('/admin/referral-codes')
    await row.getByRole('link', { name: /^Open/u }).click()
    await expect(admin.locator('main')).toContainText('Unpaid tickets cancelled')

    await measuredEverywhere(admin, 'a referral code with a use given back')
  })

  test('making a referral code, generated or typed, for chosen events, with its error summary', async ({
    browser,
  }) => {
    const admin = await venueWindow(browser, 'admin')
    const { ga } = venue.seeded.events

    await admin.goto('/admin/referral-codes/new')
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Make a referral code' }),
    ).toBeVisible()

    await measuredEverywhere(admin, 'the new referral code form, generated')

    const typed = admin.getByRole('radio', { name: 'I’ll type one', exact: true })
    const chosen = admin.getByRole('radio', { name: 'Chosen events', exact: true })

    await expect(async () => {
      await typed.check()
      await chosen.check()
      await expect(typed).toBeChecked({ timeout: 1_000 })
      await expect(chosen).toBeChecked({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    await admin.getByLabel(/^Find an event/u).fill(ga.title)
    await admin.getByRole('button', { name: 'Search events', exact: true }).click()
    await admin.getByRole('button', { name: `Add ${ga.title}`, exact: true }).click()
    await expect(admin.getByRole('list', { name: 'Chosen events' })).toContainText(ga.title)

    await measuredEverywhere(admin, 'the new referral code form, typed, with a chosen event')

    // Nothing typed into the code: refused in the browser, with a summary.
    await admin.getByRole('button', { name: 'Make referral code', exact: true }).click()
    await expect(admin.getByText('Check these and try again')).toBeVisible()

    await measuredEverywhere(admin, 'the new referral code form, with its error summary')
  })

  test('an event’s booking fee and payment section, switched on, switched off with its history, and on a draft; and All events', async ({
    browser,
  }) => {
    const admin = await venueWindow(browser, 'admin')
    const { ga, toronto, draft } = venue.seeded.events

    for (const [event, where] of [
      [ga, 'the payment section, paying at the venue on'],
      [toronto, 'the payment section, switched off, with its history'],
      [draft, 'the payment section on a draft'],
    ]) {
      await admin.goto(`/admin/events/${event.id}`)
      await expect(
        admin.getByRole('region', { name: 'Booking fee and payment', exact: true }),
      ).toBeVisible()

      await measuredEverywhere(admin, where)
    }

    await admin.goto('/admin/events')
    await expect(admin.getByRole('heading', { level: 1, name: 'All events' })).toBeVisible()

    await measuredEverywhere(admin, 'All events')
  })

  test('booking fee refunds, with an order found', async ({ browser }) => {
    const admin = await venueWindow(browser, 'admin')

    await admin.goto('/admin/fee-refunds')
    await confirmIfAsked(admin)
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Booking fee refunds' }),
    ).toBeVisible()

    const field = admin.getByLabel('Order reference', { exact: true })

    await expect(async () => {
      await field.fill(venue.b3Ga)
      await expect(field).toHaveValue(venue.b3Ga, { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    await pressAnswering(
      admin,
      () => admin.getByRole('button', { name: 'Find order', exact: true }).click(),
      admin.getByRole('heading', { level: 2, name: `Order ${venue.b3Ga}` }),
    )

    await measuredEverywhere(admin, 'booking fee refunds, with an order found')
  })

  test('the organiser’s event page, with its booking fee and payment summary', async ({
    browser,
  }) => {
    const owner = await venueWindow(browser, 'owner')
    const { ga } = venue.seeded.events

    await owner.goto(`/organizer/events/${ga.id}`)
    await expect(
      owner.getByRole('region', { name: 'Booking fee and payment', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(owner, 'the organiser’s event page, with its payment summary')
  })

  test('the checkout paying by card and at the venue, a booked panel, and a referral code refused', async ({
    browser,
  }) => {
    const buyer1 = await venueWindow(browser, 'buyer1')
    const { ga } = venue.seeded.events
    const summary = buyer1.getByRole('region', { name: 'Order summary' })

    /**
     * Wait for the checkout's next quote.
     *
     * @returns {Promise<object>} Its response.
     */
    const quoted = () =>
      buyer1.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/orders/quote',
        { timeout: 30_000 },
      )

    /**
     * Open the checkout and hold some general-admission tickets.
     *
     * @param {number} count How many.
     * @returns {Promise<void>} Resolves once held and priced.
     */
    async function hold(count) {
      await buyer1.setViewportSize({ width: 1280, height: 900 })
      await buyer1.goto(`/events/${ga.slug}/checkout`)
      await expect(
        buyer1.getByRole('heading', { level: 1, name: `Tickets for ${ga.title}` }),
      ).toBeVisible()

      const quantity = buyer1.getByLabel('Quantity of General admission', { exact: true })
      const add = buyer1.getByRole('button', { name: 'Add one General admission', exact: true })

      for (let wanted = 1; wanted <= count; wanted += 1) {
        await expect(async () => {
          if (Number(await quantity.inputValue()) < wanted) await add.click()

          await expect(quantity).toHaveValue(String(wanted), { timeout: 1_000 })
        }).toPass({ timeout: 15_000 })
      }

      const priced = quoted()

      await buyer1.getByRole('button', { name: 'Reserve tickets', exact: true }).click()
      await expect(buyer1.getByRole('status').filter({ hasText: 'Tickets held' })).toBeVisible()
      expect((await priced).ok()).toBe(true)
    }

    await hold(2)
    await expect(summary).toBeVisible()

    await measuredEverywhere(buyer1, 'the checkout, paying by card')

    const venuePriced = quoted()

    await buyer1.setViewportSize({ width: 1280, height: 900 })
    await buyer1.getByRole('radio', { name: 'Pay at the venue', exact: true }).check()
    expect((await venuePriced).ok()).toBe(true)
    await expect(
      buyer1.getByRole('button', { name: 'Pay booking fee $6.70 (simulated)', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(buyer1, 'the checkout, paying at the venue')

    await buyer1.setViewportSize({ width: 1280, height: 900 })
    await buyer1
      .getByRole('button', { name: 'Pay booking fee $6.70 (simulated)', exact: true })
      .click()

    const booked = buyer1.getByRole('status').filter({
      has: buyer1.getByRole('heading', { name: 'Booked — pay at the door', exact: true }),
    })

    await expect(booked).toBeVisible({ timeout: 30_000 })
    const b1Ga = (await booked.innerText()).match(/Order\s+([A-Z0-9-]{4,32})/u)?.[1] ?? null

    expect(b1Ga, 'the booked panel names no order').not.toBeNull()
    Object.assign(venue, { b1Ga })

    await measuredEverywhere(buyer1, 'the booked panel, paying at the door')

    // A code for another event, refused in the one sentence every refusal shares.
    await hold(1)

    const refused = quoted()

    await summary.getByLabel(/^Referral code \(optional\)/u).fill(venue.otherCode)
    await summary.getByRole('button', { name: 'Apply referral code' }).click()
    await refused
    await expect(summary).toContainText('This referral code can’t be used for this booking.')

    await measuredEverywhere(buyer1, 'the checkout, with a referral code refused')
  })

  test('the checkout in Ontario, with its sales tax, and the public event page’s note on paying at the venue', async ({
    browser,
  }) => {
    const buyer3 = await venueWindow(browser, 'buyer3')
    const { ga, toronto } = venue.seeded.events

    await buyer3.setViewportSize({ width: 1280, height: 900 })
    await buyer3.goto(`/events/${toronto.slug}/checkout`)
    await expect(
      buyer3.getByRole('heading', { level: 1, name: `Tickets for ${toronto.title}` }),
    ).toBeVisible()

    const quantity = buyer3.getByLabel('Quantity of General admission', { exact: true })

    await expect(async () => {
      if (Number(await quantity.inputValue()) < 1) {
        await buyer3.getByRole('button', { name: 'Add one General admission', exact: true }).click()
      }

      await expect(quantity).toHaveValue('1', { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await buyer3.getByRole('button', { name: 'Reserve tickets', exact: true }).click()
    await expect(buyer3.getByRole('region', { name: 'Order summary' })).toContainText('HST')

    await measuredEverywhere(buyer3, 'the checkout in Ontario')

    await buyer3.goto(`/events/${ga.slug}`)
    await expect(buyer3.getByRole('heading', { level: 1, name: ga.title })).toBeVisible()
    await expect(buyer3.locator('main')).toContainText(/pay at the venue|paid at the venue/iu)

    await measuredEverywhere(buyer3, 'the public event page, with its note on paying at the venue')
  })

  test('the door taking a payment for one ticket and for a group, a payment with no answer, and a ticket cancelled unpaid', async ({
    browser,
  }) => {
    const scanner = await venueWindow(browser, 'scanner')
    const { ga } = venue.seeded.events
    const main = scanner.locator('main')
    const [first] = await ticketsOf(venue.b1Ga)

    await openVenueDoor(scanner, ga.title)
    await lookUp(scanner, first.code)
    await expect(scanner.getByRole('heading', { name: 'Payment to take' }).first()).toBeVisible()
    await expect(main).toContainText('Take $40.00 for this ticket before letting them in.')

    await measuredEverywhere(scanner, 'the door, one ticket owing its price')

    // The confirmation never reaches the server: the steward is told to keep
    // the money in hand and retry, and nothing was recorded.
    await scanner.route('**/api/v1/tickets/check-in', (route) => route.abort('failed'))
    await scanner
      .getByRole('button', { name: 'Payment taken: $40.00 — admit', exact: true })
      .click()
    await expect(main).toContainText(
      'No answer from the server. The payment may or may not have been recorded',
    )

    await measuredEverywhere(scanner, 'the door, a payment with no answer')
    await scanner.unroute('**/api/v1/tickets/check-in')

    // buyer1's group pass, read from the order page that shows it on request.
    const buyer1 = await venueWindow(browser, 'buyer1')

    await buyer1.setViewportSize({ width: 1280, height: 900 })
    await buyer1.goto(`/account/orders/${venue.b1Ga}#group-pass`)

    const section = buyer1.getByRole('region', { name: /^Group pass \(admits 2\)$/u })

    const show = section.getByRole('button', { name: 'Show group pass' })
    const hide = section.getByRole('button', { name: 'Hide group pass' })

    // Pressed until it answers: a press before hydration does nothing.
    await expect(async () => {
      if (await show.isVisible()) await show.click()
      await expect(hide).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    const groupCode = (await section.innerText()).match(/DEG-[2-9A-HJ-NP-Z]{12}/u)?.[0] ?? null

    expect(groupCode, 'the group pass shows no printed code').not.toBeNull()
    await hide.click()

    await openVenueDoor(scanner, ga.title)
    await lookUp(scanner, groupCode)
    await expect(main).toContainText('Payment to take for the ticked tickets: $80.00')

    await measuredEverywhere(scanner, 'the door, a group pass owing its price')

    await openVenueDoor(scanner, ga.title)
    await lookUp(scanner, venue.cancelledCode)
    await expect(scanner.getByRole('heading', { name: 'Cancelled — not paid' })).toBeVisible()

    await measuredEverywhere(scanner, 'the door, a ticket cancelled unpaid')

    // buyer3's first ticket is paid for at the door, for the cases below.
    const [paid] = await ticketsOf(venue.b3Ga)

    await openVenueDoor(scanner, ga.title)
    await lookUp(scanner, paid.code)
    await scanner
      .getByRole('button', { name: 'Payment taken: $40.00 — admit', exact: true })
      .click()
    await expect(main).toContainText('Admitted. Payment recorded: $40.00.')
  })

  test('passing on a ticket that owes its price, and the page that accepts it', async ({
    browser,
  }) => {
    const buyer3 = await venueWindow(browser, 'buyer3')
    const second = (await ticketsOf(venue.b3Ga)).find((ticket) => ticket.checkedInAt === null)

    await buyer3.setViewportSize({ width: 1280, height: 900 })
    await buyer3.goto(`/tickets/${second.id}`)
    await buyer3.getByRole('button', { name: 'Offer this ticket to somebody', exact: true }).click()
    await expect(buyer3.locator('main')).toContainText(
      'This ticket’s price, $40.00, is paid at the door.',
    )

    await measuredEverywhere(buyer3, 'the transfer form, with what is owed at the door')

    await buyer3.getByLabel(/^Their email address/u).fill(venueNames().buyer1Email)
    await buyer3.getByRole('button', { name: 'Send the offer', exact: true }).click()

    const field = buyer3.getByLabel('Ticket transfer code', { exact: true })

    await expect(field).toBeVisible()

    const transferCode = await field.inputValue()

    await buyer3.getByRole('button', { name: 'I have handed it over', exact: true }).click()
    await expect(field).toHaveCount(0)

    const buyer1 = await venueWindow(browser, 'buyer1')

    await buyer1.setViewportSize({ width: 1280, height: 900 })
    await buyer1.goto('/tickets/accept')
    await expect(buyer1.getByRole('heading', { level: 1, name: 'Accept a ticket' })).toBeVisible()

    await measuredEverywhere(buyer1, 'the page that accepts a ticket')

    await buyer1.getByLabel(/invitation code/iu).fill(transferCode)
    await buyer1.getByRole('button', { name: 'Accept the ticket', exact: true }).click()
    await expect(buyer1.locator('main')).toContainText('Ticket accepted. Pay $40.00 at the door')

    await measuredEverywhere(buyer1, 'a ticket accepted that owes its price')
  })

  test('the cancel-event confirmation and the delete dialog say what happens to tickets paid at the venue', async ({
    browser,
  }) => {
    const owner = await venueWindow(browser, 'owner')
    const { ga, pastNight } = venue.seeded.events

    await owner.setViewportSize({ width: 1280, height: 900 })
    await owner.goto(`/organizer/events/${ga.id}`)
    await expect(
      owner.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
    ).toBeAttached()

    const review = owner
      .getByRole('navigation', { name: 'Editor steps' })
      .getByRole('button', { name: /review/iu })

    await review.click()
    await expect(review).toHaveAttribute('aria-current', 'step')
    await owner.getByRole('button', { name: 'Cancel this event', exact: true }).click()
    await expect(owner.locator('main')).toContainText(
      'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
    )

    await measuredEverywhere(owner, 'the cancel-event confirmation')

    await owner.getByRole('button', { name: 'Not now', exact: true }).click()

    const admin = await venueWindow(browser, 'admin')

    await admin.setViewportSize({ width: 1280, height: 900 })
    await admin.goto(`/admin/events/${pastNight.id}`)
    await admin.getByRole('button', { name: 'Delete this event…', exact: true }).click()

    const dialog = admin.getByRole('region', { name: `Delete “${pastNight.title}”` })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)
    await expect(dialog).toContainText(
      'Payment taken at the door for 1 of these tickets ($25.00) is held by the organiser.',
    )

    await measuredEverywhere(admin, 'the delete dialog, with money taken at the door')
  })
  test('order pages: waiting to be paid, paid at the door with a ticket passed on, with a cancellation, and refunded with money paid at the door', async ({
    browser,
  }) => {
    const buyer1 = await venueWindow(browser, 'buyer1')
    const buyer2 = await venueWindow(browser, 'buyer2')
    const buyer3 = await venueWindow(browser, 'buyer3')
    const owner = await venueWindow(browser, 'owner')

    // The cancelled night's refund, asked for when it was called off, is
    // approved and sent by its owner, who may do both: the booking fee goes
    // back, and the money taken at the door stays with the organiser.
    const refunds = await venueApi(
      owner,
      'GET',
      `/api/v1/refunds?organizationId=${encodeURIComponent(venue.seeded.organizationId)}&orderReference=${encodeURIComponent(venue.b2Past)}`,
    )

    expect(refunds.status, refunds.text).toBe(200)
    expect(refunds.data).toHaveLength(1)

    for (const step of ['approve', 'submit']) {
      const moved = await venueApi(owner, 'POST', `/api/v1/refunds/${refunds.data[0].id}/${step}`, {
        reason: 'The night was called off; its booking fee goes back.',
      })

      expect(moved.status, moved.text).toBe(200)
    }

    for (const [page, reference, says, where] of [
      [buyer1, venue.b1Ga, 'To pay at the door', 'an order waiting to be paid at the door'],
      [
        buyer3,
        venue.b3Ga,
        'Passed on — its new holder pays $40.00 at the door',
        'an order paid at the door, with a ticket passed on',
      ],
      [
        buyer2,
        venue.b2Ga,
        'The Desi Events team cancelled 1 ticket on',
        'an order with an unpaid ticket cancelled',
      ],
      [
        buyer2,
        venue.b2Past,
        'The $25.00 you paid at the door is with the organiser, not with The Desi Events.',
        'an order refunded with money paid at the door',
      ],
    ]) {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(`/account/orders/${reference}`)
      await expect(page.locator('main')).toContainText(says)

      await measuredEverywhere(page, where)
    }
  })

  test('the wallet with a ticket that owes its price, and with one cancelled unpaid', async ({
    browser,
  }) => {
    const buyer1 = await venueWindow(browser, 'buyer1')
    const buyer2 = await venueWindow(browser, 'buyer2')

    await buyer1.setViewportSize({ width: 1280, height: 900 })
    await buyer1.goto('/tickets')
    await expect(buyer1.locator('main')).toContainText('Pay at the door: $40.00')

    await measuredEverywhere(buyer1, 'the wallet, with tickets owing their price')

    await buyer2.setViewportSize({ width: 1280, height: 900 })
    await buyer2.goto('/tickets')
    await expect(buyer2.locator('main')).toContainText('Cancelled — not paid')

    await measuredEverywhere(buyer2, 'the wallet, with a ticket cancelled unpaid')
  })

  test('Payments at the venue, with payments and cancelled tickets, and with none', async ({
    browser,
  }) => {
    const owner = await venueWindow(browser, 'owner')
    const { ga, twoNights } = venue.seeded.events

    for (const [event, where] of [
      [ga, 'Payments at the venue, with payments and cancelled tickets'],
      [twoNights, 'Payments at the venue, with none'],
    ]) {
      await owner.setViewportSize({ width: 1280, height: 900 })
      await owner.goto(`/organizer/events/${event.id}/venue-payments`)
      await confirmIfAsked(owner)
      await expect(owner.getByRole('heading', { level: 2, name: 'Figures' })).toBeVisible()

      await measuredEverywhere(owner, where)
    }

    await owner.goto(`/organizer/events/${ga.id}/venue-payments`)
    await confirmIfAsked(owner)
    await expect(owner.getByRole('table', { name: 'Cancelled unpaid tickets' })).toContainText(
      venue.b2Ga,
    )
  })

  test('Bookings waiting to be paid at the door, with rows and with none, and the cancel dialog with its error summary', async ({
    browser,
  }) => {
    const admin = await venueWindow(browser, 'admin')
    const { ga, twoNights } = venue.seeded.events
    const heading = 'Bookings waiting to be paid at the door'

    await admin.setViewportSize({ width: 1280, height: 900 })
    await admin.goto(`/admin/events/${twoNights.id}/venue-bookings`)
    await confirmIfAsked(admin)
    await expect(admin.getByRole('heading', { level: 1, name: heading })).toBeVisible()

    await measuredEverywhere(admin, 'bookings waiting to be paid, with none')

    await admin.goto(`/admin/events/${ga.id}/venue-bookings`)
    await confirmIfAsked(admin)
    await expect(admin.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(admin.locator('main')).toContainText(`Booking ${venue.b1Ga}`)

    await measuredEverywhere(admin, 'bookings waiting to be paid, with rows')

    await admin.setViewportSize({ width: 1280, height: 900 })
    await admin
      .getByRole('button', { name: `Cancel unpaid tickets in booking ${venue.b1Ga}` })
      .click()

    const dialog = admin.getByRole('dialog', { name: 'Cancel unpaid tickets' })
    const tickets = dialog.getByRole('group', { name: 'Tickets to cancel' })

    await expect(dialog).toBeVisible()

    const first = await Promise.race([
      tickets.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'read'),
      stepUpPrompt(admin)
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'prompted'),
    ])

    if (first === 'prompted') await confirmStepUp(admin)
    await expect(tickets).toBeVisible()

    await measuredEverywhere(admin, 'the cancel dialog, every ticket ticked')

    // One of the two unticked: "Select all" is neither ticked nor unticked.
    const selectAll = tickets.getByRole('checkbox', { name: /^Select all 2 unpaid tickets$/u })
    await expect(selectAll).toBeChecked()
    await tickets.getByRole('checkbox').nth(2).uncheck()
    await expect
      .poll(() => selectAll.evaluate((box) => box.indeterminate && !box.checked))
      .toBe(true)
    await expect(
      dialog.getByRole('button', { name: 'Cancel 1 unpaid ticket', exact: true }),
    ).toBeVisible()

    await measuredEverywhere(admin, 'the cancel dialog, select-all neither ticked nor unticked')

    await tickets.getByRole('checkbox').nth(2).check()
    await expect(selectAll).toBeChecked()

    // No reason given: a summary of what to fix, and nothing cancelled.
    await dialog.getByRole('button', { name: /^Cancel 2 unpaid tickets$/u }).click()
    await expect(dialog).toContainText(/to fix before cancelling/u)

    await measuredEverywhere(admin, 'the cancel dialog, with its error summary')

    await dialog.getByRole('button', { name: 'Keep them', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    // A booking with one ticket for each of the two nights, the first of which
    // is then over: its ticket is drawn, and cannot be ticked.
    const buyer1 = await venueWindow(browser, 'buyer1')
    const items = twoNights.tiers.slice(0, 2).map((ticketTypeId) => ({ ticketTypeId, quantity: 1 }))

    await buyer1.goto('/tickets')

    const holdIds = []

    for (const item of items) {
      const hold = await venueApi(buyer1, 'POST', '/api/v1/holds', item)

      expect(hold.status, hold.text).toBe(201)
      holdIds.push(hold.data.id)
    }

    const priced = { eventId: twoNights.id, items, holdIds, paymentMethod: 'AT_VENUE' }
    const quote = await venueApi(buyer1, 'POST', '/api/v1/orders/quote', priced)

    expect(quote.status, quote.text).toBe(200)

    const order = await venueApi(
      buyer1,
      'POST',
      '/api/v1/orders',
      {
        ...priced,
        buyerEmail: venueNames().buyer1Email,
        buyerName: venueNames().buyer1Name,
        expectedTotalCents: quote.data.totalCents,
        expectedVenueDueCents: quote.data.venueDueCents,
      },
      { 'idempotency-key': `sweep-venue-${TAG}-buyer1-nights-${Date.now()}` },
    )

    expect(order.status, order.text).toBe(201)

    const twoNightsBooking = order.data.reference

    await endNightOf(items[0].ticketTypeId)

    await admin.setViewportSize({ width: 1280, height: 900 })
    await admin.goto(`/admin/events/${twoNights.id}/venue-bookings`)
    await confirmIfAsked(admin)
    await expect(admin.getByRole('heading', { level: 1, name: heading })).toBeVisible()

    const openOver = admin.getByRole('button', {
      name: `Cancel unpaid tickets in booking ${twoNightsBooking}`,
    })

    // Pressed until the dialog opens: a press before hydration does nothing.
    await expect(async () => {
      if ((await dialog.count()) === 0) await openOver.click()
      await expect(dialog).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    const read = await Promise.race([
      tickets.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'read'),
      stepUpPrompt(admin)
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'prompted'),
    ])

    if (read === 'prompted') await confirmStepUp(admin)
    await expect(tickets).toBeVisible()
    await expect(tickets).toContainText('That night is over, so this ticket stays as it is.')

    const over = tickets.getByRole('checkbox', { disabled: true })

    await expect(over).toHaveCount(1)
    await expect(over).not.toBeChecked()
    await expect(
      tickets.getByRole('checkbox', { name: /^Select all 1 unpaid ticket$/u }),
    ).toBeChecked()

    await measuredEverywhere(admin, 'the cancel dialog, one ticket whose night is over')

    await dialog.getByRole('button', { name: 'Keep them', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
})
