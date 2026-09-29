import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { EventTiersEditor } = await import('./event-tiers-editor.jsx')

const event = { id: 'evttiers', timezone: 'America/New_York', ticketTypes: [] }

const sessions = [
  {
    id: 'sga',
    startsAt: '2027-10-04T23:00:00.000Z',
    endsAt: '2027-10-05T03:00:00.000Z',
    timezone: 'America/New_York',
    venueMapVersionId: null,
    priceZones: [],
  },
  {
    id: 'sseat',
    startsAt: '2027-10-05T23:00:00.000Z',
    endsAt: '2027-10-06T03:00:00.000Z',
    timezone: 'America/New_York',
    venueMapVersionId: 'v1',
    priceZones: [
      { id: 'zstalls', name: 'Stalls', colourToken: 'zone-1', sortOrder: 0 },
      { id: 'zbalcony', name: 'Balcony', colourToken: 'zone-2', sortOrder: 1 },
    ],
  },
]

/**
 * A tier as the organiser's read returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The tier.
 */
const tier = (overrides = {}) => ({
  id: 'tgeneral',
  eventId: 'evttiers',
  name: 'General',
  description: null,
  priceCents: 3500,
  currency: 'USD',
  quantityTotal: 10,
  quantitySold: 0,
  minPerOrder: 1,
  maxPerOrder: 10,
  salesStartAt: null,
  salesEndAt: null,
  status: 'DRAFT',
  sortOrder: 0,
  eventSessionId: null,
  priceZoneId: null,
  reserved: false,
  complimentary: false,
  visibility: 'PUBLIC',
  heldQuantity: 0,
  hasOrders: false,
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
 * Answer every call: writes with `write`, reads of the tiers and preview with lists.
 *
 * @param {object} write The write's response.
 * @param {object[]} [after] The tiers the reload reads.
 * @returns {void}
 */
function respond(write, after = [tier()]) {
  apiFetch.mockImplementation(async (path, init = {}) => {
    if (!init.method || init.method === 'GET') {
      return path.endsWith('/tiers')
        ? answer(200, { data: after, meta: { revision: 9 } })
        : answer(200, { data: [] })
    }

    return write
  })
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

describe('editing a ticket type', () => {
  it('opens a prefilled form and sends only the changed name, with the revision', async () => {
    const user = userEvent.setup()

    respond(answer(200, { data: tier({ name: 'General (standing)' }), meta: { revision: 8 } }))
    render(<EventTiersEditor event={event} sessions={sessions} tiers={[tier()]} revision={7} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const name = screen.getByLabelText(/^Name/, { selector: '#tier-tgeneral-name' })

    expect(name).toHaveValue('General')
    expect(
      screen.getByLabelText(/^Face value \(USD\)/, { selector: '#tier-tgeneral-price' }),
    ).toHaveValue('35.00')

    await user.clear(name)
    await user.type(name, 'General (standing)')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const [path, init] = writeCall()

    expect(path).toBe('/v1/events/evttiers/tiers/tgeneral')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ revision: 7, name: 'General (standing)' })
  })

  it('keeps the price of a tier that has sold, and says why', async () => {
    const user = userEvent.setup()
    const sold = tier({ quantitySold: 2, removable: false, hasOrders: true, status: 'ON_SALE' })

    render(
      <EventTiersEditor
        event={event}
        sessions={sessions}
        tiers={[sold]}
        revision={7}
        mode="live"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(
      screen.getByLabelText(/^Face value/, { selector: '#tier-tgeneral-price' }),
    ).toBeDisabled()
    expect(screen.getByText(/The price stays as it is: 2 sold at it/)).toBeInTheDocument()
  })
})

describe('removing a ticket type', () => {
  it('asks first, then sends the revision in the query string and no body', async () => {
    const user = userEvent.setup()

    respond(answer(200, { ok: true }), [])
    render(<EventTiersEditor event={event} sessions={sessions} tiers={[tier()]} revision={4} />)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const [path, init] = writeCall()

    expect(path).toBe('/v1/events/evttiers/tiers/tgeneral')
    expect(init).toEqual({ method: 'DELETE', query: { revision: 4 } })
    expect(init.body).toBeUndefined()
    expect(
      await screen.findByText(/No ticket types\. An event cannot go on sale/),
    ).toBeInTheDocument()
  })

  it('says why a tier that has sold cannot go, instead of offering a button', () => {
    render(
      <EventTiersEditor
        event={event}
        sessions={sessions}
        tiers={[tier({ quantitySold: 3, removable: false })]}
        revision={4}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(
      screen.getByText(/Cannot be removed: tickets of this type have been sold/),
    ).toBeInTheDocument()
  })
})

describe('adding a ticket type', () => {
  it('posts the price typed in dollars as cents', async () => {
    const user = userEvent.setup()

    respond(answer(201, { data: tier({ name: 'Early bird' }), meta: { revision: 5 } }))
    render(<EventTiersEditor event={event} sessions={sessions} tiers={[]} revision={4} />)

    await user.type(screen.getByLabelText(/^Name/, { selector: '#tier-name' }), 'Early bird')
    await user.type(
      screen.getByLabelText(/^Face value \(USD\)/, { selector: '#tier-price' }),
      '35.00',
    )
    await user.type(screen.getByLabelText(/^How many/, { selector: '#tier-quantityTotal' }), '100')
    await user.click(screen.getByRole('button', { name: 'Add ticket type' }))

    await waitFor(() => expect(writeCall()).toBeDefined())

    const body = JSON.parse(writeCall()[1].body)

    expect(body).toMatchObject({
      revision: 4,
      name: 'Early bird',
      priceCents: 3500,
      quantityTotal: 100,
      visibility: 'PUBLIC',
      status: 'DRAFT',
    })
  })

  it('offers the zones of a mapped session once reserved is ticked, and no quantity', async () => {
    const user = userEvent.setup()

    render(<EventTiersEditor event={event} sessions={sessions} tiers={[]} revision={4} />)

    expect(
      screen.getByLabelText(/^How many/, { selector: '#tier-quantityTotal' }),
    ).toBeInTheDocument()

    await user.click(screen.getByLabelText(/Reserved seating/))

    const zone = screen.getByLabelText(/^Price zone/, { selector: '#tier-priceZoneId' })
    const offered = within(zone)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(offered).toEqual(['Choose a zone', 'Stalls', 'Balcony'])
    expect(
      screen.queryByLabelText(/^How many/, { selector: '#tier-quantityTotal' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByLabelText(/^Which session/, { selector: '#tier-eventSessionId' }),
    ).toHaveValue('sseat')
  })

  it('makes a complimentary tier free and hidden', async () => {
    const user = userEvent.setup()

    render(<EventTiersEditor event={event} sessions={sessions} tiers={[]} revision={4} />)

    await user.click(screen.getByLabelText(/^Complimentary/))

    expect(screen.getByLabelText(/^Face value/, { selector: '#tier-price' })).toBeDisabled()
    expect(screen.getByLabelText(/^Hidden — only your team can book it/)).toBeChecked()
    expect(screen.getByLabelText(/^Shown on the event page/)).toBeDisabled()
  })

  it('shows a refusal’s problems and puts a field issue under its box', async () => {
    const user = userEvent.setup()

    respond(
      answer(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          issues: [{ path: 'maxPerOrder', message: 'Too big: expected number to be <=1000' }],
        },
      }),
    )
    render(<EventTiersEditor event={event} sessions={sessions} tiers={[]} revision={4} />)

    await user.type(screen.getByLabelText(/^Name/, { selector: '#tier-name' }), 'X')
    await user.type(screen.getByLabelText(/^Face value/, { selector: '#tier-price' }), '1')
    await user.type(screen.getByLabelText(/^How many/, { selector: '#tier-quantityTotal' }), '5')
    await user.click(screen.getByRole('button', { name: 'Add ticket type' }))

    expect(await screen.findByText('Too big: expected number to be <=1000')).toBeInTheDocument()
  })

  it('refuses before sending when the form cannot be saved', async () => {
    const user = userEvent.setup()

    render(<EventTiersEditor event={event} sessions={sessions} tiers={[]} revision={4} />)

    await user.type(screen.getByLabelText(/^Face value/, { selector: '#tier-price' }), '35.505')
    await user.click(screen.getByRole('button', { name: 'Add ticket type' }))

    // In the summary at the top, and under the box itself.
    expect(await screen.findAllByText(/Use at most 2 decimal places/)).toHaveLength(2)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('a tier’s card', () => {
  it('says hidden, complimentary, reserved where, and what is sold and held', () => {
    render(
      <EventTiersEditor
        event={event}
        sessions={sessions}
        revision={1}
        tiers={[
          tier({
            id: 'tcomp',
            name: 'Guest list',
            priceCents: 0,
            complimentary: true,
            visibility: 'HIDDEN',
          }),
          tier({
            id: 'tseat',
            name: 'Stalls',
            reserved: true,
            eventSessionId: 'sseat',
            priceZoneId: 'zstalls',
            quantityTotal: 0,
            quantitySold: 3,
            heldQuantity: 2,
            removable: false,
          }),
        ]}
      />,
    )

    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Complimentary')).toBeInTheDocument()
    expect(screen.getByText(/Reserved — Stalls at Session 2/)).toBeInTheDocument()
    expect(screen.getByText(/3 sold · 2 held/)).toBeInTheDocument()
  })
})

describe('what a buyer is charged', () => {
  it('states a zero fee as an amount, never as a "Free fee"', () => {
    respond(answer(200, { data: {} }))
    render(
      <EventTiersEditor
        event={event}
        sessions={sessions}
        tiers={[
          tier({
            id: 'tguests',
            name: 'Guest list',
            priceCents: 0,
            complimentary: true,
            visibility: 'HIDDEN',
          }),
        ]}
        preview={[
          { ticketTypeId: 'tguests', allInCents: 0, feesCents: 0, taxCents: 0, currency: 'USD' },
        ]}
        revision={1}
      />,
    )

    const card = screen.getByText('Guest list').closest('li')

    expect(card).toHaveTextContent('Free all in ($0.00 fee)')
    expect(card).not.toHaveTextContent(/Free fee/u)
  })

  it('states a fee and a tax as amounts beside the all-in price', () => {
    respond(answer(200, { data: {} }))
    render(
      <EventTiersEditor
        event={event}
        sessions={sessions}
        tiers={[tier()]}
        preview={[
          {
            ticketTypeId: 'tgeneral',
            allInCents: 4491,
            feesCents: 306,
            taxCents: 685,
            currency: 'USD',
          },
        ]}
        revision={1}
      />,
    )

    const card = screen.getByText('General').closest('li')

    expect(card).toHaveTextContent('$44.91 all in ($3.06 fee + $6.85 tax)')
  })
})
