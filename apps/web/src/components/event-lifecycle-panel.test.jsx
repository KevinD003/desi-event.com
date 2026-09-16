import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventLifecyclePanel } = await import('./event-lifecycle-panel.jsx')

const event = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  status: 'DRAFT',
}

/** A readiness result with nothing outstanding. */
const ready = {
  ready: true,
  status: 'DRAFT',
  publishable: [],
  sellable: [],
  inventory: [],
  organizerVerified: true,
}

/**
 * A transitions payload the server would send.
 *
 * @param {object[]} entries The moves.
 * @returns {object} The payload.
 */
function transitions(entries) {
  return { status: 'DRAFT', transitions: entries }
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
 * The call the panel made to one path, if it made one.
 *
 * Looked up rather than indexed: the panel re-reads readiness and transitions
 * whenever it opens, so the command is not the first request and asserting on
 * `calls[0]` would be asserting on the refresh.
 *
 * @param {string} path The path to find.
 * @returns {Array|null} The call arguments, or null.
 */
function callTo(path) {
  return apiFetch.mock.calls.find(([called]) => called === path) ?? null
}

/**
 * Answer each request the panel makes for what it is.
 *
 * The panel re-reads readiness and transitions whenever it opens, so a single
 * `mockResolvedValue` hands the *command's* answer back as the transitions
 * answer too — and a transitions payload saying the event is already
 * REVIEW_PENDING makes the panel redraw with the buttons for that state, which
 * is correct behaviour and a useless test.
 *
 * @param {object} [options] What to answer with.
 * @param {object} [options.readiness] The readiness payload.
 * @param {object} [options.moves] The transitions payload.
 * @param {object} [options.command] The answer to the command itself.
 * @returns {void}
 */
function routeFetch({ readiness = ready, moves = transitions([]), command = null } = {}) {
  apiFetch.mockImplementation(async (path) => {
    if (path.endsWith('/readiness')) return answer(200, { data: readiness })
    if (path.endsWith('/transitions')) return answer(200, { data: moves })

    return command ?? answer(500, { error: { message: 'No command answer was set up.' } })
  })
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('the readiness checklist', () => {
  it('says ready or not in words, not only in colour', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={ready}
        transitions={transitions([])}
        history={[]}
      />,
    )

    expect(screen.getAllByText('Ready')).toHaveLength(4)
  })

  it('lists every blocker rather than the first', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={{
          ...ready,
          ready: false,
          publishable: ['The event needs a venue.', 'The event needs at least one session.'],
          sellable: ['The event needs at least one ticket type on sale.'],
        }}
        transitions={transitions([])}
        history={[]}
      />,
    )

    expect(screen.getByText('The event needs a venue.')).toBeInTheDocument()
    expect(screen.getByText('The event needs at least one session.')).toBeInTheDocument()
    expect(
      screen.getByText('The event needs at least one ticket type on sale.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Not yet')).toHaveLength(2)
  })

  it('says when the organisation is what is holding it up', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={{ ...ready, ready: false, organizerVerified: false }}
        transitions={transitions([])}
        history={[]}
      />,
    )

    expect(screen.getByText(/has not verified this organisation/i)).toBeInTheDocument()
  })
})

describe('the difference between "you may not" and "not yet"', () => {
  it('says somebody else has to do it when the actor is not entitled', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={ready}
        transitions={transitions([
          { to: 'REVIEW_PENDING', actor: 'organizer', entitled: false, blockers: [] },
        ])}
        history={[]}
      />,
    )

    expect(screen.getByRole('button', { name: /send for review/i })).toBeDisabled()
    expect(screen.getByText(/somebody with more permission/i)).toBeInTheDocument()
  })

  it('says what is missing when the actor is entitled but the event is not ready', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={ready}
        transitions={transitions([
          {
            to: 'REVIEW_PENDING',
            actor: 'organizer',
            entitled: true,
            blockers: ['The event needs a venue.'],
          },
        ])}
        history={[]}
      />,
    )

    expect(screen.getByRole('button', { name: /send for review/i })).toBeDisabled()
    expect(screen.queryByText(/somebody with more permission/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('The event needs a venue.').length).toBeGreaterThan(0)
  })
})

describe('sending an event for review', () => {
  it('asks for an optional note, then sends it', async () => {
    const user = userEvent.setup()

    const moves = transitions([
      { to: 'REVIEW_PENDING', actor: 'organizer', entitled: true, blockers: [] },
    ])

    routeFetch({ moves, command: answer(200, { data: { status: 'REVIEW_PENDING' } }) })

    render(<EventLifecyclePanel event={event} readiness={ready} transitions={moves} history={[]} />)

    await user.click(screen.getByRole('button', { name: /send for review/i }))
    await user.click(screen.getByRole('button', { name: /yes, send for review/i }))

    await waitFor(() => expect(callTo('/v1/events/evtqawwalibanyan/submit-review')).toBeTruthy())

    const [, options] = callTo('/v1/events/evtqawwalibanyan/submit-review')

    expect(options.method).toBe('POST')
  })

  it('announces the new state rather than only drawing it', async () => {
    const user = userEvent.setup()

    const moves = transitions([
      { to: 'REVIEW_PENDING', actor: 'organizer', entitled: true, blockers: [] },
    ])

    routeFetch({ moves, command: answer(200, { data: { status: 'REVIEW_PENDING' } }) })

    render(<EventLifecyclePanel event={event} readiness={ready} transitions={moves} history={[]} />)

    await user.click(screen.getByRole('button', { name: /send for review/i }))
    await user.click(screen.getByRole('button', { name: /yes, send for review/i }))

    await waitFor(() =>
      expect(screen.getByText(/Waiting for review\. A moderator has it/)).toBeInTheDocument(),
    )
  })

  it('puts focus back where it was when the confirmation is dismissed', async () => {
    const user = userEvent.setup()

    render(
      <EventLifecyclePanel
        event={event}
        readiness={ready}
        transitions={transitions([
          { to: 'REVIEW_PENDING', actor: 'organizer', entitled: true, blockers: [] },
        ])}
        history={[]}
      />,
    )

    const trigger = screen.getByRole('button', { name: /send for review/i })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: /not now/i }))

    // Focus does not evaporate when a dialogue closes. A keyboard user who has
    // to go hunting for where they were has been dropped.
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('cancelling an event', () => {
  const onSale = { ...event, status: 'ON_SALE' }

  it('asks for a reason code and a note, and will not send without the note', async () => {
    const user = userEvent.setup()

    render(
      <EventLifecyclePanel
        event={onSale}
        readiness={{ ...ready, status: 'ON_SALE' }}
        transitions={{
          status: 'ON_SALE',
          transitions: [{ to: 'CANCELLED', actor: 'organizer', entitled: true, blockers: [] }],
        }}
        history={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel this event/i }))

    expect(screen.getByLabelText(/^Reason/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yes, cancel this event/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/what to tell ticket holders/i), 'The artist is unwell.')

    expect(screen.getByRole('button', { name: /yes, cancel this event/i })).toBeEnabled()
  })

  it('says a refund is requested, not paid', async () => {
    const user = userEvent.setup()

    render(
      <EventLifecyclePanel
        event={onSale}
        readiness={{ ...ready, status: 'ON_SALE' }}
        transitions={{
          status: 'ON_SALE',
          transitions: [{ to: 'CANCELLED', actor: 'organizer', entitled: true, blockers: [] }],
        }}
        history={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel this event/i }))

    // No refund service exists. A screen that said "refunded" would be a lie
    // the attendee discovers before the organiser does.
    expect(screen.getByText(/no money moves/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is sent to a payment provider/i)).toBeInTheDocument()
  })

  it('sends the reason code with the command', async () => {
    const user = userEvent.setup()

    const moves = {
      status: 'ON_SALE',
      transitions: [{ to: 'CANCELLED', actor: 'organizer', entitled: true, blockers: [] }],
    }

    routeFetch({
      readiness: { ...ready, status: 'ON_SALE' },
      moves,
      command: answer(200, { data: { status: 'CANCELLED' } }),
    })

    render(
      <EventLifecyclePanel
        event={onSale}
        readiness={{ ...ready, status: 'ON_SALE' }}
        transitions={moves}
        history={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel this event/i }))
    await user.selectOptions(screen.getByLabelText(/^Reason/), 'WEATHER')
    await user.type(screen.getByLabelText(/what to tell ticket holders/i), 'The ground flooded.')
    await user.click(screen.getByRole('button', { name: /yes, cancel this event/i }))

    await waitFor(() => expect(callTo('/v1/events/evtqawwalibanyan/cancel')).toBeTruthy())

    const [, options] = callTo('/v1/events/evtqawwalibanyan/cancel')

    expect(JSON.parse(options.body)).toEqual({
      reason: 'The ground flooded.',
      reasonCode: 'WEATHER',
    })
  })

  it("shows the API's refusal rather than a shrug", async () => {
    const user = userEvent.setup()

    const moves = {
      status: 'ON_SALE',
      transitions: [{ to: 'CANCELLED', actor: 'organizer', entitled: true, blockers: [] }],
    }

    routeFetch({
      readiness: { ...ready, status: 'ON_SALE' },
      moves,
      command: answer(422, {
        error: { message: 'This event is not ready.', problems: ['Confirm your identity first.'] },
      }),
    })

    render(
      <EventLifecyclePanel
        event={onSale}
        readiness={{ ...ready, status: 'ON_SALE' }}
        transitions={moves}
        history={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel this event/i }))
    await user.type(screen.getByLabelText(/what to tell ticket holders/i), 'Flooded.')
    await user.click(screen.getByRole('button', { name: /yes, cancel this event/i }))

    await waitFor(() => expect(screen.getByText('This event is not ready.')).toBeInTheDocument())
    expect(screen.getByText('Confirm your identity first.')).toBeInTheDocument()
  })
})

describe('pausing sales', () => {
  it('does not demand a confirmation, because resuming is one press away', async () => {
    const user = userEvent.setup()

    render(
      <EventLifecyclePanel
        event={{ ...event, status: 'ON_SALE' }}
        readiness={{ ...ready, status: 'ON_SALE' }}
        transitions={{
          status: 'ON_SALE',
          transitions: [{ to: 'SALES_PAUSED', actor: 'organizer', entitled: true, blockers: [] }],
        }}
        history={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /pause sales/i }))

    // It offers a note, because a note is useful. It does not ask "are you
    // sure", because a confirmation on everything trains people to dismiss them.
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument()
  })
})

describe('what a moderator asked for', () => {
  it('shows the reason and the specific changes', () => {
    render(
      <EventLifecyclePanel
        event={{ ...event, status: 'CHANGES_REQUIRED' }}
        readiness={{ ...ready, status: 'CHANGES_REQUIRED' }}
        transitions={transitions([])}
        history={[
          {
            id: 'ema1',
            fromStatus: 'REVIEW_PENDING',
            toStatus: 'CHANGES_REQUIRED',
            reason: 'The description does not say the show is in Gujarati.',
            requestedChanges: { description: 'Name the language.' },
            actorId: null,
            createdAt: '2026-09-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    // Twice: once in the banner that says what to do, once in the history that
    // says what happened. Both are the point.
    expect(screen.getAllByText(/does not say the show is in gujarati/i)).toHaveLength(2)
    expect(screen.getByText(/name the language/i)).toBeInTheDocument()
  })

  it('shows a rejection as a rejection', () => {
    render(
      <EventLifecyclePanel
        event={{ ...event, status: 'REJECTED' }}
        readiness={{ ...ready, status: 'REJECTED' }}
        transitions={transitions([])}
        history={[
          {
            id: 'ema2',
            fromStatus: 'REVIEW_PENDING',
            toStatus: 'REJECTED',
            reason: 'This is a ticket resale, which the platform does not list.',
            requestedChanges: null,
            actorId: null,
            createdAt: '2026-09-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByText(/a moderator rejected this event/i)).toBeInTheDocument()
    expect(screen.getAllByText(/ticket resale/i)).toHaveLength(2)
  })

  it('never names the moderator', () => {
    const { container } = render(
      <EventLifecyclePanel
        event={{ ...event, status: 'CHANGES_REQUIRED' }}
        readiness={{ ...ready, status: 'CHANGES_REQUIRED' }}
        transitions={transitions([])}
        history={[
          {
            id: 'ema1',
            fromStatus: 'REVIEW_PENDING',
            toStatus: 'CHANGES_REQUIRED',
            reason: 'Name the language.',
            requestedChanges: null,
            actorId: 'usmoderatorsecret',
            createdAt: '2026-09-01T10:00:00.000Z',
          },
        ]}
      />,
    )

    // The payload carries an actor id because the audit trail needs one. The
    // organiser is negotiating with the platform, not with a named person.
    expect(container.innerHTML).not.toMatch(/usmoderatorsecret/)
  })
})

describe('the preview link', () => {
  it('points at the public page and says what it shows', () => {
    render(
      <EventLifecyclePanel
        event={event}
        readiness={ready}
        transitions={transitions([])}
        history={[]}
      />,
    )

    expect(screen.getByRole('link', { name: /preview the public page/i })).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan',
    )
    expect(screen.getByText(/only your team can load it/i)).toBeInTheDocument()
  })
})
