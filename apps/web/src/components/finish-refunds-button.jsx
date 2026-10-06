'use client'

/**
 * Sending the refunds a deleted or cancelled event still owes
 * (`POST /v1/events/:id/refunds/finish`).
 *
 * Deleting an event sends its refunds while the page waits, a batch at a
 * time; any left over, and any that did not go through, are sent from here.
 * The server says what is owed, and refuses with `NOTHING_OWED` when nothing
 * is; disputed orders are left to the finance team either way.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/finish-refunds-button
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { StepUpPrompt } from './step-up-prompt.jsx'
import { Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refundSummarySentence } from '../lib/event-control.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} FinishRefundsButtonProps
 * @property {string} eventId The event.
 */

/**
 * The button and what it did.
 *
 * @param {FinishRefundsButtonProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function FinishRefundsButton({ eventId }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [stepUp, setStepUp] = useState(false)
  const [message, setMessage] = useState('')

  /**
   * Send what is left.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setMessage('Sending the refunds that are left…')

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/refunds/finish`, {
        method: 'POST',
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setMessage(refundSummarySentence(body.data) ?? 'Nothing was owed.')
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setMessage('')
        setStepUp(true)
        return
      }

      setMessage(refusalSentence(response.status, body, 'The refunds were not sent.'))
    } catch {
      setMessage('The service is not responding. No refund has been sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {stepUp ? (
        <StepUpPrompt
          action="send the refunds that are left"
          onConfirmed={() => {
            setStepUp(false)
            send()
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : (
        <Button type="button" variant="secondary" loading={busy} onClick={send}>
          Finish refunds
        </Button>
      )}
      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {message}
      </p>
    </div>
  )
}
