import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_LIMITS } from '@desi-event/schemas/imports'

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
  NO_PICTURES_SENTENCE,
  withoutSourceAddresses,
} = await import('./page.jsx')
const pageModule = await import('./page.jsx')
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
    fileName: 'texas-2026.json',
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
  it('names the file and where the run stands, says imports copy no pictures, and offers no “Retry pictures”', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'texas-2026.json' })).toBeInTheDocument()
    expect(screen.getByText('Applied')).toBeInTheDocument()
    expect(document.body.textContent).toContain(NO_PICTURES_SENTENCE)
    expect(
      screen.getByText(/approve and publish them here, which puts their tickets on sale here/u),
    ).toBeInTheDocument()
    // Even with a picture an older build recorded as waiting, nothing offers to copy it.
    expect(screen.queryByRole('button', { name: /retry pictures/iu })).toBeNull()
    expect(screen.queryByText(/use Retry pictures|still waiting/u)).toBeNull()
  })

  it('lets the administrator tick as many events as one approval takes, IMPORT_LIMITS.approveItems', async () => {
    const [template] = run().rows
    const rows = Array.from({ length: IMPORT_LIMITS.approveItems + 1 }, (_, index) => ({
      ...template,
      sourceId: String(500000 + index),
      title: `Listing ${index + 1}`,
      pictures: [],
      event: {
        id: `cevent${String(index).padStart(19, '0')}`,
        title: `Listing ${index + 1}`,
        slug: `listing-${index + 1}`,
        status: 'REVIEW_PENDING',
        revision: 2,
        inThisRun: true,
        reassigned: false,
        organizationName: 'The Desi Events',
        importedByName: 'Anil Rao',
        approvedAt: null,
        approvedByName: null,
      },
    }))

    getImportRun.mockResolvedValue({
      run: run({ rows, eventCount: rows.length }),
      picturesWaiting: 0,
    })
    await renderPage()

    expect(
      screen.getByRole('button', {
        name: `Tick the first ${IMPORT_LIMITS.approveItems} of ${rows.length} shown`,
      }),
    ).toBeInTheDocument()
  })

  it('never puts an address of the source site in the page, nor any link to it', async () => {
    const withAddresses = run({
      rows: [
        {
          ...run().rows[0],
          sourceUrl: 'https://events.sulekha.com/raga-night_event-in_houston-tx_401684',
          ticketUrl: 'https://events.sulekha.com/raga-night/tickets',
        },
      ],
    })

    getImportRun.mockResolvedValue({ run: withAddresses, picturesWaiting: 0 })

    const { container } = await renderPage()

    expect(container.innerHTML).not.toMatch(/sulekha\.(?:com|io)/iu)
    expect(screen.queryByRole('link', { name: /source listing/iu })).toBeNull()

    const kept = withoutSourceAddresses(withAddresses).rows[0]

    expect(kept.pictures[0]).not.toHaveProperty('url')
    expect(kept).not.toHaveProperty('sourceUrl')
    expect(kept).not.toHaveProperty('ticketUrl')
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

describe('what the page says about pictures', () => {
  it('no longer counts pictures copied or waiting: an import copies none', () => {
    expect(pageModule).not.toHaveProperty('picturesSentence')
    expect(NO_PICTURES_SENTENCE).toBe(
      'Imports copy no pictures: each imported event shows a generated poster until a picture is added to it in an editing session.',
    )
  })
})
