import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventRescheduleForm, shiftInstant, shiftSessions } =
  await import('./event-reschedule-form.jsx')

/** A postponed event: 7 PM to 11 PM in New York, on 4 October 2027. */
const event = {
  id: 'evtpostponed',
  status: 'POSTPONED',
  timezone: 'America/New_York',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
}

const sessions = [
  {
    id: 'snight1',
    timezone: 'America/New_York',
    startsAt: '2027-10-04T23:00:00.000Z',
    endsAt: '2027-10-05T03:00:00.000Z',
    doorsOpenAt: '2027-10-04T22:00:00.000Z',
  },
  {
    id: 'snight2',
    timezone: 'America/New_York',
    startsAt: '2027-10-05T23:00:00.000Z',
    endsAt: '2027-10-06T03:00:00.000Z',
    doorsOpenAt: null,
  },
]

/** The same nights, each with its own sales window closing an hour before it. */
const windowed = [
  {
    id: 'snight1',
    timezone: 'America/New_York',
    startsAt: '2027-10-04T23:00:00.000Z',
    endsAt: '2027-10-05T03:00:00.000Z',
    doorsOpenAt: null,
    salesStartAt: '2027-09-01T13:00:00.000Z',
    salesEndAt: '2027-10-04T22:00:00.000Z',
  },
  {
    id: 'snight2',
    timezone: 'America/New_York',
    startsAt: '2027-10-05T23:00:00.000Z',
    endsAt: '2027-10-06T03:00:00.000Z',
    doorsOpenAt: null,
    salesStartAt: null,
    salesEndAt: '2027-10-05T22:00:00.000Z',
  },
]

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

/**
 * Type the reason and tick the box.
 *
 * @param {object} user The user-event instance.
 * @returns {Promise<void>} Resolves when done.
 */
async function explainAndConfirm(user) {
  await user.type(screen.getByLabelText(/^Why, for the people holding tickets/), 'Monsoon.')
  await user.click(screen.getByRole('checkbox', { name: /I understand this changes the date/ }))
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('moving instants', () => {
  it('shifts an instant and every session by the same amount, leaving an empty door time empty', () => {
    const week = 7 * 24 * 60 * 60 * 1000

    expect(shiftInstant('2027-10-04T23:00:00.000Z', week)).toBe('2027-10-11T23:00:00.000Z')
    expect(shiftInstant(null, week)).toBeNull()
    expect(shiftSessions(sessions, week)).toEqual([
      {
        id: 'snight1',
        startsAt: '2027-10-11T23:00:00.000Z',
        endsAt: '2027-10-12T03:00:00.000Z',
        doorsOpenAt: '2027-10-11T22:00:00.000Z',
        salesStartAt: null,
        salesEndAt: null,
      },
      {
        id: 'snight2',
        startsAt: '2027-10-12T23:00:00.000Z',
        endsAt: '2027-10-13T03:00:00.000Z',
        doorsOpenAt: null,
        salesStartAt: null,
        salesEndAt: null,
      },
    ])
  })

  it('moves a night’s own sales window with it, so sales do not close at the old date', () => {
    const week = 7 * 24 * 60 * 60 * 1000

    expect(shiftSessions(windowed, week)).toEqual([
      {
        id: 'snight1',
        startsAt: '2027-10-11T23:00:00.000Z',
        endsAt: '2027-10-12T03:00:00.000Z',
        doorsOpenAt: null,
        salesStartAt: '2027-09-08T13:00:00.000Z',
        salesEndAt: '2027-10-11T22:00:00.000Z',
      },
      {
        id: 'snight2',
        startsAt: '2027-10-12T23:00:00.000Z',
        endsAt: '2027-10-13T03:00:00.000Z',
        doorsOpenAt: null,
        salesStartAt: null,
        salesEndAt: '2027-10-12T22:00:00.000Z',
      },
    ])
  })
})

describe('bringing a postponed event back', () => {
  it('says each ticket type’s own sales window moves too, and with what', () => {
    render(<EventRescheduleForm event={event} sessions={sessions} revision={12} onDone={vi.fn()} />)

    expect(
      screen.getByText(
        'Each ticket type’s own sales window moves too, by the same amount as what it is sold for: a ticket for one session with that session, a ticket for every session with the event’s start.',
      ),
    ).toBeInTheDocument()
  })

  it('says notices are recorded and not emailed, without claiming the site sends no email', () => {
    const { container } = render(
      <EventRescheduleForm event={event} sessions={sessions} revision={12} onDone={vi.fn()} />,
    )

    expect(
      screen.getByText(/Notices are not emailed, so tell ticket holders yourself as well\./),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/does not send email|sends no email/i)
  })

  it('moves the end and every session with the start, and sends one command with the revision', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, status: 'PUBLISHED' } }))
    render(<EventRescheduleForm event={event} sessions={sessions} revision={12} onDone={onDone} />)

    // A week later, same time.
    fireEvent.change(screen.getByLabelText(/^New start/), {
      target: { value: '2027-10-11T19:00' },
    })

    expect(screen.getByLabelText(/^New end/)).toHaveValue('2027-10-11T23:00')
    expect(screen.getByLabelText(/^Session 2 starts/)).toHaveValue('2027-10-12T19:00')
    expect(screen.getByRole('button', { name: 'Bring it back' })).toBeDisabled()

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/events/evtpostponed/reschedule')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      revision: 12,
      startsAt: '2027-10-11T23:00:00.000Z',
      endsAt: '2027-10-12T03:00:00.000Z',
      sessions: [
        {
          id: 'snight1',
          startsAt: '2027-10-11T23:00:00.000Z',
          endsAt: '2027-10-12T03:00:00.000Z',
          doorsOpenAt: '2027-10-11T22:00:00.000Z',
        },
        { id: 'snight2', startsAt: '2027-10-12T23:00:00.000Z', endsAt: '2027-10-13T03:00:00.000Z' },
      ],
      resume: 'PUBLISHED',
      confirm: true,
      reason: 'Monsoon.',
    })
  })

  it('sends each night’s sales window moved by the same amount as its dates', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, status: 'PUBLISHED' } }))
    render(<EventRescheduleForm event={event} sessions={windowed} revision={12} onDone={onDone} />)

    fireEvent.change(screen.getByLabelText(/^New start/), {
      target: { value: '2027-10-11T19:00' },
    })

    // Shown with the night, moved with it, and not editable while it moves
    // with the event.
    expect(screen.getByLabelText(/^Session 1 sales close/)).toHaveValue('2027-10-11T18:00')
    expect(screen.getByLabelText(/^Session 1 sales close/)).toBeDisabled()

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body).sessions).toEqual([
      {
        id: 'snight1',
        startsAt: '2027-10-11T23:00:00.000Z',
        endsAt: '2027-10-12T03:00:00.000Z',
        salesStartAt: '2027-09-08T13:00:00.000Z',
        salesEndAt: '2027-10-11T22:00:00.000Z',
      },
      {
        id: 'snight2',
        startsAt: '2027-10-12T23:00:00.000Z',
        endsAt: '2027-10-13T03:00:00.000Z',
        salesEndAt: '2027-10-12T22:00:00.000Z',
      },
    ])
  })

  it('lets a night set on its own have its sales window set on its own too', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, status: 'PUBLISHED' } }))
    render(<EventRescheduleForm event={event} sessions={windowed} revision={12} onDone={onDone} />)

    fireEvent.change(screen.getByLabelText(/^New start/), {
      target: { value: '2027-10-11T19:00' },
    })
    await user.click(
      screen.getByRole('checkbox', { name: /Move every session by the same amount/ }),
    )

    const close = screen.getByLabelText(/^Session 2 sales close/)

    expect(close).toBeEnabled()
    fireEvent.change(close, { target: { value: '2027-10-12T12:00' } })
    // A night with no opening time is not given a box for one.
    expect(screen.queryByLabelText(/^Session 2 sales open/)).toBeNull()

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body).sessions[1]).toEqual({
      id: 'snight2',
      startsAt: '2027-10-12T23:00:00.000Z',
      endsAt: '2027-10-13T03:00:00.000Z',
      salesEndAt: '2027-10-12T16:00:00.000Z',
    })
  })

  it('offers "on sale" only when the server says sales can reopen, and says why not', () => {
    render(
      <EventRescheduleForm
        event={event}
        sessions={sessions}
        revision={1}
        onSale={{
          to: 'ON_SALE',
          actor: 'organizer',
          entitled: true,
          blockers: ['Ticket type "Stalls" has no seats.'],
        }}
      />,
    )

    expect(screen.getByRole('radio', { name: /On sale straight away/ })).toBeDisabled()
    expect(screen.getByText('Ticket type "Stalls" has no seats.')).toBeInTheDocument()
  })

  it('lets sales reopen straight away when nothing stands in the way', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { ...event, status: 'ON_SALE' } }))
    render(
      <EventRescheduleForm
        event={event}
        sessions={[]}
        revision={1}
        onSale={{ to: 'ON_SALE', actor: 'organizer', entitled: true, blockers: [] }}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /On sale straight away/ }))
    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).resume).toBe('ON_SALE')
  })

  it('asks for a fresh second factor in place, beside the form rather than inside it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth/step-up and retry.' },
      }),
    )
    const { container } = render(
      <EventRescheduleForm event={event} sessions={sessions} revision={1} />,
    )

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(container.querySelector('form form')).toBeNull()
    expect(container.textContent).not.toContain('/v1/')
  })

  it('shows the refusal and its problems, and says nothing changed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message: 'The new date is in the past.',
          problems: ['Session 1 would start in the past.'],
        },
      }),
    )
    render(<EventRescheduleForm event={event} sessions={sessions} revision={1} />)

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    expect(await screen.findByText('Session 1 would start in the past.')).toBeInTheDocument()
    expect(screen.getByText('The new date was not saved')).toBeInTheDocument()
  })
})

describe('where focus goes when the new date is not saved', () => {
  it('moves to the refusal, every time the API refuses', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message: 'The new date is in the past.',
          problems: ['Session 1 would start in the past.'],
        },
      }),
    )
    render(<EventRescheduleForm event={event} sessions={sessions} revision={1} />)

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    const holder = () => screen.getByText('The new date was not saved').closest('[tabindex="-1"]')

    await waitFor(() => expect(holder()).toHaveFocus())

    // The same refusal again still moves focus to it.
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(holder()).toHaveFocus())
  })

  it('moves to the message when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<EventRescheduleForm event={event} sessions={sessions} revision={1} />)

    await explainAndConfirm(user)
    await user.click(screen.getByRole('button', { name: 'Bring it back' }))

    const said = await screen.findByText('The service is not responding. Nothing has changed.')

    await waitFor(() => expect(said.closest('[tabindex="-1"]')).toHaveFocus())
  })
})
