import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
}))

const { loadEventBySlug } = await import('../../../lib/api.js')
const { default: EventDetailPage, generateMetadata } = await import('./page.jsx')

/** A slug that resolves to nothing, whatever the reason. */
const missing = { params: Promise.resolve({ slug: 'no-such-event-at-all' }) }

/** The smallest event the page will render. */
const event = {
  id: 'evt_1',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  description: 'One paragraph.',
  category: 'LIVE_MUSIC',
  timezone: 'Asia/Kolkata',
  startsAt: '2026-11-01T14:30:00.000Z',
  endsAt: '2026-11-01T17:30:00.000Z',
  languages: ['Urdu'],
  venue: {
    name: 'Banyan Courtyard',
    slug: 'banyan-courtyard',
    city: 'Mumbai',
    addressLine1: '1 Road',
    country: 'IN',
  },
  organization: { name: 'Swar Sadhana Trust', slug: 'swar-sadhana-trust', verified: true },
  ticketTypes: [],
}

describe('the event detail page when the event is missing', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event: null, usedFallback: false })
  })

  it('renders the not-found view rather than an empty page', async () => {
    render(await EventDetailPage(missing))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not on the bill/i)
  })

  it('keeps the page out of the index', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('claims no canonical URL for a page that is not there', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.alternates).toBeUndefined()
  })

  it('publishes no structured data about an event that does not exist', async () => {
    const { container } = render(await EventDetailPage(missing))

    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })

  it('says nothing about why the event is missing', async () => {
    render(await EventDetailPage(missing))

    expect(document.body.textContent).not.toMatch(
      /draft|unpublished|withdrawn|moderat|private|deleted|cancelled/i,
    )
  })
})

describe('the event detail page when the event exists', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event, usedFallback: false })
  })

  it('still renders the event', async () => {
    render(await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(event.title)
    expect(screen.queryByTestId('not-found-view')).not.toBeInTheDocument()
  })

  it('points its canonical URL at itself', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: event.slug }) })

    expect(metadata.alternates.canonical).toBe(`/events/${event.slug}`)
  })

  it('links the venue to its own page', async () => {
    render(await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.getByRole('link', { name: 'Banyan Courtyard' })).toHaveAttribute(
      'href',
      '/venues/banyan-courtyard',
    )
  })

  it('links the organiser to their own page', async () => {
    render(await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.getByRole('link', { name: 'Swar Sadhana Trust' })).toHaveAttribute(
      'href',
      '/organizers/swar-sadhana-trust',
    )
  })

  it('leaves the organiser as plain text when there is no slug to link to', async () => {
    // Deriving the href from the name would produce a URL that looks right and
    // 404s, which is worse than not linking.
    loadEventBySlug.mockResolvedValue({
      event: { ...event, organization: { name: 'Swar Sadhana Trust', verified: false } },
      usedFallback: false,
    })

    render(await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) }))

    expect(screen.queryByRole('link', { name: 'Swar Sadhana Trust' })).not.toBeInTheDocument()
    expect(screen.getByText('Swar Sadhana Trust')).toBeInTheDocument()
  })
})
