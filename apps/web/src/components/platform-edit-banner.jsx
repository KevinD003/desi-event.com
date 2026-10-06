'use client'

/**
 * The notice at the top of the editor while the Desi-Event team edits
 * somebody else's event: whose authority, the reason given, and until when.
 *
 * The sitting ends by time (an hour at most), by "Stop editing", or when the
 * server says it is no longer open in this browser; the banner then says so
 * and offers to open it again. Writes in a sitting need a second factor from
 * the last 10 minutes: the server asks, the editor's autosave prompts and
 * resends, and "Confirm it’s you" here lets the person confirm before a save
 * from another step is refused.
 *
 * @module components/platform-edit-banner
 */

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { OpenPlatformEditForm } from './open-platform-edit-form.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  PLATFORM_STEP_UP_SENTENCE,
  SITTING_ENDED_SENTENCE,
  clockTime,
} from '../lib/event-control.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} PlatformEditBannerProps
 * @property {string} eventId The event.
 * @property {{reason: string, expiresAt: string, organizationName?: string|null}} sitting The open sitting, and whose event it is.
 * @property {boolean} [ended] Whether a write was refused because the sitting is no longer open.
 * @property {string} [closeHref] Where "Stop editing" goes.
 * @property {string} [timeZone] The zone "Until 7:40 PM EDT" is read in: the event's own, named, so the server's rendering and the browser's agree.
 * @property {Function} [now] The clock, for tests.
 */

/**
 * The banner.
 *
 * @param {PlatformEditBannerProps} props Component props.
 * @returns {JSX.Element} The notice.
 */
export function PlatformEditBanner({
  eventId,
  sitting,
  ended = false,
  closeHref = '/admin/events',
  timeZone = 'UTC',
  now = Date.now,
}) {
  const router = useRouter()
  const expiresAt = new Date(sitting.expiresAt).getTime()
  const [expired, setExpired] = useState(() => now() >= expiresAt)
  const [stepUp, setStepUp] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [failure, setFailure] = useState(null)

  // The sitting runs out by time; say so at the moment it does rather than at
  // the next refused save. Worked out again for every sitting the page hands
  // down: one opened again after this ran out arrives through
  // `router.refresh()`, which keeps this component's state.
  useEffect(() => {
    const left = expiresAt - now()

    setExpired(left <= 0)

    if (left <= 0) return undefined

    const timer = setTimeout(() => setExpired(true), Math.min(left, 2 ** 31 - 1))

    return () => clearTimeout(timer)
  }, [expiresAt, now])

  /**
   * Close the sitting and go back to the list.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function stop() {
    setClosing(true)
    setFailure(null)

    try {
      const response = await apiFetch(
        `/v1/platform/events/${encodeURIComponent(eventId)}/edit/close`,
        { method: 'POST' },
      )

      if (response.ok) {
        router.push(closeHref)
        return
      }

      const body = await response.json().catch(() => null)

      setFailure(refusalSentence(response.status, body, 'The editing session was not closed.'))
    } catch {
      setFailure('The service is not responding. The editing session is still open.')
    } finally {
      setClosing(false)
    }
  }

  if (expired || ended) {
    return (
      <div className="mt-4 space-y-4">
        <Alert variant="warning" title="Editing as the Desi-Event team">
          <p>{SITTING_ENDED_SENTENCE}</p>
        </Alert>
        <OpenPlatformEditForm eventId={eventId} heading="Open it again" />
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-3">
      <Alert variant="info" title="Editing as the Desi-Event team">
        {sitting.organizationName ? (
          <p className="mb-1">This is {sitting.organizationName}’s event.</p>
        ) : null}
        <p>
          Reason:{' '}
          {String(sitting.reason)
            .trim()
            .replace(/[.!?]+$/u, '')}
          . Until {clockTime(sitting.expiresAt, timeZone)}.
        </p>
        <p className="mt-1">{PLATFORM_STEP_UP_SENTENCE}</p>
        {confirmed ? <p className="mt-1">Confirmed. Saves can carry on.</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={stepUp}
            onClick={() => {
              setConfirmed(false)
              setStepUp(true)
            }}
          >
            Confirm it’s you
          </Button>
          <Button type="button" variant="ghost" size="sm" loading={closing} onClick={stop}>
            Stop editing
          </Button>
        </div>
        {failure ? <p className="mt-2 font-medium">{failure}</p> : null}
      </Alert>
      {stepUp ? (
        <StepUpPrompt
          action="keep editing this event"
          onConfirmed={() => {
            setStepUp(false)
            setConfirmed(true)
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : null}
    </div>
  )
}
