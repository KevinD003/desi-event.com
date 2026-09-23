/**
 * The export register must say what an export contained without being able to
 * hand one over.
 *
 * The properties worth pinning:
 *
 *   - **No download.** Every export is streamed and nothing is stored, so there
 *     is nothing to re-serve. A link here would make the register the thing it
 *     exists to keep track of.
 *   - **"Nobody" is per row, not per page.** It is true of every export today,
 *     and the day one carries a person the row has to say so rather than the
 *     page continuing to claim otherwise.
 *   - **The empty state names what is missing from the register**, rather than
 *     implying it is complete: a platform-wide finance export belongs to no
 *     organisation and is not recorded at all.
 *
 * @module app/privacy/exports/page.test
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// A refused read is drawn by `ReadRefusal`, whose step-up redraws through the
// router; these tests render outside an app router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const readSession = vi.fn()

vi.mock('../../../lib/privacy-api.js', () => ({ listExportArtifacts: vi.fn() }))
vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})

const { listExportArtifacts } = await import('../../../lib/privacy-api.js')
const { default: ExportRegisterPage } = await import('./page.jsx')

/** The organisation these tests act in. */
const ORGANIZATION = 'org00000000000000000001'

/**
 * A session holding `privacy:redact` in one organisation.
 *
 * @returns {object} The session.
 */
function session() {
  return {
    user: { displayName: 'Owner' },
    capabilities: [],
    memberships: [
      {
        organizationId: ORGANIZATION,
        organizationName: 'Rangoli',
        role: 'OWNER',
        capabilities: ['privacy:redact'],
      },
    ],
  }
}

/**
 * One register entry.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The entry.
 */
function artifact(overrides = {}) {
  return {
    id: 'exp00000000000000000001',
    kind: 'analytics',
    state: 'AVAILABLE',
    ephemeral: true,
    stored: false,
    requestedById: 'usr00000000000000000001',
    subjectCount: 0,
    generatedAt: '2026-09-18T00:00:00.000Z',
    invalidatedAt: null,
    deletedAt: null,
    failureCode: null,
    ...overrides,
  }
}

/**
 * Render the page with a given answer from the API.
 *
 * @param {object} answer What `listExportArtifacts` resolves with.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(answer) {
  readSession.mockResolvedValue(session())
  listExportArtifacts.mockResolvedValue(answer)

  return render(await ExportRegisterPage({ searchParams: Promise.resolve({}) }))
}

describe('what the register shows', () => {
  it('says an aggregate export contains nobody', async () => {
    await renderPage({ data: [artifact()], pagination: null })

    expect(screen.getByText(/Nobody — aggregate figures only/)).toBeInTheDocument()
  })

  it('says how many when an artefact does contain people', async () => {
    // The row carries the answer, so the day a personal export is added the
    // page stops claiming "nobody" for it rather than going on saying so.
    await renderPage({ data: [artifact({ subjectCount: 3 })], pagination: null })

    expect(screen.getByText('3 people')).toBeInTheDocument()
  })

  it('reports that nothing was stored', async () => {
    await renderPage({ data: [artifact()], pagination: null })

    expect(screen.getByText(/No — streamed and not kept/)).toBeInTheDocument()
  })

  it('names an artefact an erasure invalidated', async () => {
    await renderPage({
      data: [artifact({ state: 'INVALIDATED', invalidatedAt: '2026-09-18T01:00:00.000Z' })],
      pagination: null,
    })

    // Scoped to the cell. The filter form now offers the artefact states too —
    // it used to offer privacy *request* states, which is the defect this
    // collision is the evidence of — so an unscoped query matches the row and
    // the dropdown option both.
    const cell = screen
      .getAllByText('Invalidated by an erasure')
      .find((node) => node.tagName === 'TD')

    expect(cell).toBeInTheDocument()
  })

  it('says who asked, because that is half of what the register claims to answer', async () => {
    // The register's own documentation says it answers "who pulled an export,
    // and when". `requestedById` was in the payload and on no screen, so that
    // was true of the API and false of the thing anybody looks at.
    await renderPage({
      data: [artifact({ requestedById: 'usr00000000000000000042' })],
      pagination: null,
    })

    expect(screen.getByRole('columnheader', { name: 'Requested by' })).toBeInTheDocument()
    expect(screen.getByText('usr00000000000000000042')).toBeInTheDocument()
  })

  it('shows an account id and not a name, and holds no other staff detail', async () => {
    // Deliberate. Resolving the id would mean this screen read a User row to
    // render a staff member's name — the export register acquiring personal
    // data about staff in order to record that it holds none about anybody
    // else. The id is what the audit trail carries and what a ticket can name.
    const { container } = await renderPage({
      data: [artifact({ requestedById: 'usr00000000000000000042' })],
      pagination: null,
    })

    expect(container.textContent).not.toMatch(/@/u)
    expect(container.textContent).not.toMatch(/Owner/u)
  })

  it('says "Not recorded" rather than leaving the cell blank', async () => {
    // A blank cell in this column reads as "nobody", which is a different and
    // far more comfortable claim than "we did not write it down".
    await renderPage({ data: [artifact({ requestedById: null })], pagination: null })

    expect(screen.getByText('Not recorded')).toBeInTheDocument()
  })

  it('renders an unknown state rather than blanking the cell', async () => {
    await renderPage({ data: [artifact({ state: 'INVENTED_LATER' })], pagination: null })

    expect(screen.getByText('INVENTED_LATER')).toBeInTheDocument()
  })
})

describe('what the register cannot do', () => {
  it('offers no download and no link to the bytes', async () => {
    const { container } = await renderPage({
      data: [artifact(), artifact({ id: 'exp2', kind: 'finance' })],
      pagination: null,
    })

    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href')).not.toMatch(/download|\.csv|export\.csv/iu)
    }
    expect(container.querySelectorAll('[download]')).toHaveLength(0)
  })

  it('never renders a storage key, because the payload has none', async () => {
    // `stored` is a boolean by the time it reaches here; the key itself is
    // dropped by the presenter, which is what stops it reaching a log.
    const { container } = await renderPage({
      data: [artifact({ stored: true })],
      pagination: null,
    })

    expect(container.textContent).not.toMatch(/s3:|storageKey|https?:\/\//u)
  })
})

describe('the register does not end silently at the page size', () => {
  it('says how many of the total are shown', async () => {
    await renderPage({
      data: [artifact(), artifact({ id: 'exp2', kind: 'finance' })],
      pagination: { page: 1, perPage: 20, total: 84 },
    })

    expect(screen.getByText(/Showing 2 of 84\./)).toBeInTheDocument()
  })
})

describe('the empty state', () => {
  it('says what the register does not cover rather than implying it is complete', async () => {
    await renderPage({ data: [], pagination: null })

    expect(
      screen.getByText(/platform-wide finance export is not recorded here/i),
    ).toBeInTheDocument()
  })
})

describe('refusals', () => {
  it('reports a refusal in place rather than blanking the page', async () => {
    readSession.mockResolvedValue(session())
    listExportArtifacts.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 403, code: 'STEP_UP_REQUIRED' }),
    )

    render(await ExportRegisterPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Export register' })).toBeInTheDocument()
  })

  it('refuses a session with no privacy organisation at all', async () => {
    readSession.mockResolvedValue({ user: {}, capabilities: [], memberships: [] })

    render(await ExportRegisterPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
  })
})
