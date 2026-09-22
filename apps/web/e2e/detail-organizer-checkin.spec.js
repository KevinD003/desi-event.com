import jsQRModule from 'jsqr'

import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * The door, in a real browser, against the real API and a real database.
 *
 * ## What only this file can show
 *
 * That the screens a steward and a ticket holder use really do what the API
 * tests prove the server does: a lookup changes nothing, only **Admit**
 * admits, a ticket admits once however it is pressed, an unanswered admission
 * is reported as uncertain and retried safely, and a QR pass drawn on the
 * holder's screen is read by the door's camera and admits them.
 *
 * The QR case is a real round trip, not a stub of one. The holder's page draws
 * the pass; this file reads the drawing back out of the page, decodes it with
 * the same decoder the door uses, and feeds it to the door as a camera stream
 * painted on a canvas. The door decodes that stream itself, looks the ticket
 * up, and admits on a press. Nothing in between knows the credential.
 *
 * ## What is checked in the database, not the page
 *
 * Whether an admission happened. A screen that said "Admitted" over a row that
 * was never written would pass every page assertion here, so the count of
 * `CheckIn` rows, and their method, is read from PostgreSQL.
 *
 * ## No screenshots, no traces
 *
 * The holder's page carries a live pass. A failure screenshot of it would put
 * a bearer credential into a test artefact, so this file turns both off.
 *
 * @module e2e/detail-organizer-checkin
 */

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

const jsQR = jsQRModule.default ?? jsQRModule

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * Admissions recorded for a ticket, read from the database.
 *
 * @param {string} ticketId The ticket.
 * @returns {Promise<Array<{method: string}>>} Its `CheckIn` rows.
 */
async function admissions(ticketId) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.checkIn.findMany({ where: { ticketId }, select: { method: true } })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Decode the QR the holder's page drew, from the path it drew it with.
 *
 * @param {string} path The SVG path, in module units.
 * @param {number} size Modules per side.
 * @returns {string|null} What it encodes.
 */
function decodeDrawing(path, size) {
  const scale = 6
  const width = size * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)

  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)) {
    for (let px = Number(x) * scale; px < (Number(x) + Number(run)) * scale; px += 1) {
      for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py += 1) {
        const at = (py * width + px) * 4

        data[at] = 0
        data[at + 1] = 0
        data[at + 2] = 0
      }
    }
  }

  return jsQR(data, width, width)?.data ?? null
}

/**
 * Open the door screen and wait for it.
 *
 * @param {object} page The page.
 * @returns {Promise<void>}
 */
async function openDoor(page) {
  await page.goto('/organizer/check-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()
}

/**
 * Type a printed code and look it up.
 *
 * @param {object} page The page.
 * @param {string} code The code.
 * @returns {Promise<void>}
 */
async function typeCode(page, code) {
  await page.getByLabel('Printed ticket code').fill(code)
  await page.getByRole('button', { name: 'Look up' }).click()
}

/**
 * Replace the camera with a canvas painting a QR code, or with a refusal.
 *
 * @param {object} page The page, before it navigates.
 * @param {object} camera What the camera does.
 * @returns {Promise<void>}
 */
function fakeCamera(page, camera) {
  return page.addInitScript((spec) => {
    if (spec.kind === 'absent') {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })

      return
    }

    navigator.mediaDevices.getUserMedia = async () => {
      if (spec.kind === 'refuse') {
        throw new DOMException('refused by the test', spec.name)
      }

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
  }, camera)
}

test.describe('the door screen', () => {
  test('shows a scanner the event it is assigned to, and on what authority', async ({
    scanner,
  }) => {
    await openDoor(scanner)

    await expect(scanner.getByText(`Alpha's Evening ${ids().tag}`)).toBeVisible()
    await expect(scanner.getByText('Assigned to this event (scanner)')).toBeVisible()
  })

  test('tells a steward with no assignment so, and offers nothing to admit with', async ({
    steward,
  }) => {
    await openDoor(steward)

    await expect(steward.getByText(/not assigned to any event's door/iu)).toBeVisible()
    await expect(steward.getByLabel('Printed ticket code')).toHaveCount(0)
  })

  test('looks a typed code up without admitting it, then admits once on Admit', async ({
    scanner,
  }) => {
    const ticketId = ids().doorTicketIds[0]

    await openDoor(scanner)
    await typeCode(scanner, ids().doorCodes[0])

    const heading = scanner.getByRole('heading', { name: 'Check the ticket, then admit' })

    await expect(heading).toBeFocused()
    await expect(scanner.getByText('Asha Door 1', { exact: true })).toBeVisible()
    expect(await admissions(ticketId)).toEqual([])

    await scanner.getByRole('button', { name: 'Admit', exact: true }).click()

    await expect(scanner.getByRole('heading', { name: 'Admitted', exact: true })).toBeFocused()
    expect(await admissions(ticketId)).toEqual([{ method: 'MANUAL_CODE' }])
    // The code in hand is gone once the ticket is done with.
    await expect(scanner.getByLabel('Printed ticket code')).toHaveValue('')

    // The same code again: already in, and no way to admit it twice.
    await scanner.getByRole('button', { name: 'Next ticket' }).click()
    await typeCode(scanner, ids().doorCodes[0])

    await expect(
      scanner.getByRole('heading', { name: 'Already admitted — do not admit again' }),
    ).toBeVisible()
    await expect(scanner.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0)
    expect(await admissions(ticketId)).toHaveLength(1)
  })

  test('answers a code that matches nothing without admitting or explaining', async ({
    scanner,
  }) => {
    await openDoor(scanner)
    await typeCode(scanner, 'DE-NOT-A-REAL-TICKET')

    // Scoped to the page body: Next.js keeps an empty route announcer that is
    // also an alert.
    await expect(
      scanner.locator('main').getByRole('alert').filter({ hasText: 'No ticket matches' }),
    ).toBeVisible()
    await expect(scanner.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0)
  })

  test('sends one admission however often Admit is pressed on a slow line', async ({ scanner }) => {
    const ticketId = ids().doorTicketIds[2]
    let sent = 0

    await scanner.route('**/api/v1/tickets/check-in', async (route) => {
      sent += 1
      await new Promise((resolve) => {
        setTimeout(resolve, 1_500)
      })
      await route.continue()
    })

    await openDoor(scanner)
    await typeCode(scanner, ids().doorCodes[2])

    const admit = scanner.getByRole('button', { name: 'Admit', exact: true })

    await admit.click()
    await admit.click({ force: true })
    await admit.click({ force: true })

    await expect(scanner.getByRole('heading', { name: 'Admitted', exact: true })).toBeVisible()
    expect(sent).toBe(1)
    expect(await admissions(ticketId)).toHaveLength(1)
  })

  test('reports an admission whose answer was lost as uncertain, and the retry admits once', async ({
    scanner,
  }) => {
    const ticketId = ids().doorTicketIds[3]
    let first = true

    // The request reaches the server and is admitted; the answer never
    // reaches the page. That is the case a steward cannot tell from a failure.
    await scanner.route('**/api/v1/tickets/check-in', async (route) => {
      if (!first) {
        await route.continue()

        return
      }

      first = false
      await route.fetch()
      await route.abort('failed')
    })

    await openDoor(scanner)
    await typeCode(scanner, ids().doorCodes[3])
    await scanner.getByRole('button', { name: 'Admit', exact: true }).click()

    await expect(
      scanner.locator('main').getByRole('alert').filter({ hasText: 'may or may not' }),
    ).toBeVisible()
    expect(await admissions(ticketId)).toHaveLength(1)

    await scanner.getByRole('button', { name: 'Retry admission' }).click()

    await expect(scanner.getByRole('heading', { name: 'Admitted', exact: true })).toBeVisible()
    await expect(scanner.getByText(/the retry changed nothing/iu)).toBeVisible()
    expect(await admissions(ticketId)).toHaveLength(1)
  })

  test('works from the keyboard alone, with focus where the next action is', async ({
    scanner,
  }) => {
    await openDoor(scanner)

    await scanner.getByLabel('Printed ticket code').focus()
    await scanner.keyboard.type(ids().doorCodes[4])
    await scanner.keyboard.press('Enter')

    await expect(
      scanner.getByRole('heading', { name: 'Check the ticket, then admit' }),
    ).toBeFocused()

    // Cancel, not Admit: this ticket is the one the layout cases use.
    await scanner.getByRole('button', { name: 'Cancel' }).focus()
    await scanner.keyboard.press('Enter')

    await expect(scanner.getByLabel('Printed ticket code')).toBeFocused()
    expect(await admissions(ids().doorTicketIds[4])).toEqual([])
  })
})

test.describe('the pass, from the holder’s screen to the door’s camera', () => {
  test('is drawn only on request, never as text, and admits once when scanned', async ({
    holder,
    scanner,
  }) => {
    const ticketId = ids().doorTicketIds[1]

    await holder.goto(`/tickets/${ticketId}`)
    await expect(holder.getByRole('heading', { name: 'Your entry pass' })).toBeVisible()
    await expect(holder.getByRole('img', { name: /entry pass, as a qr code/iu })).toHaveCount(0)

    await holder.getByRole('button', { name: 'Show my entry pass' }).click()

    const drawing = holder.getByRole('img', { name: /entry pass, as a qr code/iu })

    await expect(drawing).toBeVisible()
    await expect(holder.getByRole('button', { name: 'Hide pass' })).toBeFocused()
    await expect(holder.getByText(/as a screenshot — can use it to get in once/iu)).toBeVisible()

    const path = await drawing.locator('path').getAttribute('d')
    const size = Number((await drawing.getAttribute('viewBox')).split(' ')[2])
    const credential = decodeDrawing(path, size)

    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/u)

    // The credential is in the picture and nowhere else: not in the markup,
    // not in storage, not in the address.
    expect(await holder.content()).not.toContain(credential)
    expect(
      await holder.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage, url: location.href }),
      ),
    ).not.toContain(credential)

    await holder.getByRole('button', { name: 'Hide pass' }).click()
    await expect(drawing).toHaveCount(0)

    // The door's camera sees what the holder's screen showed.
    let lookups = 0

    scanner.on('request', (request) => {
      if (request.url().endsWith('/api/v1/tickets/admission/preview')) lookups += 1
    })

    await fakeCamera(scanner, { kind: 'stream', path, size })
    await openDoor(scanner)
    await scanner.getByRole('button', { name: 'Scan the QR pass' }).click()

    expect(lookups).toBe(0)

    await scanner.getByRole('button', { name: 'Start camera' }).click()

    await expect(
      scanner.getByRole('heading', { name: 'Check the ticket, then admit' }),
    ).toBeVisible()
    await expect(scanner.getByText('QR pass', { exact: true })).toBeVisible()
    expect(await admissions(ticketId)).toEqual([])

    // The camera keeps seeing the same pass. The door looked it up once and
    // is waiting for a person to decide; it does not look it up again.
    await scanner.waitForTimeout(1_000)
    expect(lookups).toBe(1)

    await scanner.getByRole('button', { name: 'Admit', exact: true }).click()

    await expect(scanner.getByRole('heading', { name: 'Admitted', exact: true })).toBeVisible()
    expect(await admissions(ticketId)).toEqual([{ method: 'QR_SCAN' }])

    // Presented again: already in.
    await scanner.getByRole('button', { name: 'Next ticket' }).click()
    await expect(
      scanner.getByRole('heading', { name: 'Already admitted — do not admit again' }),
    ).toBeVisible()
    expect(await admissions(ticketId)).toHaveLength(1)

    await scanner.getByRole('button', { name: 'Next ticket' }).click()
    await scanner.getByRole('button', { name: 'Stop camera' }).click()
    await expect(scanner.getByText('The camera is off.')).toBeVisible()
  })
})

test.describe('the door camera, when there is no camera to be had', () => {
  test('explains a refused permission and points at the printed code', async ({ scanner }) => {
    await fakeCamera(scanner, { kind: 'refuse', name: 'NotAllowedError' })
    await openDoor(scanner)
    await scanner.getByRole('button', { name: 'Scan the QR pass' }).click()
    await scanner.getByRole('button', { name: 'Start camera' }).click()

    await expect(scanner.getByText(/camera permission was refused/iu)).toBeVisible()
    await expect(scanner.getByRole('button', { name: 'Try the camera again' })).toBeVisible()
  })

  test('explains a device whose camera cannot be started', async ({ scanner }) => {
    await fakeCamera(scanner, { kind: 'refuse', name: 'NotReadableError' })
    await openDoor(scanner)
    await scanner.getByRole('button', { name: 'Scan the QR pass' }).click()
    await scanner.getByRole('button', { name: 'Start camera' }).click()

    await expect(scanner.getByText(/no camera could be started/iu)).toBeVisible()
  })

  test('explains a browser with no camera at all, and offers nothing to start', async ({
    scanner,
  }) => {
    await fakeCamera(scanner, { kind: 'absent' })
    await openDoor(scanner)
    await scanner.getByRole('button', { name: 'Scan the QR pass' }).click()

    await expect(scanner.getByText(/cannot use a camera here/iu)).toBeVisible()
    await expect(scanner.getByRole('button', { name: 'Start camera' })).toHaveCount(0)
  })
})
