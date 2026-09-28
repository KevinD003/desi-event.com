'use client'

/**
 * Bring a postponed event back with a new date.
 *
 * One form, one command: the event's new start and end, every session's new
 * times, where it comes back to — published with sales closed, or on sale —
 * and a reason. The server moves the dates and the status in one transaction,
 * so there is never a live event carrying the date it was postponed from.
 *
 * Sessions move with the event by default, by the same amount as its start, so
 * a nine-night run that slipped a week needs one change rather than nine. Each
 * session can still be set on its own.
 *
 * The copy is exact about what happens to ticket holders: a notice is recorded
 * for every current order. This build does not send email.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-reschedule-form
 */

import Link from 'next/link'
import { useState } from 'react'

import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button, FormField, Input, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { refusalSentence } from '../lib/refusal.js'
import { fromLocalInputValue, toLocalInputValue, zoneAbbreviation } from '../lib/zoned-time.js'

/**
 * Shift an instant by a number of milliseconds.
 *
 * @param {string|null} value An ISO instant.
 * @param {number} delta Milliseconds.
 * @returns {string|null} The shifted instant, or null.
 */
export function shiftInstant(value, delta) {
  if (!value) return null

  const time = new Date(value).getTime()

  return Number.isFinite(time) ? new Date(time + delta).toISOString() : null
}

/**
 * The sessions as they would be after the event's start moves by `delta`.
 *
 * @param {object[]} sessions The stored sessions.
 * @param {number} delta Milliseconds the event's start moved by.
 * @returns {object[]} `{id, startsAt, endsAt, doorsOpenAt}` per session.
 */
export function shiftSessions(sessions, delta) {
  return sessions.map((session) => ({
    id: session.id,
    startsAt: shiftInstant(session.startsAt, delta),
    endsAt: shiftInstant(session.endsAt, delta),
    doorsOpenAt: shiftInstant(session.doorsOpenAt, delta),
  }))
}

/**
 * @typedef {object} EventRescheduleFormProps
 * @property {object} event The postponed event.
 * @property {object[]} sessions Its sessions.
 * @property {number} revision The event's current revision.
 * @property {object|null} onSale The transitions entry for ON_SALE, or null.
 * @property {Function} onDone Called with the event after it comes back.
 * @property {Function} onCancel Called when the person backs out.
 */

/**
 * The form.
 *
 * @param {EventRescheduleFormProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function EventRescheduleForm({
  event,
  sessions = [],
  revision = 0,
  onSale = null,
  onDone = () => {},
  onCancel = () => {},
}) {
  const zone = event.timezone ?? 'America/New_York'
  const [startsAt, setStartsAt] = useState(event.startsAt)
  const [endsAt, setEndsAt] = useState(event.endsAt)
  const [together, setTogether] = useState(true)
  const [own, setOwn] = useState(() => shiftSessions(sessions, 0))
  const [resume, setResume] = useState('PUBLISHED')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [stepUp, setStepUp] = useState(false)
  const [needsEnrolment, setNeedsEnrolment] = useState(false)

  const delta =
    startsAt && event.startsAt
      ? new Date(startsAt).getTime() - new Date(event.startsAt).getTime()
      : 0
  const planned = together ? shiftSessions(sessions, delta) : own
  const canSell = Boolean(onSale?.entitled) && (onSale?.blockers ?? []).length === 0
  const ready = Boolean(startsAt && endsAt && reason.trim() && confirmed)

  /**
   * Move the event's start and keep its length, the way a person moves a date.
   *
   * @param {string} value The new local start.
   * @returns {void}
   */
  function moveStart(value) {
    const next = fromLocalInputValue(value, zone)

    if (!next) return

    const length = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()

    setStartsAt(next)
    setEndsAt(new Date(new Date(next).getTime() + length).toISOString())
  }

  /**
   * Change one session's own time.
   *
   * @param {string} id The session.
   * @param {string} field `startsAt` or `endsAt`.
   * @param {string} value The new local value.
   * @param {string} sessionZone The session's zone.
   * @returns {void}
   */
  function moveSession(id, field, value, sessionZone) {
    const next = fromLocalInputValue(value, sessionZone)

    setOwn((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: next ?? row[field] } : row)),
    )
  }

  /**
   * Send the command.
   *
   * @param {object} [submitted] The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function submit(submitted) {
    submitted?.preventDefault?.()

    if (!ready) return

    setBusy(true)
    setError(null)
    setProblems([])
    setNeedsEnrolment(false)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          revision,
          startsAt,
          endsAt,
          sessions: planned.map((row) => ({
            id: row.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            ...(row.doorsOpenAt ? { doorsOpenAt: row.doorsOpenAt } : {}),
          })),
          resume,
          confirm: true,
          reason: reason.trim(),
        }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok) {
        setStepUp(false)
        onDone(body?.data ?? null)
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp(true)
        return
      }

      if (body?.error?.code === 'MFA_ENROLMENT_REQUIRED') {
        setNeedsEnrolment(true)
        setError(
          'A role this account holds needs two-step sign-in before it can do this, and it is not set up yet. Nothing has changed.',
        )
        return
      }

      setError(refusalSentence(response.status, body, 'The new date was refused.'))
      setProblems(body?.error?.problems ?? [])
    } catch {
      setError('The service is not responding. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    // The step-up prompt is a form of its own, so it sits beside this one
    // rather than inside it: a form inside a form is invalid, and its submit
    // would bubble into this one's handler.
    <section
      aria-labelledby="reschedule-heading"
      className="space-y-4 rounded-card border-2 border-ink bg-surface-raised p-4"
    >
      <h3 id="reschedule-heading" className="text-lg font-semibold text-ink">
        Set a new date and bring it back
      </h3>
      <p className="text-sm text-ink-muted">
        Times are in {zone} ({zoneAbbreviation(zone, new Date(startsAt ?? Date.now()))}). A notice
        is recorded for every current order with the new date and your reason. This build does not
        send email, so tell ticket holders yourself as well.
      </p>

      <form onSubmit={submit} aria-labelledby="reschedule-heading" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="New start" id="reschedule-startsAt" required>
            <Input
              type="datetime-local"
              value={toLocalInputValue(startsAt, zone)}
              onChange={(change) => moveStart(change.target.value)}
            />
          </FormField>
          <FormField label="New end" id="reschedule-endsAt" required>
            <Input
              type="datetime-local"
              value={toLocalInputValue(endsAt, zone)}
              onChange={(change) =>
                setEndsAt(fromLocalInputValue(change.target.value, zone) ?? endsAt)
              }
            />
          </FormField>
        </div>

        {sessions.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="font-medium text-ink">Sessions</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={together}
                onChange={(change) => {
                  if (!change.target.checked) setOwn(shiftSessions(sessions, delta))
                  setTogether(change.target.checked)
                }}
              />
              Move every session by the same amount
            </label>

            <ol className="space-y-3">
              {sessions.map((session, index) => {
                const row = planned.find((candidate) => candidate.id === session.id)
                const sessionZone = session.timezone ?? zone

                return (
                  <li key={session.id} className="rounded-card border border-line p-3">
                    <p className="text-sm font-medium text-ink">
                      Session {index + 1}{' '}
                      <span className="font-normal text-ink-muted">({sessionZone})</span>
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField
                        label={`Session ${index + 1} starts`}
                        id={`reschedule-${session.id}-start`}
                      >
                        <Input
                          type="datetime-local"
                          disabled={together}
                          value={toLocalInputValue(row?.startsAt, sessionZone)}
                          onChange={(change) =>
                            moveSession(session.id, 'startsAt', change.target.value, sessionZone)
                          }
                        />
                      </FormField>
                      <FormField
                        label={`Session ${index + 1} ends`}
                        id={`reschedule-${session.id}-end`}
                      >
                        <Input
                          type="datetime-local"
                          disabled={together}
                          value={toLocalInputValue(row?.endsAt, sessionZone)}
                          onChange={(change) =>
                            moveSession(session.id, 'endsAt', change.target.value, sessionZone)
                          }
                        />
                      </FormField>
                    </div>
                  </li>
                )
              })}
            </ol>
          </fieldset>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="font-medium text-ink">When it comes back</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="reschedule-resume"
              value="PUBLISHED"
              checked={resume === 'PUBLISHED'}
              onChange={() => setResume('PUBLISHED')}
            />
            Published, with sales closed until you open them
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="reschedule-resume"
              value="ON_SALE"
              checked={resume === 'ON_SALE'}
              disabled={!canSell}
              onChange={() => setResume('ON_SALE')}
            />
            On sale straight away
          </label>
          {!canSell ? (
            <div className="text-sm text-ink-muted">
              {onSale && !onSale.entitled ? (
                <p>Somebody with more permission than you has to open sales.</p>
              ) : (
                <>
                  <p>Sales cannot reopen until:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {(onSale?.blockers ?? ['The server has not said sales can reopen.']).map(
                      (blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ),
                    )}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </fieldset>

        <FormField
          label="Why, for the people holding tickets"
          id="reschedule-reason"
          required
          description="Recorded with the notice for every current order."
        >
          <Textarea rows={3} value={reason} onChange={(change) => setReason(change.target.value)} />
        </FormField>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(change) => setConfirmed(change.target.checked)}
          />
          I understand this changes the date people bought tickets for, and a notice will be
          recorded for every current order.
        </label>

        {error ? (
          <Alert variant="error" title="The new date was not saved">
            <p>{error}</p>
            {needsEnrolment ? (
              <p className="mt-2">
                <Link
                  href="/account/security"
                  className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  Set up two-step sign-in
                </Link>
              </p>
            ) : null}
            {problems.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? 'Bringing it back…' : 'Bring it back'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Not now
          </Button>
        </div>
      </form>

      {stepUp ? (
        <StepUpPrompt
          action="bring this event back"
          onConfirmed={() => {
            setStepUp(false)
            void submit()
          }}
          onCancel={() => setStepUp(false)}
        />
      ) : null}
    </section>
  )
}
