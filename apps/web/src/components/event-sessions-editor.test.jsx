import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
// The real list, unless a case says otherwise: every SessionForm fills its
// time-zone select with every zone the runtime knows once it mounts.
vi.mock('../lib/time-zones.js', async (importOriginal) => {
  const actual = await importOriginal()

  return { ...actual, allTimeZones: vi.fn(actual.allTimeZones) }
})

const { apiFetch } = await import('../lib/api-fetch.js')
const { allTimeZones } = await import('../lib/time-zones.js')
const realTimeZones = (await vi.importActual('../lib/time-zones.js')).allTimeZones
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
  allTimeZones.mockImplementation(realTimeZones)
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
    // Two forms are open here, the night's and the new one's, and each would
    // list every zone the runtime knows — some 420 each, drawn again on every
    // change — which made this one of the slowest cases in the suite (over 5 s
    // once, under load) for a list it never reads. Its zone is New York either
    // way; the full list has a case of its own under 'adding a session'.
    allTimeZones.mockImplementation(() => ['America/New_York', 'UTC'])

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

    // Entered at once: what is asserted is that a reason is asked for and
    // sent, not how it is typed, and 26 keystrokes were 26 renders of both forms.
    await user.click(screen.getByLabelText(/^Why the night is moving/))
    await user.paste('The hall double-booked us.')
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

  it('keeps the seating map of a live night whose seats are sold', async () => {
    const user = userEvent.setup()

    render(
      <EventSessionsEditor
        event={event}
        sessions={[
          session({
            venueMapVersionId: 'v1',
            capacity: null,
            usage: { sold: 12, held: 0 },
            removable: false,
          }),
        ]}
        mapVersions={[{ id: 'v1', mapName: 'Main hall', version: 2, seatCount: 400 }]}
        revision={6}
        mode="live"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    expect(
      screen.getByLabelText(/^Seating map/, { selector: '#session-snight1-venueMapVersionId' }),
    ).toBeDisabled()
    expect(
      screen.getByText(/Seats have been sold or held at this night, so its seating map is what/),
    ).toBeInTheDocument()
  })

  it('offers another map for an unused live night', async () => {
    const user = userEvent.setup()

    respond(answer(200, { data: session(), meta: { revision: 7 } }))
    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ venueMapVersionId: 'v1', capacity: null })]}
        mapVersions={[
          { id: 'v1', mapName: 'Main hall', version: 2, seatCount: 400 },
          { id: 'v2', mapName: 'Main hall', version: 3, seatCount: 420 },
        ]}
        revision={6}
        mode="live"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    const map = screen.getByLabelText(/^Seating map/, {
      selector: '#session-snight1-venueMapVersionId',
    })

    expect(map).toBeEnabled()

    await user.selectOptions(map, 'v2')
    await user.click(screen.getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(writeCall()).toBeDefined())
    expect(JSON.parse(writeCall()[1].body)).toMatchObject({ venueMapVersionId: 'v2', revision: 6 })
  })
})

describe('cancelling a night', () => {
  const used = session({ usage: { sold: 5, held: 0 }, removable: false })

  it('offers a used live night a cancellation when the server page allows it', () => {
    render(
      <EventSessionsEditor
        event={event}
        sessions={[used]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    expect(screen.getByRole('button', { name: 'Cancel this night…' })).toBeInTheDocument()
    expect(screen.getByText(/or cancel it, which refunds its tickets\./)).toBeInTheDocument()
    expect(screen.getByText(/or cancel one, refunding its tickets/)).toBeInTheDocument()
  })

  it('offers no cancellation without it, nor on a draft', () => {
    const { unmount } = render(
      <EventSessionsEditor event={event} sessions={[used]} revision={6} mode="live" />,
    )

    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    unmount()

    render(
      <EventSessionsEditor
        event={event}
        sessions={[used]}
        revision={6}
        mode="draft"
        mayCancelNights
      />,
    )
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
  })

  it('marks a cancelled night and offers nothing on it', () => {
    render(
      <EventSessionsEditor
        event={event}
        sessions={[
          session({
            status: 'CANCELLED',
            cancellationReason: 'The singer cancelled.',
            removable: false,
          }),
        ]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    expect(screen.getByText('Cancelled', { selector: 'span *, span' })).toBeInTheDocument()
    expect(screen.getByText('Cancelled: The singer cancelled.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit session/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare inventory' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
  })

  it('re-reads the nights, with the new revision, and says what was refunded', async () => {
    const user = userEvent.setup()
    const onRevision = vi.fn()

    apiFetch.mockImplementation(async (path, init = {}) => {
      if (path.endsWith('/cancellation')) {
        return answer(200, {
          data: {
            sessionId: used.id,
            revision: 6,
            permitted: true,
            missing: null,
            refusal: null,
            orders: 5,
            ordersRefunded: 5,
            ordersToldOnly: 0,
            zeroValueOrders: 0,
            disputedOrders: 0,
            ordersCancelled: 0,
            ticketsWithdrawn: 7,
            refundableCents: 25_000,
            currency: 'USD',
            paymentMode: 'MOCK',
          },
        })
      }
      if (path.endsWith('/cancel')) {
        return answer(200, {
          data: {
            session: { ...used, status: 'CANCELLED' },
            refunds: {
              owed: 5,
              settled: 5,
              waiting: 0,
              failed: 0,
              disputed: 0,
              amountCents: 25_000,
              currency: 'USD',
            },
          },
        })
      }

      return answer(200, {
        data: [{ ...used, status: 'CANCELLED' }],
        meta: { revision: 8 },
        method: init.method,
      })
    })

    render(
      <EventSessionsEditor
        event={event}
        sessions={[used]}
        revision={6}
        onRevision={onRevision}
        mode="live"
        mayCancelNights
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel this night…' }))
    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(
      screen.getByLabelText(/Why is this night being cancelled/),
      'The singer cancelled at short notice.',
    )
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    // Said once, in the night's dialog; the editor's notice does not repeat it.
    const dialog = screen.getByRole('region', { name: /^Cancel the night of / })

    expect(
      await within(dialog).findByText(
        'Its tickets no longer work at the door. 5 orders refunded ($250.00).',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Night cancelled', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText(/^Night cancelled\. Its tickets/)).not.toBeInTheDocument()
    expect(onRevision).toHaveBeenCalledWith(8)
  })
})

describe('the outcome of cancelling a night', () => {
  const REASON = 'The singer cancelled at short notice.'
  const DOOR = 'Its tickets no longer work at the door.'
  const OUTCOME = `${DOOR} 5 orders refunded ($250.00).`

  /**
   * A night of a live event that people hold tickets for.
   *
   * @param {string} id The night.
   * @param {string} label Its label.
   * @returns {object} The session.
   */
  const usedNight = (id, label) =>
    session({ id, label, usage: { sold: 5, held: 0 }, removable: false })

  const PREVIEW = {
    revision: 6,
    permitted: true,
    missing: null,
    refusal: null,
    orders: 5,
    ordersRefunded: 5,
    ordersToldOnly: 0,
    zeroValueOrders: 0,
    disputedOrders: 0,
    ordersCancelled: 0,
    ticketsWithdrawn: 7,
    refundableCents: 25_000,
    currency: 'USD',
    paymentMode: 'MOCK',
  }

  const REFUNDS = {
    owed: 5,
    settled: 5,
    waiting: 0,
    failed: 0,
    disputed: 0,
    amountCents: 25_000,
    currency: 'USD',
  }

  /**
   * A promise the test settles when it chooses.
   *
   * @returns {{promise: Promise<*>, resolve: Function}} The promise and its resolver.
   */
  function deferred() {
    let resolve

    const promise = new Promise((settle) => {
      resolve = settle
    })

    return { promise, resolve }
  }

  /**
   * Answer every night's preview and cancellation the way the server does,
   * and the editor's re-read of the list with `relist`, given the nights as
   * they now are.
   *
   * @param {object[]} nights The nights as first loaded.
   * @param {Function} [relist] Answers the re-read; by default at once.
   * @param {{sent?: Promise<*>}} [options] `sent`: the cancellation is answered once it settles.
   * @returns {void}
   */
  function serve(
    nights,
    relist = async (now) => answer(200, { data: now, meta: { revision: 8 } }),
    { sent = null } = {},
  ) {
    const cancelled = new Set()

    apiFetch.mockImplementation(async (path) => {
      const night = nights.find((candidate) => path.includes(`/sessions/${candidate.id}/`))

      if (path.endsWith('/cancellation')) {
        return answer(200, { data: { ...PREVIEW, sessionId: night.id } })
      }
      if (path.endsWith('/cancel')) {
        await sent
        cancelled.add(night.id)

        return answer(200, {
          data: {
            session: { ...night, status: 'CANCELLED', cancellationReason: REASON },
            refunds: REFUNDS,
          },
        })
      }

      return relist(
        nights.map((each) =>
          cancelled.has(each.id)
            ? { ...each, status: 'CANCELLED', cancellationReason: REASON }
            : each,
        ),
      )
    })
  }

  /**
   * One night's card.
   *
   * @param {string} label The night's label.
   * @returns {object} Queries bound to the card.
   */
  const card = (label) =>
    within(screen.getByRole('heading', { name: new RegExp(`^${label}\\b`) }).closest('li'))

  /**
   * Cancel a night through its dialog.
   *
   * @param {object} user The user-event instance.
   * @param {string} label The night's label.
   * @returns {Promise<void>} Resolves once the cancellation is sent.
   */
  async function cancelThrough(user, label) {
    await user.click(card(label).getByRole('button', { name: 'Cancel this night…' }))
    await card(label).findByText(/paid orders for this night are refunded/)
    await user.click(card(label).getByLabelText(/Why is this night being cancelled/))
    await user.paste(REASON)
    await user.click(card(label).getByRole('checkbox'))
    await user.click(card(label).getByRole('button', { name: 'Cancel this night and refund it' }))
  }

  const LIVE = '[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])'

  /**
   * Count each time a live region comes to hold `sentence`: once per region
   * that newly holds it, the outermost region of a nested pair counted once.
   *
   * @param {string} sentence What is announced.
   * @returns {{count: Function, holders: Function, stop: Function}} The tally.
   */
  function announcements(sentence) {
    const holding = new Set()
    let count = 0

    /**
     * Look at every live region now on the page.
     *
     * @returns {void}
     */
    const look = () => {
      const regions = [...document.querySelectorAll(LIVE)].filter(
        (region) => !region.parentElement?.closest(LIVE),
      )

      for (const region of regions) {
        const holds = region.textContent.includes(sentence)

        if (holds && !holding.has(region)) {
          holding.add(region)
          count += 1
        }
        if (!holds) holding.delete(region)
      }
    }
    const observer = new MutationObserver(look)

    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return {
      count: () => {
        look()
        return count
      },
      holders: () => [...holding].filter((region) => region.isConnected),
      stop: () => observer.disconnect(),
    }
  }

  it('stays in the dialog, with focus on it, after a re-read that answers later finds the night cancelled', async () => {
    const user = userEvent.setup()
    const onRevision = vi.fn()
    const relisted = deferred()
    let drawnWhenAsked = null

    serve([usedNight('snight1', 'Night 1')], (now) => {
      drawnWhenAsked = Boolean(screen.queryByText('Night cancelled', { exact: true }))
      return relisted.promise.then(() => answer(200, { data: now, meta: { revision: 8 } }))
    })
    render(
      <EventSessionsEditor
        event={event}
        sessions={[usedNight('snight1', 'Night 1')]}
        revision={6}
        onRevision={onRevision}
        mode="live"
        mayCancelNights
      />,
    )

    const said = announcements(DOOR)

    await cancelThrough(user, 'Night 1')

    const dialog = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })

    expect(await within(dialog).findByText(OUTCOME)).toBeVisible()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toHaveTextContent(/^Night cancelled/)
    expect(drawnWhenAsked).toBe(false)

    // The re-read answers only now, with the night cancelled.
    relisted.resolve()

    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
    expect(onRevision).toHaveBeenCalledWith(8)
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('Night cancelled', { exact: true })).toBeVisible()
    expect(within(dialog).getByText(OUTCOME)).toBeVisible()
    expect(dialog).toContainElement(document.activeElement)
    expect(document.activeElement).toHaveTextContent(/^Night cancelled/)

    // Announced once, by the dialog, never again by the editor's notice.
    expect(said.count()).toBe(1)
    expect(said.holders()).toHaveLength(1)
    expect(dialog).toContainElement(said.holders()[0])
    said.stop()
  })

  it('stays in the dialog when the re-read answers before the outcome is drawn', async () => {
    const user = userEvent.setup()
    let drawnWhenAsked = null

    serve([usedNight('snight1', 'Night 1')], async (now) => {
      drawnWhenAsked = Boolean(screen.queryByText('Night cancelled', { exact: true }))
      return answer(200, { data: now, meta: { revision: 8 } })
    })
    render(
      <EventSessionsEditor
        event={event}
        sessions={[usedNight('snight1', 'Night 1')]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    const said = announcements(DOOR)

    await cancelThrough(user, 'Night 1')

    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
    expect(drawnWhenAsked).toBe(false)

    const dialog = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })

    expect(within(dialog).getByText('Night cancelled', { exact: true })).toBeVisible()
    expect(within(dialog).getByText(OUTCOME)).toBeVisible()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))
    expect(document.activeElement).not.toBe(document.body)
    expect(said.count()).toBe(1)
    said.stop()
  })

  it('closes on request, offers that night no cancellation again, and puts focus on the night', async () => {
    const user = userEvent.setup()

    serve([usedNight('snight1', 'Night 1')])
    render(
      <EventSessionsEditor
        event={event}
        sessions={[usedNight('snight1', 'Night 1')]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    await cancelThrough(user, 'Night 1')
    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()

    const dialog = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByText('Night cancelled', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ })).toHaveFocus(),
    )
  })

  it('keeps each night’s outcome until it is closed, while another night is cancelled', async () => {
    const user = userEvent.setup()
    const nights = [usedNight('snight1', 'Night 1'), usedNight('snight2', 'Night 2')]

    serve(nights)
    render(
      <EventSessionsEditor
        event={event}
        sessions={nights}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    await cancelThrough(user, 'Night 1')
    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()

    // Night 2 is still on, and can be cancelled while night 1 says what it did.
    await cancelThrough(user, 'Night 2')
    expect(await card('Night 2').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()

    const first = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })
    const second = screen.getByRole('region', { name: /^Cancel the night of Night 2/ })

    expect(within(first).getByText(OUTCOME)).toBeVisible()
    expect(within(second).getByText(OUTCOME)).toBeVisible()
    await waitFor(() => expect(second).toContainElement(document.activeElement))

    await user.click(within(second).getByRole('button', { name: 'Close' }))

    expect(second).not.toBeInTheDocument()
    expect(first).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^Night 2\s*State:\s*Cancelled/ })).toHaveFocus(),
    )

    await user.click(within(first).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ })).toHaveFocus(),
    )
  })

  it('says what happened, and offers no cancellation again, when Edit was pressed while it was being sent', async () => {
    const user = userEvent.setup()
    const sent = deferred()

    serve([usedNight('snight1', 'Night 1')], undefined, { sent: sent.promise })
    render(
      <EventSessionsEditor
        event={event}
        sessions={[usedNight('snight1', 'Night 1')]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    const said = announcements(DOOR)

    await cancelThrough(user, 'Night 1')
    expect(
      await screen.findByText('Cancelling the night and refunding its orders…'),
    ).toBeInTheDocument()

    // Edit takes the dialog's place while the cancellation is on its way.
    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))
    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()

    sent.resolve()

    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()

    const dialog = await screen.findByRole('region', { name: /^Cancel the night of Night 1/ })

    expect(within(dialog).getByText('Night cancelled', { exact: true })).toBeVisible()
    expect(within(dialog).getByText(OUTCOME)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    // A cancelled night is not edited: its form is gone with the night.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))
    expect(within(dialog).queryByText(/^Reading what cancelling/)).not.toBeInTheDocument()
    expect(said.count()).toBe(1)
    said.stop()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ })).toHaveFocus(),
    )
  })

  it('says what happened when the night stops being one to cancel while it was being sent', async () => {
    const user = userEvent.setup()
    const sent = deferred()
    const props = {
      event,
      sessions: [usedNight('snight1', 'Night 1')],
      revision: 6,
      mode: 'live',
      platform: true,
    }

    serve(props.sessions, undefined, { sent: sent.promise })

    const { rerender } = render(<EventSessionsEditor {...props} mayCancelNights />)

    await cancelThrough(user, 'Night 1')
    expect(
      await screen.findByText('Cancelling the night and refunding its orders…'),
    ).toBeInTheDocument()

    // The editing session ends while the answer is on its way.
    rerender(<EventSessionsEditor {...props} mayCancelNights={false} />)
    sent.resolve()

    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()

    const dialog = await screen.findByRole('region', { name: /^Cancel the night of Night 1/ })

    expect(within(dialog).getByText(OUTCOME)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ })).toHaveFocus(),
    )
  })

  it('treats the night as cancelled from the answer, before the re-read comes back', async () => {
    const user = userEvent.setup()
    const relisted = deferred()

    serve([usedNight('snight1', 'Night 1')], (now) =>
      relisted.promise.then(() => answer(200, { data: now, meta: { revision: 8 } })),
    )
    render(
      <EventSessionsEditor
        event={event}
        sessions={[usedNight('snight1', 'Night 1')]}
        revision={6}
        mode="live"
        mayCancelNights
      />,
    )

    await cancelThrough(user, 'Night 1')

    const dialog = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })

    expect(await within(dialog).findByText(OUTCOME)).toBeVisible()

    // Nothing on the night to edit or prepare while the list is re-read.
    expect(screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ })).toBeVisible()
    expect(
      card('Night 1').queryByRole('button', { name: 'Edit session 1' }),
    ).not.toBeInTheDocument()
    expect(
      card('Night 1').queryByRole('button', { name: 'Prepare inventory' }),
    ).not.toBeInTheDocument()

    relisted.resolve()

    expect(await card('Night 1').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(OUTCOME)).toBeVisible()
  })

  it('keeps the newest re-read when an older one answers after it', async () => {
    const user = userEvent.setup()
    const onRevision = vi.fn()
    const nights = [usedNight('snight1', 'Night 1'), usedNight('snight2', 'Night 2')]
    const firstRelist = deferred()
    let relists = 0

    serve(nights, (now) => {
      relists += 1
      // The first re-read, asked after night 1, answers last.
      return relists === 1
        ? firstRelist.promise.then(() => answer(200, { data: now, meta: { revision: 8 } }))
        : answer(200, { data: now, meta: { revision: 9 } })
    })
    render(
      <EventSessionsEditor
        event={event}
        sessions={nights}
        revision={6}
        onRevision={onRevision}
        mode="live"
        mayCancelNights
      />,
    )

    await cancelThrough(user, 'Night 1')
    expect(await card('Night 1').findByText(OUTCOME)).toBeVisible()
    await cancelThrough(user, 'Night 2')
    expect(await card('Night 2').findByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
    expect(onRevision).toHaveBeenLastCalledWith(9)

    firstRelist.resolve()
    await firstRelist.promise
    await new Promise((settle) => setTimeout(settle, 0))

    // The older answer, which had only night 1 cancelled, changes nothing.
    expect(onRevision).toHaveBeenLastCalledWith(9)
    expect(onRevision).not.toHaveBeenCalledWith(8)
    expect(card('Night 1').getByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
    expect(card('Night 2').getByText(`Cancelled: ${REASON}`)).toBeInTheDocument()
  })

  it('keeps what happened on screen, and lets nothing escape, when the re-read cannot be sent', async () => {
    const user = userEvent.setup()
    const escaped = []
    /**
     * Keep a rejection nobody handled.
     *
     * @param {*} reason Why it was rejected.
     * @returns {void}
     */
    const unhandled = (reason) => escaped.push(reason)

    process.on('unhandledRejection', unhandled)

    try {
      serve([usedNight('snight1', 'Night 1')], async () => {
        throw new TypeError('Failed to fetch')
      })
      render(
        <EventSessionsEditor
          event={event}
          sessions={[usedNight('snight1', 'Night 1')]}
          revision={6}
          mode="live"
          mayCancelNights
        />,
      )

      await cancelThrough(user, 'Night 1')

      const dialog = screen.getByRole('region', { name: /^Cancel the night of Night 1/ })

      expect(await within(dialog).findByText(OUTCOME)).toBeVisible()
      await waitFor(() => expect(dialog).toContainElement(document.activeElement))
      // Long enough for a rejection nobody handled to be reported.
      await new Promise((settle) => setTimeout(settle, 20))
      expect(escaped).toEqual([])

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: /^Night 1\s*State:\s*Cancelled/ }),
        ).toHaveFocus(),
      )
    } finally {
      process.off('unhandledRejection', unhandled)
    }
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

  it('keeps a finished or cancelled event’s nights as they were', () => {
    render(<EventSessionsEditor event={event} sessions={[session()]} revision={1} mode="content" />)

    expect(screen.queryByRole('button', { name: 'Add session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.getByText(/its nights stay as ticket holders were told them/)).toBeInTheDocument()
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

describe('writing as the team at The Desi Events, whose second factor lapses every 10 minutes', () => {
  const PLATFORM_SENTENCE =
    'Confirm it’s you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else’s event.'

  /**
   * Answer the first write with STEP_UP_REQUIRED and every later one with `then`.
   *
   * @param {object} then The answer once the second factor is fresh.
   * @returns {Function} How many writes were sent so far.
   */
  function lapsedOnce(then) {
    let writes = 0

    apiFetch.mockImplementation(async (path, init = {}) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })
      if (!init.method || init.method === 'GET') {
        return answer(200, { data: [session({ capacity: 250 })], meta: { revision: 8 } })
      }

      writes += 1

      return writes === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } })
        : then
    })

    return () => writes
  }

  it('asks for the second factor where the night was saved, then sends the same change again', async () => {
    const user = userEvent.setup()
    const writes = lapsedOnce(
      answer(200, { data: session({ capacity: 250 }), meta: { revision: 7 } }),
    )

    render(<EventSessionsEditor event={event} sessions={[session()]} revision={6} platform />)

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    const capacity = screen.getByLabelText(/^Capacity/, { selector: '#session-snight1-capacity' })

    await user.clear(capacity)
    await user.type(capacity, '250')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(PLATFORM_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByText(/That did not work/)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(writes()).toBe(2))

    const sent = apiFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')

    expect(sent).toHaveLength(2)
    expect(JSON.parse(sent[1][1].body)).toEqual({ capacity: 250, revision: 6 })
    expect(await screen.findByText('Session saved.')).toBeInTheDocument()
    expect(screen.queryByText(PLATFORM_SENTENCE)).not.toBeInTheDocument()
  })

  it('sends nothing more, and says so, when the second factor is not given', async () => {
    const user = userEvent.setup()
    const writes = lapsedOnce(answer(200, { data: session(), meta: { revision: 7 } }))

    render(<EventSessionsEditor event={event} sessions={[session()]} revision={6} platform />)

    await user.click(screen.getByRole('button', { name: 'Prepare inventory' }))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    expect(
      await screen.findByText(
        'Not saved: confirm it’s you to make this change. Nothing has been sent.',
      ),
    ).toBeInTheDocument()
    expect(writes()).toBe(1)
  })

  it('tells the editor when a write finds the editing session closed', async () => {
    const user = userEvent.setup()
    const onSittingEnded = vi.fn()

    respond(
      answer(403, {
        error: {
          code: 'PLATFORM_EDIT_NOT_OPEN',
          message:
            'Open this event for editing as the team at The Desi Events in this browser first.',
        },
      }),
    )
    render(
      <EventSessionsEditor
        event={event}
        sessions={[session()]}
        revision={6}
        platform
        onSittingEnded={onSittingEnded}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remove session 1' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }))

    expect(
      await screen.findByText(/Open this event for editing as the team at The Desi Events/),
    ).toBeInTheDocument()
    expect(onSittingEnded).toHaveBeenCalledTimes(1)
  })
})

describe('a night whose listing gave no end time', () => {
  const LABEL = 'Not listed by Sulekha (estimate for scheduling)'

  it('labels the stored end as an estimate in the list and in the edit form', async () => {
    const user = userEvent.setup()

    render(
      <EventSessionsEditor
        event={event}
        sessions={[session({ endTimeListed: false })]}
        revision={6}
      />,
    )

    expect(
      screen.getByText(`End time: ${LABEL}. The event page shows only the start.`),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    expect(
      screen.getAllByText(
        `${LABEL}. The event page shows only the start until the night's real end time is set here.`,
      ),
    ).not.toHaveLength(0)
  })

  it('says nothing of the kind for a night whose end was listed or set', async () => {
    const user = userEvent.setup()

    render(<EventSessionsEditor event={event} sessions={[session()]} revision={6} />)
    await user.click(screen.getByRole('button', { name: 'Edit session 1' }))

    expect(screen.queryByText(new RegExp(LABEL.replace(/[()]/gu, '\\$&'), 'u'))).toBeNull()
  })
})
