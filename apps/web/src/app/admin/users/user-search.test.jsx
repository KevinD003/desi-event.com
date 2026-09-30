/**
 * The account search keeps what was searched for out of every web address.
 *
 * The properties worth pinning:
 *
 *   - the terms travel in a POST body; the request's address carries no query
 *     string, and the page's own address never changes;
 *   - nothing is written to browser storage;
 *   - the count is announced politely, and each account shows its name,
 *     address, platform role in words, second factor and organisations;
 *   - the caller's own row cannot have its role changed, and says why;
 *   - a refusal is the API's own sentence.
 *
 * `fetch` itself is stubbed rather than `apiFetch`, so the address asserted is
 * the one that would really leave the browser.
 *
 * @module app/admin/users/user-search.test
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UserSearch } from './user-search.jsx'

const fetchMock = vi.fn()

/**
 * A JSON response.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The body.
 * @returns {Response} The response.
 */
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * One account as the search answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The account.
 */
function account(overrides = {}) {
  return {
    id: 'usr00000000000000000001',
    email: 'asha.rao@example.com',
    displayName: 'Asha Rao',
    role: 'MODERATOR',
    suspended: false,
    mfaEnrolled: true,
    self: false,
    createdAt: '2026-01-02T03:04:05.000Z',
    memberships: [
      { organizationId: 'org00000000000000000001', organizationName: 'Rangoli', role: 'ADMIN' },
    ],
    ...overrides,
  }
}

/**
 * A search answer.
 *
 * @param {object[]} accounts The accounts.
 * @returns {object} The body.
 */
function found(accounts) {
  return {
    data: accounts,
    pagination: {
      page: 1,
      perPage: 20,
      total: accounts.length,
      totalPages: accounts.length ? 1 : 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  }
}

/**
 * Type the terms and search.
 *
 * @param {object} user A userEvent instance.
 * @param {string} terms What to search for.
 * @returns {Promise<void>} Resolves once sent.
 */
async function searchFor(user, terms) {
  await user.type(screen.getByLabelText(/Email address, name or account id/u), terms)
  await user.click(screen.getByRole('button', { name: 'Search' }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the account search', () => {
  it('posts the terms in the body, never in an address', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const before = window.location.href

    fetchMock.mockResolvedValue(reply(200, found([account()])))
    render(<UserSearch />)

    await searchFor(user, 'asha.rao@example.com')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/v1/platform/users/search')
    expect(url).not.toContain('?')
    expect(url).not.toContain('asha')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ q: 'asha.rao@example.com', page: 1, perPage: 20 })

    expect(window.location.href).toBe(before)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('announces how many were found, and shows each account in words', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue(
      reply(
        200,
        found([
          account(),
          account({
            id: 'usr00000000000000000002',
            email: 'ben@example.com',
            displayName: 'Ben',
            role: 'SUPPORT',
            mfaEnrolled: false,
            memberships: [],
          }),
        ]),
      ),
    )
    render(<UserSearch />)

    await searchFor(user, 'example.com')

    const status = await screen.findByText('2 accounts found.')

    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')

    const asha = screen.getByRole('article', { name: 'Asha Rao' })

    expect(within(asha).getByText('asha.rao@example.com')).toBeVisible()
    expect(within(asha).getByText('Moderator')).toBeVisible()
    expect(within(asha).getByText(/Rangoli · Administrator/u)).toBeVisible()

    const ben = screen.getByRole('article', { name: 'Ben' })

    expect(within(ben).getByText('Support')).toBeVisible()
    expect(within(ben).getByText(/this role cannot work until it is/u)).toBeVisible()
    expect(within(ben).getByText('None.')).toBeVisible()
  })

  it('will not offer to change the caller’s own platform role, and says why', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue(
      reply(200, found([account({ displayName: 'Root', role: 'SUPER_ADMIN', self: true })])),
    )
    render(<UserSearch />)

    await searchFor(user, 'root')

    const card = await screen.findByRole('article', { name: /Root/u })
    const button = within(card).getByRole('button', { name: 'Change platform role' })

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      'This is your own account. Another super administrator must change your platform role.',
    )
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue(reply(200, found([])))
    render(<UserSearch />)

    await searchFor(user, 'nobody')

    expect(await screen.findByText('No account matches that search.')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('waits for three characters before it will search', async () => {
    const user = userEvent.setup()

    render(<UserSearch />)
    await user.type(screen.getByLabelText(/Email address, name or account id/u), 'as')

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('repeats the API’s sentence when it refuses', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValue(
      reply(403, {
        error: { code: 'FORBIDDEN', message: 'Only a super administrator may search accounts.' },
      }),
    )
    render(<UserSearch />)

    await searchFor(user, 'asha')

    const sentence = await screen.findByText('Only a super administrator may search accounts.')

    expect(sentence).toBeInTheDocument()
    // Focus goes to the refusal, drawn only once the answer is in.
    await waitFor(() => expect(sentence.closest('[tabindex="-1"]')).toHaveFocus())
  })

  it('moves focus to the refusal when the network fails', async () => {
    const user = userEvent.setup()

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<UserSearch />)

    await searchFor(user, 'asha')

    const refusal = (await screen.findByText('The search did not run')).closest('[tabindex="-1"]')

    expect(refusal).not.toBeNull()
    await waitFor(() => expect(refusal).toHaveFocus())
  })
})
