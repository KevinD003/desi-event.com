/**
 * The event review page: what a moderator reads before deciding, and above all
 * that a failed read of the pictures is never drawn as "no pictures" over an
 * approval that approves every picture waiting.
 *
 * @file app/moderation/events/id/page.test.jsx
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/moderation/events/evtqawwalibanyan',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../../lib/organizer-api.js', async () => {
  const actual = await vi.importActual('../../../../lib/organizer-api.js')

  return {
    ...actual,
    getEventMedia: vi.fn(),
    getEventReadiness: vi.fn(),
    getEventSessions: vi.fn(),
    getEventTicketTypes: vi.fn(),
    getModerationHistory: vi.fn(),
    getOrganizerEvent: vi.fn(),
  }
})

const { apiFetch } = await import('../../../../lib/api-fetch.js')
const {
  getEventMedia,
  getEventReadiness,
  getEventSessions,
  getEventTicketTypes,
  getModerationHistory,
  getOrganizerEvent,
} = await import('../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../lib/session.js')
const { default: ReviewEventPage } = await import('./page.jsx')
const { CONFLICT_OF_INTEREST_NOTICE, IMPORTED_EVENT_NO_EDITOR_NOTICE } =
  await import('../../../../lib/review-independence.js')
const { CANNOT_DECIDE, DELETED_EVENT_FROZEN } =
  await import('../../../../components/website-redirect-panel.jsx')

/** A platform reviewer who belongs to no organisation. */
const REVIEWER = {
  user: { displayName: 'Mod' },
  capabilities: ['moderation:review', 'event:view_draft'],
  memberships: [],
}

/** The event under review. */
const EVENT = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  description: 'One paragraph about the night.',
  status: 'REVIEW_PENDING',
  revision: 6,
  timezone: 'America/New_York',
  startsAt: '2026-11-01T23:30:00.000Z',
  endsAt: '2026-11-02T02:30:00.000Z',
  isOnline: false,
  venue: null,
  organization: { id: 'org1', name: 'Banyan Nights', slug: 'banyan-nights' },
  ticketTypes: [],
  artists: [],
  policies: { refund: 'Refundable up to 48 hours before.' },
}

/** A picture waiting for review. */
const COVER = {
  id: 'cmedia0000000000000000001',
  url: '/v1/media/cmedia0000000000000000001',
  altText: 'Dancers circling a lit garbo',
  width: 1200,
  height: 630,
  contentType: 'image/png',
  kind: 'EVENT_COVER',
  position: null,
  byteSize: 204_800,
  checksum: 'a'.repeat(64),
  moderationStatus: 'PENDING',
  rejectionReason: null,
  publiclyVisible: false,
  createdAt: '2026-09-01T10:00:00.000Z',
}

/**
 * Render the page.
 *
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage() {
  render(await ReviewEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
}

beforeEach(() => {
  apiFetch.mockReset()
  getOrganizerEvent.mockResolvedValue(EVENT)
  getEventSessions.mockResolvedValue({ data: [] })
  getEventTicketTypes.mockResolvedValue({ data: [], meta: { revision: 6 } })
  getEventReadiness.mockResolvedValue({
    ready: true,
    status: 'REVIEW_PENDING',
    publishable: [],
    sellable: [],
    inventory: [],
    organizerVerified: true,
  })
  getModerationHistory.mockResolvedValue([])
  getEventMedia.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue(REVIEWER)
})

describe('the pictures on the review page', () => {
  it('lists the pictures and offers every decision when they load', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })

    await renderPage()

    expect(screen.getByRole('img', { name: COVER.altText })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByText(/Approval is held/)).toBeNull()
  })

  it('says "no pictures" only when the read succeeded with none', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })

    await renderPage()

    expect(screen.getByText('This event has no pictures.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it.each([
    ['the API is unreachable', { status: 0, code: 'API_UNREACHABLE' }],
    ['the shared address is rate-limited', { status: 429, code: 'RATE_LIMITED' }],
    ['the API failed', { status: 500, code: 'INTERNAL' }],
  ])('never says there are no pictures when %s, and holds approval back', async (_why, failure) => {
    const user = userEvent.setup()

    getEventMedia.mockRejectedValue(Object.assign(new Error('refused'), failure))

    await renderPage()

    expect(screen.queryByText('This event has no pictures.')).toBeNull()
    expect(screen.getByText('Approval is held until the pictures can be shown')).toBeVisible()

    const approve = screen.getByRole('button', { name: 'Approve' })

    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription(/would also approve pictures you have not seen/)
    // What needs no picture to have been seen is still possible.
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()

    await user.click(approve)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the revision the page showed with the decision', async () => {
    const user = userEvent.setup()

    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'APPROVED' } }),
    })

    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'approve',
      revision: 6,
    })
  })
})

describe('what the listing says, as the moderator reads it', () => {
  it('renders the description as the public page will, and every link in full', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      description: 'A **long** night.\n\n- Chai\n- Samosas',
      performers: [{ name: 'Nizami Bandhu', role: 'Qawwals', bio: null }],
      socialLinks: { instagram: 'https://instagram.com/banyan.nights' },
      sponsors: [{ name: 'Chai Point', url: 'https://chai.example/sponsor', level: 'Gold' }],
      dressCode: 'Comfortable.',
    })

    await renderPage()

    expect(screen.getByText('long').tagName).toBe('STRONG')
    expect(screen.getByText('Chai').tagName).toBe('LI')
    expect(screen.getByText('Instagram: https://instagram.com/banyan.nights')).toBeInTheDocument()
    expect(
      screen.getByText(/Chai Point \(Gold\) — https:\/\/chai\.example\/sponsor/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nizami Bandhu — Qawwals/)).toBeInTheDocument()
    expect(screen.getByText('Comfortable.')).toBeInTheDocument()
  })

  it('writes out where every link in the description goes, not only its label', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      description:
        'Buy from [Official tickets](https://phish.example/buy?ref=1) only.\n\n- See https://banyan.example/faq',
    })

    await renderPage()

    const link = screen.getByRole('link', { name: 'Official tickets' })

    expect(link).toHaveAttribute('href', 'https://phish.example/buy?ref=1')
    // The address, in full, as text beside the label.
    expect(screen.getByText('(https://phish.example/buy?ref=1)')).toBeInTheDocument()
    // A bare address is its own label, and is not written twice.
    expect(screen.getByRole('link', { name: 'https://banyan.example/faq' })).toBeInTheDocument()
    expect(screen.queryByText('(https://banyan.example/faq)')).not.toBeInTheDocument()
  })

  it('flags hidden and complimentary ticket types', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getEventTicketTypes.mockResolvedValue({
      data: [
        {
          id: 'tguest',
          name: 'Guest list',
          priceCents: 0,
          currency: 'USD',
          visibility: 'HIDDEN',
          complimentary: true,
        },
        {
          id: 'tgeneral',
          name: 'General',
          priceCents: 3500,
          currency: 'USD',
          visibility: 'PUBLIC',
        },
      ],
      meta: { revision: 6 },
    })

    await renderPage()

    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Complimentary')).toBeInTheDocument()
    expect(screen.getByText(/General — \$35\.00/)).toBeInTheDocument()
  })
})

describe('the decision, once it is taken', () => {
  it('keeps the outcome on screen when the refresh it asks for brings the approved event back', async () => {
    const user = userEvent.setup()
    const params = { params: Promise.resolve({ id: EVENT.id }) }

    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'APPROVED' } }),
    })

    const { rerender } = render(await ReviewEventPage(params))

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    const said = await screen.findByText('Approve — this event is now APPROVED.')
    const region = said.closest('[role="status"]')

    // What `router.refresh()` does: the server renders the page again, now
    // with the event approved, and React reconciles it into the tree on
    // screen. Before, the page swapped the decision form for a notice here —
    // and the live region announcing the outcome went with it, about a
    // quarter of a second after it spoke.
    getOrganizerEvent.mockResolvedValue({ ...EVENT, status: 'APPROVED', revision: 7 })
    rerender(await ReviewEventPage(params))

    expect(region).toBeInTheDocument()
    expect(region).toHaveTextContent('Approve — this event is now APPROVED.')
    expect(screen.getByText('Nothing to decide')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This event is approved, not public. A decision can only be taken on something waiting for review.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByText(/approving also approves every picture/i)).toBeNull()
  })

  it('offers no decision on an event that is not waiting for review, and says why', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({ ...EVENT, status: 'APPROVED' })

    await renderPage()

    expect(screen.getByText('Nothing to decide')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This event is approved, not public. A decision can only be taken on something waiting for review.',
      ),
    ).toBeInTheDocument()

    for (const name of ['Request changes', 'Approve', 'Reject']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })
})

describe('a reviewer who belongs to the event’s organisation', () => {
  it('is told somebody else decides, and is offered no decision', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({ ...EVENT, organizationId: 'org1' })
    readSession.mockResolvedValue({
      ...REVIEWER,
      memberships: [{ organizationId: 'org1', role: 'VIEWER', capabilities: [] }],
    })

    await renderPage()

    // Said twice: in place of the event decision, and above the pictures,
    // whose decisions the API refuses to a member just the same.
    const notices = screen.getAllByText(CONFLICT_OF_INTEREST_NOTICE)

    expect(notices).toHaveLength(2)
    for (const notice of notices) expect(notice).toBeVisible()
    expect(CONFLICT_OF_INTEREST_NOTICE).toBe(
      'You belong to this organisation, so somebody else on the team at The Desi Events has to decide this.',
    )

    for (const name of ['Request changes', 'Approve', 'Reject']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // The waiting cover is still shown, with no picture decision on it.
    expect(screen.getByRole('listitem', { name: 'Cover' })).toBeInTheDocument()
    for (const name of ['Reject this picture', 'Approve this picture']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('is offered every decision when the membership is in another organisation', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({ ...EVENT, organizationId: 'org1' })
    readSession.mockResolvedValue({
      ...REVIEWER,
      memberships: [{ organizationId: 'org2', role: 'OWNER', capabilities: [] }],
    })

    await renderPage()

    expect(screen.queryByText(CONFLICT_OF_INTEREST_NOTICE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject this picture' })).toBeEnabled()
  })
})

describe('an import the platform-held organisation holds (SPEC2-XI O16)', () => {
  /** What the event read carries for a platform-held import. */
  const IMPORTED_FROM = {
    sourceName: 'Sulekha',
    presentedBy: 'DFW Garba Collective',
    listedOn: '2026-09-29',
    prices: [],
    priceListed: false,
    ticketsOnSource: false,
  }

  it('offers approving and rejecting, not "request changes", and sends the reason to nobody', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      organization: { id: 'orgsulekha', name: 'Sulekha Events', slug: 'sulekha-events' },
      importedFrom: IMPORTED_FROM,
    })

    await renderPage()

    expect(screen.getByText(IMPORTED_EVENT_NO_EDITOR_NOTICE)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
    expect(screen.queryByText(/your reason goes to the organiser/i)).toBeNull()
    expect(
      screen.getByText(/nobody runs this event on the desi events, so it goes to nobody/i),
    ).toBeVisible()
  })

  it('says only rejecting is left when the pictures cannot be shown', async () => {
    getEventMedia.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }))
    getOrganizerEvent.mockResolvedValue({ ...EVENT, importedFrom: IMPORTED_FROM })

    await renderPage()

    expect(screen.getByText(/rejecting is still available/i)).toBeVisible()
    expect(screen.queryByText(/asking for changes/i)).toBeNull()
  })

  it('keeps every decision and the organiser sentence for any other event', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({ ...EVENT, importedFrom: null })

    await renderPage()

    expect(screen.queryByText(IMPORTED_EVENT_NO_EDITOR_NOTICE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.getByText(/your reason goes to the organiser/i)).toBeVisible()
  })
})

describe('the website link on the review page', () => {
  /** The organiser's address, waiting for a decision. */
  const WAITING = {
    enabled: false,
    pending: true,
    decidedUrl: null,
    submittedAt: '2026-10-01T08:30:00.000Z',
    changedAt: null,
    reason: null,
    changedByName: null,
    websiteProblem: null,
  }

  /** A platform administrator, who may switch the link. */
  const ADMINISTRATOR = {
    ...REVIEWER,
    user: { displayName: 'Anil Administrator' },
    capabilities: [...REVIEWER.capabilities, 'website_redirect:manage'],
  }

  it('writes the address out, and gives a moderator the panel without its controls, in any status', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })

    for (const status of ['REVIEW_PENDING', 'PUBLISHED', 'DRAFT']) {
      cleanup()
      getOrganizerEvent.mockResolvedValue({
        ...EVENT,
        status,
        websiteUrl: 'https://banyan.example/nights?lang=ur',
        websiteRedirect: WAITING,
      })

      await renderPage()

      const listing = screen.getByRole('region', { name: 'What the listing says' })

      expect(within(listing).getByText('Website')).toBeInTheDocument()
      expect(within(listing).getByText('https://banyan.example/nights?lang=ur')).toHaveClass(
        'break-all',
      )

      const panel = screen.getByRole('region', { name: 'Website link' })

      expect(panel).toHaveAttribute('id', 'website-link')
      expect(within(panel).getByText(CANNOT_DECIDE)).toBeInTheDocument()
      expect(within(panel).queryByRole('button')).toBeNull()
    }
  })

  it('gives an administrator the controls, and says when the page is not public', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    readSession.mockResolvedValue(ADMINISTRATOR)
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      websiteUrl: 'https://banyan.example/',
      websiteRedirect: WAITING,
    })

    await renderPage()

    const panel = screen.getByRole('region', { name: 'Website link' })

    expect(within(panel).getByRole('button', { name: 'Turn the link on' })).toBeEnabled()
    expect(within(panel).getByRole('button', { name: 'Turn the link off' })).toBeEnabled()
    expect(
      within(panel).getByText(
        'The link shows on the public page only while the event’s page is public.',
      ),
    ).toBeInTheDocument()

    cleanup()
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'PUBLISHED',
      websiteUrl: 'https://banyan.example/',
      websiteRedirect: WAITING,
    })

    await renderPage()

    expect(
      screen.queryByText(
        'The link shows on the public page only while the event’s page is public.',
      ),
    ).toBeNull()
  })

  it('offers nobody the controls on a deleted event, and says its switch is kept', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    readSession.mockResolvedValue(ADMINISTRATOR)
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'DELETED',
      websiteUrl: 'https://banyan.example/',
      websiteRedirect: {
        ...WAITING,
        enabled: true,
        pending: false,
        decidedUrl: 'https://banyan.example/',
        submittedAt: null,
        changedAt: '2026-09-30T10:00:00.000Z',
        reason: 'Checked.',
        changedByName: 'Anil Administrator',
      },
    })

    await renderPage()

    const panel = screen.getByRole('region', { name: 'Website link' })

    // The switch as it was kept: still on, for the address decided.
    expect(within(panel).getByText('On')).toBeInTheDocument()
    expect(within(panel).getByText(DELETED_EVENT_FROZEN)).toBeInTheDocument()
    // Nothing to press: the API answers every decision with NOT_EDITABLE.
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(within(panel).queryByRole('checkbox')).toBeNull()
    expect(within(panel).queryByLabelText(/Reason/u)).toBeNull()
    expect(within(panel).queryByText(CANNOT_DECIDE)).toBeNull()
  })

  it('says "None given" when the organiser gave no address', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })

    await renderPage()

    const listing = screen.getByRole('region', { name: 'What the listing says' })

    expect(within(listing).getByText('None given')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The organiser has not given a website address, so there is nothing to link to.',
      ),
    ).toBeInTheDocument()
  })
})

describe('the page the team at The Desi Events keeps for the event', () => {
  it('is offered to a platform editor, with deleting, and not to a moderator', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    readSession.mockResolvedValue({
      ...REVIEWER,
      capabilities: [...REVIEWER.capabilities, 'event:platform_edit'],
    })
    await renderPage()

    expect(
      screen.getByRole('link', { name: 'Open in the editor as the team at The Desi Events' }),
    ).toHaveAttribute('href', `/admin/events/${EVENT.id}`)
    expect(screen.getByRole('link', { name: 'Delete…' })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT.id}#delete-event`,
    )

    cleanup()
    readSession.mockResolvedValue(REVIEWER)
    await renderPage()

    expect(
      screen.queryByRole('link', { name: 'Open in the editor as the team at The Desi Events' }),
    ).not.toBeInTheDocument()
  })

  it('counts the pictures waiting on a posted event, links the queue, and lets each be approved', async () => {
    getOrganizerEvent.mockResolvedValue({ ...EVENT, status: 'ON_SALE' })
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    await renderPage()

    expect(
      screen.getByText(/1 picture is waiting for a decision on this posted event\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pictures waiting' })).toHaveAttribute(
      'href',
      '/moderation/pictures',
    )
    expect(screen.getByRole('button', { name: 'Approve this picture' })).toBeInTheDocument()
  })
})
