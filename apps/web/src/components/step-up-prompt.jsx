'use client'

/**
 * Confirming who you are, again, before something consequential.
 *
 * The server decides when. A route whose contract names a step-up policy
 * answers `STEP_UP_REQUIRED` when the session's last authentication is older
 * than the window that policy allows, and the window itself is server-held —
 * that was finding NF-11, and the property that matters is that the browser
 * cannot ask for a longer one. An attacker holding a session is exactly the
 * party who would.
 *
 * So this is not a gate. It is what a screen shows *after* being refused: the
 * prompt, and then a retry of the thing that was refused. A component that
 * decided for itself when to ask would be guessing at a rule it cannot see.
 *
 * @module components/step-up-prompt
 */

import { useRef, useState } from 'react'

import { Alert, Button, FormField, Input } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'

/**
 * @typedef {object} StepUpPromptProps
 * @property {string} action What is waiting, in words: "approve this event".
 * @property {Function} onConfirmed Called once the server has accepted the second factor.
 * @property {Function} onCancel Called when the person backs out.
 */

/**
 * The prompt.
 *
 * @param {StepUpPromptProps} props Component props.
 * @returns {JSX.Element} The rendered prompt.
 */
export function StepUpPrompt({ action, onConfirmed, onCancel }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errorRef = useRef(null)

  /**
   * Send the second factor.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function onSubmit(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch('/v1/auth/step-up', {
        method: 'POST',
        body: JSON.stringify({ password, code: code.trim() || undefined }),
      })

      if (response.ok) {
        // Not kept in state a moment longer than the request needs them.
        setPassword('')
        setCode('')
        onConfirmed()
        return
      }

      const body = await response.json().catch(() => null)

      setError(body?.error?.message ?? 'That did not confirm your identity.')
      queueMicrotask(() => errorRef.current?.focus())
    } catch {
      setError('The service is not responding. Nothing has happened.')
      queueMicrotask(() => errorRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="step-up-heading"
      className="rounded-card border-2 border-indigo-night-900 bg-white p-4"
    >
      <h3 id="step-up-heading" className="text-lg font-semibold text-indigo-night-900">
        Confirm it is you
      </h3>
      <p className="mt-1 text-sm text-slate-700">
        You are signed in, but it has been a while. Confirm your identity to {action}.
      </p>

      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mt-3">
          <Alert variant="error" title="Not confirmed">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}

      <div className="mt-3 space-y-4">
        <FormField label="Your password" id="step-up-password" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(change) => setPassword(change.target.value)}
          />
        </FormField>

        <FormField
          label="Code from your authenticator"
          id="step-up-code"
          description="Six digits, or one of your recovery codes."
        >
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(change) => setCode(change.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !password}>
          {busy ? 'Confirming…' : 'Confirm'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Not now
        </Button>
      </div>
    </form>
  )
}
