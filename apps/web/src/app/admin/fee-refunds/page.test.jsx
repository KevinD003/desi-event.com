/**
 * The booking fee refunds page (SPEC3 §12.6): gated on `platform_fee:refund`,
 * which a finance administrator holds, it says what a fee refund does and draws
 * the form; anybody else is told who refunds booking fees.
 *
 * @module app/admin/fee-refunds/page.test
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../../lib/session.js')
const { apiFetch } = await import('../../../lib/api-fetch.js')
const { default: FeeRefundsPage, metadata } = await import('./page.jsx')
const { INTRODUCTION, NOT_FOR_THIS_ACCOUNT } = await import('./fee-refund-vocabulary.js')

describe('booking fee refunds', () => {
  it.each([['ADMIN'], ['FINANCE_ADMIN'], ['SUPER_ADMIN']])(
    'draws the form for a %s, who may refund a fee',
    async (role) => {
      readSession.mockResolvedValue({
        user: { id: 'u', roles: [role] },
        capabilities: ['platform_fee:refund'],
      })

      render(await FeeRefundsPage())

      expect(
        screen.getByRole('heading', { level: 1, name: 'Booking fee refunds' }),
      ).toBeInTheDocument()
      expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()
      expect(screen.getByLabelText('Order reference')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Find order' })).toBeInTheDocument()
      expect(screen.queryByText(NOT_FOR_THIS_ACCOUNT)).toBeNull()
    },
  )

  it('refuses an account without the capability, and draws no form', async () => {
    readSession.mockResolvedValue({
      user: { id: 'u', roles: ['MODERATOR'] },
      capabilities: ['referral_code:manage', 'payment_terms:manage'],
    })

    render(await FeeRefundsPage())

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(screen.getByText('Not for this account')).toBeInTheDocument()
    expect(screen.queryByLabelText('Order reference')).toBeNull()
    expect(screen.queryByText(INTRODUCTION)).toBeNull()
  })

  it('refuses a visitor with no session', async () => {
    readSession.mockResolvedValue(null)

    render(await FeeRefundsPage())

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
  })

  it('is named for the tab and kept out of search engines', () => {
    expect(metadata).toEqual({
      title: 'Booking fee refunds',
      robots: { index: false, follow: false },
    })
  })

  it.each([
    ['FINANCE_ADMIN', ['platform_fee:refund', 'finance:view'], true],
    ['ADMIN', ['platform_fee:refund'], false],
  ])(
    'links a refund that did not settle for %s only when the account can open it',
    async (role, capabilities, linked) => {
      readSession.mockResolvedValue({ user: { id: 'u', roles: [role] }, capabilities })

      const fee = {
        reference: 'DE-7K2M-9QPX',
        eventId: 'cevent0000000000000000001',
        eventTitle: 'Diwali Mela',
        status: 'PAID',
        paymentMethod: 'CARD',
        currency: 'USD',
        feesCents: 700,
        feeWaivedCents: 0,
        feeRefundedCents: 0,
        refundableFeeCents: 700,
        taxOnFeeCents: 0,
        feeKeptCents: 0,
        disputed: false,
      }
      const answer = (body) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      })

      apiFetch.mockResolvedValueOnce(answer({ data: fee })).mockResolvedValueOnce(
        answer({
          data: {
            refund: { id: 'crefund00000000000000001', amountCents: 700, status: 'TIMEOUT' },
            fee: { ...fee, refundableFeeCents: 0 },
          },
        }),
      )

      const user = userEvent.setup()

      render(await FeeRefundsPage())
      await user.type(screen.getByLabelText('Order reference'), 'DE-7K2M-9QPX')
      await user.click(screen.getByRole('button', { name: 'Find order' }))
      await user.type(await screen.findByLabelText(/^Reason/u), 'Charged the booking fee twice')
      await user.click(screen.getByRole('button', { name: 'Refund $7.00 booking fee (simulated)' }))

      expect(await screen.findByText('The booking fee refund has not settled')).toBeInTheDocument()
      expect(Boolean(screen.queryByRole('link', { name: 'See this refund' }))).toBe(linked)
    },
  )
})
