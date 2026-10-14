/**
 * The account overview offers accepting an organiser invitation — never making
 * an organisation of your own — and says honestly what is not emailed.
 *
 * @module app/account/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../lib/session.js')
const { default: AccountPage } = await import('./page.jsx')

/**
 * Render the overview for a session.
 *
 * @param {object} [user] Fields of the session's user.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(user = {}) {
  readSession.mockResolvedValue({
    user: { displayName: 'Meera', email: 'meera@example.com', emailVerified: true, ...user },
    capabilities: [],
    memberships: [],
    session: { mfaRequired: false, mfaEnrolled: false },
    deliveryMode: 'MANUAL',
  })

  return render(await AccountPage())
}

beforeEach(() => {
  readSession.mockReset()
})

describe('the account overview', () => {
  it('offers accepting an organiser invitation, and joining a team with a code', async () => {
    await renderPage()

    const places = screen.getByRole('region', { name: 'Where to go' })
    const accept = within(places).getByRole('link', { name: /^Accept an organiser invitation/u })

    expect(accept).toHaveAttribute('href', '/account/organizations/new')
    expect(accept).toHaveTextContent(
      'Enter the organiser invitation code the team at The Desi Events sent you.',
    )
    expect(
      within(places).getByRole('link', { name: /^Join an organisation’s team/u }),
    ).toHaveAttribute('href', '/account/invitations')
  })

  it('offers no way to make an organisation of your own', async () => {
    const { container } = await renderPage()

    expect(container.textContent).not.toMatch(/create an organisation|start your own/iu)
  })

  it('says an unconfirmed address is not confirmed by email here, whatever the delivery mode', async () => {
    const { container } = await renderPage({ emailVerified: false })

    expect(
      screen.getByText(/Not confirmed\. This site does not email confirmation links/u),
    ).toBeVisible()
    expect(container.textContent).not.toMatch(/has no email service|sends no email/iu)
  })
})
