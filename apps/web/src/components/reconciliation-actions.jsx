'use client'

/**
 * What an operator may do to one reconciliation item.
 *
 * ## The list is short on purpose
 *
 * Claim it, ask the provider again, resolve it, escalate it, write down what
 * you found. Not: edit the payment, edit the order, set a status, change an
 * amount. An operations tool that can write a payment status is a tool that can
 * mark an unpaid order paid, and the person doing it would be acting on a
 * screen rather than on evidence. Every one of these five ends in the domain
 * service deciding, from what the provider says *now*, what happens to money.
 *
 * ## The buttons are not the authorisation
 *
 * An action not offered here is refused by the API as well: the transition
 * table and the verdict rules run inside the same transaction as the write, and
 * two operators pressing at the same moment produce one outcome and one
 * conflict. So what this component does with `mayAct` is decide what to *draw*,
 * and being wrong about it costs a confusing error rather than a wrong write.
 *
 * `UNKNOWN` and `CONFLICT` are the two verdicts that may not close an item.
 * Nothing here enforces that either — the resolve route re-queries the provider
 * and refuses — but the wording says so, because an operator who understands
 * why a button will fail is an operator who stops pressing it.
 *
 * @module components/reconciliation-actions
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Button, FormField, Select, Textarea } from './ui.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'

/**
 * How an item may be closed, and what each one claims.
 *
 * The server decides which of these the evidence supports; this is the
 * vocabulary, written out so the reason is on screen beside the choice rather
 * than in a runbook somebody has not opened.
 *
 * @type {ReadonlyArray<{value: string, label: string, meaning: string}>}
 */
const RESOLUTIONS = Object.freeze([
  {
    value: 'SETTLED_FROM_PROVIDER',
    label: 'Settled — the provider confirms the money moved',
    meaning: 'Finishes what was left half-done. Only offered when the provider says so now.',
  },
  {
    value: 'RELEASED_FROM_PROVIDER',
    label: 'Released — the provider confirms it did not',
    meaning: 'Undoes what was reserved. Only offered when the provider says so now.',
  },
  {
    value: 'ALREADY_CONSISTENT',
    label: 'Already consistent — something else finished it',
    meaning: 'No money moves. The item was stale by the time anybody looked.',
  },
  {
    value: 'NO_ACTION_REQUIRED',
    label: 'No action required — recorded, nothing to apply',
    meaning: 'No money moves. Use this for work done outside this system.',
  },
])

/**
 * The five things, and what each one asks for.
 *
 * `states` is which task states the action makes sense in, mirroring the
 * server's transition table. A resolved item has no actions at all.
 *
 * @type {ReadonlyArray<object>}
 */
const ACTIONS = Object.freeze([
  {
    key: 'claim',
    path: 'claim',
    label: 'Claim it',
    description: 'Takes it off the queue and puts your name on it, so two people do not both look.',
    states: ['OPEN'],
    tone: 'secondary',
    needsNote: false,
    needsResolution: false,
  },
  {
    key: 'requery',
    path: 'requery',
    label: 'Ask the provider again',
    description:
      'Reads the provider’s current answer and records it. Changes nothing about the payment by itself.',
    states: ['OPEN', 'IN_PROGRESS', 'ESCALATED'],
    tone: 'secondary',
    needsNote: false,
    needsResolution: false,
  },
  {
    key: 'resolve',
    path: 'resolve',
    label: 'Resolve it',
    description:
      'Asks the provider once more and applies what it says. Refused while the provider cannot say, or while it and this system disagree — an unknown state is not a failure, and a conflict is not a decision.',
    states: ['OPEN', 'IN_PROGRESS', 'ESCALATED'],
    tone: 'primary',
    needsNote: true,
    needsResolution: true,
    minNote: 10,
  },
  {
    key: 'escalate',
    path: 'escalate',
    label: 'Escalate it',
    description: 'Says this needs somebody else. It stays open; escalating is asking for help.',
    states: ['OPEN', 'IN_PROGRESS'],
    tone: 'secondary',
    needsNote: true,
    needsResolution: false,
    minNote: 4,
  },
  {
    key: 'note',
    path: 'notes',
    label: 'Write down what you found',
    description: 'Appended to the item’s history with your name and the time. Nothing is replaced.',
    states: ['OPEN', 'IN_PROGRESS', 'ESCALATED'],
    tone: 'secondary',
    needsNote: true,
    needsResolution: false,
    minNote: 4,
  },
])

/**
 * @typedef {object} ReconciliationActionsProps
 * @property {object} task The item, as the API returned it.
 * @property {boolean} mayAct Whether this account holds the platform capability.
 */

/**
 * The action panel.
 *
 * @param {ReconciliationActionsProps} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export function ReconciliationActions({ task, mayAct }) {
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState(RESOLUTIONS[0].value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const returnFocus = useRef(null)

  const available = ACTIONS.filter((action) => action.states.includes(task.state))
  const action = ACTIONS.find((candidate) => candidate.key === pending) ?? null

  if (!mayAct) {
    return (
      <p className="mt-4 rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Resolving payment reconciliation is platform work. You can see this item because it belongs
        to an organisation you have finance access to; acting on it needs a capability no
        organisation role carries.
      </p>
    )
  }

  if (available.length === 0) {
    return (
      <p className="mt-4 rounded-card border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        This item is resolved. Its history stays readable and nothing here can reopen it — a closed
        item that could be reopened is an audit trail that can be rewritten.
      </p>
    )
  }

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
    setError(null)
    setDetail(null)
    setNote('')
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
   * Send the action.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    if (!action) return

    setBusy(true)
    setError(null)
    setDetail(null)

    try {
      const body = {}

      if (action.needsNote) body.note = note.trim()
      if (action.needsResolution) body.resolution = resolution

      const response = await apiFetch(
        `/v1/operations/reconciliation/${encodeURIComponent(task.id)}/${action.path}`,
        {
          method: 'POST',
          body: action.needsNote || action.needsResolution ? JSON.stringify(body) : undefined,
        },
      )

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setNote('')
        setAnnouncement(`${action.label} — done.`)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        // The server decides when, under a window this page cannot see.
        setStepUp(true)
        return
      }

      setError(parsed?.error?.message ?? 'That was refused.')
      // `why` is the provider's own account of the disagreement, and it is the
      // most useful sentence on the screen when a resolve is refused.
      setDetail(parsed?.error?.details?.why ?? null)
      queueMicrotask(() => panelRef.current?.focus())
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  const tooShort = action?.needsNote && note.trim().length < (action.minNote ?? 4)

  return (
    <div className="mt-4">
      <p aria-live="polite" role="status" className="text-sm text-slate-700">
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
              <p className="mt-1 text-sm text-slate-600">{candidate.description}</p>
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
          className="mt-3 rounded-card border border-slate-300 bg-white p-4 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          <h3 className="font-semibold text-indigo-night-900">{action.label}</h3>
          <p className="mt-1 text-sm text-slate-700">{action.description}</p>

          {error ? (
            <div className="mt-3">
              <Alert variant="error" title="Refused">
                <p>{error}</p>
                {detail ? <p className="mt-1">The provider says: {detail}</p> : null}
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

          {action.needsResolution ? (
            <div className="mt-3">
              <FormField label="How it was resolved" id="reconciliation-resolution">
                <Select
                  value={resolution}
                  onChange={(changed) => setResolution(changed.target.value)}
                >
                  {RESOLUTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <p className="mt-1 text-sm text-slate-600">
                {RESOLUTIONS.find((option) => option.value === resolution)?.meaning}
              </p>
            </div>
          ) : null}

          {action.needsNote ? (
            <div className="mt-3">
              <FormField
                label="What you found"
                id="reconciliation-note"
                required
                description={`At least ${action.minNote ?? 4} characters. It is appended to this item's history with your name and the time, and nothing already there is replaced.`}
              >
                <Textarea
                  rows={4}
                  value={note}
                  onChange={(changed) => setNote(changed.target.value)}
                />
              </FormField>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={send} disabled={busy || tooShort}>
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
