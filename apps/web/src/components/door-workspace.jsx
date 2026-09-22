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
  doorTime,
  lookupFailure,
  refusalSentence,
  seatWords,
} from '../lib/door.js'

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
 */

/**
 * The workspace.
 *
 * @param {DoorWorkspaceProps} props Component props.
 * @returns {JSX.Element} The workspace.
 */
export function DoorWorkspace({ events }) {
  const [eventId, setEventId] = useState(events.length === 1 ? events[0].event.id : '')
  const [mode, setMode] = useState('manual')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('ready')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
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
   * Look a ticket up. Writes nothing on the server.
   *
   * @param {{credential?: string, code?: string}} presented What was presented.
   * @returns {Promise<void>}
   */
  async function lookUp(presented) {
    if (!selected || busy) return

    if (!online) {
      setProblem({ urgent: true, sentence: lookupFailure(0) })

      return
    }

    presentation.current = presented
    previewReference.current = null
    setStage('looking')
    setPreview(null)
    setResult(null)
    setProblem(null)
    setNotice('Looking the ticket up…')

    const { status, body } = await send('/v1/tickets/admission/preview', {
      ...presented,
      expectedEventId: selected.event.id,
    })

    focusTarget.current = 'answer'

    if (status !== 200 || !body?.data) {
      presentation.current = null
      setStage('ready')
      setNotice('')
      setProblem({ urgent: true, sentence: lookupFailure(status) })

      return
    }

    const data = body.data

    previewReference.current = data.previewReference ?? null
    setPreview(data)
    setStage('preview')
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

    setStage('confirming')
    setProblem(null)
    setNotice('Admitting…')

    const { status, body } = await send('/v1/tickets/check-in', {
      ...presentation.current,
      previewReference: previewReference.current,
      expectedEventId: selected.event.id,
    })

    focusTarget.current = 'answer'

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
      remember('Refused', preview)
    }

    setStage('preview')
  }

  /**
   * Look the same ticket up again, after an expired or mismatched reference.
   *
   * @returns {Promise<void>}
   */
  async function lookAgain() {
    if (presentation.current) await lookUp(presentation.current)
  }

  /**
   * A pass read by the camera.
   *
   * @param {string} credential The pass.
   * @returns {void}
   */
  function onPass(credential) {
    if (stage !== 'ready') return

    lookUp({ credential })
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

      <section aria-labelledby="door-event-heading">
        <h2 id="door-event-heading" className="text-lg font-semibold text-indigo-night-900">
          Event
        </h2>
        {events.length === 1 ? (
          <div className="mt-3 rounded-card border border-slate-200 p-4 text-sm">
            <p className="font-medium break-words text-indigo-night-900">{events[0].event.title}</p>
            <p className="mt-1 text-slate-700">
              {doorTime(events[0].event.startsAt, events[0].event.timezone)} ·{' '}
              {events[0].event.timezone}
            </p>
            <p className="mt-1 text-slate-600">{authorityLabel(events[0])}</p>
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
                  {entry.event.title} — {doorTime(entry.event.startsAt, entry.event.timezone)}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {selected && events.length > 1 ? (
          <p className="mt-2 text-sm text-slate-600">{authorityLabel(selected)}</p>
        ) : null}
      </section>

      {selected ? (
        <section aria-labelledby="door-present-heading">
          <h2 id="door-present-heading" className="text-lg font-semibold text-indigo-night-900">
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

                  if (typed) lookUp({ code: typed })
                }}
              >
                <FormField label="Printed ticket code" className="min-w-0 flex-1">
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
                onOther={() => setNotice('That QR code is not a ticket pass.')}
              />
            )}
          </div>
        </section>
      ) : (
        <p className="text-sm text-slate-700">Choose the event you are admitting to first.</p>
      )}

      {problem && !preview ? (
        <section aria-labelledby={answerId}>
          <h2
            id={answerId}
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-indigo-night-900"
          >
            Not found
          </h2>
          <Alert variant="error" className="mt-3">
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

      <section aria-labelledby="door-recent-heading">
        <h2 id="door-recent-heading" className="text-lg font-semibold text-indigo-night-900">
          This session
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            Nothing yet. Tickets you look up appear here until you leave this page; nothing is
            saved.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-200 text-sm">
            {recent.map((entry) => (
              <li key={entry.key} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 break-words">
                  <span className="font-medium text-indigo-night-900">{entry.name}</span>
                  {entry.tier ? <span className="text-slate-600"> · {entry.tier}</span> : null}
                </span>
                <span className="text-slate-700">
                  {entry.outcome} ·{' '}
                  <time dateTime={entry.at}>
                    {new Date(entry.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
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
      className={`rounded-card border p-4 ${
        preview.outcome === 'ADMISSIBLE' ? 'border-slate-300' : 'border-rose-300 bg-rose-50'
      }`}
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-indigo-night-900"
      >
        {heading}
      </h2>

      <p className="mt-3 text-2xl font-bold break-words text-indigo-night-900">
        {preview.attendeeName ?? 'No name on this ticket'}
      </p>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex flex-wrap gap-2">
          <dt className="text-slate-600">Event</dt>
          <dd className="break-words text-indigo-night-900">{preview.event.title}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-slate-600">Starts</dt>
          <dd className="text-indigo-night-900">
            {doorTime(preview.event.startsAt, preview.event.timezone)} · {preview.event.timezone}
          </dd>
        </div>
        {preview.tier ? (
          <div className="flex flex-wrap gap-2">
            <dt className="text-slate-600">Ticket</dt>
            <dd className="text-indigo-night-900">{preview.tier.name}</dd>
          </div>
        ) : null}
        {seat ? (
          <div className="flex flex-wrap gap-2">
            <dt className="text-slate-600">Seat</dt>
            <dd className="text-indigo-night-900">{seat}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <dt className="text-slate-600">Presented as</dt>
          <dd className="text-indigo-night-900">
            {preview.method === 'QR_SCAN' ? 'QR pass' : 'Printed code'}
          </dd>
        </div>
      </dl>

      {preview.outcome === 'ALREADY_CHECKED_IN' ? (
        <Alert variant="error" className="mt-3">
          This ticket was already admitted
          {preview.checkedInAt
            ? ` at ${doorTime(preview.checkedInAt, preview.event.timezone)}`
            : ''}
          . Each ticket admits once.
        </Alert>
      ) : null}

      {preview.outcome === 'REFUSED' ? (
        <Alert variant="error" className="mt-3">
          {refusalSentence(preview.refusal)}
          {preview.refusal === 'WRONG_EVENT' ? ` It is for ${preview.event.title}.` : ''}
        </Alert>
      ) : null}

      {problem ? (
        <Alert variant="error" className="mt-3">
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
      className={`rounded-card border p-4 ${admitted ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-indigo-night-900"
      >
        {admitted ? 'Admitted' : 'Already admitted by another steward'}
      </h2>
      <p className="mt-3 text-2xl font-bold break-words text-indigo-night-900">
        {result.attendeeName ?? 'Ticket holder'}
      </p>
      <p className="mt-2 text-sm text-slate-700">
        {result.outcome === 'ADMITTED'
          ? `Admitted at ${when}.`
          : result.checkedInByYou
            ? `You admitted this ticket at ${when}; the retry changed nothing.`
            : `This ticket was admitted at ${when}. Do not admit again.`}
      </p>
      {!admitted ? (
        <Alert variant="error" className="mt-3">
          Each ticket admits once. This one already has.
        </Alert>
      ) : null}
      <Button type="button" className="mt-4" onClick={onClear}>
        Next ticket
      </Button>
    </section>
  )
}
