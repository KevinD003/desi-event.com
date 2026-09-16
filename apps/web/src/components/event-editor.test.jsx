import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
// The review panel asks the router to refresh after a lifecycle command. There
// is no app router in a unit test, and there does not need to be: what is under
// test here is the editor shell, not navigation.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventEditor, formGaps, formProblems } = await import('./event-editor.jsx')

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
  coverImageUrl: null,
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

    expect(screen.getByTestId('save-status')).toHaveTextContent('No changes yet.')
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

  it('never autosaves one', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<EventEditor event={{ ...event, status: 'ON_SALE' }} venues={venues} />)

    await user.click(screen.getByRole('button', { name: /when and where/i }))
    await vi.advanceTimersByTimeAsync(5000)

    expect(apiFetch).not.toHaveBeenCalled()
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
  }

  it('finds nothing wrong with a complete form', () => {
    expect(formProblems(base)).toEqual([])
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
