'use client'

/**
 * A moderator's decision on one event.
 *
 * Three outcomes, one endpoint, and they are deliberately not three buttons of
 * equal weight:
 *
 *   - **Request changes** is the common one and needs the most from the
 *     moderator: a reason the organiser can act on, and optionally a note
 *     against each field. "Rejected, see guidelines" is a decision nobody can do
 *     anything with.
 *   - **Approve** says the listing is fit to be public. It does not publish it —
 *     that is the organiser's decision and their timing.
 *   - **Reject** ends it. It needs a reason and a second press.
 *
 * The reason is sent to the organiser. It is not public, the moderator's
 * identity is not in the payload at all, and a decision is refused unless the
 * session has authenticated again recently — the API decides when, under the
 * `MODERATION` policy, and this only reacts to being told.
 *
 * Nothing here checks whether the transition is legal. The server has the
 * table, runs it inside the same transaction as the write, and a second
 * moderator pressing at the same moment gets a conflict rather than a second
 * decision.
 *
 * ## Somebody else decides
 *
 * A reviewer who belongs to the event's organisation may not decide on it
 * (`CONFLICT_OF_INTEREST`), and nor may the person who sent it for review
 * (`SELF_REVIEW`). The page knows the first from the session and passes the
 * sentence in, and the controls are not drawn; the API refuses both all the
 * same, and its sentence is shown when it does.
 *
 * ## Approval names the version it approves
 *
 * The API refuses an approval that does not say which revision the moderator
 * saw, so a version nobody has looked at cannot be approved. Every decision
 * carries the revision this page showed; when the page has none to send,
 * approving is not offered.
 *
 * @module components/moderation-decision
 */

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { Alert, Button, FormField, Select, Textarea } from './ui.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { statusReading } from '../lib/event-status.js'

/**
 * The three decisions, and what each one asks for.
 *
 * @type {Readonly<Record<string, {label: string, verb: string, tone: string, needsReason: boolean, confirm: string|null}>>}
 */
const DECISIONS = Object.freeze({
  request_changes: {
    label: 'Request changes',
    verb: 'Requesting changes',
    tone: 'primary',
    needsReason: true,
    confirm: null,
  },
  approve: {
    label: 'Approve',
    verb: 'Approving',
    tone: 'primary',
    needsReason: false,
    confirm:
      'Approving says this listing is fit to be public. The organiser chooses when to publish it.',
  },
  reject: {
    label: 'Reject',
    verb: 'Rejecting',
    tone: 'danger',
    needsReason: true,
    confirm: 'Rejecting ends this submission. The organiser will have to start a new draft.',
  },
})

/**
 * The wording for an event nobody runs on The Desi Events (a platform-held
 * import, SPEC2-XI O16): the reason is sent to nobody, and the import's run
 * page publishes it once approved.
 */
const NO_EDITOR_WORDING = Object.freeze({
  approve:
    'Approving says this listing is fit to be public. It is published from its import run, with “Approve and publish”.',
  reject:
    'Rejecting ends this submission. A later import of its listing leaves it alone until the event is deleted.',
  reason:
    'Kept on the event’s record. Nobody runs this event on The Desi Events, so it is sent to nobody.',
  note: 'Optional. Kept on the event’s record.',
})

/** Why approving is not offered when the page does not know the version it showed. */
export const NO_REVISION_TO_APPROVE =
  'Approving is not offered: this page does not say which version of the event it shows, and an approval has to name the version it approves. Reload the page. Asking for changes and rejecting are still available.'

/**
 * Fields a moderator can attach a specific note to.
 *
 * A fixed list, because "fix the listing" is not something an organiser can
 * act on and "the description does not say which language the show is in" is.
 *
 * @type {ReadonlyArray<string[]>}
 */
const FIELDS = Object.freeze([
  ['title', 'Title'],
  ['summary', 'Summary'],
  ['description', 'Description'],
  ['category', 'Category'],
  ['images', 'Pictures'],
  ['policies', 'Policies'],
  ['venue', 'Venue'],
  ['ticketTypes', 'Ticket types'],
  ['performers', 'Line-up'],
  ['runningOrder', 'Running order'],
  ['faq', 'Questions people ask'],
  ['socialLinks', 'Links'],
  ['sponsors', 'Sponsors'],
  ['publicContact', 'Public contact'],
  ['dressCode', 'Dress code'],
  ['directions', 'Parking and directions'],
])

/**
 * @typedef {object} ModerationDecisionProps
 * @property {object} event The event under review. Its `revision` is sent with the decision, so a decision is only ever taken on the version this page showed.
 * @property {Function} [onDecided] Called with the new status once the server accepts.
 * @property {string|null} [approveBlockedReason] Why approving is not offered now, in a sentence; approving is then disabled and the sentence shown. Used when the page could not show everything an approval would approve.
 * @property {string|null} [notYours] Why this reviewer may not decide on this event at all, in a sentence; no decision is offered and the sentence is shown instead.
 * @property {string|null} [noEditor] Why nobody could make changes to this event (a platform-held import), in a sentence; "Request changes" is not offered, the sentence is shown, and the reason is said to go to nobody.
 */

/**
 * The decision form.
 *
 * @param {ModerationDecisionProps} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export function ModerationDecision({
  event,
  onDecided,
  approveBlockedReason = null,
  notYours = null,
  noEditor = null,
}) {
  const router = useRouter()
  const [pending, setPending] = useState(null)
  const [reason, setReason] = useState('')
  const [field, setField] = useState(FIELDS[0][0])
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [stepUp, setStepUp] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const returnFocus = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  /**
   * Open the form for one decision.
   *
   * @param {string} key A key of `DECISIONS`.
   * @param {object} trigger The pressed element, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    returnFocus.current = trigger
    setPending(key)
    setError(null)
    setProblems([])
    focusAfterRender(panelRef)
  }

  /**
   * Close the form and put focus back.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUp(false)
    focusAfterRender(returnFocus)
  }

  /**
   * Attach a note to one field.
   *
   * @returns {void}
   */
  function addNote() {
    const text = reason.trim()

    if (!text) return

    setNotes((current) => ({ ...current, [field]: text }))
    setReason('')
  }

  /**
   * Send the decision.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send() {
    const decision = DECISIONS[pending]

    setBusy(true)
    setError(null)
    setProblems([])

    try {
      const body = { decision: pending }

      if (reason.trim()) body.reason = reason.trim()
      if (Object.keys(notes).length > 0) body.requestedChanges = notes
      // The version this page showed. If the organiser withdrew, changed and
      // resubmitted the event since, the server refuses with STALE_REVISION
      // rather than deciding on something this moderator never saw.
      if (Number.isInteger(event.revision)) body.revision = event.revision

      const response = await apiFetch(
        `/v1/moderation/events/${encodeURIComponent(event.id)}/decision`,
        { method: 'POST', body: JSON.stringify(body) },
      )

      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setPending(null)
        setNotes({})
        setReason('')
        setAnnouncement(`${decision.label} — this event is now ${parsed.data.status}.`)
        onDecided?.(parsed.data.status)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED') {
        // The server decides when. Asking before being told would be guessing
        // at a window this page cannot see.
        setStepUp(true)
        return
      }

      setError(parsed?.error?.message ?? 'The decision was refused.')
      setProblems(parsed?.error?.problems ?? [])
      focusAfterRender(panelRef)
    } catch {
      setError('The service is not responding. Nothing has been recorded.')
    } finally {
      setBusy(false)
    }
  }

  const decision = pending ? DECISIONS[pending] : null
  const blocked = decision?.needsReason && !reason.trim() && Object.keys(notes).length === 0
  // Only an event waiting for review can be decided on. Anything else is said
  // here rather than by the page choosing whether to draw this component: the
  // decision's own `router.refresh()` is what moves the event out of review,
  // and a page that swapped this component out for a notice at that moment
  // took the live region announcing the outcome with it, a quarter of a second
  // after filling it. Kept mounted, the region and its sentence survive the
  // refresh, and the notice appears beside them.
  const decidable = event.status === 'REVIEW_PENDING'
  // The API refuses an approval that names no revision; without one to name,
  // approving is not offered at all rather than refused after the second press.
  const approveBlocked =
    approveBlockedReason ?? (Number.isInteger(event.revision) ? null : NO_REVISION_TO_APPROVE)
  // Nobody could make the changes asked for on an event nobody runs here, and
  // the API refuses the move (`IMPORTED_EVENT_NO_EDITOR`), so it is not offered.
  const offered = Object.entries(DECISIONS).filter(
    ([key]) => !(noEditor && key === 'request_changes'),
  )
  const confirm = noEditor && decision ? (NO_EDITOR_WORDING[pending] ?? null) : null

  return (
    <div>
      <p role="status" aria-live="polite" className="text-sm font-medium text-ink-muted">
        {announcement}
      </p>

      {decidable && notYours ? (
        <Alert variant="info" title="Somebody else decides this">
          <p>{notYours}</p>
        </Alert>
      ) : null}

      {decidable && !notYours ? (
        <>
          {error && !pending ? (
            <Alert variant="error" title="That did not work" className="mb-3">
              <p>{error}</p>
            </Alert>
          ) : null}

          {noEditor ? <p className="mb-3 text-sm text-ink-muted">{noEditor}</p> : null}

          {approveBlocked ? (
            <p id="approve-blocked" className="mb-3 text-sm text-ink-muted">
              {approveBlocked}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {offered.map(([key, entry]) => (
              <Button
                key={key}
                type="button"
                variant={
                  entry.tone === 'danger' ? 'danger' : key === 'approve' ? 'primary' : 'secondary'
                }
                disabled={busy || (key === 'approve' && Boolean(approveBlocked))}
                aria-describedby={
                  key === 'approve' && approveBlocked ? 'approve-blocked' : undefined
                }
                onClick={(pressed) => begin(key, pressed.currentTarget)}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          {stepUp ? (
            <div className="mt-4">
              <StepUpPrompt
                action={`${(decision?.label ?? 'decide').toLowerCase()} this event`}
                onConfirmed={() => {
                  setStepUp(false)
                  send()
                }}
                onCancel={() => setStepUp(false)}
              />
            </div>
          ) : null}

          {decision && !stepUp ? (
            <div
              ref={panelRef}
              tabIndex={-1}
              role="group"
              aria-labelledby="decision-heading"
              className="mt-4 rounded-card border-2 border-ink bg-surface-raised p-4"
            >
              <h3 id="decision-heading" className="text-lg font-semibold text-ink">
                {decision.label}
              </h3>

              {(confirm ?? decision.confirm) ? (
                <p className="mt-2 text-ink-muted">{confirm ?? decision.confirm}</p>
              ) : null}

              {error ? (
                <Alert variant="error" title="That did not work" className="mt-3">
                  <p>{error}</p>
                  {problems.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  ) : null}
                </Alert>
              ) : null}

              <div className="mt-3">
                <FormField
                  label={
                    decision.needsReason
                      ? noEditor
                        ? 'Reason'
                        : 'What the organiser needs to know'
                      : 'Note'
                  }
                  id="decision-reason"
                  required={decision.needsReason}
                  description={
                    noEditor
                      ? decision.needsReason
                        ? NO_EDITOR_WORDING.reason
                        : NO_EDITOR_WORDING.note
                      : decision.needsReason
                        ? 'Sent to the organiser. Write something they can act on — "see guidelines" is not a decision anybody can do anything with.'
                        : 'Optional. Kept on the record and sent to the organiser.'
                  }
                >
                  <Textarea
                    rows={4}
                    value={reason}
                    onChange={(change) => setReason(change.target.value)}
                  />
                </FormField>
              </div>

              {pending === 'request_changes' ? (
                <div className="mt-4 rounded-control bg-surface-subtle p-3">
                  <h4 className="text-sm font-medium text-ink">Notes against specific parts</h4>
                  <p className="mt-1 text-sm text-ink-muted">
                    Optional, and much more useful than one paragraph. Write the note above, choose
                    what it is about, and add it.
                  </p>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-48">
                      <FormField label="This note is about" id="decision-field">
                        <Select value={field} onChange={(change) => setField(change.target.value)}>
                          {FIELDS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addNote}
                      disabled={!reason.trim()}
                    >
                      Add this note
                    </Button>
                  </div>

                  {Object.keys(notes).length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                      {Object.entries(notes).map(([key, note]) => (
                        <li key={key} className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">
                            {FIELDS.find(([value]) => value === key)?.[1] ?? key}:
                          </span>
                          <span>{note}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNotes((current) => {
                                const next = { ...current }
                                delete next[key]
                                return next
                              })
                            }
                            className="rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={decision.tone === 'danger' ? 'danger' : 'primary'}
                  disabled={busy || blocked}
                  onClick={send}
                >
                  {busy ? `${decision.verb}…` : `Yes, ${decision.label.toLowerCase()}`}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={dismiss}>
                  Not now
                </Button>
              </div>

              {blocked ? (
                <p className="mt-2 text-sm text-ink-muted">
                  A reason is required, or at least one note against a specific part.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {decidable ? null : (
        <Alert
          variant="info"
          title="Nothing to decide"
          className={announcement ? 'mt-3' : undefined}
        >
          <p>
            This event is {statusReading(event.status).label.toLowerCase()}. A decision can only be
            taken on something waiting for review.
          </p>
        </Alert>
      )}
    </div>
  )
}
