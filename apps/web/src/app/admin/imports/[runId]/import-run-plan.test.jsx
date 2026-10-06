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
    organizationName: 'Sulekha Events',
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
    fileName: 'sulekha-texas-2026.json',
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

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('a new plan', () => {
  it('shows each listing’s plan in words, its notes, and a captioned table', () => {
    render(<ImportRunPlan run={run()} canApprove />)

    const table = screen.getByRole('table', {
      name: 'The plan for sulekha-texas-2026.json, one row per listing',
    })

    expect(within(table).getByText('New')).toBeInTheDocument()
    expect(within(table).getByText('Created as a draft and sent for review.')).toBeInTheDocument()
    expect(within(table).getByText('Kids under 5 free.')).toBeInTheDocument()
    expect(within(table).getByText(/No end time listed/u)).toBeInTheDocument()
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

    await user.click(screen.getByRole('checkbox', { name: 'Update “Diwali Mela” from Sulekha' }))
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
      await screen.findByText(/3 pictures are still waiting: use Retry pictures\./u),
    ).toBeInTheDocument()
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

  it('links each event waiting for review to its review page, and says how each picture went', () => {
    render(<ImportRunPlan run={applied()} canApprove />)

    expect(screen.getByRole('link', { name: 'Review “Raga Night”' })).toHaveAttribute(
      'href',
      '/moderation/events/cevent0000000000000000001',
    )
    expect(
      screen.getByText(/Copied, waiting for approval \(Too small for a cover\)/u),
    ).toBeInTheDocument()
    expect(screen.getByText('Sulekha’s picture host took too long to answer.')).toBeInTheDocument()
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
              status: 'PUBLISHED',
              revision: 5,
              picturesApproved: 1,
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
        'Raga Night: approved and published, with its Sulekha ticket link on.',
      ),
    ).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(apiFetch).toHaveBeenCalledWith(`/v1/platform/imports/${RUN_ID}/approve`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ eventId: 'cevent0000000000000000001', revision: 3 }] }),
    })
  })

  it('copies the pictures again on "Retry pictures"', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: { ...applied(), pictures: { total: 2, stored: 2, failed: 0, waiting: 0 } },
        meta: { picturesWaiting: 0 },
      }),
    )
    render(<ImportRunPlan run={applied()} canApprove />)
    await user.click(screen.getByRole('button', { name: 'Retry pictures' }))

    expect(
      await screen.findByText(
        'Pictures were tried again. Pictures: 2 copied, 0 not copied, 0 waiting.',
      ),
    ).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith(`/v1/platform/imports/${RUN_ID}/images/retry`, {
      method: 'POST',
      body: '{}',
    })
  })

  it('offers no approval to an account without review rights, and says why', () => {
    render(<ImportRunPlan run={applied()} canApprove={false} />)

    expect(screen.queryByRole('button', { name: /Approve and publish/u })).toBeNull()
    expect(screen.getByText(/needs a moderator’s review rights/u)).toBeInTheDocument()
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
