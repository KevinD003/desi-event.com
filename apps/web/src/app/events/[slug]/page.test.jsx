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
  status: 'ON_SALE',
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

/** The same event with something to sell. */
const selling = {
  ...event,
  ticketTypes: [
    {
      id: 'tt_1',
      name: 'General admission',
      priceCents: 149_900,
      currency: 'INR',
      quantityTotal: 100,
      quantitySold: 0,
      isSoldOut: false,
    },
  ],
}

/**
 * Render the page for one event payload.
 *
 * @param {object} payload The event the API (or the fallback catalogue) returned.
 * @returns {Promise<object>} Testing Library's render result.
 */
async function renderEvent(payload) {
  loadEventBySlug.mockResolvedValue({ event: payload, usedFallback: false })

  return render(await EventDetailPage({ params: Promise.resolve({ slug: payload.slug }) }))
}

/**
 * The parsed JSON-LD block, or null when the page published none.
 *
 * @param {HTMLElement} container The render container.
 * @returns {object|null} The structured data.
 */
function structuredData(container) {
  const script = container.querySelector('script[type="application/ld+json"]')

  return script ? JSON.parse(script.textContent) : null
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

describe('the event detail page and the lifecycle', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('publishes structured data for an event a stranger may load', async () => {
    const { container } = await renderEvent(selling)

    expect(structuredData(container)).toMatchObject({
      '@type': 'Event',
      name: 'Qawwali Under the Banyan',
      eventStatus: 'https://schema.org/EventScheduled',
    })
  })

  it('says a cancelled show is cancelled, in the page and in the structured data', async () => {
    const { container } = await renderEvent({ ...selling, status: 'CANCELLED' })

    // Twice: once in the banner, once where the buy button would have been.
    expect(screen.getAllByText(/this event has been cancelled/i)).toHaveLength(2)
    expect(structuredData(container).eventStatus).toBe('https://schema.org/EventCancelled')
  })

  it('offers no way to buy a ticket to a cancelled show', async () => {
    // A banner saying "cancelled" above a working buy button is worse than
    // either alone.
    await renderEvent({ ...selling, status: 'CANCELLED' })

    expect(screen.queryByRole('link', { name: /choose tickets/i })).not.toBeInTheDocument()
    expect(screen.getByText(/cannot be bought here/i)).toBeInTheDocument()
  })

  it('tells somebody what date a postponed event has moved from', async () => {
    const { container } = await renderEvent({
      ...selling,
      status: 'POSTPONED',
      previousStartsAt: '2026-10-01T14:30:00.000Z',
    })

    expect(screen.getAllByText(/postponed/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/it was going to be on/i)).toBeInTheDocument()
    expect(structuredData(container).previousStartDate).toBe('2026-10-01T14:30:00.000Z')
  })

  it('stops sales when the organiser paused them, and says the event is still going ahead', async () => {
    await renderEvent({ ...selling, status: 'SALES_PAUSED' })

    expect(screen.queryByRole('link', { name: /choose tickets/i })).not.toBeInTheDocument()
    expect(screen.getByText(/still going ahead/i)).toBeInTheDocument()
  })

  it('keeps a finished event readable without inviting anybody to buy', async () => {
    await renderEvent({ ...selling, status: 'COMPLETED' })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(event.title)
    expect(screen.queryByRole('link', { name: /choose tickets/i })).not.toBeInTheDocument()
  })

  it('sells a ticket when the event is on sale', async () => {
    await renderEvent(selling)

    expect(screen.getByRole('link', { name: /choose tickets/i })).toHaveAttribute(
      'href',
      `/events/${event.slug}/checkout`,
    )
  })

  it('sells an announced event that has not opened sales yet', async () => {
    await renderEvent({ ...selling, status: 'PUBLISHED' })

    expect(screen.getByRole('link', { name: /choose tickets/i })).toBeInTheDocument()
  })
})

describe('the event detail page and what it must not leak', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('publishes no structured data for an event that is not public', async () => {
    // The API answers a stranger with 404. This is the second lock, for the
    // case where an organiser previews their own draft and something follows
    // them in: a `<script>` block is the one part of a page a `noindex` header
    // does not stop a scraper reading.
    for (const status of ['DRAFT', 'REVIEW_PENDING', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED']) {
      const { container, unmount } = await renderEvent({ ...selling, status })

      expect(structuredData(container), status).toBeNull()
      unmount()
    }
  })

  it('keeps a private event out of the index', async () => {
    loadEventBySlug.mockResolvedValue({
      event: { ...selling, status: 'DRAFT' },
      usedFallback: false,
    })

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: event.slug }) })

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('lets a crawler read a cancelled event, so the stale rich result gets fixed', async () => {
    // Hiding the page would leave the old "this is on" answer standing. The
    // repair is to let the crawler read `EventCancelled`.
    loadEventBySlug.mockResolvedValue({
      event: { ...selling, status: 'CANCELLED' },
      usedFallback: false,
    })

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: event.slug }) })

    expect(metadata.robots).toBeUndefined()
  })

  it('shows nothing the public payload does not carry', async () => {
    const { container } = await renderEvent({
      ...selling,
      contactEmail: 'accounts@swar-sadhana.test',
      moderationNote: 'Chase them about the licence.',
      payoutCurrency: 'INR',
    })

    expect(container.textContent).not.toMatch(/accounts@swar-sadhana\.test/)
    expect(container.textContent).not.toMatch(/licence/i)
    expect(container.innerHTML).not.toMatch(/moderationNote|payoutCurrency|contactEmail/)
  })
})

describe('the event detail page and what a person needs before they buy', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('shows the all-in price next to the face value, not at the end of checkout', async () => {
    await renderEvent(selling)

    expect(screen.getByText(/all in/i)).toBeInTheDocument()
    expect(screen.getByText(/booking fee/i)).toBeInTheDocument()
  })

  it('states an age restriction as a number rather than as a colour', async () => {
    await renderEvent({ ...selling, ageRestriction: 18 })

    expect(screen.getByText('18+')).toBeInTheDocument()
    expect(screen.getByText(/age 18 and over/i)).toBeInTheDocument()
  })

  it('reads accessibility claims as sentences, not as codes', async () => {
    await renderEvent({
      ...selling,
      accessibility: { features: ['CAPTIONING'], note: 'This performance is captioned.' },
      venue: {
        ...selling.venue,
        accessibility: {
          features: ['STEP_FREE_ENTRANCE'],
          note: 'The accessible entrance is Gate 3.',
        },
      },
    })

    expect(screen.getByText('Step-free entrance')).toBeInTheDocument()
    expect(screen.getByText('Captioning')).toBeInTheDocument()
    expect(screen.queryByText('STEP_FREE_ENTRANCE')).not.toBeInTheDocument()
  })

  it('keeps the venue note and the event note apart, because they answer different questions', async () => {
    await renderEvent({
      ...selling,
      accessibility: { features: [], note: 'This performance is captioned.' },
      venue: {
        ...selling.venue,
        accessibility: { features: [], note: 'The accessible entrance is Gate 3.' },
      },
    })

    expect(screen.getByText(/at the venue:/i)).toBeInTheDocument()
    expect(screen.getByText(/for this event:/i)).toBeInTheDocument()
  })

  it('says so plainly when nobody has published any accessibility information', async () => {
    await renderEvent({ ...selling, ageRestriction: 18 })

    expect(screen.getByText(/no accessibility information has been published/i)).toBeInTheDocument()
  })

  it('shows the refund policy rather than burying it', async () => {
    await renderEvent({
      ...selling,
      policies: {
        refund: 'Refundable up to 48 hours before.',
        entry: 'Doors at seven.',
        conduct: 'No recording.',
      },
    })

    expect(screen.getByText('Refunds')).toBeInTheDocument()
    expect(screen.getByText('Refundable up to 48 hours before.')).toBeInTheDocument()
  })

  it('says the terms on an order are the ones copied onto it, not these', async () => {
    await renderEvent({ ...selling, policies: { refund: 'Refundable up to 48 hours before.' } })

    expect(screen.getByText(/copied onto it when it was placed/i)).toBeInTheDocument()
  })

  it('lists the line-up in billing order', async () => {
    // Ordered, and kept ordered: for a lot of these events the order of the
    // names on the bill is the thing that was negotiated.
    const { container } = await renderEvent({
      ...selling,
      artists: ['Nizami Bandhu', 'Warsi Brothers'],
    })

    const lineup = container.querySelectorAll('ol li')

    expect([...lineup].map((item) => item.textContent)).toContain('Nizami Bandhu')
    expect(screen.getByRole('heading', { name: 'Line-up' })).toBeInTheDocument()

    const names = [...lineup]
      .map((item) => item.textContent)
      .filter((name) => name === 'Nizami Bandhu' || name === 'Warsi Brothers')

    expect(names).toEqual(['Nizami Bandhu', 'Warsi Brothers'])
  })

  it('renders without a single client-side fetch: the markup is the page', async () => {
    // No-JavaScript behaviour. Everything a visitor needs to decide whether to
    // come is in the server-rendered HTML, and the only interactive control is
    // a link.
    const { container } = await renderEvent({
      ...selling,
      ageRestriction: 18,
      policies: { refund: 'Refundable up to 48 hours before.' },
    })

    expect(container.textContent).toMatch(/Qawwali Under the Banyan/)
    expect(container.textContent).toMatch(/Refundable up to 48 hours before/)
    expect(container.querySelector('a[href$="/checkout"]')).toBeInTheDocument()
  })
})
