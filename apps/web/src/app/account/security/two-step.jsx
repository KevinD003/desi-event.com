'use client'

/**
 * Two-step sign-in: set it up, prove it works, keep the recovery codes, turn
 * it off.
 *
 * Every privileged role needs a second factor (finding NF-12), and until Phase
 * 4 the web application had no way to set one up: the API refused such an
 * account with "Enrol one at /v1/auth/mfa/totp" and nothing on the site could.
 * This is that page.
 *
 * ## What is secret here, and what happens to it
 *
 * Two things pass through this component that must not outlive it:
 *
 * - **The TOTP secret** (and the `otpauth:` URI that contains it), returned
 *   once by `POST /v1/auth/mfa/totp` and never again. It is drawn as a QR code
 *   by the repository's own encoder — no image service, no network — and shown
 *   as text for typing in by hand.
 * - **The recovery codes**, returned once by the confirmation and stored by the
 *   API only as digests.
 *
 * Both live in React state and nowhere else: not in storage, not in a URL, not
 * in an attribute, not in a log, not in the page title. Once the person moves
 * on, the page is redrawn from the server, which has neither to give.
 *
 * @module app/account/security/two-step
 */

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'

import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Input } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { qrMatrix, qrPath } from '../../../lib/qr.js'
import { refusalFromResponse } from '../../../lib/refusal.js'

/**
 * @typedef {object} Factor
 * @property {string} id The factor.
 * @property {'TOTP'|'RECOVERY_CODE'|'WEBAUTHN'} type Its kind.
 * @property {string|null} [label] What it was called.
 * @property {boolean} confirmed Whether it has been proved to work.
 * @property {string} createdAt When it was added.
 * @property {string|null} [lastUsedAt] When it last signed somebody in.
 */

/**
 * A secret split into groups of four, the way authenticator apps show them.
 *
 * @param {string} secret The base32 secret.
 * @returns {string} The grouped secret.
 */
export function groupSecret(secret) {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}

/**
 * A date, for the factor's history.
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @returns {string} Words.
 */
function formatWhen(value) {
  if (!value) return 'never'

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
 * The provisioning QR code, drawn locally.
 *
 * @param {object} props Component props.
 * @param {string} props.uri The `otpauth:` URI.
 * @returns {JSX.Element} The code.
 */
function ProvisioningCode({ uri }) {
  const drawing = useMemo(() => {
    const matrix = qrMatrix(uri)

    return { size: matrix.size, path: qrPath(matrix) }
  }, [uri])

  return (
    <svg
      role="img"
      aria-label="QR code for your authenticator app"
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      className="h-48 w-48 rounded-lg border border-line bg-surface p-2"
      shapeRendering="crispEdges"
    >
      {/* Maximum contrast between modules, as a scanner needs: the same
          exception the ticket pass has, and for the same reason. */}
      <rect width={drawing.size} height={drawing.size} fill="#ffffff" />
      <path d={drawing.path} fill="#000000" />
    </svg>
  )
}

/**
 * @typedef {object} TwoStepProps
 * @property {boolean} required Whether a role this account holds needs a second factor.
 * @property {Factor[]} factors The account's factors, as `GET /v1/auth/mfa` returned them.
 */

/**
 * The two-step sign-in panel.
 *
 * @param {TwoStepProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function TwoStep({ required, factors }) {
  const router = useRouter()
  const active = factors.find((factor) => factor.type === 'TOTP' && factor.confirmed) ?? null
  const [stage, setStage] = useState('idle')
  const [enrolment, setEnrolment] = useState(null)
  const [recoveryCodes, setRecoveryCodes] = useState(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const retryDisable = useRef(false)

  /**
   * Ask the API for a new secret.
   *
   * @returns {Promise<void>} Resolves once answered.
   */
  async function begin() {
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch('/v1/auth/mfa/totp', { method: 'POST', body: '{}' })

      if (!response.ok) {
        setError((await refusalFromResponse(response)).message ?? 'Setting up did not start.')

        return
      }

      const { data } = await response.json()

      setEnrolment({ factorId: data.factorId, secret: data.secret, uri: data.uri })
      setStage('scan')
    } catch {
      setError('The service did not answer. Nothing was set up; try again.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Prove the authenticator has the secret.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once answered.
   */
  async function confirm(submitted) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch('/v1/auth/mfa/totp/confirm', {
        method: 'POST',
        body: JSON.stringify({ factorId: enrolment.factorId, code: code.replace(/\s+/g, '') }),
      })

      if (!response.ok) {
        const refusal = await refusalFromResponse(response)

        setError(
          refusal.message ??
            'That code was not accepted. Check the time on your phone is right, and try the next code.',
        )

        return
      }

      const { data } = await response.json()

      // The secret has done its job. Drop it before showing anything else.
      setEnrolment(null)
      setCode('')
      setRecoveryCodes(data.recoveryCodes)
      setStage('recovery')
    } catch {
      setError('The service did not answer. Nothing was confirmed; try the next code.')
    } finally {
      setBusy(false)
    }
  }

  /** Forget the recovery codes and show the page as the server now has it. */
  function finish() {
    setRecoveryCodes(null)
    setStage('idle')
    setNotice('Two-step sign-in is on.')
    router.refresh()
  }

  /**
   * Turn the factor off.
   *
   * @param {object} [submitted] The submit event, when there was one.
   * @returns {Promise<void>} Resolves once answered.
   */
  async function disable(submitted) {
    submitted?.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await apiFetch(`/v1/auth/mfa/${encodeURIComponent(active.id)}/disable`, {
        method: 'POST',
        body: JSON.stringify({ currentPassword: password }),
      })

      if (!response.ok) {
        const refusal = await refusalFromResponse(response)

        if (refusal.code === 'STEP_UP_REQUIRED') {
          retryDisable.current = true
          setStage('step-up')

          return
        }

        // A 401 here is a wrong password, not a lost session; the API's words
        // say which.
        setError(refusal.message ?? 'Two-step sign-in was not turned off.')

        return
      }

      setPassword('')
      setStage('idle')
      setNotice('Two-step sign-in is off. Every other session this account had was signed out.')
      router.refresh()
    } catch {
      setError('The service did not answer. Nothing was changed; try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {active ? (
        <p className="text-ink">
          <span className="font-semibold">On.</span> Signing in asks for a code from your
          authenticator app as well as your password. Set up {formatWhen(active.createdAt)}; last
          used {formatWhen(active.lastUsedAt)}.
        </p>
      ) : (
        <p className="text-ink">
          <span className="font-semibold">Off.</span>{' '}
          {required
            ? 'A role this account holds needs it: until it is set up, the workspace will refuse to work for you.'
            : 'Signing in asks only for your password.'}
        </p>
      )}

      {error ? (
        <Alert variant="error" title="That did not work">
          {error}
        </Alert>
      ) : null}

      {!active && stage === 'idle' ? (
        <Button type="button" onClick={begin} loading={busy}>
          Set up two-step sign-in
        </Button>
      ) : null}

      {stage === 'scan' && enrolment ? (
        <form
          onSubmit={confirm}
          className="space-y-4 rounded-card border border-line bg-surface-raised p-4"
        >
          <p className="text-ink">
            Scan this with an authenticator app (any app that supports time-based codes), then enter
            the six-digit code it shows.
          </p>
          <ProvisioningCode uri={enrolment.uri} />
          <details className="text-sm text-ink-muted">
            <summary className="cursor-pointer rounded-sm font-medium text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
              Cannot scan? Type this key into the app instead
            </summary>
            <p className="mt-2 font-mono text-base tracking-wider break-all text-ink">
              {groupSecret(enrolment.secret)}
            </p>
          </details>
          <FormField
            label="Six-digit code from your app"
            description="Codes change every 30 seconds."
          >
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              required
            />
          </FormField>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              Confirm
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEnrolment(null)
                setCode('')
                setStage('idle')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'recovery' && recoveryCodes ? (
        <section
          aria-labelledby="recovery-heading"
          className="space-y-3 rounded-card border border-status-warning/30 bg-status-warning-soft p-4"
        >
          <h3 id="recovery-heading" className="font-semibold text-status-warning">
            Save your recovery codes now
          </h3>
          <p className="text-ink">
            Each one works once, instead of a code from your app, if you lose your phone. They will
            not be shown again — the service keeps only a fingerprint of each.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-ink sm:grid-cols-3">
            {recoveryCodes.map((recovery) => (
              <li key={recovery} className="rounded border border-line bg-surface px-2 py-1">
                {recovery}
              </li>
            ))}
          </ul>
          <Button type="button" onClick={finish}>
            I have saved them
          </Button>
        </section>
      ) : null}

      {active && stage === 'idle' ? (
        <Button type="button" variant="secondary" onClick={() => setStage('disable')}>
          Turn off two-step sign-in
        </Button>
      ) : null}

      {active && stage === 'disable' ? (
        <form
          onSubmit={disable}
          className="space-y-3 rounded-card border border-status-danger/25 bg-status-danger-soft p-4"
        >
          <p className="text-ink">
            {required
              ? 'A role this account holds needs a second factor, so the service will refuse this unless you have another one.'
              : 'Signing in will ask only for your password again. Every other session this account has will be signed out.'}
          </p>
          <FormField label="Your current password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </FormField>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger" loading={busy}>
              Turn it off
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPassword('')
                setStage('idle')
              }}
            >
              Keep it on
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'step-up' ? (
        <StepUpPrompt
          action="turn off two-step sign-in"
          onConfirmed={() => {
            setStage('disable')

            if (retryDisable.current) {
              retryDisable.current = false
              disable()
            }
          }}
          onCancel={() => {
            retryDisable.current = false
            setPassword('')
            setStage('idle')
          }}
        />
      ) : null}
    </div>
  )
}
