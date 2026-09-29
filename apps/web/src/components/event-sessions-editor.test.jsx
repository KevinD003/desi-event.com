import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventSessionsEditor } = await import('./event-sessions-editor.jsx')

const event = {
  id: 'evtnights',
  timezone: 'America/New_York',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
}

/**
 * A session as the organiser's read returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The session.
 */
const session = (overrides = {}) => ({
  id: 'snight1',
  eventId: 'evtnights',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
  doorsOpenAt: null,
  timezone: 'America/New_York',
  salesStartAt: null,
  salesEndAt: null,
  venueMapVersionId: null,
  capacity: 200,
  priceZones: [],
  usage: { sold: 0, held: 0 },
  removable: true,
  ...overrides,
})

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
 * Answer writes with `write` and reads of the list with `after`.
 *
 * @param {object} write The write's response.
 * @param {object[]} [after] The sessions the reload reads.
 * @returns {void}
 */
function respond(write, after = [session()]) {
  apiFetch.mockImplementation(async (path, init = {}) =>
    !init.method || init.method === 'GET'
      ? answer(200, { data: after, meta: { revision: 9 } })
      : write,
  )
}

/**
 * The call that wrote, as `[path, init]`.
 *
 * @returns {Array<*>} The call.
 */
const writeCall = () =>
  apiFetch.mock.calls.find(([, init]) => init?.method && init.method !== 'GET')

beforeEach(() => {
  apiFetch.mockReset()
})

describe('removing a session', () => {
  it('asks first, then sends the revision in the query string and no body', async () => {
    const user = userEvent.setup()

    respond(answer(200, { ok: true }), [])
    render(<EventSessionsEditor event={event} sessions={[session()]} revision={6} />)

    await user.click(screen.getByRole('button', { name: 'Remove session 1' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const [path, init] = writeCall()

    expect(path).toBe('/v1/events/evtnights/sessions/snight1')
    expect(init).toEqual({ method: 'DELETE', query: { revision: 6 } })
    expect(
      await screen.findByText(/No sessions\. An event cannot be published/),
    ).toBeInTheDocument()
  })

  it('says why a night with orders cannot go, instead of offering a button', () => {
    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ removable: false, usage: { sold: 3, held: 1 } })]}
        revision={6}
        mode="live"
      />,
    )

    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Cannot be removed: this night has orders/)).toBeInTheDocument()
    expect(screen.getByText('3 of 200 sold · 1 held')).toBeInTheDocument()
  })
})

describe('editing a session', () => {
  it('sends only what changed, with the revision', async () => {
    const user = userEvent.setup()

    respond(answer(200, { data: session({ capacity: 250 }), meta: { revision: 7 } }))
    render(<EventSessionsEditor event={event} sessions={[session()]} revision={6} />)

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    const capacity = screen.getByLabelText(/^Capacity/, { selector: '#session-snight1-capacity' })

    await user.clear(capacity)
    await user.type(capacity, '250')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const [path, init] = writeCall()

    expect(path).toBe('/v1/events/evtnights/sessions/snight1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ capacity: 250, revision: 6 })
    expect(await screen.findByText('Session saved.')).toBeInTheDocument()
  })

  it('asks why and for a tick before moving a night on a public event', async () => {
    const user = userEvent.setup()

    respond(answer(200, { data: session(), meta: { revision: 7 } }))
    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ usage: { sold: 12, held: 0 } })]}
        revision={6}
        mode="live"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    // 7:00 PM New York is 23:00Z; an hour later is 20:00 local.
    fireEvent.change(screen.getByLabelText(/^Starts/, { selector: '#session-snight1-startsAt' }), {
      target: { value: '2027-10-04T20:00' },
    })

    expect(screen.getByText(/You are changing the start time of a night/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText('Say why the night is moving.')).not.toHaveLength(0)
    expect(screen.getAllByText('Tick the box to confirm the change.')).not.toHaveLength(0)
    expect(writeCall()).toBeUndefined()

    await user.type(screen.getByLabelText(/^Why the night is moving/), 'The hall double-booked us.')
    await user.click(screen.getByRole('checkbox', { name: /I understand this changes/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    expect(JSON.parse(writeCall()[1].body)).toEqual({
      startsAt: '2027-10-05T00:00:00.000Z',
      confirmMaterialChange: true,
      changeReason: 'The hall double-booked us.',
      revision: 6,
    })
    expect(
      await screen.findByText(/A notice has been recorded for every order for this night/),
    ).toBeInTheDocument()
  })

  it('keeps the seating layout of a public event’s session', async () => {
    const user = userEvent.setup()

    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ venueMapVersionId: 'v1', capacity: null })]}
        mapVersions={[{ id: 'v1', mapName: 'Main hall', version: 2, seatCount: 400 }]}
        revision={6}
        mode="live"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    expect(
      screen.getByLabelText(/^Seating map/, { selector: '#session-snight1-venueMapVersionId' }),
    ).toBeDisabled()
  })
})

describe('adding a session', () => {
  it('offers every time zone once mounted, not a short list', async () => {
    render(<EventSessionsEditor event={event} sessions={[]} revision={1} />)

    const zone = screen.getByLabelText(/^Time zone/, { selector: '#session-timezone' })

    await waitFor(() => expect(zone.querySelectorAll('option').length).toBeGreaterThan(50))
    expect(zone).toHaveValue('America/New_York')
  })

  it('posts a new session timed like the event, with the revision', async () => {
    const user = userEvent.setup()

    respond(answer(201, { data: session({ id: 'snight2' }), meta: { revision: 2 } }))
    render(<EventSessionsEditor event={event} sessions={[]} revision={1} />)

    const capacity = screen.getByLabelText(/^Capacity/, { selector: '#session-capacity' })

    await user.type(capacity, '150')
    await user.click(screen.getByRole('button', { name: 'Add session' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const [path, init] = writeCall()

    expect(path).toBe('/v1/events/evtnights/sessions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: 'America/New_York',
      capacity: 150,
      revision: 1,
    })
  })

  it('offers no add form when the event is locked', () => {
    render(<EventSessionsEditor event={event} sessions={[session()]} revision={1} mode="locked" />)

    expect(screen.queryByRole('button', { name: 'Add session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })
})

describe('preparing inventory', () => {
  it('says how many seats were matched to a reserved ticket type', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: { kind: 'reserved', created: 0, prepared: 400, expected: 400, assigned: 120 },
      }),
    )
    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ venueMapVersionId: 'v1', capacity: null })]}
        revision={1}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Prepare inventory' }))

    expect(
      await screen.findByText(
        /Already prepared: 400 of 400 seats exist\. Nothing new was created\. 120 seats were matched/,
      ),
    ).toBeInTheDocument()
  })
})
