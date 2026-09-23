import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { TicketTiers, availabilityLabel, tierAllIn } from './ticket-tiers.jsx'

describe('availabilityLabel', () => {
  it('does not call a seated tier sold out, and says it is not sold on this site', () => {
    // Its quantity is zero by design: a seated tier's stock is its seats.
    expect(availabilityLabel({ reserved: true, availableQuantity: 0, isSoldOut: true })).toEqual({
      text: 'Seated — not sold on this site',
      variant: 'neutral',
    })
  })

  it('shows the exact count when stock is low, rather than a vague "selling fast"', () => {
    expect(availabilityLabel({ availableQuantity: 9, isSoldOut: false })).toEqual({
      text: 'Only 9 left',
      variant: 'warning',
    })
  })

  it('stays neutral when there is plenty left', () => {
    expect(availabilityLabel({ availableQuantity: 900, isSoldOut: false })).toEqual({
      text: 'On sale',
      variant: 'success',
    })
  })

  it('reports sold out for an exhausted tier', () => {
    expect(availabilityLabel({ availableQuantity: 0, isSoldOut: true }).text).toBe('Sold out')
  })

  it('trusts the sold-out flag over a stale count', () => {
    expect(availabilityLabel({ availableQuantity: 40, isSoldOut: true }).text).toBe('Sold out')
  })

  it('treats a zero count as sold out even without the flag', () => {
    expect(availabilityLabel({ availableQuantity: 0, isSoldOut: false }).text).toBe('Sold out')
  })

  it('says a paused tier is paused, not sold out, although nothing is available from it', () => {
    // The availability fold gives any tier that is not on sale a count of
    // zero; reading that as stock called a paused tier sold out.
    expect(availabilityLabel({ status: 'PAUSED', availableQuantity: 0, isSoldOut: true })).toEqual({
      text: 'Sales paused',
      variant: 'neutral',
    })
  })

  it.each([
    ['closed', { status: 'CLOSED', availableQuantity: 0, isSoldOut: true }],
    ['a draft', { status: 'DRAFT', availableQuantity: 0, isSoldOut: true }],
    [
      'not open yet',
      { status: 'ON_SALE', availableQuantity: 90, isSoldOut: false, salesStartAt: '2026-10-02' },
    ],
    [
      'past its window',
      { status: 'ON_SALE', availableQuantity: 90, isSoldOut: false, salesEndAt: '2026-09-30' },
    ],
  ])('says "Not on sale now" for a tier that is %s', (_why, tier) => {
    expect(availabilityLabel(tier, new Date('2026-10-01T12:00:00.000Z'))).toEqual({
      text: 'Not on sale now',
      variant: 'neutral',
    })
  })

  it('still says sold out for a tier whose status says so', () => {
    expect(
      availabilityLabel({ status: 'SOLD_OUT', availableQuantity: 0, isSoldOut: true }),
    ).toEqual({ text: 'Sold out', variant: 'danger' })
  })

  it('says "On sale" for a tier inside its window', () => {
    const tier = {
      status: 'ON_SALE',
      availableQuantity: 90,
      isSoldOut: false,
      salesStartAt: '2026-09-01T00:00:00.000Z',
      salesEndAt: '2026-10-31T00:00:00.000Z',
    }

    expect(availabilityLabel(tier, new Date('2026-10-01T12:00:00.000Z')).text).toBe('On sale')
  })
})

describe('TicketTiers', () => {
  const tiers = [
    {
      id: 'ttngarbaseasonpass',
      name: 'Season Pass',
      description: 'One wristband, every night.',
      priceCents: 899_900,
      currency: 'INR',
      availableQuantity: 53,
      isSoldOut: false,
    },
    {
      id: 'ttngarbasinglenite',
      name: 'Single Night Entry',
      description: null,
      priceCents: 0,
      currency: 'INR',
      availableQuantity: 0,
      isSoldOut: true,
    },
  ]

  it('lists each tier with its price and availability', () => {
    render(<TicketTiers ticketTypes={tiers} />)
    const items = within(screen.getByRole('list', { name: 'Ticket types' })).getAllByRole(
      'listitem',
    )

    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('₹8,999.00')).toBeInTheDocument()
    expect(within(items[0]).getByText('On sale')).toBeInTheDocument()
    expect(within(items[0]).getByText(/^Availability:$/)).toBeInTheDocument()
    expect(within(items[1]).getByText('Sold out')).toBeInTheDocument()
  })

  it('reads a zero price as free rather than as a broken amount', () => {
    render(<TicketTiers ticketTypes={tiers} />)

    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('omits the description line for a tier that has none', () => {
    render(<TicketTiers ticketTypes={tiers} />)

    expect(screen.getByText('One wristband, every night.')).toBeInTheDocument()
  })
})

describe('tierAllIn', () => {
  const place = { country: 'US', region: 'NJ' }
  const terms = [{ currency: 'USD', percentageBps: 590, flatCents: 99 }]
  const general = { id: 'ttgeneral', name: 'General Admission', priceCents: 3500, currency: 'USD' }

  it('prices one ticket with the published fee terms and the venue’s tax', () => {
    // 5.9% of $35.00 is $2.065, plus $0.99: the same total checkout charges.
    expect(tierAllIn(general, place, terms)).toEqual({
      totalCents: 3806,
      feesCents: 306,
      taxCents: 0,
    })
  })

  it('says nothing when it cannot know where the event is held', () => {
    expect(tierAllIn(general, null, terms)).toBeNull()
  })

  it('says nothing for a free ticket, which the list already calls free', () => {
    expect(tierAllIn({ ...general, priceCents: 0 }, place, terms)).toBeNull()
  })
})

describe('TicketTiers with the fee terms', () => {
  const place = { country: 'US', region: 'NJ' }
  const terms = [{ currency: 'USD', percentageBps: 590, flatCents: 99 }]
  const tiers = [
    {
      id: 'ttgeneral',
      name: 'General Admission',
      priceCents: 3500,
      currency: 'USD',
      availableQuantity: 400,
      isSoldOut: false,
    },
    {
      id: 'ttearlybird',
      name: 'Early Bird',
      priceCents: 2800,
      currency: 'USD',
      availableQuantity: 0,
      isSoldOut: true,
    },
  ]

  it('shows each tier’s face value and what one ticket comes to with fees', () => {
    render(<TicketTiers ticketTypes={tiers} place={place} feeTerms={terms} />)
    const [general] = within(screen.getByRole('list', { name: 'Ticket types' })).getAllByRole(
      'listitem',
    )

    expect(within(general).getByText('$35.00')).toBeInTheDocument()
    expect(within(general).getByText('$38.06 with fees')).toBeInTheDocument()
  })

  it('prices nothing it does not sell: a sold-out tier keeps its face value only', () => {
    render(<TicketTiers ticketTypes={tiers} place={place} feeTerms={terms} />)
    const [, early] = within(screen.getByRole('list', { name: 'Ticket types' })).getAllByRole(
      'listitem',
    )

    expect(within(early).getByText('$28.00')).toBeInTheDocument()
    expect(within(early).queryByText(/with fees/)).toBeNull()
  })

  it('shows face values alone when it is not told where the event is held', () => {
    render(<TicketTiers ticketTypes={tiers} />)

    expect(screen.queryByText(/with fees/)).toBeNull()
  })
})
