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

const { POST, GET, PROXY_BODY_LIMIT_BYTES, readBoundedBody, withoutBearerSecret } =
  await import('./route.js')

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
