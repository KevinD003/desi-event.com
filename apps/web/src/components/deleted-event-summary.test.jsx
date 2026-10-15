import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/events/cevent0000000000000000001',
}))

const { apiFetch } = await import('../lib/api-fetch.js')
const { DeletedEventSummary } = await import('./deleted-event-summary.jsx')
const { PlatformChangesPanel } = await import('./platform-changes-panel.jsx')
const { EventChangesList } = await import('./event-changes-list.jsx')

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * A deleted event as its team reads it.
 *
 * @param {object} [deletion] Fields of the deletion record to change.
 * @returns {object} The event.
 */
function deleted(deletion = {}) {
  return {
    id: 'cevent0000000000000000001',
    title: 'Diwali Mela',
    slug: 'diwali-mela-2026',
    status: 'DELETED',
    revision: 9,
    timezone: 'America/Chicago',
    deletion: {
      deletedAt: '2026-10-01T15:00:00.000Z',
      reason: 'The venue closed for good.',
      outcome: 'CANCEL_AND_REFUND',
      authority: 'PLATFORM',
      statusBefore: 'ON_SALE',
      restoreTo: 'SALES_PAUSED',
      deletedByName: null,
      ...deletion,
    },
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('DeletedEventSummary', () => {
  it('tells an organiser when, by whom, why and what, without the administrator’s name', () => {
    render(<DeletedEventSummary event={deleted()} />)

    const section = screen.getByRole('region', { name: 'This event was deleted' })

    expect(within(section).getByText('Deleted', { selector: 'span *, span' })).toBeVisible()
    expect(
      within(section).getByText(/Oct 1, 2026 at 10:00\s?AM, by the team at The Desi Events\./),
    ).toBeVisible()
    expect(within(section).getByText('The venue closed for good.')).toBeVisible()
    expect(
      within(section).getByText(/It was cancelled, and what was left of every paid order/),
    ).toBeVisible()
    expect(
      within(section).getByText(/Only the team at The Desi Events can restore a deleted event\./),
    ).toBeVisible()
    expect(within(section).queryByRole('button', { name: 'Restore…' })).not.toBeInTheDocument()
    expect(
      within(section).queryByRole('button', { name: 'Finish refunds' }),
    ).not.toBeInTheDocument()
  })

  it('offers the team at The Desi Events a restore, and a member who may the refunds still owed', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: { code: 'NOTHING_OWED', message: 'Every refund this event owes has been sent.' },
      }),
    )
    const user = userEvent.setup()

    render(
      <DeletedEventSummary
        event={deleted({ deletedByName: 'Anil Rao' })}
        mayRestore
        mayFinishRefunds
      />,
    )

    expect(screen.getByText(/by Anil Rao, of the team at The Desi Events\./)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Restore…' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Finish refunds' }))

    expect(await screen.findByText('Every refund this event owes has been sent.')).toBeVisible()
    expect(apiFetch).toHaveBeenCalledWith('/v1/events/cevent0000000000000000001/refunds/finish', {
      method: 'POST',
    })
  })

  it('tells the team at The Desi Events, above Restore, that a deleted import goes back live at any time', () => {
    render(
      <DeletedEventSummary
        event={{
          ...deleted({ outcome: 'REMOVE', statusBefore: 'PUBLISHED', restoreTo: 'PUBLISHED' }),
          slug: 'toronto-garba-night',
          importedFrom: { presentedBy: 'Toronto Garba Collective', ticketsOnSource: true },
        }}
        mayRestore
      />,
    )

    const said = screen.getByTestId('restore-sentences')

    expect(said).toHaveTextContent(
      'Nothing about this event was erased: you can put it back on the site at any time with “Restore…”, giving a reason.',
    )
    expect(said).toHaveTextContent(
      'It comes back at the same web address, /events/toronto-garba-night.',
    )
    expect(said).toHaveTextContent(
      'It is still presented by Toronto Garba Collective, and its “Buy tickets on Sulekha” link comes back as it was.',
    )
    expect(screen.getByRole('button', { name: 'Restore…' })).toBeVisible()
  })

  it('tells an organiser nothing of how to restore it themselves', () => {
    render(<DeletedEventSummary event={deleted()} />)

    expect(screen.queryByTestId('restore-sentences')).not.toBeInTheDocument()
  })

  it('says where the refunds stand, from what is still owed, and links the refund queue for finance', () => {
    render(
      <DeletedEventSummary
        event={deleted()}
        refundCounts={{
          paidOrders: 1,
          refundableCents: 4950,
          currency: 'USD',
          disputedOrders: 0,
        }}
        refundsHref="/finance/refunds?organizationId=corg1"
      />,
    )

    expect(
      screen.getByText(
        '1 paid order has not been refunded in full: $49.50 in all is still to go back, counting any refund the payment provider has not confirmed.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'The organisation’s refund queue' })).toHaveAttribute(
      'href',
      '/finance/refunds?organizationId=corg1',
    )
  })

  it('says nothing about refunds it could not read, and nothing for a deletion that refunded nobody', () => {
    const { unmount } = render(<DeletedEventSummary event={deleted()} />)

    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
    unmount()

    render(
      <DeletedEventSummary
        event={deleted({ outcome: 'REMOVE_AFTER_EVENT' })}
        refundCounts={{ paidOrders: 4, refundableCents: 20000, currency: 'USD', disputedOrders: 0 }}
      />,
    )

    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
    expect(screen.queryByText(/not been refunded in full/)).not.toBeInTheDocument()
  })

  it('names a never-public event by its title, since its address was freed', () => {
    render(
      <DeletedEventSummary
        event={{ ...deleted({ outcome: 'REMOVE' }), slug: 'deleted-cevent0000000000000000001' }}
      />,
    )

    expect(
      screen.getByText(
        'Only the team at The Desi Events can restore a deleted event. Ask them, naming it by its title, “Diwali Mela”: it was never public, and its web address was freed when it was deleted.',
      ),
    ).toBeVisible()
    expect(screen.queryByText('deleted-cevent0000000000000000001')).not.toBeInTheDocument()
  })

  it('still names a once-public event by the web address it keeps', () => {
    render(<DeletedEventSummary event={deleted({ outcome: 'REMOVE' })} />)

    expect(screen.getByText('diwali-mela-2026', { selector: 'code' })).toBeVisible()
  })

  it('offers no refunds for an event deleted without any', () => {
    render(<DeletedEventSummary event={deleted({ outcome: 'REMOVE' })} mayFinishRefunds />)

    expect(screen.queryByRole('button', { name: 'Finish refunds' })).not.toBeInTheDocument()
    expect(screen.getByText(/Nobody held a paid order/)).toBeVisible()
  })
})

describe('PlatformChangesPanel', () => {
  const EDITS = [
    {
      id: 'cedit00000000000000000001',
      openedAt: '2026-10-05T15:00:00.000Z',
      expiresAt: '2026-10-05T16:00:00.000Z',
      closedAt: '2026-10-05T15:20:00.000Z',
      endedBy: 'CLOSED',
      open: false,
      mine: false,
      reason: 'Fixing the directions the organiser sent us.',
      administratorName: null,
      changes: [
        { action: 'event.updated', fields: ['directions', 'faq'], at: '2026-10-05T15:05:00.000Z' },
        { action: 'event.session_added', fields: [], at: '2026-10-05T15:10:00.000Z' },
      ],
    },
  ]

  it('lists each session with its reason and what it changed, naming nobody for an organiser', () => {
    render(<PlatformChangesPanel edits={EDITS} timeZone="America/Chicago" />)

    const panel = screen.getByRole('region', {
      name: 'Changes made by the team at The Desi Events',
    })

    expect(within(panel).getByText('By an administrator at The Desi Events.')).toBeVisible()
    expect(within(panel).getByText('Fixing the directions the organiser sent us.')).toBeVisible()
    expect(within(panel).getByText('parking and directions, FAQ, added a night')).toBeVisible()
    expect(within(panel).getByText('Closed by the administrator')).toBeVisible()
  })

  it('names the administrator only when the server sent the name', () => {
    render(
      <PlatformChangesPanel
        edits={[{ ...EDITS[0], administratorName: 'Anil Rao', open: true, endedBy: null }]}
      />,
    )

    expect(screen.getByText('By Anil Rao, of the team at The Desi Events.')).toBeVisible()
    expect(screen.getByText(/^Open until/)).toBeVisible()
  })

  it('reads the date and the time in the event’s zone, and names it', () => {
    render(
      <PlatformChangesPanel
        edits={[{ ...EDITS[0], open: true, endedBy: null, closedAt: null }]}
        timeZone="America/Chicago"
      />,
    )

    expect(screen.getByText('Mon, Oct 5, 2026, 10:00 AM CDT')).toBeVisible()
    expect(screen.getByText('Open until 11:00 AM CDT')).toBeVisible()
  })

  it('renders nothing for an event nobody at The Desi Events has edited', () => {
    const { container } = render(<PlatformChangesPanel edits={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('EventChangesList', () => {
  const NOTICES = [
    {
      id: 'cnotice000000000000000002',
      kind: 'SESSION_CANCELLED',
      at: '2026-10-05T15:00:00.000Z',
      changed: [],
      before: null,
      after: null,
      reason: 'The singer cancelled.',
      sessionId: 'csession000000000000000002',
      by: 'DESI_EVENT',
    },
    {
      id: 'cnotice000000000000000001',
      kind: 'MATERIAL_CHANGE',
      at: '2026-10-01T15:00:00.000Z',
      changed: ['startsAt', 'venueId'],
      before: { startsAt: '2026-10-17T00:30:00.000Z' },
      after: { startsAt: '2026-10-24T00:30:00.000Z' },
      reason: 'The hall double-booked us.',
      sessionId: null,
      by: 'ORGANIZER',
    },
  ]

  it('says what changed, before and after, why and by whom, and puts a cancelled night in a box', () => {
    render(
      <EventChangesList
        notices={NOTICES}
        timeZone="America/Chicago"
        sessions={[
          {
            id: 'csession000000000000000002',
            label: 'Night 2',
            startsAt: '2026-10-18T00:30:00.000Z',
          },
        ]}
      />,
    )

    const list = screen.getByRole('region', { name: 'Changes since you bought' })
    const items = within(list).getAllByRole('listitem')

    expect(items[0]).toHaveTextContent('A night was cancelled')
    expect(items[0]).toHaveTextContent('The night of Night 2 · Sat, Oct 17 · 7:30 PM.')
    expect(items[0]).toHaveTextContent('Changed by the team at The Desi Events.')
    expect(items[0].className).toMatch(/status-danger/)

    expect(within(items[1]).getByText('What changed: start time, venue.')).toBeVisible()
    expect(items[1]).toHaveTextContent(/The start time: .*Oct 16, 2026.* → .*Oct 23, 2026/)
    expect(items[1]).toHaveTextContent('Reason given: The hall double-booked us.')
    expect(items[1]).toHaveTextContent('Changed by the organiser.')
    expect(within(list).getByText(/These notices are not emailed\./)).toBeVisible()
  })

  it('names a cancelled night the page does not list by when it was to start', () => {
    // An order page lists its own lines' nights, and a ticket good for every
    // night has none of its own: the notice's own record of the night names it.
    render(
      <EventChangesList
        notices={[{ ...NOTICES[0], before: { startsAt: '2026-10-18T00:30:00.000Z' } }]}
        timeZone="America/Chicago"
        sessions={[]}
      />,
    )

    expect(screen.getByText('The night of Sat, Oct 17, 2026, 7:30 PM.')).toBeVisible()
  })

  it('tells a holder who took a deleted event’s page down', () => {
    render(
      <EventChangesList
        notices={[{ ...NOTICES[1], id: 'cnotice3', kind: 'DELETED', by: 'ORGANIZER', changed: [] }]}
      />,
    )

    expect(screen.getByText('Taken off the site')).toBeVisible()
    expect(screen.getByText('The organiser removed this event’s page.')).toBeVisible()
  })

  it('renders nothing when nothing has changed', () => {
    const { container } = render(<EventChangesList notices={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
