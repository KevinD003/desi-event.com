import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-client.js', () => ({
  getApiClient: vi.fn(),
}))

const { getApiClient } = await import('../lib/api-client.js')
const { default: sitemap } = await import('./sitemap.js')

/** The routes listed whatever the catalogue holds, in the order they are listed. */
const STATIC = ['/', '/events', '/categories', '/venues', '/organizers', '/limitations']

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

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(STATIC)
  })

  it("asks for the server's public set rather than naming one status", async () => {
    // It used to send `status: 'PUBLISHED'`, which is a literal standing in for
    // a set — the same shape as finding NF-19. Anonymous callers already get
    // exactly the indexable statuses, so naming one here could only ever
    // narrow that and lose events nobody meant to hide.
    const client = clientReturning([[{ slug: 'one', status: 'PUBLISHED' }]])
    getApiClient.mockReturnValue(client)

    await sitemap()

    const [query] = client.events.list.mock.calls[0]

    expect(query).not.toHaveProperty('status')
  })

  it('lists an event that has opened sales, which the old filter dropped', async () => {
    // The regression the filter caused: an event anybody could actually buy a
    // ticket to is `ON_SALE`, not `PUBLISHED`, so every sellable event in the
    // catalogue was missing from the sitemap.
    getApiClient.mockReturnValue(
      clientReturning([
        [
          { slug: 'on-sale', status: 'ON_SALE' },
          { slug: 'paused', status: 'SALES_PAUSED' },
          { slug: 'gone', status: 'SOLD_OUT' },
        ],
      ]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths).toEqual([...STATIC, '/events/on-sale', '/events/paused', '/events/gone'])
  })

  it('omits a finished, postponed or cancelled event: a sitemap says what is on', async () => {
    // Their pages still resolve — somebody holding a ticket needs them — but a
    // sitemap is an answer to "what is on", and these are not on.
    getApiClient.mockReturnValue(
      clientReturning([
        [
          { slug: 'live', status: 'ON_SALE' },
          { slug: 'done', status: 'COMPLETED' },
          { slug: 'moved', status: 'POSTPONED' },
          { slug: 'off', status: 'CANCELLED' },
        ],
      ]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths).toEqual([...STATIC, '/events/live'])
  })

  it('omits a private event even if the API hands one back', async () => {
    // Defence in depth. The client is anonymous, so the API should never send
    // these. If a token leaks into the server-side client, or the listing
    // endpoint's default widens, the sitemap must not be what publishes an
    // organiser's unannounced event to a crawler.
    getApiClient.mockReturnValue(
      clientReturning([
        [
          { slug: 'live', status: 'ON_SALE', organizationSlug: 'real' },
          { slug: 'secret', status: 'DRAFT', organizationSlug: 'leaky' },
          { slug: 'waiting', status: 'REVIEW_PENDING', organizationSlug: 'leaky' },
          { slug: 'rework', status: 'CHANGES_REQUIRED', organizationSlug: 'leaky' },
          { slug: 'greenlit', status: 'APPROVED', organizationSlug: 'leaky' },
          { slug: 'refused', status: 'REJECTED', organizationSlug: 'leaky' },
          { slug: 'shelved', status: 'ARCHIVED', organizationSlug: 'leaky' },
        ],
      ]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths).toEqual([...STATIC, '/events/live', '/organizers/real'])
  })

  it('omits an event with no status at all rather than assuming it is public', async () => {
    getApiClient.mockReturnValue(
      clientReturning([[{ slug: 'one' }, { slug: 'two', status: null }]]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths).toEqual(STATIC)
  })

  it('lists an organiser page once, however many events they have', async () => {
    getApiClient.mockReturnValue(
      clientReturning([
        [
          { slug: 'one', status: 'PUBLISHED', organizationSlug: 'rangmanch-collective' },
          { slug: 'two', status: 'ON_SALE', organizationSlug: 'rangmanch-collective' },
          { slug: 'three', status: 'SOLD_OUT', organizationSlug: 'navrang-utsav-samiti' },
        ],
      ]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths.filter((path) => path.startsWith('/organizers/'))).toEqual([
      '/organizers/rangmanch-collective',
      '/organizers/navrang-utsav-samiti',
    ])
  })

  it('lists a venue page once, however many events are on there', async () => {
    getApiClient.mockReturnValue(
      clientReturning([
        [
          { slug: 'one', status: 'PUBLISHED', venueSlug: 'jio-world-garden' },
          { slug: 'two', status: 'ON_SALE', venueSlug: 'jio-world-garden' },
          { slug: 'three', status: 'SALES_PAUSED', venueSlug: 'nehru-centre' },
        ],
      ]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths.filter((path) => path.startsWith('/venues/'))).toEqual([
      '/venues/jio-world-garden',
      '/venues/nehru-centre',
    ])
  })

  it('omits an organiser whose events carry no slug rather than guessing one', async () => {
    getApiClient.mockReturnValue(
      clientReturning([[{ slug: 'one', status: 'PUBLISHED', organizationName: 'Someone' }]]),
    )

    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths.some((path) => path.startsWith('/organizers/'))).toBe(false)
  })

  it('walks every page of the catalogue', async () => {
    getApiClient.mockReturnValue(
      clientReturning([
        [{ slug: 'one', status: 'PUBLISHED' }],
        [{ slug: 'two', status: 'PUBLISHED' }],
      ]),
    )

    const entries = await sitemap()

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual([
      ...STATIC,
      '/events/one',
      '/events/two',
    ])
  })

  it('never advertises a checkout step', async () => {
    getApiClient.mockReturnValue(clientReturning([[{ slug: 'one', status: 'PUBLISHED' }]]))

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

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(STATIC)
  })

  it('skips a row with no slug rather than emitting a broken URL', async () => {
    getApiClient.mockReturnValue(
      clientReturning([
        [{ slug: 'one', status: 'PUBLISHED' }, {}, { slug: null, status: 'PUBLISHED' }],
      ]),
    )

    const entries = await sitemap()

    expect(entries).toHaveLength(STATIC.length + 1)
  })
})
