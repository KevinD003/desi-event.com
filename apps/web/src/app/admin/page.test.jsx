/**
 * The front of platform administration: what is waiting for the team, queue
 * by queue, with the API's own figures and never an invented one.
 *
 * @module app/admin/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()
const getModerationQueue = vi.fn()
const getPendingImports = vi.fn()
const getOrganizerInvitations = vi.fn()

vi.mock('../../lib/session.js', () => ({ readSession: (...args) => readSession(...args) }))
vi.mock('../../lib/organizer-api.js', () => ({
  getModerationQueue: (...args) => getModerationQueue(...args),
}))
vi.mock('../../lib/imports-api.js', () => ({
  getPendingImports: (...args) => getPendingImports(...args),
}))
vi.mock('../../lib/workspace-api.js', () => ({
  getOrganizerInvitations: (...args) => getOrganizerInvitations(...args),
}))

const { default: AdminPage, QUEUES, countOf } = await import('./page.jsx')

/** A platform administrator's capabilities, as far as these queues ask. */
const ADMIN = {
  user: { displayName: 'Anil' },
  capabilities: ['moderation:review', 'event:import', 'organizer:invite', 'platform_fee:refund'],
  memberships: [],
}

beforeEach(() => {
  readSession.mockReset()
  getModerationQueue.mockReset()
  getPendingImports.mockReset()
  getOrganizerInvitations.mockReset()
})

afterEach(cleanup)

/**
 * Render the page for a session.
 *
 * @param {object|null} session What `readSession` resolves with.
 * @returns {Promise<HTMLElement>} The list of queues, if drawn.
 */
async function draw(session) {
  readSession.mockResolvedValue(session)
  render(await AdminPage())

  return screen.queryByRole('list', { name: 'Waiting for the team' })
}

describe('the platform administration overview', () => {
  it('is a page of its own with one heading, not a redirect', async () => {
    getModerationQueue.mockResolvedValue({ events: [], pagination: { total: 0 } })
    getPendingImports.mockResolvedValue({ pending: { total: 0 } })
    getOrganizerInvitations.mockResolvedValue({ invitations: [], pagination: { total: 0 } })

    await draw(ADMIN)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Platform administration' }),
    ).toBeInTheDocument()
  })

  it('shows each queue with the figure the API gives for it, and leads to where it is worked', async () => {
    getModerationQueue.mockResolvedValue({ events: [{}, {}], pagination: { total: 7 } })
    getPendingImports.mockResolvedValue({ pending: { total: 309 } })
    getOrganizerInvitations.mockResolvedValue({ invitations: [{}], pagination: { total: 1 } })

    const list = await draw(ADMIN)
    const rows = within(list).getAllByRole('listitem')

    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'Events waiting for review',
      'Imported events waiting for approval',
      'Organiser invitations not yet accepted',
      'Booking fee refunds',
    ])
    // The API's own totals, not the length of the first page.
    expect(within(rows[0]).getByText('7')).toHaveAttribute('value', '7')
    expect(within(rows[0]).getByText(/7 events are waiting for a moderator/u)).toBeInTheDocument()
    expect(within(rows[1]).getByText('309')).toBeInTheDocument()
    expect(within(rows[2]).getByText(/1 invitation is waiting/u)).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'Review events' })).toHaveAttribute(
      'href',
      '/moderation/events',
    )
    expect(within(rows[1]).getByRole('link', { name: 'Open imports' })).toHaveAttribute(
      'href',
      '/admin/imports',
    )
    expect(within(rows[2]).getByRole('link', { name: 'See invitations' })).toHaveAttribute(
      'href',
      '/admin/organizer-invitations',
    )
    // Only invitations still waiting are counted.
    expect(getOrganizerInvitations).toHaveBeenCalledWith({ status: 'PENDING' })
  })

  it('gives booking fee refunds no number, because they have no queue, and says so', async () => {
    getModerationQueue.mockResolvedValue({ events: [], pagination: null })
    getPendingImports.mockResolvedValue({ pending: { total: 0 } })
    getOrganizerInvitations.mockResolvedValue({ invitations: [], pagination: null })

    const list = await draw(ADMIN)
    const refunds = within(list).getAllByRole('listitem')[3]

    expect(refunds.querySelector('data')).toBeNull()
    expect(refunds).toHaveTextContent(/There is no queue/u)
    expect(within(refunds).getByRole('link', { name: 'Refund a booking fee' })).toHaveAttribute(
      'href',
      '/admin/fee-refunds',
    )
  })

  it('says a figure could not be read, rather than showing a nought, and keeps the others', async () => {
    getModerationQueue.mockRejectedValue(Object.assign(new Error('step-up'), { status: 403 }))
    getPendingImports.mockResolvedValue({ pending: { total: 2 } })
    getOrganizerInvitations.mockResolvedValue({ invitations: [], pagination: { total: 0 } })

    const list = await draw(ADMIN)
    const [review, imports] = within(list).getAllByRole('listitem')

    expect(review).toHaveTextContent('This figure could not be read just now.')
    expect(review.querySelector('data')).toBeNull()
    expect(within(review).getByRole('link', { name: 'Review events' })).toBeInTheDocument()
    expect(within(imports).getByText('2')).toBeInTheDocument()
  })

  it('draws only the queues this session’s pages would show, and reads nothing else', async () => {
    getPendingImports.mockResolvedValue({ pending: { total: 3 } })

    const list = await draw({ capabilities: ['event:import'], memberships: [] })

    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(getModerationQueue).not.toHaveBeenCalled()
    expect(getOrganizerInvitations).not.toHaveBeenCalled()
  })

  it('says so plainly when this account works none of the queues', async () => {
    const list = await draw({ capabilities: ['venue_booking:cancel'], memberships: [] })

    expect(list).toBeNull()
    expect(screen.getByText(/Nothing in this area keeps a queue this account works/u)).toBeTruthy()
  })
})

describe('countOf', () => {
  it('takes the API’s total when the list is paginated, and the list’s length when it is not', () => {
    expect(countOf([{}, {}], { total: 40 })).toBe(40)
    expect(countOf([{}, {}], null)).toBe(2)
    expect(countOf([], { page: 1 })).toBe(0)
  })
})

describe('the queues', () => {
  it('each name the capability their page asks for, and never count without reading', () => {
    for (const queue of QUEUES) {
      expect(queue.capability).toMatch(/^[a-z_]+:[a-z_]+$/u)
      expect(Boolean(queue.count) !== Boolean(queue.note), queue.id).toBe(true)
    }
  })
})
