/**
 * The page for making a referral code (SPEC3 §12.5): gated on
 * `referral_code:manage`, it says what a code does and draws the form.
 *
 * `@file` rather than `@module`: "new" is a reserved word in a module name.
 *
 * @file app/admin/referral-codes/new/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../../../lib/session.js')
const { default: NewReferralCodePage } = await import('./page.jsx')
const { INTRODUCTION, NOT_FOR_THIS_ACCOUNT } = await import('../referral-vocabulary.js')

describe('making a referral code', () => {
  it('draws the form for an administrator who may make one', async () => {
    readSession.mockResolvedValue({ user: { id: 'u' }, capabilities: ['referral_code:manage'] })

    render(await NewReferralCodePage())

    expect(
      screen.getByRole('heading', { level: 1, name: 'Make a referral code' }),
    ).toBeInTheDocument()
    expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make referral code' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Referral codes' })).toHaveAttribute(
      'href',
      '/admin/referral-codes',
    )
  })

  it('refuses anybody else, a finance administrator included', async () => {
    readSession.mockResolvedValue({ user: { id: 'u' }, capabilities: ['platform_fee:refund'] })

    render(await NewReferralCodePage())

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make referral code' })).toBeNull()
  })
})
