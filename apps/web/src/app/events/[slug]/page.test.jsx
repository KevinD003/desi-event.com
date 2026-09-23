import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

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
  category: 'MUSIC_CONCERT',
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
      status: 'ON_SALE',
      salesStartAt: null,
      salesEndAt: null,
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

describe('the event detail page and a tier that cannot be bought yet', () => {
  /** A day either side of the render, so the window is plainly shut or open. */
  const DAY = 24 * 60 * 60 * 1000

  /**
   * The on-sale event with its one tier changed.
   *
   * @param {object} change Fields to set on the tier.
   * @param {object} [eventChange] Fields to set on the event.
   * @returns {object} The event payload.
   */
  const withTier = (change, eventChange = {}) => ({
    ...selling,
    ...eventChange,
    ticketTypes: [{ ...selling.ticketTypes[0], ...change }],
  })

  /**
   * The ticket box, where the chip, the price and the button live.
   *
   * @returns {HTMLElement} The box.
   */
  const ticketBox = () => screen.getByRole('complementary', { name: 'Tickets' })

  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('says "On sale" in the ticket box when a tier can be bought now', async () => {
    await renderEvent(selling)

    expect(within(ticketBox()).getAllByText('On sale').length).toBeGreaterThan(0)
    expect(within(ticketBox()).getByRole('link', { name: /choose tickets/i })).toBeInTheDocument()
  })

  it.each([
    ['whose sales have not opened', { salesStartAt: new Date(Date.now() + DAY).toISOString() }],
    ['whose sales have closed', { salesEndAt: new Date(Date.now() - DAY).toISOString() }],
    ['that the organiser paused', { status: 'PAUSED', isSoldOut: true, availableQuantity: 0 }],
  ])('neither says "On sale", quotes a price nor sells a tier %s', async (_why, change) => {
    // The listing card says "Not on sale now" for this event (the API's
    // `salesOpen` is false), and the hold behind "Choose tickets" would be
    // refused. The page has to agree with both.
    await renderEvent(withTier(change, { status: 'PUBLISHED' }))

    const box = ticketBox()

    expect(within(box).queryByText('On sale')).toBeNull()
    expect(within(box).queryByRole('link', { name: /choose tickets/i })).toBeNull()
    expect(within(box).queryByText(/^From/)).toBeNull()
    expect(box).toHaveTextContent('Tickets are not on sale at the moment.')
    expect(screen.getByRole('list', { name: 'Event details' })).not.toHaveTextContent(/From \$/)
  })

  it('does not call a tier sold out when it has stock but is not on sale yet', async () => {
    await renderEvent(withTier({ salesStartAt: new Date(Date.now() + DAY).toISOString() }))

    expect(screen.queryByText(/every tier has sold out/i)).toBeNull()
    expect(screen.queryByText('Sold out')).toBeNull()
    expect(
      within(screen.getByRole('list', { name: 'Ticket types' })).getByText('Not on sale now'),
    ).toBeInTheDocument()
  })

  it('still says sold out, in the hero and the box, when the stock has gone', async () => {
    await renderEvent(withTier({ quantitySold: 100, isSoldOut: true, availableQuantity: 0 }))

    const hero = screen.getByRole('region', { name: event.title })

    expect(within(hero).getByText('Sold out')).toHaveTextContent('Availability: Sold out')
    expect(screen.getByText(/every tier has sold out/i)).toBeInTheDocument()
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

describe('the event detail page in the new design', () => {
  /** An Edison night with fee terms, as the API publishes it. */
  const edison = {
    ...selling,
    slug: 'navratri-night-one-edison',
    title: 'Navratri Night One: Garba Under the Lights',
    category: 'GARBA_DANDIYA',
    timezone: 'America/New_York',
    startsAt: '2026-10-11T23:30:00.000Z',
    endsAt: '2026-10-12T04:30:00.000Z',
    venue: {
      name: 'Lamplight Expo Hall',
      slug: 'lamplight-expo-hall',
      addressLine1: '450 Festival Plaza',
      city: 'Edison',
      region: 'NJ',
      postalCode: '08837',
      country: 'US',
    },
    organization: { name: 'Mirrorwork Events', slug: 'mirrorwork-events', verified: true },
    feeTerms: [{ currency: 'USD', percentageBps: 590, flatCents: 99 }],
    ticketTypes: [
      {
        id: 'ttedisongeneral',
        name: 'General Admission',
        priceCents: 3500,
        currency: 'USD',
        status: 'ON_SALE',
        availableQuantity: 400,
        isSoldOut: false,
      },
    ],
  }

  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('opens on a hero named by the whole title, with the poster described', async () => {
    await renderEvent(edison)

    const hero = screen.getByRole('region', { name: 'Navratri Night One: Garba Under the Lights' })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Navratri Night One: Garba Under the Lights',
    )
    expect(within(hero).getByRole('img')).toHaveAccessibleName(
      /^Illustration of garba dancers .* for Navratri Night One: Garba Under the Lights$/,
    )
  })

  it('states the when and where up front, in the venue’s zone and its state', async () => {
    await renderEvent(edison)

    const facts = screen.getByRole('list', { name: 'Event details' })

    expect(within(facts).getByText('7:30 PM – 12:30 AM EDT')).toBeInTheDocument()
    expect(within(facts).getByText('Lamplight Expo Hall')).toBeInTheDocument()
    expect(within(facts).getByText('Edison, NJ')).toBeInTheDocument()
    expect(within(facts).getByText('From $38.06')).toBeInTheDocument()
    expect(within(facts).getByText('with fees')).toBeInTheDocument()
  })

  it('says who presents it, and shows the badge only when the API says verified', async () => {
    const { unmount } = await renderEvent(edison)

    expect(screen.getByText('Presented by Mirrorwork Events')).toBeInTheDocument()
    expect(screen.getAllByText('Verified organiser').length).toBeGreaterThan(0)
    unmount()

    await renderEvent({ ...edison, organization: { ...edison.organization, verified: false } })
    expect(screen.queryByText('Verified organiser')).toBeNull()
  })

  it('shows each tier with its fee-inclusive price beside the face value', async () => {
    await renderEvent(edison)

    const tiers = screen.getByRole('list', { name: 'Ticket types' })

    expect(within(tiers).getByText('$35.00')).toBeInTheDocument()
    expect(within(tiers).getByText('$38.06 with fees')).toBeInTheDocument()
  })

  it('says beside the tickets that payments are simulated', async () => {
    await renderEvent(edison)

    const box = screen.getByRole('complementary', { name: 'Tickets' })

    expect(box).toHaveTextContent('Payments on this site are simulated.')
  })

  it('marks a stopped event in the hero with its state, in words', async () => {
    await renderEvent({ ...edison, status: 'CANCELLED' })

    const hero = screen.getByRole('region', { name: /Navratri Night One/ })

    expect(within(hero).getByText('Cancelled')).toHaveTextContent('Availability: Cancelled')
  })

  it('leads back to the listing and the category through the trail', async () => {
    await renderEvent(edison)

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(within(trail).getByRole('link', { name: 'Discover events' })).toHaveAttribute(
      'href',
      '/events',
    )
    expect(within(trail).getByRole('link', { name: 'Garba & Dandiya' })).toHaveAttribute(
      'href',
      '/events?category=GARBA_DANDIYA',
    )
  })
})
