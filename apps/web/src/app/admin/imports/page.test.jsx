import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/imports-api.js', () => ({ getImportRuns: vi.fn() }))
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/imports',
  useSearchParams: () => new URLSearchParams(''),
}))

const { getImportRuns } = await import('../../../lib/imports-api.js')
const { readSession } = await import('../../../lib/session.js')
const { default: ImportsPage, INTRODUCTION, summaryLine } = await import('./page.jsx')
const { NOT_FOR_THIS_ACCOUNT } = await import('./import-vocabulary.js')

const ADMIN = { user: { id: 'u1' }, capabilities: ['event:import'], memberships: [] }

/**
 * One run, as the list answers it.
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
    eventCount: 45,
    createdAt: '2026-10-06T10:00:00.000Z',
    expiresAt: '2026-10-06T11:00:00.000Z',
    appliedAt: '2026-10-06T10:10:00.000Z',
    createdByName: 'Anil Rao',
    appliedByName: 'Anil Rao',
    summary: { CREATE: 40, SKIPPED_PAST: 5 },
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [query] The query string.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(query = {}) {
  render(await ImportsPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  readSession.mockResolvedValue(ADMIN)
  getImportRuns.mockReset()
  getImportRuns.mockResolvedValue({
    runs: [
      run(),
      run({ id: 'crun0000000000000000002', status: 'EXPIRED', appliedAt: null, summary: null }),
    ],
    pagination: { page: 1, perPage: 20, total: 2, hasNextPage: false, hasPreviousPage: false },
  })
})

describe('the imports page', () => {
  it('offers the upload form and the runs, newest first, in a captioned table', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Imports' })).toBeInTheDocument()
    expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()
    expect(screen.getByLabelText(/Listing file/u)).toHaveAttribute('type', 'file')

    const table = screen.getByRole('table', { name: 'Imports, newest first' })
    const rows = within(table).getAllByRole('row')

    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByRole('link', { name: 'texas-2026.json' })).toHaveAttribute(
      'href',
      '/admin/imports/crun0000000000000000001',
    )
    expect(within(rows[1]).getByText('Applied')).toBeInTheDocument()
    expect(within(rows[1]).getByText('New: 40 · Skipped: 5')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Not applied')).toBeInTheDocument()
  })

  it('reads the page number from its address', async () => {
    await renderPage({ page: '2' })

    expect(getImportRuns).toHaveBeenCalledWith({ page: 2 })
  })

  it('says when nothing has been imported', async () => {
    getImportRuns.mockResolvedValue({ runs: [], pagination: { total: 0 } })

    await renderPage()

    expect(screen.getByText('Nothing has been imported.')).toBeInTheDocument()
  })

  it('refuses a moderator, and reads nothing', async () => {
    readSession.mockResolvedValue({
      user: { id: 'u2' },
      capabilities: ['moderation:review'],
      memberships: [],
    })

    await renderPage()

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Listing file/u)).toBeNull()
    expect(getImportRuns).not.toHaveBeenCalled()
  })

  it('draws the API’s refusal when the list cannot be read', async () => {
    getImportRuns.mockRejectedValue(
      Object.assign(new Error('Nope'), { status: 403, code: 'FORBIDDEN' }),
    )

    await renderPage()

    expect(
      screen.getByText(/^The list of imports is not something this account can open/u),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('summaryLine', () => {
  it('says what applying did, by action, leaving out what did not happen', () => {
    expect(summaryLine(null)).toBe('Not applied')
    expect(summaryLine({ CREATE: 2, UNCHANGED: 0 })).toBe('New: 2')
    expect(summaryLine({})).toBe('Nothing written')
  })
})
