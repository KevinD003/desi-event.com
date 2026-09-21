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
    // Deliberately an independent literal and not the shared constant: this
    // file tests *rendering*, and a fixture that imported the real string would
    // assert that a value equals itself. It does have to stay true, though —
    // this one was the old claim that the export register falsified, and a
    // false sentence left lying in a fixture is a sentence somebody copies.
    reason: 'The proposed seven days is a duration for export BYTES, and no bytes are kept.',
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
    // Whatever the reason says, it reaches the screen — that is the property.
    // Matched on the fixture's own words rather than on the shared constant,
    // for the reason given where the fixture is defined.
    expect(screen.getByText(/duration for export BYTES/iu)).toBeInTheDocument()
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

  it('does not claim nothing has ever run when the read was refused', async () => {
    // The defect this replaces: `sweeps` is still null after a refusal, and
    // summariseSweeps(null) answers NONE_RECORDED, so the page printed
    // "nothing has run here" above the error alert — telling an operator whose
    // request was refused that the system is idle. A refusal and an empty
    // history are different facts, and this page exists to keep them apart.
    listRetentionSweeps.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 403, code: 'FORBIDDEN' }),
    )

    render(await RetentionPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByTestId('retention-reading')).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing has run here/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no retention rehearsal has been recorded/i)).not.toBeInTheDocument()
  })

  it.each([
    ['a step-up refusal', { status: 403, code: 'STEP_UP_REQUIRED' }],
    ['a server failure', { status: 500, code: 'INTERNAL' }],
    ['a timeout with no code at all', {}],
  ])('says nothing about what ran after %s', async (_label, thrown) => {
    // Every failure path, not just the one that was easiest to write. A reading
    // rendered on any of them is a statement of fact the page cannot support.
    listRetentionSweeps.mockRejectedValue(Object.assign(new Error('nope'), thrown))

    render(await RetentionPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByTestId('retention-reading')).not.toBeInTheDocument()
  })

  it('still reads the history when the fetch succeeds and returns nothing', async () => {
    // The other side of the same coin: a genuinely empty history must still say
    // so. Suppressing the reading on failure must not suppress it on success.
    await renderPage({ data: [], pagination: null, notEvaluated: NOT_EVALUATED })

    expect(screen.getByTestId('retention-reading')).toHaveTextContent(/nothing has run here/i)
  })
})

describe('the history does not end silently at the page size', () => {
  it('says how many of the total are shown', async () => {
    // The defect this replaces: `answer.pagination` was fetched by the client
    // and then discarded, so a register with 500 rehearsals rendered 20 with
    // nothing to say there were more. The sibling privacy queue already did
    // this; these pages did not.
    await renderPage({
      data: [sweep(), sweep({ retentionClass: 'session' })],
      pagination: { page: 1, perPage: 20, total: 137 },
      notEvaluated: [],
    })

    expect(screen.getByText(/Showing 2 of 137\./)).toBeInTheDocument()
  })

  it('falls back to the row count when the server sends no total', async () => {
    await renderPage({
      data: [sweep()],
      pagination: { page: 1, perPage: 20 },
      notEvaluated: [],
    })

    expect(screen.getByText(/Showing 1 of 1\./)).toBeInTheDocument()
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

describe('the rollup, which says what the table cannot', () => {
  /**
   * One `summary` entry.
   *
   * @param {string} retentionClass Which class.
   * @param {object|null} latest Its most recent run, or null.
   * @param {number} [runCount] How many runs it has.
   * @returns {object} The entry.
   */
  function standing(retentionClass, latest, runCount = latest ? 1 : 0) {
    return { retentionClass, latest, runCount }
  }

  it('names a class no rehearsal has ever covered, in words', async () => {
    // The gap the table cannot show. A class with no run is absent from every
    // page, which looks exactly like a class whose last run was four pages
    // back — and an absence rendered as an empty cell is a finding nobody
    // reads.
    await renderPage({
      data: [sweep()],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
      summary: [standing('session', null)],
    })

    expect(screen.getByTestId('retention-standing')).toHaveTextContent(
      /No rehearsal has ever covered this class/i,
    )
  })

  it('reports a class whose last run counted', async () => {
    await renderPage({
      data: [sweep()],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
      summary: [standing('login_attempt', sweep({ examinedCount: 12, heldCount: 2 }), 3)],
    })

    const rollup = screen.getByTestId('retention-standing')

    expect(rollup).toHaveTextContent(/counted 12, of which 2 held back/i)
    expect(rollup).toHaveTextContent(/3 runs recorded/i)
  })

  it('reports a class whose last run declined, without calling it a failure', async () => {
    await renderPage({
      data: [sweep()],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
      summary: [standing('session', sweep({ state: 'SKIPPED_DISABLED', examinedCount: 0 }))],
    })

    const rollup = screen.getByTestId('retention-standing')

    expect(rollup).toHaveTextContent(/declined/i)
    expect(rollup).toHaveTextContent(/not activated/i)
    expect(rollup).not.toHaveTextContent(/failed/i)
  })

  it('explains a failure rather than printing only its code', async () => {
    await renderPage({
      data: [sweep()],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
      summary: [
        standing(
          'session',
          sweep({ state: 'FAILED', failureCode: 'HOLD_COUNT_FAILED', examinedCount: 0 }),
        ),
      ],
    })

    expect(screen.getByTestId('retention-standing')).toHaveTextContent(
      /count of holds protecting them did not complete/i,
    )
  })

  it('renders nothing at all when the response carries no rollup', async () => {
    // `summary` is optional in the contract, so its absence is a shape this
    // page has to handle rather than a case it can assume away.
    await renderPage({ data: [sweep()], pagination: null, notEvaluated: NOT_EVALUATED })

    expect(screen.queryByTestId('retention-standing')).toBeNull()
    // And the rest of the page is unaffected.
    expect(screen.getByRole('heading', { name: 'Retention rehearsals' })).toBeInTheDocument()
  })

  it('keeps the approval label on the rollup too', async () => {
    // A number lifted out of this section into a ticket has to bring its status
    // with it, exactly as it does from the table.
    await renderPage({
      data: [sweep()],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
      summary: [standing('login_attempt', sweep({ examinedCount: 9 }))],
    })

    expect(screen.getByTestId('retention-standing')).toHaveTextContent(
      /REQUIRES LEGAL\/PRIVACY REVIEW/i,
    )
  })
})

describe('a failed row in the table', () => {
  it('says what the code means as well as what it is', async () => {
    // The wording is what an operator reads; the code is what they quote into
    // a ticket. A screen with only prose makes them retype an approximation.
    await renderPage({
      data: [sweep({ state: 'FAILED', failureCode: 'CANDIDATE_COUNT_FAILED', examinedCount: 0 })],
      pagination: null,
      notEvaluated: NOT_EVALUATED,
    })

    expect(
      screen.getByText(/count of rows this class would reach did not complete/i),
    ).toBeInTheDocument()
    expect(screen.getByText('CANDIDATE_COUNT_FAILED')).toBeInTheDocument()
  })
})
