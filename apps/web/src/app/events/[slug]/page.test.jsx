import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
}))
// Who is reading decides whether a website visit is counted. Signed out by
// default; the counting tests below sign somebody in.
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn(async () => null) }))
// The visit counting reads the session, which only a request has; it is
// tested on its own (`components/traffic-scope.test.jsx`). Here it is a marker
// carrying the event it was given.
vi.mock('../../../components/traffic-scope.jsx', () => ({
  TrafficScope: ({ view = null }) => (
    <span data-testid="traffic-scope" data-view={JSON.stringify(view)} />
  ),
}))

const { loadEventBySlug } = await import('../../../lib/api.js')
const { readSession } = await import('../../../lib/session.js')
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

describe('the event detail page when the event was deleted', () => {
  const deleted = { ...selling, status: 'DELETED' }

  beforeEach(() => {
    loadEventBySlug.mockReset()
    // What the API answers an insider who may still read the deleted event.
    loadEventBySlug.mockResolvedValue({ event: deleted, usedFallback: false })
    readSession.mockResolvedValue({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [{ organizationId: 'org_1', capabilities: ['event:view_draft'] }],
    })
  })

  afterEach(() => {
    readSession.mockResolvedValue(null)
  })

  it('renders the not-found view even for the event’s own team, saying nothing of why', async () => {
    const { container } = render(
      await EventDetailPage({ params: Promise.resolve({ slug: deleted.slug }) }),
    )

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(screen.queryByText(deleted.title)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/deleted/i)
    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })

  it('answers with the not-found metadata, out of the index and with no canonical URL', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: deleted.slug }) })

    expect(metadata).toEqual({ title: 'Event not found', robots: { index: false, follow: false } })
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

  /**
   * A public picture payload, as the event payload carries one.
   *
   * @param {string} id The asset id.
   * @param {string} altText The organiser's description.
   * @returns {object} The payload.
   */
  const picture = (id, altText) => ({
    id,
    url: `/v1/media/${id}`,
    altText,
    width: 1200,
    height: 800,
    contentType: 'image/jpeg',
  })

  it('opens on the approved cover, described in the organiser’s words, instead of the poster', async () => {
    const { container } = await renderEvent({
      ...edison,
      coverImage: picture('cmedia0000000000000000001', 'Dancers circling a lit garbo'),
    })

    const hero = screen.getByRole('region', { name: 'Navratri Night One: Garba Under the Lights' })
    const cover = within(hero).getByRole('img', { name: 'Dancers circling a lit garbo' })

    expect(cover.getAttribute('src')).toContain(
      'url=%2Fapi%2Fv1%2Fmedia%2Fcmedia0000000000000000001',
    )
    expect(hero.querySelector('svg[data-slot="poster"]')).toBeNull()
    expect(structuredData(container).image).toEqual([
      expect.stringMatching(/^https?:\/\/[^/]+\/api\/v1\/media\/cmedia0000000000000000001$/u),
    ])
  })

  it('shows the approved gallery in order, each picture opening full size', async () => {
    await renderEvent({
      ...edison,
      gallery: [
        picture('cmedia0000000000000000002', 'The band at soundcheck'),
        picture('cmedia0000000000000000003', 'Lanterns over the dance floor'),
      ],
    })

    const gallery = screen.getByRole('region', { name: 'Pictures' })
    const links = within(gallery).getAllByRole('link')

    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/api/v1/media/cmedia0000000000000000002')
    expect(links[0]).toHaveAccessibleName(
      /^The band at soundcheck\s*\(opens the full-size picture\)$/u,
    )
    expect(links[1]).toHaveAccessibleName(/^Lanterns over the dance floor/u)
  })

  it('has no gallery section, and points search engines at the poster card, with no pictures', async () => {
    const { container } = await renderEvent({ ...edison, coverImage: null, gallery: [] })

    expect(screen.queryByRole('region', { name: 'Pictures' })).toBeNull()
    expect(structuredData(container).image).toEqual([
      expect.stringMatching(
        /^https?:\/\/[^/]+\/events\/navratri-night-one-edison\/opengraph-image\/poster-garba-dandiya$/u,
      ),
    ])
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

describe('the event detail page and the organiser’s own content', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('formats the description as elements, and links only https addresses', async () => {
    const { container } = await renderEvent({
      ...selling,
      description:
        'A **full** night of *qawwali*.\n\n- Free chai\n- Shoes off inside\n\n[Tickets help](https://help.example) and [not this](javascript:alert(1)).',
    })

    const about = screen.getByRole('region', { name: 'About this event' })

    expect(within(about).getByText('full').tagName).toBe('STRONG')
    expect(within(about).getByText('qawwali').tagName).toBe('EM')
    expect(within(about).getByText('Free chai').tagName).toBe('LI')
    expect(within(about).getByRole('link', { name: 'Tickets help' })).toHaveAttribute(
      'href',
      'https://help.example',
    )
    expect(within(about).queryByRole('link', { name: 'not this' })).not.toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/href="javascript:/)
  })

  it('shows the line-up with roles, the running order, questions, contact, links and sponsors', async () => {
    await renderEvent({
      ...selling,
      performers: [{ name: 'Nizami Bandhu', role: 'Qawwals', bio: 'Delhi gharana.' }],
      artists: ['Nizami Bandhu'],
      runningOrder: [{ time: '20:00', title: 'First set', note: null }],
      faq: [{ question: 'Is there food?', answer: 'Biryani stalls from seven.' }],
      publicEmail: 'hello@swar-sadhana.test',
      publicPhone: null,
      socialLinks: { instagram: 'https://instagram.com/swarsadhana' },
      sponsors: [{ name: 'Chai Point', url: null, level: 'Partner' }],
      dressCode: 'Whatever you are comfortable in.',
      directions: 'Enter from the east gate.',
    })

    expect(screen.getByText('Nizami Bandhu')).toBeInTheDocument()
    expect(screen.getByText(/Qawwals/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Running order' })).toHaveTextContent('8:00 PM')
    expect(screen.getByRole('region', { name: 'Questions people ask' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'hello@swar-sadhana.test' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instagram' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Supported by' })).toHaveTextContent('Chai Point')
    expect(screen.getByRole('region', { name: 'Dress code' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Getting there' })).toBeInTheDocument()
  })

  it('shows none of those sections for an event without them', async () => {
    await renderEvent(selling)

    for (const name of [
      'Running order',
      'Questions people ask',
      'Contact the organiser',
      'Links',
      'Supported by',
      'Dress code',
      'Getting there',
    ]) {
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()
    }
  })
})

describe('an event over several nights', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
    // The nights fall on fixed days, because their dates are what the
    // schedule prints; whether one still sells is read from the clock. So the
    // page is read at a fixed moment before them all. With the real clock the
    // seat link went on 1 November 2026 at 17:30 UTC, when night 1 ended.
    // Only `Date` is replaced.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T12:00:00.000Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * A public night of the event.
   *
   * @param {number} index Which night, from 1.
   * @param {object} [overrides] Fields to change.
   * @returns {object} The night.
   */
  function nightOf(index, overrides = {}) {
    const startsAt = new Date(Date.UTC(2026, 10, index, 14, 30)).toISOString()

    return {
      id: `snnight${index}xxxxx`,
      label: `Night ${index}`,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 3 * 3_600_000).toISOString(),
      doorsOpenAt: null,
      timezone: 'Asia/Kolkata',
      status: 'SCHEDULED',
      salesStartAt: null,
      salesEndAt: null,
      hasSeatMap: false,
      seatsAvailable: null,
      ...overrides,
    }
  }

  it('lists every night in the schedule, each with its label and its own date', async () => {
    await renderEvent({ ...selling, sessions: [nightOf(1), nightOf(2)] })

    const schedule = screen.getByRole('region', { name: 'Schedule' })
    const nights = within(schedule).getByRole('list', { name: 'Nights' })

    expect(within(nights).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(nights).getByRole('heading', { name: 'Night 1 · Sun, Nov 1 · 8:00 PM' }),
    ).toBeInTheDocument()
    expect(
      within(nights).getByRole('heading', { name: 'Night 2 · Mon, Nov 2 · 8:00 PM' }),
    ).toBeInTheDocument()
  })

  it('links a seated night that is selling to its seats', async () => {
    await renderEvent({
      ...selling,
      sessions: [nightOf(1, { hasSeatMap: true, seatsAvailable: 20 })],
    })

    expect(screen.getAllByRole('link', { name: /^Choose seats for Night 1/u })[0]).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan/seats/snnight1xxxxx',
    )
  })

  it('keeps the old schedule for an event with no nights listed', async () => {
    await renderEvent(selling)

    expect(screen.queryByRole('list', { name: 'Nights' })).toBeNull()
    expect(screen.getByText('Doors / start')).toBeInTheDocument()
  })
})

describe('an online event', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('says the joining link is on the ticket, and never prints one', async () => {
    const { container } = await renderEvent({
      ...selling,
      isOnline: true,
      venue: null,
      // Whatever a stale or careless payload carries, the page does not print it.
      onlineUrl: 'https://stream.example.com/secret-room',
    })

    expect(screen.getByText('This event is online.')).toBeInTheDocument()
    expect(
      screen.getByText(/The joining link\s+is on your ticket once you have booked\./u),
    ).toBeInTheDocument()
    expect(screen.queryByText('The venue for this event has not been announced.')).toBeNull()
    expect(container.innerHTML).not.toContain('stream.example.com')
    expect(JSON.stringify(structuredData(container))).not.toContain('stream.example.com')
  })
})

describe('structured data written by an organiser', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  // Every string here is the organiser's own, and every one of them reaches
  // the JSON-LD block. The payload closes the script element it lands in.
  const breakout = '</script><script>window.__pwned = 1</script>'

  it('cannot close the script element it is served in, from any field', async () => {
    const hostile = {
      ...selling,
      title: `Title ${breakout}`,
      summary: `Summary ${breakout} <!-- & \u2028\u2029`,
      performers: [{ name: `Performer ${breakout}`, role: null, bio: null }],
      artists: [`Artist ${breakout}`],
      ticketTypes: [{ ...selling.ticketTypes[0], name: `Tier ${breakout}` }],
      organization: { ...selling.organization, name: `Organiser ${breakout}` },
      venue: { ...selling.venue, name: `Venue ${breakout}` },
      sessions: [1, 2].map((index) => ({
        id: `snnight${index}xxxxx`,
        label: `Night ${index} ${breakout}`,
        startsAt: new Date(Date.UTC(2026, 10, index, 14, 30)).toISOString(),
        endsAt: new Date(Date.UTC(2026, 10, index, 17, 30)).toISOString(),
        doorsOpenAt: null,
        timezone: 'Asia/Kolkata',
        status: 'SCHEDULED',
        salesStartAt: null,
        salesEndAt: null,
        hasSeatMap: false,
        seatsAvailable: null,
      })),
    }

    loadEventBySlug.mockResolvedValue({ event: hostile, usedFallback: false })
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(
      await EventDetailPage({ params: Promise.resolve({ slug: hostile.slug }) }),
    )

    // What a browser makes of the markup the server sends: one script, the
    // structured data, and nothing an organiser typed is a tag inside it.
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const scripts = parsed.querySelectorAll('script')

    expect(html.match(/<\/script>/giu)).toHaveLength(1)
    expect(scripts).toHaveLength(1)
    expect(scripts[0].getAttribute('type')).toBe('application/ld+json')
    expect(scripts[0].textContent).not.toMatch(/[<>&\u2028\u2029]/u)

    // Escaped, not stripped: a reader of the JSON gets the organiser's words.
    const data = JSON.parse(scripts[0].textContent)

    expect(data.name).toBe(hostile.title)
    expect(data.description).toBe(hostile.summary)
    expect(data.performer[0].name).toBe(hostile.performers[0].name)
    expect(data.offers[0].name).toBe(hostile.ticketTypes[0].name)
    expect(data.organizer.name).toBe(hostile.organization.name)
    expect(data.location.name).toBe(hostile.venue.name)
    expect(data.subEvent[1].name).toContain(`Night 2 ${breakout}`)
  })
})

describe('the event detail page and the organiser’s website', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
  })

  it('links to the organiser’s website through this site, naming the host, only when the API sent one', async () => {
    await renderEvent({ ...selling, websiteLink: { host: 'swar-sadhana.example' } })

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    // Never the address itself: the redirect counts the visit and goes to the
    // address an administrator approved.
    expect(link).toHaveAttribute('href', '/events/qawwali-under-the-banyan/website')
    expect(link).toHaveAttribute('rel', 'nofollow')
    expect(link).toHaveAccessibleDescription(
      'Opens swar-sadhana.example, which Desi-Event does not run. Desi-Event counts the visit without recording your address, browser or account.',
    )
    expect(screen.getByText('(swar-sadhana.example)')).toBeInTheDocument()
  })

  it('shows no website link when the API sent none, whatever else the event carries', async () => {
    for (const payload of [
      selling,
      { ...selling, websiteLink: null },
      // An insider's field never reaches the public page as a link.
      { ...selling, websiteUrl: 'https://swar-sadhana.example/', websiteLink: null },
    ]) {
      const { container, unmount } = await renderEvent(payload)

      expect(
        screen.queryByRole('link', { name: 'Visit the organiser’s website' }),
      ).not.toBeInTheDocument()
      expect(container.innerHTML).not.toContain('/website')
      expect(container.innerHTML).not.toContain('swar-sadhana.example')
      unmount()
    }
  })

  it('has no "Website" among the social links', async () => {
    await renderEvent({
      ...selling,
      socialLinks: {
        instagram: 'https://instagram.com/swarsadhana',
        website: 'https://swar-sadhana.example/',
      },
    })

    expect(screen.getByRole('link', { name: 'Instagram' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Website' })).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('https://swar-sadhana.example/')
  })
})

describe('counting visits to the event page', () => {
  /** A public event with database-shaped ids, as the API sends one. */
  const countable = {
    ...selling,
    id: 'cevtqawwali000000000001',
    organizationId: 'corgswar000000000000001',
    websiteLink: { host: 'swar-sadhana.example' },
  }

  beforeEach(() => {
    loadEventBySlug.mockReset()
    readSession.mockReset()
    readSession.mockResolvedValue(null)
  })

  it('sends the page view of a public event, once, and counts “Choose tickets”', async () => {
    await renderEvent(countable)

    const [scope] = screen.getAllByTestId('traffic-scope')

    expect(screen.getAllByTestId('traffic-scope')).toHaveLength(1)
    expect(JSON.parse(scope.dataset.view)).toEqual({
      eventId: 'cevtqawwali000000000001',
      organizationId: 'corgswar000000000000001',
    })

    const tickets = screen.getByRole('link', { name: 'Choose tickets' })

    expect(tickets).toHaveAttribute('data-traffic-kind', 'TICKETS_CLICK')
    expect(tickets).toHaveAttribute('data-traffic-placement', 'EVENT_PAGE')
    expect(tickets).toHaveAttribute('data-traffic-event', 'cevtqawwali000000000001')
    expect(tickets).toHaveAttribute('data-traffic-organization', 'corgswar000000000000001')
  })

  it('counts nothing on sample data, or on a page the public cannot see', async () => {
    loadEventBySlug.mockResolvedValue({ event: countable, usedFallback: true })
    const { unmount } = render(
      await EventDetailPage({ params: Promise.resolve({ slug: countable.slug }) }),
    )

    expect(screen.getByTestId('traffic-scope').dataset.view).toBe('null')
    expect(document.querySelectorAll('[data-traffic-kind]')).toHaveLength(0)
    unmount()

    await renderEvent({ ...countable, status: 'REVIEW_PENDING' })

    expect(screen.getByTestId('traffic-scope').dataset.view).toBe('null')
    expect(document.querySelectorAll('[data-traffic-kind]')).toHaveLength(0)
  })

  it('counts a stranger’s website visit, and says so', async () => {
    await renderEvent(countable)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/qawwali-under-the-banyan/website')
  })

  it.each([
    [
      'a member of the event’s own organisation',
      {
        capabilities: [],
        memberships: [{ organizationId: 'corgswar000000000000001', role: 'SCANNER' }],
      },
    ],
    ['Desi-Event staff', { capabilities: ['moderation:review'], memberships: [] }],
  ])('marks the website link uncounted for %s', async (_name, session) => {
    readSession.mockResolvedValue(session)
    await renderEvent(countable)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/qawwali-under-the-banyan/website?count=no')
    expect(link).toHaveAccessibleDescription(
      'Opens swar-sadhana.example, which Desi-Event does not run. Visits by the event’s own team and Desi-Event staff are not counted.',
    )
  })

  it('counts the website visit of a member of another organisation', async () => {
    readSession.mockResolvedValue({
      capabilities: [],
      memberships: [{ organizationId: 'corgother00000000000002', role: 'OWNER' }],
    })
    await renderEvent(countable)

    expect(screen.getByRole('link', { name: 'Visit the organiser’s website' })).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan/website',
    )
  })
})

describe('an event copied from its Sulekha listing', () => {
  /** A published imported event, as the API sends it: no tiers, one night with no listed end. */
  const imported = {
    ...event,
    status: 'PUBLISHED',
    timezone: 'America/Chicago',
    startsAt: '2026-11-07T00:30:00.000Z',
    endsAt: '2026-11-07T03:30:00.000Z',
    organization: {
      name: 'Sulekha Events',
      slug: 'sulekha-events',
      verified: true,
      description:
        'Events listed on Sulekha.com and shown on Desi-Event by the Desi-Event team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.',
    },
    ticketTypes: [],
    sessions: [
      {
        id: 'sesimported0000000000001',
        label: null,
        startsAt: '2026-11-07T00:30:00.000Z',
        endsAt: '2026-11-07T03:30:00.000Z',
        doorsOpenAt: null,
        timezone: 'America/Chicago',
        status: 'SCHEDULED',
        salesStartAt: null,
        salesEndAt: null,
        hasSeatMap: false,
        seatsAvailable: null,
        endTimeListed: false,
      },
    ],
    websiteLink: { host: 'events.sulekha.com' },
    importedFrom: {
      sourceName: 'Sulekha',
      presentedBy: 'Raga Nights Houston',
      listedOn: '2026-09-30',
      prices: [
        { name: 'Adult', priceCents: 2500, currency: 'USD' },
        { name: 'Child', priceCents: 0, currency: 'USD' },
      ],
      priceListed: true,
      ticketsOnSource: true,
    },
  }

  beforeEach(() => {
    loadEventBySlug.mockReset()
    readSession.mockResolvedValue(null)
  })

  it('says who presents it, under the title, with no badge vouching for them', async () => {
    await renderEvent(imported)

    expect(screen.getByText('Presented by Raga Nights Houston')).toBeInTheDocument()
    expect(screen.queryByText('Presented by Sulekha Events')).not.toBeInTheDocument()
    expect(screen.queryByText('Verified organiser')).not.toBeInTheDocument()
  })

  it('sends buyers to Sulekha with the prices as listed, and offers no buying here', async () => {
    await renderEvent(imported)

    const tickets = screen.getByRole('complementary', { name: 'Tickets' })

    expect(
      within(tickets).getByText('Tickets for this event are sold on Sulekha, not on Desi-Event.'),
    ).toBeInTheDocument()
    expect(
      within(tickets).getByText(
        'As listed on Sulekha on 30 September 2026: Adult $25.00, Child Free.',
      ),
    ).toBeInTheDocument()

    const buy = within(tickets).getByRole('link', { name: 'Buy tickets on Sulekha' })

    expect(buy).toHaveAttribute('href', '/events/qawwali-under-the-banyan/website')
    expect(screen.queryByRole('link', { name: /choose tickets/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Visit the organiser’s website' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/not on sale|cannot be bought here/i)
    expect(document.body.textContent).not.toMatch(/payments on this site are simulated/i)
  })

  it('says when Sulekha lists no price, and offers no link while it is off', async () => {
    await renderEvent({
      ...imported,
      websiteLink: null,
      importedFrom: {
        ...imported.importedFrom,
        prices: [],
        priceListed: false,
        ticketsOnSource: false,
      },
    })

    expect(screen.getByText('Sulekha does not list a price for this event.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Buy tickets on Sulekha' })).toBeNull()
    expect(document.body.innerHTML).not.toContain('/website')
  })

  it('shows only the start when the listing gave no end time', async () => {
    const { container } = await renderEvent(imported)
    const nights = screen.getByRole('list', { name: 'Nights' })

    expect(within(nights).getByText('Starts')).toBeInTheDocument()
    expect(within(nights).queryByText('Ends')).not.toBeInTheDocument()
    expect(within(nights).getByText('Tickets on Sulekha')).toBeInTheDocument()
    // Neither the hero nor the ticket box prints the estimated end.
    expect(container.textContent).not.toMatch(/–\s*9:30/u)
  })

  it('publishes the presenting organiser, no offers and no end in its structured data', async () => {
    const { container } = await renderEvent(imported)
    const data = structuredData(container)

    expect(data.organizer).toEqual({ '@type': 'Organization', name: 'Raga Nights Houston' })
    expect(data.offers).toBeUndefined()
    expect(data).not.toHaveProperty('endDate')
  })
})

describe('paying at the venue (SPEC3 §12.2)', () => {
  it('says, as a note and not an alert, that the event can be paid for at the venue', async () => {
    await renderEvent({ ...selling, venuePayment: { available: true } })

    const note = screen.getByTestId('venue-payment-note')

    expect(note).toHaveTextContent(
      'You can pay at the venue for this event: pay the booking fee online now (simulated), and the ticket price at the door.',
    )
    expect(note).not.toHaveAttribute('role')
  })

  it('says nothing of it when the event cannot be paid for at the venue', async () => {
    await renderEvent({ ...selling, venuePayment: { available: false } })

    expect(screen.queryByTestId('venue-payment-note')).toBeNull()
  })
})
