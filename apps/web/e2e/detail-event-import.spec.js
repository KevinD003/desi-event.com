import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import {
  CATEGORY_NOTE,
  IMPORT_ALLOWANCE,
  IMPORT_TIME_ZONE,
  auditRows,
  buildImportDataset,
  changeNoticesFor,
  cleanupImport,
  datasetUpload,
  eventStanding,
  expireStepUp,
  importNames,
  importedEvents,
  ordersOf,
  platformHeldExists,
  seedImport,
  withMovedStart,
} from './support/seed-import.mjs'
import { PASSWORD, currentCode, forgetCodeUse } from './support/seed-refusals.mjs'
import { confirmStepUp, stepUpPrompt, waitOutCredentialBudget } from './support/step-up.mjs'

/**
 * Importing events from organisers' listings (SPEC2-XI area I, §9 row 12; ADR
 * 0015, addendum 2026-10-15 (2)), in a real browser against the real API: a
 * platform administrator uploads a listing file, reads the plan, imports it,
 * approves and publishes what it wrote with its tickets on sale here, a buyer
 * buys a ticket through the checkout (payment simulated), the file is
 * imported again, one event is moved to an organiser's own organisation, and
 * the sold one is taken off the site with its order refunded.
 *
 * Nothing in any of it links to, redirects to or contacts the site the
 * listings were read from: the file carries no address, the importer copies
 * no picture, and no page names the site or any host of it.
 *
 * ## The story
 *
 *   - **I1** The administrator uploads the file. A file that is not JSON is
 *     refused in the browser, before anything is sent; one that still carries
 *     a web address (a ticket link) is refused by the API, problem by
 *     problem. The plan lists each listing with its notes and what its prices
 *     become; importing it asks for a second factor. The run page then shows
 *     every event waiting for review, and no picture anywhere: each listed
 *     price is a ticket type on an allowance of 100, a price sold out on the
 *     listing is made but not put on sale, and no event has a website link.
 *   - **I2** Nothing imported is public before review. Approving two
 *     publishes both under one second factor, with their tickets on sale:
 *     each page says who presents it, shows its ticket types, "Choose
 *     tickets" and "Reserve on WhatsApp" with the exact chat address, never a
 *     count of tickets left; there is no "Buy tickets", no website link, and
 *     its website route answers 404; each card reads "From …", and no page
 *     names the source site or any host of it.
 *   - **I2a** A buyer buys one ticket to the garba night through the
 *     checkout, paid by the simulated provider; the order is paid, the ticket
 *     issued, and the page still shows no count of tickets left.
 *   - **I3** The same file again plans the published events as kept or
 *     unchanged; "Update from the listing" on the one whose time moved copies
 *     the new time onto its public page, with a change notice, and leaves its
 *     ticket types, the sold one included, as they were.
 *   - **I3a** The administrator takes the Bollywood evening, which nobody has
 *     bought a ticket to, off the site from its danger zone, which says first
 *     that a restore puts it back at any time: its page answers 404. From
 *     "Taken off the site (deleted)", narrowed to "Imported from listings",
 *     "Restore…" puts it back at the same address with its sales paused,
 *     presented by its organiser, with "Reserve on WhatsApp" and still no
 *     link anywhere else. It is taken off and put back once more, through the
 *     API, and comes back the same way.
 *   - **I4** The administrator moves it to Import Gamma (the dialog says the
 *     organisation is not asked first). Its page is no longer an imported
 *     listing; Import Gamma's owner finds it in their events and edits it.
 *   - **I4a** The approve route, named an ordinary organisation's event
 *     waiting for review, refuses that item `NOT_IN_RUN` and leaves it as it
 *     was.
 *   - **I5** A moderator is not offered imports and the API refuses them; no
 *     run page offers "Retry pictures", and the route that did is gone.
 *   - **I6** The administrator takes the sold garba night off the site with
 *     its order cancelled and refunded (simulated); the buyer's order says it
 *     was refunded in full.
 *
 * ## Who is who
 *
 * Every account is fresh (`support/seed-import.mjs`): the platform
 * administrator, the moderator, Import Gamma's owner and the buyer are signed
 * in here, each in a window of its own, and no privilege of theirs changes.
 * The listing file is built when the run starts, dated 10, 11 and 12 days
 * ahead, and uploaded from memory.
 *
 * ## Isolation
 *
 * The imported events are, while they last, the soonest public events of the
 * detail world, so `afterAll` removes every one of them before the next spec
 * counts a list. The garba night's order is held by the ledger, so that event
 * stays, taken off the site by I6.
 *
 * No show-once code is drawn on any page here, so screenshots, traces and
 * video keep the config's defaults. Step-ups are one-time codes from the
 * seeded factor (`support/step-up.mjs`).
 *
 * @module e2e/detail-event-import
 */

/** Every context this file opened, closed in `afterAll`. @type {object[]} */
const contexts = []

/** Each signed-in window, opened the first time a journey asks. */
const windows = {}

/** The seeded ids. @type {object} */
let seeded

/** The listing file, built once for the whole file. @type {object} */
let dataset

/** Whether "The Desi Events" (the platform-held organisation) was there before this file imported anything. */
let heldBefore = true

/** The import runs, as the journeys make them. @type {{first?: string, second?: string}} */
const runs = {}

/** The order the buyer placed in I2a, refunded in I6. @type {{reference: string, totalCents: number, tierId: string}|null} */
let soldOrder = null

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * This run's names.
 *
 * @returns {object} The names.
 */
const names = () => importNames(ids().tag)

/**
 * A listing of the file, by its key in {@link importNames}.
 *
 * @param {'garba'|'bollywood'|'concert'} key Which.
 * @returns {object} The listing.
 */
const listing = (key) =>
  dataset.events.find((event) => event.sourceId === names().listings[key].sourceId)

/**
 * The day a listing was read, as the event page writes it: "7 October 2026".
 *
 * @param {string} instant The listing's `scrapedAt`.
 * @returns {string} The words.
 */
function listedOn(instant) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(instant))
}

/**
 * An instant's time of day in the listings' zone.
 *
 * @param {Date|string} value The instant.
 * @returns {string} For example `7:00 PM`.
 */
function timeInChicago(value) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IMPORT_TIME_ZONE,
  }).format(new Date(value))
}

/**
 * A text with its whitespace made plain spaces, the way Playwright reads a
 * page's text: `Intl` puts a narrow no-break space before "PM".
 *
 * @param {string} text The text.
 * @returns {string} The same, with every run of whitespace one space.
 */
function plain(text) {
  return text.replace(/\s+/gu, ' ')
}

/**
 * A run's own page.
 *
 * @param {string} runId The run.
 * @returns {string} Its path.
 */
function runPath(runId) {
  return `/admin/imports/${runId}`
}

/**
 * A window signed in as one of the seed's accounts, opened the first time it
 * is asked for and kept for the rest of the file.
 *
 * @param {object} browser The browser under test.
 * @param {'admin'|'moderator'|'owner'|'buyer'} who Which account.
 * @returns {Promise<object>} An arriving, signed-in page.
 */
async function windowFor(browser, who) {
  windows[who] ??= (async () => {
    const context = await browser.newContext()
    const page = arriving(await context.newPage())

    contexts.push(context)
    await signIn(page, names()[`${who}Email`])

    return page
  })()

  return windows[who]
}

/**
 * Send one request to the API from the page, as a client would that went
 * round the screens: through the web's proxy, with the page's own session and
 * its CSRF token.
 *
 * @param {object} page The Playwright page, signed in.
 * @param {string} method The HTTP method.
 * @param {string} path The API path, starting `/api/v1/`.
 * @param {object} [body] The JSON body.
 * @returns {Promise<{status: number, code: string|null, data: object|null, text: string}>} What came back.
 */
function callApi(page, method, path, body) {
  return page.evaluate(
    async ({ method: verb, path: address, body: sent }) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
      const response = await fetch(address, {
        method: verb,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
        },
        body: sent === undefined ? undefined : JSON.stringify(sent),
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
    { method, path, body },
  )
}

/**
 * Send one request that may be refused for a second factor; when it is,
 * confirm one through the API (as the prompt would) and send it once more.
 *
 * @param {object} page The Playwright page, signed in.
 * @param {string} method The HTTP method.
 * @param {string} path The API path.
 * @param {object} [body] The JSON body.
 * @returns {Promise<object>} What the request finally answered.
 */
async function callThroughStepUp(page, method, path, body) {
  const first = await callApi(page, method, path, body)

  if (first.code !== 'STEP_UP_REQUIRED') return first

  await forgetCodeUse()

  const confirmed = await callApi(page, 'POST', '/api/v1/auth/step-up', {
    password: PASSWORD,
    code: currentCode(),
  })

  expect(confirmed.status, confirmed.text).toBe(200)

  return callApi(page, method, path, body)
}

/**
 * Wait until React has hydrated a control, so a press reaches its handler
 * rather than the browser's own default (a form submitted to its own
 * address, a file chosen that no state holds).
 *
 * @param {object} locator The control.
 * @returns {Promise<void>} Resolves once hydrated.
 */
async function hydrated(locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((node) =>
          Object.keys(node).some((key) => key.startsWith('__reactProps$')),
        ),
      { timeout: 30_000 },
    )
    .toBe(true)
}

/**
 * Whether a response is a POST to one API path.
 *
 * @param {string} path The path, starting `/api/v1/`.
 * @returns {Function} The predicate.
 */
function postTo(path) {
  return (response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === path
}

/**
 * Answer an open step-up prompt, waiting out the credential budget once if
 * the confirmation itself is refused for it.
 *
 * @param {object} page The page, with the prompt open.
 * @returns {Promise<void>} Resolves once the prompt has closed.
 */
function answerStepUp(page) {
  return waitOutCredentialBudget(page, () => confirmStepUp(page), {
    refusedAt: /^\/api\/v1\/auth\//u,
  })
}

/**
 * Press a control whose request may be refused for a second factor and wait
 * for the request to succeed. With `asked`, the prompt must come: the
 * journey made the last confirmation older than every window first.
 *
 * @param {object} page The page.
 * @param {Function} press Presses the control.
 * @param {Function} matches Whether a response is the one the control sends.
 * @param {object} [options] Options.
 * @param {boolean} [options.asked] Whether the prompt must come.
 * @returns {Promise<object>} The successful response.
 */
async function pressThroughStepUp(page, press, matches, { asked = false } = {}) {
  const succeeded = page.waitForResponse((response) => matches(response) && response.ok(), {
    timeout: 90_000,
  })

  await press()

  if (asked) {
    await answerStepUp(page)

    return succeeded
  }

  const first = await Promise.race([
    succeeded.then(() => 'done'),
    stepUpPrompt(page)
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'prompted'),
  ])

  if (first === 'prompted') await answerStepUp(page)

  return succeeded
}

/**
 * Upload a listing file from `/admin/imports` and wait for the API's answer.
 *
 * @param {object} page The administrator's page.
 * @param {{name: string, mimeType: string, buffer: Buffer}} upload The file.
 * @returns {Promise<object|null>} The plan's response, or null when the browser refused the file.
 */
async function uploadListing(page, upload) {
  await page.goto('/admin/imports')

  const form = page.getByRole('form', { name: 'Plan an import', exact: true })
  const field = form.getByLabel(/^Listing file/u)

  await hydrated(field)
  await field.setInputFiles(upload)

  const planned = page
    .waitForResponse(postTo('/api/v1/platform/imports'), { timeout: 30_000 })
    .catch(() => null)

  await form.getByRole('button', { name: 'Plan this import', exact: true }).click()

  return planned
}

/**
 * The plan's table on a run page.
 *
 * @param {object} page The page, on a run.
 * @returns {object} The table's locator.
 */
function planTable(page) {
  return page.getByRole('table', { name: /^The plan for /u })
}

/**
 * One listing's row in the plan.
 *
 * @param {object} page The page, on a run.
 * @param {string} title The listing's title.
 * @returns {object} The row's locator.
 */
function planRow(page, title) {
  return planTable(page).getByRole('row').filter({ hasText: title })
}

/**
 * Open an event's editor on one step.
 *
 * @param {object} page The editor's page.
 * @param {string} eventId Which event.
 * @param {RegExp} step The step button's name.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openStep(page, eventId, step) {
  await page.goto(`/organizer/events/${eventId}`)
  // The step buttons answer only once the editor has hydrated.
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
 * The JSON-LD event the page carries.
 *
 * @param {object} page A public event page.
 * @returns {Promise<object>} The `Event` object.
 */
async function structuredEvent(page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  const found = blocks
    .map((text) => JSON.parse(text))
    .flatMap((data) => (Array.isArray(data) ? data : [data]))
    .find((data) => /Event$/u.test(String(data['@type'] ?? '')))

  expect(found, 'the page carries no JSON-LD event').toBeTruthy()

  return found
}

/**
 * The address "Reserve on WhatsApp" opens for an event: the company's own
 * chat, with the event's title, day (in the venue's zone) and place.
 *
 * @param {string} title The event's title.
 * @param {Date|string} startsAt Its start.
 * @param {string} venueName Its venue.
 * @param {string} city Its city.
 * @returns {string} The `https://wa.me/…?text=…` address.
 */
function whatsAppHref(title, startsAt, venueName, city) {
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: IMPORT_TIME_ZONE,
  }).format(new Date(startsAt))
  const message = `Hi! I'd like to reserve tickets for "${title}" on ${day} at ${venueName}, ${city}.`

  return `https://wa.me/19726949043?text=${encodeURIComponent(message)}`
}

/**
 * Every address a page's main content links to that leaves The Desi Events.
 * The site's own header and footer, with the company's contact channels, are
 * outside it.
 *
 * @param {object} page A page.
 * @returns {Promise<string[]>} The absolute `href`s, in page order.
 */
async function outsideLinks(page) {
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))

  return hrefs.filter((href) => /^[a-z][a-z0-9+.-]*:/iu.test(href) && !href.startsWith('mailto:'))
}

/**
 * Choose one ticket of a tier with the checkout's stepper.
 *
 * A press that lands before the basket has hydrated reaches a server-rendered
 * button with no handler and changes nothing, so it is repeated only while
 * the quantity still reads zero, and the wait is for it to read one.
 *
 * @param {object} page The checkout page.
 * @param {string} tier The tier's name.
 * @returns {Promise<void>} Resolves once one ticket is chosen.
 */
async function chooseOne(page, tier) {
  const quantity = page.getByLabel(`Quantity of ${tier}`)
  const add = page.getByRole('button', { name: `Add one ${tier}` })

  await expect(quantity).toHaveValue('0')
  await expect(async () => {
    if ((await quantity.inputValue()) === '0') await add.click()

    await expect(quantity).toHaveValue('1', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/** The source site's name or any host of it, wherever it might appear. */
const SOURCE = /sulekha/iu

test.describe.serial('importing events from organisers’ listings, sold here', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)

    const { tag } = ids()

    // Whatever a stopped attempt left under this tag goes first.
    await cleanupImport(tag)

    heldBefore = await platformHeldExists()
    seeded = await seedImport(tag)
    dataset = buildImportDataset(tag)

    await windowFor(browser, 'admin')
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupImport(ids().tag, { removePlatformHeld: !heldBefore })
  })

  test('I1: the administrator uploads a listing file, reads its plan and notes, and imports it with a second factor', async ({
    browser,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings

    // The file the run uploads carries no address of any kind.
    expect(JSON.stringify(dataset)).not.toMatch(/https?:|sourceUrl|ticketUrl|"images"/u)
    // The only spelling of the source left is its enum value, an identifier.
    expect(JSON.stringify({ ...dataset, source: null })).not.toMatch(SOURCE)
    expect(dataset.source).toBe('SULEKHA')

    await admin.goto('/admin/imports')
    await expect(admin.getByRole('heading', { level: 1, name: 'Imports' })).toBeVisible()
    await expect(admin.getByRole('link', { name: 'Imports', exact: true }).first()).toBeVisible()

    // A file that is not JSON is refused in the browser, and nothing is sent.
    const sent = []
    const listen = (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/platform/imports'
      ) {
        sent.push(request.url())
      }
    }

    admin.on('request', listen)

    const broken = await uploadListing(admin, {
      name: 'listings.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "format": "desi-event-import/1", ', 'utf8'),
    })
    const form = admin.getByRole('form', { name: 'Plan an import', exact: true })

    await expect(form.getByRole('link', { name: /^This file is not valid JSON/u })).toBeVisible()
    await expect(form.getByText('The file was not planned', { exact: true })).toBeVisible()
    admin.off('request', listen)
    expect(broken, 'a file that is not JSON was sent').toBeNull()
    expect(sent).toEqual([])

    // A file that still carries a web address (a ticket link, as files did
    // before 2026-10-15) is refused by the API, and each problem is listed.
    const withAddress = {
      ...dataset,
      events: dataset.events.map((event) =>
        event.sourceId === garba.sourceId
          ? { ...event, ticketUrl: 'https://tickets.example.test/garba-night' }
          : event,
      ),
    }
    const refused = await uploadListing(admin, datasetUpload(withAddress, 'with-address.json'))

    expect(refused?.status()).toBe(422)
    expect((await refused.json()).error.code).toBe('IMPORT_INVALID')
    await expect(form.getByText('The file was not planned', { exact: true })).toBeVisible()
    await expect(
      form.getByText(new RegExp(`^events\\[0\\] \\(listing ${garba.sourceId}\\) ticketUrl: `, 'u')),
    ).toBeVisible()
    await expect(admin).toHaveURL(/\/admin\/imports$/u)

    // The file itself plans, and its plan opens on its own page.
    const planned = await uploadListing(admin, datasetUpload(dataset, names().fileName))

    expect(planned?.status()).toBe(201)
    runs.first = (await planned.json()).data.id
    await expect(admin).toHaveURL(new RegExp(`${runPath(runs.first)}$`, 'u'))
    await expect(
      admin.getByRole('heading', { level: 1, name: names().fileName, exact: true }),
    ).toBeVisible()
    await expect(admin.getByText('Planned, not applied').first()).toBeVisible()
    await expect(admin.getByText(/^Nothing has been imported\. Check the plan/u)).toBeVisible()

    // Every listing, what applying does to it, what its prices become, and
    // the curator's notes. There is no "Pictures" column: nothing is copied.
    for (const { title } of [garba, bollywood, concert]) {
      const row = planRow(admin, title)

      await expect(row).toContainText('New')
      await expect(row).toContainText('Created as a draft and sent for review.')
    }

    await expect(planTable(admin).getByRole('columnheader', { name: 'Pictures' })).toHaveCount(0)

    const garbaRow = planRow(admin, garba.title)

    await expect(
      garbaRow.getByRole('listitem').filter({ hasText: '7:00 PM is imported' }),
    ).toHaveText(listing('garba').importNotes[0])
    await expect(garbaRow).toContainText(`Listing ${garba.sourceId} · Houston · No end time listed`)
    await expect(garbaRow).toContainText(
      '4 ticket types, 1 not on sale (sold out on the listing), in USD',
    )
    await expect(planRow(admin, bollywood.title)).toContainText('1 ticket type, in USD')
    await expect(planRow(admin, bollywood.title)).not.toContainText('No end time listed')
    await expect(planRow(admin, concert.title)).toContainText('No price listed, so no ticket type')
    await expect(
      planRow(admin, concert.title).getByRole('listitem').filter({ hasText: 'CLASSICAL' }),
    ).toHaveText(CATEGORY_NOTE)

    // Importing asks for a second factor: the administrator's last one is made
    // older than the window first, so the prompt comes for certain.
    await expireStepUp(names().adminEmail)

    const importButton = admin.getByRole('button', { name: 'Import these 3 events', exact: true })

    await hydrated(importButton)
    await pressThroughStepUp(
      admin,
      () => importButton.click(),
      postTo(`/api/v1/platform/imports/${runs.first}/apply`),
      { asked: true },
    )
    await expect(
      admin.getByText(
        'The plan was applied. Its events wait for review: approve and publish them here.',
      ),
    ).toBeVisible()

    // The page, read again: every event waits for review, and the run says
    // no picture was copied and offers nothing to copy one.
    await expect(admin.getByText(/^Status:\s*Applied$/u).first()).toBeVisible()
    await expect(
      admin.getByText(/Imports copy no pictures: each imported event shows a generated poster/u),
    ).toBeVisible()
    await expect(admin.getByRole('button', { name: /retry pictures/iu })).toHaveCount(0)

    for (const { title } of [garba, bollywood, concert]) {
      const row = planRow(admin, title)

      await expect(row).toContainText('Waiting for review')
      await expect(row.getByRole('link', { name: `Review “${title}”` })).toBeVisible()
    }

    // The run page links nowhere off the site, and names the source site
    // nowhere an administrator reads it, apart from the name of the file the
    // administrator uploaded.
    expect(await outsideLinks(admin)).toEqual([])
    expect((await admin.locator('main').innerText()).replaceAll(names().fileName, '')).not.toMatch(
      SOURCE,
    )
    await expect(admin.getByRole('link', { name: /source listing/iu })).toHaveCount(0)

    // In the database: three drafts sent for review under "The Desi Events",
    // which has no members; a ticket type for every listed price, each on an
    // allowance, the sold-out one closed; no website link and no picture.
    const events = await importedEvents(ids().tag)

    expect(Object.keys(events).sort()).toEqual(
      [garba.sourceId, bollywood.sourceId, concert.sourceId].sort(),
    )

    for (const item of Object.values(events)) {
      expect(item.event.status).toBe('REVIEW_PENDING')
      expect(item.event.organization).toEqual({
        name: 'The Desi Events',
        platformHeldSource: 'SULEKHA',
      })
      expect(item.importedById).toBe(seeded.adminId)
      expect(item.lastRunId).toBe(runs.first)
      expect(item.event.websiteUrl).toBeNull()
      expect(item.event.websiteRedirectEnabled).toBe(false)
      expect(item.event.websiteDecidedUrl).toBeNull()
      expect(item.event._count.media).toBe(0)

      for (const tier of item.event.ticketTypes) {
        expect(tier, tier.name).toMatchObject({
          currency: 'USD',
          quantityTotal: IMPORT_ALLOWANCE,
          quantitySold: 0,
          quantityIsAllowance: true,
          minPerOrder: 1,
          reserved: false,
        })
      }

      const [audit] = await auditRows(item.event.id, 'event.imported')

      expect(audit.metadata).toMatchObject({
        mode: 'CREATE',
        sourceId: item.sourceId,
        importRunId: runs.first,
        via: 'web',
      })
      expect(JSON.stringify(audit.metadata)).not.toMatch(/https?:/u)
    }

    expect(
      events[garba.sourceId].event.ticketTypes.map((tier) => [tier.name, tier.priceCents]),
    ).toEqual([
      ['General admission', 2_500],
      ['VIP', 4_000],
      ['Child (under 12)', 0],
      ['Early bird', 2_000],
    ])
    expect(
      events[garba.sourceId].event.ticketTypes.find((tier) => tier.name === 'Early bird').status,
    ).toBe('CLOSED')
    expect(events[bollywood.sourceId].event.ticketTypes).toHaveLength(1)
    expect(events[concert.sourceId].event.ticketTypes).toEqual([])
    // A listing with no end stores the planning estimate, flagged as such.
    expect(events[garba.sourceId].event.sessions).toEqual([
      expect.objectContaining({ endTimeListed: false }),
    ])
    expect(events[bollywood.sourceId].event.sessions).toEqual([
      expect.objectContaining({ endTimeListed: true }),
    ])
  })

  test('I2: nothing imported is public before review; approving two publishes them with their tickets on sale here', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings
    const before = await importedEvents(ids().tag)

    // Before review, each page answers as an address that was never an event.
    for (const { sourceId } of [garba, bollywood, concert]) {
      await visitor.goto(`/events/${before[sourceId].event.slug}`)
      await expect(visitor.getByTestId('not-found-view')).toBeVisible()
    }

    // Two of the three, approved and published together under one second
    // factor; the third is left waiting.
    await admin.goto(runPath(runs.first))

    const approveGarba = admin.getByRole('checkbox', { name: `Approve “${garba.title}”` })

    await hydrated(approveGarba)
    await approveGarba.check()
    await admin.getByRole('checkbox', { name: `Approve “${bollywood.title}”` }).check()

    const stepUps = []
    const listen = (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/auth/step-up'
      ) {
        stepUps.push(request.url())
      }
    }

    admin.on('request', listen)
    await expireStepUp(names().adminEmail)
    await pressThroughStepUp(
      admin,
      () =>
        admin.getByRole('button', { name: 'Approve and publish 2 events', exact: true }).click(),
      postTo(`/api/v1/platform/imports/${runs.first}/approve`),
      { asked: true },
    )
    admin.off('request', listen)
    expect(stepUps, 'two events took more than one second factor').toHaveLength(1)

    const report = admin.getByRole('status').filter({ hasText: 'Approve and publish' })

    await expect(report).toContainText(
      new RegExp(`${garba.title}: approved and published, with \\d ticket types on sale\\.`, 'u'),
    )
    await expect(report).toContainText(
      `${bollywood.title}: approved and published, with 1 ticket type on sale.`,
    )
    await expect(report).not.toContainText(/Buy tickets|link/u)
    await expect(planRow(admin, garba.title)).toContainText('On sale')
    await expect(planRow(admin, concert.title)).toContainText('Waiting for review')

    // In the database: on sale, approved by the administrator who imported
    // them under the platform's own exemption; every tier but the sold-out one
    // on sale from the approval until the event starts; no website link.
    const after = await importedEvents(ids().tag)

    for (const key of ['garba', 'bollywood']) {
      const item = after[names().listings[key].sourceId]

      expect(item.event.status).toBe('ON_SALE')
      expect(item.approvedById).toBe(seeded.adminId)
      expect(item.event.websiteUrl).toBeNull()
      expect(item.event.websiteRedirectEnabled).toBe(false)

      const general = item.event.ticketTypes.find((tier) => tier.name === 'General admission')

      expect(general.status).toBe('ON_SALE')
      expect(general.salesEndAt.toISOString()).toBe(item.event.startsAt.toISOString())
      expect(general.salesStartAt.getTime()).toBeLessThanOrEqual(Date.now())

      const [approved] = await auditRows(item.event.id, 'event.approved')

      expect(approved.actorId).toBe(seeded.adminId)
      expect(approved.metadata).toMatchObject({
        via: 'import',
        exemption: 'PLATFORM_HELD_IMPORT',
        importedById: seeded.adminId,
        approvedById: seeded.adminId,
      })
    }

    expect(
      after[garba.sourceId].event.ticketTypes.find((tier) => tier.name === 'Early bird').status,
    ).toBe('CLOSED')
    expect(after[concert.sourceId].event.status).toBe('REVIEW_PENDING')

    // The public page: who presents it, its ticket types and "Choose
    // tickets", the prices' provenance, and "Reserve on WhatsApp" with the
    // exact chat address; never "Buy tickets", a website link or a count.
    const garbaEvent = after[garba.sourceId].event

    await visitor.goto(`/events/${garbaEvent.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: garba.title })).toBeVisible()
    await expect(visitor.getByText(`Presented by ${garba.presentedBy}`)).toBeVisible()

    const tickets = visitor.locator('#tickets')
    const tiers = tickets.getByRole('list', { name: 'Ticket types' })

    for (const name of ['General admission', 'VIP', 'Child (under 12)', 'Early bird']) {
      await expect(tiers.getByText(name, { exact: true })).toBeVisible()
    }

    await expect(tickets.getByRole('link', { name: /choose tickets/iu })).toHaveAttribute(
      'href',
      `/events/${garbaEvent.slug}/checkout`,
    )
    await expect(tickets).toContainText(
      `Prices are as the organiser listed them on ${listedOn(listing('garba').scrapedAt)}.`,
    )
    await expect(tickets).toContainText('Payments on this site are simulated.')

    const reserve = tickets.getByRole('link', {
      name: 'Reserve on WhatsApp, opens WhatsApp in a new tab',
      exact: true,
    })
    const garbaWhatsApp = whatsAppHref(
      garba.title,
      garbaEvent.startsAt,
      listing('garba').venue.name,
      'Houston',
    )

    await expect(reserve).toHaveText('Reserve on WhatsApp')
    await expect(reserve).toHaveAttribute('href', garbaWhatsApp)
    await expect(reserve).toHaveAttribute('target', '_blank')
    await expect(reserve).toHaveAttribute('rel', 'noopener noreferrer')

    await expect(visitor.getByRole('link', { name: 'Buy tickets', exact: true })).toHaveCount(0)
    await expect(visitor.getByRole('link', { name: 'Visit the organiser’s website' })).toHaveCount(
      0,
    )
    await expect(tickets.getByText(/\bleft\b/u)).toHaveCount(0)
    await expect(visitor.getByText(/another site|has not put any tickets/iu)).toHaveCount(0)
    // The only link off the site is the company's own WhatsApp chat, and
    // nothing on the page, its markup included, names the source site.
    expect(await outsideLinks(visitor)).toEqual([garbaWhatsApp])
    expect(await visitor.content()).not.toMatch(SOURCE)

    const structured = await structuredEvent(visitor)

    expect(structured.organizer?.name).toBe(garba.presentedBy)
    expect(structured.offers?.map((offer) => offer.name)).toEqual(
      expect.arrayContaining(['General admission', 'VIP']),
    )
    expect(JSON.stringify(structured)).not.toMatch(SOURCE)
    // The listing gives no end, so none is given.
    expect(structured.endDate).toBeUndefined()

    // Nothing redirects anywhere: the website route has no address to send to.
    const website = await visitor.request.get(`/events/${garbaEvent.slug}/website`, {
      maxRedirects: 0,
    })

    expect(website.status()).toBe(404)

    const bollywoodEvent = after[bollywood.sourceId].event

    await visitor.goto(`/events/${bollywoodEvent.slug}`)
    await expect(visitor.getByText(`Presented by ${bollywood.presentedBy}`)).toBeVisible()
    await expect(
      visitor.locator('#tickets').getByRole('link', { name: /choose tickets/iu }),
    ).toBeVisible()
    await expect(
      visitor.locator('#tickets').getByRole('link', { name: /^Reserve on WhatsApp/u }),
    ).toHaveAttribute(
      'href',
      whatsAppHref(
        bollywood.title,
        bollywoodEvent.startsAt,
        listing('bollywood').venue.name,
        'Houston',
      ),
    )

    // The cards: "From" a price read from the ticket types, as any card's is,
    // and who presents it.
    await visitor.goto(`/events?q=${encodeURIComponent(bollywood.title)}`)

    const card = visitor
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('link', { name: bollywood.title, exact: true }) })

    await expect(card).toContainText(/From\s*\$\d+\.\d{2}/u)
    await expect(card).toContainText(bollywood.presentedBy)
    await expect(card).toContainText('On sale')
    await expect(card).not.toContainText(SOURCE)

    await visitor.goto(`/events?q=${encodeURIComponent(garba.title)}`)
    await expect(
      visitor
        .getByRole('listitem')
        .filter({ has: visitor.getByRole('link', { name: garba.title, exact: true }) }),
    ).not.toContainText(/No price listed|sulekha/iu)
  })

  test('I2a: a buyer buys a ticket to an imported event through the checkout, paid by the simulated provider', async ({
    browser,
  }) => {
    test.setTimeout(150_000)

    const buyer = await windowFor(browser, 'buyer')
    const { garba } = names().listings
    const event = (await importedEvents(ids().tag))[garba.sourceId].event
    const general = event.ticketTypes.find((tier) => tier.name === 'General admission')

    await buyer.goto(`/events/${event.slug}`)
    await buyer
      .locator('#tickets')
      .getByRole('link', { name: /choose tickets/iu })
      .click()
    await expect(buyer).toHaveURL(new RegExp(`/events/${event.slug}/checkout$`, 'u'))

    await chooseOne(buyer, 'General admission')

    const held = buyer.waitForResponse(postTo('/api/v1/holds'))

    await buyer.getByRole('button', { name: 'Reserve tickets' }).click()
    expect((await held).ok()).toBe(true)

    const pay = buyer.getByRole('button', { name: /^Pay .+ \(simulated\)$/u })

    await expect(pay).toBeEnabled()

    const answered = buyer.waitForResponse(postTo('/api/v1/orders'))

    await pay.click()

    const response = await answered

    expect(response.ok(), `the order answered ${response.status()}`).toBe(true)

    const { data: order } = await response.json()

    expect(order.status).toBe('PAID')
    expect(order.tickets).toHaveLength(1)

    const booked = buyer
      .getByRole('status')
      .filter({ has: buyer.getByRole('heading', { name: 'Booked' }) })

    await expect(booked).toContainText(`Order ${order.reference} · 1 ticket`)
    await expect(booked).toContainText(
      'The payment was simulated: no card was asked for and no money moved.',
    )

    // In the database: one paid order for one ticket of the tier, with the
    // booking fee charged as for any event, and one ticket sold off the allowance.
    const [placed] = await ordersOf(event.id)

    expect(placed).toMatchObject({
      reference: order.reference,
      status: 'PAID',
      buyerEmail: names().buyerEmail,
    })
    expect(placed.items).toEqual([
      expect.objectContaining({ ticketTypeId: general.id, unitPriceCents: 2_500, quantity: 1 }),
    ])
    expect(placed.feesCents).toBeGreaterThan(0)
    expect(placed.items[0].tickets).toHaveLength(1)

    const sold = (await importedEvents(ids().tag))[garba.sourceId].event.ticketTypes.find(
      (tier) => tier.id === general.id,
    )

    expect(sold).toMatchObject({ quantitySold: 1, quantityTotal: IMPORT_ALLOWANCE })

    // The buyer's order page names the event; the event page still shows no
    // count of tickets left from the allowance.
    await buyer.goto(`/account/orders/${order.reference}`)
    await expect(buyer.locator('main')).toContainText(garba.title)

    await buyer.goto(`/events/${event.slug}`)
    await expect(buyer.locator('#tickets').getByText(/\bleft\b/u)).toHaveCount(0)

    soldOrder = { reference: order.reference, totalCents: order.totalCents, tierId: general.id }
  })

  test('I3: the same file again keeps what was published; “Update from the listing” copies a moved time with a notice, and keeps the tiers that sold', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings
    const moved = withMovedStart(dataset, garba.sourceId, HOUR_MS)
    const newStart = moved.events.find((event) => event.sourceId === garba.sourceId).startsAt
    const tiersBefore = (await importedEvents(ids().tag))[garba.sourceId].event.ticketTypes
    const planned = await uploadListing(admin, datasetUpload(moved, names().updateFileName))

    expect(planned?.status()).toBe(201)
    runs.second = (await planned.json()).data.id
    await expect(admin).toHaveURL(new RegExp(`${runPath(runs.second)}$`, 'u'))

    // The published event whose listing changed is kept unless ticked; the
    // two whose listings did not are unchanged.
    const garbaRow = planRow(admin, garba.title)

    await expect(garbaRow).toContainText('Published, kept')
    await expect(garbaRow).toContainText(
      'Already published, and its listing has changed. Tick “Update from the listing” to copy the changes onto its public page; otherwise it is left as it is.',
    )

    for (const { title } of [bollywood, concert]) {
      await expect(planRow(admin, title)).toContainText('Unchanged')
      await expect(planRow(admin, title)).toContainText(
        'The listing has not changed since it was last imported.',
      )
    }

    await expect(
      admin.getByRole('button', { name: 'Import these 2 events', exact: true }),
    ).toBeVisible()

    const tick = admin.getByRole('checkbox', { name: `Update “${garba.title}” from the listing` })

    await hydrated(tick)
    await tick.check()

    const importButton = admin.getByRole('button', { name: 'Import these 3 events', exact: true })

    await pressThroughStepUp(
      admin,
      () => importButton.click(),
      postTo(`/api/v1/platform/imports/${runs.second}/apply`),
    )
    await expect(
      admin.getByText(
        'The plan was applied. Its events wait for review: approve and publish them here.',
      ),
    ).toBeVisible()

    // In the database: the new time, with one change notice from the team at
    // The Desi Events, and the import's own audit row. The ticket types are
    // the same rows: the one a buyer bought keeps its sale and its allowance.
    const after = await importedEvents(ids().tag)
    const garbaItem = after[garba.sourceId]

    expect(garbaItem.event.status).toBe('ON_SALE')
    expect(garbaItem.event.startsAt.toISOString()).toBe(newStart)
    expect(garbaItem.event.sessions[0].startsAt.toISOString()).toBe(newStart)
    expect(garbaItem.event.websiteRedirectEnabled).toBe(false)
    expect(garbaItem.event.websiteUrl).toBeNull()
    expect(garbaItem.lastRunId).toBe(runs.second)
    expect(after[bollywood.sourceId].lastRunId).toBe(runs.second)
    expect(after[concert.sourceId].lastRunId).toBe(runs.second)
    expect(garbaItem.event.ticketTypes.map((tier) => tier.id)).toEqual(
      tiersBefore.map((tier) => tier.id),
    )
    expect(garbaItem.event.ticketTypes.find((tier) => tier.id === soldOrder.tierId)).toMatchObject({
      quantitySold: 1,
      quantityTotal: IMPORT_ALLOWANCE,
      priceCents: 2_500,
      status: 'ON_SALE',
    })

    const notices = await changeNoticesFor(garbaItem.event.id)

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'MATERIAL_CHANGE', byPlatform: true })
    expect(notices[0].reason).toContain(runs.second)
    expect(notices[0].reason).not.toMatch(SOURCE)
    expect(notices[0].changed).toContain('the start time')

    const [updated] = await auditRows(garbaItem.event.id, 'event.imported')

    expect(updated.metadata).toMatchObject({
      mode: 'UPDATE_POSTED',
      importRunId: runs.second,
      via: 'web',
    })

    // The public page shows the new time, and the WhatsApp message its day.
    await visitor.goto(`/events/${garbaItem.event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: garba.title })).toBeVisible()
    await expect(visitor.locator('main')).toContainText(plain(timeInChicago(newStart)))
    await expect(
      visitor.locator('#tickets').getByRole('link', { name: /^Reserve on WhatsApp/u }),
    ).toHaveAttribute(
      'href',
      whatsAppHref(garba.title, newStart, listing('garba').venue.name, 'Houston'),
    )

    // The runs list says what each run did.
    await admin.goto('/admin/imports')

    const table = admin.getByRole('table', { name: 'Imports, newest first' })

    await expect(table.getByRole('row').filter({ hasText: names().fileName })).toContainText(
      'New: 3',
    )

    const second = table.getByRole('row').filter({ hasText: names().updateFileName })

    await expect(second).toContainText('Published, updated: 1')
    await expect(second).toContainText('Unchanged: 2')
  })

  test('I3a: an administrator takes an unsold published import off the site and puts it back, again and again', async ({
    browser,
    visitor,
  }) => {
    test.setTimeout(240_000)

    const admin = await windowFor(browser, 'admin')
    const { bollywood } = names().listings
    const event = (await importedEvents(ids().tag))[bollywood.sourceId].event

    expect(event.status).toBe('ON_SALE')

    // The danger zone says, before the dialog, that deleting can be undone,
    // and that a restore keeps the organiser the listing names.
    await admin.goto(`/admin/events/${event.id}`)

    const zone = admin.locator('#delete-event')

    await expect(zone.getByRole('heading', { name: 'Danger zone' })).toBeVisible()
    await expect(zone).toContainText(
      'Deleting erases nothing: the event is kept, and you can put it back on the site at any time with “Restore…”, here or under “Taken off the site (deleted)” in All events, giving a reason.',
    )
    await expect(zone).toContainText(
      `This event was imported from its organiser’s listing. Restoring it brings it back with ${bollywood.presentedBy} named as its organiser.`,
    )
    await expect(zone).not.toContainText(/another site|Buy tickets/u)

    const opener = zone.getByRole('button', { name: 'Delete this event…', exact: true })

    await hydrated(opener)
    await opener.click()

    const dialog = admin.getByRole('region', { name: `Delete “${event.title}”` })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)
    await expect(dialog).toContainText('Nobody has bought a ticket to this event.')
    await dialog
      .getByLabel(/^Why is this event being deleted\?/u)
      .fill('Taken off the site while the organiser confirms the date.')
    await dialog.getByLabel(/^Type the event’s web address/u).fill(event.slug)
    await pressThroughStepUp(
      admin,
      () => dialog.getByRole('button', { name: 'Delete this event', exact: true }).click(),
      postTo(`/api/v1/events/${event.id}/delete`),
    )
    await expect(dialog.getByText('Deleted', { exact: true })).toBeVisible()

    // Off the site: its page answers as nothing there.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    // The list says where it went, and that it can be put back.
    await dialog.getByRole('link', { name: 'Back to all events', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events\?deleted=1$/u)
    await expect(
      admin.getByText(
        'Event deleted: it is off the site. It can be put back at any time from “Taken off the site (deleted)”, with “Restore…”.',
        { exact: true },
      ),
    ).toBeVisible()

    // Found among the events taken off the site that were imported.
    await admin.getByRole('link', { name: 'Taken off the site (deleted)', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events\?deleted=only$/u)
    await admin.getByRole('link', { name: 'Imported from listings', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events\?deleted=only&imported=only$/u)
    await expect(
      admin.getByText(/^These events were taken off the site\. Nothing about them was erased/u),
    ).toBeVisible()

    const listed = admin.getByRole('row').filter({ hasText: event.title })

    // On sale when it came off, so it comes back with its sales paused.
    await expect(listed).toContainText('Restores as sales paused')
    await listed.getByRole('link', { name: /^Restore…/u }).click()
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${event.id}#restore-event$`, 'u'))
    await expect(admin.getByTestId('restore-sentences')).toContainText(
      `It comes back at the same web address, /events/${event.slug}.`,
    )
    await expect(admin.getByTestId('restore-sentences')).toContainText(
      `It is still presented by ${bollywood.presentedBy}.`,
    )
    await expect(admin.getByTestId('restore-sentences')).not.toContainText(/Buy tickets/u)

    const restoreOpener = admin.getByRole('button', { name: 'Restore…', exact: true })

    await hydrated(restoreOpener)
    await restoreOpener.click()

    const restore = admin.getByRole('region', { name: `Restore “${event.title}”` })

    await restore
      .getByLabel(/^Why is this event being restored\?/u)
      .fill('The organiser confirmed the date; back on the site.')
    await pressThroughStepUp(
      admin,
      () => restore.getByRole('button', { name: 'Restore this event', exact: true }).click(),
      postTo(`/api/v1/platform/events/${event.id}/restore`),
    )
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${event.id}\\?restored=1$`, 'u'))
    await expect(admin.getByRole('status').filter({ hasText: 'Event restored' })).toHaveText(
      'Event restored: Sales paused.',
    )

    /**
     * The public page is back, presented by its organiser, with "Reserve on
     * WhatsApp" and no link anywhere else.
     *
     * @returns {Promise<void>} Resolves once checked.
     */
    async function backAgain() {
      await visitor.goto(`/events/${event.slug}`)
      await expect(visitor.getByRole('heading', { level: 1, name: bollywood.title })).toBeVisible()
      await expect(visitor.getByText(`Presented by ${bollywood.presentedBy}`)).toBeVisible()

      const href = whatsAppHref(
        bollywood.title,
        event.startsAt,
        listing('bollywood').venue.name,
        'Houston',
      )

      await expect(
        visitor.locator('#tickets').getByRole('link', { name: /^Reserve on WhatsApp/u }),
      ).toHaveAttribute('href', href)
      expect(await outsideLinks(visitor)).toEqual([href])
      expect(
        (await visitor.request.get(`/events/${event.slug}/website`, { maxRedirects: 0 })).status(),
      ).toBe(404)

      const standing = (await importedEvents(ids().tag))[bollywood.sourceId].event

      expect(standing).toMatchObject({
        status: 'SALES_PAUSED',
        slug: event.slug,
        websiteRedirectEnabled: false,
        websiteUrl: null,
      })
    }

    await backAgain()

    // And once more, through the API the screens use: off, then back.
    const before = await eventStanding(event.id)
    const off = await callThroughStepUp(admin, 'POST', `/api/v1/events/${event.id}/delete`, {
      revision: before.revision,
      reason: 'Taken off the site again while the venue is confirmed.',
      confirmSlug: event.slug,
      expectedOutcome: 'REMOVE',
    })

    expect(off.status, off.text).toBe(200)
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    const deletedRevision = (await eventStanding(event.id)).revision
    const back = await callThroughStepUp(
      admin,
      'POST',
      `/api/v1/platform/events/${event.id}/restore`,
      { revision: deletedRevision, reason: 'The venue is confirmed; back on the site.' },
    )

    expect(back.status, back.text).toBe(200)
    expect(back.data).toMatchObject({ status: 'SALES_PAUSED', slug: event.slug })
    await backAgain()

    expect(await auditRows(event.id, 'event.deleted')).toHaveLength(2)
    expect(await auditRows(event.id, 'event.restored')).toHaveLength(2)
  })

  test('I4: moving an imported event to an organiser’s organisation makes it theirs, and its owner runs it', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const owner = await windowFor(browser, 'owner')
    const { bollywood } = names().listings
    const { gammaName, gammaSlug } = names()
    const event = (await importedEvents(ids().tag))[bollywood.sourceId].event

    await admin.goto(`/admin/events/${event.id}`)

    const section = admin.getByRole('region', { name: 'Imported from a listing', exact: true })

    await expect(section).toContainText(`presented by ${bollywood.presentedBy}`)
    await expect(section).toContainText(
      'Its tickets are sold here, with simulated payment, and can be reserved on WhatsApp.',
    )

    const opener = section.getByRole('button', { name: 'Move to an organisation…', exact: true })

    await hydrated(opener)
    await opener.click()

    // The dialog says, before anything else, that the organisation is not
    // asked first, and what moving keeps.
    await expect(
      admin.getByRole('heading', { name: `Move “${event.title}” to an organisation` }),
    ).toBeFocused()
    await expect(
      section.getByText(
        'The organisation is not asked before the event moves. Agree it with them first.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(section).toContainText(
      'The event keeps its status, pictures, web address and ticket types',
    )

    const dialog = section.getByRole('form', { name: 'Move this event', exact: true })

    await dialog.getByRole('searchbox', { name: /^Find the organisation/u }).fill(gammaName)
    await dialog.getByRole('button', { name: 'Search', exact: true }).click()
    await dialog.getByRole('radio', { name: `${gammaName} (${gammaSlug})` }).check()

    const reason = 'The organiser runs this evening themselves now and sells its tickets here.'

    await dialog.getByLabel(/^Why it moves/u).fill(reason)
    await pressThroughStepUp(
      admin,
      () => dialog.getByRole('button', { name: 'Move the event', exact: true }).click(),
      postTo(`/api/v1/platform/imports/events/${event.id}/reassign`),
    )

    // What happened stays on the page once it is read again: the section that
    // held the dialog is gone, because the event is no longer held for import.
    await expect(admin.getByRole('heading', { name: 'Imported from a listing' })).toHaveCount(0)
    await expect(
      admin.getByRole('status').filter({ hasText: `Moved to ${gammaName}.` }),
    ).toContainText(
      'Its organisation now runs it, and it is no longer shown as an imported listing.',
    )

    // In the database: Import Gamma's now, its ticket types with it, and the
    // move audited.
    const item = (await importedEvents(ids().tag))[bollywood.sourceId]

    expect(item.event.organizationId).toBe(seeded.gammaOrganizationId)
    expect(item.event.status).toBe('SALES_PAUSED')
    expect(item.event.ticketTypes.map((tier) => tier.name)).toEqual(['General admission'])
    expect(item.event.websiteRedirectEnabled).toBe(false)
    expect(item.reassignedAt).not.toBeNull()
    expect(item.reassignedToOrganizationId).toBe(seeded.gammaOrganizationId)

    const [audit] = await auditRows(event.id, 'event.import_reassigned')

    expect(audit.actorId).toBe(seeded.adminId)
    expect(audit.metadata).toMatchObject({ toOrganizationId: seeded.gammaOrganizationId, reason })

    // Its page: no longer an imported listing, so no WhatsApp reservation and
    // no "as the organiser listed them" note.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: event.title })).toBeVisible()
    await expect(visitor.getByText(`Presented by ${gammaName}`)).toBeVisible()
    await expect(visitor.getByRole('link', { name: /^Reserve on WhatsApp/u })).toHaveCount(0)
    await expect(visitor.getByText(/^Prices are as the organiser listed them/u)).toHaveCount(0)
    await expect(visitor.getByRole('link', { name: 'Buy tickets', exact: true })).toHaveCount(0)

    const gone = await visitor.request.get(`/events/${event.slug}/website`, { maxRedirects: 0 })

    expect(gone.status()).toBe(404)

    // Import Gamma's owner finds it among their events and edits it.
    await owner.goto('/organizer/events')
    await expect(
      owner.getByRole('link', { name: new RegExp(event.title, 'u') }).first(),
    ).toBeVisible()

    await openStep(owner, event.id, /^step 1/iu)

    const description =
      'Bollywood hits from four decades with a live band, now run by its organiser on The Desi Events.'
    const saved = owner.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/events/${event.id}` &&
        response.ok(),
      { timeout: 45_000 },
    )

    await owner.getByLabel(/^Description/u).fill(description)
    await saved
    await expect(owner.getByTestId('save-status')).toHaveText(/^Saved at /u, { timeout: 20_000 })
  })

  test('I4a: the approve route refuses an ordinary organisation’s event waiting for review, and leaves it waiting', async ({
    browser,
  }) => {
    const admin = await windowFor(browser, 'admin')

    await admin.goto(runPath(runs.first))

    const answer = await callThroughStepUp(
      admin,
      'POST',
      `/api/v1/platform/imports/${runs.first}/approve`,
      { items: [{ eventId: seeded.waitingEventId, revision: seeded.waitingRevision }] },
    )

    expect(answer.status, answer.text).toBe(200)
    expect(answer.data.results).toEqual([
      expect.objectContaining({
        eventId: seeded.waitingEventId,
        outcome: 'REFUSED',
        code: 'NOT_IN_RUN',
      }),
    ])

    const standing = await eventStanding(seeded.waitingEventId)

    expect(standing).toEqual({
      status: 'REVIEW_PENDING',
      revision: seeded.waitingRevision,
      organizationId: seeded.gammaOrganizationId,
    })
    expect(await auditRows(seeded.waitingEventId, 'event.approved')).toEqual([])
    expect(await auditRows(seeded.waitingEventId, 'event.published')).toEqual([])
  })

  test('I5: a moderator is offered no imports and the API refuses them; nothing offers to copy pictures', async ({
    browser,
  }) => {
    const moderator = await windowFor(browser, 'moderator')
    const admin = await windowFor(browser, 'admin')

    // No Imports tab, link or page for a moderator, and the API refuses both
    // the list and an upload.
    await moderator.goto('/moderation/events')
    await expect(moderator.getByRole('link', { name: 'Imports', exact: true })).toHaveCount(0)

    await moderator.goto('/admin/imports')
    await expect(moderator.getByRole('heading', { level: 1, name: 'Not for you' })).toBeVisible()
    await expect(moderator.getByRole('form', { name: 'Plan an import' })).toHaveCount(0)

    const list = await callApi(moderator, 'GET', '/api/v1/platform/imports')
    const preview = await callApi(moderator, 'POST', '/api/v1/platform/imports', {
      fileName: 'moderator.json',
      dataset,
    })

    expect(list.status, list.text).toBe(403)
    expect(preview.status, preview.text).toBe(403)

    // Neither run page offers "Retry pictures", and the route it pressed is
    // gone: an import contacts no other site, so there is nothing to copy.
    for (const runId of [runs.first, runs.second]) {
      await admin.goto(runPath(runId))
      await expect(planTable(admin)).toBeVisible()
      await expect(admin.getByRole('button', { name: /retry pictures/iu })).toHaveCount(0)
      await expect(planTable(admin).getByRole('columnheader', { name: 'Pictures' })).toHaveCount(0)
    }

    const retry = await callThroughStepUp(
      admin,
      'POST',
      `/api/v1/platform/imports/${runs.second}/images/retry`,
      {},
    )

    expect(retry.status, retry.text).toBe(404)
  })

  test('I6: the sold imported event is taken off the site with its order refunded, simulated', async ({
    browser,
    visitor,
  }) => {
    test.setTimeout(150_000)

    const admin = await windowFor(browser, 'admin')
    const buyer = await windowFor(browser, 'buyer')
    const { garba } = names().listings
    const event = (await importedEvents(ids().tag))[garba.sourceId].event

    await admin.goto(`/admin/events/${event.id}`)

    const zone = admin.locator('#delete-event')
    const opener = zone.getByRole('button', { name: 'Delete this event…', exact: true })

    await hydrated(opener)
    await opener.click()

    const dialog = admin.getByRole('region', { name: `Delete “${event.title}”` })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)
    await expect(dialog).toContainText(
      'Payments on this site are simulated, so these refunds move no real money.',
    )
    await dialog
      .getByLabel(/^Why is this event being deleted\?/u)
      .fill('The organiser called the night off; every buyer is refunded.')
    await dialog.getByLabel(/^Type the event’s web address/u).fill(event.slug)
    await pressThroughStepUp(
      admin,
      () => dialog.getByRole('button', { name: 'Cancel, refund and delete', exact: true }).click(),
      postTo(`/api/v1/events/${event.id}/delete`),
    )
    await expect(dialog.getByText('Deleted', { exact: true })).toBeVisible()

    // In the database: deleted after being cancelled, and the order refunded
    // in full, booking fee included.
    const standing = await eventStanding(event.id)

    expect(standing.status).toBe('DELETED')

    const [refunded] = await ordersOf(event.id)

    expect(refunded).toMatchObject({ reference: soldOrder.reference, status: 'REFUNDED' })
    expect(refunded.refundedCents).toBe(soldOrder.totalCents)

    // Off the site, and the buyer's order says it was refunded.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    await buyer.goto(`/account/orders/${soldOrder.reference}`)
    await expect(buyer.locator('main')).toContainText('This order was refunded in full.')
    await expect(buyer.locator('main')).not.toContainText(SOURCE)
  })
})
