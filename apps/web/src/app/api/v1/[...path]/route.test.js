/**
 * The same-origin proxy forwards the browser's request and the API's answer,
 * and keeps the session's bearer secret out of page JavaScript.
 *
 * The properties worth pinning: a sign-in's `token` — the same secret the
 * HttpOnly cookie carries — never reaches the page, while the cookies that set
 * the session do; nothing else a response says is changed; and a request adds
 * no authority of its own.
 *
 * @module app/api/v1/path/route.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  POST,
  GET,
  PROXY_BODY_LIMIT_BYTES,
  SERVER_ONLY_API_PATHS,
  checkoutAddress,
  isBeacon,
  isCheckout,
  isServerOnlyPath,
  readBoundedBody,
  withoutBearerSecret,
} = await import('./route.js')
const { resetForwardingWarnings } = await import('../../../../lib/traffic-forwarding.js')

/** A cookie the API sets alongside a sign-in's answer. */
const SESSION_COOKIE = '__Host-desi_session=opaque-secret-value; Path=/; HttpOnly; Secure'

/**
 * The route context Next hands a catch-all route.
 *
 * @param {string[]} path The segments.
 * @returns {object} The context.
 */
function context(path) {
  return { params: Promise.resolve({ path }) }
}

/**
 * An upstream answer.
 *
 * @param {object} body The JSON body.
 * @param {object} [init] Status and headers.
 * @returns {Response} The response.
 */
function upstream(body, init = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })

  for (const cookie of init.cookies ?? []) headers.append('set-cookie', cookie)

  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the API proxy', () => {
  it('takes the bearer secret out of a sign-in’s answer, and keeps the cookie that sets the session', async () => {
    fetchMock.mockResolvedValue(
      upstream(
        {
          token: 'the-session-secret',
          tokenType: 'Bearer',
          csrfToken: 'csrf-value',
          user: { id: 'u1', displayName: 'Meera' },
          mfaRequired: false,
        },
        { cookies: [SESSION_COOKIE] },
      ),
    )

    const response = await POST(
      new Request('http://web.test/api/v1/auth/login', { method: 'POST', body: '{}' }),
      context(['auth', 'login']),
    )
    const text = await response.text()

    expect(text).not.toContain('the-session-secret')
    expect(JSON.parse(text)).toEqual({
      tokenType: 'Bearer',
      csrfToken: 'csrf-value',
      user: { id: 'u1', displayName: 'Meera' },
      mfaRequired: false,
    })
    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE])
    expect(response.status).toBe(200)
  })

  it('does the same for account creation, which also signs the new account in', async () => {
    fetchMock.mockResolvedValue(upstream({ token: 'new-account-secret', tokenType: 'Bearer' }))

    const response = await POST(
      new Request('http://web.test/api/v1/auth/register', { method: 'POST', body: '{}' }),
      context(['auth', 'register']),
    )

    expect(await response.text()).not.toContain('new-account-secret')
  })

  it('leaves every other answer exactly as the API sent it', async () => {
    const body = { data: [{ id: 'e1', token: 'not-a-session-field-here' }] }

    fetchMock.mockResolvedValue(upstream(body))

    const response = await GET(new Request('http://web.test/api/v1/events'), context(['events']))

    expect(await response.json()).toEqual(body)
  })

  it('passes a refusal from an auth route through unchanged', async () => {
    const body = { error: { code: 'UNAUTHORIZED', message: 'Invalid email address or password.' } }

    fetchMock.mockResolvedValue(upstream(body, { status: 401 }))

    const response = await POST(
      new Request('http://web.test/api/v1/auth/login', { method: 'POST', body: '{}' }),
      context(['auth', 'login']),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(body)
  })

  it('forwards the caller’s cookie and adds no credential of its own', async () => {
    fetchMock.mockResolvedValue(upstream({ ok: true }))

    await GET(
      new Request('http://web.test/api/v1/auth/me', { headers: { cookie: 'a=b' } }),
      context(['auth', 'me']),
    )

    const [, init] = fetchMock.mock.calls[0]

    expect(init.headers.get('cookie')).toBe('a=b')
    expect(init.headers.get('authorization')).toBeNull()
  })

  it('keeps both no-cache headers on an answer that carries a code shown once', async () => {
    // The 201 that mints an invitation code says `no-store, private` and
    // `pragma: no-cache`; the browser must receive both, not just the first.
    const body = {
      data: { id: 'inv1', delivery: { mode: 'MANUAL', invitationCode: 'c'.repeat(43) } },
    }
    const answer = upstream(body, { status: 201 })

    answer.headers.set('cache-control', 'no-store, private')
    answer.headers.set('pragma', 'no-cache')
    fetchMock.mockResolvedValue(answer)

    const response = await POST(
      new Request('http://web.test/api/v1/organizations/org1/invitations', {
        method: 'POST',
        body: '{}',
      }),
      context(['organizations', 'org1', 'invitations']),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })
})

describe('pictures through the proxy', () => {
  /** A PNG's first bytes and some more, none of them text. */
  const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128, 7])

  it('forwards an upload’s bytes exactly, with the type it declared', async () => {
    fetchMock.mockResolvedValue(upstream({ data: {} }, { status: 201 }))

    await POST(
      new Request(
        'http://web.test/api/v1/events/e1/media?kind=EVENT_COVER&altText=Stage&revision=0',
        {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: PICTURE,
        },
      ),
      context(['events', 'e1', 'media']),
    )

    const [target, init] = fetchMock.mock.calls[0]

    expect(target).toMatch(/\/v1\/events\/e1\/media\?kind=EVENT_COVER&altText=Stage&revision=0$/u)
    expect(init.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(init.body)]).toEqual([...PICTURE])
  })

  it('passes a picture back byte for byte, with every header that keeps it an image', async () => {
    fetchMock.mockResolvedValue(
      new Response(PICTURE, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(PICTURE.length),
          etag: '"sha256-abc"',
          'cache-control': 'public, max-age=86400',
          'content-disposition': 'inline; filename="m1.png"',
          'content-security-policy': "default-src 'none'; sandbox",
          'last-modified': 'Mon, 28 Sep 2026 10:00:00 GMT',
          'x-powered-by': 'nothing that should pass',
        },
      }),
    )

    const response = await GET(
      new Request('http://web.test/api/v1/media/m1'),
      context(['media', 'm1']),
    )

    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PICTURE])
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('etag')).toBe('"sha256-abc"')
    expect(response.headers.get('content-length')).toBe(String(PICTURE.length))
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="m1.png"')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('last-modified')).toBe('Mon, 28 Sep 2026 10:00:00 GMT')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-powered-by')).toBeNull()
  })

  it('says nosniff on a picture refusal too, and forwards no media headers elsewhere', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
        status: 404,
        headers: { 'content-type': 'application/json', etag: '"x"', 'cache-control': 'no-store' },
      }),
    )

    const refused = await GET(
      new Request('http://web.test/api/v1/media/m1'),
      context(['media', 'm1']),
    )

    expect(refused.status).toBe(404)
    expect(refused.headers.get('x-content-type-options')).toBe('nosniff')
    expect(refused.headers.get('cache-control')).toBe('no-store')

    fetchMock.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json', etag: '"y"' } }),
    )

    const other = await GET(new Request('http://web.test/api/v1/events'), context(['events']))

    expect(other.headers.get('etag')).toBeNull()
  })

  it('forwards If-None-Match, and passes a 304 on with no body', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"sha256-abc"' } }),
    )

    const response = await GET(
      new Request('http://web.test/api/v1/media/m1', {
        headers: { 'if-none-match': '"sha256-abc"' },
      }),
      context(['media', 'm1']),
    )

    const [, init] = fetchMock.mock.calls[0]

    expect(init.headers.get('if-none-match')).toBe('"sha256-abc"')
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get('etag')).toBe('"sha256-abc"')
  })

  it('refuses a body declared over the limit with 413, before the API is asked', async () => {
    const response = await POST(
      new Request('http://web.test/api/v1/events/e1/media', {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'content-length': String(PROXY_BODY_LIMIT_BYTES + 1),
        },
        body: PICTURE,
      }),
      context(['events', 'e1', 'media']),
    )

    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a body that turns out over the limit, and stops reading it', async () => {
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1

        if (pulled > 64) {
          controller.close()
          return
        }

        controller.enqueue(chunk)
      },
    })

    const response = await POST(
      new Request('http://web.test/api/v1/events/e1/media', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: stream,
        duplex: 'half',
      }),
      context(['events', 'e1', 'media']),
    )

    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
    // Eleven megabytes is where it stopped, not sixty-four.
    expect(pulled).toBeLessThan(16)
  })

  it('caps the buffer at one picture plus a little', () => {
    expect(PROXY_BODY_LIMIT_BYTES).toBe(10 * 1024 * 1024 + 64 * 1024)
  })

  it('reads an absent body as absent, and a small one whole', async () => {
    expect(await readBoundedBody(new Request('http://web.test/x', { method: 'POST' }), 10)).toBe(
      undefined,
    )

    const read = await readBoundedBody(
      new Request('http://web.test/x', { method: 'POST', body: 'hello' }),
      10,
    )

    expect(new TextDecoder().decode(read)).toBe('hello')
  })
})

describe('withoutBearerSecret', () => {
  it('leaves a body that is not JSON alone', async () => {
    const response = new Response('id,total\n1,100', { headers: { 'content-type': 'text/csv' } })

    expect(await withoutBearerSecret(response, ['auth', 'export'])).toBe(response.body)
  })
})

describe('visits through the proxy', () => {
  /** Everything a signed-in browser would attach to a request. */
  const SIGNED_IN = {
    cookie: '__Host-desi_session=opaque-secret-value; desi_csrf=csrf-value',
    authorization: 'Bearer leaked-bearer-secret',
    'x-desi-csrf': 'csrf-value',
    'idempotency-key': 'k-123',
    'if-none-match': '"etag"',
    'user-agent': 'Mozilla/5.0 Chrome/130',
    'x-forwarded-for': '198.51.100.7',
    'sec-gpc': '1',
    dnt: '1',
  }

  /**
   * A beacon as a browser on this site sends it.
   *
   * @param {object} [headers] Request headers.
   * @returns {Request} The request.
   */
  function beaconRequest(headers = SIGNED_IN) {
    return new Request('http://web.test/api/v1/traffic/beacons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        eventId: 'cevent0000000001',
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
      }),
    })
  }

  it('forwards a beacon with no session, and with the visitor’s address and privacy signals', async () => {
    fetchMock.mockResolvedValue(upstream({ data: { accepted: true } }, { status: 202 }))

    const response = await POST(beaconRequest(), context(['traffic', 'beacons']))
    const [target, init] = fetchMock.mock.calls[0]

    expect(response.status).toBe(202)
    expect(target).toMatch(/\/v1\/traffic\/beacons$/u)

    for (const name of [
      'cookie',
      'authorization',
      'x-desi-csrf',
      'idempotency-key',
      'if-none-match',
    ]) {
      expect(init.headers.get(name), name).toBeNull()
    }

    expect(init.headers.get('x-desi-client-address')).toBe('198.51.100.7')
    expect(init.headers.get('sec-gpc')).toBe('1')
    expect(init.headers.get('dnt')).toBe('1')
    expect(init.headers.get('user-agent')).toBe('Mozilla/5.0 Chrome/130')
    expect(init.headers.get('referer')).toBeNull()
  })

  it('hands the API an overlong agent still over 512 characters, so it is not counted', async () => {
    fetchMock.mockResolvedValue(upstream({ data: { accepted: true } }, { status: 202 }))

    const response = await POST(
      beaconRequest({ ...SIGNED_IN, 'user-agent': `Mozilla/5.0 ${'x'.repeat(600)}` }),
      context(['traffic', 'beacons']),
    )
    const forwarded = fetchMock.mock.calls[0][1].headers.get('user-agent')

    expect(response.status).toBe(202)
    // The API refuses an agent over 512 characters as a robot's; one cut to
    // exactly 512 would be counted as a visitor.
    expect(forwarded.length).toBeGreaterThan(512)
    expect(forwarded.length).toBeLessThanOrEqual(513)
  })

  it('never lets a beacon set a cookie', async () => {
    fetchMock.mockResolvedValue(
      upstream({ data: { accepted: true } }, { status: 202, cookies: [SESSION_COOKIE] }),
    )

    const response = await POST(beaconRequest(), context(['traffic', 'beacons']))

    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('replaces an address the browser claims for itself with the one this server read', async () => {
    fetchMock.mockResolvedValue(upstream({ data: { accepted: true } }, { status: 202 }))

    await POST(
      beaconRequest({ ...SIGNED_IN, 'x-desi-client-address': '203.0.113.250' }),
      context(['traffic', 'beacons']),
    )
    await POST(
      beaconRequest({ 'x-desi-client-address': '203.0.113.250', 'user-agent': 'Mozilla/5.0' }),
      context(['traffic', 'beacons']),
    )

    expect(fetchMock.mock.calls[0][1].headers.get('x-desi-client-address')).toBe('198.51.100.7')
    // No forwarded-for at all: no address, rather than the browser's claim.
    expect(fetchMock.mock.calls[1][1].headers.get('x-desi-client-address')).toBeNull()
  })

  it('never forwards a browser-supplied visitor address, or the privacy signals, on any other path', async () => {
    fetchMock.mockResolvedValue(upstream({ ok: true }))

    await GET(
      new Request('http://web.test/api/v1/events', {
        headers: { 'x-desi-client-address': '203.0.113.250', 'sec-gpc': '1', dnt: '1' },
      }),
      context(['events']),
    )

    const [, init] = fetchMock.mock.calls[0]

    expect(init.headers.get('x-desi-client-address')).toBeNull()
    expect(init.headers.get('sec-gpc')).toBeNull()
  })

  it('forwards the platform’s list of every event’s visits as the session route it is', async () => {
    fetchMock.mockResolvedValue(upstream({ data: { events: [] } }, { cookies: [SESSION_COOKIE] }))

    const response = await GET(
      new Request('http://web.test/api/v1/traffic/events?scope=all', {
        headers: { cookie: 'a=b', 'x-forwarded-for': '198.51.100.7' },
      }),
      context(['traffic', 'events']),
    )
    const [target, init] = fetchMock.mock.calls[0]

    expect(target).toMatch(/\/v1\/traffic\/events\?scope=all$/u)
    expect(init.headers.get('cookie')).toBe('a=b')
    expect(init.headers.get('x-desi-client-address')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE])
  })

  it('treats a beacon sent with the wrong method as an ordinary request, adding nothing', async () => {
    fetchMock.mockResolvedValue(upstream({ error: { code: 'NOT_FOUND' } }, { status: 404 }))

    await GET(
      new Request('http://web.test/api/v1/traffic/beacons', { headers: SIGNED_IN }),
      context(['traffic', 'beacons']),
    )

    expect(fetchMock.mock.calls[0][1].headers.get('x-desi-client-address')).toBeNull()
  })

  it.each([
    ['POST', ['traffic', 'website-visits']],
    ['GET', ['traffic', 'website-visits']],
    ['POST', ['traffic', 'website-visits', 'extra']],
  ])('refuses %s %j with a 404 and never asks the API', async (method, path) => {
    const handler = method === 'POST' ? POST : GET
    const response = await handler(
      new Request(`http://web.test/api/v1/${path.join('/')}`, {
        method,
        ...(method === 'POST' ? { body: '{"slug":"x","counted":true}' } : {}),
      }),
      context(path),
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('checkouts through the proxy', () => {
  /** A signed-in browser's checkout request headers. */
  const CHECKOUT = {
    'content-type': 'application/json',
    cookie: '__Host-desi_session=opaque-secret-value; desi_csrf=csrf-value',
    'x-desi-csrf': 'csrf-value',
    'idempotency-key': 'k-123',
    'user-agent': 'Mozilla/5.0 Chrome/130',
    'x-forwarded-for': '198.51.100.7',
    'sec-gpc': '1',
    dnt: '1',
  }

  /**
   * A checkout request as the browser sends it.
   *
   * @param {string[]} path The proxied path.
   * @param {object} [headers] Request headers.
   * @returns {Request} The request.
   */
  function checkoutRequest(path, headers = CHECKOUT) {
    return new Request(`http://web.test/api/v1/${path.join('/')}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: 'cevent0000000001', items: [] }),
    })
  }

  it.each([[['orders', 'quote']], [['orders']]])(
    'forwards %j with its session and the visitor’s address as this server read it',
    async (path) => {
      fetchMock.mockResolvedValue(upstream({ data: {} }))

      await POST(checkoutRequest(path), context(path))

      const [target, init] = fetchMock.mock.calls[0]

      expect(target).toMatch(new RegExp(`/v1/${path.join('/')}$`, 'u'))
      // The session travels as on any request: a checkout is the buyer's.
      expect(init.headers.get('cookie')).toBe(CHECKOUT.cookie)
      expect(init.headers.get('x-desi-csrf')).toBe('csrf-value')
      expect(init.headers.get('idempotency-key')).toBe('k-123')
      expect(init.headers.get('x-desi-client-address')).toBe('198.51.100.7')
      // Nothing else a beacon carries: the privacy signals are a visit's.
      expect(init.headers.get('sec-gpc')).toBeNull()
      expect(init.headers.get('dnt')).toBeNull()
    },
  )

  it('replaces an address the browser claims with the one this server read, or sends none', async () => {
    fetchMock.mockResolvedValue(upstream({ data: {} }))

    await POST(
      checkoutRequest(['orders', 'quote'], {
        ...CHECKOUT,
        'x-desi-client-address': '203.0.113.250',
      }),
      context(['orders', 'quote']),
    )

    const { 'x-forwarded-for': _forwarded, ...noForwardedFor } = CHECKOUT

    await POST(
      checkoutRequest(['orders'], { ...noForwardedFor, 'x-desi-client-address': '203.0.113.250' }),
      context(['orders']),
    )

    expect(fetchMock.mock.calls[0][1].headers.get('x-desi-client-address')).toBe('198.51.100.7')
    expect(fetchMock.mock.calls[1][1].headers.get('x-desi-client-address')).toBeNull()
  })

  it('adds no address to any other order route', async () => {
    fetchMock.mockResolvedValue(upstream({ data: {} }))

    await GET(
      new Request('http://web.test/api/v1/orders', { headers: CHECKOUT }),
      context(['orders']),
    )
    await POST(
      checkoutRequest(['orders', 'ORD-1', 'group-pass']),
      context(['orders', 'ORD-1', 'group-pass']),
    )

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.get('x-desi-client-address')).toBeNull()
    }
  })

  describe('in production', () => {
    let warn

    beforeEach(() => {
      resetForwardingWarnings()
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('NODE_ENV', 'production')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      warn.mockRestore()
      resetForwardingWarnings()
    })

    it('with no proxy setting, forwards no address on a checkout, so a browser that names one gets no bucket of its own', async () => {
      vi.stubEnv('TRAFFIC_TRUSTED_PROXY_HOPS', '')
      fetchMock.mockImplementation(async () => upstream({ data: {} }))

      // Next fills X-Forwarded-For from the connection only when the browser
      // sent none, so with no proxy in front each of these is the browser's
      // own choice: a new address for every wrong guess.
      for (const [index, path] of [
        ['orders', 'quote'],
        ['orders'],
        ['orders', 'quote'],
      ].entries()) {
        await POST(
          checkoutRequest(path, { ...CHECKOUT, 'x-forwarded-for': `198.51.100.${index + 20}` }),
          context(path),
        )
      }

      for (const [, init] of fetchMock.mock.calls) {
        expect(init.headers.get('x-desi-client-address')).toBeNull()
        // The session still travels: the API counts the refusal in its shared bucket.
        expect(init.headers.get('cookie')).toBe(CHECKOUT.cookie)
      }

      // A visit is still counted from the connection, as its figures are a guide.
      await POST(
        new Request('http://web.test/api/v1/traffic/beacons', {
          method: 'POST',
          headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '198.51.100.7' },
          body: '{}',
        }),
        context(['traffic', 'beacons']),
      )

      expect(fetchMock.mock.calls.at(-1)[1].headers.get('x-desi-client-address')).toBe(
        '198.51.100.7',
      )
    })

    it('behind the proxies the setting names, forwards the entry the nearest of them appended', async () => {
      vi.stubEnv('TRAFFIC_TRUSTED_PROXY_HOPS', '1')
      fetchMock.mockImplementation(async () => upstream({ data: {} }))

      await POST(
        checkoutRequest(['orders', 'quote'], {
          ...CHECKOUT,
          'x-forwarded-for': '203.0.113.250, 198.51.100.7',
        }),
        context(['orders', 'quote']),
      )

      expect(fetchMock.mock.calls[0][1].headers.get('x-desi-client-address')).toBe('198.51.100.7')
    })

    it('reads the address for a checkout only when the browser cannot choose it', () => {
      const headers = new Headers({ 'x-forwarded-for': '203.0.113.250, 198.51.100.7, 10.0.0.2' })

      expect(checkoutAddress(headers, { NODE_ENV: 'production' })).toBeNull()
      expect(
        checkoutAddress(headers, { NODE_ENV: 'production', TRAFFIC_TRUSTED_PROXY_HOPS: '0' }),
      ).toBeNull()
      expect(
        checkoutAddress(headers, { NODE_ENV: 'production', TRAFFIC_TRUSTED_PROXY_HOPS: '2' }),
      ).toBe('198.51.100.7')
      // An unusable setting is 0, so it forwards nothing either.
      expect(
        checkoutAddress(headers, { NODE_ENV: 'production', TRAFFIC_TRUSTED_PROXY_HOPS: 'many' }),
      ).toBeNull()
      // Outside production the connection is a developer's or a test's.
      expect(checkoutAddress(headers, { NODE_ENV: 'development' })).toBe('10.0.0.2')
      expect(checkoutAddress(headers, { NODE_ENV: 'test' })).toBe('10.0.0.2')
    })
  })

  it('knows a checkout’s quote and charge from every other request', () => {
    expect(isCheckout('POST', ['orders'])).toBe(true)
    expect(isCheckout('POST', ['orders', 'quote'])).toBe(true)
    expect(isCheckout('GET', ['orders'])).toBe(false)
    expect(isCheckout('GET', ['orders', 'quote'])).toBe(false)
    expect(isCheckout('POST', ['orders', 'ORD-1'])).toBe(false)
    expect(isCheckout('POST', ['orders', 'quote', 'x'])).toBe(false)
    expect(isCheckout('POST', ['holds'])).toBe(false)
  })
})

describe('the proxy’s path rules', () => {
  it('knows which paths are this server’s alone and which request is a beacon', () => {
    expect(SERVER_ONLY_API_PATHS).toEqual([['traffic', 'website-visits']])
    expect(isServerOnlyPath(['traffic', 'website-visits'])).toBe(true)
    expect(isServerOnlyPath(['traffic', 'beacons'])).toBe(false)
    expect(isServerOnlyPath(['traffic'])).toBe(false)
    expect(isBeacon('POST', ['traffic', 'beacons'])).toBe(true)
    expect(isBeacon('GET', ['traffic', 'beacons'])).toBe(false)
    expect(isBeacon('POST', ['traffic', 'beacons', 'x'])).toBe(false)
    expect(isBeacon('POST', ['traffic', 'events'])).toBe(false)
  })
})
