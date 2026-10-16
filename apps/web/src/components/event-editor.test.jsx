import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
// The review panel asks the router to refresh after a lifecycle command. There
// is no app router in a unit test, and there does not need to be: what is under
// test here is the editor shell, not navigation.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const {
  EventEditor,
  formGaps,
  formProblems,
  stepOfField,
  toFormValues,
  toHousekeepingPatch,
  toPatch,
} = await import('./event-editor.jsx')

/** A draft with everything the form needs. */
const event = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  description: 'One paragraph about the night.',
  category: 'MUSIC_CONCERT',
  status: 'DRAFT',
  revision: 3,
  timezone: 'Asia/Kolkata',
  startsAt: '2026-11-01T14:30:00.000Z',
  endsAt: '2026-11-01T17:30:00.000Z',
  venueId: 'vnbanyancourtyard',
  isOnline: false,
  onlineUrl: null,
  languages: ['Urdu'],
  artists: ['Nizami Bandhu'],
  ageRestriction: null,
  policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours.' },
  accessibility: { features: ['CAPTIONING'], note: null },
  ticketTypes: [],
}

const venues = [{ id: 'vnbanyancourtyard', name: 'Banyan Courtyard', city: 'Mumbai' }]

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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  apiFetch.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what the editor says about saving', () => {
  it('starts by saying there is nothing to save', () => {
    render(<EventEditor event={event} venues={venues} />)

    expect(screen.getByTestId('save-status')).toHaveTextContent('No changes made.')
  })

  it('says so in words rather than with a colour', () => {
    render(<EventEditor event={event} venues={venues} />)

    const status = screen.getByTestId('save-status')

    // A polite live region: announced without interrupting, and readable.
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('role', 'status')
  })

  it('shows the revision it is editing', () => {
    render(<EventEditor event={event} venues={venues} />)

    expect(screen.getByText('Revision 3')).toBeInTheDocument()
  })

  it('notices an unsaved change before it saves it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')

    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes.')
  })

  it('saves on its own, carrying the revision it read', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, revision: 4 } }))

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')

    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/events/evtqawwalibanyan')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body).revision).toBe(3)
  })

  it('moves to the revision the server came back with', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, revision: 4 } }))

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(screen.getByText('Revision 4')).toBeInTheDocument())
  })

  it('leaves the value in the box when a save fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(422, { error: { message: 'That slug is taken.' } }))

    render(<EventEditor event={event} venues={venues} />)

    const title = screen.getByLabelText(/^Title/)

    await user.clear(title)
    await user.type(title, 'A different title')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveTextContent('That slug is taken.'),
    )

    // The one thing a form must never do is empty a field it could not save.
    expect(title).toHaveValue('A different title')
  })

  it('says the service is down rather than pretending it saved', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockRejectedValue(new Error('fetch failed'))

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveTextContent(/not responding/i),
    )
    expect(screen.getByTestId('save-status')).toHaveTextContent(/still in the boxes/i)
  })
})

describe('when somebody else has saved first', () => {
  it('stops, and offers the two honest choices', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'STALE_REVISION',
          message: 'Somebody else saved a change to this event while you were editing.',
        },
      }),
    )

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() =>
      expect(screen.getByText(/somebody else saved this event/i)).toBeInTheDocument(),
    )

    expect(screen.getByRole('button', { name: /load their version/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep mine open/i })).toBeInTheDocument()
  })

  it('does not merge and does not retry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(409, { error: { code: 'STALE_REVISION', message: 'Somebody else saved.' } }),
    )

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    // A retry would overwrite their work; a merge would produce a version
    // neither person wrote. Both are worse than stopping.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the unsaved text on screen so it can be copied', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(409, { error: { code: 'STALE_REVISION', message: 'Somebody else saved.' } }),
    )

    render(<EventEditor event={event} venues={venues} />)

    const title = screen.getByLabelText(/^Title/)

    await user.clear(title)
    await user.type(title, 'My afternoon of work')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(screen.getByText(/copy anything you need/i)).toBeInTheDocument())
    expect(title).toHaveValue('My afternoon of work')
  })

  it('replaces everything when the organiser chooses their version', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValueOnce(
      answer(409, { error: { code: 'STALE_REVISION', message: 'Somebody else saved.' } }),
    )

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(screen.getByRole('button', { name: /load their version/i })))

    apiFetch.mockResolvedValueOnce(
      answer(200, { data: { ...event, title: 'Their title', revision: 9 } }),
    )

    await user.click(screen.getByRole('button', { name: /load their version/i }))

    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue('Their title'))
    expect(screen.getByText('Revision 9')).toBeInTheDocument()
  })
})

describe('what the editor refuses to send', () => {
  it('does not save a form with an empty title', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.clear(screen.getByLabelText(/^Title/))
    await vi.advanceTimersByTimeAsync(3000)

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('lists every problem as a link into the field that has it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.clear(screen.getByLabelText(/^Title/))

    const summary = await screen.findByTestId('validation-summary')

    expect(summary).toHaveTextContent(/one thing needs fixing/i)

    const link = screen.getByRole('link', { name: /give the event a title/i })

    expect(link).toHaveAttribute('href', '#event-title')
  })

  it('counts the problems rather than saying "some"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.clear(screen.getByLabelText(/^Title/))
    await user.clear(screen.getByLabelText(/one-line summary/i))

    expect(await screen.findByTestId('validation-summary')).toHaveTextContent(
      /2 things need fixing/i,
    )
  })

  it('stops complaining once the change is undone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    const title = screen.getByLabelText(/^Title/)

    await user.clear(title)
    expect(await screen.findByTestId('validation-summary')).toBeInTheDocument()

    await user.type(title, event.title)

    // The boxes match what is stored again, so there is nothing wrong and
    // nothing to save. A stale "not saved: 1 thing needs fixing" is a message
    // about a state that no longer exists, and it is the one somebody acts on.
    await waitFor(() => expect(screen.queryByTestId('validation-summary')).not.toBeInTheDocument())
    expect(screen.getByTestId('save-status')).toHaveTextContent(/no unsaved changes/i)
  })

  it('moves focus to the summary when a press is refused', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.clear(screen.getByLabelText(/^Title/))
    await user.click(screen.getByRole('button', { name: /save now/i }))

    await waitFor(() => expect(screen.getByTestId('validation-summary')).toHaveFocus())
  })
})

describe('an incomplete draft', () => {
  it('says what is still to do without calling it an error', async () => {
    render(<EventEditor event={{ ...event, venueId: null }} venues={venues} />)

    expect(screen.getByTestId('readiness-gaps')).toHaveTextContent(/still to do before/i)
    expect(screen.getByText(/none of this stops the draft saving/i)).toBeInTheDocument()
    expect(screen.queryByTestId('validation-summary')).not.toBeInTheDocument()
  })

  it('still saves', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, venueId: null, revision: 4 } }))

    render(<EventEditor event={{ ...event, venueId: null }} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
  })
})

describe('the steps', () => {
  it('are real buttons a keyboard can reach', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    const schedule = screen.getByRole('button', { name: /when and where/i })

    await user.click(schedule)

    expect(schedule).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: 'When and where' })).toBeInTheDocument()
  })

  it('label an imported event’s end, which its listing did not give, as an estimate', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const estimate = /^Not given by the listing \(estimate for scheduling\)\./u
    const { unmount } = render(
      <EventEditor
        event={event}
        venues={venues}
        sessions={[{ id: 'snight1', endTimeListed: false }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    expect(screen.getByText(estimate)).toBeInTheDocument()

    unmount()
    render(
      <EventEditor
        event={event}
        venues={venues}
        sessions={[{ id: 'snight1', endTimeListed: true }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /when and where/i }))

    expect(screen.queryByText(estimate)).toBeNull()
  })

  it('say which step you are on without relying on colour', () => {
    render(<EventEditor event={event} venues={venues} />)

    expect(screen.getByRole('button', { name: /details/i })).toHaveAttribute('aria-current', 'step')
  })

  it('link the tickets step to this event’s promo codes, by ids only', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={{ ...event, organizationId: 'orgswarsadhana' }} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 4/i }))

    expect(screen.getByRole('link', { name: 'Promo codes for this event' })).toHaveAttribute(
      'href',
      '/organizer/promo-codes?organizationId=orgswarsadhana&eventId=evtqawwalibanyan',
    )
  })

  it('render the sessions, tickets and review panels', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={event}
        venues={venues}
        readiness={{
          ready: false,
          status: 'DRAFT',
          publishable: [],
          sellable: [],
          inventory: [],
          organizerVerified: true,
        }}
        transitions={{ status: 'DRAFT', transitions: [] }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 3/i }))
    expect(screen.getByRole('heading', { name: 'Sessions', level: 2 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 4/i }))
    expect(screen.getByRole('heading', { name: 'Tickets', level: 2 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 7/i }))
    expect(
      screen.getByRole('heading', { name: 'Line-up and running order', level: 2 }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 8/i }))
    expect(screen.getByRole('heading', { name: 'Guest information', level: 2 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    expect(screen.getByRole('heading', { name: /review and publish/i })).toBeInTheDocument()
  })

  it('hands one revision to every step, so they cannot drift apart', async () => {
    // Each panel used to hold its own copy, taken from the server render. That
    // is stale the moment any other step saves — and choosing a venue on one
    // step then adding a session on the next is the ordinary way through this
    // form, not a rare race.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, revision: 9 } }))

    render(<EventEditor event={event} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(screen.getByText('Revision 9')).toBeInTheDocument())

    // The sessions step now opens against revision 9, not the 3 it was rendered
    // with. Its own writes carry whatever the shell holds.
    await user.click(screen.getByRole('button', { name: /step 3/i }))

    expect(screen.getByRole('heading', { name: 'Sessions', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Revision 9')).toBeInTheDocument()
  })

  /** The event's cover, as `GET /v1/events/:id/media` lists it. */
  const cover = {
    id: 'cmedia0000000000000000001',
    url: '/v1/media/cmedia0000000000000000001',
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
  }

  it('make step 6 the pictures, with the upload forms and the pictures already there', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} media={[cover]} />)

    await user.click(screen.getByRole('button', { name: /step 6/i }))

    expect(screen.getByRole('heading', { name: 'Media', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'The cover' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Replace the cover' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add a gallery picture' })).toBeInTheDocument()
    // The pictures write on their own; the form's save button is not for them.
    expect(screen.queryByRole('button', { name: /save now|saved/i })).toBeNull()
  })

  it('carry a picture write’s new revision into the next autosave', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: [], meta: { revision: 7 } }))
      .mockResolvedValueOnce(answer(200, { data: { ...event, revision: 8 } }))

    render(<EventEditor event={event} venues={venues} media={[cover]} />)

    await user.click(screen.getByRole('button', { name: /step 6/i }))
    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))

    await waitFor(() => expect(screen.getByText('Revision 7')).toBeInTheDocument())
    expect(apiFetch.mock.calls[0][0]).toBe(
      '/v1/events/evtqawwalibanyan/media/cmedia0000000000000000001?revision=3',
    )

    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(apiFetch.mock.calls[1][1].body).revision).toBe(7)
  })

  it('keep the pictures as they are now after leaving the Media step and coming back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const gallery = {
      ...cover,
      id: 'cmedia0000000000000000002',
      url: '/v1/media/cmedia0000000000000000002',
      kind: 'EVENT_GALLERY',
      position: 0,
      altText: 'The band at soundcheck',
      width: 800,
      height: 800,
    }

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: [], meta: { revision: 4 } }))
      .mockResolvedValueOnce(answer(201, { data: gallery, meta: { revision: 5, removed: [] } }))

    render(<EventEditor event={event} venues={venues} media={[cover]} />)

    await user.click(screen.getByRole('button', { name: /step 6/i }))
    await user.click(screen.getByRole('button', { name: 'Remove: the cover' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => expect(screen.getByText(/There is no cover/)).toBeInTheDocument())

    const form = screen.getByRole('form', { name: /add a gallery picture/i })
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])],
      'band.png',
      { type: 'image/png' },
    )

    await user.upload(within(form).getByLabelText(/^Picture file/), file)
    await user.type(within(form).getByLabelText(/^Describe the picture/), 'The band at soundcheck')
    await user.click(within(form).getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(screen.getByText('Revision 5')).toBeInTheDocument())

    // Away to the details and back: the step is drawn afresh, from the list
    // the shell holds, not the one the page first loaded.
    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.click(screen.getByRole('button', { name: /step 6/i }))

    expect(screen.queryByRole('listitem', { name: 'The cover' })).toBeNull()
    expect(screen.getByText(/There is no cover/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upload a cover' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Picture 1 of 1' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 8 pictures/)).toBeInTheDocument()
  })

  it('say the pictures could not be read, rather than that there are none', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={event}
        venues={venues}
        media={[]}
        mediaFailure={{ status: 0, code: 'API_UNREACHABLE', retryAfterSeconds: null }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 6/i }))

    expect(screen.getByText(/Until this event’s pictures load/)).toBeInTheDocument()
    expect(screen.getByText(/This event’s pictures could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText(/There is no cover/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a cover' })).toBeNull()
  })
})

describe('an event that is not open for editing', () => {
  it('says so, and disables the fields', () => {
    render(<EventEditor event={{ ...event, status: 'REVIEW_PENDING' }} venues={venues} />)

    expect(screen.getByText(/not open for editing/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Title/)).toBeDisabled()
  })

  it('says whose turn it is rather than only what the state is called', () => {
    render(<EventEditor event={{ ...event, status: 'CHANGES_REQUIRED' }} venues={venues} />)

    expect(screen.getByText(/a moderator has asked for something specific/i)).toBeInTheDocument()
  })

  it.each(['REVIEW_PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED', 'DELETED'])(
    'never autosaves one that is %s',
    async (status) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(<EventEditor event={{ ...event, status }} venues={venues} />)

      expect(screen.getByLabelText(/^Title/)).toBeDisabled()

      await user.click(screen.getByRole('button', { name: /when and where/i }))
      await vi.advanceTimersByTimeAsync(5000)

      expect(apiFetch).not.toHaveBeenCalled()
    },
  )
})

describe('a finished or cancelled event', () => {
  it.each([
    ['CANCELLED', 'This event was cancelled'],
    ['COMPLETED', 'This event has finished'],
  ])(
    'autosaves the words of one that is %s and never sends a material field',
    async (status, title) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const ended = { ...event, status }

      apiFetch.mockResolvedValue(answer(200, { data: { ...ended, revision: 4 } }))

      render(<EventEditor event={ended} venues={venues} />)

      expect(screen.getByText(title)).toBeInTheDocument()
      expect(screen.getByText(/can still be updated, and save as you type/)).toBeInTheDocument()

      await user.type(screen.getByLabelText(/^Title/), '!')
      await vi.advanceTimersByTimeAsync(2000)

      await waitFor(() => expect(apiFetch).toHaveBeenCalled())

      const body = JSON.parse(apiFetch.mock.calls[0][1].body)

      expect(body.title).toBe('Qawwali Under the Banyan!')

      for (const field of ['startsAt', 'endsAt', 'timezone', 'venueId', 'policies', 'isOnline']) {
        expect(body).not.toHaveProperty(field)
      }

      await user.click(screen.getByRole('button', { name: /when and where/i }))

      expect(screen.getByLabelText(/^Starts/, { selector: '#event-startsAt' })).toBeDisabled()
      expect(screen.getByLabelText(/^Venue/, { selector: '#event-venueId' })).toBeDisabled()
      expect(
        screen.getByText(/so its date, place and terms stay as ticket holders were told them\./),
      ).toBeInTheDocument()
    },
  )
})

describe('after a lifecycle command on the review step', () => {
  /**
   * Answer each request the editor and its review panel make for what it is.
   *
   * @param {Record<string, object>} answers Answers by path suffix; the first match wins.
   * @returns {void}
   */
  function routeFetch(answers) {
    apiFetch.mockImplementation(async (path) => {
      for (const [suffix, response] of Object.entries(answers)) {
        if (path.endsWith(suffix)) return response
      }

      return answer(500, { error: { message: `No answer set up for ${path}.` } })
    })
  }

  const readinessFor = (status) => ({
    ready: true,
    status,
    publishable: [],
    sellable: [],
    inventory: [],
    organizerVerified: true,
  })

  it('unlocks the fields after a rejected event is reworked as a draft', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const rejected = { ...event, status: 'REJECTED' }
    const moves = {
      status: 'REJECTED',
      transitions: [{ to: 'DRAFT', actor: 'organizer', entitled: true, blockers: [] }],
    }

    routeFetch({
      '/readiness': answer(200, { data: readinessFor('REJECTED') }),
      '/transitions': answer(200, { data: moves }),
      '/rework': answer(200, { data: { ...rejected, status: 'DRAFT', revision: 4 } }),
    })

    render(
      <EventEditor
        event={rejected}
        venues={venues}
        readiness={readinessFor('REJECTED')}
        transitions={moves}
      />,
    )

    expect(screen.getByLabelText(/^Title/)).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    await user.click(screen.getByRole('button', { name: 'Rework as a draft' }))
    await user.click(screen.getByRole('button', { name: /^Yes, rework as a draft/i }))

    await waitFor(() => expect(screen.getByText('Revision 4')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /step 1/i }))

    expect(screen.getByLabelText(/^Title/)).toBeEnabled()
    expect(screen.queryByText(/not open for editing/i)).not.toBeInTheDocument()
  })

  it('saves the next edit after a reschedule with the revision the reschedule returned', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const postponed = { ...event, status: 'POSTPONED', timezone: 'America/New_York' }
    const night = {
      id: 'snight1',
      timezone: 'America/New_York',
      startsAt: postponed.startsAt,
      endsAt: postponed.endsAt,
    }
    const week = 7 * 24 * 60 * 60 * 1000
    const later = (instant) => new Date(new Date(instant).getTime() + week).toISOString()
    const back = {
      ...postponed,
      status: 'PUBLISHED',
      revision: 4,
      startsAt: later(postponed.startsAt),
      endsAt: later(postponed.endsAt),
    }
    const moves = {
      status: 'POSTPONED',
      transitions: [{ to: 'PUBLISHED', actor: 'organizer', entitled: true, blockers: [] }],
    }

    routeFetch({
      '/readiness': answer(200, { data: readinessFor('POSTPONED') }),
      '/transitions': answer(200, { data: moves }),
      '/reschedule': answer(200, { data: back }),
      '/sessions': answer(200, {
        data: [{ ...night, startsAt: back.startsAt, endsAt: back.endsAt }],
        meta: { revision: 4 },
      }),
      [`/v1/events/${event.id}`]: answer(200, {
        data: { ...back, title: 'Qawwali Under the Banyan!', revision: 5 },
      }),
    })

    render(
      <EventEditor
        event={postponed}
        venues={venues}
        sessions={[night]}
        readiness={readinessFor('POSTPONED')}
        transitions={moves}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    await user.click(screen.getByRole('button', { name: 'Set a new date and bring it back' }))
    await user.type(
      screen.getByLabelText(/^Why, for the people holding tickets/),
      'The venue is ready again.',
    )
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes the date/ }))
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(screen.getByText('Revision 4')).toBeInTheDocument())
    expect(
      JSON.parse(apiFetch.mock.calls.find(([path]) => path.endsWith('/reschedule'))[1].body),
    ).toMatchObject({ revision: 3 })

    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    )

    const [, patch] = apiFetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
    const body = JSON.parse(patch.body)

    expect(body.revision).toBe(4)
    expect(body.title).toBe('Qawwali Under the Banyan!')
    // A public event's autosave carries no date; the new one is not undone.
    expect(body).not.toHaveProperty('startsAt')
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent(/Saved at/))
    expect(screen.queryByText(/Somebody else changed this event/)).not.toBeInTheDocument()

    // The sessions step shows the nights where they went.
    expect(apiFetch.mock.calls.some(([path]) => path.endsWith('/sessions'))).toBe(true)
  })
})

describe('the tickets step after a session goes', () => {
  it('re-reads the ticket types, so ones removed with the session are not offered', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const night = {
      id: 'snight1',
      timezone: 'Asia/Kolkata',
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: 100,
      usage: { sold: 0, held: 0 },
      removable: true,
      priceZones: [],
    }
    const onNight = {
      id: 'ctieronnight1',
      name: 'Night one pass',
      priceCents: 3500,
      currency: 'USD',
      quantityTotal: 10,
      status: 'DRAFT',
      eventSessionId: night.id,
      visibility: 'PUBLIC',
      removable: true,
      heldQuantity: 0,
      hasOrders: false,
    }

    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === 'DELETE') return answer(200, { ok: true, meta: { revision: 4 } })
      if (path.endsWith('/sessions')) return answer(200, { data: [], meta: { revision: 4 } })
      if (path.endsWith('/tiers')) return answer(200, { data: [], meta: { revision: 4 } })
      if (path.endsWith('/price-preview')) return answer(200, { data: [] })

      return answer(500, { error: { message: `No answer set up for ${path}.` } })
    })

    render(<EventEditor event={event} venues={venues} sessions={[night]} tiers={[onNight]} />)

    await user.click(screen.getByRole('button', { name: /step 4/i }))
    expect(screen.getByText('Night one pass')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 3/i }))
    await user.click(screen.getByRole('button', { name: /^Remove/ }))
    await user.click(screen.getByRole('button', { name: /^(Yes, )?remove/i }))

    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([path]) => path.endsWith('/tiers'))).toBe(true),
    )

    await user.click(screen.getByRole('button', { name: /step 4/i }))

    await waitFor(() => expect(screen.queryByText('Night one pass')).not.toBeInTheDocument())
  })
})

describe('a public event', () => {
  const live = { ...event, status: 'ON_SALE' }

  it('is not called closed for editing, and says how its date, place and terms change', () => {
    render(<EventEditor event={live} venues={venues} />)

    expect(screen.queryByText(/not open for editing/i)).not.toBeInTheDocument()
    expect(screen.getByText(/This event is public/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Title/)).toBeEnabled()
  })

  it('autosaves its housekeeping only, never a material field', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...live, revision: 4 } }))

    render(<EventEditor event={live} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const body = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(body.title).toBe('Qawwali Under the Banyan!')
    expect(body.revision).toBe(3)

    for (const field of [
      'startsAt',
      'endsAt',
      'timezone',
      'venueId',
      'policies',
      'ageRestriction',
      'isOnline',
      'onlineUrl',
      'confirmMaterialChange',
    ]) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it('takes the date and place in the steps, and a change to one asks to be confirmed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={live}
        venues={[...venues, { id: 'vnhall', name: 'Lamplight Hall', city: 'Pune' }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    const starts = screen.getByLabelText(/^Starts/, { selector: '#event-startsAt' })
    const venue = screen.getByLabelText(/^Venue/, { selector: '#event-venueId' })

    expect(starts).toBeEnabled()
    expect(venue).toBeEnabled()
    expect(
      screen.getByLabelText(/^Parking and directions/, { selector: '#event-directions' }),
    ).toBeEnabled()

    await user.selectOptions(venue, 'vnhall')

    const callout = screen.getByTestId('pending-material')

    expect(callout).toHaveTextContent('You changed the venue.')

    // A change waiting for its reason is never autosaved.
    await vi.advanceTimersByTimeAsync(5000)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(within(callout).getByRole('button', { name: 'Confirm these changes…' }))

    const heading = screen.getByRole('heading', {
      name: 'Confirm the change to the date, place or terms',
    })

    expect(heading).toHaveFocus()
    expect(screen.getByText(/Banyan Courtyard, Mumbai → Lamplight Hall, Pune/)).toBeInTheDocument()
  })

  it('puts the date, place and terms back when the change is not wanted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /policies and access/i }))
    await user.type(
      screen.getByLabelText(/^Minimum age/, { selector: '#event-ageRestriction' }),
      '18',
    )
    await user.click(screen.getByRole('button', { name: 'Put them back' }))

    expect(screen.queryByTestId('pending-material')).not.toBeInTheDocument()
    expect(
      screen.getByLabelText(/^Minimum age/, { selector: '#event-ageRestriction' }),
    ).toHaveValue(null)
  })

  it('sends a material change with the revision, only the changed field, a reason and the tick', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...live, revision: 4, ageRestriction: 18 } }))

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /policies and access/i }))

    await user.type(
      screen.getByLabelText(/^Minimum age/, { selector: '#event-ageRestriction' }),
      '18',
    )

    expect(screen.getByTestId('pending-material')).toHaveTextContent(
      'You changed the age restriction.',
    )

    await user.click(screen.getByRole('button', { name: 'Confirm these changes…' }))

    expect(screen.getByText(/no minimum age → 18\+/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm and save' }))

    expect(await screen.findAllByText('Say why this is changing.')).not.toHaveLength(0)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^Why this is changing/), 'The venue licence changed.')
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm and save' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      ageRestriction: 18,
      revision: 3,
      confirmMaterialChange: true,
      changeReason: 'The venue licence changed.',
    })
    expect(
      await screen.findByText(/A notice has been recorded for every current order/),
    ).toBeInTheDocument()
    expect(screen.getByText('Revision 4')).toBeInTheDocument()
  })

  it('says what the policies step promises without claiming anybody was emailed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /policies and access/i }))

    expect(screen.getByText(/a notice is recorded for every current order/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Notices are not emailed, so tell ticket holders yourself as well\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/is sent to everybody/i)).not.toBeInTheDocument()
  })
})

describe('editing as the team at The Desi Events', () => {
  const live = { ...event, status: 'ON_SALE' }
  const authority = {
    kind: 'platform',
    editId: 'cedit00000000000000000001',
    reason: 'The organiser asked us to fix the description',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }
  const readiness = {
    ready: true,
    status: 'ON_SALE',
    publishable: [],
    sellable: [],
    inventory: [],
    organizerVerified: true,
  }

  it('says whose authority and why, and offers no lifecycle move on the review step', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={live}
        venues={venues}
        authority={authority}
        readiness={readiness}
        transitions={{ status: 'ON_SALE', transitions: [{ to: 'SALES_PAUSED' }] }}
        mayDelete
        listHref="/admin/events"
      />,
    )

    expect(screen.getByText('Editing as the team at The Desi Events')).toBeInTheDocument()
    expect(
      screen.getByText(/^Reason: The organiser asked us to fix the description\. Until/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /step 9/i }))

    expect(screen.queryByRole('heading', { name: /review and publish/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this event…' })).toBeInTheDocument()
  })

  it('stops the autosave when the second factor has lapsed, asks, and sends the same change again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let saves = 0

    apiFetch.mockImplementation(async (path) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      saves += 1

      return saves === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } })
        : answer(200, { data: { ...live, title: 'Qawwali Under the Banyan!', revision: 4 } })
    })

    render(<EventEditor event={live} venues={venues} authority={authority} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    expect(
      await screen.findByText(
        'Confirm it’s you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else’s event.',
        { selector: 'p.font-medium' },
      ),
    ).toBeInTheDocument()

    // Paused: nothing more is sent while the prompt waits.
    await vi.advanceTimersByTimeAsync(5000)
    expect(saves).toBe(1)

    await user.type(screen.getAllByLabelText(/Your password/).at(-1), 'correct horse')
    await user.click(screen.getAllByRole('button', { name: 'Confirm' }).at(-1))

    await waitFor(() => expect(saves).toBe(2))

    const resent = apiFetch.mock.calls.filter(([path]) => path === `/v1/events/${live.id}`)

    expect(JSON.parse(resent[1][1].body)).toMatchObject({
      title: 'Qawwali Under the Banyan!',
      revision: 3,
    })
    expect(await screen.findByText('Revision 4')).toBeInTheDocument()
  })

  it('says the session has ended when a save finds it closed, and stops taking input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'PLATFORM_EDIT_NOT_OPEN',
          message:
            'Open this event for editing as the team at The Desi Events in this browser first.',
        },
      }),
    )

    render(<EventEditor event={live} venues={venues} authority={authority} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    expect(
      await screen.findAllByText(
        /This editing session has ended\. Open it again to keep editing\./,
      ),
    ).not.toHaveLength(0)
    expect(screen.getByLabelText(/^Title/)).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Open it again' })).toBeInTheDocument()
  })

  it('never shows an organiser the second-factor prompt or the banner', () => {
    render(<EventEditor event={live} venues={venues} />)

    expect(screen.queryByText('Editing as the team at The Desi Events')).not.toBeInTheDocument()
  })

  it('takes input again once the page hands it the editing session opened again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'PLATFORM_EDIT_NOT_OPEN', message: 'Open it.' } }),
    )

    const { rerender } = render(<EventEditor event={live} venues={venues} authority={authority} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toBeDisabled())

    // "Open it again" refreshes the page, which keeps this component's state
    // and hands down the new session.
    apiFetch.mockResolvedValue(
      answer(200, { data: { ...live, title: 'Qawwali Under the Banyan!', revision: 4 } }),
    )
    rerender(
      <EventEditor
        event={live}
        venues={venues}
        authority={{
          ...authority,
          editId: 'cedit00000000000000000002',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }}
      />,
    )

    expect(screen.getByLabelText(/^Title/)).toBeEnabled()
    expect(screen.queryByText(/This editing session has ended/)).not.toBeInTheDocument()
    // What was typed before the session ended is still there, and saves now.
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Qawwali Under the Banyan!')
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText('Revision 4')).toBeInTheDocument()
  })

  it('keeps the autosave paused after “Not now” on the second factor, until the next edit', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let saves = 0

    apiFetch.mockImplementation(async () => {
      saves += 1

      return answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } })
    })

    render(<EventEditor event={live} venues={venues} authority={authority} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    expect(screen.getByTestId('save-status')).toHaveTextContent(
      'Not saved: confirm it’s you to save these changes.',
    )

    // Not asked again a moment later: nothing more is sent.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(saves).toBe(1)
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument()

    // The next edit is a fresh attempt, which asks again.
    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(saves).toBe(2))
    expect(await screen.findByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('offers to open the session again when a step’s own write finds it closed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'PLATFORM_EDIT_NOT_OPEN',
          message:
            'Open this event for editing as the team at The Desi Events in this browser first.',
        },
      }),
    )

    render(
      <EventEditor
        event={live}
        venues={venues}
        authority={authority}
        sessions={[
          {
            id: 'snight1',
            eventId: live.id,
            startsAt: live.startsAt,
            endsAt: live.endsAt,
            doorsOpenAt: null,
            timezone: live.timezone,
            venueMapVersionId: null,
            capacity: 100,
            priceZones: [],
            usage: { sold: 0, held: 0 },
            removable: true,
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 3/i }))
    await user.click(screen.getByRole('button', { name: 'Remove session 1' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }))

    expect(await screen.findByRole('heading', { name: 'Open it again' })).toBeInTheDocument()
  })
})

describe('under the organisation’s own authority', () => {
  const live = { ...event, status: 'ON_SALE' }

  it('reads a refusal for want of an editing session as a refusal, and keeps taking input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'PLATFORM_EDIT_NOT_OPEN',
          message:
            'Open this event for editing as the team at The Desi Events in this browser first.',
        },
      }),
    )

    render(<EventEditor event={live} venues={venues} authority={{ kind: 'organization' }} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveTextContent(
        /Not saved\. Open this event for editing as the team at The Desi Events/,
      ),
    )
    expect(screen.getByLabelText(/^Title/)).toBeEnabled()
    expect(screen.queryByText(/This editing session has ended/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open it again' })).not.toBeInTheDocument()
  })

  it('tells the organiser, at the top, that the team at The Desi Events has the event open and until when', () => {
    render(
      <EventEditor
        event={{ ...live, timezone: 'America/Chicago' }}
        venues={venues}
        platformEdits={[
          {
            id: 'cedit00000000000000000001',
            openedAt: '2026-10-06T18:40:00.000Z',
            expiresAt: '2026-10-06T19:40:00.000Z',
            closedAt: null,
            endedBy: null,
            open: true,
            mine: false,
            reason: 'Fixing the directions.',
            administratorName: null,
            changes: [],
          },
        ]}
      />,
    )

    const notice = screen.getByTestId('team-editing-notice')

    expect(notice).toHaveTextContent(
      'The Desi Events team is editing this event until 2:40 PM CDT.',
    )
    expect(notice).toHaveTextContent('Reason: Fixing the directions.')
    // Never who.
    expect(notice).not.toHaveTextContent(/administrator/i)
  })

  it('says nothing of the kind once the sessions of the team at The Desi Events are over', () => {
    render(
      <EventEditor
        event={live}
        venues={venues}
        platformEdits={[
          {
            id: 'cedit00000000000000000001',
            openedAt: '2026-10-05T15:00:00.000Z',
            expiresAt: '2026-10-05T16:00:00.000Z',
            closedAt: '2026-10-05T15:20:00.000Z',
            endedBy: 'CLOSED',
            open: false,
            mine: false,
            reason: 'Fixing the directions.',
            administratorName: null,
            changes: [],
          },
        ]}
      />,
    )

    expect(screen.queryByTestId('team-editing-notice')).not.toBeInTheDocument()
  })

  it('keeps “Change date, place or terms…” for the panel’s own form, while nothing waits to be confirmed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))
    await user.click(screen.getByRole('button', { name: 'Change date, place or terms…' }))

    const heading = screen.getByRole('heading', { name: 'Change date, place or terms' })

    expect(heading).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save the change' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByRole('heading', { name: 'Change date, place or terms' }),
    ).not.toBeInTheDocument()

    // A change made in the steps is confirmed from its own callout instead.
    await user.click(screen.getByRole('button', { name: /policies and access/i }))
    await user.type(
      screen.getByLabelText(/^Minimum age/, { selector: '#event-ageRestriction' }),
      '18',
    )

    expect(screen.getByTestId('pending-material')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change date, place or terms…' }),
    ).not.toBeInTheDocument()
  })

  it('offers no such button on a finished or cancelled event', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={{ ...event, status: 'COMPLETED' }} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    expect(
      screen.queryByRole('button', { name: 'Change date, place or terms…' }),
    ).not.toBeInTheDocument()
  })
})

describe('the danger zone', () => {
  it('is offered on the review step only when the server page says so', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { unmount } = render(<EventEditor event={event} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument()

    unmount()
    render(<EventEditor event={event} venues={venues} mayDelete />)

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
  })

  it('lists the changes of the team at The Desi Events on the review step, without naming anybody', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={{ ...event, status: 'ON_SALE' }}
        venues={venues}
        platformEdits={[
          {
            id: 'cedit00000000000000000001',
            openedAt: '2026-10-05T15:00:00.000Z',
            expiresAt: '2026-10-05T16:00:00.000Z',
            closedAt: '2026-10-05T15:20:00.000Z',
            endedBy: 'CLOSED',
            open: false,
            mine: false,
            reason: 'Fixing the directions.',
            administratorName: null,
            changes: [
              { action: 'event.updated', fields: ['directions'], at: '2026-10-05T15:05:00.000Z' },
            ],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 9/i }))

    expect(
      screen.getByRole('heading', { name: 'Changes made by the team at The Desi Events' }),
    ).toBeInTheDocument()
    expect(screen.getByText('By an administrator at The Desi Events.')).toBeInTheDocument()
  })
})

describe('the content steps', () => {
  it('sends the line-up as performers, and never the old comma list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, revision: 4 } }))

    render(<EventEditor event={event} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 7/i }))

    // The older event's names come in as rows.
    expect(screen.getByLabelText(/^Name/, { selector: '#event-performers-0-name' })).toHaveValue(
      'Nizami Bandhu',
    )

    await user.type(
      screen.getByLabelText(/^Role/, { selector: '#event-performers-0-role' }),
      'Qawwals',
    )
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const body = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(body.performers).toEqual([{ name: 'Nizami Bandhu', role: 'Qawwals', bio: null }])
    expect(body).not.toHaveProperty('artists')
  })

  it('refuses a half-filled question before sending, and the summary opens its step', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 8/i }))
    await user.click(screen.getByRole('button', { name: 'Add a question' }))
    await user.type(
      screen.getByLabelText(/^Question/, { selector: '#event-faq-0-question' }),
      'Parking?',
    )
    await vi.advanceTimersByTimeAsync(2000)

    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.click(screen.getByRole('link', { name: 'Answer question 1.' }))

    expect(screen.getByRole('heading', { name: 'Guest information', level: 2 })).toBeInTheDocument()
  })

  it('refuses an Instagram link that points somewhere else', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 8/i }))
    await user.type(
      screen.getByLabelText(/^Instagram/, { selector: '#event-social-instagram' }),
      'https://instagram.example/desi',
    )

    expect(screen.getAllByText(/That address is not on Instagram/).length).toBeGreaterThan(0)
  })
})

describe('the patches the editor builds', () => {
  const values = {
    title: 'A title',
    summary: 'A summary',
    description: 'A description',
    category: 'OTHER',
    slug: 'a-title',
    languages: 'Hindi',
    timezone: 'America/New_York',
    startsAt: '2026-11-01T14:30:00.000Z',
    endsAt: '2026-11-01T17:30:00.000Z',
    venueId: 'vnbanyancourtyard',
    isOnline: false,
    onlineUrl: '',
    ageRestriction: '',
    policyEntry: '',
    policyRefund: 'No refunds.',
    policyConduct: '',
    policyAgeNote: '',
    accessFeatures: [],
    accessNote: '',
    performers: [],
    runningOrder: [],
    faq: [],
    sponsors: [],
    socialLinks: {},
    dressCode: '',
    directions: 'Park at the school.',
    publicEmail: '',
    publicPhone: '',
  }

  it('drops every material field from a public event’s autosave, and keeps the rest', () => {
    const full = toPatch(values)
    const housekeeping = toHousekeepingPatch(values)

    expect(full).toHaveProperty('policies')
    expect(full).toHaveProperty('startsAt')
    expect(housekeeping).not.toHaveProperty('policies')
    expect(housekeeping).not.toHaveProperty('startsAt')
    expect(housekeeping).not.toHaveProperty('venueId')
    expect(housekeeping).toMatchObject({ title: 'A title', directions: 'Park at the school.' })
  })

  it('knows which step holds each field', () => {
    expect(stepOfField('slug')).toBe('details')
    expect(stepOfField('directions')).toBe('schedule')
    expect(stepOfField('dressCode')).toBe('policies')
    expect(stepOfField('runningOrder-2-time')).toBe('programme')
    expect(stepOfField('social-instagram')).toBe('guests')
    expect(stepOfField('publicEmail')).toBe('guests')
  })
})

describe('saying when it is live', () => {
  it('marks itself enhanced once hydrated, for anything that must wait for the steps to work', () => {
    const { container } = render(<EventEditor event={event} venues={venues} />)

    const live = container.querySelector('[data-enhanced="true"]')
    expect(live).not.toBeNull()
    expect(live.querySelector('nav[aria-label="Editor steps"]')).not.toBeNull()
  })
})

describe('the times an organiser types', () => {
  it('shows a Mumbai evening as a Mumbai evening', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={event} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    // 14:30 UTC is 20:00 in Kolkata. A box that showed 14:30, or the browser's
    // local time, would have somebody schedule a show for the wrong hour.
    expect(screen.getByLabelText(/^Starts/)).toHaveValue('2026-11-01T20:00')
    expect(screen.getByLabelText(/^Ends/)).toHaveValue('2026-11-01T23:00')

    // Both boxes say which zone they are in — once each, under start and end.
    expect(screen.getAllByText(/local time at the venue — Asia\/Kolkata/i)).toHaveLength(2)
  })

  it('names the zone as it stands on the day: EDT in October, EST in December', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <EventEditor
        event={{
          ...event,
          timezone: 'America/New_York',
          startsAt: '2026-10-17T23:30:00.000Z',
          endsAt: '2026-12-05T02:00:00.000Z',
        }}
        venues={venues}
      />,
    )

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    expect(screen.getByLabelText(/^Starts \(EDT\)/)).toHaveValue('2026-10-17T19:30')
    expect(screen.getByLabelText(/^Ends \(EST\)/)).toHaveValue('2026-12-04T21:00')
  })

  it('opens an event with no zone of its own in US Eastern, with the US zones first', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={{ ...event, timezone: undefined }} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    const zone = screen.getByLabelText(/^Time zone/)
    const offered = [...zone.querySelectorAll('option')].map((option) => option.value)

    expect(zone).toHaveValue('America/New_York')
    expect(offered.slice(0, 3)).toEqual(['America/New_York', 'America/Chicago', 'America/Denver'])
    expect(offered.indexOf('America/Los_Angeles')).toBeLessThan(offered.indexOf('Asia/Kolkata'))
  })
})

describe('the problems the form finds for itself', () => {
  const base = {
    title: 'A title',
    summary: 'A summary',
    description: 'A description',
    startsAt: '2026-11-01T14:30:00.000Z',
    endsAt: '2026-11-01T17:30:00.000Z',
    isOnline: false,
    onlineUrl: '',
    venueId: 'vnbanyancourtyard',
    ageRestriction: '',
    slug: 'a-title',
  }

  it('finds nothing wrong with a complete form', () => {
    expect(formProblems(base)).toEqual([])
  })

  it('asks for a web address, because the save would be refused without one', () => {
    expect(formProblems({ ...base, slug: ' ' })).toEqual([
      { field: 'slug', message: 'Give the event a web address.' },
    ])
    expect(formProblems({ ...base, slug: 'Diwali Mela!' })[0].field).toBe('slug')
  })

  it('refuses a description over 20,000 characters', () => {
    expect(formProblems({ ...base, description: 'x'.repeat(20_001) })).toEqual([
      { field: 'description', message: 'Keep the description to 20,000 characters.' },
    ])
  })

  it('includes the content steps’ problems', () => {
    expect(
      formProblems({ ...base, runningOrder: [{ time: 'late', title: 'Aarti', note: '' }] }),
    ).toEqual([{ field: 'runningOrder-0-time', message: 'Give slot 1 a time, such as 19:30.' }])
  })

  it('refuses an event that ends before it starts', () => {
    const problems = formProblems({ ...base, endsAt: '2026-11-01T10:00:00.000Z' })

    expect(problems).toEqual([
      { field: 'endsAt', message: 'The event has to end after it starts.' },
    ])
  })

  it('does not refuse a draft for being incomplete', () => {
    // A draft is allowed to be incomplete — being incomplete is what a draft
    // is. Blocking the save on a venue nobody has chosen yet means an organiser
    // cannot keep the sentence they have just typed, which is backwards.
    expect(formProblems({ ...base, venueId: '' })).toEqual([])
    expect(formProblems({ ...base, isOnline: true, venueId: '', onlineUrl: '' })).toEqual([])
  })

  it('refuses a fractional age', () => {
    expect(formProblems({ ...base, ageRestriction: '17.5' })).toEqual([
      { field: 'ageRestriction', message: 'An age restriction is a whole number.' },
    ])
  })

  it('accepts an empty age, which means no restriction', () => {
    expect(formProblems({ ...base, ageRestriction: '' })).toEqual([])
  })
})

describe('what the form knows is still missing', () => {
  const base = {
    title: 'A title',
    summary: 'A summary',
    description: 'A description',
    startsAt: '2026-11-01T14:30:00.000Z',
    endsAt: '2026-11-01T17:30:00.000Z',
    isOnline: false,
    onlineUrl: '',
    venueId: 'vnbanyancourtyard',
    ageRestriction: '',
  }

  it('finds nothing missing from a complete form', () => {
    expect(formGaps(base)).toEqual([])
  })

  it('notes a missing venue without standing in the way of saving', () => {
    expect(formGaps({ ...base, venueId: '' })).toEqual([
      {
        field: 'venueId',
        message: 'Choose a venue, or mark the event as online, before publishing.',
      },
    ])
  })

  it('notes a missing joining address for an online event', () => {
    expect(formGaps({ ...base, isOnline: true, venueId: '', onlineUrl: '' })).toEqual([
      {
        field: 'onlineUrl',
        message: 'An online event needs an address to join it at before it can be published.',
      },
    ])
  })
})

describe('the organiser’s website', () => {
  /** The switch, never decided. */
  const NEVER = Object.freeze({
    enabled: false,
    pending: false,
    decidedUrl: null,
    submittedAt: null,
    changedAt: null,
    reason: null,
    changedByName: null,
    websiteProblem: null,
  })

  /** The switch, on for the banyan address. */
  const ON = Object.freeze({
    ...NEVER,
    enabled: true,
    decidedUrl: 'https://banyan.example/',
    changedAt: '2026-09-30T10:00:00.000Z',
    reason: 'Checked: their own site.',
    changedByName: 'Anil Administrator',
  })

  /** The event as an insider reads it, with no address. */
  const insider = { ...event, websiteUrl: null, websiteRedirect: NEVER }

  /**
   * An event detail without the website keys, as an answer that does not carry them.
   *
   * @param {object} detail The event.
   * @returns {object} The event without `websiteUrl` and `websiteRedirect`.
   */
  function withoutWebsite(detail) {
    const { websiteUrl: _url, websiteRedirect: _switch, ...rest } = detail

    return rest
  }

  /**
   * The PATCH bodies sent so far.
   *
   * @returns {object[]} The parsed bodies.
   */
  function patches() {
    return apiFetch.mock.calls
      .filter(([, options]) => options?.method === 'PATCH')
      .map(([, options]) => JSON.parse(options.body))
  }

  it('saves https://www.Example.com once, takes the stored form back, and is not left dirty', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const waiting = { ...NEVER, pending: true, submittedAt: '2026-10-05T09:00:00.000Z' }

    apiFetch.mockResolvedValue(
      answer(200, {
        data: {
          ...insider,
          revision: 4,
          websiteUrl: 'https://www.example.com/',
          websiteRedirect: waiting,
        },
      }),
    )

    render(<EventEditor event={insider} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 8/i }))

    const box = screen.getByRole('textbox', { name: /^Your website/u })

    await user.type(box, 'https://www.Example.com')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent(/Saved at/))
    // Long enough for a second autosave, had the form been left dirty.
    await vi.advanceTimersByTimeAsync(5000)

    expect(patches()).toHaveLength(1)
    expect(patches()[0].websiteUrl).toBe('https://www.Example.com')

    // The switch is never the organiser's to send.
    for (const key of ['websiteRedirect', 'websiteRedirectEnabled', 'websiteDecidedUrl']) {
      expect(patches()[0]).not.toHaveProperty(key)
    }

    expect(box).toHaveValue('https://www.example.com/')
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument()
    // The status follows the answer: the address now waits for the team.
    expect(
      screen.getByRole('group', { name: 'Website link on your event page' }),
    ).toHaveTextContent(
      /Your address is on the list of website links for the team at The Desi Events to look at/u,
    )
  })

  it('keeps an address typed on after the save went, and saves it next', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let answered = null

    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          answered = resolve
        }),
    )

    render(<EventEditor event={insider} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 8/i }))

    const box = screen.getByRole('textbox', { name: /^Your website/u })

    await user.type(box, 'https://www.Example.com')
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(answered).not.toBeNull())

    // More typed while the first save is in flight.
    await user.type(box, '/tickets')
    answered(
      answer(200, {
        data: { ...insider, revision: 4, websiteUrl: 'https://www.example.com/' },
      }),
    )

    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent(/Saved at/))
    expect(box).toHaveValue('https://www.Example.com/tickets')
  })

  it('does not lose the address when a lifecycle answer leaves it out', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const postponed = {
      ...event,
      status: 'POSTPONED',
      timezone: 'America/New_York',
      websiteUrl: 'https://banyan.example/',
      websiteRedirect: ON,
    }
    const night = {
      id: 'snight1',
      timezone: 'America/New_York',
      startsAt: postponed.startsAt,
      endsAt: postponed.endsAt,
    }
    const week = 7 * 24 * 60 * 60 * 1000
    const later = (instant) => new Date(new Date(instant).getTime() + week).toISOString()
    const back = withoutWebsite({
      ...postponed,
      status: 'PUBLISHED',
      revision: 4,
      startsAt: later(postponed.startsAt),
      endsAt: later(postponed.endsAt),
    })
    const moves = {
      status: 'POSTPONED',
      transitions: [{ to: 'PUBLISHED', actor: 'organizer', entitled: true, blockers: [] }],
    }
    const readiness = {
      ready: true,
      status: 'POSTPONED',
      publishable: [],
      sellable: [],
      inventory: [],
      organizerVerified: true,
    }
    const answers = {
      '/readiness': answer(200, { data: readiness }),
      '/transitions': answer(200, { data: moves }),
      '/reschedule': answer(200, { data: back }),
      '/sessions': answer(200, {
        data: [{ ...night, startsAt: back.startsAt, endsAt: back.endsAt }],
        meta: { revision: 4 },
      }),
      [`/v1/events/${event.id}`]: answer(200, {
        data: { ...postponed, ...back, title: 'Qawwali Under the Banyan!', revision: 5 },
      }),
    }

    apiFetch.mockImplementation(async (path) => {
      for (const [suffix, response] of Object.entries(answers)) {
        if (path.endsWith(suffix)) return response
      }

      return answer(500, { error: { message: `No answer set up for ${path}.` } })
    })

    render(
      <EventEditor
        event={postponed}
        venues={venues}
        sessions={[night]}
        readiness={readiness}
        transitions={moves}
      />,
    )

    await user.click(screen.getByRole('button', { name: /step 9/i }))
    await user.click(screen.getByRole('button', { name: 'Set a new date and bring it back' }))
    await user.type(
      screen.getByLabelText(/^Why, for the people holding tickets/),
      'The venue is ready again.',
    )
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes the date/ }))
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(screen.getByText('Revision 4')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(patches()).toHaveLength(1))

    expect(patches()[0].title).toBe('Qawwali Under the Banyan!')
    // The address nobody touched is not sent, so it is never sent as null.
    expect(patches()[0]).not.toHaveProperty('websiteUrl')

    // The switch the reschedule did not mention is still the one shown.
    await user.click(screen.getByRole('button', { name: /step 8/i }))

    expect(screen.getByRole('textbox', { name: /^Your website/u })).toHaveValue(
      'https://banyan.example/',
    )
    expect(
      screen.getByRole('group', { name: 'Website link on your event page' }),
    ).toHaveTextContent(/^Website link on your event page.*On/u)
  })

  it('refuses an address that fails the rules before sending, and the summary opens its step', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const message =
      'Your website: Use an address that starts https://. Other kinds of link are not accepted.'

    render(<EventEditor event={insider} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /step 8/i }))
    await user.type(
      screen.getByRole('textbox', { name: /^Your website/u }),
      'http://banyan.example/',
    )
    await vi.advanceTimersByTimeAsync(2000)

    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /step 1/i }))
    await user.click(screen.getByRole('link', { name: message }))

    expect(screen.getByRole('heading', { name: 'Guest information', level: 2 })).toBeInTheDocument()
  })

  it('reads the address only from an answer that carries it, and sends it trimmed or as null', () => {
    const previous = toFormValues({ ...event, websiteUrl: 'https://banyan.example/' })

    expect(previous.websiteUrl).toBe('https://banyan.example/')
    expect(toFormValues(withoutWebsite(event), previous).websiteUrl).toBe('https://banyan.example/')
    expect(toFormValues({ ...event, websiteUrl: null }, previous).websiteUrl).toBe('')
    expect(toFormValues(withoutWebsite(event)).websiteUrl).toBe('')

    expect(toPatch({ ...previous, websiteUrl: '  https://banyan.example/  ' }).websiteUrl).toBe(
      'https://banyan.example/',
    )
    expect(toPatch({ ...previous, websiteUrl: '   ' }).websiteUrl).toBeNull()
    // Housekeeping: a public event autosaves it.
    expect(toHousekeepingPatch(previous).websiteUrl).toBe('https://banyan.example/')
    expect(stepOfField('websiteUrl')).toBe('guests')

    // Measured against what was last saved, it is sent only when it changed.
    expect(toPatch(previous, previous)).not.toHaveProperty('websiteUrl')
    expect(
      toPatch({ ...previous, websiteUrl: ' https://banyan.example/ ' }, previous),
    ).not.toHaveProperty('websiteUrl')
    expect(toHousekeepingPatch(previous, previous)).not.toHaveProperty('websiteUrl')
    expect(
      toHousekeepingPatch({ ...previous, websiteUrl: 'https://banyan.example/nights' }, previous)
        .websiteUrl,
    ).toBe('https://banyan.example/nights')
    expect(toPatch({ ...previous, websiteUrl: '' }, previous).websiteUrl).toBeNull()
  })

  it('finds a failing address with the server’s rule, and says nothing about an empty one', () => {
    const base = toFormValues(event)

    expect(formProblems({ ...base, websiteUrl: '' })).toEqual([])
    expect(formProblems({ ...base, websiteUrl: 'https://www.Example.com' })).toEqual([])
    expect(formProblems({ ...base, websiteUrl: 'https://banyan.example/?token=1' })).toEqual([
      {
        field: 'websiteUrl',
        message:
          'Your website: Take “token” out of the address. A public link never carries a password, key or code.',
      },
    ])

    // An address saved before today's rules is not sent, so it stops nothing;
    // a change to it is checked like any other.
    const legacy = { ...base, websiteUrl: 'https://banyan.example/?token=abc' }

    expect(formProblems(legacy, legacy)).toEqual([])
    expect(
      formProblems({ ...legacy, websiteUrl: 'https://banyan.example/?key=1' }, legacy),
    ).toEqual([expect.objectContaining({ field: 'websiteUrl' })])
  })

  it('saves other changes on an event whose stored address fails today’s rules', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const problem =
      'Take “token” out of the address. A public link never carries a password, key or code.'
    const legacy = {
      ...event,
      websiteUrl: 'https://banyan.example/?token=abc',
      websiteRedirect: {
        ...NEVER,
        pending: true,
        submittedAt: '2026-10-01T08:30:00.000Z',
        websiteProblem: problem,
      },
    }

    apiFetch.mockResolvedValue(
      answer(200, { data: { ...legacy, title: `${legacy.title}!`, revision: 4 } }),
    )

    render(<EventEditor event={legacy} venues={venues} />)

    await user.type(screen.getByLabelText(/^Title/), '!')
    await vi.advanceTimersByTimeAsync(5000)

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].title).toBe(`${legacy.title}!`)
    expect(patches()[0]).not.toHaveProperty('websiteUrl')
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent(/Saved at/))

    // The address stays as it was, and the status under it says what is wrong.
    await user.click(screen.getByRole('button', { name: /step 8/i }))

    expect(screen.getByRole('textbox', { name: /^Your website/u })).toHaveValue(
      'https://banyan.example/?token=abc',
    )
    expect(
      screen.getByRole('group', { name: 'Website link on your event page' }),
    ).toHaveTextContent(`Your address does not pass the address rules: ${problem}`)
  })
})
