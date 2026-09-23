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

const { POST, GET, withoutBearerSecret } = await import('./route.js')

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
})

describe('withoutBearerSecret', () => {
  it('leaves a body that is not JSON alone', async () => {
    const response = new Response('id,total\n1,100', { headers: { 'content-type': 'text/csv' } })

    expect(await withoutBearerSecret(response, ['auth', 'export'])).toBe(response.body)
  })
})
