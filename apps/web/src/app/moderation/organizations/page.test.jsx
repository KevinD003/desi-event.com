/**
 * The organisation queue filters by link, says which filter is current, and
 * carries no contact address.
 *
 * @module app/moderation/organizations/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, getVerificationQueue: vi.fn() }
})

const { getVerificationQueue } = await import('../../../lib/workspace-api.js')
const { default: VerificationQueuePage, FILTERS } = await import('./page.jsx')

/**
 * One queue entry.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The entry.
 */
function entry(overrides = {}) {
  return {
    organizationId: 'org00000000000000000001',
    name: 'Bay Lights Garba Co.',
    slug: 'bay-lights-garba-co',
    legalName: 'Bay Lights LLC',
    status: 'PENDING',
    submittedAt: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    organiserNote: 'We have run four nights a year since 2019.',
    memberCount: 3,
    eventCount: 1,
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [query] The query string.
 * @param {object[]} [organizations] What the API answers.
 * @param {object|null} [pagination] The API's pagination block.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(query = {}, organizations = [entry()], pagination = null) {
  getVerificationQueue.mockResolvedValue({ organizations, pagination })

  return render(await VerificationQueuePage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  getVerificationQueue.mockReset()
})

describe('the organisation queue', () => {
  it('opens on the waiting queue, and marks that filter current', async () => {
    await renderPage()

    expect(getVerificationQueue).toHaveBeenCalledWith({ status: undefined, page: 1 })

    const filters = screen.getByRole('navigation', { name: 'Filter by state' })

    expect(within(filters).getByRole('link', { name: 'Waiting for review' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(filters).getAllByRole('link')).toHaveLength(FILTERS.length)
  })

  it('asks for the chosen state and marks it current, and ignores one it does not offer', async () => {
    await renderPage({ status: 'REJECTED' })

    expect(getVerificationQueue).toHaveBeenLastCalledWith({ status: 'REJECTED', page: 1 })
    expect(screen.getByRole('link', { name: 'Rejected' })).toHaveAttribute('aria-current', 'page')

    getVerificationQueue.mockClear()
    await renderPage({ status: 'UNVERIFIED' })

    expect(getVerificationQueue).toHaveBeenLastCalledWith({ status: undefined, page: 1 })
  })

  it('shows each organisation with its note, counts and a link to its review', async () => {
    const { container } = await renderPage()

    expect(screen.getByRole('link', { name: 'Bay Lights Garba Co.' })).toHaveAttribute(
      'href',
      '/moderation/organizations/org00000000000000000001',
    )
    expect(screen.getByText(/We have run four nights a year since 2019/u)).toBeInTheDocument()
    expect(screen.getByText(/3 members · 1 event/u)).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/@/u)
  })

  it('says so when nothing is in the state', async () => {
    await renderPage({ status: 'REVOKED' }, [], {
      page: 1,
      perPage: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    })

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText(/No organisation is in this state/u)).toBeInTheDocument()
  })

  it('says a page past the end is past the end, and links to the first page', async () => {
    await renderPage({ status: 'VERIFIED', page: '4' }, [], {
      page: 4,
      perPage: 20,
      total: 23,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })

    expect(getVerificationQueue).toHaveBeenLastCalledWith({ status: 'VERIFIED', page: 4 })
    // Not "nothing is in this state": 23 organisations are.
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()
    expect(screen.queryByText(/No organisation is in this state/u)).not.toBeInTheDocument()
    expect(screen.getByText('Page 4 is past the end of this list')).toBeInTheDocument()
    expect(screen.getByText('There are 23 organisations in this state, on 2 pages.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      '/moderation/organizations?status=VERIFIED',
    )
  })

  it('describes the list the filter shows, not the waiting queue under every filter', async () => {
    for (const filter of FILTERS) {
      cleanup()

      const { container } = await renderPage(filter.value ? { status: filter.value } : {}, [])

      expect(container.textContent).toContain(filter.intro)
      // Only the waiting queue is organisations asking for something.
      expect(container.textContent.includes('asking to be verified')).toBe(filter.value === null)
    }
  })
})
