import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <button type="button" onClick={onConfirmed}>
      Confirm to {action}
    </button>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { APPROVE_PENDING_PATH, ApprovePendingPanel, outcomeSentences, pendingSentences } =
  await import('./approve-pending-panel.jsx')

const DIGEST = 'b'.repeat(64)

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
 * The pending list, as the server page passes it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The list.
 */
function pending(overrides = {}) {
  return {
    digest: DIGEST,
    total: 309,
    willGoOnSale: 274,
    publishedNothingToSell: 35,
    past: 20,
    items: [
      { eventId: 'cevent0000000000000000001', title: 'Raga Night' },
      { eventId: 'cevent0000000000000000002', title: 'Diwali Mela' },
    ],
    ...overrides,
  }
}

/** A successful answer. */
const DONE = {
  data: {
    total: 309,
    onSale: 273,
    publishedNothingToSell: 35,
    refused: 1,
    skippedPast: 20,
    results: [],
    refusals: [
      {
        eventId: 'cevent0000000000000000002',
        code: 'TRY_AGAIN',
        message: 'Another change to this event was being saved at the same moment. Try again.',
      },
    ],
  },
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('ApprovePendingPanel', () => {
  it('says what approving does, from the list the API gave', () => {
    render(<ApprovePendingPanel pending={pending()} />)

    expect(
      screen.getByText(
        '309 events imported from listing files wait for approval, across every import.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Approving puts 274 events on sale here.')).toBeInTheDocument()
    expect(
      screen.getByText(
        '35 events will be published with nothing to sell: their listings give no price, or every price is sold out.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '20 events that have started, or start within the minute, are left as they are.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and publish all 309 events' })).toBeEnabled()
  })

  it('offers no button when nothing waits', () => {
    render(
      <ApprovePendingPanel
        pending={pending({ total: 0, willGoOnSale: 0, publishedNothingToSell: 0, past: 0 })}
      />,
    )

    expect(screen.getByText('No imported event is waiting for approval.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sends the digest of the list shown, and reports what went on sale and each refusal', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, DONE))
    render(<ApprovePendingPanel pending={pending()} />)

    await user.click(screen.getByRole('button', { name: 'Approve and publish all 309 events' }))

    expect(apiFetch).toHaveBeenCalledWith(APPROVE_PENDING_PATH, {
      method: 'POST',
      body: JSON.stringify({ digest: DIGEST }),
    })
    expect(APPROVE_PENDING_PATH).toBe('/v1/platform/imports/approve-pending')

    const status = screen.getByRole('status')

    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('273 events approved, published and put on sale.')
    expect(status).toHaveTextContent('35 events approved and published with nothing to sell.')
    expect(status).toHaveTextContent('1 event not published: each reason is below.')
    expect(status).toHaveTextContent('20 events left as past.')
    expect(status).toHaveTextContent(
      'Diwali Mela: Another change to this event was being saved at the same moment. Try again.',
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('asks for a second factor when the API does, and sends the same digest once more', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
      .mockResolvedValueOnce(answer(200, DONE))
    render(<ApprovePendingPanel pending={pending()} />)

    await user.click(screen.getByRole('button', { name: 'Approve and publish all 309 events' }))
    // The button waits while the factor is asked for.
    expect(
      screen.getByRole('button', { name: 'Approve and publish all 309 events' }),
    ).toBeDisabled()

    await user.click(
      await screen.findByRole('button', {
        name: 'Confirm to approve and publish every pending imported event',
      }),
    )

    expect(
      await screen.findByText(/273 events approved, published and put on sale\./u),
    ).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(apiFetch.mock.calls[1]).toEqual(apiFetch.mock.calls[0])
  })

  it('does not ask twice: a second STEP_UP_REQUIRED is reported as a refusal', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
    )
    render(<ApprovePendingPanel pending={pending()} />)

    await user.click(screen.getByRole('button', { name: 'Approve and publish all 309 events' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Confirm to approve and publish every pending imported event',
      }),
    )

    expect(await screen.findByText('Not done')).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('says a list that changed was refused, in the API’s words, and reads the page again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'IMPORT_PENDING_CHANGED',
          message:
            'The imported events waiting for approval changed after you read the list, so nothing was approved. Read the list again and confirm what it says now.',
        },
      }),
    )
    render(<ApprovePendingPanel pending={pending()} />)

    await user.click(screen.getByRole('button', { name: 'Approve and publish all 309 events' }))

    expect(
      await screen.findByText(/changed after you read the list, so nothing was approved/u),
    ).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('says when the API could not be reached', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('fetch failed'))
    render(<ApprovePendingPanel pending={pending()} />)

    await user.click(screen.getByRole('button', { name: 'Approve and publish all 309 events' }))

    expect(await screen.findByText('Not done')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('pendingSentences and outcomeSentences', () => {
  it('speak of one event in the singular', () => {
    expect(
      pendingSentences({ total: 1, willGoOnSale: 1, publishedNothingToSell: 0, past: 1 }),
    ).toEqual([
      '1 event imported from listing files waits for approval, across every import.',
      'Approving puts it on sale here.',
      '1 event that has started, or starts within the minute, is left as it is.',
    ])
    expect(
      pendingSentences({ total: 2, willGoOnSale: 2, publishedNothingToSell: 0, past: 0 }),
    ).toContain('Approving puts all of them on sale here.')
    expect(
      pendingSentences({ total: 1, willGoOnSale: 0, publishedNothingToSell: 1, past: 0 }),
    ).toContain(
      '1 event will be published with nothing to sell: its listing gives no price, or every price is sold out.',
    )
  })

  it('say nothing was approved when nothing waited', () => {
    expect(
      outcomeSentences({
        total: 0,
        onSale: 0,
        publishedNothingToSell: 0,
        refused: 0,
        skippedPast: 0,
      }),
    ).toEqual(['No imported event was waiting, so nothing was approved.'])
  })
})
