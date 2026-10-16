'use client'

/**
 * A moderator's decision on an organisation's verification.
 *
 * `POST /v1/organizations/:id/verification/decision` with a decision, a reason
 * and — when asking for more information — a note saying what is needed. The
 * decisions offered are the moderator edges of the API's transition table for
 * the current state (`lib/organization-vocabulary.js`); the API checks again in
 * the transaction that writes, and a second moderator deciding at the same
 * moment gets a conflict rather than a second decision.
 *
 * The API asks for a second factor confirmed within the last two minutes
 * (`SECURITY_ROLE`), because verification gates publishing and being paid. When
 * it does, the step-up prompt is shown and the decision is sent again after it.
 *
 * A reviewer who belongs to the organisation may not decide on it
 * (`CONFLICT_OF_INTEREST`). The page knows that from the session and passes
 * the sentence in, and no decision is offered; the API refuses all the same,
 * and its sentence is shown when it does.
 *
 * @module components/verification-decision
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button, FormField, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  DECISIONS,
  MODERATOR_DECISIONS,
  NOTE_MAX,
  REASON_LIMITS,
} from '../lib/organization-vocabulary.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} VerificationDecisionProps
 * @property {string} organizationId Which organisation.
 * @property {string} organizationName Its name, for the confirmation.
 * @property {string} status Its current verification state.
 * @property {string|null} [notYours] Why this reviewer may not decide at all, in a sentence; no decision is offered and the sentence is shown instead.
 */

/**
 * The decision form.
 *
 * @param {VerificationDecisionProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function VerificationDecision({
  organizationId,
  organizationName,
  status,
  notYours = null,
}) {
  const router = useRouter()
  const id = useId()
  const offered = MODERATOR_DECISIONS[status] ?? []
  const [decision, setDecision] = useState(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const announcementRef = useRef(null)
  // The decision buttons, by decision, so Cancel can hand focus back to the
  // one that opened the panel it closes.
  const triggerRefs = useRef({})
  const focusAfterRender = useFocusAfterRender()

  // One region in one place whatever is offered, so a decision recorded and
  // refreshed into a state with nothing left to decide is still said — and
  // focus, moved to it, is not left on a panel that is gone.
  const region = (
    <p
      ref={announcementRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="rounded-sm text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
    >
      {announcement}
    </p>
  )

  if (notYours && offered.length > 0) {
    return (
      <div className="mt-3">
        {region}
        <div className="mt-3">
          <Alert variant="info" title="Somebody else decides this">
            <p>{notYours}</p>
          </Alert>
        </div>
      </div>
    )
  }

  if (offered.length === 0) {
    return (
      <div className="mt-3">
        {region}
        <p className="mt-3 text-sm text-ink-muted">
          No decision is open to a moderator from here. The organisation may ask again from its own
          page.
        </p>
      </div>
    )
  }

  const trimmedReason = reason.trim()
  const trimmedNote = note.trim()
  const asking = decision === 'REQUIRES_INFORMATION'
  const valid =
    trimmedReason.length >= REASON_LIMITS.min &&
    trimmedReason.length <= REASON_LIMITS.max &&
    (!asking || trimmedNote.length > 0)

  /**
   * Choose one decision, opening its panel.
   *
   * @param {string} key The decision.
   * @returns {void}
   */
  function choose(key) {
    setDecision(key)
    setRefused(null)
    setStepUp(false)
    focusAfterRender(panelRef)
  }

  /**
   * Send the decision.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    setBusy(true)
    setRefused(null)

    try {
      const response = await apiFetch(
        `/v1/organizations/${encodeURIComponent(organizationId)}/verification/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            reason: trimmedReason,
            ...(asking ? { note: trimmedNote } : {}),
          }),
        },
      )
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setAnnouncement(`Recorded: ${DECISIONS[decision].label.toLowerCase()} ${organizationName}.`)
        setDecision(null)
        setReason('')
        setNote('')
        // The panel, and the button that was pressed, go with the decision.
        focusAfterRender(announcementRef)
        router.refresh()
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('retry-after') ?? null)

      setRefused(
        refusalSentence(response.status, body, 'The decision was refused.', retryAfterSeconds),
      )

      // Somebody else moved it on: show them where it stands now.
      if (response.status === 409) router.refresh()

      focusAfterRender(panelRef)
    } catch {
      setRefused(describeApiRefusal(null).detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      {region}

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Decisions">
        {offered.map((key) => (
          <Button
            key={key}
            ref={(element) => {
              triggerRefs.current[key] = element
            }}
            type="button"
            variant={decision === key ? 'primary' : 'secondary'}
            className="min-h-11"
            aria-pressed={decision === key}
            onClick={() => choose(key)}
          >
            {DECISIONS[key].label}
          </Button>
        ))}
      </div>

      {decision ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-heading`}
          className="mt-4 max-w-xl rounded-card border border-line-strong bg-surface-raised p-5 shadow-card focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
        >
          <h3 id={`${id}-heading`} className="font-semibold text-ink">
            {DECISIONS[decision].label}: {organizationName}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">{DECISIONS[decision].consequence}</p>

          {refused ? (
            <div className="mt-3">
              <Alert variant="error" title="Nothing was recorded">
                <p>{refused}</p>
              </Alert>
            </div>
          ) : null}

          {stepUp ? (
            <div className="mt-3">
              <StepUpPrompt
                action={`${DECISIONS[decision].label.toLowerCase()} ${organizationName}`}
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
              label="Reason"
              id={`${id}-reason`}
              required
              description={`Between ${REASON_LIMITS.min} and ${REASON_LIMITS.max} characters. The organisation sees it, and it is kept with the decision.`}
            >
              <Textarea
                rows={3}
                maxLength={REASON_LIMITS.max}
                value={reason}
                onChange={(changed) => setReason(changed.target.value)}
              />
            </FormField>
          </div>

          {asking ? (
            <div className="mt-3">
              <FormField
                label="What they need to send"
                id={`${id}-note`}
                required
                description={`Required when asking for information. Up to ${NOTE_MAX} characters.`}
              >
                <Textarea
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={note}
                  onChange={(changed) => setNote(changed.target.value)}
                />
              </FormField>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={decision === 'REJECTED' || decision === 'REVOKED' ? 'danger' : 'primary'}
              className="min-h-11"
              onClick={send}
              disabled={busy || !valid}
            >
              {busy ? 'Recording…' : `Record: ${DECISIONS[decision].label.toLowerCase()}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                const opener = triggerRefs.current[decision]

                setDecision(null)
                setRefused(null)
                setStepUp(false)
                // Cancel goes with the panel; the decision that opened it stays.
                opener?.focus()
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
