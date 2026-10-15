'use client'

/**
 * Moving an imported event to an organiser's own organisation (SPEC2-XI I-F).
 *
 * An imported event is held by "The Desi Events", which has no members. Once
 * its organiser has an organisation here, the team at The Desi Events moves it
 * there: its status, pictures, web address and ticket types stay as they
 * are, and it stops being presented as an imported listing, so its new owner
 * runs it from then on.
 *
 * The organisation is not asked first: the event appears in its list at once.
 * The dialog says so, in the words the specification gives.
 *
 * Organisations are found by name or web address
 * (`GET /v1/platform/import-targets?q=`): verified, not suspended, and not
 * held for imports. The move is `POST
 * /v1/platform/imports/events/:eventId/reassign` with the organisation, a
 * reason (kept with the event's history) and the revision this page read; it
 * needs a recent second factor, and is sent once more after one is given. Once
 * it has moved, the page is drawn again with `?moved=1` and says so itself,
 * since it no longer offers this dialog.
 *
 * It is an inline region rather than a modal: focus moves to its heading when
 * it opens and back to its opener when it closes, and every message is in a
 * polite live region. Whether it is offered at all is decided on the server
 * page, which hands this component nothing but the event.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/reassign-event-dialog
 */

import { usePathname, useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { ControlReasonField } from './control-reason-field.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Button, FormField, Input } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { reasonProblem } from '../lib/event-control.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../lib/refusal.js'

/** What the dialog says about asking the organisation (SPEC2-XI I-F). */
export const NOT_ASKED_SENTENCE =
  'The organisation is not asked before the event moves. Agree it with them first.'

/** What moving does, said before anything is sent. */
export const MOVE_SENTENCE =
  'The event keeps its status, pictures, web address and ticket types, and it is no longer shown as an imported listing: the organisation runs it from then on, and any of its event managers can change or delete it.'

/**
 * @typedef {object} ReassignEventDialogProps
 * @property {{id: string, title: string, revision: number}} event The event.
 */

/**
 * The opener and, once pressed, the region.
 *
 * @param {ReassignEventDialogProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function ReassignEventDialog({ event }) {
  const router = useRouter()
  const pathname = usePathname()
  const id = useId()
  const openerRef = useRef(null)
  const headingRef = useRef(null)
  const summaryRef = useRef(null)
  const resultRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchFailure, setSearchFailure] = useState(null)
  const [targetId, setTargetId] = useState(null)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [stepUp, setStepUp] = useState(false)
  const [moved, setMoved] = useState(null)

  const target = targets?.find((each) => each.id === targetId) ?? null
  // Before a search there is no list to choose from: the target's error is
  // shown on the search box, and the summary links there.
  const problems = [
    errors.target ? { field: targets ? 'target' : 'search', message: errors.target } : null,
    errors.reason ? { field: 'reason', message: errors.reason } : null,
  ].filter(Boolean)

  /**
   * Find organisations by name or web address.
   *
   * @returns {Promise<void>} Resolves when the answer is drawn.
   */
  async function search() {
    const q = query.trim()

    setSearching(true)
    setSearchFailure(null)

    try {
      const response = await apiFetch('/v1/platform/import-targets', {
        query: q ? { q } : {},
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setTargets(parsed?.data ?? [])
        setTargetId(null)
      } else {
        setSearchFailure(refusalSentence(response.status, parsed, 'The search did not answer.'))
      }
    } catch {
      setSearchFailure(describeApiRefusal(null).detail)
    } finally {
      setSearching(false)
    }
  }

  /**
   * Check the form, then send the move.
   *
   * @param {boolean} [retried] Whether this is the one retry after a step-up.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(retried = false) {
    const found = {
      ...(target
        ? {}
        : {
            target: targets
              ? 'Choose the organisation to move it to.'
              : 'Search for the organisation to move it to, then choose it.',
          }),
      ...(reasonProblem(reason.trim()) ? { reason: reasonProblem(reason.trim()) } : {}),
    }

    setErrors(found)
    setRefusal(null)

    if (Object.keys(found).length > 0) {
      focusAfterRender(summaryRef)
      return
    }

    setBusy(true)

    try {
      const response = await apiFetch(
        `/v1/platform/imports/events/${encodeURIComponent(event.id)}/reassign`,
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId: target.id,
            reason: reason.trim(),
            revision: event.revision,
          }),
        },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        setMoved(target.name)
        focusAfterRender(resultRef)
        // A moved event is no longer held for an import, so the page no
        // longer offers this dialog: refreshing alone would take the outcome
        // away with it, before anybody had read it. The page says what
        // happened instead, told so by `?moved=1`.
        router.replace(`${pathname}?moved=1`)
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
          'The event was not moved.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(summaryRef)
    } catch {
      setRefusal(describeApiRefusal(null).detail)
      focusAfterRender(summaryRef)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => {
          setOpen(true)
          focusAfterRender(headingRef)
        }}
      >
        Move to an organisation…
      </Button>
    )
  }

  return (
    <div className="space-y-4 rounded-card border border-line bg-surface-raised p-4">
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink">
        {`Move “${event.title}” to an organisation`}
      </h3>
      <p className="text-sm font-semibold text-ink">{NOT_ASKED_SENTENCE}</p>
      <p className="text-sm text-ink-muted">{MOVE_SENTENCE}</p>

      <div role="status" aria-live="polite">
        {moved ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="rounded-card border border-status-success/25 bg-status-success-soft p-4 text-sm text-ink focus-visible:outline-none"
          >
            <p className="font-semibold">Moved</p>
            <p className="mt-1">{`The event now belongs to ${moved}.`}</p>
          </div>
        ) : null}
      </div>

      {/*
        The second-factor prompt is a form of its own, so it is drawn after
        the move form rather than inside it: a form within a form is not
        HTML, and the browser could send the outer form instead.
      */}
      {moved ? null : (
        <>
          <form
            onSubmit={(submitted) => {
              submitted.preventDefault()
              void send()
            }}
            noValidate
            className="space-y-4"
            aria-label="Move this event"
          >
            {problems.length > 0 || refusal ? (
              <div
                ref={summaryRef}
                tabIndex={-1}
                className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:outline-none"
              >
                <h4 className="text-sm font-semibold text-status-danger">
                  {refusal
                    ? 'Not moved'
                    : problems.length === 1
                      ? 'One thing to fix before moving it'
                      : `${problems.length} things to fix before moving it`}
                </h4>
                {refusal ? <p className="mt-1 text-sm text-status-danger">{refusal}</p> : null}
                {problems.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
                    {problems.map((problem) => (
                      <li key={problem.field}>
                        <a
                          className="underline underline-offset-4"
                          href={`#${id}-${problem.field}`}
                        >
                          {problem.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <FormField
                  label="Find the organisation"
                  id={`${id}-search`}
                  description="By its name or web address. Only verified organisations are listed."
                  error={targets ? undefined : errors.target}
                >
                  <Input
                    type="search"
                    autoComplete="off"
                    maxLength={120}
                    value={query}
                    onChange={(changed) => setQuery(changed.target.value)}
                    onKeyDown={(pressed) => {
                      if (pressed.key === 'Enter') {
                        pressed.preventDefault()
                        void search()
                      }
                    }}
                  />
                </FormField>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={searching}
                onClick={() => void search()}
              >
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </div>

            {searchFailure ? <p className="text-sm text-status-danger">{searchFailure}</p> : null}

            {targets ? (
              <fieldset
                id={`${id}-target`}
                tabIndex={-1}
                aria-describedby={errors.target ? `${id}-target-error` : undefined}
                className="space-y-2"
              >
                <legend className="text-sm font-medium text-ink">Move it to</legend>
                {targets.length === 0 ? (
                  <p className="text-sm text-ink-muted">No verified organisation matches.</p>
                ) : (
                  targets.map((each) => (
                    <label
                      key={each.id}
                      className="flex min-h-11 items-center gap-3 text-sm text-ink"
                    >
                      <input
                        type="radio"
                        name={`${id}-target`}
                        value={each.id}
                        checked={targetId === each.id}
                        onChange={() => setTargetId(each.id)}
                        className="h-5 w-5 accent-action-primary"
                      />
                      <span>
                        {each.name} <span className="text-ink-muted">({each.slug})</span>
                      </span>
                    </label>
                  ))
                )}
                {errors.target ? (
                  <p id={`${id}-target-error`} className="text-sm text-status-danger">
                    {errors.target}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <ControlReasonField
              id={`${id}-reason`}
              label="Why it moves"
              value={reason}
              onChange={setReason}
              error={errors.reason ?? null}
              disabled={busy}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={busy || stepUp}>
                {busy ? 'Moving…' : 'Move the event'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  focusAfterRender(openerRef)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>

          {stepUp ? (
            <StepUpPrompt
              action="move this event"
              onConfirmed={() => {
                setStepUp(false)
                void send(true)
              }}
              onCancel={() => setStepUp(false)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
