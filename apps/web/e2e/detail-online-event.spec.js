import { createPrismaClient } from '@desi-event/db'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { statePath } from './support/detail-global-setup.mjs'
import { ONLINE_TIERS, onlineJoinUrl } from './support/seed-feature-world.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * An online event's joining link, and a tier the public is not shown, in a
 * real browser against the real API.
 *
 * ## The world
 *
 * Gamma's online workshop has no venue, a joining link, a public tier and a
 * hidden one — a speakers' and crew allocation (`seed-feature-world.mjs`).
 *
 * ## What only this file can show
 *
 * - The link is nowhere a stranger can read it: not in the public page, its
 *   structured data or the public API. The page says where it will be.
 * - The hidden tier is not listed, by the page or the API, and booking it by
 *   its id is answered exactly as an id nobody has used.
 * - Once somebody has bought a ticket, the link is theirs: on the wallet's
 *   card, on the ticket's page and on the order's page, always to the
 *   organiser's own address with no referrer sent. The door, looking the same
 *   ticket up, is shown who and for what — never the link.
 *
 * ## Isolation
 *
 * The buyer is the taker, and the event is gamma's. Paying pins gamma in the
 * ledger, which the feature world's cleanup expects. Serial: the second case
 * buys what the first found for sale.
 *
 * @module e2e/detail-online-event
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** The host the joining link is on, as a holder's pages name it. */
const JOIN_HOST = 'stream.example.test'

test.describe.serial('an online event’s joining link', () => {
  test('a stranger is shown where the link will be, never the link, and never the hidden tier', async ({
    visitor,
  }) => {
    const { gammaOnlineEventSlug, gammaOnlineEventTitle, gammaOnlineEventId, tag } = ids()
    const link = onlineJoinUrl(tag)

    await visitor.goto(`/events/${gammaOnlineEventSlug}`)
    await expect(
      visitor.getByRole('heading', { level: 1, name: gammaOnlineEventTitle }),
    ).toBeVisible()
    await expect(visitor.getByText('This event is online.', { exact: true })).toBeVisible()
    await expect(
      visitor.getByText(
        /This event is online\. The joining link is on your ticket once you have booked\./u,
      ),
    ).toBeVisible()

    const html = await visitor.content()

    expect(html, 'the public page carries the joining link').not.toContain(link)
    expect(html).not.toContain(JOIN_HOST)

    // The structured data a search engine reads says it is online, and says
    // nothing else about where.
    const structured = await visitor.locator('script[type="application/ld+json"]').allTextContents()

    expect(structured.length).toBeGreaterThan(0)
    expect(structured.join('\n')).not.toContain(JOIN_HOST)

    // The public tier is listed; the hidden one is not, by the page or the API.
    const tickets = visitor.getByRole('complementary', { name: 'Tickets' })

    await expect(tickets).toContainText(ONLINE_TIERS.public)
    expect(await visitor.locator('main').innerText()).not.toContain(ONLINE_TIERS.hidden)
    expect(html).not.toContain(ONLINE_TIERS.hidden)

    const listed = await visitor.request.get(`/api/v1/events/${gammaOnlineEventId}/ticket-types`)

    expect(listed.ok()).toBe(true)

    const { data: tiers } = await listed.json()

    expect(tiers.map((tier) => tier.name)).toEqual([ONLINE_TIERS.public])

    const event = await visitor.request.get(`/api/v1/events/${gammaOnlineEventSlug}`)

    expect(event.ok()).toBe(true)
    expect(await event.text()).not.toContain(JOIN_HOST)
  })

  test('the hidden tier cannot be booked by its id, and is answered as an id nobody used', async ({
    taker,
  }) => {
    const { gammaOnlineHiddenTierId } = ids()

    await taker.goto('/tickets')

    const csrf = (await taker.context().cookies()).find(({ name }) => name.endsWith('desi_csrf'))
    const headers = {
      origin: new URL(taker.url()).origin,
      'x-desi-csrf': decodeURIComponent(csrf.value),
    }
    const hidden = await taker.request.post('/api/v1/holds', {
      data: { ticketTypeId: gammaOnlineHiddenTierId, quantity: 1 },
      headers,
    })
    const nobody = await taker.request.post('/api/v1/holds', {
      data: { ticketTypeId: 'cmnotarealidentifier0000', quantity: 1 },
      headers,
    })

    expect(hidden.status()).toBe(404)
    expect(nobody.status()).toBe(404)
    expect((await hidden.json()).error.message).toBe((await nobody.json()).error.message)

    // Nothing was held against it.
    const prisma = createPrismaClient({ connectionString: CONNECTION })

    try {
      expect(
        await prisma.ticketHold.count({ where: { ticketTypeId: gammaOnlineHiddenTierId } }),
      ).toBe(0)
    } finally {
      await prisma.$disconnect()
    }
  })

  test('a buyer is given the link on the wallet, the ticket and the order — and the door is not', async ({
    browser,
    gamma,
  }) => {
    const { gammaOnlineEventSlug, gammaOnlineEventTitle, tag } = ids()
    const link = onlineJoinUrl(tag)
    const context = await browser.newContext({ storageState: statePath('taker') })

    try {
      const buyer = arriving(await context.newPage())

      await buyer.goto(`/events/${gammaOnlineEventSlug}/checkout`)
      await expect(
        buyer.getByRole('heading', { level: 1, name: `Tickets for ${gammaOnlineEventTitle}` }),
      ).toBeVisible()

      const quantity = buyer.getByLabel(`Quantity of ${ONLINE_TIERS.public}`)
      const add = buyer.getByRole('button', { name: `Add one ${ONLINE_TIERS.public}`, exact: true })

      await expect(async () => {
        if ((await quantity.inputValue()) === '0') await add.click()

        await expect(quantity).toHaveValue('1', { timeout: 1_000 })
      }).toPass({ timeout: 15_000 })

      // Offered nowhere at checkout: only the public tier has a stepper.
      await expect(buyer.getByLabel(`Quantity of ${ONLINE_TIERS.hidden}`)).toHaveCount(0)

      await buyer.getByRole('button', { name: 'Reserve tickets', exact: true }).click()

      const pay = buyer.getByRole('button', { name: /^Pay \$[\d,.]+ \(simulated\)$/u })
      const placed = buyer.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/orders',
      )

      await pay.click()

      const response = await placed

      expect(response.status()).toBe(201)

      const { data: order } = await response.json()
      const [ticket] = order.tickets

      // The wallet's card: a link to the organiser's own address, sending no referrer.
      await buyer.goto('/tickets')

      const card = buyer
        .getByRole('listitem')
        .filter({ has: buyer.getByRole('link', { name: gammaOnlineEventTitle, exact: true }) })
      const join = card.getByRole('link', { name: new RegExp(`^Join online at ${JOIN_HOST}`, 'u') })

      await expect(join).toHaveAttribute('href', link)
      await expect(join).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(join).toHaveAttribute('referrerpolicy', 'no-referrer')

      // The ticket's page.
      await buyer.goto(`/tickets/${ticket.id}`)

      const section = buyer.getByRole('region', { name: 'Join the online event' })

      await expect(
        section.getByRole('link', { name: `Join online at ${JOIN_HOST}` }),
      ).toHaveAttribute('href', link)

      // The order's page.
      await buyer.goto(`/account/orders/${encodeURIComponent(order.reference)}`)
      await expect(
        buyer.getByRole('link', { name: new RegExp(`^Join online at ${JOIN_HOST}`, 'u') }),
      ).toHaveAttribute('href', link)

      // The door, looking the same ticket up: who and for what, never the link.
      const code = await (async () => {
        const prisma = createPrismaClient({ connectionString: CONNECTION })

        try {
          return (
            await prisma.ticket.findUniqueOrThrow({
              where: { id: ticket.id },
              select: { code: true },
            })
          ).code
        } finally {
          await prisma.$disconnect()
        }
      })()

      await gamma.goto('/organizer/check-in')

      const choose = gamma.getByLabel('Event you are admitting to')
      const option = choose.locator('option', { hasText: gammaOnlineEventTitle })
      const value = await option.getAttribute('value')

      await expect(async () => {
        await choose.selectOption(value)
        await expect(gamma.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 15_000 })

      const preview = gamma.waitForResponse(
        (answer) => new URL(answer.url()).pathname === '/api/v1/tickets/admission/preview',
      )

      await gamma.getByLabel(/^Printed ticket code/u).fill(code)
      await gamma.getByRole('button', { name: 'Look up' }).click()

      expect(await (await preview).text()).not.toContain(JOIN_HOST)

      const found = gamma
        .getByRole('region')
        .filter({ has: gamma.getByRole('heading', { name: 'Check the ticket, then admit' }) })

      await expect(found).toBeVisible()
      await expect(found).toContainText(gammaOnlineEventTitle)
      await expect(found).toContainText(ONLINE_TIERS.public)
      expect(await gamma.content()).not.toContain(JOIN_HOST)

      // Looked up only: nobody is admitted here.
      await gamma.getByRole('button', { name: 'Cancel' }).click()
    } finally {
      await context.close()
    }
  })
})
