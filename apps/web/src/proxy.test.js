import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { REQUEST_PATH_HEADER } from './lib/request-path-header.js'
import { config, proxy } from './proxy.js'

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
})
