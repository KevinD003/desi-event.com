'use client'

/**
 * Cancelling one night of a live event, and refunding its tickets.
 *
 * The server decides what that touches: it counts the orders for the night,
 * which are refunded, which hold every-night tickets and are only told, which
 * were free and which are disputed, and refuses a night that has started or is
 * the last one still on. This reads that preview
 * (`GET /v1/events/:id/sessions/:sessionId/cancellation`), shows it in
 * sentences built from the counts, and sends back the number of orders it
 * showed (`expectedOrders`, the preview's `orders`) so a sale made while the
 * person was reading refuses the cancellation (`ORDERS_CHANGED`) rather than
 * refunding an order nobody saw. On that refusal it reads the preview again.
 *
 * Bookings made to pay at the venue (the preview's `atVenue`, SPEC3 §9.7): only
 * their booking fee paid online is refunded, simulated, and any payment taken
 * at the door is held by the organiser, which The Desi Events neither holds nor
 * can refund.
 *
 * A reason, a ticked box and, when the server asks, a second factor
 * (EVENT_CANCEL). An inline region: focus to its heading on opening, back to
 * the opener on cancelling, every message polite.
 *
 * Once the night is cancelled the region keeps saying so, with focus on that
 * outcome, until the person closes it; the owner keeps it drawn for that long
 * even though the night is no longer one that can be cancelled, and moves
 * focus when it closes (`onClosed`). A cancelled night offers no opener again.
 * The owner hands the outcome back (`outcome`) when it draws the region afresh,
 * having taken it away while the cancellation was on its way, so what happened
 * is said, and focused, all the same.
 *
 * @module components/cancel-session-dialog
 */

import { useEffect, useId, useRef, useState } from 'react'

import { ControlReasonField } from './control-reason-field.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { atVenueSentences } from '../lib/door.js'
import {
  nightCancellationSentences,
  reasonProblem,
  refundSummarySentence,
} from '../lib/event-control.js'
import { refusalSentence } from '../lib/refusal.js'
import { sessionDisplayLabel } from '../lib/sessions.js'

/**
 * @typedef {object} CancelSessionDialogProps
 * @property {string} eventId The event.
 * @property {{id: string, startsAt: string, label?: string|null, timezone?: string}} session The night.
 * @property {string} [timeZone] The event's zone, to read the night in.
 * @property {{session: object, refunds: object|null}|null} [outcome] What cancelling the night
 *   answered, when it is already cancelled: the region opens on it.
 * @property {Function} onCancelled Given `{ session, refunds }` once the night is cancelled.
 * @property {Function} [onClosed] Called when the person closes the outcome of a cancellation;
 *   the dialog then draws nothing, so the owner moves focus.
 */

/**
 * The button and, once pressed, the region.
 *
 * @param {CancelSessionDialogProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function CancelSessionDialog({
  eventId,
  session,
  timeZone,
  outcome = null,
  onCancelled,
  onClosed,
}) {
  const id = useId()
  const openerRef = useRef(null)
  const headingRef = useRef(null)
  const summaryRef = useRef(null)
  const resultRef = useRef(null)
  const openedOnOutcome = useRef(Boolean(outcome))
  const focusAfterRender = useFocusAfterRender()
  const [open, setOpen] = useState(Boolean(outcome))
  const [preview, setPreview] = useState(null)
  const [readFailure, setReadFailure] = useState(null)
  const [changedNote, setChangedNote] = useState(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [problems, setProblems] = useState([])
  const [refusal, setRefusal] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(outcome)
  const night = sessionDisplayLabel(session, { timeZone })
  const errors = Object.fromEntries(problems.map((problem) => [problem.field, problem.message]))
  const base = `/v1/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(session.id)}`

  // Opened on an outcome: what had focus went with the region it replaces, so
  // focus goes to what happened, as it does when the answer arrives here.
  useEffect(() => {
    if (openedOnOutcome.current) resultRef.current?.focus()
  }, [])

  /**
   * Ask the server what cancelling the night would do now.
   *
   * @returns {Promise<void>} Resolves once it is read.
   */
  async function readPreview() {
    setReadFailure(null)

    try {
      const response = await apiFetch(`${base}/cancellation`)
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setPreview(body.data)
        return
      }

      setReadFailure(
        refusalSentence(
          response.status,
          body,
          'What cancelling the night would do could not be read.',
        ),
      )
    } catch {
      setReadFailure('The service is not responding. Nothing has been cancelled.')
    }
  }

  /**
   * Send the cancellation.
   *
   * @param {object} [submitted] The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(submitted) {
    submitted?.preventDefault()
    setRefusal(null)
    setChangedNote(null)

    const found = []
    const reasonIssue = reasonProblem(reason)

    if (reasonIssue) found.push({ field: 'reason', message: reasonIssue })
    if (!confirmed) {
      found.push({ field: 'confirm', message: 'Tick the box to confirm the cancellation.' })
    }

    setProblems(found)

    if (found.length > 0) {
      focusAfterRender(summaryRef)
      return
    }

    setBusy(true)

    try {
      const response = await apiFetch(`${base}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          revision: preview.revision,
          reason: reason.trim(),
          confirm: true,
          // The number of orders the preview showed: a sale since then
          // refuses the cancellation rather than refunding it unseen.
          expectedOrders: preview.orders,
        }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setResult(body.data)
        // The form, and the button that had focus, are gone: focus goes to
        // what happened, which stays until the person closes it.
        focusAfterRender(resultRef)
        onCancelled?.(body.data)
        return
      }

      const code = body?.error?.code ?? null

      if (code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      if (code === 'ORDERS_CHANGED' || code === 'STALE_REVISION') {
        await readPreview()
        setChangedNote(
          `${refusalSentence(response.status, body, 'The night changed.')} What cancelling it does now is shown below; read it again before you confirm.`,
        )
        setConfirmed(false)
        focusAfterRender(headingRef)
        return
      }

      setRefusal(refusalSentence(response.status, body, 'The night was not cancelled.'))
      focusAfterRender(summaryRef)
    } catch {
      setRefusal('The service is not responding. Nothing has been cancelled.')
      focusAfterRender(summaryRef)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    // Closed after cancelling: the night is cancelled, so nothing to offer.
    if (result) return null

    return (
      <Button
        ref={openerRef}
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          setOpen(true)
          setResult(null)
          setProblems([])
          focusAfterRender(headingRef)
          await readPreview()
        }}
      >
        Cancel this night…
      </Button>
    )
  }

  const headingId = `${id}-heading`
  const decidable = preview && !preview.refusal && preview.permitted

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-status-danger/30 bg-surface-raised p-4"
    >
      <h4
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold text-ink focus-visible:outline-none"
      >
        Cancel the night of {night}
      </h4>

      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {!preview && !readFailure && !result ? 'Reading what cancelling this night would do…' : ''}
        {busy ? 'Cancelling the night and refunding its orders…' : ''}
      </p>

      {readFailure ? (
        <Alert variant="error" title="Not read">
          <p>{readFailure}</p>
        </Alert>
      ) : null}

      {changedNote ? (
        <Alert variant="warning" title="The night has changed">
          <p>{changedNote}</p>
        </Alert>
      ) : null}

      {result ? (
        <div ref={resultRef} tabIndex={-1} className="space-y-3 focus-visible:outline-none">
          <Alert variant="success" title="Night cancelled">
            <p>
              Its tickets no longer work at the door.{' '}
              {refundSummarySentence(result.refunds) ?? 'Nobody was owed a refund.'}
            </p>
          </Alert>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false)
              onClosed?.()
            }}
          >
            Close
          </Button>
        </div>
      ) : null}

      {preview && !result && preview.refusal ? (
        <Alert variant="warning" title="This night cannot be cancelled">
          <p>{preview.refusal.message}</p>
        </Alert>
      ) : null}

      {preview && !result && !preview.refusal && !preview.permitted ? (
        <Alert variant="info" title="Somebody else decides this">
          <p>{preview.missing}</p>
        </Alert>
      ) : null}

      {decidable && !result ? (
        <form onSubmit={send} noValidate className="space-y-4">
          {problems.length > 0 || refusal ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:outline-none"
            >
              <h5 className="text-sm font-semibold text-status-danger">
                {refusal ? 'Not cancelled' : 'Before this night can be cancelled'}
              </h5>
              {refusal ? <p className="mt-1 text-sm text-status-danger">{refusal}</p> : null}
              {problems.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
                  {problems.map((problem) => (
                    <li key={problem.field}>
                      <a className="underline underline-offset-4" href={`#${id}-${problem.field}`}>
                        {problem.message}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2 text-sm text-ink">
            {[
              ...nightCancellationSentences(preview),
              ...atVenueSentences(preview.atVenue, preview.currency ?? 'USD'),
            ].map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>

          <ControlReasonField
            id={`${id}-reason`}
            label="Why is this night being cancelled?"
            value={reason}
            onChange={setReason}
            error={errors.reason ?? null}
            disabled={busy}
          />

          <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              id={`${id}-confirm`}
              checked={confirmed}
              disabled={busy}
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? `${id}-confirm-error` : undefined}
              onChange={(change) => setConfirmed(change.target.checked)}
              className="mt-1 size-4 rounded border-line-strong"
            />
            I understand these orders are refunded and this night cannot be brought back
          </label>
          {errors.confirm ? (
            <p id={`${id}-confirm-error`} className="text-sm font-medium text-status-danger">
              {errors.confirm}
            </p>
          ) : null}

          {!stepUp ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" loading={busy}>
                Cancel this night and refund it
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  focusAfterRender(openerRef)
                }}
              >
                Keep this night
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {decidable && !result && stepUp ? (
        <StepUpPrompt
          action="cancel this night"
          onConfirmed={() => {
            setStepUp(false)
            send()
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : null}

      {!decidable && !result ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            focusAfterRender(openerRef)
          }}
        >
          Close
        </Button>
      ) : null}
    </section>
  )
}
