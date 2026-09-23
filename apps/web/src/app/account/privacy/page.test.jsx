/**
 * The attendee privacy page says what is missing as plainly as what exists.
 *
 * The properties worth pinning: it links to the controls that exist; it names
 * every capability this build lacks — export, deletion, email, scheduled
 * deletion — as unavailable rather than as "coming"; it promises nothing about
 * an address it cannot keep; and it asks nothing of the API, so it cannot fail
 * to load.
 *
 * @module app/account/privacy/page.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AccountPrivacyPage from './page.jsx'

afterEach(cleanup)

describe('AccountPrivacyPage', () => {
  it('links to the privacy controls that exist', () => {
    render(<AccountPrivacyPage />)

    expect(screen.getByRole('link', { name: 'Account security' }).getAttribute('href')).toBe(
      '/account/security',
    )
    expect(screen.getByRole('link', { name: 'Transfers' }).getAttribute('href')).toBe(
      '/account/transfers',
    )
  })

  it('names each missing capability as unavailable, not as coming', () => {
    const { container } = render(<AccountPrivacyPage />)

    for (const missing of [
      'Download a copy of your data',
      'Delete your account',
      'Email from this site',
      'Automatic deletion after a set time',
    ]) {
      expect(screen.getByText(missing, { exact: false }).textContent).toMatch(
        /not available in this build/,
      )
    }

    expect(container.textContent).not.toMatch(/coming soon|\bsoon\b|\byet\b|in a future/i)
  })

  it('says a forgotten password cannot be reset, because no email is delivered', () => {
    const { container } = render(<AccountPrivacyPage />)

    expect(container.textContent).toMatch(/forgotten password cannot be reset/i)
  })

  it('shows no email address, and no address-shaped example', () => {
    const { container } = render(<AccountPrivacyPage />)

    expect(container.textContent).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  })

  it('makes no request of its own', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    render(<AccountPrivacyPage />)

    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})
