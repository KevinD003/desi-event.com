'use client'

/**
 * What an organiser may do to one promo code: pause it, resume it, delete it.
 *
 * Pausing only takes a discount away, so it is one click. Resuming puts one
 * back on offer, so the API asks for a recent second factor (`PROMO_ACTION`)
 * and the step-up prompt appears when it does, beside the buttons, and the
 * resume is sent again once the factor is confirmed. Deleting is confirmed in
 * place, and only for a code nobody has used: a used code keeps its row so
 * the orders that used it keep their record of the discount. The API decides
 * that again in one conditional statement, and when a checkout used the code
 * in the meantime its refusal is repeated as it came.
 *
 * What happened is said in a polite status region, and the page is refreshed
 * so the row shows what the server now holds.
 *
 * @module components/promo-code-actions
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { apiFetch } from '../lib/api-fetch.js'
import { describeApiRefusal } from '../lib/refusal.js'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'

/**
 * Why a code cannot be deleted, or null when it can be offered.
 *
 * @param {{redemptionCount?: number, ordersCount?: number}} code The code.
 * @returns {string|null} The sentence.
 */
export function deleteRefusal(code) {
  const uses = code?.redemptionCount ?? 0

  if (uses > 0)
    return `Used ${uses} time${uses === 1 ? '' : 's'}, so it can be paused but not deleted.`
  if ((code?.ordersCount ?? 0) > 0) {
    return 'An order names this code, so it can be paused but not deleted.'
  }

  return null
}

/**
 * Whether a code's window has closed for good, whatever its status says.
 *
 * A paused code reads PAUSED even after its end has passed — paused is said
 * first — and resuming it would only be refused (`PROMO_ENDED`), after asking
 * for a second factor. So the end itself is read.
 *
 * @param {{status?: string, endsAt?: string|null}} code The code.
 * @param {Date} [now] The moment in question.
 * @returns {boolean} True when the code's window has ended.
 */
export function promoHasEnded(code, now = new Date()) {
  if (code?.status === 'ENDED') return true
  if (!code?.endsAt) return false

  const end = new Date(code.endsAt).getTime()

  return Number.isFinite(end) && now.getTime() >= end
}

/**
 * @typedef {object} PromoCodeActionsProps
 * @property {string} organizationId The organisation the code belongs to.
 * @property {{id: string, code: string, status: string, active: boolean, endsAt?: string|null, redemptionCount: number, ordersCount: number}} code The code.
 * @property {Date} [now] The moment in question; supplied by tests.
 */

/**
 * The actions for one code.
 *
 * @param {PromoCodeActionsProps} props Component props.
 * @returns {JSX.Element} The buttons, the confirmation, and the outcome.
 */
export function PromoCodeActions({ organizationId, code, now }) {
  const router = useRouter()
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [stepUp, setStepUp] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')

  const base = `/v1/organizations/${encodeURIComponent(organizationId)}/promo-codes/${encodeURIComponent(code.id)}`
  const ended = promoHasEnded(code, now ?? new Date())
  const cannotDelete = deleteRefusal(code)

  /**
   * Send one action.
   *
   * @param {'pause'|'resume'|'delete'} action What to do.
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function send(action) {
    setBusy(action)
    setError(null)
    setStatus('')

    try {
      const response = await apiFetch(action === 'delete' ? base : `${base}/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
      })

      if (response.ok) {
        setConfirming(false)
        setStatus(
          action === 'pause'
            ? `${code.code} is paused. Orders already placed keep their discount.`
            : action === 'resume'
              ? `${code.code} is live again.`
              : `${code.code} is deleted.`,
        )
        router.refresh()
        return
      }

      const body = await response.json().catch(() => null)
      const refusedCode = body?.error?.code ?? null

      if (response.status === 403 && refusedCode === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : ''

      setConfirming(false)
      setError(message || describeApiRefusal({ status: response.status, code: refusedCode }).detail)
    } catch {
      setError('The service is not responding. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="text-sm text-ink-muted empty:hidden">
        {status}
      </p>

      {confirming ? (
        <div className="rounded-control border border-line-strong bg-surface-subtle p-3">
          <p className="text-sm text-ink">
            Delete {code.code}? Nobody has used it. Once deleted, buyers who type it are told it
            does not exist.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={busy === 'delete'}
              disabled={busy !== null}
              onClick={() => void send('delete')}
            >
              Delete {code.code}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {code.active ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy === 'pause'}
              disabled={busy !== null}
              onClick={() => void send('pause')}
              aria-label={`Pause ${code.code}`}
            >
              Pause
            </Button>
          ) : ended ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy === 'resume'}
              disabled={busy !== null || stepUp}
              onClick={() => void send('resume')}
              aria-label={`Resume ${code.code}`}
            >
              Resume
            </Button>
          )}
          {cannotDelete ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setError(null)
                setConfirming(true)
              }}
              aria-label={`Delete ${code.code}`}
            >
              Delete
            </Button>
          )}
        </div>
      )}

      {cannotDelete && !confirming ? (
        <p className="text-sm text-ink-muted">{cannotDelete}</p>
      ) : null}
      {ended ? (
        <p className="text-sm text-ink-muted">
          Its window has ended, so it cannot be resumed. Make a new code instead.
        </p>
      ) : null}

      {error ? (
        <Alert variant="error" title="Not changed">
          {error}
        </Alert>
      ) : null}

      {stepUp ? (
        <StepUpPrompt
          action={`resume ${code.code}`}
          onConfirmed={() => {
            setStepUp(false)
            void send('resume')
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : null}
    </div>
  )
}
