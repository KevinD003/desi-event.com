import { createPrismaClient } from '@desi-event/db'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { statePath } from './support/detail-global-setup.mjs'
import { GA_PRICE_CENTS, TAKER_NAME } from './support/seed-feature-world.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * Buying tickets for one night with a promo code and a guest's name, in a
 * real browser against the real API.
 *
 * ## The world
 *
 * Gamma's general-admission event runs two labelled nights, each sold by its
 * own $25 tier, and gamma has three organisation-wide promo codes: a current
 * 10% one, an expired one and one whose single use is spent
 * (`seed-feature-world.mjs`).
 *
 * ## What only this file can show
 *
 * - The event page names its nights, with their dates in the venue's zone,
 *   and the checkout sells each night's tickets under that night.
 * - A code is checked by the server's quote, not the page: an unknown code, an
 *   expired one and a used-up one are each refused in words a buyer can act
 *   on and take nothing off, and the current one adds a named discount row
 *   and changes the total the pay button states.
 * - Each ticket takes an optional guest's name; one left blank carries the
 *   buyer's.
 * - Paying (simulated) records the discount and the code on the order — read
 *   from the API and the database, not the page — and the order page shows
 *   the discount; the wallet and the ticket page carry the name and the night.
 * - No address the buyer's window visited carried the code.
 *
 * ## Isolation
 *
 * The buyer is the taker, the tickets are gamma's second night, and paying
 * pins gamma in the ledger, which the feature world's cleanup expects. Serial:
 * one purchase, told in steps.
 *
 * @module e2e/detail-promo-checkout
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** The night's tier, as the seed names it. */
const TIER = 'General admission, night 2'

/** The guest named on the first ticket; the second is left blank. */
const GUEST = 'Rhea Kapoor'

/**
 * Anything that invents a hurry. The same list as `detail-checkout.spec.js`:
 * the nights list and the checkout say what is on sale, never how fast it is
 * going.
 *
 * @type {RegExp}
 */
const URGENCY = /selling fast|few (?:tickets )?left|almost gone|hurry|last chance|only \d+ left/iu

/**
 * Text with its runs of whitespace made single spaces, as it reads.
 *
 * @param {string} text Any text.
 * @returns {string} The same words, spaced once.
 */
function normalise(text) {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * A money amount as this site prints it, in dollars.
 *
 * @param {number} cents Minor units.
 * @returns {string} e.g. `$5.00`.
 */
function dollars(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/**
 * Choose a number of the night's tickets with the stepper.
 *
 * A press that lands before the basket has hydrated changes nothing, so each
 * press is repeated only while the quantity has not yet moved.
 *
 * @param {object} page The page.
 * @param {number} count How many.
 * @returns {Promise<void>} Resolves once chosen.
 */
async function choose(page, count) {
  const quantity = page.getByLabel(`Quantity of ${TIER}`)
  const add = page.getByRole('button', { name: `Add one ${TIER}`, exact: true })

  for (let wanted = 1; wanted <= count; wanted += 1) {
    await expect(async () => {
      if (Number(await quantity.inputValue()) < wanted) await add.click()

      await expect(quantity).toHaveValue(String(wanted), { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
  }
}

test.describe.serial('a night’s tickets, a promo code and a guest’s name', () => {
  /** The buyer's one context, kept across the steps. */
  let context
  /** The buyer's one window. */
  let buyer
  /** Every address the window navigated to. */
  const visited = []
  /** The order, once placed. */
  let order

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: statePath('taker') })
    buyer = arriving(await context.newPage())
    buyer.on('framenavigated', (frame) => {
      if (frame === buyer.mainFrame()) visited.push(frame.url())
    })
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('the event page names its nights, and the checkout sells each night on its own', async () => {
    const { gammaGaEventSlug, gammaGaEventTitle } = ids()

    await buyer.goto(`/events/${gammaGaEventSlug}`)
    await expect(buyer.getByRole('heading', { level: 1, name: gammaGaEventTitle })).toBeVisible()

    const nights = buyer.getByRole('list', { name: 'Nights' }).getByRole('listitem')

    await expect(nights).toHaveCount(2)
    await expect(nights.nth(0).getByRole('heading', { level: 3 })).toHaveText(/^Night 1 · /u)
    await expect(nights.nth(1).getByRole('heading', { level: 3 })).toHaveText(/^Night 2 · /u)
    // In the venue's zone, and said to be.
    await expect(
      buyer.getByText(/the local time at the venue \(America\/New_York\)/u),
    ).toBeVisible()
    // The nights say what is on, never how fast it is going.
    expect(normalise(await buyer.getByRole('main').innerText())).not.toMatch(URGENCY)

    await buyer.getByRole('link', { name: 'Choose tickets' }).first().click()
    await expect(
      buyer.getByRole('heading', { level: 1, name: `Tickets for ${gammaGaEventTitle}` }),
    ).toBeVisible()

    // Each night's tier under that night's own heading.
    await expect(buyer.getByRole('heading', { level: 3, name: /^Night 1 · / })).toBeVisible()
    await expect(buyer.getByRole('heading', { level: 3, name: /^Night 2 · / })).toBeVisible()
    await expect(buyer.getByLabel(`Quantity of ${TIER}`)).toBeVisible()
    await expect(buyer.getByLabel('Quantity of General admission, night 1')).toBeVisible()
    expect(normalise(await buyer.getByRole('main').innerText())).not.toMatch(URGENCY)
  })

  test('reserving two gives a name box for each, and a code is refused in words until one takes', async () => {
    const { gammaPromoCode, gammaExpiredPromoCode, gammaUsedPromoCode, tag } = ids()

    await choose(buyer, 2)
    await buyer.getByRole('button', { name: 'Reserve tickets', exact: true }).click()
    await expect(buyer.getByRole('status').filter({ hasText: 'Tickets held' })).toBeVisible()

    const summary = buyer.getByRole('region', { name: 'Order summary' })
    const subtotal = dollars(2 * GA_PRICE_CENTS)

    await expect(summary.getByTestId('summary-subtotal')).toHaveText(subtotal)
    await expect(summary.getByTestId('summary-discount')).toHaveCount(0)

    const pay = buyer.getByRole('button', { name: /^Pay \$[\d,.]+ \(simulated\)$/u })

    await expect(pay).toBeEnabled()

    const fullPrice = await pay.innerText()

    // One box per ticket, labelled with its tier and its night.
    const who = buyer.getByRole('group', { name: 'Who is going?' })

    await expect(who.getByRole('textbox')).toHaveCount(2)
    await who.getByLabel(new RegExp(`^Ticket 1 of 2 — ${TIER}, Night 2 · `, 'u')).fill(GUEST)
    await expect(
      who.getByLabel(new RegExp(`^Ticket 2 of 2 — ${TIER}, Night 2 · `, 'u')),
    ).toHaveValue('')

    const code = summary.getByLabel('Promo code')
    // The promo field's own status, the one its box is described by: the
    // referral code field (SPEC3 §12.1) now follows it with a status of its own.
    const outcome = summary
      .getByRole('status')
      .and(summary.locator(`[id="${await code.getAttribute('aria-describedby')}"]`))

    /**
     * Type a code and apply it, and wait for the quote's answer.
     *
     * @param {string} value The code.
     * @returns {Promise<void>} Resolves once the quote answered.
     */
    async function apply(value) {
      const quoted = buyer.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/v1\/orders\/quote$/u.test(new URL(response.url()).pathname),
      )

      await code.fill(value)
      await summary.getByRole('button', { name: 'Apply', exact: true }).click()
      expect((await quoted).ok()).toBe(true)
    }

    // Nobody made this one.
    await apply(`NOSUCH${tag.toUpperCase()}`)
    await expect(summary).toContainText('That code is not valid for this event.')
    await expect(summary.getByTestId('summary-discount')).toHaveCount(0)
    await expect(pay).toHaveText(fullPrice)

    await apply(gammaExpiredPromoCode)
    await expect(summary).toContainText('That code has ended.')
    await expect(summary.getByTestId('summary-discount')).toHaveCount(0)

    await apply(gammaUsedPromoCode)
    await expect(summary).toContainText(
      'That code has been used as many times as the organiser allowed.',
    )
    await expect(summary.getByTestId('summary-discount')).toHaveCount(0)
    await expect(pay).toHaveText(fullPrice)

    // The current one takes ten per cent off, and says so, by name.
    await apply(gammaPromoCode.toLowerCase())
    await expect(outcome).toHaveText(`${gammaPromoCode} applied: 10% off.`)
    await expect(summary.getByText(`Discount (${gammaPromoCode})`, { exact: true })).toBeVisible()
    await expect(summary.getByTestId('summary-discount')).toHaveText(
      `−${dollars(0.1 * 2 * GA_PRICE_CENTS)}`,
    )

    // The pay button names the new total, which is the summary's.
    const total = await summary.getByTestId('summary-total').innerText()

    await expect(pay).toHaveText(`Pay ${total.trim()} (simulated)`)
    expect(await pay.innerText()).not.toBe(fullPrice)
    // Nor does a held basket count anybody down.
    expect(normalise(await buyer.getByRole('main').innerText())).not.toMatch(URGENCY)
  })

  test('paying records the discount and the code on the order, and the names on the tickets', async () => {
    const { gammaPromoCode, gammaGaEventTitle, takerId } = ids()
    const pay = buyer.getByRole('button', { name: /^Pay \$[\d,.]+ \(simulated\)$/u })
    const placed = buyer.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/orders',
    )

    await pay.click()

    const response = await placed

    expect(response.status()).toBe(201)
    ;({ data: order } = await response.json())

    const discount = 0.1 * 2 * GA_PRICE_CENTS

    expect(order.status).toBe('PAID')
    expect(order.discountCents).toBe(discount)
    expect(order.tickets).toHaveLength(2)

    const booked = buyer
      .getByRole('status')
      .filter({ has: buyer.getByRole('heading', { name: 'Booked' }) })

    await expect(booked).toContainText(`Including a discount of ${dollars(discount)}.`)
    await expect(booked).toContainText('a ticket you left blank carries yours')

    // The database agrees: the code is on the order, used once more, and each
    // ticket carries its name — the blank one the buyer's.
    const stored = await (async () => {
      const prisma = createPrismaClient({ connectionString: CONNECTION })

      try {
        return await prisma.order.findUniqueOrThrow({
          where: { reference: order.reference },
          select: {
            userId: true,
            discountCents: true,
            promoCode: { select: { code: true, redemptionCount: true } },
            items: { select: { tickets: { select: { attendeeName: true } } } },
          },
        })
      } finally {
        await prisma.$disconnect()
      }
    })()

    expect(stored.userId).toBe(takerId)
    expect(stored.discountCents).toBe(discount)
    expect(stored.promoCode.code).toBe(gammaPromoCode)
    expect(stored.promoCode.redemptionCount).toBe(1)
    expect(
      stored.items
        .flatMap((item) => item.tickets)
        .map((ticket) => ticket.attendeeName)
        .sort(),
    ).toEqual([GUEST, TAKER_NAME].sort())

    // The order's own page shows the discount.
    await booked.getByRole('link', { name: 'This order' }).click()
    await expect(buyer.getByRole('heading', { level: 1, name: gammaGaEventTitle })).toBeVisible()
    await expect(buyer.getByRole('region', { name: 'What it cost' })).toContainText(
      `−${dollars(discount)}`,
    )
  })

  test('the wallet, the ticket and the door carry each name and the night', async ({ gamma }) => {
    const { gammaGaEventTitle, gammaPromoCode } = ids()

    await buyer.goto('/tickets')
    await expect(buyer.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    const cards = buyer
      .getByRole('region', { name: 'Coming up' })
      .getByRole('listitem')
      .filter({ has: buyer.getByRole('link', { name: gammaGaEventTitle, exact: true }) })
      .filter({ hasText: order.reference })

    await expect(cards).toHaveCount(2)

    for (const name of [GUEST, TAKER_NAME]) {
      const card = cards.filter({ hasText: name })

      await expect(card).toHaveCount(1)
      await expect(card).toContainText(/Night 2 · /u)
      await expect(card).toContainText(TIER)
    }

    await cards
      .filter({ hasText: GUEST })
      .getByRole('link', { name: gammaGaEventTitle, exact: true })
      .click()
    await buyer.waitForURL((url) => /^\/tickets\/[^/]+$/u.test(url.pathname))
    await expect(buyer.getByRole('heading', { level: 1, name: gammaGaEventTitle })).toBeVisible()
    await expect(buyer.getByText('Name on it', { exact: true })).toBeVisible()
    await expect(buyer.locator('main')).toContainText(GUEST)
    await expect(buyer.locator('main')).toContainText(/Night 2 · /u)

    // No address this window visited carried the code, in any case.
    for (const address of [...visited, buyer.url()]) {
      expect(address.toUpperCase(), 'an address carried the promo code').not.toContain(
        gammaPromoCode,
      )
    }

    // At gamma's door, the guest's ticket is shown by the guest's name, for
    // its night — looked up, and not admitted.
    const guestCode = await (async () => {
      const prisma = createPrismaClient({ connectionString: CONNECTION })

      try {
        const ticket = await prisma.ticket.findFirstOrThrow({
          where: { attendeeName: GUEST, orderItem: { order: { reference: order.reference } } },
          select: { code: true },
        })

        return ticket.code
      } finally {
        await prisma.$disconnect()
      }
    })()

    await gamma.goto('/organizer/check-in')

    const choose = gamma.getByLabel('Event you are admitting to')
    const value = await choose
      .locator('option', { hasText: gammaGaEventTitle })
      .getAttribute('value')

    await expect(async () => {
      await choose.selectOption(value)
      await expect(gamma.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
        timeout: 1_000,
      })
    }).toPass({ timeout: 15_000 })

    // The guest's ticket is for Night 2, and the door admits by night.
    const night = gamma.getByLabel('Night you are admitting to')
    const nightValue = await night
      .locator('option', { hasText: /^Night 2 · /u })
      .getAttribute('value')

    await night.selectOption(nightValue)
    await expect(night).toHaveValue(nightValue)

    await gamma.getByLabel(/^Printed ticket code/u).fill(guestCode)
    await gamma.getByRole('button', { name: 'Look up' }).click()

    const card = gamma
      .getByRole('region')
      .filter({ has: gamma.getByRole('heading', { name: 'Check the ticket, then admit' }) })

    await expect(card).toBeVisible()
    await expect(card).toContainText(GUEST)
    await expect(card).toContainText(/Night\s*Night 2 · /u)
    await gamma.getByRole('button', { name: 'Cancel' }).click()
  })
})
