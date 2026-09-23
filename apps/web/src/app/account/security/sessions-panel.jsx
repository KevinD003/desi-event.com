'use client'

/**
 * Where this account is signed in, and a way to end any of it.
 *
 * The API has listed sessions and devices, and revoked them, since the
 * session work of Phase 2 (finding NF-10); nothing in the web application
 * reached either. A person who lost a phone had no way to sign it out.
 *
 * Revoking another session ends it at once — the API checks the session on
 * every request, so there is no token left to run out. Revoking this one is
 * signing out, and is offered as exactly that.
 *
 * What a session shows is only what the API chose to send the person who owns
 * it: when it started, when it was last used, the browser it gave, and the
 * device label. No IP address and no token — the response schema carries
 * neither.
 *
 * @module app/account/security/sessions-panel
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { SignOutButton } from '../../../components/sign-out-button.jsx'
import { Alert, Badge, Button } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { refusalFromResponse } from '../../../lib/refusal.js'

/**
 * A browser and system, read from a user-agent string, in two or three words.
 *
 * Deliberately coarse. It names what a person would recognise — "Firefox on
 * Android" — and nothing that fingerprints them; the full string is not shown.
 *
 * @param {string|null|undefined} userAgent The user-agent string.
 * @returns {string} Words.
 */
export function describeBrowser(userAgent) {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return 'An unknown browser'

  const browser =
    (/Edg\//.test(userAgent) && 'Edge') ||
    (/OPR\/|Opera/.test(userAgent) && 'Opera') ||
    (/Firefox\//.test(userAgent) && 'Firefox') ||
    (/Chrome\//.test(userAgent) && 'Chrome') ||
    (/Safari\//.test(userAgent) && 'Safari') ||
    'A browser'

  const system =
    (/Android/.test(userAgent) && 'Android') ||
    (/iPhone|iPad|iPod/.test(userAgent) && 'iOS') ||
    (/Mac OS X|Macintosh/.test(userAgent) && 'macOS') ||
    (/Windows/.test(userAgent) && 'Windows') ||
    (/Linux/.test(userAgent) && 'Linux') ||
    null

  return system ? `${browser} on ${system}` : browser
}

/**
 * A timestamp as a person reads it.
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @returns {string} Words.
 */
function when(value) {
  if (!value) return 'unknown'

  // In UTC, and saying so. This renders on the server first and hydrates in
  // the browser; a format left to the machine's own zone read one time on the
  // server and another after hydration, and named neither.
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(value))
    .concat(' UTC')
}

/**
 * @typedef {object} SessionsPanelProps
 * @property {object[]} sessions From `GET /v1/auth/sessions`.
 * @property {object[]} devices From `GET /v1/auth/devices`.
 */

/**
 * The sessions and devices panel.
 *
 * @param {SessionsPanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function SessionsPanel({ sessions, devices }) {
  const router = useRouter()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')

  /**
   * Revoke a session or a device.
   *
   * @param {'sessions'|'devices'} kind Which list.
   * @param {string} id Which one.
   * @param {string} done What to announce afterwards.
   * @returns {Promise<void>} Resolves once answered.
   */
  async function revoke(kind, id, done) {
    setBusy(`${kind}:${id}`)
    setError(null)

    try {
      const response = await apiFetch(`/v1/auth/${kind}/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        body: '{}',
      })

      // 404: it had already gone, which is what was asked for.
      if (!response.ok && response.status !== 404) {
        setError(
          (await refusalFromResponse(response)).message ?? 'That was not signed out. Try again.',
        )

        return
      }

      setNotice(done)
      router.refresh()
    } catch {
      setError('The service did not answer. Nothing was signed out; try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {error ? (
        <Alert variant="error" title="That did not work">
          {error}
        </Alert>
      ) : null}

      <section aria-labelledby="sessions-heading">
        <h3 id="sessions-heading" className="font-semibold text-ink">
          Sessions
        </h3>
        {sessions.length === 0 ? (
          <p className="mt-2 text-ink-muted">No sessions are open.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface-raised">
            {sessions.map((session) => {
              const name = session.deviceLabel ?? describeBrowser(session.userAgent)

              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words text-ink">
                      {name} {session.current ? <Badge variant="info">This session</Badge> : null}
                    </p>
                    <p className="text-sm text-ink-muted">
                      Signed in {when(session.createdAt)} · last used {when(session.lastSeenAt)}
                    </p>
                  </div>
                  {session.current ? (
                    <SignOutButton className="inline-flex min-h-11 items-center rounded-lg border border-action-secondary-line bg-action-secondary px-3 text-sm font-medium text-action-secondary-ink hover:bg-action-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2" />
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      // Named for its row: a list of identical "Sign out"
                      // buttons tells a screen reader nothing about which.
                      aria-label={`Sign out of ${name}, signed in ${when(session.createdAt)}`}
                      loading={busy === `sessions:${session.id}`}
                      disabled={busy !== null}
                      onClick={() => revoke('sessions', session.id, 'That session was signed out.')}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="devices-heading">
        <h3 id="devices-heading" className="font-semibold text-ink">
          Devices
        </h3>
        {devices.length === 0 ? (
          <p className="mt-2 text-ink-muted">No devices have been remembered.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface-raised">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words text-ink">
                    {device.label ?? 'An unnamed device'}
                  </p>
                  <p className="text-sm text-ink-muted">
                    First seen {when(device.firstSeenAt)} · last seen {when(device.lastSeenAt)} ·{' '}
                    {device.activeSessions === 1
                      ? '1 open session'
                      : `${device.activeSessions} open sessions`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Forget ${device.label ?? 'the unnamed device'}, first seen ${when(device.firstSeenAt)}`}
                  loading={busy === `devices:${device.id}`}
                  disabled={busy !== null}
                  onClick={() =>
                    revoke('devices', device.id, 'That device was forgotten and signed out.')
                  }
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-card border border-line bg-surface-subtle p-4">
        <p className="text-sm text-ink">
          Signs this account out everywhere, including here. Use it if a phone or computer you
          signed in on is lost.
        </p>
        <div className="mt-3">
          <SignOutButton
            everywhere
            label="Sign out everywhere"
            className="inline-flex min-h-11 items-center rounded-lg bg-action-danger px-4 text-sm font-medium text-action-danger-ink hover:bg-action-danger-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          />
        </div>
      </div>
    </div>
  )
}
