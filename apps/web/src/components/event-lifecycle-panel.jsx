'use client'

/**
 * Whose turn it is, what is stopping it, and the buttons that move it on.
 *
 * ## The checklist is the server's answer
 *
 * `GET /v1/events/:id/readiness` returns every reason an event cannot be
 * published, not the first. That matters: an organiser who fixes one thing,
 * resubmits, and is told about the next one has a worse afternoon than an
 * organiser who is handed the list. So this renders the list, with ticks and
 * crosses that carry words — "Ready" and "Not yet" beside every line, because a
 * green dot is invisible to a screen reader and to a colourblind person.
 *
 * Nothing is computed here. A button that looks available is a convenience;
 * the API authorises every command again, checks the transition table again,
 * and runs the gates again. `entitled` and `blockers` arrive separately from
 * the transitions endpoint and stay separate on screen, because "you may not"
 * and "not yet" are different sentences and conflating them tells somebody to
 * ask for a permission they already hold.
 *
 * ## Confirmation is proportional
 *
 * Pausing sales is one click, because resuming is one click. Cancelling
 * requests a refund against every paid order and cannot be undone, so it asks
 * for a reason code, a note, and a second press. That asymmetry is deliberate:
 * a confirmation dialogue on everything trains people to dismiss them.
 *
 * ## A second factor, when the server asks for one
 *
 * Publishing and opening sales sit behind the EVENT_PUBLISH step-up window;
 * cancelling and postponing behind EVENT_CANCEL. Until Phase 4 a lapsed window
 * showed the API's words — "Authenticate at /v1/auth/step-up and retry" — and
 * stopped there. Now the prompt opens where the command was, and a confirmed
 * step-up sends the same command again with what was already typed. An account
 * that has no second factor at all is sent to set one up.
 *
 * ## What a moderator said
 *
 * The history is the record of the negotiation — what was asked for, by the
 * platform, and when. It is shown to the organiser because they have to act on
 * it. It is not shown publicly, and the moderator's identity is not in the
 * payload at all.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-lifecycle-panel
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Badge, Button, Card, CardBody, FormField, Select, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { COMMANDS, REASON_CODES, statusReading } from '../lib/event-status.js'

/**
 * Which commands to offer out of a status.
 *
 * Derived from the transitions the server said are available, so a state this
 * build has never seen offers nothing rather than guessing.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
const OFFERED = Object.freeze({
  DRAFT: ['submitReview'],
  CHANGES_REQUIRED: ['submitReview'],
  REVIEW_PENDING: ['withdrawReview'],
  APPROVED: ['publish'],
  PUBLISHED: ['openSales', 'postpone', 'cancel'],
  ON_SALE: ['pauseSales', 'postpone', 'cancel'],
  SALES_PAUSED: ['openSales', 'postpone', 'cancel'],
  SOLD_OUT: ['pauseSales', 'postpone', 'cancel'],
  POSTPONED: ['cancel'],
})

/**
 * One line of the readiness checklist.
 *
 * @param {object} props Component props.
 * @param {boolean} props.ready Whether this part is done.
 * @param {string} props.title What it is.
 * @param {string[]} props.blockers Everything outstanding.
 * @returns {JSX.Element} The line.
 */
function ChecklistItem({ ready, title, blockers }) {
  return (
    <li className="rounded-card border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* The word, not the colour. A tick alone is a shape a screen reader
            does not read and a colourblind person cannot tell from a cross. */}
        <Badge variant={ready ? 'success' : 'warning'} srLabel="Status:">
          {ready ? 'Ready' : 'Not yet'}
        </Badge>
        <span className="font-medium text-ink">{title}</span>
      </div>

      {blockers.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * A readiness result with its lists present.
 *
 * The checklist reads four arrays off this and a payload missing one would
 * take the whole panel down — which is a poor trade for a field the server
 * might one day rename. An absent list reads as "nothing outstanding here",
 * and the API is still the thing that refuses the transition.
 *
 * @param {object|null} result A readiness payload, or null.
 * @returns {object} The same result with every list present.
 */
function withLists(result) {
  return {
    ready: Boolean(result?.ready),
    status: result?.status ?? '',
    publishable: result?.publishable ?? [],
    sellable: result?.sellable ?? [],
    inventory: result?.inventory ?? [],
    organizerVerified: Boolean(result?.organizerVerified),
  }
}

/**
 * @typedef {object} EventLifecyclePanelProps
 * @property {object} event The event.
 * @property {object} readiness The server's readiness result.
 * @property {object} transitions The server's available transitions.
 * @property {object[]} history The moderation history, newest first.
 * @property {number} [revision] The event's revision, so the checklist can re-read when other steps save.
 */

/**
 * Where to set up a second factor, for an account the server says has none.
 *
 * @returns {JSX.Element} The link.
 */
function EnrolmentLink() {
  return (
    <p className="mt-2">
      <Link
        href="/account/security"
        className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        Set up two-step sign-in
      </Link>
    </p>
  )
}

/**
 * The review step.
 *
 * @param {EventLifecyclePanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function EventLifecyclePanel({
  event,
  readiness: initialReadiness,
  transitions: initialTransitions,
  history = [],
  revision = 0,
}) {
  const router = useRouter()
  const [readiness, setReadiness] = useState(() => withLists(initialReadiness))
  const [transitions, setTransitions] = useState(initialTransitions)
  const [status, setStatus] = useState(event.status)
  const [pending, setPending] = useState(null)
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0][0])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [announcement, setAnnouncement] = useState('')
  // The command waiting on a fresh second factor, when the server asked for one.
  const [stepUpFor, setStepUpFor] = useState(null)
  const [needsEnrolment, setNeedsEnrolment] = useState(false)
  const dialogRef = useRef(null)
  const returnFocus = useRef(null)

  const reading = statusReading(status)
  const offered = OFFERED[status] ?? []

  /**
   * Re-read the server's answer about whether this event is ready.
   *
   * A checklist that does not refresh is a checklist that lies. The organiser
   * writes the refund policy on one step and comes here to submit; if this
   * panel still holds the readiness result from the page load, it shows a
   * blocker they have already cleared and a submit button that is disabled for
   * a reason that is no longer true.
   *
   * @returns {Promise<void>} Resolves when both answers are in.
   */
  const refresh = useCallback(async () => {
    const [readinessResponse, transitionsResponse] = await Promise.all([
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}/readiness`),
      apiFetch(`/v1/events/${encodeURIComponent(event.id)}/transitions`),
    ])

    const readinessBody = await readinessResponse.json().catch(() => null)
    const transitionsBody = await transitionsResponse.json().catch(() => null)

    if (readinessResponse.ok && readinessBody?.data) setReadiness(withLists(readinessBody.data))
    if (transitionsResponse.ok && transitionsBody?.data) {
      setTransitions(transitionsBody.data)
      setStatus(transitionsBody.data.status)
    }
  }, [event.id])

  // On open, and again whenever another step has saved.
  useEffect(() => {
    refresh().catch(() => {
      // A failed re-read leaves the last answer on screen rather than blanking
      // the checklist. It is stale, and stale is better than absent — the
      // commands are all authorised again by the API regardless.
    })
  }, [refresh, revision])

  /**
   * Whether the server says this actor may make this move.
   *
   * @param {string} key A key of `COMMANDS`.
   * @returns {object|null} The transition the server described, or null.
   */
  const transitionFor = (key) =>
    (transitions?.transitions ?? []).find(
      (entry) => entry.to === DESTINATIONS[key] && entry.actor === 'organizer',
    ) ?? null

  /**
   * Start a command, asking first when it deserves asking.
   *
   * @param {string} key A key of `COMMANDS`.
   * @param {object} trigger The element that was pressed, so focus can come back.
   * @returns {void}
   */
  function begin(key, trigger) {
    const command = COMMANDS[key]

    returnFocus.current = trigger
    setError(null)
    setProblems([])
    setReason('')
    setStepUpFor(null)
    setNeedsEnrolment(false)

    if (command.confirm || command.reason !== 'none') {
      setPending(key)
      queueMicrotask(() => dialogRef.current?.focus())
      return
    }

    run(key)
  }

  /**
   * Close the confirmation and put focus back where it was.
   *
   * @returns {void}
   */
  function dismiss() {
    setPending(null)
    setStepUpFor(null)
    // Focus does not evaporate when a dialogue closes. Putting it back is the
    // difference between a keyboard user carrying on and a keyboard user
    // hunting for where they were.
    queueMicrotask(() => returnFocus.current?.focus())
  }

  /**
   * Send a lifecycle command.
   *
   * @param {string} key A key of `COMMANDS`.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function run(key) {
    const command = COMMANDS[key]

    setBusy(true)
    setError(null)
    setProblems([])
    setNeedsEnrolment(false)

    try {
      const body = {}

      if (command.reason !== 'none') {
        if (reason.trim()) body.reason = reason.trim()
        if (key === 'cancel' || key === 'postpone') body.reasonCode = reasonCode
      }

      const response = await apiFetch(
        `/v1/events/${encodeURIComponent(event.id)}/${command.path}`,
        { method: 'POST', body: JSON.stringify(body) },
      )

      const parsed = await response.json().catch(() => null)

      if (!response.ok) {
        const code = parsed?.error?.code

        if (code === 'STEP_UP_REQUIRED') {
          // Not a refusal of the command: a request to confirm who is asking.
          setStepUpFor(key)
          return
        }

        if (code === 'MFA_ENROLMENT_REQUIRED') {
          setNeedsEnrolment(true)
          setError(
            'A role this account holds needs two-step sign-in before it can do this, and it is not set up yet. Nothing has changed.',
          )
          queueMicrotask(() => dialogRef.current?.focus())
          return
        }

        setError(parsed?.error?.message ?? 'The command was refused.')
        setProblems(parsed?.error?.problems ?? [])
        queueMicrotask(() => dialogRef.current?.focus())
        return
      }

      setStepUpFor(null)

      const next = parsed.data.status

      setStatus(next)
      setPending(null)
      // The move changes what is available next, so ask rather than infer.
      await refresh().catch(() => {})
      // Announced rather than merely drawn: a lifecycle change is the most
      // consequential thing on this screen and a screen reader user must not
      // have to go looking for it.
      setAnnouncement(`${statusReading(next).label}. ${statusReading(next).next}`)
      router.refresh()
    } catch {
      setError('The service is not responding. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  const command = pending ? COMMANDS[pending] : null

  return (
    <section aria-labelledby="review-heading" className="space-y-5">
      <h2 id="review-heading" className="text-xl font-bold text-ink">
        Review and publish
      </h2>

      <p role="status" aria-live="polite" className="text-sm font-medium text-ink-muted">
        {announcement}
      </p>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={reading.tone} size="lg" srLabel="State:">
              {reading.label}
            </Badge>
            <span className="text-sm text-ink-muted">
              Waiting on {reading.whose === 'nobody' ? 'nothing' : reading.whose}
            </span>
          </div>
          <p className="mt-2 text-ink-muted">{reading.next}</p>

          <p className="mt-3 text-sm">
            <a
              className="underline underline-offset-4 hover:text-accent-strong"
              href={`/events/${event.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Preview the public page
            </a>{' '}
            <span className="text-ink-muted">
              — opens what a visitor sees. Before publication only your team can load it.
            </span>
          </p>
        </CardBody>
      </Card>

      {history.length > 0 && status === 'CHANGES_REQUIRED' ? (
        <Alert variant="warning" title="A moderator has asked for changes">
          <p>{history[0].reason ?? 'No reason was recorded.'}</p>
          {history[0].requestedChanges ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {Object.entries(history[0].requestedChanges).map(([field, note]) => (
                <li key={field}>
                  <span className="font-medium">{field}:</span> {note}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2">Make the changes, then send it back for review.</p>
        </Alert>
      ) : null}

      {history.length > 0 && status === 'REJECTED' ? (
        <Alert variant="error" title="A moderator rejected this event">
          <p>{history[0].reason ?? 'No reason was recorded.'}</p>
        </Alert>
      ) : null}

      <div>
        <h3 className="text-lg font-semibold text-ink">Before it can go public</h3>
        <ul className="mt-3 space-y-3">
          <ChecklistItem
            ready={readiness.organizerVerified}
            title="Your organisation is verified"
            blockers={
              readiness.organizerVerified
                ? []
                : ['The platform has not verified this organisation yet.']
            }
          />
          <ChecklistItem
            ready={readiness.publishable.length === 0}
            title="The event is complete"
            blockers={readiness.publishable}
          />
          <ChecklistItem
            ready={readiness.sellable.length === 0}
            title="There is something to sell"
            blockers={readiness.sellable}
          />
          <ChecklistItem
            ready={readiness.inventory.length === 0}
            title="Inventory is prepared"
            blockers={readiness.inventory}
          />
        </ul>
      </div>

      {error && !pending ? (
        <Alert variant="error" title="That did not work">
          <p>{error}</p>
          {needsEnrolment ? <EnrolmentLink /> : null}
          {problems.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {offered.map((key) => {
          const entry = transitionFor(key)
          const blocked = entry ? entry.blockers.length > 0 : false
          const unentitled = entry ? !entry.entitled : false

          return (
            <div key={key}>
              <Button
                type="button"
                variant={COMMANDS[key].tone === 'danger' ? 'danger' : COMMANDS[key].tone}
                disabled={busy || blocked || unentitled}
                onClick={(pressed) => begin(key, pressed.currentTarget)}
              >
                {COMMANDS[key].label}
              </Button>

              {/* Two different sentences, kept apart. */}
              {unentitled ? (
                <p className="mt-1 max-w-xs text-sm text-ink-muted">
                  Somebody with more permission than you has to do this.
                </p>
              ) : null}
              {blocked && !unentitled ? (
                <ul className="mt-1 max-w-xs list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  {entry.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>

      {stepUpFor && !pending ? (
        <StepUpPrompt
          action={COMMANDS[stepUpFor].label.toLowerCase()}
          onConfirmed={() => {
            const key = stepUpFor

            setStepUpFor(null)
            void run(key)
          }}
          onCancel={() => setStepUpFor(null)}
        />
      ) : null}

      {command ? (
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-labelledby="command-heading"
          className="rounded-card border-2 border-ink bg-surface-raised p-4"
        >
          <h3 id="command-heading" className="text-lg font-semibold text-ink">
            {command.label}
          </h3>

          {command.confirm ? <p className="mt-2 text-ink-muted">{command.confirm}</p> : null}

          {error ? (
            <Alert variant="error" title="That did not work" className="mt-3">
              <p>{error}</p>
              {needsEnrolment ? <EnrolmentLink /> : null}
              {problems.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}

          {stepUpFor && pending ? (
            <div className="mt-3">
              <StepUpPrompt
                action={command.label.toLowerCase()}
                onConfirmed={() => {
                  const key = stepUpFor

                  setStepUpFor(null)
                  // The reason and note typed into this dialogue are still
                  // here, and go with the retried command.
                  void run(key)
                }}
                onCancel={() => setStepUpFor(null)}
              />
            </div>
          ) : null}

          {pending === 'cancel' || pending === 'postpone' ? (
            <div className="mt-3">
              <FormField
                label="Reason"
                id="command-reasonCode"
                required
                description="A fixed list, so the platform can count why events come off. The note underneath is where the rest goes."
              >
                <Select
                  value={reasonCode}
                  onChange={(change) => setReasonCode(change.target.value)}
                >
                  {REASON_CODES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}

          {command.reason !== 'none' ? (
            <div className="mt-3">
              <FormField
                label={command.reason === 'required' ? 'What to tell ticket holders' : 'Note'}
                id="command-reason"
                required={command.reason === 'required'}
                description={
                  command.reason === 'required'
                    ? 'Sent to everybody holding a ticket. Write it for them, not for the file.'
                    : 'Optional. Kept on the record.'
                }
              >
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(change) => setReason(change.target.value)}
                />
              </FormField>
            </div>
          ) : null}

          {pending === 'cancel' ? (
            <p className="mt-3 rounded-lg bg-status-danger-soft p-3 text-sm text-status-danger">
              A refund will be <span className="font-medium">requested</span> against every paid
              order. Nothing is sent to a payment provider by this action and no money moves until a
              refund is actually processed.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={command.tone === 'danger' ? 'danger' : 'primary'}
              disabled={busy || (command.reason === 'required' && !reason.trim())}
              onClick={() => run(pending)}
            >
              {busy ? `${command.verb}…` : `Yes, ${command.label.toLowerCase()}`}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold text-ink">History</h3>
          <ol className="mt-3 space-y-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="rounded-card border border-line bg-surface-raised p-3 text-sm"
              >
                <p className="font-medium text-ink">
                  {entry.fromStatus ? `${statusReading(entry.fromStatus).label} → ` : ''}
                  {statusReading(entry.toStatus).label}
                </p>
                <p className="text-ink-muted">
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString('en-GB')}
                  </time>
                </p>
                {entry.reason ? <p className="mt-1 text-ink-muted">{entry.reason}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The status each command moves to, for matching against the server's list.
 *
 * @type {Readonly<Record<string, string>>}
 */
const DESTINATIONS = Object.freeze({
  submitReview: 'REVIEW_PENDING',
  withdrawReview: 'DRAFT',
  publish: 'PUBLISHED',
  openSales: 'ON_SALE',
  pauseSales: 'SALES_PAUSED',
  postpone: 'POSTPONED',
  cancel: 'CANCELLED',
})
