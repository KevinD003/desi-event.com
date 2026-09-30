import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { readDrawing, slices } from './support/qr-drawing.mjs'
import { GROUP_GUESTS } from './support/seed-feature-world.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

// A group pass lets in everybody on an order at once, and this file draws one,
// decodes it and types its printed code. A screenshot, a trace or a film of
// either is a way in for the whole group, so none is taken in this file.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

/**
 * An order's group pass, from the buyer's wallet to the door, in a real
 * browser against the real API.
 *
 * ## The story
 *
 * The giver bought three tickets for gamma's second night, one per guest
 * (`seed-feature-world.mjs`). Their wallet offers one pass for the three; the
 * order's page draws it on request, with the printed code beside it. A
 * screenshot of it went somewhere it should not, so the giver replaces it: the
 * old code stops working at the door at once. At gamma's door the owner's
 * camera reads the new drawing, the door lists the three guests by name, and
 * the owner — unticking the one who has not arrived — admits two in one press.
 * Later the third arrives and the printed code is typed: the door says two are
 * already in and admits the last. A third lookup has nobody left to admit.
 *
 * The replacement comes before the door, not after: a pass lets in the
 * tickets on the order that still admit, and once none does there is no pass
 * to show or to replace.
 *
 * ## What is checked where
 *
 * - **The page:** the pass is drawn only when asked for, never as text, and
 *   its credential is nowhere in the markup, storage or the address. The door
 *   names people, never addresses.
 * - **The database:** every admission is a `CheckIn` row tied to the group
 *   pass, with the method the door really used — a screen that said "Admitted
 *   2" over no rows would pass every page assertion.
 * - **The wire:** the pass arrives with `no-store, private`, through the web's
 *   proxy, and the door's calls are the group lookup and the group admission.
 *
 * ## Isolation
 *
 * The giver's group order is the feature world's and no other spec reads it;
 * gamma is not alpha. Serial, because the four cases are one story and each
 * starts where the one before left the order.
 *
 * @module e2e/detail-group-pass
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** A group pass, in the shape the door's schema accepts. */
const GROUP_CREDENTIAL = /^G1\.[A-Za-z0-9_-]{43}$/u

/** A printed group code, in the shape the door's schema accepts. */
const GROUP_CODE = /DEG-[2-9A-HJ-NP-Z]{12}/u

/**
 * Names the credential goes by, none of which may reach the markup.
 *
 * The HKDF purposes are the derivation labels (`group-pass-credentials.js`);
 * the JSON key form is how a leaked value would appear in a flight payload.
 *
 * @type {ReadonlyArray<string>}
 */
const CREDENTIAL_NEEDLES = Object.freeze([
  'credentialHash',
  'credentialVersion',
  'codeHash',
  'ticket-pass-v1',
  'group-pass-v1',
  'group-pass-code-v1',
  '"credential":',
])

/**
 * What the story has learned so far, for the cases after.
 *
 * @type {{drawing: {path: string, size: number}|null, credential: string|null, code: string|null}}
 */
const pass = { drawing: null, credential: null, code: null }

/**
 * The pass as it was before it was replaced.
 *
 * @type {{drawing: {path: string, size: number}|null, credential: string|null, code: string|null}}
 */
const replaced = { drawing: null, credential: null, code: null }

/**
 * The order's check-ins, read from the database.
 *
 * @returns {Promise<Array<{ticketId: string, method: string, groupPassId: string|null}>>} Rows.
 */
async function admissions() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.checkIn.findMany({
      where: { ticketId: { in: ids().groupTicketIds } },
      select: { ticketId: true, method: true, groupPassId: true },
      orderBy: { scannedAt: 'asc' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The order's group pass row, read from the database.
 *
 * @returns {Promise<{id: string, credentialVersion: number}|null>} The row.
 */
async function groupPassRow() {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await prisma.groupPass.findUnique({
      where: { orderId: ids().groupOrderId },
      select: { id: true, credentialVersion: true },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Replace a page's camera with a canvas painting a QR drawing.
 *
 * Must run before the page navigates. The canvas repaints every 100 ms, as a
 * camera keeps delivering frames.
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
 * Open gamma's door on its general-admission event.
 *
 * Gamma's owner holds every gamma door, so the event is chosen from the list
 * by its title.
 *
 * @param {object} page The owner's page.
 * @returns {Promise<void>} Resolves once the event is chosen.
 */
async function openGammaDoor(page) {
  await page.goto('/organizer/check-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()

  const choose = page.getByLabel('Event you are admitting to')
  const option = choose.locator('option', { hasText: ids().gammaGaEventTitle })

  await expect(option).toHaveCount(1)

  const value = await option.getAttribute('value')

  // Chosen once the select answers: a choice made before hydration is lost.
  await expect(async () => {
    await choose.selectOption(value)
    await expect(page.getByRole('heading', { name: 'Present a ticket' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })

  // The garba has two nights, and the group's tickets are for the second:
  // the door says which night it is admitting to, and refuses the other's.
  const night = page.getByLabel('Night you are admitting to')
  const nightValue = await night
    .locator('option', { hasText: /^Night 2 · /u })
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
  await page.getByLabel('Printed ticket code or group code').fill(code)
  await page.getByRole('button', { name: 'Look up' }).click()
}

test.describe.serial('a group pass, from the wallet to the door', () => {
  test('the wallet offers one pass for the order, and the order draws it only on request', async ({
    giver,
  }) => {
    const { groupOrderReference } = ids()

    await giver.goto('/tickets')

    const passes = giver.getByRole('region', { name: 'Group passes' })
    const card = passes.getByRole('listitem').filter({ hasText: 'Group pass (admits 3)' })

    await expect(card).toHaveCount(1)

    const link = card.getByRole('link', { name: /show group pass/iu })

    // A way to the pass, never the pass: the wallet draws nothing.
    await expect(link).toHaveAttribute(
      'href',
      `/account/orders/${encodeURIComponent(groupOrderReference)}#group-pass`,
    )
    await expect(giver.getByRole('img', { name: /group entry pass/iu })).toHaveCount(0)

    await link.click()
    await giver.waitForURL(
      (url) =>
        url.pathname === `/account/orders/${groupOrderReference}` && url.hash === '#group-pass',
    )

    const section = giver.getByRole('region', { name: 'Group pass (admits 3)' })

    await expect(section).toBeVisible()
    await expect(giver.getByRole('img', { name: /group entry pass/iu })).toHaveCount(0)

    const fetched = giver.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        `/api/v1/orders/${encodeURIComponent(groupOrderReference)}/group-pass`,
    )

    await section.getByRole('button', { name: 'Show group pass' }).click()

    // Through the web's proxy, and nothing on the way may keep it.
    const response = await fetched
    const cacheControl = response.headers()['cache-control'] ?? ''

    expect(response.status()).toBe(200)
    expect(cacheControl).toContain('no-store')
    expect(cacheControl).toContain('private')

    const drawing = giver.getByRole('img', { name: 'Group entry pass for 3 people, as a QR code' })

    await expect(drawing).toBeVisible()
    await expect(section.getByRole('button', { name: 'Hide group pass' })).toBeFocused()
    await expect(section).toContainText('Admits 3.')

    const read = await readDrawing(drawing)

    expect(read.value).toMatch(GROUP_CREDENTIAL)

    const code = (await section.innerText()).match(GROUP_CODE)?.[0] ?? null

    expect(code, 'the printed group code is not shown').not.toBeNull()

    pass.drawing = { path: read.path, size: read.size }
    pass.credential = read.value
    pass.code = code

    // The credential is in the picture and nowhere else: not in the markup,
    // the flight payload, storage or the address.
    const html = await giver.content()

    expect(html).not.toContain(pass.credential)
    expect(html).not.toMatch(/G1\.[A-Za-z0-9_-]{43}/u)

    for (const needle of CREDENTIAL_NEEDLES) {
      expect(html, `the order page carries ${needle}`).not.toContain(needle)
    }

    const kept = await giver.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, url: location.href }),
    )

    expect(slices(pass.credential).some((part) => kept.includes(part))).toBe(false)
    expect(kept).not.toContain(pass.code)

    // Hidden, it is gone from the page.
    await section.getByRole('button', { name: 'Hide group pass' }).click()
    await expect(drawing).toHaveCount(0)
    expect(await giver.content()).not.toContain(pass.code)
    await expect(section.getByRole('button', { name: 'Show group pass' })).toBeFocused()
  })

  test('replacing the pass stops the old code working, and leaves the tickets alone', async ({
    giver,
    gamma,
  }) => {
    expect(pass.code, 'the case before did not read the code').not.toBeNull()

    const { groupOrderReference, groupTicketIds } = ids()
    const before = await groupPassRow()
    /**
     * Each ticket's own pass digest, which replacing the group's must not touch.
     *
     * @returns {Promise<Array<string|null>>} Digests, in ticket order.
     */
    const ownPasses = async () => {
      const prisma = createPrismaClient({ connectionString: CONNECTION })

      try {
        const rows = await prisma.ticket.findMany({
          where: { id: { in: groupTicketIds } },
          select: { id: true, credentialHash: true },
        })

        return groupTicketIds.map((id) => rows.find((row) => row.id === id)?.credentialHash ?? null)
      } finally {
        await prisma.$disconnect()
      }
    }
    const ownBefore = await ownPasses()

    await giver.goto(`/account/orders/${encodeURIComponent(groupOrderReference)}`)

    const section = giver.getByRole('region', { name: 'Group pass (admits 3)' })

    await section.getByRole('button', { name: 'Show group pass' }).click()
    await expect(giver.getByRole('img', { name: /group entry pass/iu })).toBeVisible()
    await section.getByRole('button', { name: 'Replace group pass' }).click()
    await expect(section.getByRole('heading', { name: 'Replace the group pass?' })).toBeFocused()
    await section.getByRole('button', { name: 'Replace it', exact: true }).click()

    await expect(
      giver.getByText('Replaced. The old group QR and code no longer work.', { exact: true }),
    ).toBeVisible()

    const drawing = giver.getByRole('img', { name: /group entry pass/iu })

    await expect(drawing).toBeVisible()

    const fresh = await readDrawing(drawing)
    const freshCode = (await section.innerText()).match(GROUP_CODE)?.[0] ?? null

    expect(fresh.value).toMatch(GROUP_CREDENTIAL)
    expect(fresh.value).not.toBe(pass.credential)
    expect(freshCode).not.toBeNull()
    expect(freshCode).not.toBe(pass.code)
    expect((await groupPassRow()).credentialVersion).toBe(before.credentialVersion + 1)
    // Each ticket's own pass is untouched: only the group's was replaced.
    expect(ownBefore.every((digest) => typeof digest === 'string')).toBe(true)
    expect(await ownPasses()).toEqual(ownBefore)

    await section.getByRole('button', { name: 'Hide group pass' }).click()
    await expect(drawing).toHaveCount(0)

    Object.assign(replaced, { drawing: pass.drawing, credential: pass.credential, code: pass.code })
    Object.assign(pass, {
      drawing: { path: fresh.path, size: fresh.size },
      credential: fresh.value,
      code: freshCode,
    })

    // The old code matches nothing now, and the door says so without saying
    // why; nobody is admitted.
    const lookedUp = () =>
      gamma.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/tickets/admission/group/preview',
      )
    const notFound = gamma
      .locator('main')
      .getByRole('alert')
      .filter({ hasText: 'No ticket matches' })

    await cameraShowing(gamma, replaced.drawing)
    await openGammaDoor(gamma)

    let answer = lookedUp()

    await typeCode(gamma, replaced.code)
    expect((await answer).status()).toBe(404)
    await expect(notFound).toBeVisible()
    await expect(gamma.getByRole('button', { name: /^Admit/u })).toHaveCount(0)

    // Nor does the old drawing, held up to the camera.
    await gamma.getByRole('button', { name: 'Next ticket' }).click()
    await expect(notFound).toHaveCount(0)
    await gamma.getByRole('button', { name: 'Scan the QR pass' }).click()
    answer = lookedUp()
    await gamma.getByRole('button', { name: 'Start camera' }).click()
    expect((await answer).status()).toBe(404)
    await expect(notFound).toBeVisible()
    await expect(gamma.getByRole('button', { name: /^Admit/u })).toHaveCount(0)
    await gamma.getByRole('button', { name: 'Stop camera' }).click()

    expect(await admissions()).toEqual([])
  })

  test('the door reads the drawing, names the three, and admits the two who are there', async ({
    gamma,
  }) => {
    expect(pass.drawing, 'the case before did not draw the pass').not.toBeNull()

    const door = []

    gamma.on('request', (request) => {
      const { pathname } = new URL(request.url())

      if (pathname.startsWith('/api/v1/tickets/')) door.push(`${request.method()} ${pathname}`)
    })

    await cameraShowing(gamma, pass.drawing)
    await openGammaDoor(gamma)
    await gamma.getByRole('button', { name: 'Scan the QR pass' }).click()
    await gamma.getByRole('button', { name: 'Start camera' }).click()

    const card = gamma
      .getByRole('region')
      .filter({ has: gamma.getByRole('heading', { name: 'Check the group, then admit' }) })

    await expect(card).toBeVisible()
    await expect(card).toContainText('3 tickets can be admitted.')
    await expect(card).toContainText('Group QR pass')
    expect(await admissions()).toEqual([])

    // Three people, by name — never by address — each ticked to start with.
    const who = card.getByRole('group', { name: 'Who is at the door now' })

    for (const name of GROUP_GUESTS) {
      await expect(who.getByRole('checkbox', { name: new RegExp(`^${name}`, 'u') })).toBeChecked()
    }

    expect(await card.innerText()).not.toMatch(/@/u)

    // The third guest has not arrived: untick them, and admit the two.
    await who.getByRole('checkbox', { name: new RegExp(`^${GROUP_GUESTS[2]}`, 'u') }).uncheck()
    await card.getByRole('button', { name: 'Admit 2', exact: true }).click()

    await expect(gamma.getByRole('heading', { name: 'Admitted 2', exact: true })).toBeFocused()

    const rows = await admissions()
    const { groupTicketIds } = ids()
    const passRow = await groupPassRow()

    expect(rows.map((row) => row.ticketId).sort()).toEqual(groupTicketIds.slice(0, 2).sort())
    expect(rows.every((row) => row.method === 'QR_SCAN')).toBe(true)
    expect(rows.every((row) => row.groupPassId === passRow.id)).toBe(true)

    // One lookup and one admission, both the group's.
    expect(door).toEqual([
      'POST /api/v1/tickets/admission/group/preview',
      'POST /api/v1/tickets/admission/group/check-in',
    ])

    // The door kept no part of the pass: not in storage, a readable cookie
    // or its address. Only the places are reported, never the pass.
    const kept = await gamma.evaluate(() => ({
      localStorage: JSON.stringify({ ...localStorage }),
      sessionStorage: JSON.stringify({ ...sessionStorage }),
      cookie: document.cookie,
      address: location.href,
    }))
    const parts = slices(pass.credential)

    expect(
      Object.entries(kept)
        .filter(([, value]) => parts.some((part) => value.includes(part)))
        .map(([place]) => place),
    ).toEqual([])
  })

  test('the printed code admits the one still outside, and then there is nobody left', async ({
    gamma,
  }) => {
    expect(pass.code, 'the first case did not read the code').not.toBeNull()

    await openGammaDoor(gamma)
    await typeCode(gamma, pass.code)

    const card = gamma
      .getByRole('region')
      .filter({ has: gamma.getByRole('heading', { name: 'Check the group, then admit' }) })

    await expect(card).toBeVisible()
    await expect(card).toContainText('1 ticket can be admitted, 2 already in.')
    await expect(card).toContainText('Printed group code')
    await expect(card.getByRole('heading', { name: 'Already in' })).toBeVisible()

    await card.getByRole('button', { name: 'Admit 1', exact: true }).click()
    await expect(gamma.getByRole('heading', { name: 'Admitted 1', exact: true })).toBeFocused()

    const rows = await admissions()

    expect(rows).toHaveLength(3)
    expect(rows.at(-1)).toMatchObject({ ticketId: ids().groupTicketIds[2], method: 'MANUAL_CODE' })
    expect(rows.at(-1).groupPassId).not.toBeNull()
    // The code in hand is gone once the group is done with.
    await expect(gamma.getByLabel('Printed ticket code or group code')).toHaveValue('')

    // Again: everybody is in, and there is no way to admit anybody twice.
    await gamma.getByRole('button', { name: 'Next ticket' }).click()
    await typeCode(gamma, pass.code)

    const nobody = gamma.getByRole('region').filter({
      has: gamma.getByRole('heading', { name: 'Nobody in this group can be admitted' }),
    })

    await expect(nobody).toBeVisible()
    await expect(nobody).toContainText('0 tickets can be admitted, 3 already in.')
    await expect(gamma.getByRole('button', { name: /^Admit/u })).toHaveCount(0)
    expect(await admissions()).toHaveLength(3)
  })
})
