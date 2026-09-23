'use client'

/**
 * Sign out.
 *
 * There was no way to sign out of the web application before Phase 4; the API
 * route existed and nothing called it. This calls it.
 *
 * A button rather than a form, and deliberately so: `POST /v1/auth/logout`
 * requires the CSRF header, which a plain HTML form cannot send, so a form
 * would be refused with scripts off and would only look like it worked. The
 * API revokes the session and clears its cookies; this then leaves the page,
 * because whatever was on it was drawn for the account that just left.
 *
 * @module components/sign-out-button
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { apiFetch } from '../lib/api-fetch.js'

/**
 * @typedef {object} SignOutButtonProps
 * @property {string} [className] Classes for the button.
 * @property {boolean} [everywhere] Sign out every session this account has, not only this one.
 * @property {string} [label] What the button says.
 */

/**
 * The sign-out control.
 *
 * @param {SignOutButtonProps} props Component props.
 * @returns {JSX.Element} The button, and any failure beneath it.
 */
export function SignOutButton({ className = '', everywhere = false, label = 'Sign out' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  /**
   * Revoke the session, then leave.
   *
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function signOut() {
    setBusy(true)
    setFailed(false)

    try {
      const response = await apiFetch('/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ everywhere }),
      })

      // 401 means there was no session to end, which is the outcome asked for.
      if (!response.ok && response.status !== 401) throw new Error(`HTTP ${response.status}`)

      router.replace('/')
      router.refresh()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        aria-busy={busy || undefined}
        className={className}
      >
        {busy ? 'Signing out…' : label}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-status-danger">
          Signing out did not finish, so you are still signed in. Check your connection and try
          again.
        </p>
      ) : null}
    </div>
  )
}
