'use client'

/**
 * Putting one message back in the queue, or withdrawing it.
 *
 * ## Two actions, each with a reason, each behind a fresh second factor
 *
 * `POST /v1/operations/notifications/:id/retry` and `…/cancel`, both needing a
 * reason of four to five hundred characters and the `OPERATIONS` step-up
 * window. The window is the server's: this component does not guess when it
 * has lapsed, it waits to be refused and then offers the prompt, and sends the
 * same action again once it is confirmed.
 *
 * ## What is offered, and why the API may still say no
 *
 * The statuses each action accepts are in `./notification-vocabulary.js`,
 * copied from `apps/api/src/lib/notification-operations.js`. Withdrawing a
 * claimed message is offered only when the page, on the server, found the
 * worker's hold had lapsed; the hold's time itself never reaches this
 * component. A worker can still claim a message between the page being drawn
 * and the button being pressed, and the API's conditional update then matches
 * nothing and answers 409 — which is said as what it is: the message moved on.
 *
 * ## Not every 409 is a race
 *
 * The API names its reason in `error.reason`. `CHANGED` and `LEASED` mean a
 * worker or another operator got there first; `NOT_RETRYABLE` and
 * `NOT_CANCELLABLE` can only reach this panel the same way, because it offers
 * each action only in the statuses the API accepts, so the status must have
 * changed since the page was drawn. All four are "moved on", with a reload
 * that shows where the message stands now. `REDACTED` is different: the
 * message was redacted for privacy, which this screen cannot see, and
 * reloading would draw the same status and the same button. That one gets the
 * API's own sentence and no reload.
 *
 * ## What is never on this panel
 *
 * The recipient, the payload, the worker's lease. None is needed to decide
 * whether a message should be tried again, and an operations screen that
 * showed them would be a way to read somebody's mail.
 *
 * @module app/operations/notifications/notification-actions
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { StepUpPrompt } from '../../../components/step-up-prompt.jsx'
import { Alert, Button, FormField, Textarea } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import {
  HANDED_TO,
  REASON_MAX,
  REASON_MIN,
  mayCancel,
  mayRetry,
} from './notification-vocabulary.js'

/**
 * The two actions, and what each one does.
 *
 * @type {ReadonlyArray<{key: string, label: string, description: string, tone: string, done: string}>}
 */
const ACTIONS = Object.freeze([
  {
    key: 'retry',
    label: 'Put it back in the queue',
    description: `Due now, with its attempts counted from zero. A worker then hands it to ${HANDED_TO}; nothing is sent from this page. Use this once whatever stopped it is fixed.`,
    tone: 'primary',
    done: `Back in the queue. A worker will hand it to ${HANDED_TO}; until then nothing has been sent.`,
  },
  {
    key: 'cancel',
    label: 'Withdraw it',
    description:
      'For good: it will not be sent, and nothing on this screen can put it back. Use this for a message that should never go.',
    tone: 'danger',
    done: 'Withdrawn. It will not be sent.',
  },
])

/**
 * @typedef {object} Refused
 * @property {string|null} title A heading of its own, for a refusal that has one.
 * @property {string} sentence What to tell the person.
 * @property {boolean} stale Whether the message moved on, so reloading is the way forward.
 * @property {boolean} enrol Whether setting up a second factor is the way forward.
 */

/**
 * The 409 reasons that are not a race: reloading changes nothing about them.
 *
 * @type {ReadonlyArray<string>}
 */
const SETTLED_CONFLICTS = Object.freeze(['REDACTED'])

/**
 * What a refused action should say.
 *
 * @param {Response} response The refused response.
 * @param {object|null} body Its parsed body.
 * @returns {Refused} The words.
 */
function refusedBecause(response, body) {
  if (response.status === 409 && SETTLED_CONFLICTS.includes(body?.error?.reason)) {
    return {
      title: null,
      sentence: refusalSentence(409, body, 'This message cannot be changed from here.'),
      stale: false,
      enrol: false,
    }
  }

  if (response.status === 409) {
    return {
      title: 'The notification moved on while you were looking; reload.',
      sentence: refusalSentence(409, body, 'Its status changed underneath this page.'),
      stale: true,
      enrol: false,
    }
  }

  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

    return {
      title: null,
      sentence: describeApiRefusal({ status: 429, retryAfterSeconds }).detail,
      stale: false,
      enrol: false,
    }
  }

  return {
    title: null,
    sentence: refusalSentence(response.status, body, 'That was refused. Nothing was changed.'),
    stale: false,
    enrol: body?.error?.code === 'MFA_ENROLMENT_REQUIRED',
  }
}

/**
 * @typedef {object} NotificationActionsProps
 * @property {{id: string, status: string}} notification The message: its id and status, nothing else.
 * @property {boolean} leaseLapsed For a claimed message, whether the worker's hold had lapsed when the page was drawn.
 */

/**
 * The action panel.
 *
 * @param {NotificationActionsProps} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export function NotificationActions({ notification, leaseLapsed }) {
  const router = useRouter()
  const id = useId()
  const [pending, setPending] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const returnFocus = useRef(null)

  const available = ACTIONS.filter((action) =>
    action.key === 'retry'
      ? mayRetry(notification.status)
      : mayCancel(notification.status, leaseLapsed),
  )
  const action = ACTIONS.find((candidate) => candidate.key === pending) ?? null
  const trimmed = reason.trim()
  const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX

  /**
   * Open the form for one action.
   *
   * @param {string} key An `ACTIONS` key.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setPending(key)
    setReason('')
    setRefused(null)
    setStepUp(false)
    queueMicrotask(() => panelRef.current?.focus())
  }

  /**
   * Close the form and put focus back.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUp(false)
    setRefused(null)
    queueMicrotask(() => returnFocus.current?.focus())
  }

  /**
   * Send the open action.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!action) return

    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/operations/notifications/${encodeURIComponent(notification.id)}/${action.key}`,
        { method: 'POST', body: JSON.stringify({ reason: trimmed }) },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setReason('')
        setAnnouncement(action.done)
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        // The server decides when, under a window this page cannot see.
        setStepUp(true)
        return
      }

      setRefused(refusedBecause(response, body))
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setRefused({
        title: null,
        sentence: describeApiRefusal(null).detail,
        stale: false,
        enrol: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <p aria-live="polite" role="status" className="text-sm font-medium text-ink">
        {announcement}
      </p>

      {available.length === 0 ? (
        <p className="mt-2 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
          {notification.status === 'CLAIMED'
            ? 'A worker holds this message. It will be handed over, retried or dead-lettered without anybody here; if it dead-letters, it can be put back in the queue then.'
            : 'There is nothing to do with a message in this state. Its record stays readable.'}
        </p>
      ) : null}

      {pending === null && available.length > 0 ? (
        <ul className="mt-2 space-y-3">
          {available.map((candidate) => (
            <li key={candidate.key}>
              <Button
                type="button"
                variant={candidate.tone === 'danger' ? 'secondary' : 'primary'}
                className="min-h-11"
                onClick={(pressed) => begin(candidate.key, pressed.currentTarget)}
              >
                {candidate.label}
              </Button>
              <p className="mt-1 text-sm text-ink-muted">{candidate.description}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className={`mt-3 rounded-card border p-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
            action.tone === 'danger'
              ? 'border-status-danger/25 bg-status-danger-soft'
              : 'border-line-strong bg-surface-raised'
          }`}
        >
          <h3
            id={`${id}-heading`}
            className={`font-semibold ${action.tone === 'danger' ? 'text-status-danger' : 'text-ink'}`}
          >
            {action.label}
          </h3>
          <p className="mt-1 text-sm text-ink">{action.description}</p>

          {refused ? (
            <div className="mt-3">
              <Alert variant="error" title={refused.title ?? 'Nothing was changed'}>
                <p>{refused.sentence}</p>
                {refused.stale ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2 min-h-11"
                    onClick={() => {
                      setPending(null)
                      setRefused(null)
                      router.refresh()
                    }}
                  >
                    Reload this message
                  </Button>
                ) : null}
                {refused.enrol ? (
                  <p className="mt-2">
                    <Link
                      href="/account/security"
                      className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      Set up two-step sign-in
                    </Link>
                  </p>
                ) : null}
              </Alert>
            </div>
          ) : null}

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={action.label.toLowerCase()}
                onConfirmed={() => {
                  setStepUp(false)
                  void send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          <div className="mt-3">
            <FormField
              label="Why"
              id={`${id}-reason`}
              required
              description={`Between ${REASON_MIN} and ${REASON_MAX} characters. Kept with the audit record, with your name and the time.`}
            >
              <Textarea
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(changed) => setReason(changed.target.value)}
              />
            </FormField>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={action.tone === 'danger' ? 'danger' : 'primary'}
              className="min-h-11"
              onClick={send}
              disabled={busy || !reasonValid}
            >
              {busy ? 'Working…' : action.label}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={dismiss}
              disabled={busy}
            >
              Leave it as it is
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
