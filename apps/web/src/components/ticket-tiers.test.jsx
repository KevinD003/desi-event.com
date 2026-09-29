import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { TicketTiers, availabilityLabel, salesWindowText, tierAllIn } from './ticket-tiers.jsx'

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

describe('a tier’s own sales window', () => {
  const now = new Date('2027-09-20T12:00:00.000Z')

  it('says when an early-bird tier closes, in the venue’s zone', () => {
    expect(
      salesWindowText(
        { salesStartAt: null, salesEndAt: '2027-10-01T03:59:00.000Z' },
        'America/New_York',
        now,
      ),
    ).toBe('On sale until Sep 30, 11:59 PM EDT')
  })

  it('says when a later tier opens, and when one has closed', () => {
    expect(
      salesWindowText(
        { salesStartAt: '2027-10-01T04:00:00.000Z', salesEndAt: null },
        'America/New_York',
        now,
      ),
    ).toBe('On sale from Oct 1, 12:00 AM EDT')
    expect(
      salesWindowText(
        { salesStartAt: null, salesEndAt: '2027-09-01T04:00:00.000Z' },
        'America/Chicago',
        now,
      ),
    ).toBe('Sales ended Aug 31, 11:00 PM CDT')
  })

  it('says nothing for a tier with no window', () => {
    expect(salesWindowText({ salesStartAt: null, salesEndAt: null }, 'UTC', now)).toBeNull()
  })
})

describe('seated tiers and nights', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z')
  const night = {
    id: 'cksessionseated000000001',
    label: 'Night 1',
    startsAt: '2026-10-11T13:30:00.000Z',
    endsAt: '2026-10-11T18:30:00.000Z',
    timezone: 'Asia/Kolkata',
    status: 'SCHEDULED',
    salesStartAt: null,
    salesEndAt: null,
    hasSeatMap: true,
    seatsAvailable: 140,
  }
  const stalls = {
    id: 'ttstalls',
    name: 'Stalls',
    priceCents: 4500,
    currency: 'USD',
    status: 'ON_SALE',
    reserved: true,
    eventSessionId: night.id,
    // Its own free seats, as the API counts them per tier.
    availableQuantity: 140,
    isSoldOut: false,
  }

  it('says Choose seats for a seated tier whose night has an on-sale seat map', () => {
    expect(availabilityLabel(stalls, NOW, night)).toEqual({
      text: 'Choose seats',
      variant: 'success',
    })
  })

  it('gives the exact number of its own seats left at or below the threshold, and sold out at none', () => {
    expect(availabilityLabel({ ...stalls, availableQuantity: 25 }, NOW, night)).toEqual({
      text: 'Only 25 seats left',
      variant: 'warning',
    })
    expect(availabilityLabel({ ...stalls, availableQuantity: 1 }, NOW, night).text).toBe(
      'Only 1 seat left',
    )
    expect(
      availabilityLabel({ ...stalls, availableQuantity: 0, isSoldOut: true }, NOW, night),
    ).toEqual({ text: 'Sold out', variant: 'danger' })
  })

  it('reads a zone’s own seats, never the night’s: one zone sells out while another sells', () => {
    // The night still has seats in another zone; this tier has none.
    expect(
      availabilityLabel({ ...stalls, availableQuantity: 0, isSoldOut: true }, NOW, {
        ...night,
        seatsAvailable: 6,
      }),
    ).toEqual({ text: 'Sold out', variant: 'danger' })

    // A plentiful night does not hide a zone that is nearly gone.
    expect(
      availabilityLabel({ ...stalls, availableQuantity: 2 }, NOW, { ...night, seatsAvailable: 400 })
        .text,
    ).toBe('Only 2 seats left')
  })

  it('invents no number for a seated tier whose seats were not counted', () => {
    expect(availabilityLabel({ ...stalls, availableQuantity: null }, NOW, night)).toEqual({
      text: 'Choose seats',
      variant: 'success',
    })
  })

  it('says a seated tier is not on sale now when its night is not selling', () => {
    expect(availabilityLabel(stalls, NOW, { ...night, status: 'SALES_PAUSED' }).text).toBe(
      'Not on sale now',
    )
    expect(
      availabilityLabel(stalls, NOW, { ...night, salesStartAt: '2026-10-05T00:00:00.000Z' }).text,
    ).toBe('Not on sale now')
  })

  it('links a seated tier to its night’s seat map', () => {
    render(<TicketTiers ticketTypes={[stalls]} sessions={[night]} eventSlug="garba-night" />)

    expect(screen.getByRole('link', { name: 'Choose seats for Stalls' })).toHaveAttribute(
      'href',
      '/events/garba-night/seats/cksessionseated000000001',
    )
  })

  it('groups tiers under their nights, with a pass for every night last', () => {
    const second = {
      ...night,
      id: 'cksessionseated000000002',
      label: 'Night 2',
      startsAt: '2026-10-12T13:30:00.000Z',
      hasSeatMap: false,
      seatsAvailable: null,
    }

    render(
      <TicketTiers
        ticketTypes={[
          {
            id: 'tt1',
            name: 'Night two entry',
            priceCents: 2000,
            currency: 'USD',
            eventSessionId: second.id,
            availableQuantity: 100,
            isSoldOut: false,
            status: 'ON_SALE',
          },
          {
            id: 'tt2',
            name: 'Season pass',
            priceCents: 9000,
            currency: 'USD',
            eventSessionId: null,
            availableQuantity: 100,
            isSoldOut: false,
            status: 'ON_SALE',
          },
          { ...stalls },
        ]}
        sessions={[second, night]}
        eventSlug="garba-night"
      />,
    )

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual([
      expect.stringMatching(/^Night 1 · /),
      expect.stringMatching(/^Night 2 · /),
      'Every night',
    ])
    expect(
      within(screen.getByRole('list', { name: /Every night/ })).getByText('Season pass'),
    ).toBeInTheDocument()
  })
})
