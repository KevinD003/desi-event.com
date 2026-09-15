'use client'

/**
 * Signing in.
 *
 * Talks to `/api/v1/auth/login` — this application's own origin, which the
 * proxy forwards. That is what lets the session cookie keep its `__Host-`
 * prefix: it belongs to the origin the page came from, so the browser's own
 * guarantee does the work rather than a CORS configuration.
 *
 * Three things the form does deliberately:
 *
 *   - **The second factor appears when it is asked for, not before.** A form
 *     that always shows a code field teaches people to look for a code they
 *     usually do not need. The API says when it needs one.
 *   - **Every failure is announced, not just shown.** The error lives in a
 *     `role="alert"` and focus moves to it, because a sighted user sees red
 *     appear and a screen-reader user is told nothing otherwise.
 *   - **It never says which half was wrong.** "Invalid email address or
 *     password" is the API's wording and it is repeated verbatim; narrowing it
 *     to "no such account" is an account-enumeration oracle.
 *
 * @module components/sign-in-form
 */

import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input } from './ui.jsx'

/**
 * @typedef {object} SignInFormProps
 * @property {string} [next] Where to go after signing in.
 */

/**
 * The sign-in form.
 *
 * @param {SignInFormProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function SignInForm({ next = '/organizer/venues' }) {
  const [error, setError] = useState(null)
  const [needsCode, setNeedsCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const errorRef = useRef(null)
  const codeRef = useRef(null)

  /**
   * Submit the credentials.
   *
   * @param {object} event The submit event.
   * @returns {Promise<void>} Resolves when the attempt is done.
   */
  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    }
    const code = String(form.get('code') ?? '').trim()

    if (code) payload.code = code

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        // A full navigation rather than a client transition: the session cookie
        // has just been set, and every server component on the next page needs
        // the request that carries it.
        window.location.assign(next)
        return
      }

      const body = await response.json().catch(() => null)
      const message = body?.error?.message ?? 'Sign-in failed. Try again.'

      // The API asks for a code by refusing with a specific code rather than by
      // a message a client would have to pattern-match.
      if (body?.error?.code === 'MFA_REQUIRED' || /second factor|one-time code/i.test(message)) {
        setNeedsCode(true)
        setError(message)
        queueMicrotask(() => codeRef.current?.focus())
        return
      }

      setError(message)
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The ticketing service is not responding. Nothing has been changed.')
      queueMicrotask(() => errorRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? (
        <div ref={errorRef} tabIndex={-1} role="alert" aria-live="assertive">
          <Alert variant="danger" title="Could not sign you in">
            {error}
          </Alert>
        </div>
      ) : null}

      <FormField label="Email address" id="email" required>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </FormField>

      <FormField label="Password" id="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </FormField>

      {needsCode ? (
        <FormField
          label="Six-digit code from your authenticator"
          id="code"
          description="Your account holds privileged roles, so it needs a second factor."
        >
          <Input
            id="code"
            name="code"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
          />
        </FormField>
      ) : null}

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
