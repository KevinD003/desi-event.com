'use client'

/**
 * Bringing a deleted event back, for the Desi-Event team alone.
 *
 * Where it comes back to is the server's rule (`restoreTarget`, the same
 * function the database's triggers call): an event on sale comes back paused,
 * so the organiser reopens sales; one that was waiting for review comes back
 * as a draft, because only a review approves. This says which before anything
 * is sent, asks for a reason, and leaves the second factor to the server to
 * ask for (EVENT_PUBLISH).
 *
 * An inline region, like the delete dialog: focus moves to its heading on
 * opening and back to its opener on cancelling, and its messages are polite.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/restore-event-dialog
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { ControlReasonField } from './control-reason-field.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { reasonProblem, restoreTargetReading } from '../lib/event-control.js'
import { statusReading } from '../lib/event-status.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} RestoreEventDialogProps
 * @property {{id: string, title: string, revision: number, deletion: object}} event The deleted event, with its `deletion` record.
 */

/**
 * The button and, once pressed, the region.
 *
 * @param {RestoreEventDialogProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function RestoreEventDialog({ event }) {
  const router = useRouter()
  const id = useId()
  const openerRef = useRef(null)
  const headingRef = useRef(null)
  const errorRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [restored, setRestored] = useState(null)

  /**
   * Send the restore.
   *
   * @param {object} [submitted] The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(submitted) {
    submitted?.preventDefault()
    setRefusal(null)

    const problem = reasonProblem(reason)

    setReasonError(problem)

    if (problem) {
      focusAfterRender(() => document.getElementById(`${id}-reason`))
      return
    }

    setBusy(true)

    try {
      const response = await apiFetch(
        `/v1/platform/events/${encodeURIComponent(event.id)}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ revision: event.revision, reason: reason.trim() }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setRestored(body.data.status)
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefusal(refusalSentence(response.status, body, 'The event was not restored.'))
      focusAfterRender(errorRef)
    } catch {
      setRefusal('The service is not responding. Nothing has been restored.')
      focusAfterRender(errorRef)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true)
          focusAfterRender(headingRef)
        }}
      >
        Restore…
      </Button>
    )
  }

  const headingId = `${id}-heading`

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-line bg-surface-raised p-4"
    >
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none"
      >
        Restore “{event.title}”
      </h3>

      {restored ? (
        <Alert variant="success" title="Restored">
          <p>It is {statusReading(restored).label.toLowerCase()} now.</p>
        </Alert>
      ) : (
        <>
          <p className="text-sm text-ink">
            {restoreTargetReading(event.deletion?.statusBefore ?? 'DRAFT')}
          </p>

          {refusal ? (
            <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
              <Alert variant="error" title="Not restored">
                <p>{refusal}</p>
              </Alert>
            </div>
          ) : null}

          <form onSubmit={send} noValidate className="space-y-4">
            <ControlReasonField
              id={`${id}-reason`}
              label="Why is this event being restored?"
              value={reason}
              onChange={setReason}
              error={reasonError}
              disabled={busy}
            />

            {!stepUp ? (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy}>
                  Restore this event
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
                  Cancel
                </Button>
              </div>
            ) : null}
          </form>

          {stepUp ? (
            <StepUpPrompt
              action="restore this event"
              onConfirmed={() => {
                setStepUp(false)
                send()
              }}
              onCancel={() => setStepUp(false)}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
