/**
 * The account-creation page, and the way to it from sign-in.
 *
 * The properties worth pinning: somebody already signed in is sent on rather
 * than offered a second account; `next` survives the trip between sign-in and
 * account creation in both directions, and only a path on this site does; and
 * the plain case carries no query at all.
 *
 * @module app/register/page.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  }),
}))

const { readSession } = await import('../../lib/session.js')
const { redirect } = await import('next/navigation')
const { default: RegisterPage } = await import('./page.jsx')
const { default: SignInPage } = await import('../sign-in/page.jsx')

/**
 * Route props carrying a query.
 *
 * @param {Record<string, string>} query The query.
 * @returns {object} The props.
 */
function props(query) {
  return { searchParams: Promise.resolve(query) }
}

beforeEach(() => {
  readSession.mockReset()
  readSession.mockResolvedValue(null)
  redirect.mockClear()
})

afterEach(cleanup)

describe('RegisterPage', () => {
  it('sends somebody already signed in on to where they were going', async () => {
    readSession.mockResolvedValue({ user: { id: 'u1' } })

    await expect(RegisterPage(props({ next: '/tickets' }))).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/tickets')
  })

  it('offers sign-in instead, carrying the same next', async () => {
    render(await RegisterPage(props({ next: '/events/qawwali/checkout' })))

    expect(screen.getByRole('heading', { level: 1, name: 'Create an account' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Fevents%2Fqawwali%2Fcheckout',
    )
  })

  it('drops a next that leaves the site', async () => {
    render(await RegisterPage(props({ next: '//evil.example/steal' })))

    // The default destination is the account, which sign-in reaches bare.
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
  })
})

describe('SignInPage', () => {
  it('offers account creation, carrying the same next', async () => {
    render(await SignInPage(props({ next: '/events/qawwali/checkout' })))

    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/register?next=%2Fevents%2Fqawwali%2Fcheckout',
    )
  })

  it('offers it with no query when there is nowhere particular to return to', async () => {
    render(await SignInPage(props({})))

    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/register',
    )
  })

  it('carries no next that leaves the site', async () => {
    render(await SignInPage(props({ next: '/\\evil.example' })))

    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/register',
    )
  })
})
