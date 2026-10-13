'use client'

/**
 * Deleting an event, for its organisers and for the Desi-Event team.
 *
 * The server decides what a deletion does — take an unsold event down, cancel
 * and refund a sold one, or take down the page of one that has taken place —
 * and decides it again when the deletion is sent. So this asks it first
 * (`GET /v1/events/:id/deletion`), shows its answer in sentences built from its
 * counts (`lib/event-control.js`), and sends that outcome back as the one the
 * person agreed to. If it no longer holds, the server refuses
 * (`OUTCOME_CHANGED`) and this reads the preview again and says why.
 *
 * It is an inline region rather than a modal: focus moves to its heading when
 * it opens and back to the button that opened it when it closes, and nothing
 * else on the page is hidden from anybody while it is open. Every message is
 * in a polite live region.
 *
 * The web address is typed back to confirm, compared the way the server
 * compares it. The submit button stays enabled: a mismatch is said in words,
 * under the box and in the error summary, rather than by a button that will
 * not press (SPEC2-XI Xm6).
 *
 * Who may delete is the server's answer too (`permitted`, `missing`). The
 * page that renders this decides only whether to offer the button, from
 * booleans it worked out on the server.
 *
 * Bookings made to pay at the venue (the preview's `atVenue`, SPEC3 §9.7):
 * when the deletion refunds, only their booking fee paid online is refunded,
 * simulated; and any payment taken at the door is held by the organiser,
 * which Desi-Event neither holds nor can refund.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/delete-event-dialog
 */

import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { ControlReasonField } from './control-reason-field.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { TEXT_LINK } from './link-classes.js'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { Alert, Button, FormField, Input } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  CHOICE_LABELS,
  CHOICE_PROMPT,
  counted,
  deleteButtonLabel,
  deletionSentences,
  reasonProblem,
  refundSummarySentence,
  refundsLeftOver,
  slugMatches,
} from '../lib/event-control.js'
import { atVenueSentences } from '../lib/door.js'
import { formatAmount } from '../lib/pricing.js'
import { refusalSentence } from '../lib/refusal.js'

/**
 * @typedef {object} DeleteEventDialogProps
 * @property {{id: string, title: string, slug: string}} event The event.
 * @property {string} listHref Where "Back to your events" goes after a deletion, without a query.
 * @property {string} [listLabel] What that link says.
 * @property {string} [opener] What the opening button says.
 */

/**
 * The button and, once pressed, the region.
 *
 * @param {DeleteEventDialogProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function DeleteEventDialog({
  event,
  listHref,
  listLabel = 'Back to your events',
  opener = 'Delete this event…',
}) {
  const id = useId()
  const openerRef = useRef(null)
  const headingRef = useRef(null)
  const summaryRef = useRef(null)
  const resultRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [readFailure, setReadFailure] = useState(null)
  const [changedNote, setChangedNote] = useState(null)
  const [choice, setChoice] = useState(null)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [problems, setProblems] = useState([])
  const [refusal, setRefusal] = useState(null)
  const [stepUp, setStepUp] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)

  const outcome = preview?.outcome ?? choice ?? null
  const errors = Object.fromEntries(problems.map((problem) => [problem.field, problem.message]))

  /**
   * Ask the server what deleting would do now.
   *
   * @returns {Promise<object|null>} The preview, or null when it could not be read.
   */
  async function readPreview() {
    setReadFailure(null)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/deletion`)
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setPreview(body.data)
        setChoice((current) =>
          body.data.choices?.includes(current) ? current : (body.data.outcome ?? null),
        )
        return body.data
      }

      setReadFailure(
        refusalSentence(response.status, body, 'What deleting would do could not be read.'),
      )
    } catch {
      setReadFailure('The service is not responding. Nothing has been deleted.')
    }

    return null
  }

  /**
   * Open the region and read the preview.
   *
   * @returns {Promise<void>} Resolves once the preview is read.
   */
  async function openRegion() {
    setOpen(true)
    setResult(null)
    setRefusal(null)
    setChangedNote(null)
    setProblems([])
    focusAfterRender(headingRef)
    await readPreview()
  }

  /**
   * Close the region, returning focus to the button that opened it.
   *
   * @returns {void}
   */
  function close() {
    setOpen(false)
    setStepUp(null)
    setPreview(null)
    setProblems([])
    setRefusal(null)
    focusAfterRender(openerRef)
  }

  /**
   * What stops the deletion being sent, field by field.
   *
   * @returns {Array<{field: string, message: string}>} The problems.
   */
  function check() {
    const found = []

    if (preview?.choices && !choice) {
      found.push({ field: 'choice', message: 'Say whether the event took place.' })
    }

    const reasonIssue = reasonProblem(reason)

    if (reasonIssue) found.push({ field: 'reason', message: reasonIssue })

    if (!slugMatches(typed, preview?.slug?.value ?? event.slug)) {
      found.push({
        field: 'slug',
        message: typed.trim()
          ? 'That is not this event’s web address. Type it exactly as shown.'
          : 'Type the event’s web address to confirm.',
      })
    }

    return found
  }

  /**
   * Send the deletion.
   *
   * @param {object} [submitted] The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(submitted) {
    submitted?.preventDefault()
    setRefusal(null)
    setChangedNote(null)

    const found = check()

    setProblems(found)

    if (found.length > 0) {
      focusAfterRender(summaryRef)
      return
    }

    setBusy(true)
    setProgress(
      outcome === 'CANCEL_AND_REFUND'
        ? `Cancelling, refunding ${counted(
            Math.max(0, (preview.counts.paidOrders ?? 0) - (preview.counts.disputedOrders ?? 0)),
            'order',
            'orders',
          )} and deleting…`
        : 'Deleting…',
    )

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/delete`, {
        method: 'POST',
        body: JSON.stringify({
          revision: preview.revision,
          reason: reason.trim(),
          confirmSlug: typed.trim(),
          expectedOutcome: outcome,
          ...(outcome === 'REMOVE_AFTER_EVENT' && preview.needsTookPlaceConfirmation
            ? { confirmTookPlace: true }
            : {}),
        }),
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setProgress('')
        setResult({ refunds: body.data.refunds ?? null, finish: null })
        focusAfterRender(resultRef)
        return
      }

      const code = body?.error?.code ?? null

      setProgress('')

      if (code === 'STEP_UP_REQUIRED') {
        // The server decides when; this only reacts to being told.
        setStepUp('delete')
        return
      }

      if (code === 'OUTCOME_CHANGED' || code === 'STALE_REVISION') {
        // What deleting does moved under the person's feet: read it again and
        // say so, keeping what they typed.
        await readPreview()
        setChangedNote(
          `${refusalSentence(response.status, body, 'The event changed.')} What deleting does now is shown below; read it again before you confirm.`,
        )
        focusAfterRender(headingRef)
        return
      }

      setRefusal(refusalSentence(response.status, body, 'The event was not deleted.'))
      focusAfterRender(summaryRef)
    } catch {
      setProgress('')
      setRefusal('The service is not responding. Nothing has been deleted.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Send the refunds a deletion left waiting or that did not go through.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function finishRefunds() {
    setBusy(true)
    setProgress('Sending the refunds that are left…')

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(event.id)}/refunds/finish`, {
        method: 'POST',
      })
      const body = await response.json().catch(() => null)

      setProgress('')

      if (response.ok && body?.data) {
        setResult((current) => ({ ...current, refunds: body.data, finish: null }))
        return
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        setStepUp('finish')
        return
      }

      setResult((current) => ({
        ...current,
        finish: refusalSentence(response.status, body, 'The refunds were not sent.'),
      }))
    } catch {
      setProgress('')
      setResult((current) => ({
        ...current,
        finish: 'The service is not responding. No refund has been sent.',
      }))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button ref={openerRef} type="button" variant="danger" onClick={openRegion}>
        {opener}
      </Button>
    )
  }

  const headingId = `${id}-heading`
  const slug = preview?.slug?.value ?? event.slug
  const counts = preview?.counts ?? null
  const sentences = preview
    ? [
        ...deletionSentences(preview, outcome),
        ...atVenueSentences(preview.atVenue, counts?.currency ?? 'USD', {
          refunds: outcome === 'CANCEL_AND_REFUND',
        }),
      ]
    : []
  const decidable = preview && !preview.refusal && preview.permitted

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-status-danger/30 bg-surface-raised p-4"
    >
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none"
      >
        Delete “{event.title}”
      </h3>

      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {!preview && !readFailure ? 'Reading what deleting would do…' : progress}
      </p>

      {readFailure ? (
        <Alert variant="error" title="Not read">
          <p>{readFailure}</p>
        </Alert>
      ) : null}

      {changedNote ? (
        <Alert variant="warning" title="What deleting does has changed">
          <p>{changedNote}</p>
        </Alert>
      ) : null}

      {result ? (
        <div ref={resultRef} tabIndex={-1} className="space-y-3 focus-visible:outline-none">
          <Alert variant="success" title="Deleted">
            <p>
              Its page is off the site.{' '}
              {refundSummarySentence(result.refunds) ?? 'Nobody was owed a refund.'}
            </p>
          </Alert>
          {result.finish ? (
            <Alert variant="error" title="Refunds not sent">
              <p>{result.finish}</p>
            </Alert>
          ) : null}
          {stepUp === 'finish' ? (
            <StepUpPrompt
              action="send the refunds that are left"
              onConfirmed={() => {
                setStepUp(null)
                finishRefunds()
              }}
              onCancel={() => setStepUp(null)}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {refundsLeftOver(result.refunds) && !stepUp ? (
              <Button type="button" variant="secondary" loading={busy} onClick={finishRefunds}>
                Try those again
              </Button>
            ) : null}
            <Link href={`${listHref}?deleted=1`} className={TEXT_LINK}>
              {listLabel}
            </Link>
          </div>
        </div>
      ) : null}

      {preview && !result && preview.refusal ? (
        <Alert variant="warning" title="This event cannot be deleted now">
          <p>{preview.refusal.message}</p>
        </Alert>
      ) : null}

      {preview && !result && !preview.refusal && !preview.permitted ? (
        <Alert variant="info" title="Somebody else decides this">
          <p>{preview.missing}</p>
        </Alert>
      ) : null}

      {decidable && !result ? (
        <form onSubmit={send} noValidate className="space-y-4">
          {problems.length > 0 || refusal ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:outline-none"
            >
              <h4 className="text-sm font-semibold text-status-danger">
                {refusal
                  ? 'Not deleted'
                  : problems.length === 1
                    ? 'One thing to fix before deleting'
                    : `${problems.length} things to fix before deleting`}
              </h4>
              {refusal ? <p className="mt-1 text-sm text-status-danger">{refusal}</p> : null}
              {problems.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-status-danger">
                  {problems.map((problem) => (
                    <li key={problem.field}>
                      <a className="underline underline-offset-4" href={`#${id}-${problem.field}`}>
                        {problem.message}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {preview.choices ? (
            <fieldset
              id={`${id}-choice`}
              tabIndex={-1}
              aria-describedby={errors.choice ? `${id}-choice-error` : undefined}
              className="space-y-2 rounded-card border border-line p-4"
            >
              <legend className="px-1 text-sm font-semibold text-ink">{CHOICE_PROMPT}</legend>
              {preview.choices.map((option) => (
                <label key={option} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={`${id}-outcome`}
                    value={option}
                    checked={choice === option}
                    onChange={() => setChoice(option)}
                    className="size-4 border-line-strong"
                  />
                  {CHOICE_LABELS[option] ?? option}
                </label>
              ))}
              {errors.choice ? (
                <p id={`${id}-choice-error`} className="text-sm font-medium text-status-danger">
                  {errors.choice}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {sentences.length > 0 ? (
            <div className="space-y-2 text-sm text-ink" aria-live="polite">
              {sentences.map((sentence) => (
                <p key={sentence}>{sentence}</p>
              ))}
            </div>
          ) : null}

          {counts ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Paid orders</dt>
                <dd className="font-medium text-ink">
                  {counts.paidOrders.toLocaleString('en-US')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Left to refund</dt>
                <dd className="font-medium text-ink">
                  {formatAmount(counts.refundableCents ?? 0, counts.currency ?? 'USD')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Free orders</dt>
                <dd className="font-medium text-ink">
                  {counts.zeroValueOrders.toLocaleString('en-US')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Disputed orders</dt>
                <dd className="font-medium text-ink">
                  {counts.disputedOrders.toLocaleString('en-US')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Tickets held</dt>
                <dd className="font-medium text-ink">{counts.tickets.toLocaleString('en-US')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Check-ins</dt>
                <dd className="font-medium text-ink">{counts.checkIns.toLocaleString('en-US')}</dd>
              </div>
            </dl>
          ) : null}

          <ControlReasonField
            id={`${id}-reason`}
            label="Why is this event being deleted?"
            value={reason}
            onChange={setReason}
            error={errors.reason ?? null}
            disabled={busy}
          />

          <FormField
            label={
              <>
                Type the event’s web address, <code className="font-mono">{slug}</code>, to confirm
              </>
            }
            id={`${id}-slug`}
            required
            {...(errors.slug ? { error: errors.slug } : {})}
          >
            <Input
              value={typed}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(change) => setTyped(change.target.value)}
            />
          </FormField>

          {!stepUp ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" loading={busy}>
                {deleteButtonLabel(outcome)}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {/* Outside the form: the prompt is a form of its own. */}
      {decidable && !result && stepUp === 'delete' ? (
        <StepUpPrompt
          action="delete this event"
          onConfirmed={() => {
            setStepUp(null)
            send()
          }}
          onCancel={() => setStepUp(null)}
        />
      ) : null}

      {!decidable && !result ? (
        <Button type="button" variant="ghost" onClick={close}>
          Close
        </Button>
      ) : null}
    </section>
  )
}
