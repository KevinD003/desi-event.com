import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import { solidPng } from './support/images.mjs'
import {
  CONTROL_TIME_ZONE,
  DELETED_REASON,
  auditFor,
  cleanupFullControl,
  eventRow,
  fullControlNames,
  openDoorsAnHourAgo,
  ordersOf,
  seedFullControl,
} from './support/seed-full-control.mjs'
import { confirmStepUp, stepUpPrompt } from './support/step-up.mjs'

/**
 * Full control of a posted event (SPEC2-XI area X), in a real browser against
 * the real API: its organisers edit it in place, re-price it, add pictures
 * that wait for the Desi-Event team, cancel one night and delete it; the
 * Desi-Event team edits somebody else's event in a reasoned sitting, cancels a
 * night of it and deletes it, and restores one that was deleted.
 *
 * ## The story
 *
 *   1. The owner edits a live event in place: its words autosave, and its
 *      start moves through the callout that asks for a reason. The public page
 *      shows the new time, and the buyer's order shows the change.
 *   2. The owner re-prices a tier that has sold: the next buyer pays the new
 *      price, the buyer's order keeps what it paid.
 *   3. A new gallery picture and a new cover on a posted event wait for the
 *      Desi-Event team; the old cover stays on the page until an administrator
 *      approves both, and is then gone.
 *   4. The owner cancels one night of three: its order is refunded, the
 *      every-night pass is told and kept, the public page marks the night, and
 *      the event manager is not offered the cancellation. Once night 1's doors
 *      have opened, night 1 can no longer be cancelled and the last night
 *      still can.
 *   5. The event manager deletes an unsold event, and is told who decides for
 *      a sold one.
 *   6. The owner deletes a sold event: every order is refunded, the address
 *      stays retired, and the buyer is told.
 *   7. A platform administrator opens a sitting on another organisation's
 *      event, edits its words, cancels a night and adds a picture a moderator
 *      approves; the organiser sees what changed and why, never by whom.
 *   8. The administrator deletes that event, refunding it, and restores a
 *      deleted one, which comes back paused until its organiser opens sales.
 *   9. What the Desi-Event team is refused: a draft, a write without a
 *      sitting or from another browser, an ended sitting, and the
 *      organiser's own lifecycle moves.
 *  10. A super administrator edits, cancels a night of and deletes another
 *      organisation's event the same way, each write audited as the
 *      platform's.
 *
 * ## Who is who
 *
 * Every account is fresh (`support/seed-full-control.mjs`): the organisers,
 * the buyer, the platform administrator and the moderator are signed in here,
 * each in its own window, and no privilege of theirs changes. The super
 * administrator is the saved `platform` session: it opens a sitting and
 * deletes an event of the seed's own, which changes nobody's privileges.
 *
 * ## Orders
 *
 * The buyer buys every ticket through the real checkout, in `beforeAll`: a
 * refund goes back to the payment the order was paid with, and the simulated
 * payment provider knows only the payments its own process took.
 *
 * No show-once code is drawn on any page here, so screenshots, traces and
 * video keep the config's defaults. Step-ups are one-time codes from the
 * seeded factor (`support/step-up.mjs`).
 *
 * @module e2e/detail-event-full-control
 */

/** Every context this file opened, closed in `afterAll`. @type {object[]} */
const contexts = []

/** The seeded ids. @type {object} */
let seeded
/** Each signed-in window, opened the first time a journey asks. */
const windows = {}
/** The buyer's orders, by what they were for. @type {Record<string, {reference: string, totalCents: number}>} */
const bought = {}
/** The live event's title once the owner renames it. @type {string} */
let liveTitle

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
const names = () => fullControlNames(ids().tag)

/** An amount as the site writes it. */
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * An amount in cents, as the site writes it.
 *
 * @param {number} cents The amount.
 * @returns {string} For example `$37.45`.
 */
function dollars(cents) {
  return USD.format(cents / 100)
}

/**
 * An instant's date and time in the events' zone, as change notices write it.
 *
 * @param {Date|string} value The instant.
 * @returns {string} For example `Tue, Dec 8, 2026, 5:00 PM`.
 */
function whenInChicago(value) {
  const at = new Date(value)
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: CONTROL_TIME_ZONE,
  }).format(at)

  return `${date}, ${timeInChicago(at)}`
}

/**
 * An instant's time of day in the events' zone.
 *
 * @param {Date|string} value The instant.
 * @returns {string} For example `5:00 PM`.
 */
function timeInChicago(value) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CONTROL_TIME_ZONE,
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
 * A window signed in as one of the seed's accounts, opened the first time it
 * is asked for and kept for the rest of the file.
 *
 * @param {object} browser The browser under test.
 * @param {'owner'|'manager'|'otherOwner'|'buyer'|'admin'|'moderator'} who Which account.
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
 * @param {Record<string, string>} [headers] Extra request headers.
 * @returns {Promise<{status: number, code: string|null, message: string|null, data: object|null, text: string}>} What came back.
 */
function callApi(page, method, path, body, headers = {}) {
  return page.evaluate(
    async ({ method: verb, path: address, body: sent, headers: extra }) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
      const response = await fetch(address, {
        method: verb,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
          ...extra,
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
        message: parsed?.error?.message ?? null,
        data: parsed?.data ?? null,
        text,
      }
    },
    { method, path, body, headers },
  )
}

/**
 * Buy one ticket the way the checkout does: hold it, price the basket, and
 * place the order with the quoted total, paid by the simulated provider.
 *
 * @param {object} page The buyer's page, signed in, on any page of the site.
 * @param {object} event The event's ids.
 * @param {string} ticketTypeId The tier.
 * @returns {Promise<{reference: string, totalCents: number}>} The paid order.
 */
async function buyTicket(page, event, ticketTypeId) {
  const items = [{ ticketTypeId, quantity: 1 }]
  const hold = await callApi(page, 'POST', '/api/v1/holds', { ticketTypeId, quantity: 1 })

  expect(hold.status, hold.text).toBe(201)

  const holdIds = [hold.data.id]
  const quote = await callApi(page, 'POST', '/api/v1/orders/quote', {
    eventId: event.id,
    items,
    holdIds,
  })

  expect(quote.status, quote.text).toBe(200)

  const order = await callApi(
    page,
    'POST',
    '/api/v1/orders',
    {
      eventId: event.id,
      buyerEmail: names().buyerEmail,
      buyerName: names().buyerName,
      items,
      holdIds,
      expectedTotalCents: quote.data.totalCents,
    },
    { 'idempotency-key': `control-${ids().tag}-${ticketTypeId}-${Date.now()}` },
  )

  expect(order.status, order.text).toBe(201)
  expect(order.data.status).toBe('PAID')

  return { reference: order.data.reference, totalCents: order.data.totalCents }
}

/**
 * A row's action link in "All events", named for its row's event.
 *
 * The event's title is in the link's name for a screen reader, after the
 * visible words; Chromium reads the hidden part as a separate run of text, so
 * a space may sit between the two.
 *
 * @param {object} page A platform administrator's page, on `/admin/events`.
 * @param {string} action "Open in the editor", "Delete…", "Open its record" or "Restore…".
 * @param {string} title The event's title.
 * @returns {object} The link's locator.
 */
function rowAction(page, action, title) {
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  return page.getByRole('link', {
    name: new RegExp(`^${escaped(action)}\\s*:?\\s*${escaped(title)}$`, 'u'),
  })
}

/**
 * Open an event's editor on one step.
 *
 * @param {object} page The editor's page.
 * @param {string} eventId Which event.
 * @param {RegExp} step The step button's name.
 * @param {string} [base] `/organizer/events` or `/admin/events`.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openStep(page, eventId, step, base = '/organizer/events') {
  await page.goto(`${base}/${eventId}`)
  // The step buttons answer only once the editor has hydrated.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  // In the steps nav: a step's own buttons can share its name.
  const button = page
    .getByRole('navigation', { name: 'Editor steps' })
    .getByRole('button', { name: step })

  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

/**
 * Make a change in the editor and wait for it to save.
 *
 * The editor's status may already read "Saved at …" from an earlier change,
 * so the wait is for the save request itself. Under the Desi-Event team's
 * authority a save can stop for a second factor (every 10 minutes): the
 * prompt is answered, and the editor sends the same change again.
 *
 * @param {object} page The editor's page.
 * @param {string} eventId The event being edited.
 * @param {Function} change Makes the change.
 * @returns {Promise<void>} Resolves once saved.
 */
async function savedAfter(page, eventId, change) {
  await pressThroughStepUp(
    page,
    change,
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === `/api/v1/events/${eventId}`,
  )
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved at /u, { timeout: 20_000 })
}

/**
 * Press a control whose request may be refused for a second factor, answer
 * the prompt if it comes, and wait for the request to succeed.
 *
 * @param {object} page The page.
 * @param {Function} press Presses the control.
 * @param {Function} matches Whether a response is the one the control sends.
 * @returns {Promise<object>} The successful response.
 */
async function pressThroughStepUp(page, press, matches) {
  const succeeded = page.waitForResponse((response) => matches(response) && response.ok(), {
    timeout: 45_000,
  })

  await press()

  const first = await Promise.race([
    succeeded.then(() => 'done'),
    stepUpPrompt(page)
      .waitFor({ state: 'visible', timeout: 45_000 })
      .then(() => 'prompted'),
  ])

  if (first === 'prompted') await confirmStepUp(page)

  return succeeded
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
 * One night's card in the Sessions step.
 *
 * @param {object} page The editor's page.
 * @param {number} number Which night, from 1.
 * @returns {object} The card's locator.
 */
function nightCard(page, number) {
  return page
    .getByRole('region', { name: 'Sessions', exact: true })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: new RegExp(`^Night ${number}\\b`, 'u') }) })
}

/**
 * Cancel one night through its dialog, answering the step-up if asked.
 *
 * @param {object} page The editor's page, on the Sessions step.
 * @param {string} eventId The event.
 * @param {string} sessionId The night.
 * @param {number} number Which night, from 1.
 * @param {string} reason Why.
 * @returns {Promise<object>} The dialog's region.
 */
async function cancelNight(page, eventId, sessionId, number, reason) {
  await nightCard(page, number).getByRole('button', { name: 'Cancel this night…' }).click()

  const dialog = page.getByRole('region', { name: /^Cancel the night of /u })

  await expect(dialog.getByLabel(/^Why is this night being cancelled\?/u)).toBeVisible()
  await dialog.getByLabel(/^Why is this night being cancelled\?/u).fill(reason)
  await dialog.getByLabel(/^I understand these orders are refunded/u).check()
  await pressThroughStepUp(
    page,
    () => dialog.getByRole('button', { name: 'Cancel this night and refund it' }).click(),
    postTo(`/api/v1/events/${eventId}/sessions/${sessionId}/cancel`),
  )
  await expect(dialog.getByText('Night cancelled', { exact: true })).toBeVisible()

  return dialog
}

/**
 * Open the delete dialog on the page and wait for its preview.
 *
 * @param {object} page A page with the danger zone on it.
 * @param {string} title The event's title.
 * @returns {Promise<object>} The dialog's region.
 */
async function openDeleteDialog(page, title) {
  await page.getByRole('button', { name: 'Delete this event…', exact: true }).click()

  const dialog = page.getByRole('region', { name: `Delete “${title}”` })

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)

  return dialog
}

/**
 * Fill the delete dialog and send it, answering the step-up if asked.
 *
 * @param {object} page The page.
 * @param {object} dialog The dialog's region.
 * @param {object} event The event's ids.
 * @param {object} options What to type.
 * @param {string} options.reason Why.
 * @param {string} options.button The submit button's name.
 * @param {string} [options.typed] What to type as the web address; the slug by default.
 * @returns {Promise<void>} Resolves once deleted.
 */
async function deleteThrough(page, dialog, event, { reason, button, typed = event.slug }) {
  await dialog.getByLabel(/^Why is this event being deleted\?/u).fill(reason)
  await dialog.getByLabel(/^Type the event’s web address/u).fill(typed)
  await pressThroughStepUp(
    page,
    () => dialog.getByRole('button', { name: button, exact: true }).click(),
    postTo(`/api/v1/events/${event.id}/delete`),
  )
  await expect(dialog.getByText('Deleted', { exact: true })).toBeVisible()
}

/**
 * Open a sitting on another organisation's event from its admin page.
 *
 * @param {object} page A platform administrator's page, on `/admin/events/<id>`.
 * @param {string} reason Why.
 * @param {string} [heading] The form's heading: "Open it again" once a sitting has ended.
 * @returns {Promise<void>} Resolves once the editor is under the sitting.
 */
async function openSitting(page, reason, heading = 'Edit this event as the Desi-Event team') {
  const form = page.getByRole('region', { name: heading, exact: true })

  await form.getByLabel(/^Why are you editing this event\?/u).fill(reason)
  await pressThroughStepUp(
    page,
    () => form.getByRole('button', { name: 'Open for editing', exact: true }).click(),
    (response) =>
      response.request().method() === 'POST' &&
      /^\/api\/v1\/platform\/events\/[^/]+\/edit$/u.test(new URL(response.url()).pathname),
  )
  await expect(page.getByText('Editing as the Desi-Event team').first()).toBeVisible()
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()
}

/**
 * Click a step in an editor already on the page.
 *
 * @param {object} page The editor's page.
 * @param {RegExp} step The step button's name.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function toStep(page, step) {
  const button = page
    .getByRole('navigation', { name: 'Editor steps' })
    .getByRole('button', { name: step })

  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

/**
 * One of the Media step's upload forms, by its heading.
 *
 * @param {object} page The editor's page.
 * @param {string} title "Replace the cover" or "Add a gallery picture".
 * @returns {object} The form's locator.
 */
function uploadForm(page, title) {
  return page.getByRole('form', { name: title, exact: true })
}

/**
 * Upload one picture through a form and wait for the API to store it.
 *
 * @param {object} page The editor's page.
 * @param {string} eventId The event.
 * @param {object} form The upload form.
 * @param {Buffer} buffer The PNG.
 * @param {string} description What it shows.
 * @returns {Promise<string>} The stored picture's id.
 */
async function uploadPicture(page, eventId, form, buffer, description) {
  await form.getByLabel(/^Picture file/u).setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer,
  })
  await form.getByLabel(/^Describe the picture/u).fill(description)

  // A platform upload can stop for a second factor; the prompt is answered
  // and the editor sends the same picture again.
  const stored = await pressThroughStepUp(
    page,
    () => form.getByRole('button', { name: 'Upload', exact: true }).click(),
    postTo(`/api/v1/events/${eventId}/media`),
  )

  return (await stored.json()).data.id
}

test.describe.serial('full control of posted events', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)

    seeded = await seedFullControl(ids().tag)

    // Every ticket is bought through the checkout, so each refund has the
    // payment it goes back to.
    const buyer = await windowFor(browser, 'buyer')
    const { events } = seeded

    await buyer.goto('/account')

    bought.liveFirst = await buyTicket(buyer, events.liveSold, events.liveSold.tiers[0])
    bought.liveSecond = await buyTicket(buyer, events.liveSold, events.liveSold.tiers[0])
    bought.nightOne = await buyTicket(buyer, events.multiNight, events.multiNight.tiers[0])
    bought.nightTwo = await buyTicket(buyer, events.multiNight, events.multiNight.tiers[1])
    bought.nightThree = await buyTicket(buyer, events.multiNight, events.multiNight.tiers[2])
    bought.pass = await buyTicket(buyer, events.multiNight, events.multiNight.passTierId)

    for (const key of ['soldA', 'soldB', 'soldC']) {
      bought[key] = await buyTicket(buyer, events.soldToDelete, events.soldToDelete.tiers[0])
    }

    bought.otherA = await buyTicket(buyer, events.otherLive, events.otherLive.tiers[0])
    bought.otherB = await buyTicket(buyer, events.otherLive, events.otherLive.tiers[1])
    bought.superA = await buyTicket(buyer, events.otherSuper, events.otherSuper.tiers[0])
    bought.superB = await buyTicket(buyer, events.otherSuper, events.otherSuper.tiers[1])

    await windowFor(browser, 'owner')
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupFullControl(ids().tag)
  })

  test('journey 1: the owner edits a live event in place, and the buyer sees what moved', async ({
    browser,
    visitor,
  }) => {
    const owner = await windowFor(browser, 'owner')
    const buyer = await windowFor(browser, 'buyer')
    const event = seeded.events.liveSold
    const description =
      'Four hours of garba and dandiya raas on a sprung floor, with a live dhol ensemble and sticks lent at the door.'

    liveTitle = `${event.title} (Rescheduled)`

    // Its words save as they are typed, live as it is.
    await openStep(owner, event.id, /^step 1/iu)
    await expect(owner.getByText('This event is public').first()).toBeVisible()
    await savedAfter(owner, event.id, async () => {
      await owner.getByLabel(/^Title/u).fill(liveTitle)
      await owner.getByLabel(/^Description/u).fill(description)
    })
    await expect
      .poll(async () => {
        const renamed = await eventRow(event.id)

        return [renamed.title, renamed.description]
      })
      .toEqual([liveTitle, description])

    // The start is changed in the step itself; it waits in a callout for a
    // reason, and only then saves.
    await toStep(owner, /^step 2/iu)

    const starts = owner.getByRole('region', { name: 'When and where' }).getByLabel(/^Starts/u)

    await expect(starts).toBeEnabled()

    const before = await starts.inputValue()
    const [day, clock] = before.split('T')
    const hour = Number(clock.slice(0, 2))
    const earlier = `${day}T${String(hour - 1).padStart(2, '0')}${clock.slice(2)}`
    const oldStart = (await eventRow(event.id)).startsAt

    await starts.fill(earlier)

    const callout = owner.getByRole('region', {
      name: 'Not saved: a change to the date, place or terms',
    })

    await expect(callout).toContainText('You changed the start time.')
    await callout.getByRole('button', { name: 'Confirm these changes…' }).click()

    const panel = owner.getByRole('region', {
      name: 'Confirm the change to the date, place or terms',
    })
    const reason = 'The hall asked us to start an hour earlier this year.'

    await panel.getByLabel(/^Why this is changing/u).fill(reason)
    await panel.getByLabel(/^I understand this changes what people bought/u).check()

    const patched = owner.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/events/${event.id}`,
    )

    await panel.getByRole('button', { name: 'Confirm and save' }).click()
    expect((await patched).status()).toBe(200)
    await expect(panel).toHaveCount(0)
    await expect(owner.getByTestId('save-status')).toHaveText(
      /a notice has been recorded for every current order/iu,
    )

    const moved = await eventRow(event.id)

    expect(new Date(oldStart).getTime() - new Date(moved.startsAt).getTime()).toBe(3_600_000)

    // The public page shows the new time.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: liveTitle })).toBeVisible()
    await expect(visitor.locator('main')).toContainText(plain(timeInChicago(moved.startsAt)))

    // The buyer's order says what changed, from and to, and why.
    await buyer.goto(`/account/orders/${bought.liveFirst.reference}`)

    const changes = buyer.getByRole('region', { name: 'Changes since you bought' })

    await expect(changes).toContainText(
      plain(`The start time: ${whenInChicago(oldStart)} → ${whenInChicago(moved.startsAt)}`),
    )
    await expect(changes).toContainText(`Reason given: ${reason}`)
    await expect(changes).toContainText('Changed by the organiser.')
  })

  test('journey 2: re-pricing a sold tier charges the next buyer, and the buyer keeps what they paid', async ({
    browser,
    visitor,
  }) => {
    const owner = await windowFor(browser, 'owner')
    const buyer = await windowFor(browser, 'buyer')
    const event = seeded.events.liveSold

    await openStep(owner, event.id, /^step 4/iu)

    const tier = owner
      .getByRole('region', { name: 'Tickets', exact: true })
      .getByRole('listitem')
      .filter({ hasText: /^General admission/u })

    await expect(tier).toContainText('Face value $35.00')
    await tier.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(tier.getByLabel(/^Face value/u)).toBeEnabled()
    await expect(tier).toContainText(
      'People who already bought keep what they paid: 2 sold at $35.00. A new price applies to the next buyer.',
    )
    await tier.getByLabel(/^Face value/u).fill('40.00')
    await tier.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(owner.getByText('Saved "General admission".')).toBeVisible()
    await expect(tier).toContainText('Face value $40.00')

    expect((await eventRow(event.id)).ticketTypes[0].priceCents).toBe(4_000)

    // The next buyer is offered $40.00.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.locator('main')).toContainText('$40.00')
    await expect(visitor.locator('main')).not.toContainText('$35.00')

    // Somebody who already bought kept their price.
    await buyer.goto(`/account/orders/${bought.liveFirst.reference}`)
    await expect(buyer.locator('main')).toContainText('1 × $35.00')

    const [line] = (await ordersOf(event.id))[0].items

    expect(line.unitPriceCents).toBe(3_500)
  })

  test('journey 3: pictures on a posted event wait for the Desi-Event team, and the old cover stays until then', async ({
    browser,
    visitor,
  }) => {
    const owner = await windowFor(browser, 'owner')
    const event = seeded.events.withCover
    const { coverAlt } = names()
    const newCoverAlt = 'Dancers in a ring under a marigold arch'
    const galleryAlt = 'The dhol players warming up beside the stage'

    await openStep(owner, event.id, /^step 6\s*media$/iu)
    await expect(
      owner.getByText(/each new picture waits for the Desi-Event team/u).first(),
    ).toBeVisible()

    const coverId = await uploadPicture(
      owner,
      event.id,
      uploadForm(owner, 'Replace the cover'),
      solidPng(1200, 630, { rgb: [180, 70, 120] }),
      newCoverAlt,
    )
    const galleryId = await uploadPicture(
      owner,
      event.id,
      uploadForm(owner, 'Add a gallery picture'),
      solidPng(400, 400, { rgb: [60, 120, 90] }),
      galleryAlt,
    )

    // Both wait; the current cover stays beside the new one.
    await expect(owner.getByRole('listitem', { name: 'The current cover' })).toBeVisible()
    await expect(
      owner.getByRole('listitem', { name: 'The new cover, waiting for approval' }),
    ).toContainText('Waiting for approval')
    await expect(owner.getByRole('listitem', { name: 'Picture 1 of 1' })).toContainText(
      'Waiting for approval',
    )

    // The public page still shows the old cover, and no gallery picture.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('img', { name: coverAlt }).first()).toBeVisible()
    await expect(visitor.getByRole('img', { name: newCoverAlt })).toHaveCount(0)
    await expect(visitor.getByRole('img', { name: galleryAlt })).toHaveCount(0)

    // The administrator finds both in the queue, the new cover beside the one
    // it replaces, and approves them.
    const admin = await windowFor(browser, 'admin')

    await admin.goto('/moderation/pictures')
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Pictures waiting for a decision' }),
    ).toBeVisible()

    const newCover = admin
      .getByRole('listitem', { name: 'New cover' })
      .filter({ hasText: newCoverAlt })
    const queued = admin.locator('main ol > li').filter({ has: newCover })

    await expect(queued).toContainText('Replaces the current cover')
    await expect(
      queued.getByRole('img', { name: `The current cover of ${event.title}` }),
    ).toBeVisible()
    await expect(queued.getByRole('img', { name: newCoverAlt })).toBeVisible()
    await expect(queued).toContainText('Uploaded by the organisation')

    for (const id of [coverId, galleryId]) {
      const card = admin
        .getByRole('listitem')
        .filter({ hasText: id === coverId ? newCoverAlt : galleryAlt })
        .filter({ has: admin.getByRole('button', { name: 'Approve this picture' }) })
        .last()

      await pressThroughStepUp(
        admin,
        () => card.getByRole('button', { name: 'Approve this picture' }).click(),
        postTo(`/api/v1/moderation/media/${id}/decision`),
      )
    }

    // The new cover took the old one's place, and the gallery picture is up.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByRole('img', { name: newCoverAlt }).first()).toBeVisible()
    await expect(visitor.getByRole('img', { name: galleryAlt }).first()).toBeVisible()
    await expect(visitor.getByRole('img', { name: coverAlt })).toHaveCount(0)

    const gone = await visitor.request.get(`/api/v1/media/${seeded.coverId}`)

    expect(gone.status()).toBe(404)
  })

  test('journey 4: cancelling one night refunds it, keeps the every-night pass, and is the owner’s alone', async ({
    browser,
    visitor,
  }) => {
    test.setTimeout(180_000)

    const owner = await windowFor(browser, 'owner')
    const event = seeded.events.multiNight
    const [nightOne, nightTwo, nightThree] = event.sessions
    const reason = 'The hall double-booked the second night with a wedding.'

    await openStep(owner, event.id, /^step 3/iu)
    await nightCard(owner, 2).getByRole('button', { name: 'Cancel this night…' }).click()

    const preview = owner.getByRole('region', { name: /^Cancel the night of /u })

    // The preview, from the server's counts: the night's order refunded in
    // full, the every-night pass told and kept.
    await expect(preview).toContainText(
      `1 paid order for this night is refunded (${dollars(bought.nightTwo.totalCents)} in all, booking fees and tax included): a whole order when every ticket on it is for this night, otherwise its tickets for this night.`,
    )
    await expect(preview).toContainText(
      '1 order holds tickets for every night: its holder keeps them for the other nights and is told, without a refund.',
    )
    await expect(preview).toContainText(
      'Payments on this site are simulated, so these refunds move no real money.',
    )
    await preview.getByRole('button', { name: 'Keep this night' }).click()

    const dialog = await cancelNight(owner, event.id, nightTwo, 2, reason)

    await expect(dialog).toContainText(
      `Its tickets no longer work at the door. 1 order refunded (${dollars(bought.nightTwo.totalCents)}).`,
    )

    const afterOne = await eventRow(event.id)

    expect(afterOne.sessions.map((night) => night.status)).toEqual([
      'ON_SALE',
      'CANCELLED',
      'ON_SALE',
    ])
    expect(afterOne.status).toBe('ON_SALE')

    // The public page marks the night cancelled.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.locator('main').getByText('Cancelled').first()).toBeVisible()

    // The night's order is refunded and says why; the pass holder is told and
    // keeps every ticket.
    const buyer = await windowFor(browser, 'buyer')

    await buyer.goto(`/account/orders/${bought.nightTwo.reference}`)
    await expect(buyer.locator('main')).toContainText('This order was refunded in full.')

    const changes = buyer.getByRole('region', { name: 'Changes since you bought' })

    await expect(changes).toContainText('A night was cancelled')
    await expect(changes).toContainText(`Reason given: ${reason}`)

    await buyer.goto(`/account/orders/${bought.pass.reference}`)
    await expect(buyer.getByRole('region', { name: 'Changes since you bought' })).toContainText(
      'A night was cancelled',
    )

    const orders = await ordersOf(event.id)
    const pass = orders.find((order) => order.reference === bought.pass.reference)
    const refunded = orders.find((order) => order.reference === bought.nightTwo.reference)

    expect(refunded.status).toBe('REFUNDED')
    expect(refunded.refundedCents).toBe(bought.nightTwo.totalCents)
    expect(pass.status).toBe('PAID')
    expect(pass.refundedCents).toBe(0)
    expect(pass.items[0].tickets.map((ticket) => ticket.status)).toEqual(['VALID'])

    // The event manager posts events, but a refund is not theirs to decide:
    // no "Cancel this night…", only the refusal sentence.
    const manager = await windowFor(browser, 'manager')

    await openStep(manager, event.id, /^step 3/iu)
    await expect(manager.getByRole('button', { name: 'Cancel this night…' })).toHaveCount(0)
    await expect(nightCard(manager, 3)).toContainText(
      'Cannot be removed: this night has orders, baskets or check-ins. Move it instead, or cancel the event.',
    )

    // Night 1's doors open: it has started, and is no longer cancelled.
    await openDoorsAnHourAgo(nightOne)
    await openStep(owner, event.id, /^step 3/iu)
    await nightCard(owner, 1).getByRole('button', { name: 'Cancel this night…' }).click()

    const started = owner.getByRole('region', { name: /^Cancel the night of /u })

    await expect(started.getByText('This night cannot be cancelled')).toBeVisible()
    await expect(started).toContainText(
      'This night has started, or its doors open within the hour, so it can no longer be cancelled.',
    )
    await started.getByRole('button', { name: 'Close', exact: true }).click()

    // The last night still to come can be: another night has started, so it
    // is not the only one on.
    const last = await cancelNight(
      owner,
      event.id,
      nightThree,
      3,
      'The third night is called off after the first ran long.',
    )

    await expect(last).toContainText(`1 order refunded (${dollars(bought.nightThree.totalCents)}).`)
    expect((await eventRow(event.id)).sessions.map((night) => night.status)).toEqual([
      'ON_SALE',
      'CANCELLED',
      'CANCELLED',
    ])
  })

  test('journey 5: the event manager deletes an unsold event, and is told who decides a sold one', async ({
    browser,
    visitor,
  }) => {
    const manager = await windowFor(browser, 'manager')
    const event = seeded.events.unsoldLive

    await openStep(manager, event.id, /review/iu)
    await expect(manager.getByRole('heading', { name: 'Danger zone' })).toBeVisible()

    const dialog = await openDeleteDialog(manager, event.title)

    await expect(dialog).toContainText(
      'Nobody has bought a ticket to this event. Deleting it takes its page, listing and pictures off the site straight away. It is kept, hidden, so the Desi-Event team can restore it.',
    )
    await expect(dialog).toContainText(
      'Its web address stays retired, so an old link never shows a different event.',
    )

    await deleteThrough(manager, dialog, event, {
      reason: 'Nobody bought a ticket, so we are not running it.',
      button: 'Delete this event',
    })
    await expect(dialog).toContainText('Its page is off the site. Nobody was owed a refund.')

    await dialog.getByRole('link', { name: 'Back to your events' }).click()
    await expect(manager).toHaveURL(/\/organizer\/events\?deleted=1$/u)
    await expect(manager.getByText('Event deleted.', { exact: true })).toBeVisible()

    const row = await eventRow(event.id)

    expect(row.status).toBe('DELETED')
    expect(row.deletionOutcome).toBe('REMOVED')
    expect(row.statusBeforeDeletion).toBe('PUBLISHED')
    expect(row.slug).toBe(event.slug)

    // Off the site for everybody.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    // Under "Deleted", with its record and who restores it.
    await manager.goto('/organizer/events?status=DELETED')
    await manager.getByRole('link', { name: event.title }).first().click()
    await expect(manager.getByRole('heading', { name: 'This event was deleted' })).toBeVisible()
    await expect(manager.locator('main')).toContainText(
      `Only the Desi-Event team can restore a deleted event. Ask them, naming its web address, ${event.slug}.`,
    )
    await expect(manager.getByRole('button', { name: 'Restore…' })).toHaveCount(0)

    // A sold event: the preview says who decides, and offers no button.
    await openStep(manager, seeded.events.soldToDelete.id, /review/iu)

    const sold = await openDeleteDialog(manager, seeded.events.soldToDelete.title)

    await expect(sold.getByText('Somebody else decides this')).toBeVisible()
    await expect(sold).toContainText(
      'Deleting this event refunds 3 paid orders, which an organisation administrator or owner decides. Ask one of them, or the Desi-Event team.',
    )
    await expect(sold.getByRole('button', { name: 'Cancel, refund and delete' })).toHaveCount(0)
  })

  test('journey 6: the owner deletes a sold event, refunding every order', async ({
    browser,
    visitor,
  }) => {
    test.setTimeout(150_000)

    const owner = await windowFor(browser, 'owner')
    const buyer = await windowFor(browser, 'buyer')
    const event = seeded.events.soldToDelete
    const total = bought.soldA.totalCents + bought.soldB.totalCents + bought.soldC.totalCents

    await openStep(owner, event.id, /review/iu)

    const dialog = await openDeleteDialog(owner, event.title)

    // What it does, built from the server's counts.
    await expect(dialog).toContainText(
      `Deleting this event cancels it, refunds what is left of each of the 3 paid orders (${dollars(total)} in all, booking fees and tax included) and takes its page off the site.`,
    )
    await expect(dialog).toContainText(
      'A notice is recorded against each order and shown on its order page; it is not emailed.',
    )
    await expect(dialog).toContainText(
      'Payments on this site are simulated, so these refunds move no real money.',
    )
    await expect(dialog).toContainText(
      'Its pictures stop being served at once, but a copy already in someone’s browser can stay there for up to a day.',
    )

    // The wrong address is said in words, under the box and in the summary;
    // the button stays usable and nothing is sent.
    const sent = []
    const record = (request) => {
      if (request.method() === 'POST' && request.url().endsWith(`/events/${event.id}/delete`)) {
        sent.push(request)
      }
    }

    owner.on('request', record)
    await dialog
      .getByLabel(/^Why is this event being deleted\?/u)
      .fill('The venue closed for repairs and will not reopen in time.')
    await dialog.getByLabel(/^Type the event’s web address/u).fill(`${event.slug}-not`)

    const submit = dialog.getByRole('button', { name: 'Cancel, refund and delete', exact: true })

    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(
      dialog.getByRole('link', {
        name: 'That is not this event’s web address. Type it exactly as shown.',
      }),
    ).toBeVisible()
    owner.off('request', record)
    expect(sent, 'a mismatched address was sent').toHaveLength(0)

    // Typed in capitals, which the server compares lower-cased, as this does.
    await deleteThrough(owner, dialog, event, {
      reason: 'The venue closed for repairs and will not reopen in time.',
      button: 'Cancel, refund and delete',
      typed: event.slug.toUpperCase(),
    })
    await expect(dialog).toContainText(
      `Its page is off the site. 3 orders refunded (${dollars(total)}).`,
    )

    const row = await eventRow(event.id)

    expect(row.status).toBe('DELETED')
    expect(row.deletionOutcome).toBe('CANCELLED_AND_REFUNDED')
    expect(row.statusBeforeDeletion).toBe('CANCELLED')

    for (const order of await ordersOf(event.id)) {
      expect(order.status, order.reference).toBe('REFUNDED')
      expect(order.refundedCents, order.reference).toBe(order.totalCents)
    }

    // Off the site; the buyer's orders say so, and were refunded.
    await visitor.goto(`/events/${event.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    await buyer.goto(`/account/orders/${bought.soldA.reference}`)
    await expect(buyer.locator('main')).toContainText('The organiser removed this event’s page.')
    await expect(buyer.locator('main')).toContainText('This order was refunded in full.')

    // Its address stays retired.
    const again = await callApi(owner, 'POST', '/api/v1/events', {
      organizationId: seeded.gammaOrganizationId,
      title: 'A new night at the old address',
      slug: event.slug,
      summary: 'Trying the old address again.',
      description: 'A new event at the address of the one that was deleted.',
      category: 'GARBA_DANDIYA',
      startsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90 * 86_400_000 + 4 * 3_600_000).toISOString(),
      timezone: CONTROL_TIME_ZONE,
    })

    expect(again.status, again.text).toBe(409)
    expect(again.code).toBe('SLUG_RETIRED')
    expect(again.message).toBe(
      'That web address belonged to an event that was deleted, so it stays retired. Choose another.',
    )
  })

  test('journey 7: a platform administrator edits another organisation’s event in a sitting the organiser can read', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const admin = await windowFor(browser, 'admin')
    const event = seeded.events.otherLive
    const { adminName, otherName } = names()
    const reason = 'The organiser asked us to fix the description and add the parking answer.'
    const description =
      'Raas and garba with the Other ensemble: two nights, live music, and food from seven.'

    // Found in "All events" and opened in the editor.
    await admin.goto('/admin/events')
    await admin.getByLabel('Search by title, web address or organisation').fill(event.title)
    await admin.getByRole('button', { name: 'Show', exact: true }).click()
    await rowAction(admin, 'Open in the editor', event.title).click()
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${event.id}$`, 'u'))
    await expect(
      admin.getByText(
        'The organiser sees each change you make and the reason you give here. They do not see your name. Every change is recorded with your name and this reason.',
      ),
    ).toBeVisible()

    await openSitting(admin, reason)

    const sitting = await callApi(admin, 'GET', `/api/v1/events/${event.id}/platform-edits`)
    const open = sitting.data.find((edit) => edit.open && edit.mine)

    expect(open.reason).toBe(reason)

    // The banner: whose event, the reason, and until when.
    await expect(admin.locator('main')).toContainText(`This is ${otherName}’s event.`)
    await expect(admin.locator('main')).toContainText(
      plain(`Reason: ${reason.replace(/\.$/u, '')}. Until ${timeInChicago(open.expiresAt)}`),
    )

    // Its words, and a question for its FAQ.
    await toStep(admin, /^step 1/iu)
    await savedAfter(admin, event.id, () => admin.getByLabel(/^Description/u).fill(description))
    await expect.poll(async () => (await eventRow(event.id)).description).toBe(description)

    await toStep(admin, /^step 8/iu)
    await savedAfter(admin, event.id, async () => {
      await admin.getByRole('button', { name: 'Add a question' }).click()
      await admin
        .getByLabel(/^Question/u)
        .last()
        .fill('Where do we park?')
      await admin
        .getByLabel(/^Answer/u)
        .last()
        .fill('In the school car park across the road, free after six.')
    })
    await expect
      .poll(async () => JSON.stringify((await eventRow(event.id)).faq))
      .toContain('In the school car park across the road, free after six.')
    expect(JSON.stringify((await eventRow(event.id)).faq)).toContain('Where do we park?')

    // A night cancelled by the Desi-Event team, with its refund.
    await toStep(admin, /^step 3/iu)

    const cancelled = await cancelNight(
      admin,
      event.id,
      event.sessions[1],
      2,
      'The organiser told us the second night lost its hall.',
    )

    await expect(cancelled).toContainText(
      `1 order refunded (${dollars(bought.otherB.totalCents)}).`,
    )

    // A picture the administrator uploads waits for somebody else.
    await toStep(admin, /^step 6\s*media$/iu)

    const pictureAlt = 'The Other ensemble on stage, from the back of the hall'
    const pictureId = await uploadPicture(
      admin,
      event.id,
      uploadForm(admin, 'Add a gallery picture'),
      solidPng(400, 400, { rgb: [90, 60, 150] }),
      pictureAlt,
    )

    await admin.goto('/moderation/pictures')

    const mine = admin
      .getByRole('listitem')
      .filter({ hasText: pictureAlt })
      .filter({ has: admin.getByRole('button', { name: 'Approve this picture' }) })
      .last()
    const refused = admin.waitForResponse(postTo(`/api/v1/moderation/media/${pictureId}/decision`))

    await mine.getByRole('button', { name: 'Approve this picture' }).click()

    const answer = await refused

    if (answer.status() === 403 && (await answer.json()).error.code === 'STEP_UP_REQUIRED') {
      const second = admin.waitForResponse(postTo(`/api/v1/moderation/media/${pictureId}/decision`))

      await confirmStepUp(admin)
      expect((await (await second).json()).error.code).toBe('SELF_REVIEW')
    } else {
      expect(answer.status()).toBe(403)
      expect((await answer.json()).error.code).toBe('SELF_REVIEW')
    }

    await expect(mine.getByText('That did not work')).toBeVisible()

    // The moderator approves it.
    const moderator = await windowFor(browser, 'moderator')

    await moderator.goto('/moderation/pictures')

    const theirs = moderator
      .getByRole('listitem')
      .filter({ hasText: pictureAlt })
      .filter({ has: moderator.getByRole('button', { name: 'Approve this picture' }) })
      .last()

    await expect(moderator.locator('main ol > li').filter({ has: theirs })).toContainText(
      'Uploaded by the Desi-Event team in an editing session',
    )
    await pressThroughStepUp(
      moderator,
      () => theirs.getByRole('button', { name: 'Approve this picture' }).click(),
      postTo(`/api/v1/moderation/media/${pictureId}/decision`),
    )

    // The organiser sees the sitting at the top and what it changed on the
    // Review step, with the reason, and never the administrator's name.
    const otherOwner = await windowFor(browser, 'otherOwner')

    await otherOwner.goto(`/organizer/events/${event.id}`)
    await expect(otherOwner.getByTestId('team-editing-notice')).toContainText(
      plain(`The Desi-Event team is editing this event until ${timeInChicago(open.expiresAt)}`),
    )
    await expect(otherOwner.getByTestId('team-editing-notice')).toContainText(`Reason: ${reason}`)
    await openStep(otherOwner, event.id, /review/iu)

    const panel = otherOwner.getByRole('region', { name: 'Changes made by the Desi-Event team' })

    await expect(panel).toContainText('By a Desi-Event administrator.')
    await expect(panel).toContainText(`Reason: ${reason}`)
    await expect(panel).toContainText(/Changed: .*description, FAQ/u)
    await expect(panel).toContainText('cancelled a night')
    expect(await otherOwner.content()).not.toContain(adminName)

    // "Stop editing" ends the sitting and returns to the list.
    await admin.goto(`/admin/events/${event.id}`)
    await admin.getByRole('button', { name: 'Stop editing', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events$/u)
    expect(
      (await callApi(admin, 'GET', `/api/v1/events/${event.id}/platform-edits`)).data.some(
        (edit) => edit.open,
      ),
    ).toBe(false)
  })

  test('journey 8: the administrator deletes a sold event of another organisation, and restores one that comes back paused', async ({
    browser,
    visitor,
  }) => {
    test.setTimeout(240_000)

    const admin = await windowFor(browser, 'admin')
    const event = seeded.events.otherLive
    const left = bought.otherA.totalCents

    // From the list's "Delete…", which opens the event's danger zone.
    await admin.goto(`/admin/events?q=${encodeURIComponent(event.title)}`)
    await rowAction(admin, 'Delete…', event.title).click()
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${event.id}#delete-event$`, 'u'))

    const dialog = await openDeleteDialog(admin, event.title)

    await expect(dialog).toContainText(
      `refunds what is left of each of the 1 paid order (${dollars(left)} in all, booking fees and tax included)`,
    )
    await deleteThrough(admin, dialog, event, {
      reason: 'The organiser cannot run this event and asked us to take it down.',
      button: 'Cancel, refund and delete',
    })
    await expect(dialog).toContainText(
      `Its page is off the site. 1 order refunded (${dollars(left)}).`,
    )

    const [deleted] = await auditFor(event.id, 'event.deleted')

    expect(deleted.metadata.authority).toBe('PLATFORM')
    expect(deleted.metadata.outcome).toBe('CANCEL_AND_REFUND')
    expect((await eventRow(event.id)).deletionAuthority).toBe('PLATFORM')

    // The organiser reads who deleted it as the Desi-Event team, unnamed.
    const otherOwner = await windowFor(browser, 'otherOwner')

    await otherOwner.goto(`/organizer/events/${event.id}`)
    await expect(otherOwner.getByRole('heading', { name: 'This event was deleted' })).toBeVisible()
    await expect(otherOwner.locator('main')).toContainText(', by the Desi-Event team.')
    expect(await otherOwner.content()).not.toContain(names().adminName)

    // A deleted event comes back paused, never on sale.
    const restoring = seeded.events.deletedRestore

    await admin.goto(`/admin/events/${restoring.id}`)
    await expect(admin.getByRole('heading', { name: 'This event was deleted' })).toBeVisible()
    await expect(admin.locator('main')).toContainText(DELETED_REASON)
    await admin.getByRole('button', { name: 'Restore…', exact: true }).click()

    const restore = admin.getByRole('region', { name: `Restore “${restoring.title}”` })

    await expect(restore).toContainText('It comes back paused: the organiser reopens sales.')
    await restore
      .getByLabel(/^Why is this event being restored\?/u)
      .fill('Deleted by mistake: the other listing was the duplicate.')
    await pressThroughStepUp(
      admin,
      () => restore.getByRole('button', { name: 'Restore this event', exact: true }).click(),
      postTo(`/api/v1/platform/events/${restoring.id}/restore`),
    )

    // The page says what happened, in the place the dialog was.
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${restoring.id}\\?restored=1$`, 'u'))
    await expect(admin.getByRole('status').filter({ hasText: 'Event restored' })).toHaveText(
      'Event restored: Sales paused.',
    )
    expect((await eventRow(restoring.id)).status).toBe('SALES_PAUSED')

    // Public again, and nothing can be bought.
    await visitor.goto(`/events/${restoring.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: restoring.title })).toBeVisible()
    await expect(visitor.getByText(/sales are paused/iu).first()).toBeVisible()
    await expect(visitor.getByRole('link', { name: /choose tickets/iu })).toHaveCount(0)

    // The organiser opens sales, and it is buyable.
    const owner = await windowFor(browser, 'owner')

    await openStep(owner, restoring.id, /review/iu)
    await owner.getByRole('button', { name: 'Open sales', exact: true }).click()
    await pressThroughStepUp(
      owner,
      () => owner.getByRole('button', { name: 'Yes, open sales' }).click(),
      postTo(`/api/v1/events/${restoring.id}/open-sales`),
    )
    expect((await eventRow(restoring.id)).status).toBe('ON_SALE')

    await visitor.goto(`/events/${restoring.slug}`)
    await expect(visitor.getByRole('link', { name: /choose tickets/iu }).first()).toBeVisible()
  })

  test('journey 9: what the Desi-Event team is refused', async ({ browser }) => {
    test.setTimeout(240_000)

    const admin = await windowFor(browser, 'admin')
    const draft = seeded.events.draft
    const event = seeded.events.otherUnsold

    // A draft is the organiser's: no sitting is offered.
    await admin.goto(`/admin/events/${draft.id}`)
    await expect(
      admin.getByText(
        'The Desi-Event team edits an event only once it has been published. Before that it is the organiser’s draft; ask for changes through review.',
      ),
    ).toBeVisible()
    await expect(admin.getByRole('button', { name: 'Open for editing' })).toHaveCount(0)

    // Without a sitting, a write through the page's own fetch is refused.
    await admin.goto(`/admin/events/${event.id}`)

    const unsat = await callApi(admin, 'PATCH', `/api/v1/events/${event.id}`, {
      description: 'An edit nobody opened a sitting for.',
    })

    expect(unsat.status, unsat.text).toBe(403)
    expect(unsat.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    // The organiser's lifecycle moves are not the team's.
    const opened = await callApi(admin, 'POST', `/api/v1/events/${event.id}/open-sales`, {})

    expect(opened.status, opened.text).toBe(403)
    expect(opened.code).toBe('ORGANIZER_ONLY')

    // A sitting works in the browser that opened it, and nowhere else.
    await openSitting(admin, 'Checking the matinee listing for the organiser.')

    const elsewhere = await browser.newContext()

    contexts.push(elsewhere)

    const second = arriving(await elsewhere.newPage())

    await signIn(second, names().adminEmail)
    await second.goto(`/admin/events/${event.id}`)

    const fromElsewhere = await callApi(second, 'PATCH', `/api/v1/events/${event.id}`, {
      description: 'An edit from a second browser.',
    })

    expect(fromElsewhere.status, fromElsewhere.text).toBe(403)
    expect(fromElsewhere.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    // Ended in another tab, the sitting refuses the next save, and the banner
    // offers to open it again.
    const tab = arriving(await admin.context().newPage())

    await tab.goto(`/admin/events/${event.id}`)
    await tab.getByRole('button', { name: 'Stop editing', exact: true }).click()
    await expect(tab).toHaveURL(/\/admin\/events$/u)
    await tab.close()

    await toStep(admin, /^step 1/iu)
    await admin.getByLabel(/^Description/u).fill('A late edit after the sitting ended.')
    await expect(
      admin.getByText('This editing session has ended. Open it again to keep editing.').first(),
    ).toBeVisible({ timeout: 20_000 })

    await openSitting(admin, 'Opening it again to finish the matinee check.', 'Open it again')
    await admin.getByRole('button', { name: 'Stop editing', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/events$/u)
  })

  test('journey 10: a super administrator edits, cancels a night of and deletes another organisation’s event', async ({
    platform,
  }) => {
    test.setTimeout(240_000)

    const event = seeded.events.otherSuper
    const description = 'Dandiya on two nights, edited by the Desi-Event team for the organiser.'

    await platform.goto(`/admin/events?q=${encodeURIComponent(event.title)}`)
    await rowAction(platform, 'Open in the editor', event.title).click()
    await openSitting(platform, 'The organiser asked us to correct the description and the nights.')

    await toStep(platform, /^step 1/iu)
    await savedAfter(platform, event.id, () =>
      platform.getByLabel(/^Description/u).fill(description),
    )
    await expect.poll(async () => (await eventRow(event.id)).description).toBe(description)

    await toStep(platform, /^step 3/iu)

    const night = await cancelNight(
      platform,
      event.id,
      event.sessions[1],
      2,
      'The organiser lost the hall for the second night.',
    )

    await expect(night).toContainText(`1 order refunded (${dollars(bought.superB.totalCents)}).`)

    await toStep(platform, /review/iu)

    const dialog = await openDeleteDialog(platform, event.title)

    await deleteThrough(platform, dialog, event, {
      reason: 'The organiser asked us to cancel and take down the rest of it.',
      button: 'Cancel, refund and delete',
    })
    await expect(dialog).toContainText(
      `Its page is off the site. 1 order refunded (${dollars(bought.superA.totalCents)}).`,
    )

    // Every write is the platform's in the audit trail.
    const [updated] = await auditFor(event.id, 'event.updated')
    const [nightCancelled] = await auditFor(event.id, 'event.session_cancelled')
    const [deleted] = await auditFor(event.id, 'event.deleted')

    expect(updated.metadata.authority).toBe('PLATFORM')
    expect(nightCancelled.metadata.authority).toBe('PLATFORM')
    expect(deleted.metadata.authority).toBe('PLATFORM')
    expect(deleted.actorId).toBe(ids().platformReaderId)

    for (const order of await ordersOf(event.id)) {
      expect(order.status, order.reference).toBe('REFUNDED')
    }
  })
})
