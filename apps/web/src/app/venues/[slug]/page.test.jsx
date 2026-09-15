import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  loadVenueBySlug: vi.fn(),
}))

const { loadVenueBySlug } = await import('../../../lib/api.js')
const { default: VenuePage, generateMetadata } = await import('./page.jsx')

const missing = { params: Promise.resolve({ slug: 'no-such-venue' }) }
const route = { params: Promise.resolve({ slug: 'jio-world-garden' }) }

/**
 * A public venue payload, with overrides.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The venue.
 */
function venue(overrides = {}) {
  return {
    id: 'vnu1',
    slug: 'jio-world-garden',
    name: 'Jio World Garden',
    addressLine1: 'Bandra Kurla Complex',
    addressLine2: 'G Block, BKC',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400051',
    country: 'IN',
    latitude: 19.0653,
    longitude: 72.8676,
    capacity: 6000,
    timezone: 'Asia/Kolkata',
    shared: true,
    mergedIntoVenueId: null,
    canonicalSlug: null,
    accessibility: {
      features: ['STEP_FREE_ENTRANCE', 'ACCESSIBLE_TOILET', 'HEARING_LOOP'],
      note: 'The accessible entrance is Gate 3; ring the bell and staff take five minutes.',
    },
    description: null,
    directions: 'Nearest metro is Bandra Kurla.',
    policies: 'No professional cameras.',
    provenance: 'moderator',
    upcomingEvents: [
      {
        slug: 'qawwali-under-the-banyan',
        title: 'Qawwali Under the Banyan',
        startsAt: '2026-11-01T14:30:00.000Z',
        organizerName: 'Rangmanch Collective',
      },
    ],
    ...overrides,
  }
}

describe('the venue page when there is no such venue', () => {
  beforeEach(() => {
    loadVenueBySlug.mockReset()
    loadVenueBySlug.mockResolvedValue({ venue: null, usedFallback: false })
  })

  it('renders the shared not-found view', async () => {
    render(await VenuePage(missing))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
  })

  it('keeps the page out of the index and claims no canonical URL', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates).toBeUndefined()
  })

  it('publishes no structured data about a place that is not there', async () => {
    const { container } = render(await VenuePage(missing))

    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })
})

describe('the venue page', () => {
  beforeEach(() => {
    loadVenueBySlug.mockReset()
    loadVenueBySlug.mockResolvedValue({ venue: venue(), usedFallback: false })
  })

  it('names the venue once, at the top', async () => {
    render(await VenuePage(route))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jio World Garden')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('gives the address as an address element', async () => {
    const { container } = render(await VenuePage(route))
    const address = container.querySelector('address')

    expect(address.textContent).toContain('Bandra Kurla Complex')
    expect(address.textContent).toContain('Mumbai')
  })

  it('states the venue time zone rather than assuming the reader shares it', async () => {
    render(await VenuePage(route))

    expect(screen.getByText(/Asia\/Kolkata/)).toBeInTheDocument()
    expect(screen.getByText(/local time at the venue, not/i)).toBeInTheDocument()
  })

  it('renders each accessibility claim as readable text, not an icon', async () => {
    render(await VenuePage(route))

    const access = screen.getByRole('region', { name: 'Accessibility' })

    expect(within(access).getByText('Step-free entrance')).toBeInTheDocument()
    expect(within(access).getByText('Accessible toilet')).toBeInTheDocument()
    expect(within(access).getByText('Hearing loop')).toBeInTheDocument()
  })

  it('announces each claim as something the venue has', async () => {
    render(await VenuePage(route))

    // A badge with no announced meaning is decoration to a screen reader.
    expect(screen.getByText('Step-free entrance').textContent).toMatch(/This venue has:/)
  })

  it('keeps the free-text note, which is what a wheelchair user actually reads', async () => {
    render(await VenuePage(route))

    expect(screen.getByText(/Gate 3/)).toBeInTheDocument()
  })

  it('says so plainly when a venue has published nothing about access', async () => {
    // Silence would read as "no access". Saying we will find out is honest and
    // actionable; inventing claims is neither.
    loadVenueBySlug.mockResolvedValue({
      venue: venue({ accessibility: null }),
      usedFallback: false,
    })

    render(await VenuePage(route))

    expect(screen.getByText(/has not published its accessibility details/i)).toBeInTheDocument()
    expect(screen.queryByText('Step-free entrance')).not.toBeInTheDocument()
  })

  it('lists what is on, linking to each event', async () => {
    render(await VenuePage(route))

    const whatsOn = screen.getByRole('region', { name: /What/ })

    expect(within(whatsOn).getByRole('link', { name: /Qawwali/ })).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan',
    )
  })

  it('renders event times in the venue zone with a machine-readable stamp', async () => {
    const { container } = render(await VenuePage(route))
    const time = container.querySelector('time[datetime="2026-11-01T14:30:00.000Z"]')

    // 14:30 UTC is 20:00 in Asia/Kolkata.
    expect(time.textContent).toMatch(/8:00 pm/i)
  })

  it('publishes Place structured data describing only what it knows', async () => {
    const { container } = render(await VenuePage(route))
    const json = JSON.parse(
      container.querySelector('script[type="application/ld+json"]').textContent,
    )

    expect(json['@type']).toBe('Place')
    expect(json.address.addressLocality).toBe('Mumbai')
    expect(json.geo.latitude).toBe(19.0653)
    expect(json.accessibilityFeature).toContain('Step-free entrance')
  })

  it('omits coordinates and capacity it does not have', async () => {
    loadVenueBySlug.mockResolvedValue({
      venue: venue({ latitude: null, longitude: null, capacity: null }),
      usedFallback: false,
    })

    const { container } = render(await VenuePage(route))
    const json = JSON.parse(
      container.querySelector('script[type="application/ld+json"]').textContent,
    )

    expect(json).not.toHaveProperty('geo')
    expect(json).not.toHaveProperty('maximumAttendeeCapacity')
  })

  it('points its canonical at itself', async () => {
    const metadata = await generateMetadata(route)

    expect(metadata.alternates.canonical).toBe('/venues/jio-world-garden')
  })

  it('says a merged venue was merged, and points at the survivor', async () => {
    // The old URL still resolves: every link and printed QR made before the
    // merge points here, and 404ing all of them is not a tidy-up.
    loadVenueBySlug.mockResolvedValue({
      venue: venue({ canonicalSlug: 'nehru-centre' }),
      usedFallback: false,
    })

    render(await VenuePage({ params: Promise.resolve({ slug: 'old-slug' }) }))

    expect(screen.getByText(/merged into another one/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /current page/i })).toHaveAttribute(
      'href',
      '/venues/nehru-centre',
    )
    // And reassures the reader about the thing they will worry about.
    expect(screen.getByText(/tickets are unaffected/i)).toBeInTheDocument()
  })

  it('canonicalises a merged venue at the record that survived', async () => {
    loadVenueBySlug.mockResolvedValue({
      venue: venue({ canonicalSlug: 'nehru-centre' }),
      usedFallback: false,
    })

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'old-slug' }) })

    expect(metadata.alternates.canonical).toBe('/venues/nehru-centre')
  })

  it('needs no JavaScript to be readable', async () => {
    const { container } = render(await VenuePage(route))

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.textContent).toMatch(/Jio World Garden/)
    expect(container.textContent).toMatch(/Step-free entrance/)
  })

  it('says when the page came from the offline catalogue', async () => {
    loadVenueBySlug.mockResolvedValue({ venue: venue(), usedFallback: true })

    render(await VenuePage(route))

    expect(screen.getByText(/sample/i)).toBeInTheDocument()
  })

  it('notes that the order snapshot governs, not the current house rules', async () => {
    render(await VenuePage(route))

    expect(screen.getByText(/does not change what you agreed to/i)).toBeInTheDocument()
  })
})
