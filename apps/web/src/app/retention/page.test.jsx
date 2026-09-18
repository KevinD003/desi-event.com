/**
 * The retention screen must distinguish three things that all look empty, and
 * offer no way to act.
 *
 * The server component is rendered directly — it takes a promise of
 * `searchParams` and returns markup, with the API client mocked at the module
 * boundary. What is asserted is the part a reader depends on:
 *
 *   - the sentence that tells "never ran" apart from "declined" apart from
 *     "counted";
 *   - that every figure arrives with its approval status beside it;
 *   - that the page offers no control that could start, activate or delete.
 *
 * @module app/retention/page.test
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/privacy-api.js', () => ({ listRetentionSweeps: vi.fn() }))

const { listRetentionSweeps } = await import('../../lib/privacy-api.js')
const { default: RetentionPage } = await import('./page.jsx')
const { RETENTION_APPROVAL } = await import('../../lib/retention-vocabulary.js')

/**
 * One sweep row as the API presents it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function sweep(overrides = {}) {
  return {
    id: `sweep-${overrides.retentionClass ?? 'login_attempt'}-${overrides.state ?? 'COMPLETED'}`,
    retentionClass: 'login_attempt',
    mode: 'DRY_RUN',
    state: 'COMPLETED',
    olderThan: '2026-08-19T00:00:00.000Z',
    examinedCount: 12,
    affectedCount: 0,
    heldCount: 3,
    failureCode: null,
    startedAt: '2026-09-18T00:00:00.000Z',
    finishedAt: '2026-09-18T00:00:00.000Z',
    createdAt: '2026-09-18T00:00:00.000Z',
    approval: RETENTION_APPROVAL,
    ...overrides,
  }
}

/** The one class nothing sweeps. */
const NOT_EVALUATED = [
  {
    retentionClass: 'export_artifact',
    proposedDays: 7,
    approval: RETENTION_APPROVAL,
    reason: 'Nothing in this repository has ever written an ExportArtifact row.',
  },
]

/**
 * Render the page with a given answer from the API.
 *
 * @param {object} answer What `listRetentionSweeps` resolves with.
 * @param {object} [params] The search parameters.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(answer, params = {}) {
  listRetentionSweeps.mockResolvedValue(answer)

  render(await RetentionPage({ searchParams: Promise.resolve(params) }))
}

describe('the three readings of an empty-looking page', () => {
  it('says nothing has ever run when there are no rows', async () => {
    await renderPage({ data: [], pagination: null, notEvaluated: NOT_EVALUATED })

    expect(screen.getByTestId('retention-reading')).toHaveTextContent(/nothing has run here/i)
  })

  it('says it was told not to when every row declined', async () => {
    // The failure this guards: an operator reading a declined sweep as a broken
    // worker, and going to debug something that is behaving as configured.
    await renderPage({
      data: [sweep({ state: 'SKIPPED_DISABLED', examinedCount: 0, heldCount: 0 })],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
    })

    expect(screen.getByTestId('retention-reading')).toHaveTextContent(/not activated/i)
    expect(screen.getByText('Declined')).toBeInTheDocument()
  })

  it('says nothing was deleted when rows counted', async () => {
    await renderPage({ data: [sweep()], pagination: null, notEvaluated: NOT_EVALUATED })

    expect(screen.getByTestId('retention-reading')).toHaveTextContent(/nothing was deleted/i)
  })
})

describe('what a row shows', () => {
  it('puts the approval status beside every count, not once in the header', async () => {
    // A number lifted out of this table into a ticket has to bring its status
    // with it, which a single header line would not survive.
    await renderPage({
      data: [sweep(), sweep({ retentionClass: 'session' })],
      pagination: null,
      notEvaluated: [],
    })

    expect(screen.getAllByText(RETENTION_APPROVAL)).toHaveLength(2)
  })

  it('shows the counted, held and deleted figures', async () => {
    await renderPage({
      data: [sweep({ examinedCount: 12, heldCount: 3 })],
      pagination: null,
      notEvaluated: [],
    })

    const row = screen.getByRole('row', { name: /Login attempt/i })

    expect(row).toHaveTextContent('12')
    expect(row).toHaveTextContent('3')
    // Zero, always. The database refuses to record anything else on a dry run.
    expect(row).toHaveTextContent('0')
  })

  it('lists the classes nothing evaluates, with the reason', async () => {
    await renderPage({ data: [sweep()], pagination: null, notEvaluated: NOT_EVALUATED })

    expect(screen.getByRole('heading', { name: 'Not evaluated' })).toBeInTheDocument()
    expect(screen.getByText(/has ever written an ExportArtifact row/i)).toBeInTheDocument()
  })
})

describe('the page offers no way to act', () => {
  it('renders no button, and no link that could run or activate anything', async () => {
    // The API has no route that starts a sweep and the worker is the only
    // producer. A control here would be the first step towards one.
    const { container } = render(
      await (async () => {
        listRetentionSweeps.mockResolvedValue({
          data: [sweep(), sweep({ state: 'SKIPPED_DISABLED' })],
          pagination: null,
          notEvaluated: NOT_EVALUATED,
        })

        return RetentionPage({ searchParams: Promise.resolve({}) })
      })(),
    )

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('form')).toHaveLength(0)
    expect(container.querySelectorAll('input')).toHaveLength(0)
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href')).not.toMatch(/run|execute|activate|delete/iu)
    }
  })

  it('reports a refusal in place rather than blanking the page', async () => {
    listRetentionSweeps.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 403, code: 'FORBIDDEN' }),
    )

    render(await RetentionPage({ searchParams: Promise.resolve({}) }))

    // The heading survives, so a reader can tell a refusal from a crash.
    expect(screen.getByRole('heading', { name: 'Retention rehearsals' })).toBeInTheDocument()
  })
})

describe('filters reach the server rather than the browser', () => {
  it('passes the class and state through untouched', async () => {
    await renderPage(
      { data: [], pagination: null, notEvaluated: [] },
      { retentionClass: 'session', state: 'COMPLETED', page: '2' },
    )

    expect(listRetentionSweeps).toHaveBeenCalledWith({
      retentionClass: 'session',
      state: 'COMPLETED',
      page: '2',
    })
  })
})
