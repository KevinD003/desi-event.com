/**
 * The referral-code list page (SPEC3 §12.5, SPEC3-XI §12.5): gated on
 * `referral_code:manage`, it says what a code does, what each administrator's
 * codes came to with SPEC3-XI's columns, the note on uses, the empty list, and
 * filters by status, maker and event — never by a code's text.
 *
 * @module app/admin/referral-codes/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../lib/workspace-api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listReferralCodes: vi.fn(),
  referralCodesByAdministrator: vi.fn(),
}))

const { readSession } = await import('../../../lib/session.js')
const { listReferralCodes, referralCodesByAdministrator } =
  await import('../../../lib/workspace-api.js')
const { default: ReferralCodesPage } = await import('./page.jsx')
const { EMPTY_LIST, INTRODUCTION, LIST_NOTE, NOT_FOR_THIS_ACCOUNT } =
  await import('./referral-vocabulary.js')

/** A platform administrator's session. */
const ADMIN = {
  user: { id: 'cuser000000000000000001' },
  capabilities: ['referral_code:manage', 'payment_terms:manage'],
  memberships: [],
}

/** A code as the list returns it. */
const CODE = {
  id: 'cref00000000000000000001',
  referralCode: 'PARTNER-2026',
  label: 'Rangoli partners',
  scope: 'SELECTED_EVENTS',
  events: [{ id: 'cevent0000000000000000001', title: 'Diwali Mela', slug: 'd', status: 'ON_SALE' }],
  eventCount: 1,
  expiresAt: null,
  maxUses: null,
  useCount: 2,
  usesPlaced: 2,
  usesReturned: 0,
  waived: [],
  status: 'ON',
  active: true,
  createdBy: { id: 'cuser000000000000000001', displayName: 'Anil Rao' },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

/**
 * Render the page for a query.
 *
 * @param {object} [query] The search parameters.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(query = {}) {
  render(await ReferralCodesPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  readSession.mockResolvedValue(ADMIN)
  listReferralCodes.mockResolvedValue({
    codes: [CODE],
    pagination: { page: 1, perPage: 50, total: 1, totalPages: 1, hasNextPage: false },
  })
  referralCodesByAdministrator.mockResolvedValue([
    {
      administrator: { id: 'cuser000000000000000001', displayName: 'Anil Rao' },
      codes: 3,
      usesPlaced: 9,
      usesReturned: 2,
      currentUses: 7,
      waived: [{ currency: 'USD', cents: 2_317 }],
    },
    {
      administrator: null,
      codes: 1,
      usesPlaced: 1,
      usesReturned: 0,
      currentUses: 1,
      waived: [],
    },
  ])
})

describe('the referral codes page', () => {
  it('refuses a session without referral_code:manage, finance administrators included', async () => {
    readSession.mockResolvedValue({
      user: { id: 'u2' },
      capabilities: ['platform_fee:refund', 'finance:view'],
      memberships: [],
    })

    await renderPage()

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(listReferralCodes).not.toHaveBeenCalled()
  })

  it('says what a code does, offers to make one, and shows what each administrator’s codes came to', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Referral codes' })).toBeInTheDocument()
    expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Make a referral code' })[0]).toHaveAttribute(
      'href',
      '/admin/referral-codes/new',
    )

    const table = screen.getByRole('table', {
      name: 'Referral codes by the administrator who made them',
    })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Administrator',
      'Codes',
      'Uses placed',
      'Given back',
      'Uses now',
      'Booking fees waived',
    ])
    // Each figure as read under its column's header; the column's name drawn
    // beside it for the stacked cards is hidden from screen readers.
    const figures = (row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) =>
          [...cell.childNodes]
            .filter((node) => node.getAttribute?.('aria-hidden') !== 'true')
            .map((node) => node.textContent)
            .join(''),
        )

    expect(
      figures(within(table).getByRole('rowheader', { name: 'Anil Rao' }).closest('tr')),
    ).toEqual(['3', '9', '2', '7', '$23.17'])
    expect(
      within(table).getByRole('rowheader', { name: 'A former administrator' }),
    ).toBeInTheDocument()
    expect(screen.getByText(LIST_NOTE)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Referral codes' })).toHaveTextContent('Diwali Mela')
  })

  it('stacks "By administrator" into cards at 320 px, each figure named, rather than scrolling sideways', async () => {
    await renderPage()

    const table = screen.getByRole('table', {
      name: 'Referral codes by the administrator who made them',
    })

    // A table only from 640 px; below it, blocks that reflow (SPEC3 §12.12).
    expect(table).toHaveClass('block', 'sm:table')
    expect(table.className).not.toMatch(/min-w-/u)
    expect(table.closest('.overflow-x-auto')).toBeNull()

    const row = within(table).getByRole('rowheader', { name: 'Anil Rao' }).closest('tr')
    const names = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.querySelector('[aria-hidden="true"]')?.textContent)

    expect(names).toEqual(['Codes', 'Uses placed', 'Given back', 'Uses now', 'Booking fees waived'])
  })

  it('filters by status, maker and event, never by a code’s text', async () => {
    await renderPage({
      status: 'ON',
      creatorId: 'cuser000000000000000001',
      eventId: 'cevent0000000000000000001',
      referralCode: 'PARTNER-2026',
    })

    expect(listReferralCodes).toHaveBeenCalledWith({
      status: 'ON',
      creatorId: 'cuser000000000000000001',
      eventId: 'cevent0000000000000000001',
      page: 1,
    })
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('ON')
    expect(screen.getByRole('combobox', { name: 'Made by' })).toHaveValue('cuser000000000000000001')
    expect(screen.getByRole('list', { name: 'Chosen event' })).toHaveTextContent('Diwali Mela')
    expect(screen.getByRole('link', { name: 'Clear the filters' })).toHaveAttribute(
      'href',
      '/admin/referral-codes',
    )
  })

  it('says there are no codes, and how to make one', async () => {
    listReferralCodes.mockResolvedValue({ codes: [], pagination: { page: 1, total: 0 } })
    referralCodesByAdministrator.mockResolvedValue([])

    await renderPage()

    expect(screen.getByRole('heading', { name: EMPTY_LIST })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('draws a failed read as a refusal, not as an empty list', async () => {
    listReferralCodes.mockRejectedValue(
      Object.assign(new Error('down'), { status: 503, code: 'UNAVAILABLE' }),
    )

    await renderPage()

    expect(screen.queryByRole('heading', { name: EMPTY_LIST })).toBeNull()
    expect(screen.getByText(/The list of referral codes/u)).toBeInTheDocument()
  })
})
