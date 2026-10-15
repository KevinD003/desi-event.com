/**
 * One referral code's page (SPEC3 §12.5, SPEC3-XI §12.5): gated on
 * `referral_code:manage`; the details; the switch and the change form; the
 * orders placed with it with SPEC3-XI's "Use given back" column and no buyer's
 * name; the empty sentence; and one answer for an id that is not a code's.
 *
 * `@file` rather than `@module`: the path's `[id]` segment is not a valid
 * module name.
 *
 * @file app/admin/referral-codes/id/page.test.jsx
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../../lib/workspace-api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getReferralCode: vi.fn(),
}))

const { readSession } = await import('../../../../lib/session.js')
const { getReferralCode } = await import('../../../../lib/workspace-api.js')
const { default: ReferralCodePage } = await import('./page.jsx')
const { NOT_FOR_THIS_ACCOUNT, NO_USES } = await import('../referral-vocabulary.js')

const ADMIN = {
  user: { id: 'cuser000000000000000001' },
  capabilities: ['referral_code:manage'],
  memberships: [],
}

const ID = 'cref00000000000000000001'

/**
 * The code as `referralCodes.get` answers.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The code with its uses.
 */
function detail(overrides = {}) {
  return {
    id: ID,
    referralCode: 'PARTNER-2026',
    label: 'Rangoli partners',
    scope: 'SELECTED_EVENTS',
    events: [
      { id: 'cevent0000000000000000001', title: 'Diwali Mela', slug: 'd', status: 'ON_SALE' },
    ],
    eventCount: 4,
    expiresAt: null,
    maxUses: 10,
    useCount: 1,
    usesPlaced: 2,
    usesReturned: 1,
    waived: [{ currency: 'USD', cents: 331 }],
    status: 'ON',
    active: true,
    createdBy: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    uses: [
      {
        orderReference: 'DE-7Q2K9',
        eventId: 'cevent0000000000000000001',
        eventTitle: 'Diwali Mela',
        placedAt: '2026-10-05T18:00:00.000Z',
        paymentMethod: 'AT_VENUE',
        orderStatus: 'PAID',
        feeWaivedCents: 331,
        currency: 'USD',
        useReturned: null,
      },
      {
        orderReference: 'DE-8R3L1',
        eventId: 'cevent0000000000000000001',
        eventTitle: 'Diwali Mela',
        placedAt: '2026-10-04T18:00:00.000Z',
        paymentMethod: 'CARD',
        orderStatus: 'REFUNDED',
        feeWaivedCents: 331,
        currency: 'USD',
        useReturned: { at: '2026-10-06T09:00:00.000Z', cause: 'REFUNDED' },
      },
    ],
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {string} [id] The id in the address.
 * @param {object} [query] The query string.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(id = ID, query = {}) {
  render(
    await ReferralCodePage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(query),
    }),
  )
}

beforeEach(() => {
  readSession.mockResolvedValue(ADMIN)
  getReferralCode.mockReset()
  getReferralCode.mockResolvedValue({
    code: detail(),
    pagination: { page: 1, perPage: 50, total: 2, hasNextPage: true, hasPreviousPage: false },
  })
})

describe('one referral code', () => {
  it('refuses a session without referral_code:manage', async () => {
    readSession.mockResolvedValue({ user: { id: 'u' }, capabilities: ['platform_fee:refund'] })

    await renderPage()

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(getReferralCode).not.toHaveBeenCalled()
  })

  it('shows the code’s details, its switch and its change form', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Referral code: Rangoli partners' }),
    ).toBeInTheDocument()
    expect(screen.getByText('PARTNER-2026')).toHaveClass('font-mono')
    expect(
      screen.getByRole('button', { name: 'Copy code for Rangoli partners' }),
    ).toBeInTheDocument()
    expect(screen.getByText('and 3 more (4 events in all)')).toBeInTheDocument()
    expect(screen.getByText('2 placed, 1 given back')).toBeInTheDocument()
    expect(screen.getByText(/A former administrator/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('lists the orders placed with it, with when and why a use was given back, and no buyer', async () => {
    await renderPage()

    const table = screen.getByRole('table', { name: 'Orders placed with this code' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Order', 'Event', 'Placed', 'Payment', 'Status', 'Fee waived', 'Use given back'])

    const [counted, givenBack] = within(table).getAllByRole('row').slice(1)

    expect(counted).toHaveTextContent('DE-7Q2K9')
    expect(counted).toHaveTextContent('At the venue')
    expect(counted).toHaveTextContent('—')
    expect(givenBack).toHaveTextContent('Card')
    expect(givenBack).toHaveTextContent('Oct 6, 2026: Refunded in full')
    expect(table).not.toHaveTextContent(/@/u)
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/admin/referral-codes/${ID}?page=2`,
    )
  })

  it('says when no order used it', async () => {
    getReferralCode.mockResolvedValue({ code: detail({ uses: [] }), pagination: null })

    await renderPage()

    expect(screen.getByText(NO_USES)).toBeInTheDocument()
  })

  it('answers an id that is not a code’s without asking the API', async () => {
    await renderPage('not an id!')

    expect(getReferralCode).not.toHaveBeenCalled()
    expect(
      screen.getByText(/This referral code is not something this account can open/u),
    ).toBeInTheDocument()
  })

  it('offers to switch a code that is off back on', async () => {
    getReferralCode.mockResolvedValue({
      code: detail({ active: false, status: 'OFF' }),
      pagination: null,
    })

    await renderPage()

    expect(screen.getByRole('button', { name: 'Switch on' })).toBeInTheDocument()
  })
})
