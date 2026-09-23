'use client'

/**
 * Creating an attendee account.
 *
 * Buying a ticket needs an account — tickets live in it — and until Phase 4
 * the site had no way to make one: the API's `POST /v1/auth/register` was
 * there, and nothing called it, so only seeded accounts could ever buy.
 *
 * Attendee accounts only. The API also accepts `ORGANIZER`, but an organiser
 * account with no organisation can do nothing, and this build has no way for
 * somebody to create an organisation for themselves; offering the choice would
 * be offering a door to an empty room.
 *
 * The API signs the new account in as it creates it, so success is a full
 * navigation to where the person was going, carrying the new session cookie.
 *
 * What this cannot do, said on the form rather than discovered later: the
 * address is not confirmed, because this build delivers no email, and a
 * forgotten password cannot be reset, for the same reason.
 *
 * @module components/register-form
 */

import { useRef, useState } from 'react'

import { apiFetch } from '../lib/api-fetch.js'
import { parseRetryAfter, refusalSentence } from '../lib/refusal.js'
import { Alert, Button, FormField, Input } from './ui.jsx'

/** What the API accepts, from `passwordSchema` in `@desi-event/schemas`. */
const PASSWORD_MIN = 8

/**
 * @typedef {object} RegisterFormProps
 * @property {string} next Where to go once the account exists, already checked by `safeNextPath`.
 */

/**
 * The form.
 *
 * @param {RegisterFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function RegisterForm({ next }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  // One announcement per failed attempt: the summary below, not a field error
  // as well, and nothing while somebody is still typing.
  const errorRef = useRef(null)

  /**
   * Create the account.
   *
   * @param {object} event The submit event.
   * @returns {Promise<void>} Resolves when the attempt is done.
   */
  async function onSubmit(event) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const displayName = String(form.get('displayName') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()

    if (!displayName || !email || password.length < PASSWORD_MIN) {
      setError('Fill in your name, your email address and a password of at least eight characters.')
      queueMicrotask(() => errorRef.current?.focus())

      return
    }

    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password }),
      })

      if (response.ok) {
        // A full navigation: the session cookie has just been set, and every
        // server component on the next page needs the request that carries it.
        window.location.assign(next)

        return
      }

      const body = await response.json().catch(() => null)

      setError(
        refusalSentence(
          response.status,
          body,
          'The account was not created. Try again.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The service is not responding. No account was created; try again.')
      queueMicrotask(() => errorRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert variant="error" title="The account was not created">
            {error}
          </Alert>
        </div>
      ) : null}

      <FormField label="Your name" id="displayName" description="Shown on your tickets." required>
        <Input id="displayName" name="displayName" autoComplete="name" required />
      </FormField>

      <FormField
        label="Email address"
        id="email"
        description="You sign in with it. This site sends no email, so it is not confirmed."
        required
      >
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>

      <FormField
        label="Password"
        id="password"
        description={`At least ${PASSWORD_MIN} characters. A forgotten password cannot be reset from this site.`}
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(change) => setPassword(change.target.value)}
          minLength={PASSWORD_MIN}
          maxLength={128}
          required
        />
      </FormField>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Creating your account…' : 'Create account'}
      </Button>
    </form>
  )
}
