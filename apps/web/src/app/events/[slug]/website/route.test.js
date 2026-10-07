/**
 * The tracked redirect behind "Visit the organiser's website".
 *
 * What is pinned: the destination only ever comes from the API's answer, and
 * only after it passes the address rules here too; every refusal is the same
 * page; a prefetch, a HEAD or a request for an image never reaches the API;
 * only a real top-level navigation is counted; no cookie leaves this server.
 *
 * @module app/events/slug/website/route.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { GET, HEAD, PAGES, PAGE_STYLE } = await import('./route.js')

const SLUG = 'navratri-garba-night'
const SITE = 'https://rangoli.example/nights'

/** What a browser sends for a click on the event page. */
const CLICK = Object.freeze({
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36',
})

/**
 * A request for the redirect.
 *
 * @param {object} [options] Options.
 * @param {object} [options.headers] Request headers.
 * @param {string} [options.query] A query string, with its `?`.
 * @param {string} [options.slug] The slug in the path.
 * @returns {Array} The handler's arguments.
 */
function follow({ headers = CLICK, query = '', slug = SLUG } = {}) {
  return [
    new Request(`https://desi-event.test/events/${slug}/website${query}`, { headers }),
    { params: Promise.resolve({ slug }) },
  ]
}

/**
 * The API's answer.
 *
 * @param {object|null} body The JSON body.
 * @param {object} [init] Status and headers.
 * @returns {Response} The response.
 */
function api(body, init = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /events/{slug}/website', () => {
  it('answers a click with a 302 to the address the API gave, never stored or indexed', async () => {
    fetchMock.mockResolvedValue(api({ data: { url: SITE } }))

    const response = await GET(...follow())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SITE)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('asks the API with the slug and the count only, and forwards no cookie', async () => {
    fetchMock.mockResolvedValue(api({ data: { url: SITE } }))

    await GET(
      ...follow({
        headers: {
          ...CLICK,
          cookie: '__Host-desi_session=secret',
          authorization: 'Bearer secret',
          'x-forwarded-for': '203.0.113.9',
          'x-desi-client-address': '198.51.100.1',
        },
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    const sent = new Headers(init.headers)

    expect(url).toMatch(/\/v1\/traffic\/website-visits$/u)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(init.body)).toEqual({ slug: SLUG, counted: true })
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
    // The address the web tier worked out, never the one the browser claimed.
    expect(sent.get('x-desi-client-address')).toBe('203.0.113.9')
    expect([...sent.keys()].sort()).toEqual(
      ['accept', 'content-type', 'user-agent', 'x-desi-client-address'].sort(),
    )
  })

  it('ignores any destination in the query', async () => {
    fetchMock.mockResolvedValue(api({ data: { url: SITE } }))

    const response = await GET(
      ...follow({ query: '?to=https://evil.example/&url=https://evil.example/' }),
    )

    expect(response.headers.get('location')).toBe(SITE)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ slug: SLUG, counted: true })
  })

  it.each([
    ['an http address', 'http://rangoli.example/'],
    ['a script', 'javascript:alert(1)'],
    ['a credential in it', 'https://rangoli.example/?token=x'],
    ['an address on Desi-Event', 'https://desi-event.com/'],
    ['no string at all', 42],
  ])('never redirects to %s from the API: the unavailable page instead', async (_name, url) => {
    fetchMock.mockResolvedValue(api({ data: { url } }))

    const response = await GET(...follow())

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain(PAGES.unavailable.body)
  })

  it('shows the same 404 page when the API knows no link, with a way back', async () => {
    fetchMock.mockResolvedValue(api({ error: { code: 'NOT_FOUND' } }, { status: 404 }))

    const response = await GET(...follow())
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<h1>This website link is not available</h1>')
    expect(html).toContain(`<a href="/events/${SLUG}">Back to the event</a>`)
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toContain('<script')
  })

  it('draws each way back as a target big and far enough apart to tap, in no colour of its own', async () => {
    fetchMock.mockResolvedValue(api({ error: { code: 'NOT_FOUND' } }, { status: 404 }))

    const html = await (await GET(...follow())).text()
    const style = html.match(/<style>([^<]*)<\/style>/u)?.[1] ?? null

    // Unstyled, the two links were 17px high and 16px apart: under the 24px
    // WCAG 2.2 asks of a target (2.5.8), which a browser sweep found.
    expect(style).toBe(PAGE_STYLE)
    expect(style).toMatch(/a\{display:inline-block;min-height:2\.75rem;/u)
    expect(style).toMatch(/li\{margin:0 0 0\.75rem\}/u)
    // The reader's colours stand: nothing here sets one.
    expect(style).not.toMatch(/color|background/u)
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'))
  })

  it('answers an invalid slug with the 404 page and asks nothing', async () => {
    for (const slug of ['Not-A-Slug', '../admin', 'a'.repeat(141), 'x%0d%0a']) {
      const response = await GET(...follow({ slug }))

      expect(response.status, slug).toBe(404)
      expect(await response.text(), slug).not.toContain('Back to the event')
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a prefetch or prerender with 503 and asks nothing', async () => {
    for (const headers of [
      { ...CLICK, 'sec-purpose': 'prefetch' },
      { ...CLICK, 'sec-purpose': 'prefetch;prerender' },
      { ...CLICK, purpose: 'prefetch' },
      { ...CLICK, 'next-router-prefetch': '1' },
    ]) {
      const response = await GET(...follow({ headers }))

      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves only a top-level page: an image or a fetch aimed here gets the 404 page, unasked', async () => {
    for (const dest of ['image', 'iframe', 'empty', 'script']) {
      const response = await GET(...follow({ headers: { ...CLICK, 'sec-fetch-dest': dest } }))

      expect(response.status, dest).toBe(404)
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts only a navigation the browser vouches for, and count=no only reduces', async () => {
    fetchMock.mockImplementation(async () => api({ data: { url: SITE } }))

    const cases = [
      [CLICK, '', true],
      [{ ...CLICK, 'sec-fetch-site': 'none' }, '', true],
      [{ ...CLICK, 'sec-fetch-site': 'cross-site' }, '', false],
      [{ ...CLICK, 'sec-fetch-site': 'same-site' }, '', false],
      [{ ...CLICK, 'sec-fetch-mode': 'no-cors' }, '', false],
      // No fetch metadata at all: served, never counted.
      [{ 'user-agent': CLICK['user-agent'] }, '', false],
      [CLICK, '?count=no', false],
      [{ 'user-agent': CLICK['user-agent'] }, '?count=yes', false],
    ]

    for (const [headers, query, expected] of cases) {
      fetchMock.mockClear()

      const response = await GET(...follow({ headers, query }))

      expect(response.status).toBe(302)
      expect(
        JSON.parse(fetchMock.mock.calls[0][1].body).counted,
        `${JSON.stringify(headers)} ${query}`,
      ).toBe(expected)
    }
  })

  it('shows the unavailable page, never "too many visits", when the API is busy or down', async () => {
    fetchMock.mockResolvedValueOnce(
      api({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'retry-after': '42' } }),
    )

    const limited = await GET(...follow())
    const html = await limited.text()

    expect(limited.status).toBe(503)
    expect(limited.headers.get('retry-after')).toBe('42')
    expect(html).toContain('<h1>Website link unavailable</h1>')
    expect(html).toContain(
      'Desi-Event could not look up where this link goes just now. Try again from the event page in a minute.',
    )
    expect(html).not.toMatch(/too many/iu)

    fetchMock.mockResolvedValueOnce(api(null, { status: 500 }))
    expect((await GET(...follow())).status).toBe(503)

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect((await GET(...follow())).status).toBe(503)

    fetchMock.mockResolvedValueOnce(
      api(null, { status: 503, headers: { 'retry-after': 'Tue, 1 Jan 2030 00:00:00 GMT' } }),
    )

    // Only whole seconds are passed on.
    expect((await GET(...follow())).headers.get('retry-after')).toBeNull()
  })
})

describe('HEAD /events/{slug}/website', () => {
  it('is 405, so a link checker runs no lookup', async () => {
    const response = HEAD()

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
