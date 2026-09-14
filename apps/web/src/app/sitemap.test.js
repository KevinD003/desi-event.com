import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-client.js', () => ({
  getApiClient: vi.fn(),
}))

const { getApiClient } = await import('../lib/api-client.js')
const { default: sitemap } = await import('./sitemap.js')

/**
 * A client whose listing endpoint answers with the given pages in order.
 *
 * @param {object[][]} pages Each page's `data` array.
 * @returns {object} A stub API client, with `list` recording its arguments.
 */
function clientReturning(pages) {
  const list = vi.fn(async ({ page }) => ({
    data: pages[page - 1] ?? [],
    pagination: { hasNextPage: page < pages.length },
  }))

  return { events: { list } }
}

describe('the sitemap', () => {
  beforeEach(() => {
    getApiClient.mockReset()
  })

  it('always lists the routes that exist regardless of the catalogue', async () => {
    getApiClient.mockReturnValue(clientReturning([[]]))

    const entries = await sitemap()

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(['/', '/events'])
  })

  it('asks the API for published events only', async () => {
    const client = clientReturning([[{ slug: 'one' }]])
    getApiClient.mockReturnValue(client)

    await sitemap()

    expect(client.events.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLISHED' }),
      expect.anything(),
    )
  })

  it('walks every page of the catalogue', async () => {
    getApiClient.mockReturnValue(clientReturning([[{ slug: 'one' }], [{ slug: 'two' }]]))

    const entries = await sitemap()

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual([
      '/',
      '/events',
      '/events/one',
      '/events/two',
    ])
  })

  it('never advertises a checkout step', async () => {
    getApiClient.mockReturnValue(clientReturning([[{ slug: 'one' }]]))

    const entries = await sitemap()

    expect(entries.some((entry) => entry.url.includes('/checkout'))).toBe(false)
  })

  it('omits event URLs entirely when the API cannot be reached', async () => {
    // The rest of the site answers a dead API with the sample catalogue so a
    // visitor still sees a page. A sitemap built that way would be publishing
    // URLs that do not exist, so this one lists nothing it could not confirm.
    getApiClient.mockReturnValue({
      events: {
        list: vi.fn(async () => {
          throw new Error('fetch failed')
        }),
      },
    })

    const entries = await sitemap()

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(['/', '/events'])
  })

  it('skips a row with no slug rather than emitting a broken URL', async () => {
    getApiClient.mockReturnValue(clientReturning([[{ slug: 'one' }, {}, { slug: null }]]))

    const entries = await sitemap()

    expect(entries).toHaveLength(3)
  })
})
