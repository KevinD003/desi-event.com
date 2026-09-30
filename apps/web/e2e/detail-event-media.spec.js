import { expect, test, world } from './support/detail-fixtures.mjs'
import { oversizedPng, solidPng, svgAsPng } from './support/images.mjs'
import { cleanupMedia, seedMedia } from './support/seed-media.mjs'
import { confirmIfPrompted, waitOutCredentialBudget } from './support/step-up.mjs'

/**
 * An event's pictures, from the organiser's upload to the public page and back
 * off it, in a real browser against the real API.
 *
 * ## The story
 *
 *   1. The editor's Media step refuses, before anything is sent, a picture
 *      with no description, a drawing named like a PNG, and a file over the
 *      limit — and the API refuses the drawing too, for a client that skips
 *      the form.
 *   2. A cover and three gallery pictures go up. The cover carried a text
 *      chunk, and the page says it was removed; the middle picture is
 *      removed, and the two either side of it keep their order through a
 *      reload; the gallery is reordered and one is described again, and both
 *      survive a reload. None of it is public: an anonymous read of the cover
 *      is a 404 that nothing may cache.
 *   3. The event goes for review. The moderator sees every picture with its
 *      description, takes one down with a reason, and approves the event.
 *   4. Published, the event page shows the cover through the image optimiser,
 *      the one gallery picture left, and a social image made from the cover.
 *      The picture itself is served publicly with the headers a public image
 *      needs, rebuilt without its text chunk, and revalidates to a 304. The
 *      listing card shows the cover too, and no storage detail reaches the
 *      page.
 *   5. The organiser removes the cover from the live event: the poster comes
 *      back, and the picture's address answers nothing.
 *
 * ## Whose event
 *
 * Gamma's (`seed-feature-world.mjs`), a draft of its own made by
 * `support/seed-media.mjs` with everything review asks for, and removed with
 * its pictures afterwards. The moderator is the platform reader, a super
 * administrator. Neither account's privileges change, so both saved sessions
 * serve; each confirms a second factor through the page's own prompt when the
 * server asks for one.
 *
 * The pictures are made here, byte by byte (`support/images.mjs`), so what each
 * one holds is written in this file.
 *
 * @module e2e/detail-event-media
 */

/** The cover's description, as an organiser would write it. */
const COVER_ALT = 'Dancers circling a lit garbo under string lights'

/** The two gallery pictures' descriptions, in upload order. */
const FIRST_ALT = 'The first circle of dancers, before the music starts'
const SECOND_ALT = 'Children learning the steps at the edge of the floor'

/** The gallery picture uploaded between the two, and removed again. */
const REMOVED_ALT = 'A blurred photograph of the stage, taken by mistake'

/** The first gallery picture's description once it is written again. */
const FIRST_ALT_AGAIN = 'The first circle of dancers, under the lights, before the music starts'

/** What the cover's text chunk says, so its absence can be looked for. */
const TEXT_CHUNK = { keyword: 'Author', text: 'Gamma photographer, Edison NJ' }

/** The pictures event, seeded in `beforeAll`. @type {{eventId: string, title: string, slug: string}} */
let seeded
/** The cover's id, read from its upload's answer. @type {string} */
let coverId
/** The gallery picture taken down, by id. @type {string} */
let rejectedId

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * Open the event's editor on one step.
 *
 * @param {object} page The organiser's page.
 * @param {RegExp} step The step button's name.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openStep(page, step) {
  await page.goto(`/organizer/events/${seeded.eventId}`)
  // The step buttons answer only once the editor has hydrated.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  const button = page.getByRole('navigation', { name: 'Editor steps' }).getByRole('button', {
    name: step,
  })

  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

/**
 * One of the Media step's upload forms, by its heading.
 *
 * @param {object} page The organiser's page.
 * @param {string} title "Upload a cover", "Replace the cover" or "Add a gallery picture".
 * @returns {object} The form's locator.
 */
function uploadForm(page, title) {
  return page.getByRole('form', { name: title, exact: true })
}

/**
 * Choose a file and describe it in an upload form, then press Upload.
 *
 * @param {object} form The form's locator.
 * @param {{name: string, buffer: Buffer}} file The file.
 * @param {string} description What it shows.
 * @returns {Promise<void>} Resolves once pressed.
 */
async function upload(form, file, description) {
  await form.getByLabel(/^Picture file/u).setInputFiles({
    name: file.name,
    mimeType: 'image/png',
    buffer: file.buffer,
  })
  await form.getByLabel(/^Describe the picture/u).fill(description)
  await form.getByRole('button', { name: 'Upload', exact: true }).click()
}

/**
 * Whether a request is an upload to this event.
 *
 * @param {object} request A Playwright request.
 * @returns {boolean} True for a POST to the event's pictures.
 */
function isUpload(request) {
  return (
    request.method() === 'POST' &&
    new URL(request.url()).pathname === `/api/v1/events/${seeded.eventId}/media`
  )
}

/**
 * Answer a step-up prompt if the page offers one, then wait for the outcome,
 * with the credential budget honoured.
 *
 * @param {object} page The Playwright page, just after the action.
 * @param {object} outcome What appears once the action has succeeded.
 * @returns {Promise<void>} Resolves once the outcome is visible.
 */
async function confirmed(page, outcome) {
  await waitOutCredentialBudget(page, () => confirmIfPrompted(page, outcome), {
    refusedAt: /^\/api\/v1\/auth\//u,
  })
}

/**
 * The polite status region on the Media step that says a given thing.
 *
 * @param {object} page The organiser's page.
 * @param {string|RegExp} words What it says.
 * @returns {object} The region's locator.
 */
function saying(page, words) {
  return page.getByRole('status').filter({ hasText: words })
}

test.describe.serial("an event's pictures, from upload to the public page", () => {
  test.beforeAll(async () => {
    seeded = await seedMedia({
      tag: ids().tag,
      organizationId: ids().gammaOrganizationId,
      venueId: ids().gammaVenueId,
    })
  })

  test.afterAll(async () => {
    await cleanupMedia(ids().tag)
  })

  test('journey 1: a picture is refused before it is sent, and by the API if it is sent anyway', async ({
    gamma,
  }) => {
    const uploads = []

    gamma.on('request', (request) => {
      if (isUpload(request)) uploads.push(request.url())
    })

    await openStep(gamma, /^step 6\s*media$/iu)
    await expect(gamma.getByText('There is no cover.', { exact: false })).toBeVisible()
    await expect(gamma.getByText(/^0 of 8 pictures/u)).toBeVisible()

    const cover = uploadForm(gamma, 'Upload a cover')
    const file = cover.getByLabel(/^Picture file/u)
    const description = cover.getByLabel(/^Describe the picture/u)

    // No description: said at the field, and nothing leaves the page.
    await file.setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: solidPng(1200, 630),
    })
    await cover.getByRole('button', { name: 'Upload', exact: true }).click()
    await expect(cover.getByText('Describe the picture.', { exact: true })).toBeVisible()
    await expect(description).toBeFocused()

    // A drawing that calls itself a PNG: what it is, said plainly.
    await upload(cover, { name: 'cover.png', buffer: svgAsPng() }, COVER_ALT)
    await expect(
      cover.getByText('That file is an SVG drawing, not a JPEG, PNG or WebP picture.'),
    ).toBeVisible()
    await expect(file).toBeFocused()

    // Over the limit, whatever it is.
    await upload(cover, { name: 'cover.png', buffer: oversizedPng(11) }, COVER_ALT)
    await expect(
      cover.getByText(
        'That file is 11.0 MB; pictures can be at most 10 MB. Save a smaller copy and try again.',
      ),
    ).toBeVisible()

    expect(uploads, 'a refused picture was sent anyway').toEqual([])

    // A client that skips the form meets the same refusal from the API, which
    // reads the bytes rather than the declared type or the file name.
    // The revision the editor shows, which an upload has to name.
    const revision = Number(
      (await gamma.getByText(/^Revision \d+$/u).textContent()).match(/\d+/u)[0],
    )
    const refused = await gamma.evaluate(
      async ({ eventId, svg, alt, current }) => {
        const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
        const csrf = token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}
        const query = new URLSearchParams({
          kind: 'EVENT_COVER',
          altText: alt,
          revision: String(current),
        })
        const response = await fetch(`/api/v1/events/${eventId}/media?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'image/png', ...csrf },
          body: new TextEncoder().encode(svg),
        })
        const body = await response.json()

        return { status: response.status, message: body?.error?.message ?? null }
      },
      {
        eventId: seeded.eventId,
        svg: svgAsPng().toString('utf8'),
        alt: COVER_ALT,
        current: revision,
      },
    )

    expect(refused).toEqual({
      status: 415,
      message: 'This file is an SVG drawing, not a JPEG, PNG or WebP picture.',
    })

    await openStep(gamma, /^step 6\s*media$/iu)
    await expect(gamma.getByText('There is no cover.', { exact: false })).toBeVisible()
  })

  test('journey 2: a cover and a gallery go up, lose their text details, and keep their order', async ({
    gamma,
    visitor,
  }) => {
    await openStep(gamma, /^step 6\s*media$/iu)

    const sent = gamma.waitForResponse((response) => isUpload(response.request()))

    await upload(
      uploadForm(gamma, 'Upload a cover'),
      { name: 'cover.png', buffer: solidPng(1200, 630, { textChunk: TEXT_CHUNK }) },
      COVER_ALT,
    )

    const answer = await sent

    expect(answer.status()).toBe(201)
    coverId = (await answer.json()).data.id

    // Rebuilt from its pixels, and the page says what did not survive.
    await expect(saying(gamma, 'Cover uploaded.')).toContainText(/Removed before saving: /u)

    const coverItem = gamma.getByRole('listitem', { name: 'The cover' })

    await expect(coverItem.getByRole('img', { name: COVER_ALT })).toBeVisible()
    await expect(coverItem).toContainText('Waiting for review')
    await expect(coverItem).toContainText('1200 × 630')

    await upload(
      uploadForm(gamma, 'Add a gallery picture'),
      { name: 'circle.png', buffer: solidPng(400, 400, { rgb: [36, 99, 140] }) },
      FIRST_ALT,
    )
    await expect(saying(gamma, 'Picture added to the gallery.')).toBeVisible()
    await upload(
      uploadForm(gamma, 'Add a gallery picture'),
      { name: 'blurred.png', buffer: solidPng(400, 400, { rgb: [90, 90, 90] }) },
      REMOVED_ALT,
    )
    await expect(gamma.getByText(/^2 of 8 pictures/u)).toBeVisible()
    await upload(
      uploadForm(gamma, 'Add a gallery picture'),
      { name: 'children.png', buffer: solidPng(400, 400, { rgb: [120, 40, 90] }) },
      SECOND_ALT,
    )
    await expect(gamma.getByText(/^3 of 8 pictures/u)).toBeVisible()

    // The middle one is removed, with a button that names which picture, and
    // a question first: it is deleted, not hidden.
    const middle = gamma.getByRole('listitem', { name: 'Picture 2 of 3' })

    await expect(middle.getByRole('img')).toHaveAttribute('alt', REMOVED_ALT)
    await middle.getByRole('button', { name: /^Remove\s*: picture 2 of 3$/u }).click()
    await middle.getByRole('button', { name: 'Remove picture', exact: true }).click()
    await expect(saying(gamma, 'Picture removed from the gallery.')).toBeVisible()
    await expect(gamma.getByText(/^2 of 8 pictures/u)).toBeVisible()

    const first = gamma.getByRole('listitem', { name: 'Picture 1 of 2' })
    const second = gamma.getByRole('listitem', { name: 'Picture 2 of 2' })

    // The two either side of it close up, in the order they went up — and the
    // server says so, not only the page.
    await openStep(gamma, /^step 6\s*media$/iu)
    await expect(gamma.getByText(/^2 of 8 pictures/u)).toBeVisible()
    await expect(gamma.getByRole('img', { name: REMOVED_ALT })).toHaveCount(0)
    await expect(first.getByRole('img')).toHaveAttribute('alt', FIRST_ALT)
    await expect(second.getByRole('img')).toHaveAttribute('alt', SECOND_ALT)

    // The second is moved in front of the first, with a button that names
    // which picture it moves.
    // The words after "Move earlier" are visually hidden, and a browser
    // computes the name with a space where that element starts.
    await second.getByRole('button', { name: /^Move earlier\s*: picture 2 of 2$/u }).click()
    await expect(saying(gamma, 'Moved to position 1 of 2.')).toBeVisible()
    await expect(first.getByRole('img')).toHaveAttribute('alt', SECOND_ALT)

    // And the one now second is described again.
    await second.getByRole('button', { name: 'Edit description', exact: true }).click()
    await second.getByLabel(/^New description/u).fill(FIRST_ALT_AGAIN)
    await second.getByRole('button', { name: 'Save description', exact: true }).click()
    await expect(saying(gamma, 'Description saved.')).toBeVisible()

    // Both kept by the server, not by the page.
    await openStep(gamma, /^step 6\s*media$/iu)
    await expect(first.getByRole('img')).toHaveAttribute('alt', SECOND_ALT)
    await expect(second.getByRole('img')).toHaveAttribute('alt', FIRST_ALT_AGAIN)

    // Not public before a moderator has seen it, and a refusal nothing may keep.
    const hidden = await visitor.request.get(`/api/v1/media/${coverId}`)

    expect(hidden.status()).toBe(404)
    expect(hidden.headers()['cache-control']).toBe('no-store')
  })

  test('journey 3: the moderator sees every picture described, takes one down, and approves the event', async ({
    gamma,
    platform,
  }) => {
    await openStep(gamma, /review/iu)
    await gamma.getByRole('button', { name: 'Send for review', exact: true }).click()
    await gamma.getByRole('button', { name: /yes, send for review/iu }).click()
    await expect(gamma.getByText(/waiting for review\. a moderator has it/iu)).toBeVisible()

    await platform.goto(`/moderation/events/${seeded.eventId}`)

    const pictures = platform.getByRole('listitem').filter({ has: platform.getByRole('img') })

    await expect(pictures).toHaveCount(3)

    for (const alt of [COVER_ALT, SECOND_ALT, FIRST_ALT_AGAIN]) {
      const card = pictures.filter({ hasText: alt })

      await expect(card.getByRole('img')).toHaveAttribute('alt', alt)
      await expect(card).toContainText(`Description (alt text): ${alt}`)
      await expect(card).toContainText('Waiting for review')
    }

    const takenDown = pictures.filter({ hasText: FIRST_ALT_AGAIN })

    rejectedId = (await takenDown.getByRole('img').getAttribute('src')).split('/').pop()

    await takenDown.getByRole('button', { name: 'Reject this picture', exact: true }).click()
    await takenDown
      .getByLabel(/^Why is it being taken down\?/u)
      .fill('The lighting makes the faces unrecognisable; please choose another.')
    await takenDown.getByRole('button', { name: 'Take this picture down', exact: true }).click()

    await confirmed(platform, platform.getByText(/taken down\. It is off every public page now\./u))
    await expect(takenDown).toContainText('Taken down')

    await platform.getByRole('button', { name: 'Approve', exact: true }).click()
    await platform.getByRole('button', { name: /yes, approve/iu }).click()
    await confirmed(platform, platform.getByText(/this event is now APPROVED/u))
  })

  test('journey 4: published, the page, the listing and the social image all show the cover', async ({
    gamma,
    visitor,
  }) => {
    await openStep(gamma, /review/iu)
    await gamma.getByRole('button', { name: 'Publish', exact: true }).click()
    await gamma.getByRole('button', { name: /yes, publish/iu }).click()
    await confirmed(gamma, gamma.getByText(/the page is live/iu).first())

    await visitor.goto(`/events/${seeded.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: seeded.title })).toBeVisible()

    // The cover, through the image optimiser, described as the organiser wrote.
    const hero = visitor.getByRole('img', { name: COVER_ALT }).first()

    await expect(hero).toBeVisible()
    expect(await hero.getAttribute('srcset')).toContain(
      `/_next/image?url=%2Fapi%2Fv1%2Fmedia%2F${coverId}`,
    )

    // The one gallery picture left; the one taken down is nowhere.
    const gallery = visitor.getByRole('region', { name: 'Pictures' })

    await expect(gallery.getByRole('img')).toHaveCount(1)
    await expect(gallery.getByRole('img')).toHaveAttribute('alt', SECOND_ALT)

    const html = await visitor.content()

    expect(html).not.toContain(FIRST_ALT_AGAIN)
    expect(html).not.toContain(rejectedId)
    // Nothing about where or by whom a picture is stored.
    expect(html).not.toContain(ids().gammaOwnerId)
    expect(html).not.toMatch(/storageKey|uploadedBy|checksum/u)

    // A social image drawn from the cover, at an address that names it.
    const ogImage = await visitor.locator('meta[property="og:image"]').getAttribute('content')

    expect(ogImage).toContain(`/events/${seeded.slug}/opengraph-image/cover-${coverId}`)
    await expect(visitor.locator('meta[name="twitter:image"]')).toHaveCount(1)

    const social = await visitor.request.get(new URL(ogImage).pathname)

    expect(social.status()).toBe(200)
    expect(social.headers()['content-type']).toBe('image/png')

    // Structured data points at the picture by its absolute address.
    const jsonLd = JSON.parse(
      await visitor.locator('script[type="application/ld+json"]').first().textContent(),
    )

    expect(JSON.stringify(jsonLd.image)).toMatch(
      new RegExp(`https?://[^"]+/api/v1/media/${coverId}`, 'u'),
    )

    // The picture itself: public, for a day, typed, and rebuilt without the
    // text chunk it was uploaded with.
    const served = await visitor.request.get(`/api/v1/media/${coverId}`)
    const headers = served.headers()
    const bytes = (await served.body()).toString('latin1')

    expect(served.status()).toBe(200)
    expect(headers['content-type']).toBe('image/png')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['cache-control']).toBe('public, max-age=86400')
    expect(headers.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/u)
    expect(bytes.startsWith('\u0089PNG')).toBe(true)
    expect(bytes).not.toContain('tEXt')
    expect(bytes).not.toContain(TEXT_CHUNK.text)

    const again = await visitor.request.get(`/api/v1/media/${coverId}`, {
      headers: { 'if-none-match': headers.etag },
    })

    expect(again.status()).toBe(304)

    // Taken down is taken down.
    expect((await visitor.request.get(`/api/v1/media/${rejectedId}`)).status()).toBe(404)

    // And the listing's card shows the cover, described.
    await visitor.goto(`/events?q=${encodeURIComponent(seeded.title)}`)
    await expect(visitor.getByRole('img', { name: COVER_ALT }).first()).toBeVisible()
  })

  test('journey 5: removing the cover from the live event puts the poster back', async ({
    gamma,
    visitor,
  }) => {
    await openStep(gamma, /^step 6\s*media$/iu)

    // Live: pictures can be described, moved and removed, but none added.
    await expect(uploadForm(gamma, 'Upload a cover')).toHaveCount(0)
    await expect(gamma.getByText(/a new picture cannot be added/u)).toBeVisible()

    const coverItem = gamma.getByRole('listitem', { name: 'The cover' })

    await coverItem.getByRole('button', { name: /^Remove\s*: the cover$/u }).click()
    await coverItem.getByRole('button', { name: 'Remove picture', exact: true }).click()
    await expect(
      saying(gamma, 'Cover removed. The listing and the event page show the generated poster.'),
    ).toBeVisible()

    await visitor.goto(`/events/${seeded.slug}`)
    await expect(visitor.getByRole('heading', { level: 1, name: seeded.title })).toBeVisible()
    await expect(visitor.getByRole('img', { name: COVER_ALT })).toHaveCount(0)
    await expect(
      visitor.getByRole('img', { name: new RegExp(` for ${seeded.title}$`, 'u') }).first(),
    ).toBeVisible()

    const gone = await visitor.request.get(`/api/v1/media/${coverId}`)

    expect(gone.status()).toBe(404)
    expect(gone.headers()['cache-control']).toBe('no-store')
  })
})
