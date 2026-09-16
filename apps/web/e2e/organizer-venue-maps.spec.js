import { expect, test } from '@playwright/test'

import {
  PASSWORD,
  cleanupOrganizer,
  currentCode,
  forgetCodeUse,
  seedOrganizer,
} from './support/seed-organizer.mjs'

/**
 * The organiser journeys, against a real API and a real database.
 *
 * Twelve journeys, and most of them are about a refusal. That is the shape of
 * this feature: a seating map is the record of what somebody bought, so almost
 * everything interesting is something the system must decline to do.
 *
 * Runs serially against seeded rows it removes afterwards.
 */

/** The run suffix, so cleanup can find exactly this run's rows. */
const TAG = process.env.ORGANIZER_E2E_TAG ?? `e2e${Date.now().toString(36)}`

/** @type {object} */
let seeded
/** @type {object} */
let context
/**
 * The page every journey shares.
 *
 * One browser context for the whole suite, deliberately. A saved
 * `storageState` does not work here and the reason is a feature: sessions
 * rotate, so the secret captured at sign-in stops being the current one, and
 * every context restored from that snapshot is unauthenticated a few minutes
 * later. Rather than turn rotation off, the suite does what a person does —
 * signs in once and keeps the window open, picking up each rotated cookie as
 * the server issues it.
 *
 * @type {object}
 */
let page

test.beforeAll(async ({ browser }) => {
  seeded = await seedOrganizer(TAG)
  context = await browser.newContext()
  page = await context.newPage()

  await forgetCodeUse()

  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(seeded.mine.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // EVENT_MANAGER is a privileged role, so the API asks for a second factor —
  // finding NF-12 working. The journey goes through it, not around it.
  const code = page.getByLabel(/^Six-digit code/)
  await expect(code).toBeVisible()
  await code.fill(currentCode())
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Sign-in lands on the events list, which is the organiser's front door. The
  // venue journeys navigate from there.
  await expect(page).toHaveURL(/\/organizer\/events/)
})

test.afterAll(async () => {
  await context?.close()
  await cleanupOrganizer(TAG)
})

/**
 * Create a venue through the form and return the page it lands on.
 *
 * @param {object} page The Playwright page.
 * @param {string} name What to call it.
 * @returns {Promise<string>} The venue id, from the URL.
 */
async function createVenue(page, name) {
  await page.goto('/organizer/venues/new')
  await page.getByLabel(/^Organisation\b/).selectOption({ index: 1 })
  await page.getByLabel(/^Venue name\b/).fill(name)
  await page.getByLabel(/^Street address\b/).fill('1 Test Road')
  await page.getByLabel(/^City\b/).fill('Mumbai')
  await page.getByLabel(/^Region\b/).fill('Maharashtra')
  await page.getByLabel(/^Postcode\b/).fill('400001')
  await page.getByLabel('Step-free entrance').check()
  await page.getByRole('button', { name: 'Create venue' }).click()

  await expect(page).toHaveURL(/\/organizer\/venues\/[a-z0-9]+\/maps$/)

  return page.url().match(/venues\/([a-z0-9]+)\/maps/)[1]
}

/**
 * Create a map and open its first draft.
 *
 * @param {object} page The Playwright page.
 * @param {string} venueId The venue.
 * @param {string} name The map name.
 * @returns {Promise<void>} Resolves once the editor is open.
 */
async function createMapAndOpen(page, venueId, name) {
  await page.goto(`/organizer/venues/${venueId}/maps`)
  await page.getByLabel(/^Map name\b/).fill(name)
  await page.getByRole('button', { name: 'Create map' }).click()
  await expect(page.getByText(name)).toBeVisible()
  await page.getByRole('link', { name: 'Edit layout' }).first().click()
  await expect(page.getByRole('heading', { name: /Version 1/ })).toBeVisible()
}

/**
 * Author a minimal valid layout in the open editor: one section, one row, two seats.
 *
 * Entirely through the controls, never by injecting state — the point is that
 * the authoring surface works, not that the API does.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<void>} Resolves once authored.
 */
async function authorLayout(page) {
  await page.getByRole('button', { name: 'Add a price zone' }).click()
  await page.getByRole('button', { name: 'Add a section' }).click()
  await page
    .getByRole('button', { name: /Add a row to/ })
    .first()
    .click()
  await page
    .getByRole('button', { name: /Add a seat to row/ })
    .first()
    .click()
  await page
    .getByRole('button', { name: /Add a seat to row/ })
    .first()
    .click()
}

test.describe('1. an organiser creates a private venue', () => {
  test('creates it, and it appears in their list', async () => {
    const name = `Private Hall ${TAG}`
    await createVenue(page, name)

    await page.goto('/organizer/venues')
    await expect(page.getByRole('link', { name })).toBeVisible()
  })
})

test.describe('2. an organiser authors a valid reserved-seat map', () => {
  test('authors and saves a layout', async () => {
    const venueId = await createVenue(page, `Authoring Hall ${TAG}`)
    await createMapAndOpen(page, venueId, 'End stage')
    await authorLayout(page)

    await page.getByRole('button', { name: 'Save draft' }).click()

    await expect(page.getByRole('status')).toContainText('revision 1')
  })

  test('and can preview it as a buyer will meet it', async () => {
    await page.getByRole('button', { name: 'Preview' }).click()

    // The seats are there, as text rather than controls: nothing to press.
    await expect(page.getByText(/what somebody choosing a seat sees/i)).toBeVisible()
    await expect(page.getByText('2 seats.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /A1, row A/ })).toHaveCount(0)

    // And the authoring surface is gone, because a half-editable preview is a
    // preview of nothing.
    await expect(page.getByRole('button', { name: 'Add a section' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Plan' }).click()
    await expect(page.getByRole('button', { name: /A1, row A/ })).toBeVisible()
  })
})

test.describe('3. a keyboard-only user creates and edits seats', () => {
  test('reaches every control and edits a seat without a mouse', async () => {
    const venueId = await createVenue(page, `Keyboard Hall ${TAG}`)
    await createMapAndOpen(page, venueId, 'Keyboard map')

    // Every structural action is a button, so it is reachable and pressable.
    await page.getByRole('button', { name: 'Add a price zone' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Add a section' }).focus()
    await page.keyboard.press('Enter')
    await page
      .getByRole('button', { name: /Add a row to/ })
      .first()
      .focus()
    await page.keyboard.press('Enter')

    const addSeat = page.getByRole('button', { name: /Add a seat to row/ }).first()
    await addSeat.focus()
    await page.keyboard.press('Enter')
    await addSeat.focus()
    await page.keyboard.press('Enter')

    // Seats are buttons in the plan, named with their row and section.
    const firstSeat = page.getByRole('button', { name: /A1, row A/ })
    await expect(firstSeat).toBeVisible()

    await firstSeat.focus()
    // Arrow keys move between seats.
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: /A2, row A/ })).toBeFocused()

    // Enter selects, which opens the seat's properties.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: /Seat A2/ })).toBeVisible()

    // And the properties are ordinary form controls.
    await page.getByLabel('Wheelchair space').check()
    await expect(page.getByRole('button', { name: /A2.*accessible space/ })).toBeVisible()
  })
})

test.describe('4. an invalid whole-layout save writes nothing', () => {
  test('refuses, explains, and leaves the saved draft alone', async () => {
    const venueId = await createVenue(page, `Invalid Hall ${TAG}`)
    await createMapAndOpen(page, venueId, 'Invalid map')
    await authorLayout(page)

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('status')).toContainText('revision 1')

    // Two seats with the same label: the map cannot mean anything.
    await page.getByRole('button', { name: /A2, row A/ }).click()
    await page.getByLabel('Label', { exact: true }).fill('A1')

    await expect(page.getByRole('alert').filter({ hasText: 'problem' })).toContainText(/problem/)
    await expect(page.getByRole('alert').filter({ hasText: 'problem' })).toContainText(
      /Nothing has been saved/,
    )

    // Reloading proves the stored draft is untouched: both original labels back.
    await page.reload()
    await expect(page.getByRole('button', { name: /A1, row A/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /A2, row A/ })).toBeVisible()
  })
})

test.describe('5. an organiser cannot edit another organisation venue', () => {
  test('is refused, and told why', async () => {
    await page.goto(`/organizer/venues/${seeded.theirVenueId}/maps`)

    await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toContainText(
      /another organisation/i,
    )
    await expect(page.getByRole('button', { name: 'Create map' })).toHaveCount(0)
  })
})

test.describe('6. an organiser can select but not modify a shared venue', () => {
  test('cannot author its maps', async () => {
    await page.goto(`/organizer/venues/${seeded.sharedVenueId}/maps`)

    await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toContainText(
      /shared between all of them/i,
    )
  })

  test('but the venue is publicly readable, which is how an event selects it', async () => {
    // Selecting a shared venue for an event is a read, and reads are open.
    const response = await page.request.get(`/api/v1/venues/${seeded.sharedVenueId}`)

    expect(response.status()).toBe(200)
    expect((await response.json()).data.shared).toBe(true)
  })
})

test.describe('7, 8, 9, 10. publish, freeze, clone, and history', () => {
  test('publishes a map, which then refuses to change, clones, and keeps history', async () => {
    const venueId = await createVenue(page, `Publish Hall ${TAG}`)
    await createMapAndOpen(page, venueId, 'Publishable')
    await authorLayout(page)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('status')).toContainText('revision 1')

    // 7. Publish, through the dialog that explains what it costs.
    await page.getByRole('button', { name: 'Publish' }).click()
    const dialog = page.getByRole('dialog', { name: /Publish this version/ })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/freezes this layout permanently/i)
    await expect(dialog).toContainText(/no section, row or seat in this version can be changed/i)
    await expect(dialog).toContainText(/start a new version/i)
    await dialog.getByRole('button', { name: 'Publish and freeze' }).click()

    // 8. Immutable afterwards: the editor says so, twice — the state badge and
    // the explanation of what that state costs — and offers no save.
    await page.reload()
    await expect(page.getByText('State: Frozen')).toBeVisible()
    await expect(page.getByText('This version is frozen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)

    const versionUrl = page.url()
    const versionId = versionUrl.split('/').pop()

    // The API refuses too, which is the check that counts — a screen that hides
    // the button proves nothing about the thing behind it.
    //
    // Issued from inside the page rather than from Playwright's request
    // context, so it is a real browser request: the session cookie, the CSRF
    // token echoed from the readable cookie, and an `Origin` the API will
    // accept. Anything less gets refused for the wrong reason — a 403 for a
    // missing token would leave the freeze itself untested.
    const refused = await page.evaluate(async (id) => {
      const token = document.cookie
        .split('; ')
        .map((pair) => pair.split('='))
        .find(([name]) => name.endsWith('desi_csrf'))?.[1]

      const response = await fetch(`/api/v1/venue-map-versions/${id}/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-desi-csrf': token ?? '' },
        body: JSON.stringify({
          revision: 1,
          zones: [],
          sections: [{ key: 's', name: 'S', kind: 'SEATED', rows: [] }],
        }),
      })

      return { status: response.status, body: await response.json().catch(() => null) }
    }, versionId)

    expect(refused.status).toBe(409)
    expect(refused.body?.error?.message).toMatch(/cannot be changed/i)

    // 9. Clone it into a new draft.
    await page.goto(`/organizer/venues/${venueId}/maps`)
    await page.getByRole('button', { name: 'New version from this' }).first().click()
    await expect(page.getByRole('heading', { name: /Version 2/ })).toBeVisible()

    // The copy carries the seats, and is editable — which is proved by editing
    // it. A visible button proves nothing; a saved revision does.
    await expect(page.getByRole('button', { name: /A1, row A/ })).toBeVisible()
    await expect(page.getByText('This version is frozen')).toHaveCount(0)

    await page.getByLabel('Section 1 name').fill('Stalls')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('status')).toContainText('revision 1')

    // 10. The published version is still there, still frozen, still version 1.
    await page.goto(`/organizer/venues/${venueId}/maps`)
    await expect(page.getByText('Version 1')).toBeVisible()
    await expect(page.getByText('Published')).toBeVisible()
    await expect(page.getByText('Version 2')).toBeVisible()
    await expect(page.getByText('Draft')).toBeVisible()
  })
})

test.describe('11. the public venue page renders without JavaScript', () => {
  test('is readable with scripting off', async ({ browser }) => {
    const plainContext = await browser.newContext({ javaScriptEnabled: false })
    const plainPage = await plainContext.newPage()

    await plainPage.goto(`/venues/shared-hall-${TAG}`)

    await expect(plainPage.getByRole('heading', { level: 1 })).toContainText('Shared Hall')
    await expect(plainPage.locator('address')).toContainText('Mumbai')
    await expect(plainPage.getByRole('region', { name: 'Where it is' })).toBeVisible()

    await plainContext.close()
  })
})

test.describe('12. reduced motion and responsive behaviour', () => {
  test('the editor is usable at tablet width', async () => {
    const venueId = await createVenue(page, `Responsive Hall ${TAG}`)
    await createMapAndOpen(page, venueId, 'Responsive map')
    await authorLayout(page)

    await page.setViewportSize({ width: 768, height: 1024 })

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible()
  })

  test('the editor is usable on a phone', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto('/organizer/venues')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('respects reduced motion, leaving nothing permanently invisible', async ({ browser }) => {
    // Reduced motion is a context-level setting, so it needs its own context —
    // and that context needs the session. The storage state is captured here
    // and now rather than restored from a file written minutes ago, because
    // sessions rotate; see the note on rotation above.
    const motionContext = await browser.newContext({
      reducedMotion: 'reduce',
      storageState: await context.storageState(),
    })
    const motionPage = await motionContext.newPage()
    await motionPage.goto('/organizer/venues')
    await expect(motionPage.getByRole('heading', { level: 1 })).toBeVisible()

    // An entrance animation that never runs must not leave its subject at zero
    // opacity. That is the failure mode of a reveal-on-scroll effect built
    // without a reduced-motion branch: the page loads and stays blank.
    const hidden = await motionPage.evaluate(
      () =>
        [...document.querySelectorAll('h1, h2, section, li')].filter(
          (el) => Number.parseFloat(getComputedStyle(el).opacity) === 0,
        ).length,
    )

    expect(hidden).toBe(0)

    await motionContext.close()
  })
})
