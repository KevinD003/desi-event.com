import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { readDrawing } from './support/qr-drawing.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

// This file shows a transfer's one-time code, reads it from the API's answer,
// and draws the holder's entry pass to prove it stops working. A screenshot, a
// trace or a film of any of them is a ticket, so none is taken in this file.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

/**
 * Handing a reserved seat on, with a code shown once, in a real browser
 * against the real API.
 *
 * ## The story
 *
 * The giver holds seat A3 on the first night of gamma's balcony concert
 * (`seed-feature-world.mjs`). They offer it to the taker: this build sends no
 * email, so the offer answers with a one-time code, shown to the giver once to
 * hand over themselves. The taker, signed in at the address it was offered to,
 * types it in and accepts. The ticket is theirs now, and so is the seat — a
 * reserved seat moves with its ticket (ADR 0006) — and the giver's old pass
 * and printed code stop admitting anybody.
 *
 * ## What is checked where
 *
 * - **The wire:** the code arrives in the offer's own `201`, marked
 *   `no-store, private`, and never in an address.
 * - **The page:** it is shown in one read-only field until the giver says it
 *   was handed over, and never again — not after a reload, not in storage or
 *   a cookie. The taker types it into a password field; their address bar
 *   never carries it either.
 * - **The database:** the transfer is ACCEPTED, the taker holds a new ticket on
 *   the same seat, the seat is still sold, and the giver's ticket is
 *   TRANSFERRED with its credential digest gone.
 * - **The API:** the giver asking for the old ticket's pass afterwards is
 *   refused, and the answer carries no pass.
 * - **The door:** gamma's owner scans the giver's old pass and it matches
 *   nothing; types the old printed code and is told it was handed on; types
 *   the taker's and is shown the seat.
 *
 * ## Isolation
 *
 * The seated ticket and both accounts are the feature world's; no other spec
 * reads them. Serial, because the three cases are one story.
 *
 * @module e2e/detail-transfer-code
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * What the story has learned so far, for the cases after.
 *
 * @type {{code: string|null, oldPass: {path: string, size: number}|null, oldCredential: string|null, newTicketId: string|null, newCode: string|null}}
 */
const story = { code: null, oldPass: null, oldCredential: null, newTicketId: null, newCode: null }

/**
 * Run a read against the test database, and disconnect.
 *
 * @param {function(object): Promise<*>} read What to read.
 * @returns {Promise<*>} What it read.
 */
async function fromDatabase(read) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await read(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Replace a page's camera with a canvas painting a QR drawing.
 *
 * Must run before the page navigates.
 *
 * @param {object} page The page.
 * @param {{path: string, size: number}} drawing What to paint.
 * @returns {Promise<void>} Resolves once installed.
 */
function cameraShowing(page, drawing) {
  return page.addInitScript((spec) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const scale = 8
      const canvas = document.createElement('canvas')

      canvas.width = spec.size * scale
      canvas.height = spec.size * scale

      const context = canvas.getContext('2d')
      const paint = () => {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.save()
        context.scale(scale, scale)
        context.fillStyle = '#000000'
        context.fill(new Path2D(spec.path))
        context.restore()
      }

      paint()
      setInterval(paint, 100)

      return canvas.captureStream(10)
    }
  }, drawing)
}

/**
 * Open gamma's door on the balcony concert.
 *
 * @param {object} page The owner's page.
 * @returns {Promise<void>} Resolves once the event is chosen.
 */
async function openBalconyDoor(page) {
  await page.goto('/organizer/check-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()

  const choose = page.getByLabel('Event you are admitting to')
  const option = choose.locator('option', { hasText: ids().gammaSeatedEventTitle })

  await expect(option).toHaveCount(1)

  const value = await option.getAttribute('value')

  await expect(async () => {
    await choose.selectOption(value)
    await expect(page.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })

  // The concert has two nights, and seat A3 is sold for the first: the door
  // says which night it is admitting to, and refuses a ticket for the other.
  const night = page.getByLabel('Night you are admitting to')
  const nightValue = await night
    .locator('option', { hasText: /^Night 1 · /u })
    .getAttribute('value')

  await night.selectOption(nightValue)
  await expect(night).toHaveValue(nightValue)
}

/**
 * Type a printed code at the door and look it up.
 *
 * @param {object} page The door's page.
 * @param {string} code The code.
 * @returns {Promise<void>} Resolves once sent.
 */
async function typeCode(page, code) {
  await page.getByLabel(/^Printed ticket code/u).fill(code)
  await page.getByRole('button', { name: 'Look up' }).click()
}

test.describe.serial('a reserved seat, handed on with a code shown once', () => {
  test('the holder offers the seat and is shown the code once, and nowhere else', async ({
    giver,
  }) => {
    const { seatedTicketId, takerEmail } = ids()

    await giver.goto(`/tickets/${seatedTicketId}`)
    await expect(giver.getByRole('heading', { name: 'Your entry pass' })).toBeVisible()

    // The pass this ticket admits with today, read before it is handed on.
    await giver.getByRole('button', { name: 'Show my entry pass' }).click()

    const drawing = giver.getByRole('img', { name: /entry pass, as a qr code/iu })

    await expect(drawing).toBeVisible()

    const read = await readDrawing(drawing)

    expect(read.value).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    story.oldPass = { path: read.path, size: read.size }
    story.oldCredential = read.value

    await giver.getByRole('button', { name: 'Hide pass' }).click()
    await expect(drawing).toHaveCount(0)

    // Every address the window lands on, so the code's absence is checked in
    // all of them, not only the last.
    const visited = []

    giver.on('framenavigated', (frame) => {
      if (frame === giver.mainFrame()) visited.push(frame.url())
    })

    await giver.getByRole('button', { name: /offer this ticket/iu }).click()
    await giver.getByLabel(/their email address/iu).fill(takerEmail)

    const offered = giver.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/tickets/${seatedTicketId}/transfers`,
    )

    await giver.getByRole('button', { name: /send the offer/iu }).click()

    const response = await offered

    // The one response the code is ever in: created, and kept by nothing on
    // the way — through the web's proxy to this browser.
    expect(response.status()).toBe(201)
    expect(response.headers()['cache-control'] ?? '').toContain('no-store')
    expect(response.headers()['cache-control'] ?? '').toContain('private')
    expect(response.headers().pragma ?? '').toContain('no-cache')

    const { data } = await response.json()

    expect(data.delivery.mode).toBe('MANUAL')

    await expect(
      giver.getByText('Offered. Give them the code shown below; it is shown only once.'),
    ).toBeVisible()

    const field = giver.getByLabel('Ticket transfer code', { exact: true })

    await expect(field).toHaveAttribute('readonly', '')
    await expect(field).toHaveValue(data.delivery.invitationCode)

    story.code = data.delivery.invitationCode

    expect(story.code.length).toBeGreaterThanOrEqual(16)

    // In the page, and nowhere a browser keeps things.
    const stored = await giver.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    )

    expect(stored).not.toContain(story.code)
    expect(JSON.stringify(await giver.context().cookies())).not.toContain(story.code)

    // Handed over: gone, and nothing brings it back.
    await giver.getByRole('button', { name: 'I have handed it over', exact: true }).click()
    await expect(field).toHaveCount(0)
    expect(await giver.content()).not.toContain(story.code)

    await giver.reload()
    await expect(giver.locator('main')).toContainText(/offered, awaiting an answer/iu)
    expect(await giver.content()).not.toContain(story.code)
    await expect(giver.getByLabel('Ticket transfer code', { exact: true })).toHaveCount(0)

    // The recipient by domain alone.
    await expect(giver.locator('main')).toContainText('••••@attendee.test')
    expect(await giver.content()).not.toContain(takerEmail)

    for (const address of [...visited, giver.url()]) {
      expect(address, 'an address carried the code').not.toContain(story.code)
    }
  })

  test('the recipient accepts with the code, and the seat moves with the ticket', async ({
    giver,
    taker,
  }) => {
    expect(story.code, 'the case before did not issue a code').not.toBeNull()

    const { seatedTicketId, seatedTicketSeatLabel, takerId, gammaSeatedEventTitle } = ids()
    const visited = []

    taker.on('framenavigated', (frame) => {
      if (frame === taker.mainFrame()) visited.push(frame.url())
    })

    await taker.goto('/tickets/accept')

    const field = taker.getByLabel(/invitation code/iu)

    // A password field: this gets typed on a train.
    await expect(field).toHaveAttribute('type', 'password')
    await field.fill(story.code)
    await taker.getByRole('button', { name: /accept the ticket/iu }).click()

    await expect(taker.getByText('It is yours', { exact: true })).toBeVisible()

    for (const address of [...visited, taker.url()]) {
      expect(address, 'an address carried the code').not.toContain(story.code)
    }

    // The database, not the page, says what happened.
    const { transfer, before, after, seat } = await fromDatabase(async (prisma) => {
      const old = await prisma.ticket.findUniqueOrThrow({
        where: { id: seatedTicketId },
        select: { status: true, credentialHash: true, eventSeatId: true, ownerUserId: true },
      })
      const accepted = await prisma.ticketTransfer.findFirstOrThrow({
        where: { ticketId: seatedTicketId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, toUserId: true },
      })
      const successor = await prisma.ticket.findFirst({
        where: { ownerUserId: takerId, eventSeatId: old.eventSeatId, status: 'VALID' },
        select: { id: true, code: true, eventSeatId: true },
      })
      const eventSeat = old.eventSeatId
        ? await prisma.eventSeat.findUnique({
            where: { id: old.eventSeatId },
            select: { status: true, seat: { select: { label: true } } },
          })
        : null

      return { transfer: accepted, before: old, after: successor, seat: eventSeat }
    })

    expect(transfer).toEqual({ status: 'ACCEPTED', toUserId: takerId })
    // The giver's ticket is spent: handed on, and its pass digest gone, so an
    // old QR matches nothing at all.
    expect(before.status).toBe('TRANSFERRED')
    expect(before.credentialHash).toBeNull()
    // The taker's is new, on the very same seat, and the seat is still sold.
    expect(after).not.toBeNull()
    expect(after.eventSeatId).toBe(before.eventSeatId)
    expect(seat).toEqual({ status: 'SOLD', seat: { label: seatedTicketSeatLabel } })

    Object.assign(story, { newTicketId: after.id, newCode: after.code })

    // The giver asks for the old ticket's pass anyway, as a client that skips
    // the page would: refused, with the door's own reason, and no pass in the
    // answer. Asked without the page, so nothing is drawn.
    const asked = await giver.request.get(`/api/v1/tickets/${seatedTicketId}/pass`)
    const answer = await asked.text()

    expect(asked.status()).toBe(409)
    expect(JSON.parse(answer).error.message).toMatch(/handed to somebody else/u)
    expect(answer).not.toContain(story.oldCredential)
    expect(answer).not.toMatch(/"credential"/u)

    // And the taker's wallet shows it, with the seat and its night. (The
    // taker may hold other balcony seats by now — the seat picker's journey
    // buys two on the second night — so the card is found by its seat.)
    await taker.goto('/tickets')

    const card = taker
      .getByRole('listitem')
      .filter({ has: taker.getByRole('link', { name: gammaSeatedEventTitle, exact: true }) })
      .filter({ hasText: `seat ${seatedTicketSeatLabel}` })
      .filter({ hasText: /Night 1 · /u })

    await expect(card).toHaveCount(1)
    await expect(card).toContainText(`Balcony, row A, seat ${seatedTicketSeatLabel}`)
  })

  test('the old pass and code stop admitting, and the door knows the new holder’s', async ({
    gamma,
  }) => {
    expect(story.oldPass, 'the first case did not read the old pass').not.toBeNull()
    expect(story.newCode, 'the second case did not find the new ticket').toBeTruthy()

    const { tag, seatedTicketSeatLabel } = ids()
    // The giver's printed code, as the feature world issued it.
    const oldCode = `DE-GAM-${tag.toUpperCase()}-S1`

    // The giver's old pass, held up to the camera: it matches nothing now.
    await cameraShowing(gamma, story.oldPass)
    await openBalconyDoor(gamma)
    await gamma.getByRole('button', { name: 'Scan the QR pass' }).click()
    await gamma.getByRole('button', { name: 'Start camera' }).click()

    await expect(
      gamma.locator('main').getByRole('alert').filter({ hasText: 'No ticket matches' }),
    ).toBeVisible()
    await expect(gamma.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0)

    // Its printed code is found, and refused with the reason a steward can act on.
    await gamma.getByRole('button', { name: 'Type the printed code' }).click()
    await typeCode(gamma, oldCode)

    await expect(gamma.getByRole('heading', { name: 'Do not admit' })).toBeVisible()
    await expect(
      gamma.getByText('This ticket was handed to somebody else. Ask for their current pass.'),
    ).toBeVisible()
    await expect(gamma.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0)

    // The new holder's code is the one that admits, on the same seat. Looked
    // up only: nobody is admitted here.
    await gamma.getByRole('button', { name: 'Next ticket' }).click()
    await typeCode(gamma, story.newCode)

    await expect(gamma.getByRole('heading', { name: 'Check the ticket, then admit' })).toBeFocused()
    await expect(gamma.getByText(`Balcony, row A, seat ${seatedTicketSeatLabel}`)).toBeVisible()
    await gamma.getByRole('button', { name: 'Cancel' }).click()

    const admitted = await fromDatabase((prisma) =>
      prisma.checkIn.count({ where: { ticketId: story.newTicketId } }),
    )

    expect(admitted).toBe(0)
  })
})
