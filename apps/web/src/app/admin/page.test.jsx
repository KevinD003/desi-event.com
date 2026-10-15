/**
 * The top of platform administration sends the reader to the first section
 * their session is offered.
 *
 * @module app/admin/page.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()
const redirect = vi.fn(() => {
  throw new Error('NEXT_REDIRECT')
})

vi.mock('../../lib/session.js', () => ({ readSession: (...args) => readSession(...args) }))
vi.mock('next/navigation', () => ({ redirect: (...args) => redirect(...args) }))

const { default: AdminPage } = await import('./page.jsx')

beforeEach(() => {
  readSession.mockReset()
  redirect.mockClear()
})

describe('the admin area’s front page', () => {
  it('sends a platform administrator to organiser invitations', async () => {
    readSession.mockResolvedValue({ capabilities: ['organizer:invite'], memberships: [] })

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/organizer-invitations')
  })

  it('sends a super administrator to organiser invitations too', async () => {
    readSession.mockResolvedValue({
      capabilities: ['platform:admin', 'organizer:invite'],
      memberships: [],
    })

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/organizer-invitations')
  })

  it('sends a session holding platform administration alone to people and roles', async () => {
    readSession.mockResolvedValue({ capabilities: ['platform:admin'], memberships: [] })

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/users')
  })

  it('sends anybody else to the area’s front door, where the layout refuses them', async () => {
    readSession.mockResolvedValue(null)

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/organizer-invitations')
  })
})
