import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/imports-api.js', () => ({ getImportRun: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/imports/crun0000000000000000001',
  useSearchParams: () => new URLSearchParams(''),
}))

const { getImportRun } = await import('../../../../lib/imports-api.js')
const { readSession } = await import('../../../../lib/session.js')
const {
  default: ImportRunPage,
  picturesSentence,
  withoutSourceAddresses,
} = await import('./page.jsx')
const { NOT_FOR_THIS_ACCOUNT } = await import('../import-vocabulary.js')

const ADMIN = {
  user: { id: 'u1' },
  capabilities: ['event:import', 'moderation:review'],
  memberships: [],
}
const PICTURE_URL = 'https://usimg.sulekha.io/cdn/events/images/cover-401684.png'

/**
 * A run with one written row.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The run.
 */
function run(overrides = {}) {
  return {
    id: 'crun0000000000000000001',
    source: 'SULEKHA',
    status: 'APPLIED',
    fileName: 'sulekha-texas-2026.json',
    eventCount: 1,
    createdAt: '2026-10-06T10:00:00.000Z',
    expiresAt: '2026-10-06T11:00:00.000Z',
    appliedAt: '2026-10-06T10:10:00.000Z',
    createdByName: 'Anil Rao',
    appliedByName: 'Anil Rao',
    summary: { CREATE: 1 },
    planDigest: 'a'.repeat(64),
    pictures: { total: 1, stored: 0, failed: 0, waiting: 1 },
    rows: [
      {
        sourceId: '401684',
        title: 'Raga Night',
        startsAt: '2026-11-07T00:30:00.000Z',
        city: 'Houston',
        action: 'CREATE',
        problem: null,
        importNotes: [],
        imageCount: 1,
        priceCount: 1,
        endTimeListed: true,
        updatable: false,
        resubmit: false,
        eventStatusAtPlan: null,
        event: null,
        pictures: [
          {
            id: 'cimg00000000000000000001',
            url: PICTURE_URL,
            role: 'COVER',
            alt: 'A poster',
            position: 0,
            status: 'WAITING',
            failureCode: null,
            attempts: 0,
            lastTriedAt: null,
            mediaId: null,
            mediaStatus: null,
            note: null,
          },
        ],
      },
    ],
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @returns {Promise<object>} The render result.
 */
async function renderPage() {
  return render(
    await ImportRunPage({ params: Promise.resolve({ runId: 'crun0000000000000000001' }) }),
  )
}

beforeEach(() => {
  readSession.mockResolvedValue(ADMIN)
  getImportRun.mockReset()
  getImportRun.mockResolvedValue({ run: run(), picturesWaiting: 1 })
})

describe('one import', () => {
  it('names the file and where the run stands, and how many pictures still wait', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'sulekha-texas-2026.json' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Applied')).toBeInTheDocument()
    expect(
      screen.getByText(/1 pictures are still waiting: use Retry pictures\./u),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry pictures' })).toBeInTheDocument()
  })

  it('never puts a Sulekha picture address in the page', async () => {
    const { container } = await renderPage()

    expect(container.innerHTML).not.toContain('usimg.sulekha.io')
    expect(withoutSourceAddresses(run()).rows[0].pictures[0]).not.toHaveProperty('url')
  })

  it('says an expired plan cannot be applied, and offers no import', async () => {
    getImportRun.mockResolvedValue({
      run: run({ status: 'EXPIRED', appliedAt: null, summary: null }),
      picturesWaiting: 0,
    })

    await renderPage()

    expect(screen.getByText(/was not applied within its hour/u)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import these/u })).toBeNull()
  })

  it('refuses a moderator, and reads nothing', async () => {
    readSession.mockResolvedValue({
      user: { id: 'u2' },
      capabilities: ['moderation:review'],
      memberships: [],
    })

    await renderPage()

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(getImportRun).not.toHaveBeenCalled()
  })
})

describe('picturesSentence', () => {
  it('says how the pictures stand, and that none are named when none are', () => {
    expect(picturesSentence({ total: 0, stored: 0, failed: 0, waiting: 0 }, 0)).toBe(
      'The listings in this run name no pictures.',
    )
    expect(picturesSentence({ total: 3, stored: 1, failed: 1, waiting: 1 }, 0)).toBe(
      'Pictures: 1 of 3 copied, 1 not copied, 1 waiting.',
    )
  })
})
