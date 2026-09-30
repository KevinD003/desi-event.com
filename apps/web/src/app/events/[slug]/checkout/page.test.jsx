import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
}))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))
// The team's read is made as the viewer; here it is the only part replaced.
vi.mock('../../../../lib/team-booking.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTeamTicketTypes: vi.fn(),
}))

const { loadEventBySlug } = await import('../../../../lib/api.js')
const { readSession } = await import('../../../../lib/session.js')
const { loadTeamTicketTypes } = await import('../../../../lib/team-booking.js')
const { default: CheckoutPage, generateMetadata } = await import('./page.jsx')

const missing = { params: Promise.resolve({ slug: 'no-such-event-at-all' }) }

describe('the checkout page when the event is missing', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event: null, usedFallback: false })
  })

  it('renders the not-found view rather than an empty page', async () => {
    render(await CheckoutPage(missing))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not on the bill/i)
  })

  it('offers no basket, no quantities and no way to pay', async () => {
    render(await CheckoutPage(missing))

    expect(screen.queryByRole('button', { name: /pay|checkout|place order/i })).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('stays out of the index', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe('the checkout page when the event exists', () => {
  /** The smallest event the checkout page will render. */
  const event = {
    id: 'evt_1',
    slug: 'qawwali-under-the-banyan',
    title: 'Qawwali Under the Banyan',
    timezone: 'Asia/Kolkata',
    startsAt: '2026-11-01T14:30:00.000Z',
    endsAt: '2026-11-01T17:30:00.000Z',
    venue: { name: 'Banyan Courtyard', city: 'Mumbai', addressLine1: '1 Road', country: 'IN' },
    ticketTypes: [
      {
        id: 'tt_1',
        name: 'General Admission',
        priceCents: 150_000,
        currency: 'INR',
        quantityTotal: 100,
        quantitySold: 0,
        availableQuantity: 100,
        isSoldOut: false,
        status: 'ON_SALE',
      },
    ],
  }

  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event, usedFallback: false })
    readSession.mockReset()
    readSession.mockResolvedValue(null)
  })

  it('asks who is signed in, because buying needs an account', async () => {
    render(await CheckoutPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(readSession).toHaveBeenCalled()
  })

  it('does not ask on the offline sample catalogue, where nothing can be bought', async () => {
    loadEventBySlug.mockResolvedValue({ event, usedFallback: true })

    render(await CheckoutPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(readSession).not.toHaveBeenCalled()
  })

  it('tells the buyer payments are simulated before they pick a quantity', async () => {
    render(await CheckoutPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.getByTestId('payment-mode-notice')).toBeInTheDocument()
    expect(document.body).toHaveTextContent('Payments on this site are simulated')
  })

  it('offers no way for a browser to choose a payment provider', async () => {
    const { container } = await (async () => {
      const result = render(await CheckoutPage({ params: Promise.resolve({ slug: event.slug }) }))

      return result
    })()

    // Nothing named after a provider, a method or a mode: the server does not
    // read such a field, and offering one would imply it did.
    const controls = [...container.querySelectorAll('input, select, textarea')]
    for (const control of controls) {
      expect(control.getAttribute('name') ?? '').not.toMatch(/provider|payment|method|card|mode/i)
    }
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/\bstripe\b/i)
  })
})

describe('the checkout page for the organiser’s own team', () => {
  const event = {
    id: 'evt_2',
    slug: 'garba-under-the-stars',
    organizationId: 'org_navratri',
    title: 'Garba Under the Stars',
    timezone: 'America/Chicago',
    startsAt: '2026-11-01T23:30:00.000Z',
    endsAt: '2026-11-02T03:30:00.000Z',
    venue: { name: 'Fair Park', city: 'Dallas', addressLine1: '1 Road', country: 'US' },
    ticketTypes: [
      {
        id: 'tt_public',
        name: 'General Admission',
        priceCents: 2_500,
        currency: 'USD',
        quantityTotal: 100,
        quantitySold: 0,
        availableQuantity: 100,
        isSoldOut: false,
        status: 'ON_SALE',
        visibility: 'PUBLIC',
      },
    ],
  }
  const guestList = {
    id: 'tt_guest',
    name: 'Guest list',
    priceCents: 0,
    currency: 'USD',
    quantityTotal: 20,
    quantitySold: 0,
    availableQuantity: 20,
    isSoldOut: false,
    status: 'ON_SALE',
    visibility: 'HIDDEN',
    complimentary: true,
  }

  /**
   * A signed-in member with these capabilities in the event's organisation.
   *
   * @param {string[]} capabilities What the membership holds.
   * @returns {object} The session payload.
   */
  const member = (capabilities) => ({
    user: { id: 'u_meera', displayName: 'Meera Shah', email: 'meera@example.test' },
    capabilities: [],
    memberships: [{ organizationId: event.organizationId, role: 'EVENT_MANAGER', capabilities }],
  })

  const params = { params: Promise.resolve({ slug: event.slug }) }

  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event, usedFallback: false })
    readSession.mockReset()
    loadTeamTicketTypes.mockReset()
    loadTeamTicketTypes.mockResolvedValue([event.ticketTypes[0], guestList])
  })

  it('lists the hidden tiers, marked Team only, to a member who may book them', async () => {
    readSession.mockResolvedValue(member(['ticketType:manage']))

    render(await CheckoutPage(params))

    expect(loadTeamTicketTypes).toHaveBeenCalledWith(event.slug)
    expect(screen.getByText('Guest list')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity of Guest list')).toBeInTheDocument()
    expect(screen.getByText('Team only')).toBeInTheDocument()

    const notice = screen.getByTestId('team-booking-notice')
    expect(notice).toHaveTextContent('Booking for your team')
    expect(notice).toHaveTextContent('hand each one on to a guest with a transfer code')
    expect(screen.getByRole('link', { name: 'your tickets' })).toHaveAttribute('href', '/tickets')
  })

  it('never asks for them for anybody else, and lists only the public tiers', async () => {
    for (const session of [null, member(['event:view_draft'])]) {
      readSession.mockResolvedValue(session)
      loadTeamTicketTypes.mockClear()

      const { unmount } = render(await CheckoutPage(params))

      expect(loadTeamTicketTypes).not.toHaveBeenCalled()
      expect(screen.queryByText('Guest list')).toBeNull()
      expect(screen.queryByTestId('team-booking-notice')).toBeNull()
      expect(screen.getByText('General Admission')).toBeInTheDocument()

      unmount()
    }
  })

  it('keeps the public tiers when the team’s read fails', async () => {
    readSession.mockResolvedValue(member(['ticketType:manage']))
    loadTeamTicketTypes.mockResolvedValue(null)

    render(await CheckoutPage(params))

    expect(screen.getByText('General Admission')).toBeInTheDocument()
    expect(screen.queryByText('Guest list')).toBeNull()
    expect(screen.queryByTestId('team-booking-notice')).toBeNull()
  })
})
