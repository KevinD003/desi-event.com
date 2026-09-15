import { describe, expect, it } from 'vitest'

import {
  SAFE_METHODS,
  allowedOriginsFrom,
  checkOrigin,
  clearCookieOptions,
  cookieNames,
  csrfCookieOptions,
  csrfTokenMatches,
  issueCsrfToken,
  requestOrigin,
  sessionCookieOptions,
} from './cookies.js'

const ALLOWED = ['https://desi-event.example', 'https://api.desi-event.example']

describe('cookieNames', () => {
  it('uses the __Host- prefix when the deployment is secure', () => {
    // The prefix is a browser-enforced promise: Secure, Path=/, no Domain —
    // which together stop a compromised sibling subdomain from setting it.
    expect(cookieNames(true)).toEqual({
      session: '__Host-desi_session',
      csrf: '__Host-desi_csrf',
    })
  })

  it('drops the prefix on plain HTTP, where a browser would refuse the cookie', () => {
    expect(cookieNames(false)).toEqual({ session: 'desi_session', csrf: 'desi_csrf' })
  })

  it('gives the session and the CSRF token different names', () => {
    for (const secure of [true, false]) {
      const names = cookieNames(secure)

      expect(names.session).not.toBe(names.csrf)
    }
  })
})

describe('sessionCookieOptions', () => {
  const options = sessionCookieOptions({ secure: true, maxAgeSeconds: 3600 })

  it('is not readable by script', () => {
    expect(options.httpOnly).toBe(true)
  })

  it('is lax rather than strict, so a link from a confirmation email works', () => {
    // Strict would sign the buyer out when they arrive from their own receipt,
    // and they would sign in again — which teaches exactly the wrong reflex.
    expect(options.sameSite).toBe('lax')
  })

  it('sets no domain, so the cookie stays on this host', () => {
    expect(options.domain).toBeUndefined()
    expect(options.path).toBe('/')
  })

  it('carries the secure flag the __Host- prefix requires', () => {
    expect(options.secure).toBe(true)
    expect(sessionCookieOptions({ secure: false, maxAgeSeconds: 1 }).secure).toBe(false)
  })
})

describe('csrfCookieOptions', () => {
  const options = csrfCookieOptions({ secure: true, maxAgeSeconds: 3600 })

  it('is readable by script, which is the whole mechanism', () => {
    // The only cookie in this system that is not httpOnly. It carries no
    // authority of its own: knowing it lets you make a request with your own
    // session, which you could do anyway.
    expect(options.httpOnly).toBe(false)
  })

  it('is strict, because nothing legitimate needs it on a cross-site navigation', () => {
    expect(options.sameSite).toBe('strict')
  })
})

describe('clearCookieOptions', () => {
  it('restates the path, so the browser replaces the cookie rather than adding one', () => {
    expect(clearCookieOptions(true)).toMatchObject({ path: '/', maxAge: 0 })
  })
})

describe('issueCsrfToken', () => {
  it('is 256 bits, url-safe', () => {
    expect(issueCsrfToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 500 }, issueCsrfToken)).size).toBe(500)
  })
})

describe('csrfTokenMatches', () => {
  it('accepts a token echoed exactly', () => {
    const token = issueCsrfToken()

    expect(csrfTokenMatches(token, token)).toBe(true)
  })

  it.each([
    ['a different token', issueCsrfToken(), issueCsrfToken()],
    ['a missing cookie', undefined, 'abc'],
    ['a missing header', 'abc', undefined],
    ['both missing', undefined, undefined],
    ['an empty cookie', '', ''],
    ['a token of a different length', 'abc', 'abcd'],
    ['a non-string', 123, '123'],
  ])('rejects %s', (_label, cookie, header) => {
    expect(csrfTokenMatches(cookie, header)).toBe(false)
  })

  it('rejects a token that matches only in its prefix', () => {
    const token = issueCsrfToken()

    expect(
      csrfTokenMatches(token, `${token.slice(0, -1)}${token.at(-1) === 'a' ? 'b' : 'a'}`),
    ).toBe(false)
  })
})

describe('requestOrigin', () => {
  it('prefers the Origin header', () => {
    expect(
      requestOrigin({ origin: 'https://desi-event.example', referer: 'https://evil.example/x' }),
    ).toEqual({ origin: 'https://desi-event.example', source: 'origin' })
  })

  it('falls back to the origin of the Referer', () => {
    expect(requestOrigin({ referer: 'https://desi-event.example/events/abc?x=1' })).toEqual({
      origin: 'https://desi-event.example',
      source: 'referer',
    })
  })

  it('does not treat the literal string "null" as an origin', () => {
    // Sent for a request from an opaque origin — a sandboxed iframe, a data:
    // document. Treating it as a value would let one through the allow-list if
    // "null" ever appeared in it.
    expect(requestOrigin({ origin: 'null' })).toEqual({ origin: null, source: null })
  })

  it('falls through from a "null" origin to the referer', () => {
    expect(requestOrigin({ origin: 'null', referer: 'https://desi-event.example/x' })).toEqual({
      origin: 'https://desi-event.example',
      source: 'referer',
    })
  })

  it.each([
    ['no headers', {}],
    ['an empty origin', { origin: '' }],
    ['a whitespace origin', { origin: '   ' }],
    ['undefined headers', undefined],
  ])('reports no origin for %s', (_label, headers) => {
    expect(requestOrigin(headers)).toEqual({ origin: null, source: null })
  })

  it('reports no origin for an unparseable referer', () => {
    expect(requestOrigin({ referer: 'not a url' })).toEqual({ origin: null, source: 'referer' })
  })

  it('takes the first value when a header arrives more than once', () => {
    expect(
      requestOrigin({ origin: ['https://desi-event.example', 'https://evil.example'] }),
    ).toMatchObject({ origin: 'https://desi-event.example' })
  })

  it('trims surrounding whitespace', () => {
    expect(requestOrigin({ origin: '  https://desi-event.example  ' }).origin).toBe(
      'https://desi-event.example',
    )
  })
})

describe('checkOrigin', () => {
  it.each([...SAFE_METHODS])('allows %s without looking at the origin', (method) => {
    expect(checkOrigin({ method, headers: { origin: 'https://evil.example' } }, ALLOWED)).toEqual({
      allowed: true,
      reason: null,
      origin: null,
    })
  })

  it('allows a safe method written in lower case', () => {
    expect(checkOrigin({ method: 'get', headers: {} }, ALLOWED).allowed).toBe(true)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('allows %s from an expected origin', (method) => {
    expect(
      checkOrigin({ method, headers: { origin: 'https://desi-event.example' } }, ALLOWED),
    ).toMatchObject({ allowed: true })
  })

  it('refuses a forged POST from another site', () => {
    expect(
      checkOrigin({ method: 'POST', headers: { origin: 'https://evil.example' } }, ALLOWED),
    ).toEqual({ allowed: false, reason: 'origin_not_allowed', origin: 'https://evil.example' })
  })

  it.each([
    ['a look-alike host', 'https://desi-event.example.evil.test'],
    ['a prefix of an allowed host', 'https://desi-event.exampl'],
    ['the right host on http', 'http://desi-event.example'],
    ['the right host on another port', 'https://desi-event.example:8443'],
    ['a subdomain', 'https://www.desi-event.example'],
  ])('refuses %s', (_label, origin) => {
    expect(checkOrigin({ method: 'POST', headers: { origin } }, ALLOWED).allowed).toBe(false)
  })

  it('refuses a cookie-authenticated request that sends no origin at all', () => {
    expect(checkOrigin({ method: 'POST', headers: {} }, ALLOWED)).toEqual({
      allowed: false,
      reason: 'origin_missing',
      origin: null,
    })
  })

  it('allows a bearer-token caller that sends no origin', () => {
    // A server-to-server client sends neither header and is not a CSRF risk,
    // because nothing is attached on its behalf.
    expect(
      checkOrigin({ method: 'POST', headers: {}, cookieAuthenticated: false }, ALLOWED),
    ).toMatchObject({ allowed: true })
  })

  it('still refuses a bearer-token caller that sends a wrong origin', () => {
    expect(
      checkOrigin(
        { method: 'POST', headers: { origin: 'https://evil.example' }, cookieAuthenticated: false },
        ALLOWED,
      ).allowed,
    ).toBe(false)
  })

  it('refuses everything when the allow-list is empty', () => {
    expect(
      checkOrigin({ method: 'POST', headers: { origin: 'https://desi-event.example' } }, [])
        .allowed,
    ).toBe(false)
  })

  it('checks a method it has never heard of, rather than skipping it', () => {
    expect(checkOrigin({ method: 'PURGE', headers: {} }, ALLOWED).allowed).toBe(false)
  })
})

describe('allowedOriginsFrom', () => {
  it('reduces configured URLs to their origins', () => {
    expect(
      allowedOriginsFrom(['https://desi-event.example/events', 'http://127.0.0.1:3000/']),
    ).toEqual(['https://desi-event.example', 'http://127.0.0.1:3000'])
  })

  it('does not repeat an origin', () => {
    expect(
      allowedOriginsFrom(['https://desi-event.example/a', 'https://desi-event.example/b']),
    ).toEqual(['https://desi-event.example'])
  })

  it.each([
    ['a malformed URL', ['not a url']],
    ['an empty string', ['']],
    ['whitespace', ['   ']],
    ['null', [null]],
    ['undefined', [undefined]],
    ['nothing at all', []],
  ])('contributes no origin for %s, rather than widening the allow-list', (_label, urls) => {
    expect(allowedOriginsFrom(urls)).toEqual([])
  })

  it('keeps the port, because a browser sends it', () => {
    expect(allowedOriginsFrom(['https://desi-event.example:8443'])).toEqual([
      'https://desi-event.example:8443',
    ])
  })

  it('drops the default port, because a browser does not send it', () => {
    expect(allowedOriginsFrom(['https://desi-event.example:443'])).toEqual([
      'https://desi-event.example',
    ])
  })
})
