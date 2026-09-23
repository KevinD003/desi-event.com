import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      placeOrder={vi.fn()}
      {...props}
    />,
  )

  return userEvent.setup()
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

    expect(screen.getByText('No tickets selected yet')).toBeInTheDocument()
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

    expect(screen.getByText('No tickets selected yet')).toBeInTheDocument()
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

  it('shows a seated tier and does not sell it, because this site has no seat picker', () => {
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
    expect(screen.getByText(/which this site does not have/)).toBeInTheDocument()
  })
})
