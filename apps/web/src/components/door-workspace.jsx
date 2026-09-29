'use client'

/**
 * The door: pick the event, present a ticket, see who it is, admit them.
 *
 * ## The order of things, and why none of it is shortcut
 *
 * A scan or a typed code is a **lookup**. The lookup is a preview: the server
 * resolves the ticket, checks this account against the ticket's own event, and
 * says who it is and whether it admits — and writes nothing. Only then does the
 * steward press **Admit**, which sends the same pass or code again with the
 * preview's reference, and the server decides again, inside the transaction
 * that records the admission. This screen decides nothing: it cannot admit,
 * refuse or authorise anybody, and every answer on it is the server's.
 *
 * ## What it keeps, and for how long
 *
 * The scanned pass or typed code, in memory, from the lookup until the ticket
 * is admitted, refused or cleared — never in the page, the URL, the title,
 * storage or a log. The typed code is visible in its own field because the
 * steward typed it; it is emptied when the ticket is done with. The recent
 * list keeps a name, a tier and an outcome for the last few tickets of this
 * session, in memory only, and never a code or a pass.
 *
 * ## What it will not do
 *
 * Admit without the server. There is no offline mode: with no connection it
 * says so and looks nothing up. A confirmation that got no answer is reported
 * as exactly that — it may or may not have admitted them — with a retry that
 * cannot admit twice.
 *
 * ## A group pass
 *
 * An order's group pass (its QR, or its printed `DEG-` code) is looked up the
 * same way and answers with every ticket the buyer still holds on the order.
 * The steward ticks who is actually at the door — everybody admissible is
 * ticked to start with — and admits them in one request; the server admits
 * each ticket once and refuses the whole selection if any ticket changed
 * since the lookup. The QR's shape tells the camera which lookup to use; a
 * typed code is a group code when it has the group code's shape.
 *
 * ## A platform administrator
 *
 * A platform super administrator admits at any event on its own authority.
 * The screen says so, persistently, above the event picker: every lookup and
 * admission is recorded against their account on the event's own record.
 *
 * ## Focus
 *
 * Deterministic: a lookup's answer takes focus to its heading; a result takes
 * focus to its heading; clearing returns focus to where the next ticket is
 * presented — the code field, or the camera controls. Urgent outcomes (do not
 * admit, already in, no answer) are announced assertively; everything else
 * politely.
 *
 * @module components/door-workspace
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Alert, Button, FormField, Input, Select } from './ui.jsx'
import { DoorCamera } from './door-camera.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  authorityLabel,
  confirmFailure,
  doorEventLabel,
  doorTime,
  groupLookupSentence,
  groupResultSentence,
  groupSessionName,
  lookupFailure,
  refusalSentence,
  seatWords,
} from '../lib/door.js'
import { looksLikeGroupCode } from '../lib/pass-shape.js'
import { sessionDisplayLabel } from '../lib/sessions.js'

/** How many recent tickets the session list shows. */
const RECENT_LIMIT = 8

/**
 * Send one door request.
 *
 * @param {string} path The API path.
 * @param {object} body The JSON body.
 * @returns {Promise<{status: number, body: object|null}>} Status 0 when nothing answered.
 */
async function send(path, body) {
  try {
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    return { status: response.status, body: await response.json().catch(() => null) }
  } catch {
    return { status: 0, body: null }
  }
}

/**
 * @typedef {object} DoorWorkspaceProps
 * @property {Array<object>} events Entries from `GET /v1/tickets/admission/events`.
 * @property {boolean} [platform] Whether the list is a platform super administrator's.
 */

/** Where each kind of presentation is looked up and admitted. */
const ROUTES = Object.freeze({
  ticket: {
    preview: '/v1/tickets/admission/preview',
    confirm: '/v1/tickets/check-in',
  },
  group: {
    preview: '/v1/tickets/admission/group/preview',
    confirm: '/v1/tickets/admission/group/check-in',
  },
})

/**
 * The workspace.
 *
 * @param {DoorWorkspaceProps} props Component props.
 * @returns {JSX.Element} The workspace.
 */
export function DoorWorkspace({ events, platform = false }) {
  const [eventId, setEventId] = useState(events.length === 1 ? events[0].event.id : '')
  const [mode, setMode] = useState('manual')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('ready')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [groupPreview, setGroupPreview] = useState(null)
  const [groupResult, setGroupResult] = useState(null)
  const [chosen, setChosen] = useState([])
  const [problem, setProblem] = useState(null)
  const [notice, setNotice] = useState('')
  const [recent, setRecent] = useState([])
  const [online, setOnline] = useState(true)

  const presentation = useRef(null)
  const previewReference = useRef(null)
  const headingRef = useRef(null)
  const codeField = useRef(null)
  const eventField = useRef(null)
  const focusTarget = useRef(null)
  const answerId = useId()

  const selected = events.find((entry) => entry.event.id === eventId) ?? null
  const busy = stage === 'looking' || stage === 'confirming'
  // Name the organisation beside each event when the list spans more than one.
  const manyOrganizations = new Set(events.map((entry) => entry.organization?.id ?? null)).size > 1

  // On a slow connection the page arrives before this script does, and a
  // steward chooses an event or types a code into it. The browser keeps what
  // they did; React never saw it, so the form would disagree with the screen —
  // Look up disabled beside a filled field — and the next render would undo
  // it. Take up whatever is already there.
  useEffect(() => {
    const chosen = eventField.current?.value
    const typed = codeField.current?.value

    if (chosen) setEventId(chosen)
    if (typed) setCode(typed)
  }, [])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)

    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)

    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Focus after the render that shows the thing to focus, never before it.
  useEffect(() => {
    if (focusTarget.current === 'answer') headingRef.current?.focus()
    if (focusTarget.current === 'present' && mode === 'manual') codeField.current?.focus()

    focusTarget.current = null
  })

  /**
   * Let go of the pass or code in hand, and its reference.
   *
   * @returns {void}
   */
  function forget() {
    presentation.current = null
    previewReference.current = null
  }

  /**
   * Forget the ticket in hand and get ready for the next.
   *
   * @param {boolean} [refocus] Whether to move focus to where the next is presented.
   * @returns {void}
   */
  const clear = useCallback((refocus = true) => {
    presentation.current = null
    previewReference.current = null
    setCode('')
    setPreview(null)
    setResult(null)
    setGroupPreview(null)
    setGroupResult(null)
    setChosen([])
    setProblem(null)
    setStage('ready')

    if (refocus) focusTarget.current = 'present'
  }, [])

  // The ticket in hand does not survive leaving the page.
  useEffect(() => () => clear(false), [clear])

  /**
   * Note an outcome in the session list: a name, a tier, what happened.
   *
   * @param {string} outcome What happened, in words.
   * @param {object|null} about The preview or result it was about.
   * @returns {void}
   */
  function remember(outcome, about) {
    setRecent((current) =>
      [
        {
          key: `${Date.now()}-${current.length}`,
          at: new Date().toISOString(),
          name: about?.attendeeName ?? 'No name on the ticket',
          tier: about?.tier?.name ?? null,
          outcome,
        },
        ...current,
      ].slice(0, RECENT_LIMIT),
    )
  }

  /**
   * Look a ticket or a group up. Writes nothing on the server.
   *
   * @param {{kind: 'ticket'|'group', credential?: string, code?: string}} presented What was presented, and which kind of pass it is.
   * @returns {Promise<void>}
   */
  async function lookUp(presented) {
    if (!selected || busy) return

    if (!online) {
      setProblem({ urgent: true, sentence: lookupFailure(0) })

      return
    }

    const { kind, ...body } = presented

    presentation.current = { kind, body }
    previewReference.current = null
    setStage('looking')
    setPreview(null)
    setResult(null)
    setGroupPreview(null)
    setGroupResult(null)
    setChosen([])
    setProblem(null)
    setNotice(kind === 'group' ? 'Looking the group up…' : 'Looking the ticket up…')

    const answer = await send(ROUTES[kind].preview, {
      ...body,
      expectedEventId: selected.event.id,
    })

    focusTarget.current = 'answer'

    if (answer.status !== 200 || !answer.body?.data) {
      presentation.current = null
      setStage('ready')
      setNotice('')
      setProblem({ urgent: true, sentence: lookupFailure(answer.status) })

      return
    }

    const data = answer.body.data

    previewReference.current = data.previewReference ?? null
    setStage('preview')

    if (kind === 'group') {
      const admissible = data.tickets
        .filter((ticket) => ticket.outcome === 'ADMISSIBLE')
        .map((ticket) => ticket.ticketId)

      setGroupPreview(data)
      setChosen(admissible)
      setNotice(groupLookupSentence(data))

      if (admissible.length === 0) {
        presentation.current = null
        remember(data.outcome === 'ALREADY_CHECKED_IN' ? 'Group: already in' : 'Group: refused', {
          attendeeName: groupSessionName(data.tickets),
          tier: null,
        })
      }

      return
    }

    setPreview(data)
    setNotice(data.outcome === 'ADMISSIBLE' ? `Found: ${data.attendeeName ?? 'a ticket'}.` : '')

    if (data.outcome !== 'ADMISSIBLE') {
      presentation.current = null
      remember(data.outcome === 'ALREADY_CHECKED_IN' ? 'Already in' : 'Refused', data)
    }
  }

  /**
   * Admit the previewed ticket.
   *
   * @returns {Promise<void>}
   */
  async function admit() {
    if (!presentation.current || !previewReference.current || busy) return

    const { kind, body: presented } = presentation.current

    if (kind === 'group' && chosen.length === 0) return

    setStage('confirming')
    setProblem(null)
    setNotice('Admitting…')

    const { status, body } = await send(ROUTES[kind].confirm, {
      ...presented,
      previewReference: previewReference.current,
      expectedEventId: selected.event.id,
      ...(kind === 'group' ? { ticketIds: chosen } : {}),
    })

    focusTarget.current = 'answer'

    if (kind === 'group' && status === 200 && body?.data) {
      const data = body.data

      forget()
      setCode('')
      setGroupResult(data)
      setStage('result')
      setNotice(groupResultSentence(data))
      remember(data.admitted > 0 ? `Group: ${data.admitted} admitted` : 'Group: already in', {
        attendeeName: groupSessionName(data.tickets),
        tier: null,
      })

      return
    }

    if (status === 200 && body?.data) {
      const data = body.data
      const mine = data.outcome === 'ADMITTED' || data.checkedInByYou

      forget()
      setCode('')
      setResult(data)
      setStage('result')
      setNotice(mine ? `Admitted: ${data.attendeeName ?? 'ticket holder'}.` : '')
      remember(
        data.outcome === 'ADMITTED'
          ? 'Admitted'
          : data.checkedInByYou
            ? 'Admitted (confirmed on retry)'
            : 'Already in',
        data,
      )

      return
    }

    const told = confirmFailure(status, body?.error?.reason ?? null)

    setNotice('')
    setProblem({ urgent: true, ...told })

    if (told.uncertain) {
      // The pass and reference stay in hand, so the retry is the same request.
      setStage('preview')

      return
    }

    if (!told.lookAgain) {
      forget()
      remember(
        kind === 'group' ? 'Group: refused' : 'Refused',
        kind === 'group'
          ? {
              attendeeName: groupSessionName(
                (groupPreview?.tickets ?? []).filter((ticket) => chosen.includes(ticket.ticketId)),
              ),
              tier: null,
            }
          : preview,
      )
    }

    setStage('preview')
  }

  /**
   * Look the same ticket up again, after an expired or mismatched reference.
   *
   * @returns {Promise<void>}
   */
  async function lookAgain() {
    const held = presentation.current

    if (held) await lookUp({ kind: held.kind, ...held.body })
  }

  /**
   * A pass read by the camera.
   *
   * @param {string} credential The pass.
   * @returns {void}
   */
  function onPass(credential) {
    if (stage !== 'ready') return

    lookUp({ kind: 'ticket', credential })
  }

  /**
   * A group pass read by the camera.
   *
   * @param {string} credential The group pass.
   * @returns {void}
   */
  function onGroupPass(credential) {
    if (stage !== 'ready') return

    lookUp({ kind: 'group', credential })
  }

  /**
   * Tick or untick one ticket of a group.
   *
   * @param {string} ticketId The ticket.
   * @returns {void}
   */
  function toggle(ticketId) {
    setChosen((current) =>
      current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId],
    )
  }

  const scanning = mode === 'camera' && stage === 'ready' && Boolean(selected) && online

  return (
    <div className="space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>

      {!online ? (
        <Alert variant="warning">
          This device is offline. Nobody can be admitted until it is back online — there is no
          offline admission.
        </Alert>
      ) : null}

      {platform ? (
        <Alert variant="info" title="Platform administrator authority">
          You are admitting with platform administrator authority. Every lookup and admission is
          recorded against your account on the event&apos;s record.
        </Alert>
      ) : null}

      <section aria-labelledby="door-event-heading">
        <h2 id="door-event-heading" className="text-xl font-semibold text-ink">
          Event
        </h2>
        {events.length === 1 ? (
          <div className="mt-3 rounded-card border border-line bg-surface-raised p-4 text-sm shadow-card">
            <p className="font-medium break-words text-ink">{events[0].event.title}</p>
            {platform && events[0].organization?.name ? (
              <p className="mt-1 break-words text-ink-muted">{events[0].organization.name}</p>
            ) : null}
            <p className="mt-1 text-ink-muted">
              {doorTime(events[0].event.startsAt, events[0].event.timezone)} ·{' '}
              {events[0].event.timezone}
            </p>
            <p className="mt-1 text-ink-muted">{authorityLabel(events[0])}</p>
          </div>
        ) : (
          <FormField label="Event you are admitting to" className="mt-3 max-w-xl">
            <Select
              ref={eventField}
              value={eventId}
              onChange={(changed) => {
                setEventId(changed.target.value)
                clear(false)
              }}
            >
              <option value="">Choose an event</option>
              {events.map((entry) => (
                <option key={entry.event.id} value={entry.event.id}>
                  {doorEventLabel(entry, { withOrganization: manyOrganizations })}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {selected && events.length > 1 ? (
          <p className="mt-2 text-sm text-ink-muted">{authorityLabel(selected)}</p>
        ) : null}
      </section>

      {selected ? (
        <section aria-labelledby="door-present-heading">
          <h2 id="door-present-heading" className="text-xl font-semibold text-ink">
            Present a ticket
          </h2>

          <div
            role="group"
            aria-label="How the ticket is presented"
            className="mt-3 flex flex-wrap gap-2"
          >
            <Button
              type="button"
              variant={mode === 'manual' ? 'primary' : 'outline'}
              aria-pressed={mode === 'manual'}
              onClick={() => setMode('manual')}
            >
              Type the printed code
            </Button>
            <Button
              type="button"
              variant={mode === 'camera' ? 'primary' : 'outline'}
              aria-pressed={mode === 'camera'}
              onClick={() => setMode('camera')}
            >
              Scan the QR pass
            </Button>
          </div>

          <div className="mt-4">
            {mode === 'manual' ? (
              <form
                className="flex max-w-xl flex-wrap items-end gap-3"
                onSubmit={(submitted) => {
                  submitted.preventDefault()

                  const typed = code.trim().toUpperCase()

                  if (!typed) return

                  lookUp({ kind: looksLikeGroupCode(typed) ? 'group' : 'ticket', code: typed })
                }}
              >
                <FormField label="Printed ticket code or group code" className="min-w-0 flex-1">
                  <Input
                    ref={codeField}
                    value={code}
                    onChange={(changed) => setCode(changed.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    inputMode="text"
                    maxLength={64}
                    disabled={busy || stage === 'preview' || stage === 'result'}
                  />
                </FormField>
                <Button
                  type="submit"
                  loading={stage === 'looking'}
                  disabled={
                    !online || code.trim() === '' || stage === 'preview' || stage === 'result'
                  }
                >
                  Look up
                </Button>
              </form>
            ) : (
              <DoorCamera
                paused={!scanning}
                onPass={onPass}
                onGroupPass={onGroupPass}
                onOther={() => setNotice('That QR code is not a ticket pass.')}
              />
            )}
          </div>
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Choose the event you are admitting to first.</p>
      )}

      {problem && !preview && !groupPreview ? (
        <section aria-labelledby={answerId}>
          <h2
            id={answerId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-ink"
          >
            Not found
          </h2>
          <Alert variant="error" urgent className="mt-3">
            {problem.sentence}
          </Alert>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => clear()}>
            Next ticket
          </Button>
        </section>
      ) : null}

      {preview && !result ? (
        <PreviewCard
          preview={preview}
          headingId={answerId}
          headingRef={headingRef}
          stage={stage}
          problem={problem}
          online={online}
          onAdmit={admit}
          onLookAgain={lookAgain}
          onClear={() => clear()}
        />
      ) : null}

      {result ? (
        <ResultCard
          result={result}
          headingId={answerId}
          headingRef={headingRef}
          onClear={() => clear()}
        />
      ) : null}

      {groupPreview && !groupResult ? (
        <GroupPreviewCard
          preview={groupPreview}
          chosen={chosen}
          onToggle={toggle}
          headingId={answerId}
          headingRef={headingRef}
          stage={stage}
          problem={problem}
          online={online}
          onAdmit={admit}
          onLookAgain={lookAgain}
          onClear={() => clear()}
        />
      ) : null}

      {groupResult ? (
        <GroupResultCard
          result={groupResult}
          headingId={answerId}
          headingRef={headingRef}
          onClear={() => clear()}
        />
      ) : null}

      <section aria-labelledby="door-recent-heading">
        <h2 id="door-recent-heading" className="text-xl font-semibold text-ink">
          This session
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            Nothing so far. Tickets you look up appear here until you leave this page; nothing is
            saved.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line rounded-card border border-line bg-surface-raised px-4 text-sm shadow-card">
            {recent.map((entry) => (
              <li key={entry.key} className="flex flex-wrap justify-between gap-2 py-3">
                <span className="min-w-0 break-words">
                  <span className="font-medium text-ink">{entry.name}</span>
                  {entry.tier ? <span className="text-ink-muted"> · {entry.tier}</span> : null}
                </span>
                <span className="text-ink-muted">
                  {entry.outcome} ·{' '}
                  <time dateTime={entry.at}>
                    {new Date(entry.at).toLocaleTimeString('en-US', { timeStyle: 'short' })}
                  </time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * The lookup's answer: who, for what, and whether they may come in.
 *
 * @param {object} props Component props.
 * @param {object} props.preview The preview payload.
 * @param {string} props.headingId The heading's id.
 * @param {object} props.headingRef Receives the heading, for focus.
 * @param {string} props.stage The workspace stage.
 * @param {object|null} props.problem A confirmation problem, if any.
 * @param {boolean} props.online Whether the device is online.
 * @param {function(): void} props.onAdmit Admit.
 * @param {function(): void} props.onLookAgain Look the ticket up again.
 * @param {function(): void} props.onClear Clear and take the next ticket.
 * @returns {JSX.Element} The card.
 */
function PreviewCard({
  preview,
  headingId,
  headingRef,
  stage,
  problem,
  online,
  onAdmit,
  onLookAgain,
  onClear,
}) {
  const admissible =
    preview.outcome === 'ADMISSIBLE' && !(problem && !problem.uncertain && !problem.lookAgain)
  const seat = seatWords(preview.seat)
  const heading =
    preview.outcome === 'ADMISSIBLE'
      ? 'Check the ticket, then admit'
      : preview.outcome === 'ALREADY_CHECKED_IN'
        ? 'Already admitted — do not admit again'
        : 'Do not admit'

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-card border p-5 shadow-card sm:p-6 ${
        preview.outcome === 'ADMISSIBLE'
          ? 'border-line-strong bg-surface-raised'
          : 'border-status-danger/25 bg-status-danger-soft'
      }`}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink">
        {heading}
      </h2>

      <p className="mt-3 font-display text-h2 font-semibold break-words text-ink">
        {preview.attendeeName ?? 'No name on this ticket'}
      </p>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex flex-wrap gap-2">
          <dt className="text-ink-muted">Event</dt>
          <dd className="break-words text-ink">{preview.event.title}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-ink-muted">Starts</dt>
          <dd className="text-ink">
            {doorTime(preview.event.startsAt, preview.event.timezone)} · {preview.event.timezone}
          </dd>
        </div>
        {preview.tier ? (
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Ticket</dt>
            <dd className="text-ink">{preview.tier.name}</dd>
          </div>
        ) : null}
        {/* The night the ticket is for, in words, so a steward notices a ticket
            for another night. A label only: the door refuses nothing on it. */}
        {preview.session ? (
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Night</dt>
            <dd className="text-ink">{sessionDisplayLabel(preview.session)}</dd>
          </div>
        ) : null}
        {seat ? (
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Seat</dt>
            <dd className="text-ink">{seat}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <dt className="text-ink-muted">Presented as</dt>
          <dd className="text-ink">{preview.method === 'QR_SCAN' ? 'QR pass' : 'Printed code'}</dd>
        </div>
      </dl>

      {preview.outcome === 'ALREADY_CHECKED_IN' ? (
        <Alert variant="error" urgent className="mt-3">
          This ticket was already admitted
          {preview.checkedInAt
            ? ` at ${doorTime(preview.checkedInAt, preview.event.timezone)}`
            : ''}
          . Each ticket admits once.
        </Alert>
      ) : null}

      {preview.outcome === 'REFUSED' ? (
        <Alert variant="error" urgent className="mt-3">
          {refusalSentence(preview.refusal)}
          {preview.refusal === 'WRONG_EVENT' ? ` It is for ${preview.event.title}.` : ''}
        </Alert>
      ) : null}

      {problem ? (
        <Alert variant="error" urgent={Boolean(problem.urgent)} className="mt-3">
          {problem.sentence}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {admissible ? (
          <Button
            type="button"
            onClick={onAdmit}
            loading={stage === 'confirming'}
            disabled={!online || stage === 'looking'}
          >
            {problem?.uncertain ? 'Retry admission' : 'Admit'}
          </Button>
        ) : null}
        {problem?.lookAgain ? (
          <Button
            type="button"
            onClick={onLookAgain}
            loading={stage === 'looking'}
            disabled={!online}
          >
            Look it up again
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={onClear}
          disabled={stage === 'confirming'}
        >
          {admissible ? 'Cancel' : 'Next ticket'}
        </Button>
      </div>
    </section>
  )
}

/**
 * What the admission did.
 *
 * @param {object} props Component props.
 * @param {object} props.result The check-in payload.
 * @param {string} props.headingId The heading's id.
 * @param {object} props.headingRef Receives the heading, for focus.
 * @param {function(): void} props.onClear Take the next ticket.
 * @returns {JSX.Element} The card.
 */
function ResultCard({ result, headingId, headingRef, onClear }) {
  const admitted = result.outcome === 'ADMITTED' || result.checkedInByYou
  const when = doorTime(result.checkedInAt, result.event.timezone)

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-card border p-5 shadow-card sm:p-6 ${admitted ? 'border-status-success/25 bg-status-success-soft' : 'border-status-danger/25 bg-status-danger-soft'}`}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink">
        {admitted ? 'Admitted' : 'Already admitted by another steward'}
      </h2>
      <p className="mt-3 font-display text-h2 font-semibold break-words text-ink">
        {result.attendeeName ?? 'Ticket holder'}
      </p>
      {result.session || result.tier ? (
        <p className="mt-1 text-sm text-ink">
          {[result.tier?.name, result.session ? sessionDisplayLabel(result.session) : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-ink-muted">
        {result.outcome === 'ADMITTED'
          ? `Admitted at ${when}.`
          : result.checkedInByYou
            ? `You admitted this ticket at ${when}; the retry changed nothing.`
            : `This ticket was admitted at ${when}. Do not admit again.`}
      </p>
      {!admitted ? (
        <Alert variant="error" urgent className="mt-3">
          Each ticket admits once. This one already has.
        </Alert>
      ) : null}
      <Button type="button" className="mt-4" onClick={onClear}>
        Next ticket
      </Button>
    </section>
  )
}

/**
 * One ticket of a group, in words: name, tier and seat.
 *
 * @param {{attendeeName: string|null, tier: {name: string}|null, seat: object|null}} ticket A group ticket.
 * @returns {string} The words.
 */
function groupTicketWords(ticket) {
  return [ticket.attendeeName ?? 'No name on the ticket', ticket.tier?.name, seatWords(ticket.seat)]
    .filter(Boolean)
    .join(' · ')
}

/**
 * A group lookup's answer: who is on the pass, and who is at the door.
 *
 * Everybody admissible is ticked to start with; the steward unticks whoever is
 * not there. Already-in and refused tickets are listed as text, with why.
 *
 * @param {object} props Component props.
 * @param {object} props.preview The group preview payload.
 * @param {string[]} props.chosen The ticked ticket ids.
 * @param {function(string): void} props.onToggle Tick or untick one.
 * @param {string} props.headingId The heading's id.
 * @param {object} props.headingRef Receives the heading, for focus.
 * @param {string} props.stage The workspace stage.
 * @param {object|null} props.problem A confirmation problem, if any.
 * @param {boolean} props.online Whether the device is online.
 * @param {function(): void} props.onAdmit Admit the ticked tickets.
 * @param {function(): void} props.onLookAgain Look the group up again.
 * @param {function(): void} props.onClear Clear and take the next ticket.
 * @returns {JSX.Element} The card.
 */
function GroupPreviewCard({
  preview,
  chosen,
  onToggle,
  headingId,
  headingRef,
  stage,
  problem,
  online,
  onAdmit,
  onLookAgain,
  onClear,
}) {
  const legendId = useId()
  const admissible = preview.tickets.filter((ticket) => ticket.outcome === 'ADMISSIBLE')
  const alreadyIn = preview.tickets.filter((ticket) => ticket.outcome === 'ALREADY_CHECKED_IN')
  const refused = preview.tickets.filter((ticket) => ticket.outcome === 'REFUSED')
  const stopped = Boolean(problem && !problem.uncertain && !problem.lookAgain)
  const canAdmit = admissible.length > 0 && !stopped

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-card border p-5 shadow-card sm:p-6 ${
        admissible.length > 0
          ? 'border-line-strong bg-surface-raised'
          : 'border-status-danger/25 bg-status-danger-soft'
      }`}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink">
        {admissible.length > 0
          ? 'Check the group, then admit'
          : 'Nobody in this group can be admitted'}
      </h2>

      <p className="mt-2 text-sm text-ink">{groupLookupSentence(preview)}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {preview.event.title} · {doorTime(preview.event.startsAt, preview.event.timezone)} ·{' '}
        {preview.method === 'QR_SCAN' ? 'Group QR pass' : 'Printed group code'}
      </p>

      {preview.outcome === 'REFUSED' && preview.refusal ? (
        <Alert variant="error" urgent className="mt-3">
          {refusalSentence(preview.refusal)}
          {preview.refusal === 'WRONG_EVENT' ? ` It is for ${preview.event.title}.` : ''}
        </Alert>
      ) : null}

      {admissible.length > 0 ? (
        <fieldset className="mt-4" aria-describedby={legendId}>
          <legend className="font-semibold text-ink">Who is at the door now</legend>
          <p id={legendId} className="mt-1 text-sm text-ink-muted">
            Untick anybody who has not arrived; they can be admitted later with the same pass.
          </p>
          <ul className="mt-2 space-y-2">
            {admissible.map((ticket) => {
              const id = `${headingId}-${ticket.ticketId}`

              return (
                <li key={ticket.ticketId} className="flex min-h-11 items-start gap-3 py-1">
                  <input
                    id={id}
                    type="checkbox"
                    checked={chosen.includes(ticket.ticketId)}
                    onChange={() => onToggle(ticket.ticketId)}
                    disabled={stage === 'confirming'}
                    className="mt-0.5 size-5 shrink-0 rounded border-line-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  />
                  <label htmlFor={id} className="min-w-0 break-words text-ink">
                    {groupTicketWords(ticket)}
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
      ) : null}

      {alreadyIn.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-semibold text-ink">Already in</h3>
          <ul className="mt-1 space-y-1 text-sm text-ink">
            {alreadyIn.map((ticket) => (
              <li key={ticket.ticketId} className="break-words">
                {groupTicketWords(ticket)} —{' '}
                {ticket.checkedInAt
                  ? `already in at ${doorTime(ticket.checkedInAt, preview.event.timezone)}`
                  : 'already in'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {refused.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-semibold text-ink">Do not admit</h3>
          <ul className="mt-1 space-y-1 text-sm text-ink">
            {refused.map((ticket) => (
              <li key={ticket.ticketId} className="break-words">
                {groupTicketWords(ticket)} — {refusalSentence(ticket.refusal)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {problem ? (
        <Alert variant="error" urgent={Boolean(problem.urgent)} className="mt-3">
          {problem.sentence}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {canAdmit ? (
          <Button
            type="button"
            onClick={onAdmit}
            loading={stage === 'confirming'}
            disabled={!online || stage === 'looking' || chosen.length === 0}
          >
            {problem?.uncertain ? `Retry admitting ${chosen.length}` : `Admit ${chosen.length}`}
          </Button>
        ) : null}
        {problem?.lookAgain ? (
          <Button
            type="button"
            onClick={onLookAgain}
            loading={stage === 'looking'}
            disabled={!online}
          >
            Look it up again
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={onClear}
          disabled={stage === 'confirming'}
        >
          {canAdmit ? 'Cancel' : 'Next ticket'}
        </Button>
      </div>
    </section>
  )
}

/**
 * What a group admission did, ticket by ticket.
 *
 * @param {object} props Component props.
 * @param {object} props.result The group check-in payload.
 * @param {string} props.headingId The heading's id.
 * @param {object} props.headingRef Receives the heading, for focus.
 * @param {function(): void} props.onClear Take the next ticket.
 * @returns {JSX.Element} The card.
 */
function GroupResultCard({ result, headingId, headingRef, onClear }) {
  const admittedNow = result.tickets.filter((ticket) => ticket.outcome === 'ADMITTED')
  const alreadyIn = result.tickets.filter((ticket) => ticket.outcome !== 'ADMITTED')

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-status-success/25 bg-status-success-soft p-5 shadow-card sm:p-6"
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink">
        {result.admitted > 0 ? `Admitted ${result.admitted}` : 'Already admitted'}
      </h2>
      <p className="mt-2 text-sm text-ink">{groupResultSentence(result)}</p>

      {admittedNow.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {admittedNow.map((ticket) => (
            <li key={ticket.ticketId} className="break-words">
              {groupTicketWords(ticket)} — admitted at{' '}
              {doorTime(ticket.checkedInAt, result.event.timezone)}
            </li>
          ))}
        </ul>
      ) : null}

      {alreadyIn.length > 0 ? (
        <>
          <h3 className="mt-4 font-semibold text-ink">Already in before this</h3>
          <ul className="mt-1 space-y-1 text-sm text-ink">
            {alreadyIn.map((ticket) => (
              <li key={ticket.ticketId} className="break-words">
                {groupTicketWords(ticket)} —{' '}
                {ticket.checkedInByYou ? 'admitted by you at ' : 'admitted at '}
                {doorTime(ticket.checkedInAt, result.event.timezone)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Button type="button" className="mt-4" onClick={onClear}>
        Next ticket
      </Button>
    </section>
  )
}
