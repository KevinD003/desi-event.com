'use client'

/**
 * Opening an editing session on somebody else's posted event, as the team at
 * The Desi Events.
 *
 * A reason and a second factor, then a sitting of at most an hour bound to
 * this browser session (`POST /v1/platform/events/:id/edit`). The organiser
 * sees each change and the reason, never the administrator's name; every
 * change is recorded with both. The server asks for the second factor
 * (MODERATION); this only reacts to being asked.
 *
 * @module components/open-platform-edit-form
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { ControlReasonField } from './control-reason-field.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { reasonProblem } from '../lib/event-control.js'
import { refusalSentence } from '../lib/refusal.js'

/** What the team at The Desi Events is told before it opens a sitting. */
export const OPEN_EDIT_EXPLANATION =
  'The organiser sees each change you make and the reason you give here. They do not see your name. Every change is recorded with your name and this reason.'

/**
 * @typedef {object} OpenPlatformEditFormProps
 * @property {string} eventId The event.
 * @property {string} [heading] The form's heading.
 * @property {Function} [onOpened] Given the sitting once it is open; the page is refreshed either way.
 */

/**
 * The form.
 *
 * @param {OpenPlatformEditFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function OpenPlatformEditForm({
  eventId,
  heading = 'Edit this event as the team at The Desi Events',
  onOpened,
}) {
  const router = useRouter()
  const id = useId()
  const errorRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)

  /**
   * Open the sitting.
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
      const response = await apiFetch(`/v1/platform/events/${encodeURIComponent(eventId)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setOpened(true)
        onOpened?.(body.data)
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setRefusal(
        refusalSentence(response.status, body, 'The editing session was not opened.', null),
      )
      focusAfterRender(errorRef)
    } catch {
      setRefusal('The service is not responding. No editing session was opened.')
      focusAfterRender(errorRef)
    } finally {
      setBusy(false)
    }
  }

  const headingId = `${id}-heading`

  return (
    <section
      aria-labelledby={headingId}
      className="max-w-2xl space-y-4 rounded-card border border-line bg-surface-raised p-5"
    >
      <h2 id={headingId} className="text-xl font-semibold text-ink">
        {heading}
      </h2>
      <p className="text-sm text-ink">{OPEN_EDIT_EXPLANATION}</p>
      <p className="text-sm text-ink-muted">
        The session lasts an hour and works in this browser only. You confirm it is you when it
        opens, and again every 10 minutes while you keep editing.
      </p>

      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {opened ? 'Editing session open. Loading the editor…' : ''}
      </p>

      {refusal ? (
        <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
          <Alert variant="error" title="Not opened">
            <p>{refusal}</p>
          </Alert>
        </div>
      ) : null}

      <form onSubmit={send} noValidate className="space-y-4">
        <ControlReasonField
          id={`${id}-reason`}
          label="Why are you editing this event?"
          value={reason}
          onChange={setReason}
          error={reasonError}
          disabled={busy || opened}
        />
        {!stepUp ? (
          <Button type="submit" loading={busy} disabled={opened}>
            Open for editing
          </Button>
        ) : null}
      </form>

      {stepUp ? (
        <StepUpPrompt
          action="edit this event as the team at The Desi Events"
          onConfirmed={() => {
            setStepUp(false)
            send()
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : null}
    </section>
  )
}
