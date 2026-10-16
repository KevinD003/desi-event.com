import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REQUEST_PATH_HEADER } from './lib/request-path-header.js'
import { BAD_ADDRESS_PATH, config, isMalformedPath, proxy } from './proxy.js'

/**
 * The request headers a proxied response forwards to the render.
 *
 * `NextResponse.next({ request: { headers } })` carries them as
 * `x-middleware-request-<name>` response headers, which is how Next.js hands
 * them to the route; reading them back is reading what a layout will see.
 *
 * @param {Response} response The proxy's response.
 * @param {string} name The request header.
 * @returns {string|null} Its forwarded value.
 */
function forwarded(response, name) {
  return response.headers.get(`x-middleware-request-${name}`)
}

describe('proxy', () => {
  it('hands the layouts the path and query of the page being rendered', () => {
    const response = proxy(new NextRequest('http://localhost:3000/tickets/abc?tab=pass'))

    expect(forwarded(response, REQUEST_PATH_HEADER)).toBe('/tickets/abc?tab=pass')
  })

  it('overwrites a value a browser sent under the same name', () => {
    const request = new NextRequest('http://localhost:3000/finance', {
      headers: { [REQUEST_PATH_HEADER]: '//evil.example/phish' },
    })

    expect(forwarded(proxy(request), REQUEST_PATH_HEADER)).toBe('/finance')
  })

  it('leaves every other request header alone', () => {
    const request = new NextRequest('http://localhost:3000/', { headers: { cookie: 'a=b' } })

    expect(forwarded(proxy(request), 'cookie')).toBe('a=b')
  })

  it('does not run on the API proxy, built assets or files', () => {
    const [pattern] = config.matcher
    const matches = (pathname) => new RegExp(`^${pattern}$`).test(pathname)

    expect(matches('/tickets')).toBe(true)
    expect(matches('/')).toBe(true)
    expect(matches('/events/garba-night/checkout')).toBe(true)
    expect(matches('/api/v1/auth/me')).toBe(false)
    expect(matches('/_next/static/chunks/app.js')).toBe(false)
    expect(matches('/_next/image')).toBe(false)
    expect(matches('/sitemap.xml')).toBe(false)
    expect(matches('/manifest.webmanifest')).toBe(false)
  })

  it('never runs on a picture upload or read, whose bodies it would cap below the upload limit', () => {
    // The proxy's own request-body limit is below 10 MiB, so a picture upload
    // passing through it would be cut short. Pictures travel through the API
    // route and the image optimiser, and this pins that neither is matched.
    const [pattern] = config.matcher
    const matches = (pathname) => new RegExp(`^${pattern}$`).test(pathname)

    expect(matches('/api/v1/events/cevent000000000000000001/media')).toBe(false)
    expect(matches('/api/v1/events/cevent000000000000000001/media/order')).toBe(false)
    expect(matches('/api/v1/media/cmedia000000000000000001')).toBe(false)
    expect(matches('/_next/image')).toBe(false)
    expect(matches('/events/garba-night/opengraph-image/cover-cmedia000000000000000001')).toBe(true)
  })
})

describe('an address that cannot be read', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is one whose percent-escapes do not decode, and nothing else', () => {
    expect(isMalformedPath('/events/%E0%A4%A')).toBe(true)
    expect(isMalformedPath('/events/%')).toBe(true)
    expect(isMalformedPath('/events/%E0%A4%85')).toBe(false)
    expect(isMalformedPath('/events/bay-lights-garba-opening')).toBe(false)
  })

  it('is answered with the site’s own page for it, as a 400, carrying the visitor’s cookies only to this site', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('<!DOCTYPE html><h1>That address could not be read</h1>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    )

    vi.stubGlobal('fetch', fetch)

    const response = await proxy(
      new NextRequest('http://localhost:3000/events/%E0%A4%A?x=1', {
        headers: { cookie: 'desi_session=abc' },
      }),
    )
    const [target, init] = fetch.mock.calls[0]

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('That address could not be read')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(String(target)).toBe(`http://localhost:3000${BAD_ADDRESS_PATH}`)
    expect(init.headers.cookie).toBe('desi_session=abc')
  })

  it('still reaches that page, by a rewrite, if rendering it for the 400 fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused')
      }),
    )

    const response = await proxy(new NextRequest('http://localhost:3000/venues/%E0%A4%A'))

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `http://localhost:3000${BAD_ADDRESS_PATH}`,
    )
    expect(forwarded(response, REQUEST_PATH_HEADER)).toBe(BAD_ADDRESS_PATH)
  })
})
