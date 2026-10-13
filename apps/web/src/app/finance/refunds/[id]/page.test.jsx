/**
 * One refund's page (SPEC3 §12.10).
 *
 * Pinned here: the fee figure is called the booking fee; a refund of an order
 * booked to pay at the venue says that what was taken at the door is held by
 * the organiser and is not in this refund, and a card refund says nothing of
 * the kind; a lapsed second factor is offered in place; and a refusal or a
 * missing refund reads the same.
 *
 * @file app/finance/refunds/id/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/finance/refunds/refundaaaaaaaaaaaaaaaaaa',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/organizer-api.js', () => ({ getRefund: vi.fn() }))
vi.mock('../../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../../lib/capabilities.js')

  return { ...actual, readSession: vi.fn() }
})

const { getRefund } = await import('../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../lib/session.js')
const { default: RefundDetailPage } = await import('./page.jsx')

const ORG = 'orgaaaaaaaaaaaaaaaaaaaaaa'

const FINANCE = {
  user: { id: 'f1' },
  capabilities: [],
  memberships: [{ organizationId: ORG, capabilities: ['finance:view', 'order:refund_request'] }],
}

/**
 * A refund as the API answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The refund.
 */
function refund(overrides = {}) {
  return {
    id: 'refundaaaaaaaaaaaaaaaaaa',
    organizationId: ORG,
    orderId: 'orderaaaaaaaaaaaaaaaaaaa',
    orderReference: 'DE-7Q2K9P',
    status: 'REQUESTED',
    amountCents: 729,
    currency: 'USD',
    reason: 'EVENT_CANCELLED',
    reasonNote: null,
    providerRefundId: null,
    allocation: { faceValueCents: 0, feeCents: 729, taxCents: 0 },
    items: [],
    requestedById: null,
    approvedById: null,
    ticketsRevoked: false,
    inventoryReturned: false,
    failureCode: null,
    attempts: 0,
    submittedAt: null,
    settledAt: null,
    createdAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage() {
  render(await RefundDetailPage({ params: Promise.resolve({ id: 'refundaaaaaaaaaaaaaaaaaa' }) }))
}

beforeEach(() => {
  getRefund.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue(FINANCE)
})

describe('a refund of an order booked to pay at the venue', () => {
  it('says the door money is held by the organiser and not in this refund', async () => {
    getRefund.mockResolvedValue(refund({ paymentMethod: 'AT_VENUE', paidAtDoorCents: 4000 }))

    await renderPage()

    expect(
      screen.getByText(
        'The $40.00 paid at the door for this order is held by the organiser; this refund does not include it.',
      ),
    ).toBeInTheDocument()
  })

  it('says nothing about door money when none was taken', async () => {
    getRefund.mockResolvedValue(refund({ paymentMethod: 'AT_VENUE', paidAtDoorCents: 0 }))

    await renderPage()

    expect(screen.queryByText(/paid at the door/u)).toBeNull()
  })
})

describe('every refund', () => {
  it('calls the fee figure the booking fee', async () => {
    getRefund.mockResolvedValue(refund({ paymentMethod: 'CARD' }))

    await renderPage()

    expect(screen.getByText('The booking fee, given back or kept per policy.')).toBeInTheDocument()
    expect(screen.queryByText(/platform fee/u)).toBeNull()
    expect(screen.queryByText(/paid at the door/u)).toBeNull()
  })

  it('offers the second factor in place when it has lapsed', async () => {
    getRefund.mockRejectedValue(
      Object.assign(new Error('Step up.'), { status: 403, code: 'STEP_UP_REQUIRED' }),
    )

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.getByText(/see this refund/u)).toBeInTheDocument()
  })

  it('reads a refusal and a missing refund the same way', async () => {
    getRefund.mockRejectedValue(Object.assign(new Error('No.'), { status: 404, code: 'NOT_FOUND' }))

    await renderPage()

    expect(screen.queryByText('The booking fee, given back or kept per policy.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to operations' })).toBeInTheDocument()
  })
})
