/**
 * The workspace front page says what the account looks after, organisation
 * by organisation, and leaves the way around the workspace to the rail.
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

/** An owner of one organisation. */
const OWNER = {
  user: { id: 'u1' },
  capabilities: [],
  memberships: [
    {
      organizationId: 'corgalpha00000000000001',
      organizationName: 'Alpha Garba',
      role: 'OWNER',
      capabilities: ['report:view', 'event:create', 'ticket:check_in'],
    },
  ],
}

describe('the workspace front page', () => {
  it('says, per organisation, what this account holds there, in words', async () => {
    await renderFor(OWNER)

    const section = screen.getByRole('region', { name: 'Your organisations' })
    const held = within(section).getByRole('list', { name: 'What this role lets you do' })

    expect(within(section).getByText('Alpha Garba')).toBeInTheDocument()
    expect(within(section).getByText('OWNER')).toBeInTheDocument()
    expect(
      within(held)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Create and edit events', 'Admit people at the door', 'See how events are selling'])
  })

  it('repeats no menu: the rail beside it is the way around the workspace', async () => {
    // The page used to end in a grid of link cards, one per rail entry, which
    // with the rail and an area's tabs made three menus on one screen.
    await renderFor(OWNER)

    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.queryByRole('region', { name: 'Events and venues' })).toBeNull()
  })

  it('says where a platform administrator’s reach comes from when they belong to no organisation', async () => {
    await renderFor({
      user: { id: 'u2' },
      capabilities: [...PLATFORM_ROLE_CAPABILITIES.ADMIN],
      memberships: [],
    })

    expect(
      screen.getByText(
        'You are not a member of any organisation. What you can open here comes from a platform role.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toEqual([])
  })
})
