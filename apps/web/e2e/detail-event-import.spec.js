import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import {
  CATEGORY_NOTE,
  IMPORT_PICTURE_DIR,
  IMPORT_TIME_ZONE,
  addLatePicture,
  auditRows,
  buildImportDataset,
  changeNoticesFor,
  cleanupImport,
  datasetUpload,
  eventStanding,
  expireStepUp,
  importNames,
  importedEvents,
  platformHeldExists,
  preparePictures,
  seedImport,
  withMovedStart,
} from './support/seed-import.mjs'
import { PASSWORD, currentCode, forgetCodeUse } from './support/seed-refusals.mjs'
import { confirmStepUp, stepUpPrompt, waitOutCredentialBudget } from './support/step-up.mjs'

/**
 * Importing the events listed on Sulekha (SPEC2-XI area I, §9 row 12), in a
 * real browser against the real API: a platform administrator uploads a
 * listing file, reads the plan, imports it, approves and publishes what it
 * wrote, imports the file again, moves one event to an organiser's own
 * organisation, and copies a picture that came late.
 *
 * ## The story
 *
 *   - **I1** The administrator uploads the file. A file that is not JSON is
 *     refused in the browser, before anything is sent; one naming a ticket
 *     page off Sulekha is refused by the API, problem by problem. The plan
 *     lists each listing with its notes; importing it asks for a second
 *     factor. The run page then shows every event waiting for review and the
 *     one picture that could not be copied, with why.
 *   - **I2** Nothing imported is public before review. Approving two events
 *     publishes both under one second factor: each page says who presents it,
 *     the prices as Sulekha listed them and "Buy tickets on Sulekha", its
 *     website route answers a 302 to the Sulekha page, there is no buy button,
 *     and each card reads "On Sulekha from …".
 *   - **I3** The same file again plans the published events as kept or
 *     unchanged; "Update from Sulekha" on the one whose time moved copies the
 *     new time onto its public page, with a change notice.
 *   - **I4** The administrator moves a published import to Import Gamma (the
 *     dialog says the organisation is not asked first). Its Sulekha link is
 *     off afterwards and its page no longer offers "Buy tickets on Sulekha";
 *     Import Gamma's owner finds it in their events and edits it.
 *   - **I4a** The approve route, named an ordinary organisation's event
 *     waiting for review, refuses that item `NOT_IN_RUN` and leaves it as it
 *     was.
 *   - **I5** A moderator is not offered imports and the API refuses them;
 *     once the late picture is there, "Retry pictures" copies it.
 *
 * ## Who is who
 *
 * Every account is fresh (`support/seed-import.mjs`): the platform
 * administrator, the moderator and Import Gamma's owner are signed in here,
 * each in a window of its own, and no privilege of theirs changes. The
 * listing file is built when the run starts, dated 10, 11 and 12 days ahead,
 * and uploaded from memory; the pictures are read from a temporary copy of
 * `e2e/fixtures/import-images/`, which the API in this config reads instead
 * of the network.
 *
 * ## Isolation
 *
 * The imported events are, while they last, the soonest public events of the
 * detail world, so `afterAll` removes every one of them before the next spec
 * counts a list.
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

/** Whether "Sulekha Events" was there before this file imported anything. */
let heldBefore = true

/** The import runs, as the journeys make them. @type {{first?: string, second?: string}} */
const runs = {}

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
 * @param {'admin'|'moderator'|'owner'} who Which account.
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

test.describe.serial('importing the Sulekha events', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)

    const { tag } = ids()

    // Whatever a stopped attempt left under this tag goes first.
    await cleanupImport(tag)

    heldBefore = await platformHeldExists()
    seeded = await seedImport(tag)
    dataset = buildImportDataset(tag)

    await preparePictures(IMPORT_PICTURE_DIR)
    await windowFor(browser, 'admin')
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupImport(ids().tag, { removePlatformHeld: !heldBefore })
  })

  test('I1: the administrator uploads a Sulekha file, reads its plan and notes, and imports it with a second factor', async ({
    browser,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings

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

    // A ticket page off Sulekha is refused by the API's own host check, which
    // runs on every upload, and each problem is listed.
    const offList = {
      ...dataset,
      events: dataset.events.map((event) =>
        event.sourceId === garba.sourceId
          ? { ...event, ticketUrl: 'https://tickets.example.test/garba-night' }
          : event,
      ),
    }
    const refused = await uploadListing(admin, datasetUpload(offList, 'off-sulekha.json'))

    expect(refused?.status()).toBe(422)
    expect((await refused.json()).error.code).toBe('IMPORT_INVALID')
    await expect(form.getByText('The file was not planned', { exact: true })).toBeVisible()
    await expect(
      form.getByText(
        `events[0] (listing ${garba.sourceId}) ticketUrl: Use the listing's own https:// page on events.sulekha.com.`,
        { exact: true },
      ),
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

    // Every listing, what applying does to it, and the curator's notes.
    for (const { title } of [garba, bollywood, concert]) {
      const row = planRow(admin, title)

      await expect(row).toContainText('New')
      await expect(row).toContainText('Created as a draft and sent for review.')
    }

    const garbaRow = planRow(admin, garba.title)

    await expect(
      garbaRow.getByRole('listitem').filter({ hasText: '7:00 PM is imported' }),
    ).toHaveText(listing('garba').importNotes[0])
    await expect(garbaRow).toContainText(`Sulekha ${garba.sourceId} · Houston · No end time listed`)
    await expect(garbaRow).toContainText('2 listed, copied once applied')
    await expect(planRow(admin, bollywood.title)).not.toContainText('No end time listed')
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
      admin.getByText('The plan was applied. Pictures: 4 copied, 1 not copied, 0 waiting.'),
    ).toBeVisible()

    // The page, read again: every event waits for review, with its pictures.
    await expect(admin.getByText(/^Status:\s*Applied$/u).first()).toBeVisible()

    for (const { title } of [garba, bollywood, concert]) {
      const row = planRow(admin, title)

      await expect(row).toContainText('Waiting for review')
      await expect(row.getByRole('link', { name: `Review “${title}”` })).toBeVisible()
    }

    await expect(garbaRow).toContainText('Cover: Copied, waiting for approval')
    await expect(garbaRow).toContainText('Picture 2: Copied, waiting for approval')

    const concertRow = planRow(admin, concert.title)

    await expect(concertRow).toContainText('Cover: Copied, waiting for approval')
    await expect(concertRow).toContainText('Picture 2: Not copied')
    await expect(concertRow).toContainText('Sulekha answered with status 404.')

    // In the database: three drafts sent for review under "Sulekha Events",
    // which has no members, and no ticket type made from the prices.
    const events = await importedEvents(ids().tag)

    expect(Object.keys(events).sort()).toEqual(
      [garba.sourceId, bollywood.sourceId, concert.sourceId].sort(),
    )

    for (const item of Object.values(events)) {
      expect(item.event.status).toBe('REVIEW_PENDING')
      expect(item.event.organization).toEqual({
        name: 'Sulekha Events',
        platformHeldSource: 'SULEKHA',
      })
      expect(item.event._count.ticketTypes).toBe(0)
      expect(item.importedById).toBe(seeded.adminId)
      expect(item.lastRunId).toBe(runs.first)
      expect(item.event.websiteRedirectEnabled).toBe(false)

      const [audit] = await auditRows(item.event.id, 'event.imported')

      expect(audit.metadata).toMatchObject({
        mode: 'CREATE',
        sourceId: item.sourceId,
        importRunId: runs.first,
        via: 'web',
      })
    }

    expect(events[garba.sourceId].event.websiteUrl).toBe(listing('garba').ticketUrl)
    // A listing with no end stores the planning estimate, flagged as such.
    expect(events[garba.sourceId].event.sessions).toEqual([
      expect.objectContaining({ endTimeListed: false }),
    ])
    expect(events[bollywood.sourceId].event.sessions).toEqual([
      expect.objectContaining({ endTimeListed: true }),
    ])
    expect(
      events[concert.sourceId].images.map((image) => [image.status, image.failureCode]),
    ).toEqual([
      ['STORED', null],
      ['FAILED', 'HTTP_404'],
    ])
  })

  test('I2: nothing imported is public before review; approving two publishes them with their Sulekha ticket link', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings
    const before = await importedEvents(ids().tag)

    // Before review, each page answers as an address that was never an event,
    // and its website route has nothing to send anybody to.
    for (const { sourceId } of [garba, bollywood, concert]) {
      await visitor.goto(`/events/${before[sourceId].event.slug}`)
      await expect(visitor.getByTestId('not-found-view')).toBeVisible()
    }

    const unapproved = await visitor.request.get(
      `/events/${before[garba.sourceId].event.slug}/website`,
      { maxRedirects: 0 },
    )

    expect(unapproved.status()).toBe(404)

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
      `${garba.title}: approved and published, with its Sulekha ticket link on.`,
    )
    await expect(report).toContainText(
      `${bollywood.title}: approved and published, with its Sulekha ticket link on.`,
    )
    await expect(planRow(admin, garba.title)).toContainText('Published')
    await expect(planRow(admin, concert.title)).toContainText('Waiting for review')

    // In the database: published, approved by the administrator who imported
    // them under the platform's own exemption, pictures approved with them,
    // and the Sulekha link on to exactly the listing's page.
    const after = await importedEvents(ids().tag)

    for (const key of ['garba', 'bollywood']) {
      const item = after[names().listings[key].sourceId]

      expect(item.event.status).toBe('PUBLISHED')
      expect(item.approvedById).toBe(seeded.adminId)
      expect(item.event.websiteRedirectEnabled).toBe(true)
      expect(item.event.websiteDecidedUrl).toBe(listing(key).ticketUrl)
      expect(item.images.map((image) => image.mediaAsset?.moderationStatus)).toEqual(
        item.images.map(() => 'APPROVED'),
      )

      const [approved] = await auditRows(item.event.id, 'event.approved')

      expect(approved.actorId).toBe(seeded.adminId)
      expect(approved.metadata).toMatchObject({
        via: 'import',
        exemption: 'PLATFORM_HELD_IMPORT',
        importedById: seeded.adminId,
        approvedById: seeded.adminId,
      })
    }

    expect(after[concert.sourceId].event.status).toBe('REVIEW_PENDING')

    // The public pages: who presents it, Sulekha's prices, and Sulekha's
    // ticket link through Desi-Event's redirect; never a buy button here.
    const garbaEvent = after[garba.sourceId].event

    await visitor.goto(`/events/${garbaEvent.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: garba.title })).toBeVisible()
    await expect(visitor.getByText(`Presented by ${garba.presentedBy}`)).toBeVisible()

    const tickets = visitor.locator('#tickets')

    await expect(tickets).toContainText(
      'Tickets for this event are sold on Sulekha, not on Desi-Event.',
    )
    await expect(tickets).toContainText(
      `As listed on Sulekha on ${listedOn(listing('garba').scrapedAt)}: General admission $25.00, VIP $40.00, Child (under 12) Free.`,
    )

    const buy = tickets.getByRole('link', { name: 'Buy tickets on Sulekha', exact: true })

    await expect(buy).toHaveAttribute('href', `/events/${garbaEvent.slug}/website`)
    await expect(tickets).toContainText(
      'Opens events.sulekha.com, which Desi-Event does not run. Desi-Event counts the visit without recording your address, browser or account.',
    )
    await expect(visitor.getByRole('link', { name: /choose tickets/iu })).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: /choose tickets/iu })).toHaveCount(0)
    await expect(visitor.getByText(/not on sale|has not put any tickets/iu)).toHaveCount(0)
    // Pictures are Desi-Event's own copies: no page names Sulekha's picture host.
    expect(await visitor.content()).not.toContain('usimg.sulekha.io')

    const structured = await structuredEvent(visitor)

    expect(structured.organizer?.name).toBe(garba.presentedBy)
    expect(structured.offers).toBeUndefined()
    // Sulekha lists no end, so none is given.
    expect(structured.endDate).toBeUndefined()

    const bollywoodEvent = after[bollywood.sourceId].event

    await visitor.goto(`/events/${bollywoodEvent.slug}`)
    await expect(visitor.getByText(`Presented by ${bollywood.presentedBy}`)).toBeVisible()
    await expect(visitor.locator('#tickets')).toContainText(
      `As listed on Sulekha on ${listedOn(listing('bollywood').scrapedAt)}: General admission $30.00.`,
    )
    await expect(
      visitor
        .locator('#tickets')
        .getByRole('link', { name: 'Buy tickets on Sulekha', exact: true }),
    ).toBeVisible()

    // The redirect, asked without following it: a 302 to the Sulekha page.
    // A request with no fetch metadata is never counted as a visit.
    const redirect = await visitor.request.get(`/events/${garbaEvent.slug}/website`, {
      maxRedirects: 0,
    })

    expect(redirect.status()).toBe(302)
    expect(redirect.headers().location).toBe(listing('garba').ticketUrl)
    expect(redirect.headers()['cache-control']).toContain('no-store')

    // The cards: "On Sulekha from" the lowest price above zero, so a free
    // child's ticket never makes it "from $0.00", and who presents it.
    for (const [key, price] of [
      ['garba', '$25.00'],
      ['bollywood', '$30.00'],
    ]) {
      const { title, presentedBy } = names().listings[key]

      await visitor.goto(`/events?q=${encodeURIComponent(title)}`)

      const card = visitor
        .getByRole('listitem')
        .filter({ has: visitor.getByRole('link', { name: title, exact: true }) })

      await expect(card).toContainText(`On Sulekha from ${price}`)
      await expect(card).toContainText(presentedBy)
      await expect(card).not.toContainText('$0.00')
    }
  })

  test('I3: the same file again keeps what was published; “Update from Sulekha” copies a moved time with a notice', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { garba, bollywood, concert } = names().listings
    const moved = withMovedStart(dataset, garba.sourceId, HOUR_MS)
    const newStart = moved.events.find((event) => event.sourceId === garba.sourceId).startsAt
    const planned = await uploadListing(admin, datasetUpload(moved, names().updateFileName))

    expect(planned?.status()).toBe(201)
    runs.second = (await planned.json()).data.id
    await expect(admin).toHaveURL(new RegExp(`${runPath(runs.second)}$`, 'u'))

    // The published event whose listing changed is kept unless ticked; the
    // two whose listings did not are unchanged.
    const garbaRow = planRow(admin, garba.title)

    await expect(garbaRow).toContainText('Published, kept')
    await expect(garbaRow).toContainText(
      'Already published, and its listing has changed. Tick “Update from Sulekha” to copy the changes onto its public page; otherwise it is left as it is.',
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

    const tick = admin.getByRole('checkbox', { name: `Update “${garba.title}” from Sulekha` })

    await hydrated(tick)
    await tick.check()

    const importButton = admin.getByRole('button', { name: 'Import these 3 events', exact: true })

    await pressThroughStepUp(
      admin,
      () => importButton.click(),
      postTo(`/api/v1/platform/imports/${runs.second}/apply`),
    )
    await expect(
      admin.getByText('The plan was applied. Pictures: 4 copied, 1 not copied, 0 waiting.'),
    ).toBeVisible()

    // In the database: the new time, with one change notice from the
    // Desi-Event team, and the import's own audit row.
    const after = await importedEvents(ids().tag)
    const garbaItem = after[garba.sourceId]

    expect(garbaItem.event.status).toBe('PUBLISHED')
    expect(garbaItem.event.startsAt.toISOString()).toBe(newStart)
    expect(garbaItem.event.sessions[0].startsAt.toISOString()).toBe(newStart)
    expect(garbaItem.event.websiteRedirectEnabled).toBe(true)
    expect(garbaItem.lastRunId).toBe(runs.second)
    expect(after[bollywood.sourceId].lastRunId).toBe(runs.second)
    expect(after[concert.sourceId].lastRunId).toBe(runs.second)

    const notices = await changeNoticesFor(garbaItem.event.id)

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      kind: 'MATERIAL_CHANGE',
      byPlatform: true,
      reason: `Updated from its Sulekha listing by the Desi-Event team, run ${runs.second}.`,
    })
    expect(notices[0].changed).toContain('the start time')

    const [updated] = await auditRows(garbaItem.event.id, 'event.imported')

    expect(updated.metadata).toMatchObject({
      mode: 'UPDATE_POSTED',
      importRunId: runs.second,
      via: 'web',
    })

    // The public page shows the new time.
    await visitor.goto(`/events/${garbaItem.event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: garba.title })).toBeVisible()
    await expect(visitor.locator('main')).toContainText(plain(timeInChicago(newStart)))

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

  test('I4: moving an imported event to an organiser’s organisation turns its Sulekha link off, and its owner runs it', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const owner = await windowFor(browser, 'owner')
    const { bollywood } = names().listings
    const { gammaName, gammaSlug } = names()
    const event = (await importedEvents(ids().tag))[bollywood.sourceId].event

    await admin.goto(`/admin/events/${event.id}`)

    const section = admin.getByRole('region', { name: 'Copied from Sulekha', exact: true })

    await expect(section).toContainText(`presented by ${bollywood.presentedBy}`)

    const opener = section.getByRole('button', { name: 'Move to an organisation…', exact: true })

    await hydrated(opener)
    await opener.click()

    // The dialog says, before anything else, that the organisation is not
    // asked first.
    await expect(
      admin.getByRole('heading', { name: `Move “${event.title}” to an organisation` }),
    ).toBeFocused()
    await expect(
      section.getByText(
        'The organisation is not asked before the event moves. Agree it with them first.',
        { exact: true },
      ),
    ).toBeVisible()

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
    await expect(admin.getByRole('heading', { name: 'Copied from Sulekha' })).toHaveCount(0)
    await expect(
      admin.getByRole('status').filter({ hasText: `Moved to ${gammaName}.` }),
    ).toBeVisible()

    // In the database: Import Gamma's now, its Sulekha link off with the
    // move's reason, and the move audited.
    const item = (await importedEvents(ids().tag))[bollywood.sourceId]

    expect(item.event.organizationId).toBe(seeded.gammaOrganizationId)
    expect(item.event.status).toBe('PUBLISHED')
    expect(item.event.websiteRedirectEnabled).toBe(false)
    expect(item.reassignedAt).not.toBeNull()
    expect(item.reassignedToOrganizationId).toBe(seeded.gammaOrganizationId)

    const [audit] = await auditRows(event.id, 'event.import_reassigned')

    expect(audit.actorId).toBe(seeded.adminId)
    expect(audit.metadata).toMatchObject({
      toOrganizationId: seeded.gammaOrganizationId,
      reason,
      websiteLinkTurnedOff: true,
    })

    // Its page: no longer a Sulekha listing, and no Sulekha ticket link.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: event.title })).toBeVisible()
    await expect(visitor.getByText(`Presented by ${gammaName}`)).toBeVisible()
    await expect(visitor.getByRole('link', { name: 'Buy tickets on Sulekha' })).toHaveCount(0)
    // The ticket box no longer reads as a Sulekha listing: no "sold on Sulekha"
    // panel and no listed prices. (The terms the import wrote stay as they
    // were, for the new owner to change: SPEC2-XI I-F moves nothing else.)
    await expect(
      visitor.getByText('Tickets for this event are sold on Sulekha, not on Desi-Event.', {
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(visitor.getByText(/^As listed on Sulekha on /u)).toHaveCount(0)

    const gone = await visitor.request.get(`/events/${event.slug}/website`, { maxRedirects: 0 })

    expect(gone.status()).toBe(404)

    // Import Gamma's owner finds it among their events and edits it.
    await owner.goto('/organizer/events')
    await expect(
      owner.getByRole('link', { name: new RegExp(event.title, 'u') }).first(),
    ).toBeVisible()

    await openStep(owner, event.id, /^step 1/iu)

    const description =
      'Bollywood hits from four decades with a live band, now run by its organiser on Desi-Event.'
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

  test('I5: a moderator is offered no imports and the API refuses them; “Retry pictures” copies the late picture', async ({
    browser,
  }) => {
    const moderator = await windowFor(browser, 'moderator')
    const admin = await windowFor(browser, 'admin')
    const { concert } = names().listings

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

    // The late picture is on Sulekha now. "Retry pictures" copies it, waiting
    // for approval with the rest of its event.
    await addLatePicture(IMPORT_PICTURE_DIR)
    await admin.goto(runPath(runs.second))

    const concertRow = planRow(admin, concert.title)

    await expect(concertRow).toContainText('Picture 2: Not copied')

    const retry = admin.getByRole('button', { name: 'Retry pictures', exact: true })

    await hydrated(retry)
    await pressThroughStepUp(
      admin,
      () => retry.click(),
      postTo(`/api/v1/platform/imports/${runs.second}/images/retry`),
    )
    await expect(
      admin.getByText('Pictures were tried again. Pictures: 5 copied, 0 not copied, 0 waiting.'),
    ).toBeVisible()
    await expect(concertRow).toContainText('Picture 2: Copied, waiting for approval')
    await expect(admin.getByRole('button', { name: 'Retry pictures', exact: true })).toHaveCount(0)

    const item = (await importedEvents(ids().tag))[concert.sourceId]

    expect(item.images.map((image) => [image.status, image.mediaAsset?.moderationStatus])).toEqual([
      ['STORED', 'PENDING'],
      ['STORED', 'PENDING'],
    ])
    expect(item.event.status).toBe('REVIEW_PENDING')
  })
})
