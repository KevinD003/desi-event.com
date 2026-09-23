'use client'

/**
 * What somebody may do to one refund.
 *
 * ## Three commands, and none of them names an amount
 *
 * Approve, submit, cancel. The amount was fixed when the refund was requested,
 * computed from the order's own lines, and nothing on this screen can change
 * it. A form that could would be a form that could refund more than was paid,
 * and no amount of validation makes "the browser said 90,000" a safe input.
 *
 * ## An action that is not offered is also refused
 *
 * `REFUND_TRANSITIONS` lives on the server and is not shipped here; what this
 * component has is a small mirror of which states each command makes sense in,
 * used to decide what to draw. Being wrong about it costs a clear error rather
 * than a wrong write, because the API runs the real table inside the same
 * transaction as the write — so two people pressing Submit at the same moment
 * produce one submission and one conflict, and a refund already sent cannot be
 * sent again.
 *
 * Separation of duties is the same shape: the person who asked for a refund may
 * not approve their own unless they hold the capability that says one person
 * may do both. This screen does not try to work that out. It sends the command
 * and repeats the refusal, which arrives with its own code.
 *
 * ## What is never shown and never asked for
 *
 * A card number, a CVC, an expiry, a token, a provider secret. Giving money
 * back needs the payment this system already holds a reference to; anything
 * that asked a person to type a card into a refund screen would be a phishing
 * page with a legitimate URL.
 *
 * @module components/refund-actions
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Select, Textarea } from './ui.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'

/**
 * The three commands, and which states each makes sense in.
 *
 * A mirror of the server's transition table, deliberately partial: this decides
 * what to draw, and the server decides what happens.
 *
 * @type {ReadonlyArray<object>}
 */
const ACTIONS = Object.freeze([
  {
    key: 'approve',
    label: 'Approve',
    description:
      'Says this refund should go. Nothing is sent yet and no money moves. Somebody other than whoever asked has to do this, unless they hold the capability that says one person may do both.',
    states: ['REQUESTED', 'DECLINED', 'FAILED'],
    tone: 'primary',
    seatPolicy: false,
  },
  {
    key: 'submit',
    label: 'Send it to the provider',
    description:
      'The step that moves money. The provider is called with no database transaction open, and the outcome — including “the provider did not answer” — is recorded as it arrives rather than assumed.',
    states: ['APPROVED'],
    tone: 'primary',
    seatPolicy: true,
  },
  {
    key: 'cancel',
    label: 'Cancel it',
    description:
      'Ends this refund without sending it. A refund already sent cannot be cancelled — by then the question is what the provider did, not what we intended.',
    states: ['REQUESTED', 'APPROVED', 'DECLINED', 'FAILED'],
    tone: 'danger',
    seatPolicy: false,
  },
])

/**
 * What happens to a reserved seat when the refund settles.
 *
 * Offered only on submit, because that is the command that settles anything.
 * The default is distance-based and lives on the server; this overrides it for
 * one refund and says which way.
 *
 * @type {ReadonlyArray<{value: string, label: string}>}
 */
const SEAT_POLICIES = Object.freeze([
  { value: '', label: 'Use the default for how close the event is' },
  { value: 'RESELL', label: 'Put the seat back on sale' },
  { value: 'WITHHOLD', label: 'Keep the seat off sale' },
])

/**
 * @typedef {object} RefundActionsProps
 * @property {object} refund The refund, as the API returned it.
 * @property {boolean} mayApprove Whether this account holds `order:refund_approve` here.
 * @property {boolean} maySubmit Whether this account holds `order:refund` here.
 */

/**
 * The action panel.
 *
 * @param {RefundActionsProps} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export function RefundActions({ refund, mayApprove, maySubmit }) {
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [reason, setReason] = useState('')
  const [seatPolicy, setSeatPolicy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const returnFocus = useRef(null)

  /**
   * Whether this account may issue one command.
   *
   * @param {string} key An `ACTIONS` key.
   * @returns {boolean} Whether to draw it.
   */
  const permitted = (key) => {
    if (key === 'submit') return maySubmit
    if (key === 'approve') return mayApprove
    // Cancelling is allowed to whoever could have asked or could approve; the
    // server decides which, and refuses the rest.
    return mayApprove || maySubmit
  }

  const available = ACTIONS.filter(
    (action) => action.states.includes(refund.status) && permitted(action.key),
  )
  const action = ACTIONS.find((candidate) => candidate.key === pending) ?? null

  /**
   * Open the form for one command.
   *
   * @param {string} key An `ACTIONS` key.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setPending(key)
    setError(null)
    setReason('')
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
    queueMicrotask(() => returnFocus.current?.focus())
  }

  /**
   * Send the command.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!action) return

    setBusy(true)
    setError(null)

    try {
      const body = { reason: reason.trim() }

      if (action.seatPolicy && seatPolicy) body.seatPolicy = seatPolicy

      const response = await apiFetch(
        `/v1/refunds/${encodeURIComponent(refund.id)}/${action.key}`,
        { method: 'POST', body: JSON.stringify(body) },
      )

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setReason('')
        setAnnouncement(`${action.label} — this refund is now ${parsed.data.status}.`)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      setError(parsed?.error?.message ?? 'That was refused.')
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  if (available.length === 0) {
    return (
      <p className="mt-4 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
        There is nothing to do here — either this refund has reached a state nothing follows, or the
        next step is somebody else’s. Its history stays readable either way.
      </p>
    )
  }

  const tooShort = reason.trim().length < 4

  return (
    <div className="mt-4">
      <p aria-live="polite" role="status" className="text-sm text-ink-muted">
        {announcement}
      </p>

      {pending === null ? (
        <ul className="mt-2 space-y-3">
          {available.map((candidate) => (
            <li key={candidate.key}>
              <Button
                type="button"
                variant={candidate.tone}
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
          aria-label={action.label}
          className="mt-3 rounded-card border border-line-strong bg-surface-raised p-5 shadow-card focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <h3 className="font-semibold text-ink">{action.label}</h3>
          <p className="mt-1 text-sm text-ink-muted">{action.description}</p>

          {error ? (
            <div className="mt-3">
              <Alert variant="error" title="Refused">
                <p>{error}</p>
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

          {action.seatPolicy ? (
            <div className="mt-3">
              <FormField
                label="What happens to the seat"
                id="refund-seat-policy"
                description="Only applies to reserved seating. Left alone, the server decides from how close the event is."
              >
                <Select
                  value={seatPolicy}
                  onChange={(changed) => setSeatPolicy(changed.target.value)}
                >
                  {SEAT_POLICIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}

          <div className="mt-3">
            <FormField
              label="Why"
              id="refund-reason"
              required
              description="At least four characters. Kept with the refund and with the audit record, and not editable afterwards."
            >
              <Textarea
                rows={3}
                value={reason}
                onChange={(changed) => setReason(changed.target.value)}
              />
            </FormField>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant={action.tone} onClick={send} disabled={busy || tooShort}>
              {busy ? 'Working…' : action.label}
            </Button>
            <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
