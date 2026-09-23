/**
 * The workspace list helpers ask for exactly what their endpoint's query schema
 * names, encoded, and throw a refusal as they received it.
 *
 * The properties that matter:
 *
 *   - **Paths.** Each helper reaches the endpoint the contract names, with an
 *     id encoded rather than spliced, so a crafted id cannot walk the path.
 *   - **Query encoding.** Only the fields the schema accepts, empty ones left
 *     out, values encoded — so a page cannot widen a request with a stray key.
 *   - **Error propagation.** A refusal keeps its `status`, `code` and
 *     `retryAfterSeconds`, because every page reads its refusal state from them.
 *
 * @module lib/workspace-api.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [{ name: 'desi_session', value: 'opaque' }] }),
}))

const {
  formatInstant,
  getNotification,
  getTeam,
  isPastTheEnd,
  listHref,
  listNotifications,
  listOrganizationEvents,
  listReconciliationTasks,
  listRefunds,
  readPage,
} = await import('./workspace-api.js')

const fetch = vi.fn()

/**
 * A successful API answer.
 *
 * @param {object} body The JSON body.
 * @returns {Response} The response.
 */
function ok(body) {
  return new Response(JSON.stringify(body), { status: 200 })
}

/**
 * The path and query of the one request made.
 *
 * @returns {URL} The requested URL.
 */
function requested() {
  expect(fetch).toHaveBeenCalledTimes(1)

  return new URL(fetch.mock.calls[0][0])
}

beforeEach(() => {
  fetch.mockReset()
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('paths', () => {
  it('reads a team from the organisation’s members route, with the id encoded', async () => {
    fetch.mockResolvedValueOnce(ok({ data: { emailVisibility: 'HIDDEN', members: [] } }))

    const team = await getTeam('org/../../admin')

    expect(requested().pathname).toBe('/v1/organizations/org%2F..%2F..%2Fadmin/members')
    expect(team).toEqual({ emailVisibility: 'HIDDEN', members: [] })
  })

  it('reads one notification by encoded id', async () => {
    fetch.mockResolvedValueOnce(ok({ data: { id: 'n1' } }))

    expect(await getNotification('n1?x=1')).toEqual({ id: 'n1' })
    expect(requested().pathname).toBe('/v1/operations/notifications/n1%3Fx%3D1')
  })
})

describe('query encoding', () => {
  it('asks for the hundred latest-starting events and returns them in date order', async () => {
    // An organisation with more events than one page: the hundred asked for
    // must be the upcoming and recent ones, not the oldest drafts.
    fetch.mockResolvedValueOnce(
      ok({
        data: [{ id: 'e-later' }, { id: 'e-sooner' }],
        pagination: { total: 240, hasNextPage: true },
      }),
    )

    const answer = await listOrganizationEvents('org&x=1')
    const url = requested()

    expect(url.pathname).toBe('/v1/events')
    expect(url.searchParams.get('organizationId')).toBe('org&x=1')
    expect(url.searchParams.get('perPage')).toBe('100')
    expect(url.searchParams.get('sort')).toBe('startsAt:desc')
    expect(url.searchParams.has('x')).toBe(false)
    expect(answer).toEqual({
      events: [{ id: 'e-sooner' }, { id: 'e-later' }],
      pagination: { total: 240, hasNextPage: true },
    })
  })

  it('sends only the notification filters that are set, and none it does not know', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [], pagination: null }))

    await listNotifications({
      status: 'DEAD_LETTER',
      failureCategory: '',
      page: 2,
      perPage: 50,
      organizationId: 'org1',
    })

    const url = requested()

    expect(url.pathname).toBe('/v1/operations/notifications')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'DEAD_LETTER',
      page: '2',
      perPage: '50',
    })
  })

  it('asks the bare queue when no filter is set', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [], pagination: null }))

    expect(await listNotifications()).toEqual({ messages: [], pagination: null })
    expect(requested().search).toBe('')
  })

  it('scopes refunds by organisation and encodes the order reference', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [{ id: 'r1' }], pagination: { total: 1 } }))

    const answer = await listRefunds({
      organizationId: 'org1',
      status: 'CANCELLED',
      orderReference: 'DE-8F3K 2Q',
      reason: 'ignored',
    })
    const url = requested()

    expect(url.pathname).toBe('/v1/refunds')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      organizationId: 'org1',
      status: 'CANCELLED',
      orderReference: 'DE-8F3K 2Q',
    })
    expect(answer.refunds).toEqual([{ id: 'r1' }])
  })

  it('refuses to ask for refunds without an organisation rather than widen the question', async () => {
    await expect(listRefunds({ status: 'REQUESTED' })).rejects.toThrow(TypeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never sends a reconciliation reference, which would carry provider identifiers', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [], pagination: null }))

    await listReconciliationTasks({
      state: 'RESOLVED',
      kind: 'REFUND_UNKNOWN',
      aging: 'OVERDUE',
      reference: 'pi_123',
    })

    const url = requested()

    expect(url.pathname).toBe('/v1/operations/reconciliation')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: 'RESOLVED',
      kind: 'REFUND_UNKNOWN',
      aging: 'OVERDUE',
    })
  })

  it('omits the organisation for the platform view of reconciliation', async () => {
    fetch.mockResolvedValueOnce(ok({ data: [{ id: 't1' }], pagination: null }))

    const answer = await listReconciliationTasks({ organizationId: '' })

    expect(requested().searchParams.has('organizationId')).toBe(false)
    expect(answer.tasks).toEqual([{ id: 't1' }])
  })
})

describe('error propagation', () => {
  it('throws a lapsed step-up with its status and code intact', async () => {
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } }),
        { status: 403 },
      ),
    )

    await expect(listRefunds({ organizationId: 'org1' })).rejects.toMatchObject({
      status: 403,
      code: 'STEP_UP_REQUIRED',
    })
  })

  it('throws a rate limit with how long to wait', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    )

    await expect(getTeam('org1')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 })
  })

  it('lets a dead API throw with no status, which the pages read as unreachable', async () => {
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    const error = await listReconciliationTasks().catch((caught) => caught)

    expect(error).toBeInstanceOf(TypeError)
    expect(error.status).toBeUndefined()
  })
})

describe('the pure helpers', () => {
  it('reads a page number and refuses nonsense', () => {
    expect(readPage('3')).toBe(3)
    expect(readPage('0')).toBe(1)
    expect(readPage('-2')).toBe(1)
    expect(readPage('2.5')).toBe(1)
    expect(readPage('abc')).toBe(1)
    expect(readPage(undefined)).toBe(1)
    expect(readPage('999999')).toBe(10_000)
  })

  it('builds a list address that keeps every filter and drops the empty ones', () => {
    expect(listHref('/finance/refunds', { organizationId: 'o1', status: '', page: 2 })).toBe(
      '/finance/refunds?organizationId=o1&page=2',
    )
    expect(listHref('/finance/refunds', { status: 'A&B', page: 1 })).toBe(
      '/finance/refunds?status=A%26B',
    )
    expect(listHref('/operations/notifications', {})).toBe('/operations/notifications')
  })

  it('tells a page past the end of a list from an empty list', () => {
    // Page 2 of a one-page list: nothing on it, but the list is not empty.
    expect(isPastTheEnd(0, { page: 2, total: 7, totalPages: 1 }, 2)).toBe(true)
    // An empty list, on whatever page.
    expect(isPastTheEnd(0, { page: 1, total: 0, totalPages: 0 }, 1)).toBe(false)
    expect(isPastTheEnd(0, { page: 3, total: 0, totalPages: 0 }, 3)).toBe(false)
    // A page with rows is never past the end.
    expect(isPastTheEnd(4, { page: 1, total: 4, totalPages: 1 }, 1)).toBe(false)
    // No counters: only a later page can be past the end.
    expect(isPastTheEnd(0, null, 1)).toBe(false)
    expect(isPastTheEnd(0, null, 2)).toBe(true)
  })

  it('prints an instant in UTC and says so, and prints nothing for no instant', () => {
    expect(formatInstant('2026-09-23T14:05:00.000Z')).toMatch(/^23 Sept? 2026, 14:05 UTC$/u)
    expect(formatInstant(null)).toBeNull()
    expect(formatInstant('not a date')).toBeNull()
  })
})
