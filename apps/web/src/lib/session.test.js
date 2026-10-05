/**
 * `readSession` is cached for the request: every server component that asks
 * during one render shares one answer, and the API is asked once.
 *
 * React's `cache` memoises only inside a server render, so this test stands in
 * for it with a memo of the same shape and checks that `readSession` is what
 * `cache` returned — the property the request-wide sharing rests on — and that
 * the function it wraps still answers null for every failure.
 *
 * @module lib/session.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cookieJar = { getAll: vi.fn() }
const wrapped = []

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieJar),
  headers: vi.fn(async () => new Map()),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual('react')

  return {
    ...actual,
    // One memo per wrapped function, as one request's render would hold.
    cache: vi.fn((fn) => {
      let memo = null
      const cached = (...args) => {
        memo ??= fn(...args)

        return memo
      }

      cached.forget = () => {
        memo = null
      }
      wrapped.push(cached)

      return cached
    }),
  }
})

const { cache } = await import('react')
const { readSession } = await import('./session.js')

let fetchMock

beforeEach(() => {
  readSession.forget?.()
  fetchMock = vi.fn(async () => Response.json({ data: { user: { id: 'u1' }, capabilities: [] } }))
  vi.stubGlobal('fetch', fetchMock)
  cookieJar.getAll.mockReturnValue([{ name: 'desi_session', value: 'opaque' }])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readSession', () => {
  it('is the function React’s request cache returned', () => {
    // `wrapped` records every function handed to `cache` when the module
    // loaded (the mock's call log is cleared between tests, this is not).
    expect(typeof cache).toBe('function')
    expect(wrapped).toEqual([readSession])
  })

  it('asks the API once however many components ask during one request', async () => {
    const [first, second, third] = await Promise.all([readSession(), readSession(), readSession()])

    expect(first).toEqual({ user: { id: 'u1' }, capabilities: [] })
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/auth\/me$/u)
    expect(fetchMock.mock.calls[0][1].headers.cookie).toBe('desi_session=opaque')
  })

  it('answers null without asking when there is no cookie', async () => {
    cookieJar.getAll.mockReturnValue([])

    expect(await readSession()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers null when the API refuses or does not answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))

    expect(await readSession()).toBeNull()

    readSession.forget()
    fetchMock.mockRejectedValueOnce(new Error('connection refused'))

    expect(await readSession()).toBeNull()
  })
})
