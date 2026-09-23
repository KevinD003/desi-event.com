'use client'

/**
 * Change the password.
 *
 * `POST /v1/auth/change-password` asks for the current password even though the
 * caller is signed in: a session is evidence of who somebody was when they
 * signed in, not that the person at the keyboard now knows the password. On
 * success the API signs out every *other* session and rotates this one, and
 * this says so, because a person changing a password after a scare wants to
 * know the other devices are out.
 *
 * A 401 from this route means a wrong current password, not a lost session;
 * the API's own words are shown rather than the generic "signed out".
 *
 * @module app/account/security/change-password
 */

import { useState } from 'react'

import { Alert, Button, FormField, Input } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { refusalFromResponse } from '../../../lib/refusal.js'

/** What the API accepts, from `passwordSchema` in `@desi-event/schemas`. */
export const PASSWORD_RULE = Object.freeze({ min: 8, max: 128 })

/**
 * The change-password form.
 *
 * @returns {JSX.Element} The form.
 */
export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const mismatch = repeat.length > 0 && next !== repeat
  const tooShort = next.length > 0 && next.length < PASSWORD_RULE.min

  /**
   * Send the change.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once answered.
   */
  async function submit(submitted) {
    submitted.preventDefault()

    if (mismatch || tooShort || !current || !next) return

    setBusy(true)
    setError(null)
    setDone(false)

    try {
      const response = await apiFetch('/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, password: next }),
      })

      if (!response.ok) {
        setError(
          (await refusalFromResponse(response)).message ??
            'The password was not changed. Try again.',
        )

        return
      }

      setCurrent('')
      setNext('')
      setRepeat('')
      setDone(true)
    } catch {
      setError('The service did not answer. The password was not changed; try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    // method="post": a form with no method submits with GET if it is pressed
    // before the script arrives. The fields carry no name, so nothing would
    // reach the address today; this keeps it true if one is ever given a name.
    <form method="post" onSubmit={submit} className="max-w-md space-y-4" noValidate>
      {done ? (
        <Alert variant="success" title="Password changed">
          Every other session this account had was signed out. This one carries on.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="That did not work">
          {error}
        </Alert>
      ) : null}

      <FormField label="Current password" required>
        <Input
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </FormField>
      <FormField
        label="New password"
        description={`At least ${PASSWORD_RULE.min} characters.`}
        error={tooShort ? `Use at least ${PASSWORD_RULE.min} characters.` : undefined}
        required
      >
        <Input
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          minLength={PASSWORD_RULE.min}
          maxLength={PASSWORD_RULE.max}
          required
        />
      </FormField>
      <FormField
        label="New password again"
        error={mismatch ? 'The two new passwords are different.' : undefined}
        required
      >
        <Input
          type="password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
          required
        />
      </FormField>

      <Button type="submit" loading={busy} disabled={mismatch || tooShort}>
        Change password
      </Button>
    </form>
  )
}
