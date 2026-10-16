import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [{ name: 'desi_session', value: 'opaque' }] }),
}))

const { RUN_PAGE_SIZE, getImportRun, getImportRuns } = await import('./imports-api.js')

const fetch = vi.fn()

/**
 * An API answer.
 *
 * @param {object} body The JSON body.
 * @param {number} [status] The status.
 * @returns {Response} The response.
 */
function answer(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  fetch.mockReset()
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the import reads', () => {
  it('asks for a page of runs', async () => {
    fetch.mockResolvedValueOnce(answer({ data: [{ id: 'r1' }], pagination: { total: 1 } }))

    const result = await getImportRuns({ page: 3 })
    const url = new URL(fetch.mock.calls[0][0])

    expect(url.pathname).toBe('/v1/platform/imports')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('perPage')).toBe(String(RUN_PAGE_SIZE))
    expect(result).toEqual({ runs: [{ id: 'r1' }], pagination: { total: 1 } })
  })

  it('reads one run by its encoded id, and says nothing of pictures waiting: none are copied', async () => {
    // An older API's count of pictures waiting is not passed on.
    fetch.mockResolvedValueOnce(answer({ data: { id: 'r1' }, meta: { picturesWaiting: 4 } }))

    expect(await getImportRun('r1/../x')).toEqual({ run: { id: 'r1' } })
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/v1/platform/imports/r1%2F..%2Fx')
  })

  it('throws a refusal as it came', async () => {
    fetch.mockResolvedValueOnce(
      answer({ error: { code: 'FORBIDDEN', message: 'You may not import events.' } }, 403),
    )

    await expect(getImportRun('r1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
})
