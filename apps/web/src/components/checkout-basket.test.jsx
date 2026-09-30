import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { formatAmount, priceSelection } from '../lib/pricing.js'
import { CheckoutBasket, maxSelectable } from './checkout-basket.jsx'

const event = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  // The venue decides the tax jurisdiction, so the basket needs one.
  venue: { city: 'Mumbai', region: 'MH', country: 'IN' },
}

const ticketTypes = [
  {
    id: 'ttqawwaligarden',
    name: 'Garden Seating',
    description: 'Reserved chairs on the lawn.',
    priceCents: 249_900,
    currency: 'INR',
    minPerOrder: 1,
    maxPerOrder: 6,
    availableQuantity: 288,
    isSoldOut: false,
  },
  {
    id: 'ttqawwalilawn',
    name: 'Lawn Entry',
    description: 'Unreserved standing space.',
    priceCents: 99_900,
    currency: 'INR',
    minPerOrder: 1,
    maxPerOrder: 10,
    availableQuantity: 3,
    isSoldOut: false,
  },
  {
    id: 'ttqawwalimehfil',
    name: 'Mehfil Floor',
    priceCents: 449_900,
    currency: 'INR',
    minPerOrder: 1,
    maxPerOrder: 4,
    availableQuantity: 0,
    isSoldOut: true,
  },
]

/**
 * Render the basket.
 *
 * @param {object} [props] Props overriding the defaults.
 * @returns {object} A `userEvent` session bound to the rendered document.
 */
function renderBasket(props = {}) {
  render(
    <CheckoutBasket
      event={event}
      ticketTypes={ticketTypes}
      buyer={BUYER}
      reserve={vi.fn().mockResolvedValue([])}
      release={vi.fn().mockResolvedValue(undefined)}
      quote={fakeQuote()}
      placeOrder={vi.fn()}
      {...props}
    />,
  )

  return userEvent.setup()
}

/**
 * A stand-in for `POST /v1/orders/quote`: the browser's own pricing, and a 10%
 * code called SAVE10. Every other code is one the organiser does not have.
 *
 * @param {object} [options] Options.
 * @param {number} [options.extraCents] Added to the total, to play a server whose figure moved.
 * @returns {Function} The quote function.
 */
function fakeQuote({ extraCents = 0 } = {}) {
  return vi.fn(async ({ lines, promoCode }) => {
    const priced = priceSelection({
      lines,
      currency: 'INR',
      place: { country: event.venue.country, region: event.venue.region },
    })
    const applied = promoCode === 'SAVE10'
    const discountCents = applied ? Math.round(priced.subtotalCents / 10) : 0

    return {
      currency: 'INR',
      subtotalCents: priced.subtotalCents,
      discountCents,
      feesCents: priced.feesCents,
      taxCents: priced.taxCents,
      totalCents: priced.totalCents - discountCents + extraCents,
      lines: priced.lineItems.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        name: line.name,
        sessionId: null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        subtotalCents: line.subtotalCents,
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
      pricedAt: '2026-10-01T10:00:00.000Z',
    }
  })
}

/** A signed-in buyer: their own name and address, as the checkout page passes them. */
const BUYER = { name: 'Meera Iyer', email: 'meera@example.com' }

/** Two holds, as the API returns them. */
const HOLDS = [
  { id: 'ckhold00000000000000001', expiresAt: '2026-10-01T10:10:00.000Z' },
  { id: 'ckhold00000000000000002', expiresAt: '2026-10-01T10:10:00.000Z' },
]

/** An order, as the API returns it. */
const ORDER = {
  reference: 'DE-7K2M9Q',
  status: 'PAID',
  currency: 'INR',
  totalCents: 297_562,
  tickets: [{ id: 'cktk1' }, { id: 'cktk2' }],
}

describe('maxSelectable', () => {
  it('is capped by the organiser’s per-order limit', () => {
    expect(maxSelectable({ maxPerOrder: 4, availableQuantity: 500, isSoldOut: false })).toBe(4)
  })

  it('is capped by what is actually left', () => {
    expect(maxSelectable({ maxPerOrder: 10, availableQuantity: 3, isSoldOut: false })).toBe(3)
  })

  it('is zero for a sold-out tier even if a stale count says otherwise', () => {
    expect(maxSelectable({ maxPerOrder: 10, availableQuantity: 50, isSoldOut: true })).toBe(0)
  })
})

describe('CheckoutBasket', () => {
  it('starts empty, with nothing to pay and no way to continue', () => {
    renderBasket()

    expect(screen.getByText('No tickets selected')).toBeInTheDocument()
    expect(screen.getByTestId('summary-total')).toHaveTextContent('₹0.00')
    expect(screen.getByRole('button', { name: 'Select tickets to continue' })).toBeDisabled()
  })

  it('offers a stepper for every tier still on sale and none for a sold-out one', () => {
    renderBasket()

    expect(screen.getByLabelText('Quantity of Garden Seating')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity of Lawn Entry')).toBeInTheDocument()
    expect(screen.queryByLabelText('Quantity of Mehfil Floor')).not.toBeInTheDocument()
    // Once as the tier's availability line, once as the badge beside it.
    expect(screen.getAllByText('Sold out')).toHaveLength(2)
  })

  it('tells the buyer the per-order cap, taking availability into account', () => {
    renderBasket()

    expect(screen.getByText(/up to 6 per order/)).toBeInTheDocument()
    expect(screen.getByText(/up to 3 per order/)).toBeInTheDocument()
  })

  it('prices a selection exactly as computeOrderTotals does', async () => {
    const user = renderBasket()

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))

    const expected = priceSelection({
      lines: [
        {
          ticketTypeId: 'ttqawwaligarden',
          name: 'Garden Seating',
          quantity: 2,
          unitPriceCents: 249_900,
        },
      ],
      currency: 'INR',
      place: { country: event.venue.country, region: event.venue.region },
    })

    expect(screen.getByTestId('summary-subtotal')).toHaveTextContent(
      formatAmount(expected.subtotalCents, 'INR'),
    )
    expect(screen.getByTestId('summary-total')).toHaveTextContent(
      formatAmount(expected.totalCents, 'INR'),
    )
    expect(expected.totalCents).toBeGreaterThan(expected.subtotalCents)
  })

  it('adds a line to the summary for each tier chosen', async () => {
    const user = renderBasket()

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Add one Lawn Entry' }))

    expect(screen.getByText('2 tickets for Qawwali Under the Banyan')).toBeInTheDocument()
    expect(screen.getByText(/Garden Seating/, { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByText(/Lawn Entry/, { selector: 'dt' })).toBeInTheDocument()
  })

  it('names the tax of the jurisdiction the event is held in', () => {
    renderBasket()

    expect(screen.getByText('GST (18%)')).toBeInTheDocument()
  })

  it('names the tax by venue country, not by the currency it is priced in', () => {
    // The same rupee prices, held in London: VAT, not GST. Deciding tax from
    // the currency got this backwards.
    render(
      <CheckoutBasket
        event={{ ...event, venue: { ...event.venue, country: 'GB', region: null } }}
        ticketTypes={ticketTypes}
        reserve={vi.fn()}
      />,
    )

    expect(screen.getByText('VAT (20%)')).toBeInTheDocument()
  })

  it('removes the line again when the quantity goes back to zero', async () => {
    const user = renderBasket()

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Remove one Garden Seating' }))

    expect(screen.getByText('No tickets selected')).toBeInTheDocument()
    expect(screen.getByTestId('summary-total')).toHaveTextContent('₹0.00')
  })

  it('will not let a buyer take more than is left', async () => {
    const user = renderBasket()

    for (let click = 0; click < 5; click += 1) {
      const add = screen.getByRole('button', { name: 'Add one Lawn Entry' })
      if (add.disabled) break
      await user.click(add)
    }

    expect(screen.getByLabelText('Quantity of Lawn Entry')).toHaveValue(3)
    expect(screen.getByRole('button', { name: 'Add one Lawn Entry' })).toBeDisabled()
  })

  it('reserves exactly what was selected', async () => {
    const reserve = vi.fn().mockResolvedValue([])
    const user = renderBasket({ reserve })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    expect(reserve).toHaveBeenCalledWith([
      expect.objectContaining({ ticketTypeId: 'ttqawwaligarden', quantity: 1 }),
    ])
    expect(await screen.findByText('Tickets held')).toBeInTheDocument()
  })

  it('says plainly that nothing was reserved when the service is unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reserve = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const user = renderBasket({ reserve })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    expect(await screen.findByText('We could not reach the ticketing service')).toBeInTheDocument()
    expect(screen.getByText(/you have not been charged/)).toBeInTheDocument()
  })

  it('never shows a raw error message to the buyer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reserve = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:4000'))
    const user = renderBasket({ reserve })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    await screen.findByText('We could not reach the ticketing service')
    expect(document.body.textContent).not.toContain('ECONNREFUSED')
  })

  it('clears a stale outcome as soon as the selection changes, and gives the holds back', async () => {
    const reserve = vi.fn().mockResolvedValue(HOLDS)
    const release = vi.fn().mockResolvedValue(undefined)
    const user = renderBasket({ reserve, release })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await screen.findByText('Tickets held')

    await user.click(screen.getByRole('button', { name: 'Add one Lawn Entry' }))

    expect(screen.queryByText('Tickets held')).not.toBeInTheDocument()
    expect(release).toHaveBeenCalledWith(HOLDS.map((hold) => hold.id))
  })
})

describe('buying', () => {
  it('asks a signed-out visitor to sign in, and comes back here, before anything is held', async () => {
    const reserve = vi.fn()
    const user = renderBasket({
      buyer: null,
      reserve,
      signInHref: '/sign-in?next=%2Fevents%2Fqawwali-under-the-banyan%2Fcheckout',
    })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))

    const link = screen.getByRole('link', { name: 'Sign in to buy' })

    expect(link.getAttribute('href')).toBe(
      '/sign-in?next=%2Fevents%2Fqawwali-under-the-banyan%2Fcheckout',
    )
    expect(screen.queryByRole('button', { name: 'Reserve tickets' })).not.toBeInTheDocument()
    // The price is still shown in full before signing in.
    expect(screen.getByTestId('summary-total')).not.toHaveTextContent('₹0.00')
    expect(reserve).not.toHaveBeenCalled()
  })

  it('holds, then books with the simulated payment, spending exactly those holds once', async () => {
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    const pay = await screen.findByRole('button', { name: /^Pay .* \(simulated\)$/ })

    expect(screen.getByText(/no money moves/)).toBeInTheDocument()

    await user.click(pay)

    expect(await screen.findByRole('heading', { name: 'Booked' })).toBeInTheDocument()
    expect(placeOrder).toHaveBeenCalledTimes(1)

    const [request] = placeOrder.mock.calls[0]

    expect(request).toMatchObject({
      eventId: event.id,
      buyer: BUYER,
      holdIds: HOLDS.map((hold) => hold.id),
    })
    expect(request.lines).toEqual([
      expect.objectContaining({ ticketTypeId: 'ttqawwaligarden', quantity: 1 }),
    ])
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('says the booking was simulated, and where the tickets are', async () => {
    const user = renderBasket({
      reserve: vi.fn().mockResolvedValue(HOLDS),
      placeOrder: vi.fn().mockResolvedValue(ORDER),
    })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    await screen.findByRole('heading', { name: 'Booked' })

    expect(screen.getByText('DE-7K2M9Q')).toBeInTheDocument()
    expect(screen.getByText(/no card was asked for and no money moved/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Your tickets' })).toHaveAttribute('href', '/tickets')
    expect(screen.getByRole('link', { name: 'This order' })).toHaveAttribute(
      'href',
      '/account/orders/DE-7K2M9Q',
    )
    expect(document.body.textContent).not.toMatch(/payment successful|charged to your card/i)
  })

  it('retries a lost answer with the same key, so one attempt cannot book twice', async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    expect(await screen.findByText(/Trying again is safe/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0].idempotencyKey).toBe(
      placeOrder.mock.calls[1][0].idempotencyKey,
    )
  })

  it.each([
    [
      502,
      'PAYMENT_TIMEOUT',
      'The payment provider did not respond in time, so whether you were charged is being checked. Your order keeps its tickets reserved until that is settled; please do not pay again.',
    ],
    [
      500,
      'ORDER_NOT_COMPLETED',
      'Your payment was taken, but the order could not be completed. It has been passed to our team to settle or refund; please do not pay again.',
    ],
    [
      409,
      'ORDER_PENDING',
      "This attempt already placed order DE-7K2M9Q, and whether its payment went through is still being checked. Nothing more has been charged; please do not pay again. The order's page shows where it stands.",
    ],
  ])(
    'after a %i %s shows the API’s own sentence, takes Pay away and links to the order',
    async (status, code, message) => {
      const placeOrder = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error(message), { status, code, orderReference: 'DE-7K2M9Q' }),
        )
      const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

      await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
      await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
      await user.click(await screen.findByRole('button', { name: /^Pay / }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.getByText('Please do not pay again')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'See order DE-7K2M9Q' })).toHaveAttribute(
        'href',
        '/account/orders/DE-7K2M9Q',
      )
      expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()
      expect(document.body.textContent).not.toMatch(/try again|went wrong at our end/i)
      expect(screen.queryByRole('heading', { name: 'Booked' })).not.toBeInTheDocument()
      // Nothing on the screen can spend the holds again, or give them away.
      expect(screen.getByRole('button', { name: 'Add one Garden Seating' })).toBeDisabled()
      // Focus follows the notice, since the button it was on is disabled.
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByText(message).closest('[tabindex="-1"]')),
      )
      expect(placeOrder).toHaveBeenCalledTimes(1)
    },
  )

  it('never shows an order that came back unpaid as booked', async () => {
    const pending = { ...ORDER, status: 'PENDING', tickets: [] }
    const user = renderBasket({
      reserve: vi.fn().mockResolvedValue(HOLDS),
      placeOrder: vi.fn().mockResolvedValue(pending),
    })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    expect(await screen.findByText('Not booked')).toBeInTheDocument()
    expect(screen.getByText(/nothing is booked yet\. Please do not pay again/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Booked' })).not.toBeInTheDocument()
    expect(screen.queryByText(/tickets are in your account/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See order DE-7K2M9Q' })).toHaveAttribute(
      'href',
      '/account/orders/DE-7K2M9Q',
    )
    expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()
  })

  it('makes a declined payment a new attempt, with the holds kept', async () => {
    const declined = Object.assign(
      new Error(
        'The payment was declined, and nothing was charged. Your reservation is kept, so you can try again.',
      ),
      { status: 402, code: 'PAYMENT_DECLINED' },
    )
    const placeOrder = vi.fn().mockRejectedValueOnce(declined).mockResolvedValueOnce(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    expect(await screen.findByText('The payment was declined')).toBeInTheDocument()
    expect(screen.getByText(declined.message)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/went wrong at our end/)

    await user.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByRole('heading', { name: 'Booked' })

    // The same holds, and a new key: the declined attempt's would be declined again.
    expect(placeOrder.mock.calls[1][0].holdIds).toEqual(HOLDS.map((hold) => hold.id))
    expect(placeOrder.mock.calls[1][0].idempotencyKey).not.toBe(
      placeOrder.mock.calls[0][0].idempotencyKey,
    )
  })

  it('gives the holds back and asks to reserve again when the order was cancelled', async () => {
    const cancelled = Object.assign(
      new Error(
        'The order could not be completed, so it was cancelled. Nothing was charged; reserve the tickets again to carry on.',
      ),
      { status: 409, code: 'ORDER_CANCELLED' },
    )
    const release = vi.fn().mockResolvedValue(undefined)
    const user = renderBasket({
      reserve: vi.fn().mockResolvedValue(HOLDS),
      release,
      placeOrder: vi.fn().mockRejectedValue(cancelled),
    })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    expect(await screen.findByText('The order was cancelled')).toBeInTheDocument()
    expect(screen.getByText(cancelled.message)).toBeInTheDocument()
    expect(release).toHaveBeenCalledWith(HOLDS.map((hold) => hold.id))
    expect(screen.getByRole('button', { name: 'Reserve tickets' })).toBeEnabled()
  })

  it('says the hold ran out, charges nothing, and asks to reserve again', async () => {
    const expired = Object.assign(new Error('Hold expired'), {
      status: 410,
      code: 'HOLD_EXPIRED',
    })
    const user = renderBasket({
      reserve: vi.fn().mockResolvedValue(HOLDS),
      placeOrder: vi.fn().mockRejectedValue(expired),
    })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay / }))

    expect(await screen.findByText('The hold ran out')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was charged/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reserve tickets' })).toBeEnabled()
  })

  it('shows the API’s reason when a hold is refused, not its raw wording for a server fault', async () => {
    const refused = Object.assign(new Error('This event is not on sale.'), {
      status: 422,
      code: 'UNPROCESSABLE',
    })
    const user = renderBasket({ reserve: vi.fn().mockRejectedValue(refused) })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    expect(await screen.findByText('Nothing was reserved')).toBeInTheDocument()
    expect(screen.getByText('This event is not on sale.')).toBeInTheDocument()
  })

  it('shows a seated tier with no seat map to choose from, and does not sell it here', () => {
    renderBasket({
      ticketTypes: [
        ...ticketTypes,
        {
          id: 'ttqawwalibalcony',
          name: 'Balcony',
          priceCents: 199_900,
          currency: 'INR',
          reserved: true,
          availableQuantity: 0,
          isSoldOut: true,
        },
      ],
    })

    expect(screen.queryByLabelText('Quantity of Balcony')).not.toBeInTheDocument()
    expect(screen.getByText('Not sold here')).toBeInTheDocument()
    expect(screen.getByText(/there is no seat map to choose from here/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Choose seats' })).toBeNull()
  })

  it('sends a seated tier whose night has a seat map to that map', () => {
    renderBasket({
      event: {
        ...event,
        sessions: [
          {
            id: 'cksessionbalcony00000001',
            label: 'Night 1',
            startsAt: '2026-10-11T13:30:00.000Z',
            endsAt: '2026-10-11T18:30:00.000Z',
            timezone: 'Asia/Kolkata',
            status: 'SCHEDULED',
            hasSeatMap: true,
            seatsAvailable: 12,
          },
        ],
      },
      ticketTypes: [
        ...ticketTypes,
        {
          id: 'ttqawwalibalcony',
          name: 'Balcony',
          priceCents: 199_900,
          currency: 'INR',
          reserved: true,
          eventSessionId: 'cksessionbalcony00000001',
          availableQuantity: 12,
          isSoldOut: false,
        },
      ],
    })

    expect(screen.queryByLabelText('Quantity of Balcony')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose seats' })).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan/seats/cksessionbalcony00000001',
    )
    expect(screen.queryByText('Not sold here')).toBeNull()
  })

  it('says a seated tier whose own seats are gone is sold out, whatever the night has left', () => {
    renderBasket({
      event: {
        ...event,
        sessions: [
          {
            id: 'cksessionbalcony00000001',
            label: 'Night 1',
            startsAt: '2026-10-11T13:30:00.000Z',
            endsAt: '2026-10-11T18:30:00.000Z',
            timezone: 'Asia/Kolkata',
            status: 'SCHEDULED',
            hasSeatMap: true,
            // Another zone's seats.
            seatsAvailable: 12,
          },
        ],
      },
      ticketTypes: [
        ...ticketTypes,
        {
          id: 'ttqawwalibalcony',
          name: 'Balcony',
          priceCents: 199_900,
          currency: 'INR',
          reserved: true,
          eventSessionId: 'cksessionbalcony00000001',
          availableQuantity: 0,
          isSoldOut: true,
        },
      ],
    })

    expect(screen.queryByRole('link', { name: 'Choose seats' })).toBeNull()

    const row = screen.getByText('Balcony').closest('li')
    expect(within(row).getByText('Sold out')).toBeInTheDocument()
  })
})

describe('the basket for an event in the United States', () => {
  const edison = {
    id: 'evtnavratrinightone',
    slug: 'navratri-night-one-edison',
    title: 'Navratri Night One: Garba Under the Lights',
    category: 'GARBA_DANDIYA',
    startsAt: '2026-10-11T23:30:00.000Z',
    timezone: 'America/New_York',
    venue: { city: 'Edison', region: 'NJ', country: 'US' },
    feeTerms: [{ currency: 'USD', percentageBps: 590, flatCents: 99 }],
  }
  const tiers = [
    {
      id: 'ttedisongeneral',
      name: 'General Admission',
      priceCents: 3500,
      currency: 'USD',
      minPerOrder: 1,
      maxPerOrder: 10,
      availableQuantity: 400,
      isSoldOut: false,
    },
  ]

  it('prices in dollars and says US sales tax is not calculated here', () => {
    render(<CheckoutBasket event={edison} ticketTypes={tiers} buyer={BUYER} />)

    expect(screen.getByTestId('summary-total')).toHaveTextContent('$0.00')
    expect(screen.getByText('Sales tax', { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByText('US sales tax is not calculated in this demo')).toBeInTheDocument()
  })

  it('shows each tier with what one ticket comes to with the booking fee', () => {
    render(<CheckoutBasket event={edison} ticketTypes={tiers} buyer={BUYER} />)

    // The same figure the event page and the card quote: $35.00 face, $38.06 with fees.
    expect(screen.getByText('$38.06 with fees')).toBeInTheDocument()
  })

  it('totals a selection with the event’s own fee terms', async () => {
    const user = userEvent.setup()

    render(<CheckoutBasket event={edison} ticketTypes={tiers} buyer={BUYER} />)
    await user.click(screen.getByRole('button', { name: 'Add one General Admission' }))
    await user.click(screen.getByRole('button', { name: 'Add one General Admission' }))

    expect(screen.getByTestId('summary-subtotal')).toHaveTextContent('$70.00')
    // 5.9% of $70.00 is $4.13, plus $0.99 a ticket: $6.11 in fees.
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$76.11')
  })

  it('shows the poster beside the summary as decoration, not as a second image', () => {
    const { container } = render(
      <CheckoutBasket event={edison} ticketTypes={tiers} buyer={BUYER} />,
    )

    const poster = container.querySelector('[data-slot="poster"]')

    expect(poster.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the approved cover there instead when there is one, still as decoration', () => {
    const { container } = render(
      <CheckoutBasket
        event={{
          ...edison,
          coverImage: {
            id: 'cmedia0000000000000000001',
            url: '/v1/media/cmedia0000000000000000001',
            altText: 'Dancers circling a lit garbo',
            width: 1200,
            height: 800,
            contentType: 'image/jpeg',
          },
        }}
        ticketTypes={tiers}
        buyer={BUYER}
      />,
    )

    const cover = container.querySelector('[data-slot="event-art"] img')

    expect(container.querySelector('[data-slot="poster"]')).toBeNull()
    expect(cover).toHaveAttribute('alt', '')
    expect(cover.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  /**
   * The server's quote for an Edison basket, in dollars with the event's fees.
   *
   * @returns {Function} The quote function.
   */
  const dollarQuote = () =>
    vi.fn(async ({ lines }) => {
      const priced = priceSelection({
        lines,
        currency: 'USD',
        place: { country: 'US', region: 'NJ' },
        feeTerms: edison.feeTerms,
      })

      return {
        currency: 'USD',
        subtotalCents: priced.subtotalCents,
        discountCents: 0,
        feesCents: priced.feesCents,
        taxCents: priced.taxCents,
        totalCents: priced.totalCents,
        lines: [],
        promo: null,
        pricedAt: '2026-10-01T10:00:00.000Z',
      }
    })

  it('names the event on the booking once it is placed', async () => {
    const user = userEvent.setup()

    render(
      <CheckoutBasket
        event={edison}
        ticketTypes={tiers}
        buyer={BUYER}
        reserve={vi.fn().mockResolvedValue(HOLDS)}
        quote={dollarQuote()}
        placeOrder={vi.fn().mockResolvedValue({ ...ORDER, currency: 'USD', totalCents: 3806 })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add one General Admission' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await user.click(await screen.findByRole('button', { name: /^Pay \$38\.06 \(simulated\)$/ }))

    const booked = (await screen.findByRole('heading', { name: 'Booked' })).closest('section')

    expect(booked).toHaveTextContent('Navratri Night One: Garba Under the Lights')
    expect(booked).toHaveTextContent('$38.06')
  })

  it('offers no Pay without the server’s total, says why, and asks again', async () => {
    const user = userEvent.setup()
    const quote = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(dollarQuote())
    const placeOrder = vi.fn().mockResolvedValue({ ...ORDER, currency: 'USD', totalCents: 3806 })

    render(
      <CheckoutBasket
        event={edison}
        ticketTypes={tiers}
        buyer={BUYER}
        reserve={vi.fn().mockResolvedValue(HOLDS)}
        quote={quote}
        placeOrder={placeOrder}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add one General Admission' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))

    // The estimate is not a figure to pay: no amount on the button, and no button to press.
    const waiting = await screen.findByRole('button', { name: 'Pay (simulated)' })
    expect(waiting).toBeDisabled()
    expect(screen.getByText('We could not get the total')).toBeInTheDocument()
    expect(placeOrder).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Ask for the total again' }))

    const pay = await screen.findByRole('button', { name: /^Pay \$38\.06 \(simulated\)$/ })
    expect(pay).toBeEnabled()
    expect(screen.queryByText('We could not get the total')).toBeNull()

    await user.click(pay)

    expect(placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ expectedTotalCents: 3806, promoCode: undefined }),
    )
  })
})

describe('the server’s quote, promo codes and guests’ names', () => {
  /**
   * Choose one Garden Seating and reserve it.
   *
   * @param {object} user A userEvent session.
   * @param {number} [count] How many.
   * @returns {Promise<void>} Resolves once held.
   */
  async function holdGarden(user, count = 1) {
    for (let index = 0; index < count; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))
    }
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await screen.findByText('Tickets held')
  }

  it('prices the held tickets with the server’s quote, and pays exactly that figure', async () => {
    const quote = fakeQuote()
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), quote, placeOrder })

    await holdGarden(user)

    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: event.id, holdIds: HOLDS.map((hold) => hold.id) }),
    )

    const quoted = await quote.mock.results[0].value
    const pay = await screen.findByRole('button', {
      name: `Pay ${formatAmount(quoted.totalCents, 'INR')} (simulated)`,
    })

    await user.click(pay)
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0].expectedTotalCents).toBe(quoted.totalCents)
  })

  it('applies a code: the discount is a line of its own, and the pay button names the new total', async () => {
    const quote = fakeQuote()
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), quote, placeOrder })

    await holdGarden(user, 2)

    await user.type(screen.getByLabelText('Promo code'), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('SAVE10 applied: 10% off.')).toBeInTheDocument()

    const discounted = await quote.mock.results.at(-1).value
    expect(screen.getByText('Discount (SAVE10)')).toBeInTheDocument()
    expect(screen.getByTestId('summary-discount')).toHaveTextContent(
      formatAmount(discounted.discountCents, 'INR'),
    )
    expect(screen.getByTestId('summary-total')).toHaveTextContent(
      formatAmount(discounted.totalCents, 'INR'),
    )

    await user.click(
      screen.getByRole('button', {
        name: `Pay ${formatAmount(discounted.totalCents, 'INR')} (simulated)`,
      }),
    )
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0]).toMatchObject({
      promoCode: 'SAVE10',
      expectedTotalCents: discounted.totalCents,
    })
  })

  it('says why a code gave nothing, and does not send it with the order', async () => {
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await holdGarden(user)

    await user.type(screen.getByLabelText('Promo code'), 'NOTACODE')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('That code is not valid for this event.')).toBeInTheDocument()
    expect(screen.queryByTestId('summary-discount')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0].promoCode).toBeUndefined()
  })

  it('asks a signed-out visitor to sign in before using a code', async () => {
    const user = renderBasket({ buyer: null })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))

    expect(screen.getByText('You can use a promo code after signing in.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Promo code')).toBeNull()
  })

  it('offers a name for each held ticket, and sends only the ones typed', async () => {
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    expect(screen.queryByRole('group', { name: 'Who is going?' })).toBeNull()

    await holdGarden(user, 3)

    const names = screen.getByRole('group', { name: 'Who is going?' })
    expect(names).toHaveTextContent('Leave a box blank to put your own name, Meera Iyer')

    await user.type(screen.getByLabelText('Ticket 1 of 3 — Garden Seating'), 'Asha Patel')
    await user.type(screen.getByLabelText('Ticket 3 of 3 — Garden Seating'), '  Ravi Patel ')

    await user.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0].attendees).toEqual([
      { ticketTypeId: 'ttqawwaligarden', name: 'Asha Patel' },
      { ticketTypeId: 'ttqawwaligarden', name: 'Ravi Patel' },
    ])
    expect(screen.getByText(/Each ticket carries the name you gave it/)).toBeInTheDocument()
  })

  it('refuses an address typed as a name before anything is sent', async () => {
    const placeOrder = vi.fn()
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await holdGarden(user)

    const box = screen.getByLabelText('Ticket 1 of 1 — Garden Seating')
    await user.type(box, 'asha@example.com')

    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Type the guest’s name, not an email address.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()
    expect(placeOrder).not.toHaveBeenCalled()
  })

  it('lets a name typed for a ticket that was then taken off stop holding up Pay', async () => {
    const placeOrder = vi.fn().mockResolvedValue(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), placeOrder })

    await holdGarden(user, 2)
    await user.type(screen.getByLabelText('Ticket 2 of 2 — Garden Seating'), 'asha@example.com')
    expect(screen.getByRole('button', { name: /^Pay / })).toBeDisabled()

    // One fewer: the second box, and what was typed in it, is gone from the page.
    await user.click(screen.getByRole('button', { name: 'Remove one Garden Seating' }))
    await user.click(screen.getByRole('button', { name: 'Reserve tickets' }))
    await screen.findByText('Tickets held')

    expect(screen.queryByLabelText('Ticket 2 of 2 — Garden Seating')).toBeNull()
    expect(screen.queryByText('One of the names needs changing before you can pay.')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[0][0].attendees).toEqual([])
  })

  it('shows the new total and books nothing when the server’s figure moved', async () => {
    const changed = Object.assign(new Error('The total changed since it was shown.'), {
      status: 409,
      code: 'PRICE_CHANGED',
    })
    const quote = fakeQuote()
    const placeOrder = vi.fn().mockRejectedValueOnce(changed).mockResolvedValueOnce(ORDER)
    const user = renderBasket({ reserve: vi.fn().mockResolvedValue(HOLDS), quote, placeOrder })

    await holdGarden(user)

    // The next quote comes back higher: say the code the buyer had was used up.
    quote.mockImplementationOnce(async (request) => {
      const base = await fakeQuote()(request)
      return { ...base, totalCents: base.totalCents + 5000 }
    })

    await user.click(screen.getByRole('button', { name: /^Pay / }))

    const warning = await screen.findByText('The total changed')
    const next = await quote.mock.results.at(-1).value

    expect(warning.closest('[role]')).toHaveTextContent(
      `The total is now ${formatAmount(next.totalCents, 'INR')}. Nothing was charged.`,
    )
    expect(screen.queryByRole('heading', { name: 'Booked' })).toBeNull()

    // Paying again sends the new figure, under a new attempt key.
    await user.click(
      screen.getByRole('button', {
        name: `Pay ${formatAmount(next.totalCents, 'INR')} (simulated)`,
      }),
    )
    await screen.findByRole('heading', { name: 'Booked' })

    expect(placeOrder.mock.calls[1][0].expectedTotalCents).toBe(next.totalCents)
    expect(placeOrder.mock.calls[1][0].idempotencyKey).not.toBe(
      placeOrder.mock.calls[0][0].idempotencyKey,
    )
  })

  it('groups the tiers under their nights, and a pass for every night last', () => {
    renderBasket({
      event: {
        ...event,
        sessions: [
          {
            id: 'cksessionnighttwo0000001',
            label: 'Night 2',
            startsAt: '2026-10-12T13:30:00.000Z',
            endsAt: '2026-10-12T18:30:00.000Z',
            timezone: 'Asia/Kolkata',
            status: 'SCHEDULED',
            hasSeatMap: false,
            seatsAvailable: null,
          },
          {
            id: 'cksessionnightone0000001',
            label: 'Night 1',
            startsAt: '2026-10-11T13:30:00.000Z',
            endsAt: '2026-10-11T18:30:00.000Z',
            timezone: 'Asia/Kolkata',
            status: 'SCHEDULED',
            hasSeatMap: false,
            seatsAvailable: null,
          },
        ],
      },
      ticketTypes: [
        { ...ticketTypes[0], eventSessionId: 'cksessionnighttwo0000001' },
        { ...ticketTypes[1], eventSessionId: 'cksessionnightone0000001' },
        { ...ticketTypes[2], eventSessionId: null },
      ],
    })

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)

    expect(headings).toEqual([
      expect.stringMatching(/^Night 1 · Sun, Oct 11 · 7:00 PM$/),
      expect.stringMatching(/^Night 2 · Mon, Oct 12 · 7:00 PM$/),
      'Every night',
    ])
  })
})
