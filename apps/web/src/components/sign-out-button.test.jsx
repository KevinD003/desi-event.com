/**
 * Sign out does what it says, or says that it did not.
 *
 * @module components/sign-out-button.test
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()
const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

const { SignOutButton } = await import('./sign-out-button.jsx')

beforeEach(() => {
  apiFetch.mockReset()
  replace.mockReset()
  refresh.mockReset()
})

afterEach(cleanup)

describe('SignOutButton', () => {
  it('ends the session through the API, then leaves the page it was drawn for', async () => {
    apiFetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(refresh).toHaveBeenCalled()

    // Through apiFetch, which adds the CSRF header a plain form could not.
    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/auth/logout')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ everywhere: false })
  })

  it('asks for every session when it signs out everywhere', async () => {
    apiFetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    render(<SignOutButton everywhere label="Sign out everywhere" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ everywhere: true })
  })

  it('treats "no session to end" as done', async () => {
    apiFetch.mockResolvedValue(new Response('{}', { status: 401 }))

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('says plainly that the person is still signed in when it failed', async () => {
    apiFetch.mockResolvedValue(new Response('{}', { status: 503 }))

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/you are still signed in/i)
    expect(replace).not.toHaveBeenCalled()
  })

  it('says so when the network did not answer', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/still signed in/i)
  })
})
