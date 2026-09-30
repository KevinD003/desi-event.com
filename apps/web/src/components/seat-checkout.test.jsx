import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SeatCheckout } from './seat-checkout.jsx'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const FRONT = 'ttfrontxxxxxx'
const BACK = 'ttbackxxxxxxx'

/**
 * A public seat of the map.
 *
 * @param {string} label The seat's label; its ids derive from it.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The seat.
 */
function seat(label, overrides = {}) {
  const key = label.toLowerCase()

  return {
    id: `es${key}xxxxxxxx`,
    seatId: `st${key}xxxxxxxx`,
    label,
    sectionId: 'scstallsxxxxx',
    priceZoneId: 'pzfrontxxxxxx',
    sortOrder: 0,
    available: true,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
    priceCents: null,
    ticketTypeId: FRONT,
    ...overrides,
  }
}

const A1 = seat('A1', { accessible: true })
const A2 = seat('A2', { companionOfSeatId: A1.seatId })
const A3 = seat('A3')
const B1 = seat('B1', { priceZoneId: 'pzbackxxxxxxx', ticketTypeId: BACK })

/**
 * A night's map.
 *
 * @param {object} [overrides] Fields of the map to change.
 * @param {Record<string, object>} [overrides.seats] Seats to replace, by label.
 * @returns {object} The map's `data`.
 */
function seatMap({ seats: replaced = {}, ...overrides } = {}) {
  const pick = (entry) => replaced[entry.label] ?? entry

  return {
    sessionId: 'snnightonexxx',
    eventId: 'evseatedxxxxx',
    label: 'Night 1',
    startsAt: '2026-10-03T23:30:00.000Z',
    endsAt: '2026-10-04T04:30:00.000Z',
    doorsOpenAt: null,
    timezone: 'America/New_York',
    status: 'ON_SALE',
    salesStartAt: null,
    salesEndAt: null,
    maxSeatsPerOrder: 10,
    zones: [
      { id: 'pzfrontxxxxxx', name: 'Front', sortOrder: 0 },
      { id: 'pzbackxxxxxxx', name: 'Back', sortOrder: 1 },
    ],
    tiers: [
      {
        id: FRONT,
        name: 'Front stalls',
        priceCents: 4_500,
        currency: 'USD',
        priceZoneId: 'pzfrontxxxxxx',
        minPerOrder: 1,
        maxPerOrder: 10,
        onSale: true,
      },
      {
        id: BACK,
        name: 'Back stalls',
        priceCents: 2_500,
        currency: 'USD',
        priceZoneId: 'pzbackxxxxxxx',
        minPerOrder: 1,
        maxPerOrder: 10,
        onSale: true,
      },
    ],
    counts: { total: 4, available: 4, held: 0, sold: 0, unavailable: 0 },
    sections: [
      {
        id: 'scstallsxxxxx',
        name: 'Stalls',
        kind: 'SEATED',
        sortOrder: 0,
        rows: [
          { id: 'rwaxxxxxxxxxx', label: 'A', sortOrder: 0, seats: [A1, A2, A3].map(pick) },
          { id: 'rwbxxxxxxxxxx', label: 'B', sortOrder: 1, seats: [B1].map(pick) },
        ],
        seats: [],
      },
    ],
    ...overrides,
  }
}

const EVENT = {
  id: 'evseatedxxxxx',
  slug: 'seated-night',
  title: 'A Seated Night',
  venue: { city: 'Edison', region: 'NJ', country: 'US' },
}

const BUYER = { name: 'Asha Patel', email: 'asha@example.test' }

/**
 * The hold the server answers with, for the seats asked.
 *
 * @param {string} sessionId The night.
 * @param {string[]} seatIds `Seat` ids.
 * @returns {object} The hold's `data`.
 */
function heldFor(sessionId, seatIds) {
  const all = [A1, A2, A3, B1]

  return {
    id: 'hdholdxxxxxxx',
    eventSessionId: sessionId,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    seats: seatIds.map((seatId) => ({
      ...all.find((entry) => entry.seatId === seatId),
      available: false,
    })),
    subtotalCents: 0,
    currency: 'USD',
  }
}

/**
 * A stand-in for the quote: each seat at its tier's price, SAVE10 takes 10%.
 *
 * @param {object} [options] Options.
 * @param {number} [options.extraCents] Added to the total, to play a figure that moved.
 * @returns {Function} The quote.
 */
function fakeQuote({ extraCents = 0 } = {}) {
  const prices = { [FRONT]: 4_500, [BACK]: 2_500 }

  return vi.fn(async ({ lines, promoCode }) => {
    const subtotalCents = lines.reduce(
      (sum, line) => sum + prices[line.ticketTypeId] * line.quantity,
      0,
    )
    const applied = promoCode === 'SAVE10'
    const discountCents = applied ? subtotalCents / 10 : 0

    return {
      currency: 'USD',
      subtotalCents,
      discountCents,
      feesCents: 0,
      taxCents: 0,
      totalCents: subtotalCents - discountCents + extraCents,
      lines: lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        name: line.ticketTypeId === FRONT ? 'Front stalls' : 'Back stalls',
        sessionId: 'snnightonexxx',
        quantity: line.quantity,
        unitPriceCents: prices[line.ticketTypeId],
        subtotalCents: prices[line.ticketTypeId] * line.quantity,
        discountCents: 0,
      })),
      promo: promoCode
        ? {
            code: promoCode,
            applied,
            reason: applied ? null : 'UNKNOWN',
            type: applied ? 'PERCENTAGE' : null,
            percentBps: applied ? 1000 : null,
            amountCents: null,
          }
        : null,
    }
  })
}

/**
 * Render the seat checkout.
 *
 * @param {object} [props] Props overriding the defaults.
 * @returns {{user: object, props: object}} A `userEvent` session and the props used.
 */
function renderCheckout(props = {}) {
  const all = {
    event: EVENT,
    initialMap: seatMap(),
    buyer: BUYER,
    signInHref: '/sign-in?next=%2Fevents%2Fseated-night%2Fseats%2Fsnnightonexxx',
    holdSeats: vi.fn(async (sessionId, seatIds) => heldFor(sessionId, seatIds)),
    loadSeatMap: vi.fn(async () => seatMap()),
    release: vi.fn(async () => undefined),
    quote: fakeQuote(),
    placeOrder: vi.fn(async () => ({
      id: 'orderxxxxxxxx',
      reference: 'DE-SEAT01',
      status: 'PAID',
      totalCents: 11_500,
      discountCents: 0,
      currency: 'USD',
      items: [],
    })),
    ...props,
  }

  render(<SeatCheckout {...all} />)

  return { user: userEvent.setup(), props: all }
}

/**
 * The seat button whose accessible name starts with `Seat <label>,`.
 *
 * @param {string} label The seat's label.
 * @returns {HTMLElement} The button.
 */
function seatButton(label) {
  return screen.getByRole('button', { name: new RegExp(`^Seat ${label},`, 'u') })
}

describe('choosing seats', () => {
  it('says in a polite status what each choice did, companions included', async () => {
    const { user } = renderCheckout()
    const status = screen
      .getAllByRole('status')
      .find((node) => node.closest('#your-selection') && !node.closest('form'))

    await user.click(seatButton('A1'))

    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Seat A1 added, with companion seat A2. 2 seats selected.')
    expect(screen.getByRole('list', { name: 'Chosen seats' })).toHaveTextContent(
      'Stalls, row A, seat A1',
    )
    expect(screen.getByRole('button', { name: 'Reserve 2 seats' })).toBeEnabled()

    await user.click(seatButton('A2'))

    expect(status).toHaveTextContent('Seats A1 and A2 removed together. 0 seats selected.')
    expect(screen.getByRole('button', { name: 'Choose seats to continue' })).toBeDisabled()
  })

  it('refuses a seat past the order’s limit, and says so', async () => {
    const { user } = renderCheckout({ initialMap: seatMap({ maxSeatsPerOrder: 2 }) })

    await user.click(seatButton('A1'))
    await user.click(seatButton('B1'))

    expect(screen.getByText('You can choose up to 2 seats in one order.')).toBeInTheDocument()
    expect(seatButton('B1')).toHaveAttribute('aria-pressed', 'false')
  })

  it('holds a mixed selection to the smallest limit among its tiers, and says whose', async () => {
    const map = seatMap()
    const { user } = renderCheckout({
      initialMap: {
        ...map,
        tiers: map.tiers.map((tier) => (tier.id === FRONT ? { ...tier, maxPerOrder: 1 } : tier)),
      },
    })

    // The page says it before anybody tries.
    expect(
      screen.getByText(/A selection with seats sold as “Front stalls” can have at most 1\./u),
    ).toBeInTheDocument()

    await user.click(seatButton('A3'))
    await user.click(seatButton('B1'))

    expect(
      screen.getByText(
        'Seats sold as "Front stalls" are sold at most 1 to an order, so this selection can have 1.',
      ),
    ).toBeInTheDocument()
    expect(seatButton('B1')).toHaveAttribute('aria-pressed', 'false')
  })

  it('will not reserve fewer seats of a tier than it sells at a time, companions counted', async () => {
    const map = seatMap()
    const { user, props } = renderCheckout({
      initialMap: {
        ...map,
        tiers: map.tiers.map((tier) => (tier.id === BACK ? { ...tier, minPerOrder: 2 } : tier)),
      },
    })

    expect(
      screen.getByText(/Seats sold as “Back stalls” are sold at least 2 at a time\./u),
    ).toBeInTheDocument()

    await user.click(seatButton('B1'))

    expect(screen.getByRole('button', { name: 'Reserve 1 seat' })).toBeDisabled()
    expect(
      screen.getByText(
        'Seats sold as “Back stalls” are sold at least 2 at a time, and you have chosen 1. Choose 1 more of them, or none.',
      ),
    ).toBeInTheDocument()
    expect(props.holdSeats).not.toHaveBeenCalled()
  })

  it('offers a way past the map to the selection', () => {
    renderCheckout()

    expect(screen.getByRole('link', { name: 'Skip to your selection' })).toHaveAttribute(
      'href',
      '#your-selection',
    )
  })
})

describe('reserving, naming and paying', () => {
  it('holds exactly the chosen seats, quotes them, and pays with one line per tier', async () => {
    const { user, props } = renderCheckout()

    await user.click(seatButton('A1'))
    await user.click(seatButton('B1'))
    await user.click(screen.getByRole('button', { name: 'Reserve 3 seats' }))

    expect(props.holdSeats).toHaveBeenCalledWith('snnightonexxx', [A1.seatId, A2.seatId, B1.seatId])
    await waitFor(() =>
      expect(props.quote).toHaveBeenCalledWith({
        eventId: EVENT.id,
        lines: [
          { ticketTypeId: FRONT, quantity: 2 },
          { ticketTypeId: BACK, quantity: 1 },
        ],
        promoCode: undefined,
        holdIds: ['hdholdxxxxxxx'],
      }),
    )
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$115.00')

    // A name for one seat; the others are left for the buyer's own name.
    await user.type(screen.getByLabelText('Seat A1, row A, Stalls — Front stalls'), '  Ravi Shah ')
    await user.click(screen.getByRole('button', { name: 'Pay $115.00 (simulated)' }))

    expect(props.placeOrder).toHaveBeenCalledTimes(1)

    const sent = props.placeOrder.mock.calls[0][0]

    expect(sent).toMatchObject({
      eventId: EVENT.id,
      buyer: BUYER,
      lines: [
        { ticketTypeId: FRONT, quantity: 2 },
        { ticketTypeId: BACK, quantity: 1 },
      ],
      holdIds: ['hdholdxxxxxxx'],
      promoCode: undefined,
      attendees: [{ ticketTypeId: FRONT, eventSeatId: A1.id, name: 'Ravi Shah' }],
      expectedTotalCents: 11_500,
    })
    expect(typeof sent.idempotencyKey).toBe('string')
    expect(await screen.findByRole('heading', { name: 'Booked' })).toBeInTheDocument()
  })

  it('refuses an address typed as a name before anything is sent', async () => {
    const { user, props } = renderCheckout()

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.type(
      await screen.findByLabelText('Seat A3, row A, Stalls — Front stalls'),
      'ravi@example.test',
    )

    expect(screen.getByText('Type the guest’s name, not an email address.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()
    expect(props.placeOrder).not.toHaveBeenCalled()
  })

  it('lets a name typed for a seat that was then dropped stop holding up Pay', async () => {
    const { user } = renderCheckout()

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.type(
      await screen.findByLabelText('Seat A3, row A, Stalls — Front stalls'),
      'ravi@example.test',
    )
    expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()

    // A different seat instead: the old seat's box, and what was typed in it, is gone.
    await user.click(seatButton('A3'))
    await user.click(seatButton('B1'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))

    expect(await screen.findByRole('button', { name: 'Pay $25.00 (simulated)' })).toBeEnabled()
    expect(screen.queryByText('One of the names needs changing before you can pay.')).toBeNull()
  })

  it('offers no Pay without the server’s total, says why, and asks again', async () => {
    const quote = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Too many requests.'), { status: 429, code: 'RATE_LIMITED' }),
      )
      .mockImplementation(fakeQuote())
    const { user, props } = renderCheckout({ quote })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))

    // No figure to pay against: no amount on the button, and no button to press.
    const waiting = await screen.findByRole('button', { name: 'Pay (simulated)' })
    expect(waiting).toBeDisabled()
    expect(screen.getByText('We could not get the total')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ask for the total again' }))

    const pay = await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' })
    expect(pay).toBeEnabled()
    await user.click(pay)

    expect(props.placeOrder.mock.calls[0][0]).toMatchObject({
      promoCode: undefined,
      expectedTotalCents: 4_500,
    })
  })

  it('never sends a code without the total quoted for it', async () => {
    const quote = vi
      .fn()
      .mockImplementationOnce(fakeQuote())
      .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch')))
      .mockImplementation(fakeQuote())
    const { user, props } = renderCheckout({ quote })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' })

    // The code's quote does not answer: nothing is payable until one does.
    await user.type(screen.getByLabelText('Promo code'), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByRole('button', { name: 'Pay (simulated)' })).toBeDisabled()
    expect(props.placeOrder).not.toHaveBeenCalled()

    // Asking again asks with the code, and pays the figure quoted for it.
    await user.click(screen.getByRole('button', { name: 'Ask for the total again' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $40.50 (simulated)' }))

    expect(props.placeOrder.mock.calls[0][0]).toMatchObject({
      promoCode: 'SAVE10',
      expectedTotalCents: 4_050,
    })
  })

  it('says a code chosen before reserving is checked then, not that it took', async () => {
    const { user, props } = renderCheckout()

    await user.click(seatButton('A3'))
    await user.type(screen.getByLabelText('Promo code'), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByText(
        'SAVE10 is checked when you reserve your seats. Until then the total above does not include it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/applied/u)).toBeNull()
    expect(props.quote).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))

    expect(await screen.findByText('SAVE10 applied: 10% off.')).toBeInTheDocument()
    expect(props.quote).toHaveBeenCalledWith(expect.objectContaining({ promoCode: 'SAVE10' }))
  })

  it('gives the hold back when the selection changes after reserving', async () => {
    const { user, props } = renderCheckout()

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await screen.findByRole('button', { name: /^Pay / })
    await user.click(seatButton('B1'))

    expect(props.release).toHaveBeenCalledWith(['hdholdxxxxxxx'])
    expect(screen.getByRole('button', { name: 'Reserve 2 seats' })).toBeInTheDocument()
  })

  it('applies a code against the held seats and sends it with the order', async () => {
    const { user, props } = renderCheckout()

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' })
    await user.type(screen.getByLabelText('Promo code'), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('SAVE10 applied: 10% off.')).toBeInTheDocument()
    expect(screen.getByTestId('summary-discount')).toHaveTextContent('$4.50')
    expect(screen.getByText('Discount (SAVE10)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pay $40.50 (simulated)' }))

    expect(props.placeOrder.mock.calls[0][0]).toMatchObject({
      promoCode: 'SAVE10',
      expectedTotalCents: 4_050,
    })
  })

  it('re-quotes when the total moved, charges nothing, and asks to pay again', async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('The total changed.'), { status: 409, code: 'PRICE_CHANGED' }),
      )
      .mockResolvedValue({
        id: 'orderxxxxxxxx',
        reference: 'DE-SEAT02',
        status: 'PAID',
        totalCents: 4_600,
        discountCents: 0,
        currency: 'USD',
        items: [],
      })
    const quote = vi
      .fn()
      .mockImplementationOnce(fakeQuote())
      .mockImplementation(fakeQuote({ extraCents: 100 }))
    const { user } = renderCheckout({ placeOrder, quote })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' }))

    expect(
      await screen.findByText(
        'The total is now $46.00. Nothing was charged. Check the summary and pay again.',
      ),
    ).toBeInTheDocument()
    expect(quote).toHaveBeenCalledTimes(2)

    const firstKey = placeOrder.mock.calls[0][0].idempotencyKey

    await user.click(screen.getByRole('button', { name: 'Pay $46.00 (simulated)' }))

    expect(placeOrder.mock.calls[1][0].expectedTotalCents).toBe(4_600)
    expect(placeOrder.mock.calls[1][0].idempotencyKey).not.toBe(firstKey)
  })
})

describe('a payment that did not end in a booking', () => {
  const TIMEOUT =
    'The payment provider did not respond in time, so whether you were charged is being checked. Your order keeps its tickets reserved until that is settled; please do not pay again.'

  it('after a timed-out payment shows the API’s sentence, takes Pay away and links to the order', async () => {
    const placeOrder = vi.fn().mockRejectedValue(
      Object.assign(new Error(TIMEOUT), {
        status: 502,
        code: 'PAYMENT_TIMEOUT',
        orderReference: 'DE-SEAT09',
      }),
    )
    const { user, props } = renderCheckout({ placeOrder })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' }))

    expect(await screen.findByText(TIMEOUT)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See order DE-SEAT09' })).toHaveAttribute(
      'href',
      '/account/orders/DE-SEAT09',
    )
    expect(screen.getByRole('button', { name: 'Pay $45.00 (simulated)' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Booked' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/try again|went wrong at our end/i)
    // The seat stays the order's: nothing gives it back or reads the map as lost.
    expect(props.release).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText(TIMEOUT).closest('[tabindex="-1"]')),
    )
  })

  it('never shows an order that came back unpaid as booked', async () => {
    const placeOrder = vi.fn(async () => ({
      id: 'orderxxxxxxxx',
      reference: 'DE-SEAT09',
      status: 'PENDING',
      totalCents: 4_500,
      discountCents: 0,
      currency: 'USD',
      items: [],
    }))
    const { user } = renderCheckout({ placeOrder })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' }))

    expect(await screen.findByText('Not booked')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Booked' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See order DE-SEAT09' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay $45.00 (simulated)' })).toBeDisabled()
  })

  it('makes a declined payment a new attempt against the same hold', async () => {
    const declined = Object.assign(
      new Error(
        'The payment was declined, and nothing was charged. Your reservation is kept, so you can try again.',
      ),
      { status: 402, code: 'PAYMENT_DECLINED' },
    )
    const placeOrder = vi.fn().mockRejectedValueOnce(declined).mockResolvedValue({
      id: 'orderxxxxxxxx',
      reference: 'DE-SEAT10',
      status: 'PAID',
      totalCents: 4_500,
      discountCents: 0,
      currency: 'USD',
      items: [],
    })
    const { user } = renderCheckout({ placeOrder })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' }))

    expect(await screen.findByText('The payment was declined')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pay $45.00 (simulated)' }))
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[1][0].holdIds).toEqual(['hdholdxxxxxxx'])
    expect(placeOrder.mock.calls[1][0].idempotencyKey).not.toBe(
      placeOrder.mock.calls[0][0].idempotencyKey,
    )
  })

  it('says the order was cancelled, in the API’s words, and gives the hold back', async () => {
    const message =
      'The order could not be completed, so it was cancelled. Nothing was charged; reserve the tickets again to carry on.'
    const placeOrder = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(message), { status: 409, code: 'ORDER_CANCELLED' }),
      )
    const { user, props } = renderCheckout({ placeOrder })

    await user.click(seatButton('A3'))
    await user.click(screen.getByRole('button', { name: 'Reserve 1 seat' }))
    await user.click(await screen.findByRole('button', { name: 'Pay $45.00 (simulated)' }))

    expect(await screen.findByText('The order was cancelled')).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(props.release).toHaveBeenCalledWith(['hdholdxxxxxxx'])
  })
})

describe('a seat that went while choosing', () => {
  it('reads the map again, names the seat that went and keeps the rest', async () => {
    const holdSeats = vi.fn().mockRejectedValue(
      Object.assign(new Error('A seat is no longer available.'), {
        status: 422,
        code: 'SEAT_UNAVAILABLE',
      }),
    )
    const loadSeatMap = vi.fn(async () => seatMap({ seats: { B1: { ...B1, available: false } } }))
    const { user } = renderCheckout({ holdSeats, loadSeatMap })

    await user.click(seatButton('A3'))
    await user.click(seatButton('B1'))
    await user.click(screen.getByRole('button', { name: 'Reserve 2 seats' }))

    expect(
      await screen.findByText(/Seat B1 was taken by somebody else while you were choosing\./u),
    ).toBeInTheDocument()
    expect(loadSeatMap).toHaveBeenCalledWith('snnightonexxx')
    expect(seatButton('B1')).toHaveAttribute('aria-disabled', 'true')
    expect(seatButton('B1')).toHaveAttribute('aria-pressed', 'false')
    expect(seatButton('A3')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Reserve 1 seat' })).toBeEnabled()
  })
})

describe('a visitor who is not signed in', () => {
  it('sees every price and a way to sign in, and cannot reserve or use a code', async () => {
    const { user, props } = renderCheckout({ buyer: null })

    await user.click(seatButton('A3'))

    // The browser's estimate, fees included; the server quotes the real figure once a seat is held.
    expect(screen.getByTestId('summary-subtotal')).toHaveTextContent('$45.00')
    expect(screen.getByRole('link', { name: 'Sign in to reserve' })).toHaveAttribute(
      'href',
      props.signInHref,
    )
    expect(screen.queryByRole('button', { name: /^Reserve/u })).toBeNull()
    expect(screen.getByText('You can use a promo code after signing in.')).toBeInTheDocument()
    expect(props.holdSeats).not.toHaveBeenCalled()
  })
})

describe('a night that is not selling', () => {
  it('shows the map and says none of it can be reserved now', async () => {
    const map = seatMap()
    const { user } = renderCheckout({
      initialMap: { ...map, tiers: map.tiers.map((tier) => ({ ...tier, onSale: false })) },
    })

    expect(screen.getByText('These seats are not on sale now')).toBeInTheDocument()

    await user.click(seatButton('A3'))

    expect(screen.getByRole('button', { name: 'Reserve 1 seat' })).toBeDisabled()
  })
})
