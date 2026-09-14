import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
}))

const { loadEventBySlug } = await import('../../../../lib/api.js')
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
  })

  it('tells the buyer production payments are disabled before they pick a quantity', async () => {
    render(await CheckoutPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.getByTestId('payment-mode-notice')).toBeInTheDocument()
    expect(document.body).toHaveTextContent('Production payments disabled')
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
