import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
// The review panel asks the router to refresh after a lifecycle command. There
// is no app router in a unit test, and there does not need to be: what is under
// test here is the editor shell, not navigation.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventEditor, formGaps, formProblems, stepOfField, toHousekeepingPatch, toPatch } =
  await import('./event-editor.jsx')

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

  it.each(['REVIEW_PENDING', 'APPROVED', 'CANCELLED'])(
    'never autosaves one that is %s',
    async (status) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(<EventEditor event={{ ...event, status }} venues={venues} />)

      await user.click(screen.getByRole('button', { name: /when and where/i }))
      await vi.advanceTimersByTimeAsync(5000)

      expect(apiFetch).not.toHaveBeenCalled()
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

  it('keeps the date and place read-only, behind a button that opens the change panel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))

    expect(screen.getByLabelText(/^Starts/, { selector: '#event-startsAt' })).toBeDisabled()
    expect(screen.getByLabelText(/^Venue/, { selector: '#event-venueId' })).toBeDisabled()
    expect(
      screen.getByLabelText(/^Parking and directions/, { selector: '#event-directions' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Change date, place or terms…' }))

    const heading = screen.getByRole('heading', { name: 'Change date, place or terms' })

    expect(heading).toHaveFocus()
  })

  it('sends a material change with the revision, only the changed field, a reason and the tick', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    apiFetch.mockResolvedValue(answer(200, { data: { ...live, revision: 4, ageRestriction: 18 } }))

    render(<EventEditor event={live} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /policies and access/i }))
    await user.click(screen.getByRole('button', { name: 'Change date, place or terms…' }))

    await user.type(
      screen.getByLabelText(/^Minimum age/, { selector: '#material-ageRestriction' }),
      '18',
    )

    expect(screen.getByText('You are changing: the age restriction.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the change' }))

    expect(await screen.findAllByText('Say why this is changing.')).not.toHaveLength(0)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^Why this is changing/), 'The venue licence changed.')
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes/ }))
    await user.click(screen.getByRole('button', { name: 'Save the change' }))

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
    expect(screen.getByText(/This build does not send email/)).toBeInTheDocument()
    expect(screen.queryByText(/is sent to everybody/i)).not.toBeInTheDocument()
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
