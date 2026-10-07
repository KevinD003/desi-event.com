import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventMediaEditor } = await import('./event-media-editor.jsx')

const EVENT = { id: 'cevent0000000000000000001', slug: 'garba-night', title: 'Garba Night' }

/**
 * A picture as the organiser's list carries it.
 *
 * @param {object} [overrides] Field overrides.
 * @returns {object} The payload.
 */
function picture(overrides = {}) {
  const id = overrides.id ?? 'cmedia0000000000000000001'

  return {
    id,
    url: `/v1/media/${id}`,
    altText: 'Dancers circling a lit garbo',
    width: 1200,
    height: 630,
    contentType: 'image/png',
    kind: 'EVENT_COVER',
    position: null,
    byteSize: 204_800,
    checksum: 'a'.repeat(64),
    moderationStatus: 'PENDING',
    rejectionReason: null,
    publiclyVisible: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * A gallery picture.
 *
 * @param {number} position Its place.
 * @returns {object} The payload.
 */
function galleryPicture(position) {
  return picture({
    id: `cmedia000000000000000000${position + 2}`,
    kind: 'EVENT_GALLERY',
    position,
    altText: `The band, picture ${position + 1}`,
    width: 800,
    height: 800,
  })
}

/** A file whose first bytes are a PNG's. */
function pngFile(name = 'cover.png') {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])],
    name,
    {
      type: 'image/png',
    },
  )
}

/**
 * A response the mocked `apiFetch` will resolve with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Render the panel.
 *
 * @param {object} [props] Props.
 * @returns {{onRevision: Function}} The revision spy.
 */
function renderPanel(props = {}) {
  const onRevision = vi.fn()

  render(
    <EventMediaEditor
      event={EVENT}
      status="DRAFT"
      media={[]}
      revision={3}
      onRevision={onRevision}
      {...props}
    />,
  )

  return { onRevision }
}

/**
 * The cover upload form.
 *
 * @returns {HTMLElement} The form.
 */
function coverForm() {
  return screen.getByRole('form', { name: /upload a cover|replace the cover/i })
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('uploading', () => {
  it('asks for a description before sending anything', async () => {
    const user = userEvent.setup()

    renderPanel()

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    const description = within(form).getByLabelText(/^Describe the picture/)

    expect(apiFetch).not.toHaveBeenCalled()
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(description).toHaveFocus()
    expect(within(form).getByText('Describe the picture.')).toBeInTheDocument()
  })

  it('refuses a file name as a description', async () => {
    const user = userEvent.setup()

    renderPanel()

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'IMG_1234.jpg')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(
      within(form).getByText('Describe what the picture shows, not its file name.'),
    ).toBeInTheDocument()
  })

  it('refuses a file over 10 MB, and an SVG calling itself a PNG, before sending', async () => {
    const user = userEvent.setup()

    renderPanel()

    const form = coverForm()
    const input = within(form).getByLabelText(/^Picture file/)

    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The stage at dusk')

    await user.upload(
      input,
      new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' }),
    )
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(within(form).getByText(/11\.0 MB; pictures can be at most 10 MB/)).toBeInTheDocument()
    expect(input).toHaveFocus()

    await user.upload(
      input,
      new File(['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'], 'cover.png', {
        type: 'image/png',
      }),
    )
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(
      within(form).getByText('That file is an SVG drawing, not a JPEG, PNG or WebP picture.'),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the file as the body, the description in the query, and hands the new revision up', async () => {
    const user = userEvent.setup()
    const uploaded = picture({ altText: 'The stage at dusk' })

    apiFetch.mockResolvedValue(
      answer(201, { data: uploaded, meta: { revision: 4, removed: ['text notes', 'comments'] } }),
    )

    const { onRevision } = renderPanel()
    const form = coverForm()
    const file = pngFile()

    await user.upload(within(form).getByLabelText(/^Picture file/), file)
    await user.type(within(form).getByLabelText(/^Describe the picture/), '  The stage   at dusk ')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(onRevision).toHaveBeenCalledWith(4))

    const [path, init] = apiFetch.mock.calls[0]
    const url = new URL(path, 'https://x.test')

    expect(url.pathname).toBe(`/v1/events/${EVENT.id}/media`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'EVENT_COVER',
      altText: 'The stage at dusk',
      revision: '3',
    })
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('image/png')
    expect(init.body).toBe(file)

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      /Cover uploaded\..*Removed before saving: text notes, comments\./,
    )

    // Focus lands on the new picture, and it says it is waiting for review.
    const heading = screen.getByRole('heading', { name: 'The cover' })

    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The stage at dusk' })).toHaveAttribute(
      'src',
      `/api/v1/media/${uploaded.id}`,
    )
  })

  it('declares a file of an unrecognised type as bytes, and lets the server read them', async () => {
    // A browser's "All files" choice gets past the input's accept list.
    const user = userEvent.setup({ applyAccept: false })

    apiFetch.mockResolvedValue(answer(201, { data: picture(), meta: { revision: 4 } }))

    renderPanel()

    const form = coverForm()

    await user.upload(
      within(form).getByLabelText(/^Picture file/),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'x.png', {
        type: 'image/x-png',
      }),
    )
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The stage at dusk')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][1].headers['content-type']).toBe('application/octet-stream')
  })

  it.each([
    [
      415,
      {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'This file is an SVG drawing, not a JPEG, PNG or WebP picture.',
      },
      'This file is an SVG drawing, not a JPEG, PNG or WebP picture.',
    ],
    [
      413,
      { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
      /Choose a smaller one/,
    ],
    [
      422,
      {
        code: 'IMAGE_TOO_SMALL',
        message: 'This picture is 800 × 450. A cover must be at least 960 × 540.',
      },
      'This picture is 800 × 450. A cover must be at least 960 × 540.',
    ],
    [
      409,
      { code: 'STALE_REVISION', message: 'Somebody else saved.' },
      /Reload the page to see their version/,
    ],
  ])('says what a %i means, and focuses it', async (status, error, expected) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(status, { error: { statusCode: status, ...error } }))

    const { onRevision } = renderPanel()
    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The stage at dusk')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    const alert = await screen.findByText(expected)

    expect(alert.closest('[tabindex="-1"]')).toHaveFocus()
    expect(onRevision).not.toHaveBeenCalled()
  })

  it('says the service is down when nothing answered', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('fetch failed'))

    renderPanel()

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The stage at dusk')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText(/Nothing has been uploaded/)).toBeInTheDocument()
  })
})

describe('arranging and removing', () => {
  it('moves a gallery picture, sending the whole new order', async () => {
    const user = userEvent.setup()
    const first = galleryPicture(0)
    const second = galleryPicture(1)

    apiFetch.mockResolvedValue(
      answer(200, {
        data: [
          { ...second, position: 0 },
          { ...first, position: 1 },
        ],
        meta: { revision: 4 },
      }),
    )

    const { onRevision } = renderPanel({ media: [first, second] })

    await user.click(screen.getByRole('button', { name: 'Move earlier: picture 2 of 2' }))

    await waitFor(() => expect(onRevision).toHaveBeenCalledWith(4))

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/events/${EVENT.id}/media/order`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ revision: 3, galleryIds: [second.id, first.id] })

    const headings = screen.getAllByRole('heading', { name: /^Picture \d of 2$/u })

    expect(headings.map((heading) => heading.parentElement.querySelector('img').alt)).toEqual([
      second.altText,
      first.altText,
    ])
    expect(screen.getByText('Moved to position 1 of 2.')).toBeInTheDocument()
  })

  it('offers no move earlier for the first picture or later for the last', () => {
    renderPanel({ media: [galleryPicture(0), galleryPicture(1)] })

    expect(screen.getByRole('button', { name: 'Move earlier: picture 1 of 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move later: picture 2 of 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move later: picture 1 of 2' })).toBeEnabled()
  })

  it('describes a picture again', async () => {
    const user = userEvent.setup()
    const cover = picture()

    apiFetch.mockResolvedValue(
      answer(200, { data: { ...cover, altText: 'The band at soundcheck' }, meta: { revision: 4 } }),
    )

    const { onRevision } = renderPanel({ media: [cover] })

    await user.click(screen.getByRole('button', { name: 'Edit description' }))

    const box = screen.getByLabelText(/^New description/)

    expect(box).toHaveFocus()

    await user.clear(box)
    await user.type(box, 'The band at soundcheck')
    await user.click(screen.getByRole('button', { name: 'Save description' }))

    await waitFor(() => expect(onRevision).toHaveBeenCalledWith(4))

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/events/${EVENT.id}/media/${cover.id}`)
    expect(JSON.parse(init.body)).toEqual({ revision: 3, altText: 'The band at soundcheck' })
    expect(screen.getByText('Description saved.')).toBeInTheDocument()
  })

  it('removes only after a confirmation, with the revision in the query, and moves focus', async () => {
    const user = userEvent.setup()
    const cover = picture()

    apiFetch.mockResolvedValue(answer(200, { data: [], meta: { revision: 4 } }))

    renderPanel({ media: [cover] })

    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/deleted, not hidden/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByText(/deleted, not hidden/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/events/${EVENT.id}/media/${cover.id}?revision=3`)
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cover' })).toHaveFocus())
    expect(
      screen.getByText('Cover removed. The listing and the event page show the generated poster.'),
    ).toBeInTheDocument()
  })

  it('shows a moderator’s takedown and the reason given', () => {
    renderPanel({
      media: [
        picture({ moderationStatus: 'REJECTED', rejectionReason: 'Shows a private home address.' }),
      ],
    })

    expect(screen.getByText('Removed by a moderator')).toBeInTheDocument()
    expect(screen.getByText('Shows a private home address.')).toBeInTheDocument()
  })
})

describe('what the event’s status allows', () => {
  it('offers uploads, and everything else, while the event is a draft', () => {
    renderPanel({ media: [picture(), galleryPicture(0), galleryPicture(1)] })

    expect(screen.getByRole('form', { name: 'Replace the cover' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Add a gallery picture' })).toBeInTheDocument()
    expect(screen.getByText(/2 of 8 pictures/)).toBeInTheDocument()
  })

  it('offers uploads, describing, reordering and removing on a live event, each new picture shown once the Desi-Event team approves it', () => {
    renderPanel({ status: 'PUBLISHED', media: [picture(), galleryPicture(0), galleryPicture(1)] })

    expect(screen.getByRole('form', { name: 'Replace the cover' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Add a gallery picture' })).toBeInTheDocument()
    expect(
      screen.getByText(/appears on the public page once the Desi-Event team approves it/),
    ).toBeInTheDocument()
    // The current cover stays up until a replacement is approved.
    expect(screen.getByText(/stays on the page until then/)).toBeInTheDocument()
    expect(screen.queryByText(/reviewed with the event/)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Edit description' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Move later: picture 1 of 2' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove: the cover' })).toBeEnabled()
  })

  it('offers nothing while a moderator holds the event', () => {
    renderPanel({ status: 'REVIEW_PENDING', media: [picture()] })

    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/A moderator is looking at this version/)).toBeInTheDocument()
  })

  it('tells the organiser of an approved event that publishing comes next, not a moderator', () => {
    renderPanel({ status: 'APPROVED', media: [picture({ moderationStatus: 'APPROVED' })] })

    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText(
        'This event is approved and waiting for you to publish it. Its pictures can be described again, reordered or removed once it is published.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/moderator is looking/i)).toBeNull()
  })

  it('offers describing, reordering, removal and uploads on a cancelled event, each new picture shown once the Desi-Event team approves it', () => {
    renderPanel({ status: 'CANCELLED', media: [picture(), galleryPicture(0), galleryPicture(1)] })

    expect(screen.getAllByRole('button', { name: 'Edit description' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Move later: picture 1 of 2' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove: the cover' })).toBeEnabled()
    expect(screen.getByRole('form', { name: 'Add a gallery picture' })).toBeInTheDocument()
    expect(
      screen.getByText(/appears on the public page once the Desi-Event team approves it/),
    ).toBeInTheDocument()
  })

  it('says the gallery is full instead of offering a ninth upload', () => {
    renderPanel({ media: Array.from({ length: 8 }, (_, index) => galleryPicture(index)) })

    expect(screen.queryByRole('form', { name: 'Add a gallery picture' })).toBeNull()
    expect(screen.getByText(/Remove one to add another/)).toBeInTheDocument()
  })

  it('says plainly that there is no cover, without promising one', () => {
    renderPanel()

    const sentence = screen.getByText(/There is no cover/)

    expect(sentence.textContent).not.toMatch(/\b(yet|soon|planned)\b/iu)
  })
})

describe('a new cover on a posted event', () => {
  const current = picture({
    moderationStatus: 'APPROVED',
    publiclyVisible: true,
    altText: 'The current poster',
  })

  it('keeps the current cover beside the new one, which is marked as waiting', async () => {
    const user = userEvent.setup()
    const waiting = picture({
      id: 'cmedia0000000000000000009',
      altText: 'The new poster',
      replacesMediaId: current.id,
    })

    apiFetch.mockResolvedValue(answer(201, { data: waiting, meta: { revision: 4 } }))
    renderPanel({ status: 'ON_SALE', media: [current] })

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The new poster')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    const fresh = await screen.findByRole('listitem', {
      name: 'The new cover, waiting for approval',
    })
    const old = screen.getByRole('listitem', { name: 'The current cover' })

    expect(within(fresh).getByText('Waiting for approval')).toBeInTheDocument()
    expect(within(old).getByText('On the public page')).toBeInTheDocument()
    expect(within(old).getByRole('img', { name: 'The current poster' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      /once the Desi-Event team approves it\. The current cover stays until then\./,
    )
  })

  it('says a gallery picture waiting on a posted event waits for approval, as the new cover does', () => {
    // Nothing posted is reviewed again (SPEC2-XI X-2): "Waiting for review"
    // there reads as the event going back into review. The picture waits for
    // the Desi-Event team's approval of it alone, in the cover's words.
    const waitingGallery = { ...galleryPicture(0), altText: 'The band warming up' }
    const waitingCover = picture({
      id: 'cmedia0000000000000000009',
      altText: 'The new poster',
      replacesMediaId: current.id,
    })

    renderPanel({ status: 'ON_SALE', media: [current, waitingCover, waitingGallery] })

    const gallery = screen.getByRole('listitem', { name: 'Picture 1 of 1' })
    const cover = screen.getByRole('listitem', { name: 'The new cover, waiting for approval' })

    expect(within(gallery).getByText('Waiting for approval')).toBeInTheDocument()
    expect(within(gallery).queryByText('Waiting for review')).not.toBeInTheDocument()
    expect(within(cover).getByText('Waiting for approval')).toBeInTheDocument()
  })

  it('discards a replacement that was waiting when another is uploaded', async () => {
    const user = userEvent.setup()
    const earlier = picture({
      id: 'cmedia0000000000000000008',
      altText: 'An earlier try',
      replacesMediaId: current.id,
    })
    const later = picture({
      id: 'cmedia0000000000000000009',
      altText: 'A better try',
      replacesMediaId: current.id,
    })

    apiFetch.mockResolvedValue(answer(201, { data: later, meta: { revision: 4 } }))
    renderPanel({ status: 'ON_SALE', media: [current, earlier] })

    expect(screen.getByRole('img', { name: 'An earlier try' })).toBeInTheDocument()

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'A better try')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('img', { name: 'A better try' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'An earlier try' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The current poster' })).toBeInTheDocument()
  })

  it('replaces the cover at once on a draft, where it is reviewed with the event', async () => {
    const user = userEvent.setup()
    const fresh = picture({ id: 'cmedia0000000000000000009', altText: 'The new poster' })

    apiFetch.mockResolvedValue(answer(201, { data: fresh, meta: { revision: 4 } }))
    renderPanel({ status: 'DRAFT', media: [picture({ altText: 'The old poster' })] })

    const form = coverForm()

    await user.upload(within(form).getByLabelText(/^Picture file/), pngFile())
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The new poster')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('img', { name: 'The new poster' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'The old poster' })).not.toBeInTheDocument()
  })

  it('says the current cover stays when the waiting one is removed, and shows a refusal’s reason', async () => {
    const user = userEvent.setup()
    const refused = picture({
      id: 'cmedia0000000000000000009',
      altText: 'The new poster',
      replacesMediaId: current.id,
      moderationStatus: 'REJECTED',
      rejectionReason: 'The text on it is too small to read.',
    })

    apiFetch.mockResolvedValue(answer(200, { data: [current], meta: { revision: 5 } }))
    renderPanel({ status: 'ON_SALE', media: [current, refused] })

    const item = screen.getByRole('listitem', { name: 'The new cover, not approved' })

    expect(within(item).getByText('Not approved')).toBeInTheDocument()
    expect(within(item).getByText('The text on it is too small to read.')).toBeInTheDocument()

    await user.click(within(item).getByRole('button', { name: /^Remove/ }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))

    expect(
      await screen.findByText('The waiting cover was removed. The current cover stays.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The current poster' })).toBeInTheDocument()
  })

  it('no longer says a live event cannot take a new picture', () => {
    renderPanel({ status: 'ON_SALE', media: [current] })

    expect(screen.queryByText(/cannot be added/)).not.toBeInTheDocument()
  })
})

describe('when the pictures could not be read', () => {
  it('shows the refusal, not an empty list, and offers no upload', () => {
    renderPanel({ failure: { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 } })

    expect(screen.getByRole('heading', { name: 'Media', level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/Until this event’s pictures load/)).toBeInTheDocument()
    // Why, from the refusal itself: here, the wait the API asked for.
    expect(screen.getByText('Too many attempts')).toBeInTheDocument()
    // Neither of the two things that would be untrue, or dangerous, here.
    expect(screen.queryByText(/There is no cover/)).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull()
  })
})

describe('a list the editor shell owns', () => {
  it('draws the list it is given and hands every change to the shell', async () => {
    const user = userEvent.setup()
    const cover = picture()
    const onMediaChange = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: [], meta: { revision: 4 } }))

    renderPanel({ media: [cover], onMediaChange })

    expect(screen.getByRole('listitem', { name: 'The cover' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))

    await waitFor(() => expect(onMediaChange).toHaveBeenCalledWith([]))
  })
})

describe('writing as the Desi-Event team, whose second factor lapses every 10 minutes', () => {
  const PLATFORM_SENTENCE =
    'Confirm it’s you to keep editing. The Desi-Event team confirms every 10 minutes while editing someone else’s event.'

  /**
   * Answer the first write with STEP_UP_REQUIRED, the second factor with
   * success, and every later write with `then`.
   *
   * @param {object} then The answer once the second factor is fresh.
   * @returns {Function} The writes sent so far, as `[path, init]` pairs.
   */
  function lapsedOnce(then) {
    const writes = []

    apiFetch.mockImplementation(async (path, init = {}) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      writes.push([path, init])

      return writes.length === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } })
        : then
    })

    return () => writes
  }

  it('asks for the second factor where the picture was uploaded, then sends the same file again', async () => {
    const user = userEvent.setup()
    const uploaded = picture({ altText: 'The stage at dusk', kind: 'EVENT_GALLERY', position: 0 })
    const writes = lapsedOnce(answer(201, { data: uploaded, meta: { revision: 4 } }))
    const { onRevision } = renderPanel({ status: 'ON_SALE', platform: true })
    const form = screen.getByRole('form', { name: 'Add a gallery picture' })
    const file = pngFile('stage.png')

    await user.upload(within(form).getByLabelText(/^Picture file/), file)
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The stage at dusk')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText(PLATFORM_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByText('That did not work')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onRevision).toHaveBeenCalledWith(4))
    expect(writes()).toHaveLength(2)
    expect(writes()[1][0]).toBe(writes()[0][0])
    expect(writes()[1][1].body).toBe(file)
  })

  it('asks before describing a picture again, then saves the same description', async () => {
    const user = userEvent.setup()
    const cover = picture()
    const writes = lapsedOnce(
      answer(200, { data: { ...cover, altText: 'The band at soundcheck' }, meta: { revision: 4 } }),
    )
    const { onRevision } = renderPanel({ status: 'ON_SALE', media: [cover], platform: true })

    await user.click(screen.getByRole('button', { name: 'Edit description' }))

    const box = screen.getByLabelText(/^New description/)

    await user.clear(box)
    await user.type(box, 'The band at soundcheck')
    await user.click(screen.getByRole('button', { name: 'Save description' }))

    expect(await screen.findByText(PLATFORM_SENTENCE)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onRevision).toHaveBeenCalledWith(4))
    expect(JSON.parse(writes()[1][1].body)).toEqual({
      revision: 3,
      altText: 'The band at soundcheck',
    })
    expect(await screen.findByText('Description saved.')).toBeInTheDocument()
  })

  it('says nothing was sent when the second factor is not given', async () => {
    const user = userEvent.setup()
    const cover = picture()
    const writes = lapsedOnce(answer(200, { data: [], meta: { revision: 4 } }))

    renderPanel({ status: 'ON_SALE', media: [cover], platform: true })

    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    expect(
      await screen.findByText(
        'Not saved: confirm it’s you to make this change. Nothing has been sent.',
      ),
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(1)
  })
})
