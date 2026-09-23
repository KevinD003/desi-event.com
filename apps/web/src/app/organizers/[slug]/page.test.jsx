import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  loadOrganizerBySlug: vi.fn(),
}))

const { loadOrganizerBySlug } = await import('../../../lib/api.js')
const { default: OrganizerPage, generateMetadata } = await import('./page.jsx')

/** A slug that resolves to nothing, whatever the reason. */
const missing = { params: Promise.resolve({ slug: 'no-such-organiser' }) }

/** The route props for the organiser below. */
const route = { params: Promise.resolve({ slug: 'swar-sadhana-trust' }) }

/**
 * A public organiser profile, with overrides.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The profile.
 */
function organizer(overrides = {}) {
  return {
    slug: 'swar-sadhana-trust',
    name: 'Swar Sadhana Trust',
    description: 'Custodians of Hindustani repertoire.\n\nAnd of the artists who carry it.',
    websiteUrl: 'https://swarsadhana.example',
    verified: true,
    refundPolicy: 'A full refund up to the interval.',
    timezone: 'Asia/Kolkata',
    upcomingEvents: [
      {
        slug: 'thumri-evening',
        title: 'Thumri Evening',
        startsAt: '2026-11-01T14:30:00.000Z',
        venueName: 'Nehru Centre',
      },
    ],
    pastEvents: [
      {
        slug: 'dhrupad-morning',
        title: 'Dhrupad Morning',
        startsAt: '2025-02-01T03:30:00.000Z',
        venueName: null,
      },
    ],
    ...overrides,
  }
}

describe('the organiser page when there is no such organiser', () => {
  beforeEach(() => {
    loadOrganizerBySlug.mockReset()
    loadOrganizerBySlug.mockResolvedValue({ organizer: null, usedFallback: false })
  })

  it('renders the not-found view rather than an empty page', async () => {
    render(await OrganizerPage(missing))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
  })

  it('keeps the page out of the index and claims no canonical URL', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates).toBeUndefined()
  })

  it('says nothing about why the organiser is missing', async () => {
    // A suspended organiser is 404 from the API, so this page must read exactly
    // the same as one for a slug nobody ever had. Otherwise the difference
    // between the two is a suspension anybody can detect.
    render(await OrganizerPage(missing))

    expect(document.body.textContent).not.toMatch(
      /suspend|revok|reject|under review|unverified|moderat|investigat/i,
    )
  })
})

describe('the organiser page', () => {
  beforeEach(() => {
    loadOrganizerBySlug.mockReset()
    loadOrganizerBySlug.mockResolvedValue({ organizer: organizer(), usedFallback: false })
  })

  it('names the organiser in a single top-level heading', async () => {
    render(await OrganizerPage(route))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Swar Sadhana Trust')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows the verified badge, announced as a status rather than a decoration', async () => {
    render(await OrganizerPage(route))

    const badge = screen.getByText('Verified organiser')

    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toMatch(/Organiser status:/)
  })

  it('shows no badge for an organiser who has not been verified', async () => {
    loadOrganizerBySlug.mockResolvedValue({
      organizer: organizer({ verified: false }),
      usedFallback: false,
    })

    render(await OrganizerPage(route))

    expect(screen.queryByText(/Verified organiser/)).not.toBeInTheDocument()
    // And nothing softer in its place: no "pending", no greyed-out badge.
    expect(document.body.textContent).not.toMatch(/pending|awaiting|not yet verified/i)
  })

  it('lists upcoming and past events in separate labelled sections', async () => {
    render(await OrganizerPage(route))

    const upcoming = screen.getByRole('region', { name: 'Upcoming events' })
    const past = screen.getByRole('region', { name: 'Previously' })

    expect(within(upcoming).getByRole('link', { name: /Thumri Evening/ })).toHaveAttribute(
      'href',
      '/events/thumri-evening',
    )
    expect(within(past).getByRole('link', { name: /Dhrupad Morning/ })).toHaveAttribute(
      'href',
      '/events/dhrupad-morning',
    )
    expect(within(upcoming).queryByText(/Dhrupad Morning/)).not.toBeInTheDocument()
  })

  it('renders each date in the organiser own zone, with a machine-readable time', async () => {
    const { container } = render(await OrganizerPage(route))

    const time = container.querySelector('time[datetime="2026-11-01T14:30:00.000Z"]')

    // 14:30 UTC is 20:00 in Asia/Kolkata. A visitor deciding whether they can
    // get there needs the local time at the event, not their own.
    expect(time).toHaveAttribute('dateTime', '2026-11-01T14:30:00.000Z')
    expect(time.textContent).toMatch(/8:00 pm/i)
  })

  it('says so plainly when there is nothing on sale', async () => {
    loadOrganizerBySlug.mockResolvedValue({
      organizer: organizer({ upcomingEvents: [] }),
      usedFallback: false,
    })

    render(await OrganizerPage(route))

    expect(
      within(screen.getByRole('region', { name: 'Upcoming events' })).getByText(/nothing on sale/i),
    ).toBeInTheDocument()
  })

  it('publishes the refund policy, and says it is the current text, not a copy kept per order', async () => {
    // It used to say the policy "attached to your order at the moment you
    // paid" governs. No order keeps one: `Order.policySnapshot` is never
    // written. So the page says what is true.
    render(await OrganizerPage(route))

    const refunds = screen.getByRole('region', { name: 'Refunds' })

    expect(within(refunds).getByText(/full refund up to the interval/i)).toBeInTheDocument()
    expect(within(refunds).getByText(/This is the policy as it reads now/)).toBeInTheDocument()
    expect(refunds.textContent).not.toMatch(/attached to your order|snapshot/i)
  })

  it('says so when no policy is published, and promises no terms at checkout', async () => {
    loadOrganizerBySlug.mockResolvedValue({
      organizer: organizer({ refundPolicy: null }),
      usedFallback: false,
    })

    render(await OrganizerPage(route))

    expect(screen.getByText(/has not published a refund policy/i)).toBeInTheDocument()
  })

  it('promises no support desk and no email, and names the one way to reach them', async () => {
    const { container } = render(await OrganizerPage(route))

    const contact = screen.getByRole('region', { name: 'Contact' })

    expect(contact.textContent).toMatch(/does not pass messages between buyers and organisers/)
    expect(container.textContent).not.toMatch(/Desi-Event support|confirmation email|reply address/i)
  })

  it('never puts an organiser email address on the page', async () => {
    // The contact column is an account detail, not a box office. The API does
    // not send it; this asserts the page would not print one if it did.
    loadOrganizerBySlug.mockResolvedValue({
      organizer: { ...organizer(), contactEmail: 'trust@swarsadhana.example' },
      usedFallback: false,
    })

    render(await OrganizerPage(route))

    expect(document.body.textContent).not.toMatch(/@swarsadhana\.example/)
    expect(document.body.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('marks the organiser website as untrusted and external', async () => {
    render(await OrganizerPage(route))

    const link = screen.getByRole('link', { name: 'swarsadhana.example' })

    expect(link).toHaveAttribute('href', 'https://swarsadhana.example')
    expect(link.getAttribute('rel')).toMatch(/nofollow/)
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('needs no JavaScript to be a usable page', async () => {
    // Everything that matters is a link or text in the server-rendered markup:
    // no button that only works once hydrated, and no empty container waiting
    // for a client component to fill it.
    const { container } = render(await OrganizerPage(route))

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.textContent).toMatch(/Swar Sadhana Trust/)
    expect(container.querySelectorAll('a[href]').length).toBeGreaterThan(3)
  })

  it('claims a canonical URL and describes itself for a link preview', async () => {
    const metadata = await generateMetadata(route)

    expect(metadata.title).toBe('Swar Sadhana Trust')
    expect(metadata.alternates.canonical).toBe('/organizers/swar-sadhana-trust')
    expect(metadata.openGraph.url).toBe('/organizers/swar-sadhana-trust')
    expect(metadata.robots).toBeUndefined()
  })

  it('describes an organiser with no description without leaving the tag empty', async () => {
    loadOrganizerBySlug.mockResolvedValue({
      organizer: organizer({ description: null }),
      usedFallback: false,
    })

    const metadata = await generateMetadata(route)

    expect(metadata.description).toMatch(/Swar Sadhana Trust/)
  })

  it('says when the page came from the offline catalogue', async () => {
    loadOrganizerBySlug.mockResolvedValue({ organizer: organizer(), usedFallback: true })

    render(await OrganizerPage(route))

    expect(screen.getByText(/sample/i)).toBeInTheDocument()
  })
})
