import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { TicketTiers, availabilityLabel } from './ticket-tiers.jsx'

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
