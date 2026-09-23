/**
 * The door every signed-in area opens with.
 *
 * @module lib/area-gate.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()
const redirect = vi.fn(() => {
  throw new Error('NEXT_REDIRECT')
})
let path = '/tickets/ckticket00000000000000001?view=pass'

vi.mock('./session.js', () => ({ readSession: (...args) => readSession(...args) }))
vi.mock('next/navigation', () => ({ redirect: (...args) => redirect(...args) }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-desi-request-path': path }),
}))

const { enterArea } = await import('./area-gate.js')

beforeEach(() => {
  readSession.mockReset()
  redirect.mockClear()
  path = '/tickets/ckticket00000000000000001?view=pass'
})

describe('enterArea', () => {
  it('sends somebody signed out to sign in, and back to the very page they asked for', async () => {
    readSession.mockResolvedValue(null)

    await expect(enterArea('tickets')).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith(
      '/sign-in?next=%2Ftickets%2Fckticket00000000000000001%3Fview%3Dpass',
    )
  })

  it('does not carry a path it cannot vouch for into the sign-in link', async () => {
    readSession.mockResolvedValue(null)
    path = '//evil.example/phish'

    await expect(enterArea('tickets')).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/sign-in')
  })

  it('admits a session the area admits', async () => {
    const session = { user: { id: 'u' }, capabilities: ['retention:view'], memberships: [] }

    readSession.mockResolvedValue(session)

    expect(await enterArea('retention')).toEqual({ session, admitted: true })
  })

  it('reports a session the area refuses, without redirecting it', async () => {
    const session = { user: { id: 'u' }, capabilities: [], memberships: [] }

    readSession.mockResolvedValue(session)

    expect(await enterArea('organizer')).toEqual({ session, admitted: false })
    expect(redirect).not.toHaveBeenCalled()
  })
})
