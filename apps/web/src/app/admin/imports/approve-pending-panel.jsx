'use client'

/**
 * "Approve and publish all pending imported events" (the owner, 2026-10-16:
 * "Add all the events and publish all of them on live"; ADR 0019).
 *
 * The server page reads `GET /v1/platform/imports/pending` and passes what it
 * says: how many imported events wait for approval across every import, how
 * many approving puts on sale, how many it publishes with nothing to sell (no
 * prices, or every price sold out), and how many have started and are left.
 * One button sends `POST /v1/platform/imports/approve-pending` with the
 * digest of exactly that list; the API refuses it if the list has changed
 * since, and the page is read again. A second factor within the
 * EVENT_PUBLISH window is asked for the way every import action asks for it:
 * the API answers `STEP_UP_REQUIRED`, the `StepUpPrompt` takes the factor,
 * and the request is sent once more.
 *
 * The answer says how many went on sale, how many were published with
 * nothing to sell, how many were left as past, and each refusal with its
 * event's title and the API's sentence, in a polite status region. Focus
 * moves to it only because the visitor pressed the button.
 *
 * @module app/admin/imports/approve-pending-panel
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'

/** Where the button sends. */
export const APPROVE_PENDING_PATH = '/v1/platform/imports/approve-pending'

/**
 * "1 event" or "3 events".
 *
 * @param {number} count How many.
 * @returns {string} The phrase.
 */
function events(count) {
  return `${count} ${count === 1 ? 'event' : 'events'}`
}

/**
 * What the list says approving would do, in sentences.
 *
 * @param {{total: number, willGoOnSale: number, publishedNothingToSell: number, past: number}} pending The counts.
 * @returns {string[]} One sentence per count that is not zero, the total first.
 */
export function pendingSentences(pending) {
  const { total, willGoOnSale, publishedNothingToSell, past } = pending
  const lines = []

  if (total === 0) {
    lines.push('No imported event is waiting for approval.')
  } else {
    lines.push(
      `${events(total)} imported from listing files ${total === 1 ? 'waits' : 'wait'} for approval, across every import.`,
    )
    if (willGoOnSale > 0) {
      lines.push(
        `Approving puts ${willGoOnSale === total ? (total === 1 ? 'it' : 'all of them') : events(willGoOnSale)} on sale here.`,
      )
    }
    if (publishedNothingToSell > 0) {
      lines.push(
        `${events(publishedNothingToSell)} will be published with nothing to sell: ${publishedNothingToSell === 1 ? 'its listing gives' : 'their listings give'} no price, or every price is sold out.`,
      )
    }
  }

  if (past > 0) {
    lines.push(
      `${events(past)} that ${past === 1 ? 'has' : 'have'} started, or ${past === 1 ? 'starts' : 'start'} within the minute, ${past === 1 ? 'is' : 'are'} left as ${past === 1 ? 'it is' : 'they are'}.`,
    )
  }

  return lines
}

/**
 * What approving did, in sentences.
 *
 * @param {{total: number, onSale: number, publishedNothingToSell: number, refused: number, skippedPast: number}} outcome The API's counts.
 * @returns {string[]} The sentences.
 */
export function outcomeSentences(outcome) {
  const lines = []

  if (outcome.total === 0) {
    lines.push('No imported event was waiting, so nothing was approved.')
  } else {
    lines.push(`${events(outcome.onSale)} approved, published and put on sale.`)
    if (outcome.publishedNothingToSell > 0) {
      lines.push(
        `${events(outcome.publishedNothingToSell)} approved and published with nothing to sell.`,
      )
    }
    if (outcome.refused > 0) {
      lines.push(`${events(outcome.refused)} not published: each reason is below.`)
    }
  }

  if (outcome.skippedPast > 0) {
    lines.push(`${events(outcome.skippedPast)} left as past.`)
  }

  return lines
}

/**
 * @typedef {object} ApprovePendingPanelProps
 * @property {{digest: string, total: number, willGoOnSale: number, publishedNothingToSell: number, past: number, items: Array<{eventId: string, title: string}>}} pending What the list says.
 */

/**
 * The panel.
 *
 * @param {ApprovePendingPanelProps} props Component props.
 * @returns {JSX.Element} The panel's body.
 */
export function ApprovePendingPanel({ pending }) {
  const router = useRouter()
  const focusAfterRender = useFocusAfterRender()
  const messageRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [stepUp, setStepUp] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const titles = new Map((pending.items ?? []).map((item) => [item.eventId, item.title]))

  /**
   * Send the approval.
   *
   * @param {boolean} [retried] Whether this is the one retry after a step-up.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(retried = false) {
    setBusy(true)
    setRefusal(null)
    setOutcome(null)

    try {
      const response = await apiFetch(APPROVE_PENDING_PATH, {
        method: 'POST',
        body: JSON.stringify({ digest: pending.digest }),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setOutcome(parsed?.data ?? null)
        focusAfterRender(messageRef)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED' && !retried) {
        setStepUp(true)
        return
      }

      setRefusal(
        refusalSentence(
          response.status,
          parsed,
          'Nothing was approved.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(messageRef)
      // The list changed: read it again, so the counts and the digest are now's.
      if (response.status === 409) router.refresh()
    } catch {
      setRefusal(describeApiRefusal(null).detail)
      focusAfterRender(messageRef)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <div className="max-w-3xl space-y-1 text-ink-muted">
        {pendingSentences(pending).map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          Each event is approved on its own, as on its import’s page; one that cannot be is reported
          and the rest go on. You confirm with your second factor.
        </p>
      </div>

      <div ref={messageRef} tabIndex={-1} className="mt-4 focus-visible:outline-none">
        {/* Always drawn, so what is put in it is announced; plain markup
            inside, since an Alert is a live region of its own. */}
        <div role="status" aria-live="polite">
          {outcome ? (
            <div className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
              <p className="font-semibold">Approve and publish all</p>
              {outcomeSentences(outcome).map((line) => (
                <p key={line} className="mt-1">
                  {line}
                </p>
              ))}
              {(outcome.refusals ?? []).length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {outcome.refusals.map((refused) => (
                    <li key={refused.eventId}>
                      {`${titles.get(refused.eventId) ?? 'An event'}: ${refused.message ?? 'The API refused it.'}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        {refusal ? (
          <Alert variant="error" title="Not done">
            <p>{refusal}</p>
          </Alert>
        ) : null}
      </div>

      {stepUp ? (
        <div className="mt-4">
          <StepUpPrompt
            action="approve and publish every pending imported event"
            onConfirmed={() => {
              setStepUp(false)
              void send(true)
            }}
            onCancel={() => setStepUp(false)}
          />
        </div>
      ) : null}

      {pending.total > 0 ? (
        <div className="mt-4">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || stepUp}
            onClick={() => void send()}
          >
            {busy ? 'Approving…' : `Approve and publish all ${events(pending.total)}`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
