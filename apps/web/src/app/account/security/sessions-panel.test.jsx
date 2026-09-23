/**
 * Where the account is signed in, and ending any of it.
 *
 * The properties that matter: another session is ended through the API and the
 * page says so; "already gone" counts as done, because it is what was asked
 * for; a refusal leaves the page saying nothing was signed out; this session
 * is ended only by signing out, never by a revoke that would leave the page
 * drawn for a session that no longer exists; and a browser is named in words,
 * never by its full user-agent string, which fingerprints more than it
 * identifies.
 *
 * @module app/account/security/sessions-panel.test
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
const replace = vi.fn()
const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

const { SessionsPanel, describeBrowser } = await import('./sessions-panel.jsx')

const FIREFOX_ANDROID =
  'Mozilla/5.0 (Android 15; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0 build/unique-9f3a2c'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

const THIS_SESSION = {
  id: 'ckses00000000000000000001',
  current: true,
  createdAt: '2026-09-20T09:00:00.000Z',
  lastSeenAt: '2026-09-23T05:00:00.000Z',
  expiresAt: '2026-10-20T09:00:00.000Z',
  userAgent: CHROME_MAC,
  deviceId: null,
  deviceLabel: null,
}

const OTHER_SESSION = {
  id: 'ckses00000000000000000002',
  current: false,
  createdAt: '2026-09-01T09:00:00.000Z',
  lastSeenAt: '2026-09-02T09:00:00.000Z',
  expiresAt: '2026-10-01T09:00:00.000Z',
  userAgent: FIREFOX_ANDROID,
  deviceId: 'ckdev00000000000000000001',
  deviceLabel: null,
}

const DEVICE = {
  id: 'ckdev00000000000000000001',
  label: null,
  trusted: false,
  firstSeenAt: '2026-09-01T09:00:00.000Z',
  lastSeenAt: '2026-09-02T09:00:00.000Z',
  activeSessions: 1,
}

/**
 * A JSON response.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {Response} The response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
  replace.mockReset()
})

afterEach(cleanup)

describe('describeBrowser', () => {
  it.each([
    [FIREFOX_ANDROID, 'Firefox on Android'],
    [CHROME_MAC, 'Chrome on macOS'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    ['curl/8.9.1', 'A browser'],
    [null, 'An unknown browser'],
    ['   ', 'An unknown browser'],
  ])('reads %j as %s', (userAgent, words) => {
    expect(describeBrowser(userAgent)).toBe(words)
  })
})

describe('SessionsPanel', () => {
  it('names each session in words, never by its user-agent string', () => {
    const { container } = render(
      <SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[DEVICE]} />,
    )

    expect(screen.getByText(/Firefox on Android/)).toBeTruthy()
    expect(container.innerHTML).not.toContain('build/unique-9f3a2c')
    expect(container.innerHTML).not.toContain('AppleWebKit')
  })

  it('offers sign out, not a revoke, for the session this page is drawn in', () => {
    render(<SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[]} />)

    const rows = screen.getAllByRole('listitem')
    const current = rows.find((row) => within(row).queryByText('This session'))

    expect(within(current).getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(within(current).queryByRole('button', { name: /^Sign out of / })).toBeNull()
  })

  it('ends another session through the API, then says so and redraws', async () => {
    apiFetch.mockResolvedValueOnce(json(200, { ok: true }))

    render(<SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Sign out of Firefox on Android, signed in / }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/auth/sessions/${OTHER_SESSION.id}/revoke`)
    expect(options.method).toBe('POST')
    expect(screen.getByText('That session was signed out.')).toBeTruthy()
  })

  it('counts a session that had already gone as signed out', async () => {
    apiFetch.mockResolvedValueOnce(json(404, { error: { code: 'NOT_FOUND', message: 'No.' } }))

    render(<SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Sign out of Firefox on Android, signed in / }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the API’s refusal, and does not pretend anything was signed out', async () => {
    apiFetch.mockResolvedValueOnce(
      json(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute.' } }),
    )

    render(<SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Sign out of Firefox on Android, signed in / }))

    expect((await screen.findByRole('status')).textContent).toContain(
      'Too many requests. Wait a minute.',
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.queryByText('That session was signed out.')).toBeNull()
  })

  it('says nothing was signed out when the service does not answer', async () => {
    apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<SessionsPanel sessions={[THIS_SESSION, OTHER_SESSION]} devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Sign out of Firefox on Android, signed in / }))

    expect((await screen.findByRole('status')).textContent).toMatch(/nothing was signed out/i)
  })

  it('forgets a device through its own route, and counts its sessions in words', async () => {
    apiFetch.mockResolvedValueOnce(json(200, { ok: true }))

    render(
      <SessionsPanel
        sessions={[]}
        devices={[DEVICE, { ...DEVICE, id: 'ckdev00000000000000000002', activeSessions: 3 }]}
      />,
    )

    expect(screen.getByText(/1 open session$/)).toBeTruthy()
    expect(screen.getByText(/3 open sessions$/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: /^Forget the unnamed device, first seen / })[0])

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/auth/devices/${DEVICE.id}/revoke`)
  })

  it('always offers signing out everywhere', () => {
    render(<SessionsPanel sessions={[]} devices={[]} />)

    expect(screen.getByText('No sessions are open.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeTruthy()
  })
})
