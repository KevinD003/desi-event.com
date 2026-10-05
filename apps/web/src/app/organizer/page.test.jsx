/**
 * The workspace front page says what each analytics destination is for: an
 * organisation's own visits and sales, and, for a platform administrator,
 * every event's visits.
 *
 * @module app/organizer/page.test
 */

import { PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../lib/session.js')
const { default: OrganizerHomePage } = await import('./page.jsx')

afterEach(cleanup)

/**
 * Render the page for a session.
 *
 * @param {object} session The session.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderFor(session) {
  readSession.mockResolvedValue(session)
  render(await OrganizerHomePage())
}

describe('the workspace front page', () => {
  it('says analytics covers who visited each event page, for an owner', async () => {
    await renderFor({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [
        {
          organizationId: 'corgalpha00000000000001',
          organizationName: 'Alpha Garba',
          role: 'OWNER',
          capabilities: ['report:view', 'event:create'],
        },
      ],
    })

    const card = screen.getByRole('link', { name: /^Analytics/u })

    expect(card).toHaveAttribute('href', '/analytics')
    expect(
      within(card).getByText(
        'Who visited each event page, what sold, what is held and who came in.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Every event’s visits/u })).toBeNull()
  })

  it('offers a platform administrator every event’s visits, and says what it is', async () => {
    await renderFor({
      user: { id: 'u2' },
      capabilities: [...PLATFORM_ROLE_CAPABILITIES.ADMIN],
      memberships: [],
    })

    const card = screen.getByRole('link', { name: /Every event’s visits/u })

    expect(card).toHaveAttribute('href', '/analytics/events')
    expect(within(card).getByText('Visits to every event on the platform.')).toBeInTheDocument()
  })
})
