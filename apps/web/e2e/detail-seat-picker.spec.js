import AxeBuilder from '@axe-core/playwright'
import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * Choosing seats on a reserved night, and buying them, in a real browser
 * against the real API.
 *
 * ## The world
 *
 * Gamma's balcony concert runs two nights on one published seat plan — one
 * balcony section, rows A and B of six seats, one price zone at $45 — and
 * every seat of each night is bound to that night's reserved tier
 * (`seed-feature-world.mjs`). Seat A3 on the first night is already sold: it
 * is the giver's.
 *
 * ## What only this file can show
 *
 * - The public event page lists the nights, each with its own way to its seat
 *   map, and a visitor sees every seat's price and state before signing in —
 *   and is asked to sign in, rather than offered a reserve button.
 * - A sold seat is a stop on the grid that says it is unavailable, in words
 *   and without colour alone, and pressing it chooses nothing.
 * - The grid is worked from the keyboard alone: Tab reaches it, the arrows
 *   move, Space chooses, and a polite status says what changed.
 * - Reserving holds exactly the chosen seats, which a second window then sees
 *   as taken; each seat takes a guest's name; paying (simulated) issues one
 *   ticket per seat, carrying its seat, its night and its name.
 * - Changing the selection after reserving gives the seat back, which the
 *   second window sees too.
 *
 * Whether the seats were really sold is read from PostgreSQL, not the page.
 *
 * ## Isolation
 *
 * The buyer is the taker, whom nothing else here signs in as a buyer of the
 * balcony's second night, and the seats are the second night's, which no other
 * spec touches. Paying pins gamma in the ledger, which the feature world's
 * cleanup expects. Serial: the second case releases a seat the first leaves
 * free, and the order matters to what the other window sees.
 *
 * @module e2e/detail-seat-picker
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** The seats this file buys on the second night, and the names they carry. */
const BOUGHT = Object.freeze([
  { label: 'A4', guest: 'Ishaan Bhatt' },
  { label: 'A5', guest: 'Leela Gupta' },
])

/** The seat this file reserves and then gives back. */
const RELEASED = 'B4'

/**
 * The scanner's findings for a page, at WCAG 2.2 AA, with no rule turned off.
 *
 * @param {object} page The page.
 * @returns {Promise<string[]>} One line per violation.
 */
async function violationsOn(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .exclude('nextjs-portal')
    .analyze()

  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} — ${violation.nodes
        .slice(0, 2)
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  )
}

/**
 * How far the document scrolls sideways, in CSS pixels.
 *
 * @param {object} page The page.
 * @returns {Promise<number>} The overflow.
 */
function sidewaysOverflow(page) {
  return page.evaluate(
    () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  )
}

/**
 * A night's seat page, opened and arrived.
 *
 * @param {object} page The page.
 * @param {number} night 0 or 1.
 * @returns {Promise<object>} The grid.
 */
async function openNight(page, night) {
  const { gammaSeatedEventSlug, gammaSeatedEventTitle, gammaSeatedSessionIds } = ids()

  await page.goto(`/events/${gammaSeatedEventSlug}/seats/${gammaSeatedSessionIds[night]}`)
  await expect(
    page.getByRole('heading', { level: 1, name: `Choose seats for ${gammaSeatedEventTitle}` }),
  ).toBeVisible()

  const grid = page.getByRole('grid', { name: 'Balcony' })

  await expect(grid).toBeVisible()

  return grid
}

/**
 * One seat's button on a grid, by its label.
 *
 * @param {object} grid The grid.
 * @param {string} label A seat label, e.g. `A3`.
 * @returns {object} The button.
 */
function seat(grid, label) {
  return grid.getByRole('button', { name: new RegExp(`^Seat ${label}, `, 'u') })
}

/**
 * The seats on a night, as the database has them: label to status.
 *
 * @param {number} night 0 or 1.
 * @returns {Promise<Record<string, string>>} Status by seat label.
 */
async function seatStates(night) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    const rows = await prisma.eventSeat.findMany({
      where: { eventSessionId: ids().gammaSeatedSessionIds[night] },
      select: { status: true, seat: { select: { label: true } } },
    })

    return Object.fromEntries(rows.map((row) => [row.seat.label, row.status]))
  } finally {
    await prisma.$disconnect()
  }
}

test.describe.serial('the seat picker on a reserved night', () => {
  test('a visitor sees the nights, every seat and its price, and is asked to sign in to reserve', async ({
    visitor,
  }) => {
    const { gammaSeatedEventSlug, gammaSeatedEventTitle } = ids()

    await visitor.goto(`/events/${gammaSeatedEventSlug}`)
    await expect(
      visitor.getByRole('heading', { level: 1, name: gammaSeatedEventTitle }),
    ).toBeVisible()

    // Two nights, each named and each with its own way to its seats.
    const nights = visitor.getByRole('list', { name: 'Nights' }).getByRole('listitem')

    await expect(nights).toHaveCount(2)
    await expect(nights.nth(0).getByRole('heading', { level: 3 })).toHaveText(/^Night 1 · /u)
    await expect(nights.nth(1).getByRole('heading', { level: 3 })).toHaveText(/^Night 2 · /u)

    const first = nights.nth(0).getByRole('link', { name: /^Choose seats for Night 1/u })

    await expect(first).toBeVisible()
    await first.click()

    const grid = visitor.getByRole('grid', { name: 'Balcony' })

    await expect(grid).toBeVisible()
    await expect(
      visitor.getByRole('heading', { level: 1, name: `Choose seats for ${gammaSeatedEventTitle}` }),
    ).toBeVisible()

    // Every seat is priced and said to be what it is, in words.
    await expect(seat(grid, 'A1')).toHaveAccessibleName(
      'Seat A1, row A, Balcony, Balcony zone, $45.00, available',
    )
    // The giver's seat: a stop on the grid that says it cannot be had.
    const sold = seat(grid, 'A3')

    await expect(sold).toHaveAccessibleName(
      'Seat A3, row A, Balcony, Balcony zone, $45.00, unavailable',
    )
    await expect(sold).toHaveAttribute('aria-disabled', 'true')
    await expect(sold).toHaveAttribute('aria-pressed', 'false')

    // Pressing it anyway — forced, since it says it is disabled — chooses
    // nothing.
    await sold.click({ force: true })
    await expect(sold).toHaveAttribute('aria-pressed', 'false')
    await expect(visitor.getByText('No seats chosen.')).toBeVisible()

    // Signed out, there is a way to sign in and back, and nothing to reserve with.
    const signIn = visitor.getByRole('link', { name: 'Sign in to reserve', exact: true })

    await expect(signIn).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent(new URL(visitor.url()).pathname)}`,
    )
    await expect(visitor.getByRole('button', { name: /^Reserve /u })).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: /^Pay /u })).toHaveCount(0)

    // The picker, as a phone and a laptop see it: nothing for the scanner, and
    // only the section scrolls sideways — never the page.
    for (const size of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await visitor.setViewportSize(size)
      expect(await violationsOn(visitor), `at ${size.width}`).toEqual([])
    }

    await visitor.setViewportSize({ width: 320, height: 720 })
    expect(await sidewaysOverflow(visitor)).toBeLessThanOrEqual(0)
  })

  test('a buyer chooses seats from the keyboard, reserves them, names them and pays', async ({
    taker,
    visitor,
  }) => {
    const { gammaSeatedEventTitle } = ids()
    const grid = await openNight(taker, 1)

    // Keyboard only. Tab until focus lands on a seat — the grid is one tab stop.
    await expect(taker.locator('[data-enhanced="true"], body').first()).toBeAttached()

    let onSeat = false

    for (let press = 0; press < 60 && !onSeat; press += 1) {
      await taker.keyboard.press('Tab')
      onSeat = await taker.evaluate(() =>
        /^Seat [A-Z]\d+, /u.test(document.activeElement?.getAttribute('aria-label') ?? ''),
      )
    }

    expect(onSeat, 'Tab never reached the seat grid').toBe(true)
    await expect(seat(grid, 'A1')).toBeFocused()

    const status = taker.getByRole('region', { name: 'Your selection' }).getByRole('status').first()

    // Along the row to A4, choosing nothing on the way; choose it; right to
    // A5 and choose that too.
    for (const label of ['A2', 'A3', 'A4']) {
      await taker.keyboard.press('ArrowRight')
      await expect(seat(grid, label)).toBeFocused()
    }

    await expect(seat(grid, 'A2')).toHaveAttribute('aria-pressed', 'false')
    await taker.keyboard.press('Space')
    await expect(seat(grid, 'A4')).toHaveAttribute('aria-pressed', 'true')
    await expect(status).toHaveText('Seat A4 added. 1 seat selected.')

    await taker.keyboard.press('ArrowRight')
    await expect(seat(grid, 'A5')).toBeFocused()
    await taker.keyboard.press('Space')
    await expect(seat(grid, 'A5')).toHaveAttribute('aria-pressed', 'true')
    await expect(status).toHaveText('Seat A5 added. 2 seats selected.')

    // Down reaches the seat under it in the next row, and moving chooses nothing.
    await taker.keyboard.press('ArrowDown')
    await expect(seat(grid, 'B5')).toBeFocused()
    await expect(seat(grid, 'B5')).toHaveAttribute('aria-pressed', 'false')

    // Chosen seats are named as chosen, not only drawn differently.
    await expect(seat(grid, 'A4')).toHaveAccessibleName(/, selected$/u)

    const reserve = taker.getByRole('button', { name: 'Reserve 2 seats', exact: true })

    await reserve.focus()
    await taker.keyboard.press('Enter')

    await expect(taker.getByRole('status').filter({ hasText: /^Seats held/u })).toBeVisible()
    expect(await seatStates(1)).toMatchObject({ A4: 'HELD', A5: 'HELD' })

    // Another window, at the same night, sees both taken.
    const other = await openNight(visitor, 1)

    for (const { label } of BOUGHT) {
      await expect(seat(other, label)).toHaveAccessibleName(/, unavailable$/u)
    }

    // A name for each seat, each box labelled by its seat.
    for (const { label, guest } of BOUGHT) {
      await taker
        .getByRole('textbox', { name: new RegExp(`^Seat ${label}, row A, Balcony`, 'u') })
        .fill(guest)
    }

    const pay = taker.getByRole('button', { name: /^Pay \$[\d,.]+ \(simulated\)$/u })

    await expect(pay).toBeEnabled()

    const placed = taker.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/orders',
    )

    await pay.click()

    const response = await placed

    expect(response.status()).toBe(201)

    const { data: order } = await response.json()

    expect(order.status).toBe('PAID')
    expect(order.tickets).toHaveLength(2)

    const booked = taker
      .getByRole('status')
      .filter({ has: taker.getByRole('heading', { name: 'Booked' }) })

    await expect(booked).toContainText(`Order ${order.reference} · 2 tickets`)
    await expect(booked).toContainText('no card was asked for and no money moved')
    await expect(booked).toContainText('Each ticket carries the name you gave it')

    // Sold, by the database: the two seats, on this order, and nothing else.
    expect(await seatStates(1)).toMatchObject({ A4: 'SOLD', A5: 'SOLD', A3: 'AVAILABLE' })

    // The wallet lists both, each with its seat, its night and its name.
    await booked.getByRole('link', { name: 'Your tickets' }).click()
    await expect(taker.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    const cards = taker
      .getByRole('region', { name: 'Coming up' })
      .getByRole('listitem')
      .filter({ has: taker.getByRole('link', { name: gammaSeatedEventTitle, exact: true }) })

    for (const { label, guest } of BOUGHT) {
      const card = cards.filter({ hasText: guest })

      await expect(card).toHaveCount(1)
      await expect(card).toContainText(label)
      await expect(card).toContainText(/Night 2 · /u)
    }
  })

  test('changing the selection after reserving gives the seat back', async ({ taker, visitor }) => {
    const grid = await openNight(taker, 1)

    await expect(async () => {
      if ((await seat(grid, RELEASED).getAttribute('aria-pressed')) !== 'true') {
        await seat(grid, RELEASED).click()
      }

      await expect(seat(grid, RELEASED)).toHaveAttribute('aria-pressed', 'true', {
        timeout: 1_000,
      })
    }).toPass({ timeout: 15_000 })

    await taker.getByRole('button', { name: 'Reserve 1 seat', exact: true }).click()
    await expect(taker.getByRole('status').filter({ hasText: /^Seats held/u })).toBeVisible()
    expect((await seatStates(1))[RELEASED]).toBe('HELD')

    const other = await openNight(visitor, 1)

    await expect(seat(other, RELEASED)).toHaveAccessibleName(/, unavailable$/u)

    // Unchosen: the hold goes back, and so does the seat.
    const released = taker.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /^\/api\/v1\/holds\//u.test(new URL(response.url()).pathname),
    )

    await seat(grid, RELEASED).click()
    expect((await released).ok()).toBe(true)
    await expect(seat(grid, RELEASED)).toHaveAttribute('aria-pressed', 'false')
    await expect(taker.getByRole('status').filter({ hasText: /^Seats held/u })).toHaveCount(0)

    await expect.poll(async () => (await seatStates(1))[RELEASED]).toBe('AVAILABLE')

    await openNight(visitor, 1)
    await expect(seat(other, RELEASED)).toHaveAccessibleName(/, available$/u)
  })
})
