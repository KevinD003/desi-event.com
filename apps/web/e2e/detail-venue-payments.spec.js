import { createPrismaClient } from '@desi-event/db'
import { totp } from '@desi-event/auth'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import { CONNECTION, PASSWORD, TOTP_SECRET, forgetCodeUse } from './support/seed-refusals.mjs'
import {
  finishPastNight,
  refundsOf,
  seedVenuePayments,
  cleanupVenuePayments,
  soldOf,
  successorOf,
  ticketsOf,
  venuePaymentNames,
} from './support/seed-venue-payments.mjs'
import { confirmIfAsked, confirmStepUp, stepUpPrompt } from './support/step-up.mjs'

// This file makes referral codes and reads them off the administrator's
// screen, types them into the checkout, and shows a ticket transfer's one-time
// code and an order's group pass. A screenshot, a trace or a film of any of
// them would keep a working code, so none is taken in this file.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

/**
 * Booking fees per event, referral codes and paying at the venue (SPEC3
 * §14.6, SPEC3-XI §14.6), in a real browser against the real API.
 *
 * ## The story
 *
 * One organisation, "Pay Venue <tag>", sells a general-admission night (GA,
 * no nights, $40), a two-night event with an every-night pass, a Toronto
 * night and a night that is already over; the Desi-Event team sets their
 * booking fees, switches paying at the venue on and off, and makes referral
 * codes. The journeys run in SPEC3-XI's order, V1–V6, V15, V13, V7, V8, V14,
 * V9–V12, each building on the last:
 *
 *   - V1  an administrator sets GA's booking fee after it is live (reason and
 *         second factor); a new buyer sees it, an old order keeps its own;
 *   - V2  a fee can be set in any state but deleted;
 *   - V3  the fee changes while a buyer is at checkout: the buyer is told the
 *         new total before paying;
 *   - V4  paying at the venue is switched on; a buyer books paying only the
 *         booking fee online, with no tax on the tickets;
 *   - V4b where tax exists (Ontario), none is added to tickets paid at the door;
 *   - V5  a referral code scoped to GA, with a limit of one, waives the fee;
 *         a second buyer is refused in the one uniform sentence;
 *   - V5b a promo code and an all-events referral code on one card order, and
 *         a GA-only code refused on another event;
 *   - V6  the door takes the money and admits in one step, one ticket and a
 *         group pass, and the organiser's figures add up;
 *   - V15 a ticket that owes its price is passed on; its new holder is told
 *         the amount and pays at the door;
 *   - V13 the organiser cancels one of two unpaid tickets: its place is back on
 *         sale, the fee is kept, the holder is told why, the door refuses it;
 *   - V7  paying at the venue is switched off mid-checkout: the buyer is moved
 *         to card, urgently, before anything is charged;
 *   - V8  the event's limit is reached: the buyer pays by card instead;
 *   - V14 the Desi-Event team cancels an unpaid ticket booked with a referral
 *         code, and the code's use comes back;
 *   - V9  a booking fee is refunded by hand;
 *   - V10 who may not: organisers, moderators and finance administrators are
 *         refused the team's controls;
 *   - V11 an event with pay-at-the-venue bookings is cancelled: only the fee
 *         paid online is refunded;
 *   - V12 a finished event with a door payment is cancelled and deleted: the
 *         money taken at the door is the organiser's to return.
 *
 * And, before any of it, a visitor's header offers "Sign in" and "Sign up".
 *
 * ## Orders
 *
 * Every order is bought through the real checkout — on its screens, or, for
 * the orders the story starts with, through the same API calls the screens
 * make — because a refund goes back to the payment the order was paid with,
 * and the simulated payment provider knows only the payments its own process
 * took.
 *
 * ## Codes
 *
 * Referral codes are made on the administrator's screen and read from its
 * success panel, never from the seed, and typed into the checkout from there;
 * no address any window visits carries one (asserted at the end of V5 and
 * V14). The transfer code and the group pass are read from the pages that
 * show them once.
 *
 * @module e2e/detail-venue-payments
 */

/** Every context this file opened, closed in `afterAll`. @type {object[]} */
const contexts = []
/** Each signed-in window, opened the first time a journey asks. */
const windows = {}
/** Every address each window landed on, to prove no code ever reached one. */
const visited = []
/** The seeded ids. @type {object} */
let seeded
/** The orders the story makes, by what they were for. */
const bought = {}
/** The referral codes the administrator made, read from the screen. */
const codes = {}
/** The first of buyer2's GA tickets, admitted at the door in V6. @type {string|null} */
let firstAdmitted = null

/** Why the administrator changes a fee; the organiser reads it. */
const FEE_REASON = 'Agreed with the organiser for the festival season.'
/** Why the administrator changes the switch or its limit. */
const VENUE_REASON = 'The organiser takes payment at the hall this season.'
/** Why unpaid tickets are cancelled; the buyer reads it. */
const CANCEL_REASON = 'Not paid before the doors opened on the first night.'

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
const names = () => venuePaymentNames(ids().tag)

/** An amount as the site writes it. */
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * An amount in cents, as the site writes it.
 *
 * @param {number} cents The amount.
 * @returns {string} For example `$42.69`.
 */
function dollars(cents) {
  return USD.format(cents / 100)
}

/** Which address each window signs in with. */
const EMAILS = Object.freeze({
  admin: 'adminEmail',
  super: 'superEmail',
  finadmin: 'finadminEmail',
  mod: 'modEmail',
  owner: 'ownerEmail',
  finance: 'financeEmail',
  scanner: 'scannerEmail',
  buyer1: 'buyer1Email',
  buyer2: 'buyer2Email',
  buyer3: 'buyer3Email',
})

/**
 * A window signed in as one of the seed's accounts, opened the first time it
 * is asked for and kept for the rest of the file.
 *
 * @param {object} browser The browser under test.
 * @param {string} who Which account: a key of {@link EMAILS}.
 * @returns {Promise<object>} An arriving, signed-in page.
 */
async function windowFor(browser, who) {
  windows[who] ??= (async () => {
    const context = await browser.newContext()
    const page = arriving(await context.newPage())

    contexts.push(context)
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url())
    })
    await signIn(page, names()[EMAILS[who]])

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
 * @returns {Promise<{status: number, code: string|null, data: object|null, text: string}>} What came back.
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
        data: parsed?.data ?? null,
        text,
      }
    },
    { method, path, body, headers },
  )
}

/**
 * Buy the way the checkout does: hold the tickets, price the basket, and place
 * the order with the quoted figures, paid by the simulated provider.
 *
 * @param {object} page The buyer's page, signed in, on any page of the site.
 * @param {object} options What to buy.
 * @param {string} options.eventId The event.
 * @param {Array<{ticketTypeId: string, quantity: number}>} options.items The tickets.
 * @param {'CARD'|'AT_VENUE'} [options.paymentMethod] How to pay.
 * @param {{email: string, name: string}} options.buyer Who is buying.
 * @returns {Promise<{reference: string, totalCents: number, feesCents: number, venueDueCents: number}>} The paid order.
 */
async function buyThroughApi(page, { eventId, items, paymentMethod = 'CARD', buyer }) {
  const holdIds = []

  for (const item of items) {
    const hold = await callApi(page, 'POST', '/api/v1/holds', item)

    expect(hold.status, hold.text).toBe(201)
    holdIds.push(hold.data.id)
  }

  const atVenue = paymentMethod === 'AT_VENUE'
  const quote = await callApi(page, 'POST', '/api/v1/orders/quote', {
    eventId,
    items,
    holdIds,
    ...(atVenue ? { paymentMethod } : {}),
  })

  expect(quote.status, quote.text).toBe(200)

  const order = await callApi(
    page,
    'POST',
    '/api/v1/orders',
    {
      eventId,
      buyerEmail: buyer.email,
      buyerName: buyer.name,
      items,
      holdIds,
      expectedTotalCents: quote.data.totalCents,
      ...(atVenue ? { paymentMethod, expectedVenueDueCents: quote.data.venueDueCents } : {}),
    },
    { 'idempotency-key': `venue-${ids().tag}-${eventId}-${Date.now()}` },
  )

  expect(order.status, order.text).toBe(201)
  expect(order.data.status).toBe('PAID')

  return {
    reference: order.data.reference,
    totalCents: order.data.totalCents,
    feesCents: order.data.feesCents,
    venueDueCents: quote.data.venueDueCents ?? 0,
  }
}

/**
 * Press a control whose request may be refused for a second factor, answer
 * the prompt if it comes, and wait for the request to succeed.
 *
 * With `mustAsk`, the prompt has to come: the journey lapsed the session's
 * last confirmation first ({@link lapseStepUp}), so a control that went
 * through without one would be a control the second factor does not guard.
 *
 * @param {object} page The page.
 * @param {Function} press Presses the control.
 * @param {Function} matches Whether a response is the one the control sends.
 * @param {object} [options] Options.
 * @param {boolean} [options.mustAsk] Whether the prompt must come.
 * @returns {Promise<object>} The successful response.
 */
async function pressThroughStepUp(page, press, matches, { mustAsk = false } = {}) {
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

  if (mustAsk) expect(first, 'the control went through without a second factor').toBe('prompted')
  if (first === 'prompted') await confirmStepUp(page)

  return succeeded
}

/**
 * Whether a response is a POST to one API path.
 *
 * @param {string|RegExp} path The path, starting `/api/v1/`.
 * @returns {Function} The predicate.
 */
function postTo(path) {
  return (response) => {
    if (response.request().method() !== 'POST') return false

    const pathname = new URL(response.url()).pathname

    return typeof path === 'string' ? pathname === path : path.test(pathname)
  }
}

/**
 * A promise for the checkout's next quote.
 *
 * @param {object} page The buyer's page.
 * @returns {Promise<object>} The quote's response.
 */
function quoted(page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/orders/quote',
    { timeout: 30_000 },
  )
}

/**
 * The value beside a term in a definition list: an order's sums, a figure on
 * the organiser's page. The term is the definition term's own first words, so
 * a note set inside it under the term (the tax line's) does not hide it.
 *
 * @param {object} scope Where to look.
 * @param {string} term The term, exactly.
 * @returns {object} The definition's locator.
 */
function valueOf(scope, term) {
  return scope
    .locator(
      `xpath=.//dt[normalize-space(text()[1])=${JSON.stringify(term)}]/following-sibling::dd[1]`,
    )
    .first()
}

/**
 * Open an event's checkout and wait for the basket to answer.
 *
 * @param {object} page The buyer's page.
 * @param {{slug: string, title: string}} event The event.
 * @returns {Promise<void>} Resolves once the basket is there.
 */
async function openCheckout(page, event) {
  await page.goto(`/events/${event.slug}/checkout`)
  await expect(
    page.getByRole('heading', { level: 1, name: `Tickets for ${event.title}` }),
  ).toBeVisible()
}

/**
 * Choose a number of one tier's tickets with the stepper.
 *
 * A press that lands before the basket has hydrated changes nothing, so each
 * press is repeated only while the quantity has not yet moved.
 *
 * @param {object} page The buyer's page, on the checkout.
 * @param {string} tier The tier's name.
 * @param {number} count How many.
 * @returns {Promise<void>} Resolves once chosen.
 */
async function choose(page, tier, count) {
  const quantity = page.getByLabel(`Quantity of ${tier}`, { exact: true })
  const add = page.getByRole('button', { name: `Add one ${tier}`, exact: true })

  for (let wanted = 1; wanted <= count; wanted += 1) {
    await expect(async () => {
      if (Number(await quantity.inputValue()) < wanted) await add.click()

      await expect(quantity).toHaveValue(String(wanted), { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
  }
}

/**
 * Reserve what is chosen, and wait for the server's total.
 *
 * @param {object} page The buyer's page, on the checkout.
 * @returns {Promise<void>} Resolves once held and priced.
 */
async function reserve(page) {
  const priced = quoted(page)

  await page.getByRole('button', { name: 'Reserve tickets', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Tickets held' })).toBeVisible()
  expect((await priced).ok()).toBe(true)
}

/**
 * The checkout's order summary.
 *
 * @param {object} page The buyer's page.
 * @returns {object} The region's locator.
 */
function summaryOf(page) {
  return page.getByRole('region', { name: 'Order summary' })
}

/**
 * Choose how to pay, and wait for the total that goes with it.
 *
 * @param {object} page The buyer's page, holding tickets.
 * @param {'Pay at the venue'|'Pay by card now'} label The choice.
 * @returns {Promise<void>} Resolves once priced.
 */
async function payBy(page, label) {
  const priced = quoted(page)

  await page.getByRole('radio', { name: label, exact: true }).check()
  expect((await priced).ok()).toBe(true)
}

/**
 * Type a referral code into the checkout and apply it.
 *
 * @param {object} page The buyer's page, holding tickets.
 * @param {string} code The code, as read from the administrator's screen.
 * @returns {Promise<void>} Resolves once the quote answered.
 */
async function applyReferral(page, code) {
  const summary = summaryOf(page)
  const priced = quoted(page)

  await summary.getByLabel(/^Referral code \(optional\)/u).fill(code)
  await summary.getByRole('button', { name: 'Apply referral code' }).click()
  await priced
}

/**
 * Press the pay button and wait for the booked panel.
 *
 * @param {object} page The buyer's page.
 * @param {string} label The pay button's name.
 * @param {string} heading The booked panel's heading.
 * @returns {Promise<string>} The order's reference, read from the panel.
 */
async function payAndBook(page, label, heading) {
  await page.getByRole('button', { name: label, exact: true }).click()

  const booked = page.getByRole('status').filter({
    has: page.getByRole('heading', { name: heading, exact: true }),
  })

  await expect(booked).toBeVisible({ timeout: 30_000 })

  const reference = (await booked.innerText()).match(/Order\s+([A-Z0-9-]{4,32})/u)?.[1] ?? null

  expect(reference, 'the booked panel names no order').not.toBeNull()

  return reference
}

/**
 * The administrator's "Booking fee and payment" section on an event.
 *
 * @param {object} page The administrator's page.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The section's locator, once it is there.
 */
async function termsPanel(page, eventId) {
  await page.goto(`/admin/events/${eventId}`)

  const panel = page.getByRole('region', { name: 'Booking fee and payment', exact: true })

  await expect(panel).toBeVisible()

  return panel
}

/**
 * Set an event's own booking fee on its admin page, through the second factor.
 *
 * @param {object} page The administrator's page.
 * @param {string} eventId The event.
 * @param {object} fee The fee.
 * @param {string} fee.percent The percentage, as typed.
 * @param {string} fee.amount The amount per ticket, as typed.
 * @param {string} [fee.reason] Why.
 * @param {boolean} [fee.mustAsk] Whether the second factor must be asked for.
 * @returns {Promise<object>} The panel.
 */
async function setFee(page, eventId, { percent, amount, reason = FEE_REASON, mustAsk = false }) {
  const panel = await termsPanel(page, eventId)
  const form = panel
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Save booking fee' }) })
  const percentage = form.getByLabel('Percentage of the ticket price')

  // The radio answers only once the panel has hydrated.
  await expect(async () => {
    await form.getByRole('radio', { name: 'Set this event’s own fee' }).check()
    await expect(percentage).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await percentage.fill(percent)
  await form.getByLabel(/^Amount per ticket/u).fill(amount)
  await form.getByLabel(/^Reason/u).fill(reason)
  await pressThroughStepUp(
    page,
    () => form.getByRole('button', { name: 'Save booking fee' }).click(),
    postTo(`/api/v1/platform/events/${eventId}/platform-fee`),
    { mustAsk },
  )
  await expect(
    panel.getByText('Booking fee saved. It applies to new orders from now.', { exact: true }),
  ).toBeVisible()

  return panel
}

/**
 * Switch paying at the venue on or off, or change its limit, on an event's
 * admin page, through the second factor.
 *
 * @param {object} page The administrator's page.
 * @param {string} eventId The event.
 * @param {'Turn on paying at the venue'|'Save limit'|'Turn off paying at the venue'} button What to press.
 * @param {object} [options] Options.
 * @param {number} [options.limit] The limit to type, when turning on or saving one.
 * @param {string} [options.reason] Why.
 * @param {boolean} [options.mustAsk] Whether the second factor must be asked for.
 * @returns {Promise<object>} The panel.
 */
async function setVenue(
  page,
  eventId,
  button,
  { limit, reason = VENUE_REASON, mustAsk = false } = {},
) {
  const panel = await termsPanel(page, eventId)
  const form = panel
    .locator('form')
    .filter({ has: page.getByRole('button', { name: button, exact: true }) })
  const reasonBox = form.getByLabel(/^Reason/u)

  // Typed until it holds: a field filled before hydration is emptied by it.
  await expect(async () => {
    if (limit !== undefined) {
      await form.getByLabel('Most tickets waiting to be paid at the door').fill(String(limit))
    }
    await reasonBox.fill(reason)
    await expect(reasonBox).toHaveValue(reason, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await pressThroughStepUp(
    page,
    () => form.getByRole('button', { name: button, exact: true }).click(),
    postTo(`/api/v1/platform/events/${eventId}/venue-payment`),
    { mustAsk },
  )

  return panel
}

/**
 * Make a generated referral code on the administrator's screen, and read it
 * from the success panel — the one place it is shown.
 *
 * @param {object} page The administrator's page.
 * @param {object} [options] Options.
 * @param {string|null} [options.eventTitle] The one event it works for; all events when null.
 * @param {number|null} [options.limit] How many orders may use it.
 * @param {boolean} [options.mustAsk] Whether the second factor must be asked for.
 * @returns {Promise<string>} The code.
 */
async function makeCode(page, { eventTitle = null, limit = null, mustAsk = false } = {}) {
  await page.goto('/admin/referral-codes/new')

  const chosen = page.getByRole('radio', { name: 'Chosen events', exact: true })
  const all = page.getByRole('radio', { name: 'All events', exact: true })

  await expect(async () => {
    await (eventTitle ? chosen : all).check()
    await expect(eventTitle ? chosen : all).toBeChecked({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  if (eventTitle) {
    await page.getByLabel(/^Find an event/u).fill(eventTitle)
    await page.getByRole('button', { name: 'Search events', exact: true }).click()
    await page.getByRole('button', { name: `Add ${eventTitle}`, exact: true }).click()
    await expect(page.getByRole('list', { name: 'Chosen events' })).toContainText(eventTitle)
  }

  if (limit !== null) await page.getByLabel(/^Limit \(optional\)/u).fill(String(limit))

  await pressThroughStepUp(
    page,
    () => page.getByRole('button', { name: 'Make referral code', exact: true }).click(),
    postTo('/api/v1/platform/referral-codes'),
    { mustAsk },
  )

  const made = page.getByRole('region', { name: 'Referral code made' })

  await expect(made).toBeVisible()
  await expect(made).toContainText('Give this code only to the people it is for.')

  const code = (await made.locator('p.font-mono').innerText()).trim()

  expect(code.length).toBeGreaterThanOrEqual(6)

  return code
}

/**
 * The administrator's list row for one referral code.
 *
 * @param {object} page The administrator's page, on `/admin/referral-codes`.
 * @param {string} code The code.
 * @returns {object} The row's locator.
 */
function codeRow(page, code) {
  return page.getByRole('row').filter({ hasText: code })
}

/**
 * Open the door on one event, and on one night when it has nights.
 *
 * @param {object} page The steward's page.
 * @param {string} title The event's title.
 * @param {RegExp|null} [night] The night's option, when the event has nights.
 * @returns {Promise<void>} Resolves once the door is open.
 */
async function openDoor(page, title, night = null) {
  await page.goto('/organizer/check-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()

  const choose = page.getByLabel('Event you are admitting to')
  const option = choose.locator('option', { hasText: title })

  await expect(option).toHaveCount(1)

  const value = await option.getAttribute('value')

  // Chosen once the select answers: a choice made before hydration is lost.
  await expect(async () => {
    await choose.selectOption(value)
    await expect(page.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })

  if (night) {
    const select = page.getByLabel('Night you are admitting to')
    const nightValue = await select.locator('option', { hasText: night }).getAttribute('value')

    await select.selectOption(nightValue)
    await expect(select).toHaveValue(nightValue)
  }
}

/**
 * Type a printed ticket or group code at the door and look it up.
 *
 * @param {object} page The steward's page.
 * @param {string} code The code.
 * @returns {Promise<void>} Resolves once sent.
 */
async function typeCode(page, code) {
  await page.getByLabel(/^Printed ticket code/u).fill(code)
  await page.getByRole('button', { name: 'Look up', exact: true }).click()
}

/**
 * Open an organiser's "Payments at the venue" page, through the second factor
 * it asks for before it shows anything.
 *
 * @param {object} page A member's page.
 * @param {string} eventId The event.
 * @returns {Promise<void>} Resolves once the figures are there.
 */
async function openVenuePayments(page, eventId) {
  await page.goto(`/organizer/events/${eventId}/venue-payments`)
  await confirmIfAsked(page)
  await expect(page.getByRole('heading', { level: 2, name: 'Figures' })).toBeVisible()
}

/**
 * One of the organiser's figures.
 *
 * @param {object} page The page.
 * @param {string} label The figure's name.
 * @returns {object} Its value's locator.
 */
function figure(page, label) {
  return valueOf(page.locator('main'), label)
}

/**
 * Cancel unpaid tickets of one booking through its dialog, answering both
 * second factors it may ask for.
 *
 * @param {object} page The page with the booking's button on it.
 * @param {string} reference The booking.
 * @param {object} options Options.
 * @param {number} options.untick How many of the ticked tickets to untick, from the last.
 * @returns {Promise<object>} The dialog, before it closed.
 */
async function cancelUnpaid(page, reference, { untick = 0 } = {}) {
  const open = page.getByRole('button', { name: `Cancel unpaid tickets in booking ${reference}` })
  const dialog = page.getByRole('dialog', { name: 'Cancel unpaid tickets' })

  // Pressed until the dialog opens: a press before hydration does nothing.
  await expect(async () => {
    if ((await dialog.count()) === 0) await open.click()
    await expect(dialog).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await expect(dialog).toContainText(`Booking ${reference}`)

  // Reading the booking's tickets may ask for the second factor first.
  const tickets = dialog.getByRole('group', { name: 'Tickets to cancel' })
  const first = await Promise.race([
    tickets.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'read'),
    stepUpPrompt(page)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'prompted'),
  ])

  if (first === 'prompted') await confirmStepUp(page)
  await expect(tickets).toBeVisible()

  return { dialog, tickets, untick }
}

/**
 * Say why, press the cancel button and answer the second factor it asks for.
 *
 * @param {object} page The page.
 * @param {object} dialog The dialog.
 * @param {number} count How many tickets are ticked.
 * @param {string} reference The booking.
 * @returns {Promise<void>} Resolves once cancelled.
 */
async function sendCancel(page, dialog, count, reference) {
  await dialog.getByLabel(/^Reason/u).fill(CANCEL_REASON)
  await pressThroughStepUp(
    page,
    () =>
      dialog
        .getByRole('button', {
          name: `Cancel ${count} unpaid ${count === 1 ? 'ticket' : 'tickets'}`,
          exact: true,
        })
        .click(),
    postTo(`/api/v1/orders/${reference}/venue-cancellations`),
  )
}

/**
 * Cancel an event from its editor's review step, as its organiser.
 *
 * @param {object} page The owner's page.
 * @param {string} eventId The event.
 * @param {RegExp} confirmation What the confirmation must say about bookings paid at the venue.
 * @returns {Promise<void>} Resolves once cancelled.
 */
async function cancelEvent(page, eventId, confirmation) {
  await page.goto(`/organizer/events/${eventId}`)
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  const review = page
    .getByRole('navigation', { name: 'Editor steps' })
    .getByRole('button', { name: /review/iu })

  await review.click()
  await expect(review).toHaveAttribute('aria-current', 'step')

  await page.getByRole('button', { name: 'Cancel this event', exact: true }).click()
  await expect(page.getByRole('main')).toContainText(confirmation)
  await page.getByLabel(/^Reason/u).selectOption({ index: 1 })
  await page
    .getByLabel(/what to tell ticket holders/iu)
    .fill('The hall cannot open on the night, so the event is called off.')
  await pressThroughStepUp(
    page,
    () => page.getByRole('button', { name: /yes, cancel this event/iu }).click(),
    postTo(`/api/v1/events/${eventId}/cancel`),
  )
}

/**
 * Approve and send the refund a cancellation asked for on one order, at the
 * refund screen, as somebody who may do both.
 *
 * Cancelling an event asks for its refunds and sends none: the refund is
 * REQUESTED until somebody who may approve refunds approves it, and it moves
 * when it is sent to the (simulated) provider.
 *
 * @param {object} page The page of an account holding `order:refund`.
 * @param {string} reference The order.
 * @param {number} amountCents What the refund must give back.
 * @returns {Promise<void>} Resolves once the refund has gone through.
 */
async function sendRefundOf(page, reference, amountCents) {
  await page.goto(
    `/finance/refunds?organizationId=${encodeURIComponent(seeded.organizationId)}&orderReference=${encodeURIComponent(reference)}`,
  )
  await confirmIfAsked(page)

  const links = page.locator('main a[href^="/finance/refunds/"]').filter({ hasText: reference })

  await expect(links).toHaveCount(1)
  await links.click()
  await confirmIfAsked(page)
  await expect(page.getByRole('heading', { name: /refund on/iu, level: 1 })).toBeVisible()

  for (const [label, path, becomes] of [
    ['Approve', /^\/api\/v1\/refunds\/[^/]+\/approve$/u, 'APPROVED'],
    ['Send it to the provider', /^\/api\/v1\/refunds\/[^/]+\/submit$/u, 'SUCCEEDED'],
  ]) {
    const form = page.getByRole('group', { name: label })

    // Pressed until its form opens: a press before hydration does nothing.
    await expect(async () => {
      if ((await form.count()) === 0) {
        await page.getByRole('button', { name: label, exact: true }).click()
      }
      await expect(form).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    await form.getByLabel(/^Why/u).fill('The event was called off; its refunds go back.')

    const answer = await pressThroughStepUp(
      page,
      () => form.getByRole('button', { name: label, exact: true }).click(),
      postTo(path),
    )

    const { data } = await answer.json()

    expect(data.status).toBe(becomes)
    // Only what was paid online goes back.
    expect(data.amountCents).toBe(amountCents)
    await expect(form).toHaveCount(0)
  }

  await expect(page.getByText('There is nothing to do here', { exact: false })).toBeVisible()
}

/**
 * Make a session's last confirmation older than every step-up window, as if
 * the account had been signed in for a while, so the next sensitive call is
 * asked for a second factor whatever happened earlier in the run.
 *
 * @param {string} email The account.
 * @returns {Promise<void>} Resolves once done.
 */
async function lapseStepUp(email) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.session.updateMany({
      where: { user: { email }, revokedAt: null },
      data: { mfaSatisfiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Confirm it is you through the API, as the step-up prompt does.
 *
 * @param {object} page The signed-in page.
 * @param {{factor: boolean}} options Whether the account has a second factor.
 * @returns {Promise<void>} Resolves once accepted.
 */
async function stepUpThroughApi(page, { factor }) {
  await forgetCodeUse()

  const answer = await callApi(page, 'POST', '/api/v1/auth/step-up', {
    password: PASSWORD,
    ...(factor ? { code: totp(TOTP_SECRET) } : {}),
  })

  expect(answer.status, answer.text).toBeLessThan(300)
}

test.describe.serial('booking fees, referral codes and paying at the venue', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000)

    seeded = await seedVenuePayments(ids().tag)

    const { ga, twoNights, pastNight } = seeded.events
    const buyer1 = await windowFor(browser, 'buyer1')
    const buyer2 = await windowFor(browser, 'buyer2')
    const buyer3 = await windowFor(browser, 'buyer3')

    // Each order through the checkout's own calls, so its payment is one the
    // simulated provider took in this run.
    bought.b3GaCard = await buyThroughApi(buyer3, {
      eventId: ga.id,
      items: [{ ticketTypeId: ga.tiers[0], quantity: 1 }],
      buyer: { email: names().buyer3Email, name: names().buyer3Name },
    })
    bought.b1Passes = await buyThroughApi(buyer1, {
      eventId: twoNights.id,
      items: [{ ticketTypeId: twoNights.passTierId, quantity: 2 }],
      paymentMethod: 'AT_VENUE',
      buyer: { email: names().buyer1Email, name: names().buyer1Name },
    })
    bought.b2Past = await buyThroughApi(buyer2, {
      eventId: pastNight.id,
      items: [{ ticketTypeId: pastNight.tiers[0], quantity: 1 }],
      paymentMethod: 'AT_VENUE',
      buyer: { email: names().buyer2Email, name: names().buyer2Name },
    })

    // The site's own fee on $40: 5.90% plus $0.99.
    expect(bought.b3GaCard.totalCents).toBe(4_335)
    // Two $45 passes to pay at the door, their fee online at the site's rate.
    expect(bought.b1Passes.totalCents).toBe(729)
    expect(bought.b1Passes.venueDueCents).toBe(9_000)

    // The past night's one night moves to yesterday, and the scanner took the
    // $25 at its door and let the ticket in during it.
    expect((await finishPastNight(ids().tag, bought.b2Past.reference)).paidCents).toBe(2_500)
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupVenuePayments(ids().tag)
  })

  test('a visitor’s header offers Sign in and then Sign up', async ({ visitor }) => {
    await visitor.goto('/events')

    const header = visitor.getByRole('banner')
    const signIn = header.getByRole('link', { name: 'Sign in', exact: true })
    const signUp = header.getByRole('link', { name: 'Sign up', exact: true })

    await expect(signIn).toBeVisible()
    await expect(signUp).toBeVisible()
    await expect(signUp).toHaveAttribute('href', /^\/register(?:\?|$)/u)
    await expect(signIn).toHaveAttribute('href', /^\/sign-in(?:\?|$)/u)

    // In that order, Sign in first.
    const order = await header
      .getByRole('link', { name: /^Sign (?:in|up)$/u })
      .evaluateAll((links) => links.map((link) => link.textContent.trim()))

    expect(order).toEqual(['Sign in', 'Sign up'])
  })

  test('V1: an administrator sets a live event’s booking fee; a new buyer sees it, an old order keeps its own', async ({
    browser,
    visitor,
  }) => {
    const admin = await windowFor(browser, 'admin')
    const { ga } = seeded.events

    // Signed in a moment ago, so the confirmation is aged first: the save has
    // to ask for the second factor whenever it runs.
    await lapseStepUp(names().adminEmail)

    const panel = await setFee(admin, ga.id, { percent: '3', amount: '1.49', mustAsk: true })
    const terms = '3.00% of the ticket price plus $1.49 per ticket'

    await expect(panel).toContainText(`This event: ${terms}.`)
    await expect(panel).toContainText(`Changed by ${names().adminName} on `)

    const changes = panel.locator('ol').first()

    await expect(changes).toContainText(`${names().adminName} set the booking fee to`)
    await expect(changes).toContainText(FEE_REASON)

    // A new buyer is shown the event's own fee: $40 + 3% + $1.49.
    await visitor.goto(`/events/${ga.slug}`)
    await expect(visitor.locator('main')).toContainText('$42.69')

    // An order placed before keeps the fee it was charged.
    const buyer3 = await windowFor(browser, 'buyer3')

    await buyer3.goto(`/account/orders/${bought.b3GaCard.reference}`)
    await expect(valueOf(buyer3.locator('main'), 'Booking fee')).toHaveText('$3.35')
    await expect(valueOf(buyer3.locator('main'), 'Total')).toHaveText('$43.35')

    // And the terms it was priced with are still the site's, as recorded.
    const kept = await callApi(buyer3, 'GET', `/api/v1/orders/${bought.b3GaCard.reference}`)

    expect(kept.status, kept.text).toBe(200)
    expect(kept.data.fee).toEqual({ percentageBps: 590, flatCentsPerTicket: 99 })

    // The organiser reads the terms, who set them and why, and changes nothing.
    const owner = await windowFor(browser, 'owner')

    await owner.goto(`/organizer/events/${ga.id}`)

    const summary = owner.getByTestId('payment-terms-summary')

    await expect(summary).toContainText(
      `Booking fee on this event: ${terms}. Set by the Desi-Event team.`,
    )
    await expect(summary).toContainText(names().adminName)
    await expect(summary).toContainText(FEE_REASON)
    await expect(summary).toContainText('Pay at the venue: Off.')
    await expect(owner.getByRole('button', { name: 'Save booking fee' })).toHaveCount(0)
    await expect(owner.getByRole('button', { name: /paying at the venue/iu })).toHaveCount(0)
  })

  test('V2: a fee can be set on an event in any state but deleted, by an administrator or a super administrator', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const admin = await windowFor(browser, 'admin')
    const { draft, ended, cancelled, deleted } = seeded.events

    // Before it is published, both sentences say what the team may do.
    const draftPanel = await termsPanel(admin, draft.id)

    await expect(admin.locator('main')).toContainText(
      'The Desi-Event team edits an event’s details only once it has been published.',
    )
    await expect(draftPanel).toContainText(
      'You can set this event’s booking fee and whether it can be paid for at the venue now, before it is published.',
    )
    await setFee(admin, draft.id, { percent: '4', amount: '1.00' })
    await setFee(admin, ended.id, { percent: '2.5', amount: '0.50' })
    await setFee(admin, cancelled.id, { percent: '1', amount: '0.25' })

    const superAdmin = await windowFor(browser, 'super')

    await setFee(superAdmin, draft.id, { percent: '5', amount: '2.00' })
    await expect((await termsPanel(superAdmin, draft.id)).locator('ol').first()).toContainText(
      `${names().superName} set the booking fee to`,
    )

    // Deleted: read-only, and the API refuses.
    const deletedPanel = await termsPanel(admin, deleted.id)

    await expect(deletedPanel).toContainText(
      'This event was deleted. Its booking fee and payment settings are kept as they were and come back if it is restored.',
    )
    await expect(deletedPanel.getByRole('button', { name: 'Save booking fee' })).toHaveCount(0)

    const refused = await callApi(
      admin,
      'POST',
      `/api/v1/platform/events/${deleted.id}/platform-fee`,
      {
        source: 'EVENT',
        percentageBps: 300,
        flatCentsPerTicket: 149,
        reason: FEE_REASON,
        expectedSequence: 0,
      },
    )

    expect(refused.status, refused.text).toBe(409)
    expect(refused.code).toBe('NOT_EDITABLE')
  })

  test('V3: when the fee changes during checkout, the buyer sees the new total before paying', async ({
    browser,
  }) => {
    const { ga } = seeded.events
    const buyer1 = await windowFor(browser, 'buyer1')

    await openCheckout(buyer1, ga)
    await choose(buyer1, 'General admission', 2)
    await reserve(buyer1)
    await expect(
      buyer1.getByRole('button', { name: 'Pay $85.38 (simulated)', exact: true }),
    ).toBeEnabled()

    // Meanwhile, in another window, the administrator raises the fee.
    const admin = await windowFor(browser, 'admin')

    await setFee(admin, ga.id, { percent: '3.5', amount: '1.49' })

    await buyer1.getByRole('button', { name: 'Pay $85.38 (simulated)', exact: true }).click()

    const alert = buyer1.getByRole('alert').filter({ hasText: 'The booking fee changed' })

    await expect(alert).toContainText(
      'The booking fee for this event changed while you were booking. It is now $5.78.',
    )
    await expect(summaryOf(buyer1).getByTestId('summary-total')).toHaveText('$85.78')

    bought.b1GaCard = await payAndBook(buyer1, 'Pay $85.78 (simulated)', 'Booked')

    await buyer1.goto(`/account/orders/${bought.b1GaCard}`)
    await expect(valueOf(buyer1.locator('main'), 'Booking fee')).toHaveText('$5.78')
    await expect(valueOf(buyer1.locator('main'), 'Total')).toHaveText('$85.78')

    // The order records the terms it was priced with: the new 3.50% + $1.49.
    // The order page does not print them (SPEC3 §12.7), so they are read from
    // the order the page is drawn from.
    const placed = await callApi(buyer1, 'GET', `/api/v1/orders/${bought.b1GaCard}`)

    expect(placed.status, placed.text).toBe(200)
    expect(placed.data.fee).toEqual({ percentageBps: 350, flatCentsPerTicket: 149 })
  })

  test('V4: paying at the venue is switched on, and a buyer books paying only the booking fee online', async ({
    browser,
  }) => {
    const { ga } = seeded.events
    const buyer2 = await windowFor(browser, 'buyer2')

    // Off by default: no choice is offered.
    await openCheckout(buyer2, ga)
    await choose(buyer2, 'General admission', 1)
    await expect(summaryOf(buyer2).getByTestId('summary-total')).toBeVisible()
    await expect(buyer2.getByRole('group', { name: 'How do you want to pay?' })).toHaveCount(0)

    const admin = await windowFor(browser, 'admin')

    // The switch asks for the second factor whenever it is changed.
    await lapseStepUp(names().adminEmail)

    const panel = await setVenue(admin, ga.id, 'Turn on paying at the venue', {
      limit: 50,
      mustAsk: true,
    })

    await expect(panel).toContainText(
      'Paying at the venue turned on, up to 50 tickets waiting to be paid at the door.',
    )
    await expect(panel.getByTestId('venue-status')).toHaveText(
      'On — up to 50 tickets waiting to be paid at the door',
    )
    // What the limit counts, under its field.
    await expect(panel).toContainText('Unpaid tickets for nights that are over still count.')

    await openCheckout(buyer2, ga)
    await choose(buyer2, 'General admission', 2)
    await reserve(buyer2)
    await payBy(buyer2, 'Pay at the venue')

    const summary = summaryOf(buyer2)

    await expect(summary).toContainText('No sales tax is added to tickets paid at the venue.')
    await expect(valueOf(summary, 'Sales tax')).toHaveText('$0.00')
    await expect(summary.getByTestId('summary-online')).toHaveText('$5.78')
    await expect(summary.getByTestId('summary-door')).toHaveText('$80.00')

    bought.b2Ga = await payAndBook(
      buyer2,
      'Pay booking fee $5.78 (simulated)',
      'Booked — pay at the door',
    )
    await expect(buyer2.locator('main')).toContainText('Booked. Pay $80.00 at the door.')

    // The order's own figures: the fee paid online, the price owed at the door.
    await buyer2.goto(`/account/orders/${bought.b2Ga}`)
    await expect(valueOf(buyer2.locator('main'), 'Paid online (simulated)')).toHaveText('$5.78')
    await expect(valueOf(buyer2.locator('main'), 'To pay at the door')).toHaveText('$80.00')

    const booked = await callApi(buyer2, 'GET', `/api/v1/orders/${bought.b2Ga}`)

    expect(booked.status, booked.text).toBe(200)
    expect(booked.data).toMatchObject({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      totalCents: 578,
      feesCents: 578,
      feeWaivedCents: 0,
      venuePayment: { state: 'TO_PAY', dueCents: 8_000, unpaidCents: 8_000, paidCents: 0 },
    })

    // The orders list says what is owed.
    await buyer2.goto('/account/orders')
    await expect(
      buyer2.getByRole('listitem').filter({ hasText: bought.b2Ga }).first(),
    ).toContainText('Booked — pay $80.00 at the door')

    // Each ticket owes its price, and can be passed on like any other.
    await buyer2.goto('/tickets')

    // The ticket cards, each its own pass's link; the group pass's card names
    // the order too, and is not a ticket.
    const cards = buyer2
      .getByRole('listitem')
      .filter({ hasText: bought.b2Ga })
      .filter({ has: buyer2.locator('h3 a[href^="/tickets/"]') })

    await expect(cards).toHaveCount(2)

    for (const card of await cards.all()) {
      await expect(card).toContainText('Pay at the door: $40.00')
      await expect(card).not.toContainText('Ready to use')
    }

    const [ticket] = await ticketsOf(bought.b2Ga)

    await buyer2.goto(`/tickets/${ticket.id}`)
    await expect(buyer2.getByRole('region', { name: 'Where it stands' })).toContainText(
      'Pay this at the door. The steward records it before letting you in.',
    )
    await expect(
      buyer2.getByRole('button', { name: 'Offer this ticket to somebody', exact: true }),
    ).toBeVisible()
  })

  test('V4b: where a tax exists, none is added to tickets paid at the venue', async ({
    browser,
  }) => {
    const { toronto } = seeded.events
    const buyer1 = await windowFor(browser, 'buyer1')

    await openCheckout(buyer1, toronto)
    await choose(buyer1, 'General admission', 1)
    await reserve(buyer1)

    const summary = summaryOf(buyer1)

    await expect(valueOf(summary, 'HST (13%)')).toHaveText('$5.64')
    await expect(summary.getByTestId('summary-total')).toHaveText('$48.99')

    await payBy(buyer1, 'Pay at the venue')
    await expect(valueOf(summary, 'HST')).toHaveText('$0.00')
    await expect(summary).toContainText('No HST is added to tickets paid at the venue.')
    await expect(summary.getByTestId('summary-online')).toHaveText('$3.35')
    await expect(summary.getByTestId('summary-door')).toHaveText('$40.00')

    bought.b1Toronto = await payAndBook(
      buyer1,
      'Pay booking fee $3.35 (simulated)',
      'Booked — pay at the door',
    )

    await buyer1.goto(`/account/orders/${bought.b1Toronto}`)

    const main = buyer1.locator('main')

    await expect(valueOf(main, 'HST')).toHaveText('$0.00')
    await expect(main).not.toContainText('$5.64')
  })

  test('V5: a referral code for one event, used once, waives the fee; anybody else is refused in one sentence', async ({
    browser,
  }) => {
    const { ga } = seeded.events
    const admin = await windowFor(browser, 'admin')

    // Making a code asks for the second factor whenever it is done.
    await lapseStepUp(names().adminEmail)

    codes.gaOnce = await makeCode(admin, { eventTitle: ga.title, limit: 1, mustAsk: true })

    const buyer1 = await windowFor(browser, 'buyer1')

    await openCheckout(buyer1, ga)
    await choose(buyer1, 'General admission', 2)
    await reserve(buyer1)
    await payBy(buyer1, 'Pay at the venue')
    await applyReferral(buyer1, codes.gaOnce)

    const summary = summaryOf(buyer1)

    await expect(summary).toContainText('Booking fee removed with your referral code.')
    await expect(summary.getByTestId('summary-online')).toHaveText('Nothing to pay online')

    bought.b1GaVenue = await payAndBook(
      buyer1,
      'Book now — pay $80.00 at the door',
      'Booked — pay at the door',
    )

    // Nothing was paid online: the whole $5.78 fee was waived.
    await buyer1.goto(`/account/orders/${bought.b1GaVenue}`)

    const order = buyer1.locator('main')

    await expect(valueOf(order, 'Paid online (simulated)')).toHaveText('$0.00')
    await expect(valueOf(order, 'To pay at the door')).toHaveText('$80.00')
    await expect(order).toContainText('Nothing was paid online for this order.')

    const waived = await callApi(buyer1, 'GET', `/api/v1/orders/${bought.b1GaVenue}`)

    expect(waived.status, waived.text).toBe(200)
    expect(waived.data).toMatchObject({
      paymentMethod: 'AT_VENUE',
      totalCents: 0,
      feeGrossCents: 578,
      feeWaivedCents: 578,
      referralApplied: true,
      venuePayment: { state: 'TO_PAY', unpaidCents: 8_000 },
    })

    // Used up: the next buyer is told, in the one sentence every refusal shares.
    const buyer3 = await windowFor(browser, 'buyer3')

    await openCheckout(buyer3, ga)
    await choose(buyer3, 'General admission', 1)
    await reserve(buyer3)
    await applyReferral(buyer3, codes.gaOnce)
    await expect(summaryOf(buyer3)).toContainText(
      'This referral code can’t be used for this booking.',
    )
    await expect(summaryOf(buyer3)).not.toContainText(
      'Booking fee removed with your referral code.',
    )

    // The administrators' list counts the use and what it waived.
    await admin.goto('/admin/referral-codes')

    const row = codeRow(admin, codes.gaOnce)

    await expect(row).toContainText('1 of 1')
    await expect(row).toContainText('$5.78')
    await expect(row).toContainText(names().adminName)

    // "By administrator": this run's administrator, one code so far, its one
    // use and what it waived. The name carries the run's tag, so the row is
    // this run's and nobody else's.
    await expect(admin.getByRole('heading', { name: 'By administrator' })).toBeVisible()

    const maker = admin
      .getByRole('table', { name: 'Referral codes by the administrator who made them' })
      .getByRole('row')
      .filter({ has: admin.getByRole('rowheader', { name: names().adminName, exact: true }) })

    await expect(maker).toHaveCount(1)
    // Codes, uses placed, given back, uses now, booking fees waived.
    await expect(maker.locator('td > span:last-child')).toHaveText(['1', '1', '0', '1', /\$5\.78/u])

    for (const address of visited) {
      expect(address, 'an address carried a referral code').not.toContain(codes.gaOnce)
    }
  })

  test('V5b: a promo code and an all-events referral code together on a card order; a code for one event is refused on another', async ({
    browser,
  }) => {
    const { ga, twoNights } = seeded.events
    const admin = await windowFor(browser, 'admin')

    codes.allEvents = await makeCode(admin)
    codes.gaOnly = await makeCode(admin, { eventTitle: ga.title })

    const buyer1 = await windowFor(browser, 'buyer1')

    await openCheckout(buyer1, twoNights)
    await choose(buyer1, 'Every night', 1)
    await reserve(buyer1)
    await applyReferral(buyer1, codes.gaOnly)
    await expect(summaryOf(buyer1)).toContainText(
      'This referral code can’t be used for this booking.',
    )

    const buyer2 = await windowFor(browser, 'buyer2')

    await openCheckout(buyer2, twoNights)
    await choose(buyer2, 'Every night', 1)
    await reserve(buyer2)

    const summary = summaryOf(buyer2)
    const promo = quoted(buyer2)

    await summary.getByLabel('Promo code', { exact: true }).fill(names().promoCode)
    await summary.getByRole('button', { name: 'Apply', exact: true }).click()
    await promo
    await applyReferral(buyer2, codes.allEvents)

    await expect(summary.getByTestId('summary-discount')).toHaveText('−$11.25')
    await expect(summary.getByTestId('summary-fee')).toHaveText('$2.98')
    await expect(summary.getByTestId('summary-fee-waived')).toHaveText('−$2.98')
    await expect(summary.getByTestId('summary-total')).toHaveText('$33.75')

    bought.b2Pass = await payAndBook(buyer2, 'Pay $33.75 (simulated)', 'Booked')

    await buyer2.goto(`/account/orders/${bought.b2Pass}`)
    await expect(buyer2.locator('main')).toContainText('Booking fee waived with a referral code.')

    // The order holds the same figures: $45 less 25%, its $2.98 fee waived.
    const paid = await callApi(buyer2, 'GET', `/api/v1/orders/${bought.b2Pass}`)

    expect(paid.status, paid.text).toBe(200)
    expect(paid.data).toMatchObject({
      status: 'PAID',
      paymentMethod: 'CARD',
      totalCents: 3_375,
      feeGrossCents: 298,
      feeWaivedCents: 298,
      referralApplied: true,
      venuePayment: null,
    })

    for (const code of [codes.allEvents, codes.gaOnly]) {
      for (const address of visited) {
        expect(address, 'an address carried a referral code').not.toContain(code)
      }
    }
  })

  test('V6: the door takes the money and admits in one step, for one ticket and for a group pass', async ({
    browser,
  }) => {
    test.setTimeout(180_000)

    const { ga } = seeded.events
    const scanner = await windowFor(browser, 'scanner')
    const [first] = await ticketsOf(bought.b2Ga)

    firstAdmitted = first.id

    await openDoor(scanner, ga.title)
    await typeCode(scanner, first.code)

    await expect(scanner.getByRole('heading', { name: 'Payment to take' }).first()).toBeVisible()

    const main = scanner.locator('main')

    await expect(main).toContainText('Take $40.00 for this ticket before letting them in.')
    await expect(main).toContainText('This booking has 1 more ticket to pay at the door ($40.00).')
    await scanner
      .getByRole('button', { name: 'Payment taken: $40.00 — admit', exact: true })
      .click()
    await expect(main).toContainText('Admitted. Payment recorded: $40.00.')

    // buyer1's group pass, read from the order page that shows it on request.
    const buyer1 = await windowFor(browser, 'buyer1')

    await buyer1.goto(`/account/orders/${bought.b1GaVenue}#group-pass`)

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

    await openDoor(scanner, ga.title)
    await typeCode(scanner, groupCode)
    await expect(main).toContainText('Payment to take for the ticked tickets: $80.00')
    await scanner
      .getByRole('button', { name: 'Payment taken: $80.00 — admit 2', exact: true })
      .click()
    await expect(main).toContainText('Payment recorded: $80.00.')
    // Both tickets of the group are in.
    await expect(main).toContainText('Admitted 2.')

    // Each order says what was paid at the door, out of what it owed.
    await buyer1.goto(`/account/orders/${bought.b1GaVenue}`)
    await expect(valueOf(buyer1.locator('main'), 'Paid at the door')).toHaveText('$80.00 of $80.00')
    await expect(valueOf(buyer1.locator('main'), 'To pay at the door')).toHaveCount(0)

    const buyer2 = await windowFor(browser, 'buyer2')

    await buyer2.goto(`/account/orders/${bought.b2Ga}`)
    await expect(valueOf(buyer2.locator('main'), 'Paid at the door')).toHaveText('$40.00 of $80.00')
    await expect(valueOf(buyer2.locator('main'), 'To pay at the door')).toHaveText('$40.00')

    // The organiser's finance member counts what the door took.
    const finance = await windowFor(browser, 'finance')

    await openVenuePayments(finance, ga.id)
    await expect(figure(finance, 'Payments taken at the door')).toHaveText('$120.00 (3 tickets)')
    await expect(figure(finance, 'Tickets booked to pay at the door, not paid')).toHaveText(
      '1 ($40.00)',
    )
  })

  test('V15: a ticket that owes its price is passed on, and its new holder pays at the door', async ({
    browser,
  }) => {
    test.setTimeout(180_000)

    const { ga } = seeded.events
    const buyer2 = await windowFor(browser, 'buyer2')
    const second = (await ticketsOf(bought.b2Ga)).find(
      (ticket) => ticket.id !== firstAdmitted && ticket.checkedInAt === null,
    )

    await buyer2.goto(`/tickets/${second.id}`)

    const offer = buyer2.getByRole('button', { name: 'Offer this ticket to somebody', exact: true })
    const email = buyer2.getByLabel(/^Their email address/u)

    // Pressed until its form opens: a press before hydration does nothing.
    await expect(async () => {
      if ((await email.count()) === 0) await offer.click()
      await expect(email).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await expect(buyer2.locator('main')).toContainText(
      'This ticket’s price, $40.00, is paid at the door. Whoever you pass it to pays it when they arrive, and you no longer do.',
    )
    await email.fill(names().buyer3Email)

    const offered = buyer2.waitForResponse(postTo(`/api/v1/tickets/${second.id}/transfers`))

    await buyer2.getByRole('button', { name: 'Send the offer', exact: true }).click()
    expect((await offered).status()).toBe(201)

    const field = buyer2.getByLabel('Ticket transfer code', { exact: true })
    const transferCode = await field.inputValue()

    expect(transferCode.length).toBeGreaterThanOrEqual(16)
    await expect(buyer2.locator('main')).toContainText(
      'Tell them: whoever holds this ticket pays $40.00 at the door.',
    )
    await buyer2.getByRole('button', { name: 'I have handed it over', exact: true }).click()
    await expect(field).toHaveCount(0)

    const buyer3 = await windowFor(browser, 'buyer3')

    await buyer3.goto('/tickets/accept')
    await expect(buyer3.locator('main')).toContainText(
      'A ticket booked to pay at the door keeps its price: whoever holds it pays at the door, and the ticket shows how much.',
    )
    await buyer3.getByLabel(/invitation code/iu).fill(transferCode)
    await buyer3.getByRole('button', { name: 'Accept the ticket', exact: true }).click()
    await expect(buyer3.locator('main')).toContainText(
      'Ticket accepted. Pay $40.00 at the door when you arrive: the steward takes it before letting you in.',
    )

    for (const address of visited) {
      expect(address, 'an address carried the transfer code').not.toContain(transferCode)
    }

    const passed = await successorOf(second.id)

    expect(passed?.status).toBe('VALID')

    await buyer3.goto('/tickets')
    await expect(
      buyer3.getByRole('listitem').filter({ hasText: passed.code }).first(),
    ).toContainText('Pay at the door: $40.00')

    // The giver no longer owes it, and is told who does.
    await buyer2.goto(`/account/orders/${bought.b2Ga}`)
    await expect(buyer2.locator('main')).toContainText(
      'Passed on — its new holder pays $40.00 at the door',
    )
    await expect(valueOf(buyer2.locator('main'), 'Status')).toContainText('Paid at the door')

    // At the door, the new holder's ticket owes $40.00 and nothing else of the
    // booking is theirs to pay.
    const scanner = await windowFor(browser, 'scanner')
    const main = scanner.locator('main')

    await openDoor(scanner, ga.title)
    await typeCode(scanner, passed.code)
    await expect(main).toContainText('Take $40.00 for this ticket before letting them in.')
    await expect(main).not.toContainText(/This booking has \d+ more/u)
    await scanner
      .getByRole('button', { name: 'Payment taken: $40.00 — admit', exact: true })
      .click()
    await expect(main).toContainText('Admitted. Payment recorded: $40.00.')

    await buyer2.goto(`/account/orders/${bought.b2Ga}`)
    await expect(
      valueOf(buyer2.locator('main'), 'Paid at the door by people you passed tickets to'),
    ).toHaveText('$40.00')

    const finance = await windowFor(browser, 'finance')

    await openVenuePayments(finance, ga.id)
    await expect(figure(finance, 'Tickets booked to pay at the door, not paid')).toHaveText(
      '0 ($0.00)',
    )
  })

  test('V13: the organiser cancels one unpaid ticket; its place goes back on sale and the fee is kept', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const { twoNights } = seeded.events
    const reference = bought.b1Passes.reference

    // The finance member reads the booking and is offered no cancellation.
    const finance = await windowFor(browser, 'finance')

    await openVenuePayments(finance, twoNights.id)
    await expect(finance.locator('main')).toContainText(reference)
    await expect(finance.getByRole('button', { name: /^Cancel unpaid tickets/u })).toHaveCount(0)

    const soldBefore = await soldOf(twoNights.passTierId)
    const owner = await windowFor(browser, 'owner')

    await openVenuePayments(owner, twoNights.id)

    const { dialog, tickets } = await cancelUnpaid(owner, reference)
    const boxes = tickets.getByRole('checkbox', { name: /Every night — \$45\.00$/u })

    await expect(boxes).toHaveCount(2)
    await expect(boxes.nth(0)).toBeChecked()
    await expect(boxes.nth(1)).toBeChecked()
    await boxes.nth(1).uncheck()
    await sendCancel(owner, dialog, 1, reference)

    await expect(owner.locator('main')).toContainText(
      '1 ticket cancelled. Its place is back on sale.',
    )

    // Read afresh, through the second factor if the page asks again.
    await openVenuePayments(owner, twoNights.id)

    const cancelledTable = owner.getByRole('table', { name: 'Cancelled unpaid tickets' })

    await expect(cancelledTable).toContainText(reference)
    await expect(cancelledTable).toContainText(CANCEL_REASON)
    // When, in the event's own zone (America/Chicago), named.
    await expect(cancelledTable).toContainText(
      /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M C[DS]T/u,
    )
    await expect(figure(owner, 'Unpaid tickets cancelled')).toHaveText('1 ($45.00 no longer owed)')
    await expect(figure(owner, 'Booking fees on them, kept by Desi-Event')).toHaveText('$3.64')

    // Its place is on sale again.
    expect(await soldOf(twoNights.passTierId)).toBe(soldBefore - 1)

    // The buyer is told what happened, and why.
    const buyer1 = await windowFor(browser, 'buyer1')

    await buyer1.goto(`/account/orders/${reference}`)

    const main = buyer1.locator('main')

    await expect(main).toContainText(
      /The organiser cancelled 1 ticket on [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4} because it was not paid for\. You no longer owe \$45\.00 for it\./u,
    )
    await expect(main).toContainText(
      'The booking fee paid for it online, $3.64, is kept by Desi-Event and is not refunded.',
    )
    await expect(main).toContainText(`Reason given: “${CANCEL_REASON}”`)

    await buyer1.goto('/tickets')

    const cancelledCard = buyer1
      .getByRole('listitem')
      .filter({ hasText: reference })
      .filter({ has: buyer1.locator('h3 a[href^="/tickets/"]') })
      .filter({ hasText: 'Cancelled — not paid' })

    await expect(cancelledCard).toHaveCount(1)
    // Its holder reads why, as the organiser gave it, and never the internal
    // cause the ticket's own record carries.
    await expect(cancelledCard).toContainText(`Reason given: “${CANCEL_REASON}”`)
    await expect(cancelledCard).not.toContainText('venue-unpaid:')

    // The door refuses it by its printed code.
    const cancelledTicket = (await ticketsOf(reference)).find(
      (ticket) => ticket.venueCancellationId !== null,
    )
    const scanner = await windowFor(browser, 'scanner')

    await openDoor(scanner, twoNights.title, /^Night 1 · /u)
    await typeCode(scanner, cancelledTicket.code)
    await expect(scanner.getByRole('heading', { name: 'Cancelled — not paid' })).toBeVisible()
    await expect(scanner.locator('main')).toContainText(
      "This ticket was cancelled because it had not been paid for. Don't let it in.",
    )
  })

  test('V7: paying at the venue is switched off mid-checkout, and the buyer pays by card instead', async ({
    browser,
  }) => {
    const { twoNights } = seeded.events
    const buyer3 = await windowFor(browser, 'buyer3')

    await openCheckout(buyer3, twoNights)
    await choose(buyer3, 'Night 2', 1)
    await reserve(buyer3)
    await payBy(buyer3, 'Pay at the venue')
    await expect(
      buyer3.getByRole('button', { name: /^Pay booking fee \$[\d.]+ \(simulated\)$/u }),
    ).toBeEnabled()

    const admin = await windowFor(browser, 'admin')
    const panel = await setVenue(admin, twoNights.id, 'Turn off paying at the venue')

    await expect(panel.getByTestId('venue-status')).toHaveText('Off')

    await buyer3.getByRole('button', { name: /^Pay booking fee \$[\d.]+ \(simulated\)$/u }).click()

    const alert = buyer3
      .getByRole('alert')
      .filter({ hasText: 'Paying at the venue is not available' })

    await expect(alert).toContainText(
      'Paying at the venue was switched off for this event while you were booking.',
    )
    await expect(buyer3.locator(':focus')).toContainText(
      'Paying at the venue was switched off for this event while you were booking.',
    )
    await expect(summaryOf(buyer3).getByTestId('summary-total')).toHaveText('$27.47')
    // Card is what is chosen now. With the switch off the card quote offers no
    // venue, so the choice is not drawn at all (SPEC3 §12.1) and the only way
    // to pay is the card's, for its whole total.
    await expect(buyer3.getByRole('group', { name: 'How do you want to pay?' })).toHaveCount(0)
    await expect(buyer3.getByRole('radio', { name: 'Pay at the venue', exact: true })).toHaveCount(
      0,
    )
    await expect(buyer3.getByRole('button', { name: /^Pay booking fee/u })).toHaveCount(0)
    await expect(
      buyer3.getByRole('button', { name: 'Pay $27.47 (simulated)', exact: true }),
    ).toBeEnabled()

    bought.b3Night2 = await payAndBook(buyer3, 'Pay $27.47 (simulated)', 'Booked')

    // The organiser keeps the report while bookings to pay at the door exist.
    const owner = await windowFor(browser, 'owner')

    await owner.goto(`/organizer/events/${twoNights.id}`)

    const summary = owner.getByTestId('payment-terms-summary')

    await expect(summary).toContainText('Pay at the venue: Off.')
    await expect(summary.getByRole('link', { name: 'Payments at the venue' })).toBeVisible()
  })

  test('V8: once the event’s limit is reached, the buyer pays by card', async ({ browser }) => {
    const { toronto } = seeded.events
    const admin = await windowFor(browser, 'admin')
    const panel = await setVenue(admin, toronto.id, 'Save limit', { limit: 1 })

    await expect(panel).toContainText('1 ticket is waiting now.')
    await expect(panel.getByTestId('venue-status')).toHaveText(
      'On — up to 1 ticket waiting to be paid at the door',
    )
    // The limit counts every unpaid ticket, a night that is over included.
    await expect(panel).toContainText(
      'Across all buyers. Once this many are booked and unpaid, buyers pay by card. Unpaid tickets for nights that are over still count.',
    )

    const buyer3 = await windowFor(browser, 'buyer3')

    await openCheckout(buyer3, toronto)
    await choose(buyer3, 'General admission', 1)
    await reserve(buyer3)
    await payBy(buyer3, 'Pay at the venue')
    await buyer3
      .getByRole('button', { name: 'Pay booking fee $3.35 (simulated)', exact: true })
      .click()
    await expect(
      summaryOf(buyer3)
        .getByRole('alert')
        .filter({ hasText: 'Paying at the venue is not available' }),
    ).toContainText('Paying at the venue is full for this event. You can still pay by card.')

    bought.b3Toronto = await payAndBook(buyer3, 'Pay $48.99 (simulated)', 'Booked')
  })

  test('V14: the Desi-Event team cancels an unpaid ticket booked with a referral code, and the code’s use comes back', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const { ga } = seeded.events
    const admin = await windowFor(browser, 'admin')

    codes.gaReturn = await makeCode(admin, { eventTitle: ga.title, limit: 1 })

    const buyer3 = await windowFor(browser, 'buyer3')

    await openCheckout(buyer3, ga)
    await choose(buyer3, 'General admission', 1)
    await reserve(buyer3)
    await payBy(buyer3, 'Pay at the venue')
    await applyReferral(buyer3, codes.gaReturn)
    await expect(summaryOf(buyer3)).toContainText('Booking fee removed with your referral code.')

    bought.b3GaVenue = await payAndBook(
      buyer3,
      'Book now — pay $40.00 at the door',
      'Booked — pay at the door',
    )

    await admin.goto('/admin/referral-codes')
    await expect(codeRow(admin, codes.gaReturn)).toContainText('1 of 1')

    // From the event's page to its bookings waiting to be paid at the door.
    const panel = await termsPanel(admin, ga.id)

    await panel
      .getByRole('link', { name: /^Bookings waiting to be paid at the door: 1 ticket — review$/u })
      .click()
    await expect(admin).toHaveURL(new RegExp(`/admin/events/${ga.id}/venue-bookings$`, 'u'))

    const bookingsHeading = admin.getByRole('heading', {
      level: 1,
      name: 'Bookings waiting to be paid at the door',
    })

    // The page is there before asking whether it wants the second factor.
    await expect(bookingsHeading).toBeVisible()
    await confirmIfAsked(admin)
    await expect(bookingsHeading).toBeVisible()

    const main = admin.locator('main')

    await expect(main).toContainText(`Booking ${bought.b3GaVenue}`)
    await expect(main).toContainText('1 unpaid ($40.00)')
    await expect(main).not.toContainText(names().buyer3Name)

    const { dialog } = await cancelUnpaid(admin, bought.b3GaVenue)

    await sendCancel(admin, dialog, 1, bought.b3GaVenue)
    await expect(main).toContainText('1 ticket cancelled. Its place is back on sale.')
    await expect(main).not.toContainText('Open sales')

    // The use is given back, once, and the code works again.
    await admin.goto('/admin/referral-codes')

    const row = codeRow(admin, codes.gaReturn)

    await expect(row).toContainText('0 of 1')
    await expect(row).toContainText('1 placed, 1 given back')
    await row.getByRole('link', { name: /^Open/u }).click()

    // On the code's page, the cancelled booking's own row says its use came back.
    const use = admin
      .getByRole('table', { name: 'Orders placed with this code' })
      .getByRole('row')
      .filter({ hasText: bought.b3GaVenue })

    await expect(use).toHaveCount(1)
    await expect(use).toContainText('Unpaid tickets cancelled')

    const buyer1 = await windowFor(browser, 'buyer1')

    await openCheckout(buyer1, ga)
    await choose(buyer1, 'General admission', 1)
    await reserve(buyer1)
    await applyReferral(buyer1, codes.gaReturn)
    await expect(summaryOf(buyer1)).toContainText('Booking fee removed with your referral code.')

    // The buyer reads who cancelled it, and that nothing was paid online.
    await buyer3.goto(`/account/orders/${bought.b3GaVenue}`)

    const order = buyer3.locator('main')

    await expect(order).toContainText(/The Desi-Event team cancelled 1 ticket on /u)
    await expect(order).toContainText('Nothing was paid online for it.')
    await expect(valueOf(order, 'Status')).toContainText('Cancelled — not paid at the door')

    for (const address of visited) {
      expect(address, 'an address carried a referral code').not.toContain(codes.gaReturn)
    }
  })

  test('V9: a finance administrator refunds a booking fee by hand; the order stays paid and the ticket still admits', async ({
    browser,
  }) => {
    const finadmin = await windowFor(browser, 'finadmin')
    const reference = bought.b3GaCard.reference

    await finadmin.goto('/admin/fee-refunds')

    /**
     * Find the order on the page.
     *
     * @returns {Promise<object>} The result's section.
     */
    const find = async () => {
      const result = finadmin.getByRole('region', { name: `Order ${reference}` })

      // Typed and pressed until the order is found: before hydration the form
      // submits natively, which reloads the page with the field empty.
      await expect(async () => {
        await finadmin.getByLabel('Order reference', { exact: true }).fill(reference)
        await finadmin.getByRole('button', { name: 'Find order', exact: true }).click()
        await expect(result).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })

      return result
    }

    const result = await find()

    await expect(result.getByTestId('fee-refundable')).toHaveText('Can be refunded: $3.35')
    await result
      .getByLabel(/^Reason/u)
      .fill('The buyer was charged twice by mistake at the box office.')

    // Refunding a fee asks for the second factor whenever it is done.
    await lapseStepUp(names().finadminEmail)
    await pressThroughStepUp(
      finadmin,
      () =>
        result
          .getByRole('button', { name: 'Refund $3.35 booking fee (simulated)', exact: true })
          .click(),
      postTo(`/api/v1/platform/orders/${reference}/fee-refund`),
      { mustAsk: true },
    )
    await expect(finadmin.locator('main')).toContainText('Booking fee refunded (simulated): $3.35.')

    // Read again: nothing left to refund.
    await finadmin.goto('/admin/fee-refunds')

    const again = await find()

    await expect(valueOf(again, 'Already refunded')).toHaveText('$3.35')
    await expect(again.getByTestId('fee-refundable')).toHaveText('Can be refunded: $0.00')

    // The order is still paid, and its ticket still lets its holder in.
    const buyer3 = await windowFor(browser, 'buyer3')

    await buyer3.goto(`/account/orders/${reference}`)
    await expect(valueOf(buyer3.locator('main'), 'Status')).toHaveText('Paid — simulated')

    const [ticket] = await ticketsOf(reference)
    const scanner = await windowFor(browser, 'scanner')

    await openDoor(scanner, seeded.events.ga.title)
    await typeCode(scanner, ticket.code)
    await expect(
      scanner.getByRole('heading', { name: 'Check the ticket, then admit' }),
    ).toBeVisible()
    await scanner.getByRole('button', { name: 'Cancel', exact: true }).click()
  })

  test('V10: organisers, moderators and finance administrators are refused the Desi-Event team’s controls', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const { ga, twoNights } = seeded.events
    const fee = {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      reason: FEE_REASON,
      expectedSequence: 0,
    }
    const venue = { enabled: false, seen: { enabled: true, limit: 50 }, reason: VENUE_REASON }
    const code = { generate: true, scope: 'ALL_EVENTS' }
    const calls = {
      listCodes: (page) => callApi(page, 'GET', '/api/v1/platform/referral-codes'),
      makeCode: (page) => callApi(page, 'POST', '/api/v1/platform/referral-codes', code),
      setFee: (page) => callApi(page, 'POST', `/api/v1/platform/events/${ga.id}/platform-fee`, fee),
      setVenue: (page) =>
        callApi(page, 'POST', `/api/v1/platform/events/${ga.id}/venue-payment`, venue),
      refundFee: (page) =>
        callApi(page, 'POST', `/api/v1/platform/orders/${bought.b1GaCard}/fee-refund`, {
          reason: 'Asked by somebody who may not refund booking fees.',
          expectedRefundableCents: 578,
        }),
    }

    /**
     * Expect every named call to be refused with 403 for want of the
     * capability: FORBIDDEN, never STEP_UP_REQUIRED, which is a 403 too and
     * would also be the answer to a call wrongly allowed whose second factor
     * had lapsed.
     *
     * @param {object} page The signed-in page.
     * @param {string[]} which The calls.
     * @returns {Promise<void>} Resolves once checked.
     */
    async function refused(page, which) {
      for (const name of which) {
        const answer = await calls[name](page)

        expect(answer.status, `${name}: ${answer.text}`).toBe(403)
        expect(answer.code, `${name}: ${answer.text}`).toBe('FORBIDDEN')
      }
    }

    // A moderator: no tab in the workspace they do have, the administrators'
    // area refused whole, its pages too, and every call refused.
    const mod = await windowFor(browser, 'mod')

    await mod.goto('/moderation/events')
    await expect(mod.getByRole('link', { name: 'Referral codes', exact: true })).toHaveCount(0)
    await expect(mod.getByRole('link', { name: 'Booking fee refunds', exact: true })).toHaveCount(0)

    for (const address of ['/admin', '/admin/referral-codes', '/admin/fee-refunds']) {
      await mod.goto(address)
      await expect(mod.getByRole('heading', { level: 1, name: 'Not for you' })).toBeVisible()
      await expect(mod.locator('main')).toContainText(
        'This area is for the Desi-Event team’s platform administrators',
      )
      await expect(mod.getByRole('link', { name: 'Referral codes', exact: true })).toHaveCount(0)
      await expect(mod.getByRole('link', { name: 'Booking fee refunds', exact: true })).toHaveCount(
        0,
      )
      await expect(mod.getByRole('button', { name: 'Make referral code' })).toHaveCount(0)
      await expect(mod.getByRole('button', { name: 'Find order' })).toHaveCount(0)
    }

    await refused(mod, ['listCodes', 'makeCode', 'setFee', 'setVenue'])

    // The organisation's owner: none of the team's controls either.
    const owner = await windowFor(browser, 'owner')

    await refused(owner, ['listCodes', 'makeCode', 'setFee', 'setVenue', 'refundFee'])

    // A finance administrator refunds fees, and does nothing else of the team's.
    const finadmin = await windowFor(browser, 'finadmin')

    await refused(finadmin, ['setFee', 'setVenue', 'makeCode'])
    await finadmin.goto('/admin/organizer-invitations')
    await expect(finadmin.locator('main')).toContainText('Not for this account')

    // Nobody outside the organisation, nor its finance member or scanner, can
    // read or cancel its unpaid bookings: asked for a second factor first, an
    // answer that names no booking, then refused as if there were nothing.
    const [ticket] = await ticketsOf(bought.b1Passes.reference)
    const unpaid = (page) => callApi(page, 'GET', `/api/v1/events/${twoNights.id}/venue-bookings`)
    const cancel = (page) =>
      callApi(page, 'POST', `/api/v1/orders/${bought.b1Passes.reference}/venue-cancellations`, {
        ticketIds: [ticket.id],
        reason: CANCEL_REASON,
      })

    for (const [who, factor] of [
      ['mod', true],
      ['finadmin', true],
      ['finance', true],
      ['scanner', false],
    ]) {
      const page = await windowFor(browser, who)

      await lapseStepUp(names()[EMAILS[who]])

      for (const call of [unpaid, cancel]) {
        const first = await call(page)

        expect(first.code, `${who}: ${first.text}`).toBe('STEP_UP_REQUIRED')
        expect(first.text).not.toContain(bought.b1Passes.reference)
      }

      await stepUpThroughApi(page, { factor })

      for (const call of [unpaid, cancel]) {
        const then = await call(page)

        expect(then.status, `${who}: ${then.text}`).toBe(404)
        expect(then.text).not.toContain(bought.b1Passes.reference)
      }
    }

    // The owner, stepped up, reads them.
    await lapseStepUp(names().ownerEmail)
    await stepUpThroughApi(owner, { factor: true })

    const read = await unpaid(owner)

    expect(read.status, read.text).toBe(200)
  })

  test('V11: cancelling an event refunds only the booking fee paid online for tickets paid at the venue', async ({
    browser,
  }) => {
    test.setTimeout(180_000)

    const { toronto } = seeded.events
    const owner = await windowFor(browser, 'owner')

    await cancelEvent(
      owner,
      toronto.id,
      /For tickets paid at the venue, only the booking fee paid online is refunded \(simulated\)\./u,
    )

    // Cancelling asked for the refunds and sent none. Somebody who may approve
    // refunds approves each and sends it; the owner may do both.
    // buyer1's booking to pay at the venue gets back only its $3.35 fee;
    // buyer3's card order gets back all of its $48.99.
    await sendRefundOf(owner, bought.b1Toronto, 335)
    await sendRefundOf(owner, bought.b3Toronto, 4_899)

    const buyer1 = await windowFor(browser, 'buyer1')

    await expect(async () => {
      await buyer1.goto(`/account/orders/${bought.b1Toronto}`)
      await expect(buyer1.locator('main')).toContainText(
        'The booking fee you paid online was refunded (simulated).',
        { timeout: 2_000 },
      )
    }).toPass({ timeout: 60_000 })

    const buyer3 = await windowFor(browser, 'buyer3')

    await expect(async () => {
      await buyer3.goto(`/account/orders/${bought.b3Toronto}`)
      await expect(buyer3.locator('main')).toContainText('This order was refunded in full.', {
        timeout: 2_000,
      })
    }).toPass({ timeout: 60_000 })
  })

  test('V12: a finished event with a payment taken at the door is called off and deleted; that money is the organiser’s to return', async ({
    browser,
  }) => {
    test.setTimeout(240_000)

    const { pastNight } = seeded.events

    // It took place and somebody was let in, so deleting it as it stands
    // refunds nobody (SPEC2-XI X-D): to refund it, its organiser calls it off
    // first, and the Desi-Event team then deletes it, cancelling and refunding.
    const owner = await windowFor(browser, 'owner')

    await cancelEvent(
      owner,
      pastNight.id,
      /For tickets paid at the venue, only the booking fee paid online is refunded \(simulated\)\./u,
    )

    const admin = await windowFor(browser, 'admin')

    await admin.goto(`/admin/events/${pastNight.id}`)

    const dialog = admin.getByRole('region', { name: `Delete “${pastNight.title}”` })

    // Pressed until the dialog opens: a press before hydration does nothing.
    await expect(async () => {
      if ((await dialog.count()) === 0) {
        await admin.getByRole('button', { name: 'Delete this event…', exact: true }).click()
      }
      await expect(dialog).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await expect(dialog.getByText('Reading what deleting would do…')).toHaveCount(0)
    await expect(dialog).toContainText(
      'Payment taken at the door for 1 of these tickets ($25.00) is held by the organiser. Desi-Event does not hold it and cannot refund it.',
    )
    await dialog
      .getByLabel(/^Why is this event being deleted\?/u)
      .fill('Called off after the night; the listing should come down.')
    await dialog.getByLabel(/^Type the event’s web address/u).fill(pastNight.slug)
    await pressThroughStepUp(
      admin,
      () => dialog.getByRole('button', { name: 'Cancel, refund and delete', exact: true }).click(),
      postTo(`/api/v1/events/${pastNight.id}/delete`),
    )
    await expect(dialog.getByText('Deleted', { exact: true })).toBeVisible()

    const buyer2 = await windowFor(browser, 'buyer2')

    await buyer2.goto(`/account/orders/${bought.b2Past.reference}`)

    const main = buyer2.locator('main')

    await expect(main).toContainText('The booking fee you paid online was refunded (simulated).')
    await expect(main).toContainText(
      `The ${dollars(2_500)} you paid at the door is with the organiser, not with Desi-Event. Ask the organiser to return it.`,
    )

    // What went back is the booking fee paid online and nothing more: the
    // $25.00 taken at the door is not refunded by Desi-Event.
    const { totalCents } = bought.b2Past

    expect(totalCents).toBeGreaterThan(0)
    expect(totalCents).toBeLessThan(2_500)

    const live = (refunds) =>
      refunds.filter(
        (refund) => !['CANCELLED', 'DECLINED', 'FAILED', 'REJECTED'].includes(refund.status),
      )

    await expect
      .poll(
        async () =>
          (await refundsOf(bought.b2Past.reference))
            .filter((refund) => refund.status === 'SUCCEEDED')
            .reduce((sum, refund) => sum + refund.amountCents, 0),
        { timeout: 30_000 },
      )
      .toBe(totalCents)
    expect(
      live(await refundsOf(bought.b2Past.reference)).reduce(
        (sum, refund) => sum + refund.amountCents,
        0,
      ),
    ).toBe(totalCents)
  })
})
