import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('../../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <button type="button" onClick={onConfirmed}>
      Confirm to {action}
    </button>
  ),
}))

const { apiFetch } = await import('../../../../lib/api-fetch.js')
const { ImportRunPlan, approvable } = await import('./import-run-plan.jsx')

const RUN_ID = 'crun0000000000000000001'
const DIGEST = 'a'.repeat(64)

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * One plan row.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function row(overrides = {}) {
  return {
    sourceId: '401684',
    title: 'Raga Night',
    startsAt: '2026-11-07T00:30:00.000Z',
    city: 'Houston',
    action: 'CREATE',
    problem: null,
    importNotes: ['Kids under 5 free.'],
    imageCount: 1,
    priceCount: 2,
    endTimeListed: false,
    updatable: false,
    resubmit: false,
    eventStatusAtPlan: null,
    event: null,
    pictures: [],
    ...overrides,
  }
}

/**
 * The event a row wrote.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The event.
 */
function written(overrides = {}) {
  return {
    id: 'cevent0000000000000000001',
    title: 'Raga Night',
    slug: 'raga-night',
    status: 'REVIEW_PENDING',
    revision: 3,
    inThisRun: true,
    reassigned: false,
    organizationName: 'The Desi Events',
    importedByName: 'Anil Rao',
    approvedAt: null,
    approvedByName: null,
    ...overrides,
  }
}

/**
 * A run.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The run.
 */
function run(overrides = {}) {
  return {
    id: RUN_ID,
    source: 'SULEKHA',
    status: 'PREVIEWED',
    fileName: 'texas-2026.json',
    eventCount: 2,
    createdAt: '2026-10-06T10:00:00.000Z',
    expiresAt: '2026-10-06T11:00:00.000Z',
    appliedAt: null,
    createdByName: 'Anil Rao',
    appliedByName: null,
    summary: null,
    planDigest: DIGEST,
    pictures: { total: 0, stored: 0, failed: 0, waiting: 0 },
    rows: [
      row(),
      row({
        sourceId: '401700',
        title: 'Diwali Mela',
        importNotes: [],
        endTimeListed: true,
        action: 'POSTED_KEPT',
        updatable: true,
        event: written({
          id: 'cevent0000000000000000002',
          title: 'Diwali Mela',
          status: 'PUBLISHED',
        }),
      }),
    ],
    ...overrides,
  }
}

/**
 * The plan's table.
 *
 * @returns {HTMLElement} The table.
 */
const planTable = () => screen.getByRole('table')

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('a new plan', () => {
  it('shows each listing’s plan in words, its notes, and a captioned table', () => {
    render(<ImportRunPlan run={run()} canApprove />)

    const table = screen.getByRole('table', {
      name: 'The plan for texas-2026.json, one row per listing',
    })

    expect(within(table).getByText('New')).toBeInTheDocument()
    expect(within(table).getByText('Created as a draft and sent for review.')).toBeInTheDocument()
    expect(within(table).getByText('Kids under 5 free.')).toBeInTheDocument()
    expect(within(table).getByText(/No end time listed/u)).toBeInTheDocument()
  })

  it('scrolls the wide table inside its frame, screen-reader-only words included', () => {
    // A badge's "Status:" and the caption are `sr-only`, which is
    // `position: absolute`. A scroll box clips such a descendant only when it
    // is its containing block, so the frame is positioned; without it the
    // run page scrolled sideways at 320 px (found by the accessibility sweep).
    render(<ImportRunPlan run={run()} canApprove />)

    const frame = screen.getByRole('table').parentElement
    const classes = frame.className.split(/\s+/u)

    expect(classes).toContain('overflow-x-auto')
    expect(classes).toContain('relative')
  })

  it('lets the keyboard reach the columns past the edge, through a named region', () => {
    // A plan of new listings has no box to tick, so nothing inside the scroll
    // box takes focus; axe's scrollable-region-focusable (WCAG 2.1.1) asks
    // for the box itself to, with a name and a visible focus ring.
    render(<ImportRunPlan run={run()} canApprove />)

    const region = screen.getByRole('region', {
      name: 'The plan for texas-2026.json, scrolls sideways',
    })

    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toContainElement(screen.getByRole('table'))
    expect(region.className).toContain('focus-visible:ring-2')
  })

  it('imports the plan as shown, with only the published events ticked for updating', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: run({ status: 'APPLIED', pictures: { total: 1, stored: 1, failed: 0, waiting: 0 } }),
        meta: { picturesWaiting: 0 },
      }),
    )
    render(<ImportRunPlan run={run()} canApprove />)

    expect(screen.getByRole('button', { name: 'Import this 1 event' })).toBeInTheDocument()

    await user.click(
      screen.getByRole('checkbox', { name: 'Update “Diwali Mela” from the listing' }),
    )
    await user.click(screen.getByRole('button', { name: 'Import these 2 events' }))

    expect(await screen.findByText(/The plan was applied\./u)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith(`/v1/platform/imports/${RUN_ID}/apply`, {
      method: 'POST',
      body: JSON.stringify({ planDigest: DIGEST, updateFromSource: ['401700'] }),
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('asks for a second factor when the API does, and sends the same plan once more', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
      .mockResolvedValueOnce(
        answer(200, { data: run({ status: 'APPLIED' }), meta: { picturesWaiting: 3 } }),
      )
    render(<ImportRunPlan run={run()} canApprove />)
    await user.click(screen.getByRole('button', { name: 'Import this 1 event' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm to import these events' }))

    expect(
      await screen.findByText(
        'The plan was applied. Its events wait for review: approve and publish them here.',
      ),
    ).toBeInTheDocument()
    // Whatever the answer says of pictures, nothing tells the administrator to copy them.
    expect(screen.queryByText(/pictures|Retry/u)).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('says a changed plan was refused, in the API’s words, and reads the page again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'IMPORT_PLAN_CHANGED',
          message: 'The plan has changed since it was shown. Read it again before applying it.',
        },
      }),
    )
    render(<ImportRunPlan run={run()} canApprove />)
    await user.click(screen.getByRole('button', { name: 'Import this 1 event' }))

    expect(
      await screen.findByText(
        'The plan has changed since it was shown. Read it again before applying it.',
      ),
    ).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })
})

describe('an applied plan', () => {
  const applied = () =>
    run({
      status: 'APPLIED',
      pictures: { total: 2, stored: 1, failed: 1, waiting: 0 },
      rows: [
        row({
          event: written(),
          pictures: [
            {
              id: 'cimg00000000000000000001',
              role: 'COVER',
              alt: 'A poster',
              position: 0,
              status: 'STORED',
              failureCode: null,
              attempts: 1,
              lastTriedAt: '2026-10-06T10:05:00.000Z',
              mediaId: 'cmed00000000000000000001',
              mediaStatus: 'PENDING',
              note: 'Too small for a cover',
            },
            {
              id: 'cimg00000000000000000002',
              role: 'GALLERY',
              alt: 'A stage',
              position: 1,
              status: 'FAILED',
              failureCode: 'TIMEOUT',
              attempts: 1,
              lastTriedAt: '2026-10-06T10:05:00.000Z',
              mediaId: null,
              mediaStatus: null,
              note: null,
            },
          ],
        }),
        row({
          sourceId: '401701',
          title: 'Holi Fest',
          event: written({ id: 'cevent0000000000000000003', title: 'Holi Fest', inThisRun: false }),
        }),
      ],
    })

  it('links each event waiting for review to its review page, and says how each picture an older run copied went', () => {
    render(<ImportRunPlan run={applied()} canApprove />)

    expect(screen.getByRole('link', { name: 'Review “Raga Night”' })).toHaveAttribute(
      'href',
      '/moderation/events/cevent0000000000000000001',
    )
    expect(
      screen.getByText(/Copied, waiting for approval \(Too small for a cover\)/u),
    ).toBeInTheDocument()
    expect(screen.getByText('The picture host took too long to answer.')).toBeInTheDocument()
  })

  it('gives each event link a target at least 24 px high, wrapped or not', () => {
    // In the narrow events column "Review" and "Open" wrap one above the
    // other; text-high, they left too little room to touch either (WCAG
    // 2.5.8, found by the accessibility sweep at 320 px).
    render(<ImportRunPlan run={applied()} canApprove />)

    for (const name of ['Review “Raga Night”', 'Open “Raga Night”']) {
      const classes = screen.getByRole('link', { name }).className.split(/\s+/u)

      expect(classes).toContain('min-h-6')
      expect(classes).toContain('inline-flex')
    }
  })

  it('offers approval only for this run’s events, and reports each result politely', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: {
          results: [
            {
              eventId: 'cevent0000000000000000001',
              outcome: 'PUBLISHED',
              status: 'ON_SALE',
              revision: 5,
              ticketTypesOnSale: 2,
              code: null,
              message: null,
            },
          ],
        },
      }),
    )
    render(<ImportRunPlan run={applied()} canApprove />)

    expect(screen.queryByRole('checkbox', { name: 'Approve “Holi Fest”' })).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: 'Approve “Raga Night”' }))
    await user.click(screen.getByRole('button', { name: 'Approve and publish 1 event' }))

    const status = await screen.findByRole('status')

    expect(
      await within(status).findByText(
        'Raga Night: approved and published, with 2 ticket types on sale.',
      ),
    ).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(apiFetch).toHaveBeenCalledWith(`/v1/platform/imports/${RUN_ID}/approve`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ eventId: 'cevent0000000000000000001', revision: 3 }] }),
    })
  })

  it('offers no “Retry pictures”, even for a picture an older run could not copy, and never asks to copy one', () => {
    render(<ImportRunPlan run={applied()} canApprove />)

    expect(screen.queryByRole('button', { name: /retry pictures|copy/iu })).toBeNull()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('says what each listing’s prices become, and how many of an event’s ticket types are on sale', () => {
    render(
      <ImportRunPlan
        run={run({
          status: 'APPLIED',
          rows: [
            row({
              priceCount: 3,
              soldOutCount: 1,
              currency: 'USD',
              event: written({ status: 'ON_SALE', ticketTypes: { imported: 3, onSale: 2 } }),
            }),
          ],
        })}
        canApprove
      />,
    )

    const line = planTable()

    expect(line).toHaveTextContent(
      '3 ticket types, 1 not on sale (sold out on the listing), in USD',
    )
    expect(line).toHaveTextContent('2 of 3 ticket types on sale')
  })

  it('offers approval for a published import whose ticket types are waiting to go on sale, to put them on sale', () => {
    expect(
      approvable(
        row({
          event: written({
            status: 'PUBLISHED',
            ticketTypes: { imported: 2, onSale: 0, waiting: 2 },
          }),
        }),
      ),
    ).toBe(true)
    expect(
      approvable(
        row({
          event: written({
            status: 'ON_SALE',
            ticketTypes: { imported: 2, onSale: 2, waiting: 0 },
          }),
        }),
      ),
    ).toBe(false)
    expect(
      approvable(
        row({
          event: written({
            status: 'PUBLISHED',
            ticketTypes: { imported: 0, onSale: 0, waiting: 0 },
          }),
        }),
      ),
    ).toBe(false)
  })

  it('does not tick a published import whose imported ticket types are all closed, sold out on its listing', () => {
    // Nothing waits, so the API refuses it NOT_EDITABLE: it used to be ticked
    // in every "Tick all" batch and refused every time.
    const allClosed = written({
      status: 'PUBLISHED',
      ticketTypes: { imported: 2, onSale: 0, waiting: 0 },
    })

    expect(approvable(row({ event: allClosed }))).toBe(false)
    // From an API that does not say how many wait: nothing is assumed to.
    expect(
      approvable(
        row({ event: written({ status: 'PUBLISHED', ticketTypes: { imported: 2, onSale: 0 } }) }),
      ),
    ).toBe(false)

    render(
      <ImportRunPlan
        run={run({
          status: 'APPLIED',
          rows: [
            row({ sourceId: '401001', title: 'Closed Night', event: allClosed }),
            row({
              sourceId: '401002',
              title: 'Waiting Night',
              event: written({ id: 'cevent0000000000000000002', title: 'Waiting Night' }),
            }),
          ],
        })}
        canApprove
      />,
    )

    expect(screen.queryByRole('checkbox', { name: 'Approve “Closed Night”' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Approve “Waiting Night”' })).toBeInTheDocument()
  })

  it('has no “Pictures” column for a run that recorded no pictures, as no import does now', () => {
    render(
      <ImportRunPlan
        run={run({ status: 'APPLIED', rows: [row({ event: written(), pictures: [] })] })}
        canApprove
      />,
    )

    expect(screen.queryByRole('columnheader', { name: 'Pictures' })).toBeNull()
    expect(screen.queryByText(/copied once applied/u)).toBeNull()
  })

  it('shows no address or link of the source site, whatever a row carries', () => {
    const { container } = render(
      <ImportRunPlan
        run={run({
          status: 'APPLIED',
          rows: [row({ event: written(), sourceUrl: undefined, ticketUrl: undefined })],
        })}
        canApprove
      />,
    )

    expect(container.innerHTML).not.toMatch(/sulekha\.(?:com|io)/iu)
    expect(screen.queryByRole('link', { name: /source listing/iu })).toBeNull()
    expect(
      screen.getAllByRole('link').every((link) => link.getAttribute('href').startsWith('/')),
    ).toBe(true)
  })

  it('offers no approval to an account without review rights, and says why', () => {
    render(<ImportRunPlan run={applied()} canApprove={false} />)

    expect(screen.queryByRole('button', { name: /Approve and publish/u })).toBeNull()
    expect(screen.getByText(/needs a moderator’s review rights/u)).toBeInTheDocument()
  })
})

describe('a run of many listings', () => {
  /**
   * An applied run whose every row wrote an event waiting for review.
   *
   * @param {number} count How many.
   * @returns {object} The run.
   */
  const many = (count) =>
    run({
      status: 'APPLIED',
      eventCount: count,
      rows: Array.from({ length: count }, (_, index) => {
        const n = String(index + 1).padStart(3, '0')

        return row({
          sourceId: `40${n}`,
          title: `Listing ${n}`,
          event: written({
            id: `cevent0000000000000000${n}`,
            title: `Listing ${n}`,
            revision: index + 1,
          }),
        })
      }),
    })

  it('ticks every event shown at once, and approves them in one request', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { results: [] } }))
    render(<ImportRunPlan run={many(3)} canApprove approveLimit={100} />)

    await user.click(screen.getByRole('button', { name: 'Tick all 3 shown' }))

    for (const n of ['001', '002', '003']) {
      expect(screen.getByRole('checkbox', { name: `Approve “Listing ${n}”` })).toBeChecked()
    }

    await user.click(screen.getByRole('button', { name: 'Approve and publish 3 events' }))

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      items: [
        { eventId: 'cevent0000000000000000001', revision: 1 },
        { eventId: 'cevent0000000000000000002', revision: 2 },
        { eventId: 'cevent0000000000000000003', revision: 3 },
      ],
    })
  })

  it('unticks them all again', async () => {
    const user = userEvent.setup()

    render(<ImportRunPlan run={many(3)} canApprove approveLimit={100} />)

    expect(screen.queryByRole('button', { name: 'Untick all' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Tick all 3 shown' }))
    await user.click(screen.getByRole('button', { name: 'Untick all' }))

    expect(screen.getByRole('checkbox', { name: 'Approve “Listing 001”' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve and publish 0 events' })).toBeDisabled()
  })

  it('ticks no more than one request takes, and says how the rest are approved', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { results: [] } }))
    render(<ImportRunPlan run={many(5)} canApprove approveLimit={2} />)

    expect(
      screen.getByText(
        '5 events are waiting to be approved here. One approval takes at most 2: tick the first 2, approve and publish them, then tick the next ones the same way.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tick the first 2 of 5 shown' }))

    expect(screen.getByRole('checkbox', { name: 'Approve “Listing 001”' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Approve “Listing 002”' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Approve “Listing 003”' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Approve and publish 2 events' }))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body).items).toHaveLength(2)
    // The page is read again, so what was published is no longer offered.
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses, before sending, more boxes ticked by hand than one request takes', async () => {
    const user = userEvent.setup()

    render(<ImportRunPlan run={many(3)} canApprove approveLimit={2} />)

    for (const n of ['001', '002', '003']) {
      await user.click(screen.getByRole('checkbox', { name: `Approve “Listing ${n}”` }))
    }

    const button = screen.getByRole('button', { name: 'Approve and publish 3 events' })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      '3 events are ticked, and one approval takes at most 2. Untick 1, or use “Untick all” and tick the first 2.',
    )
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('offers no bulk tick to an account without review rights, nor for a single event', () => {
    const { unmount } = render(<ImportRunPlan run={many(3)} canApprove={false} />)

    expect(screen.queryByRole('button', { name: /^Tick /u })).toBeNull()
    unmount()

    render(<ImportRunPlan run={many(1)} canApprove />)
    expect(screen.queryByRole('button', { name: /^Tick /u })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Approve “Listing 001”' })).toBeInTheDocument()
  })
})

describe('approvable', () => {
  it('takes a published event only while one of its pictures waits for approval', () => {
    const published = written({ status: 'PUBLISHED' })
    const picture = { status: 'STORED', mediaStatus: 'PENDING' }

    expect(approvable(row({ event: published, pictures: [picture] }))).toBe(true)
    expect(
      approvable(row({ event: published, pictures: [{ ...picture, mediaStatus: 'APPROVED' }] })),
    ).toBe(false)
    expect(approvable(row({ event: written({ reassigned: true }) }))).toBe(false)
    expect(approvable(row({ event: written({ status: 'DRAFT' }) }))).toBe(false)
  })
})
