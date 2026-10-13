'use client'

/**
 * Cancelling unpaid tickets of one booking made to pay at the venue (SPEC3-XI
 * §12.14, XU1–XU14).
 *
 * The organiser who may refund the organisation's orders, or the Desi-Event
 * team, chooses tickets of one booking that still owe their door price and
 * cancels them: each stops admitting, nobody owes its price any more, its
 * place is freed, and Desi-Event keeps the booking fee paid online for it.
 * Nothing is refunded. It cannot be undone.
 *
 * ## What it reads, and when it asks for a second factor
 *
 * On opening it reads the booking's tickets (`venueBookings.unpaid` with
 * `order`), which asks for a second factor within the FINANCE_VIEW window; the
 * prompt opens in place and the read is made again once it is confirmed.
 * Cancelling asks for one within FINANCE_ACTION, the same way, and sends the
 * same request again. The server decides when either has lapsed.
 *
 * The prompt takes focus when it opens, and focus stays inside the dialog
 * whatever happens to it: confirming puts it on the heading until the answer
 * moves it, and backing out puts it on what was not done. Backing out of the
 * read says why the tickets are not shown — the page's own words for a read
 * waiting on a second factor — and offers to ask again; it never says the
 * booking has no unpaid tickets, which nobody has read. Backing out of the
 * cancellation says nothing was sent.
 *
 * ## What it sends
 *
 * The ticked tickets by id — every cancellable ticket is ticked to start with
 * — and the reason. The request is all or nothing: a ticket paid at the door,
 * let in, passed on or cancelled since the booking was read refuses the whole
 * request (`VENUE_BOOKING_CHANGED`), and the dialog reads the booking again,
 * says so, and takes focus to its heading. Every other refusal is the API's
 * own sentence.
 *
 * ## Accessibility
 *
 * A modal dialog (`Modal` from the component library, through the app's
 * client boundary `./ui.jsx`): focus is trapped
 * inside it, it is labelled by its heading, which takes focus on opening, and
 * Escape or "Keep them" closes it and returns focus to the button that opened
 * it. The tickets are a `<fieldset>` of native checkboxes; "Select all" is
 * checked when every cancellable ticket is ticked, unchecked when none is,
 * and `indeterminate` in between. Field errors go to an error summary that
 * takes focus and links to each field. Status messages are polite.
 *
 * Capability-free: whether this reader may cancel is the server page's
 * boolean, and the server decides every request again.
 *
 * @module components/cancel-unpaid-tickets-dialog
 */

import {
  REASON_LIMITS,
  VENUE_CANCEL_LIMITS,
  VENUE_CANCEL_REASON_DESCRIPTION,
} from '@desi-event/schemas/payment-terms'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { readStepUpSentence } from './step-up-for-read.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { STEP_UP_DECLINED_SENTENCE } from './step-up-retry.jsx'
import { Alert, Button, FormField, Modal, Textarea } from './ui.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import { formatAmount } from '../lib/pricing.js'
import { refusalSentence } from '../lib/refusal.js'

/** Instants are written in UTC, the way the admin lists write them. */
const INSTANT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/** What a reader is told when the service does not answer. */
const NOT_ANSWERING = 'The service is not responding. Nothing has been cancelled.'

/**
 * The API's sentence for `TRY_AGAIN`, when its answer carried none (SPEC3-XI
 * XU10).
 */
const TRY_AGAIN_SENTENCE =
  'Another change to this booking was being saved at the same moment, so nothing was cancelled. Try again in a moment.'

/**
 * An instant in words, in UTC.
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @returns {string} The words, or an empty string.
 */
export function instantWords(value) {
  if (!value) return ''

  const at = new Date(value)

  return Number.isNaN(at.getTime()) ? '' : `${INSTANT.format(at)} UTC`
}

/**
 * "ticket" or "tickets".
 *
 * @param {number} count How many.
 * @returns {string} The word.
 */
function tickets(count) {
  return count === 1 ? 'ticket' : 'tickets'
}

/**
 * What the cancellation did, in the sentences SPEC3-XI §12.14 gives: how many
 * were cancelled, whether their places are on sale now, and — only for the
 * organiser, whose decision it is — that sales have to be opened to sell them.
 * A replay (the same tickets already cancelled together) says so instead.
 *
 * @param {object} result The `venueBookings.cancel` answer's `data`.
 * @returns {string} The sentences.
 */
export function cancellationOutcome(result) {
  const count = result.ticketCount

  if (result.replayed) {
    const by = result.byName ? ` by ${result.byName}` : ''

    return `These tickets were already cancelled${by} at ${instantWords(result.cancelledAt)}.`
  }

  const one = count === 1
  const sentences = [`${count} ${tickets(count)} cancelled.`]

  if (result.placesOnSale === 'ALL') {
    sentences.push(one ? 'Its place is back on sale.' : 'Their places are back on sale.')
  } else if (result.placesOnSale === 'NONE') {
    sentences.push(
      one
        ? 'Its place is free again but not on sale now: sales for it are closed or paused.'
        : 'Their places are free again but not on sale now: sales for them are closed or paused.',
    )
  } else {
    sentences.push(
      'Their places are free again; some are back on sale, and sales for the others are closed or paused.',
    )
  }

  if (result.by === 'ORGANISER' && result.eventSalesStopped) {
    sentences.push(`Open sales on the event page to sell ${one ? 'it' : 'them'}.`)
  }

  return sentences.join(' ')
}

/**
 * One ticket in words: who or which, its night, what it owes.
 *
 * @param {object} ticket A `venueBookingTicketSchema` ticket.
 * @param {string} currency The booking's currency.
 * @returns {string} "Asha Rao — Every night — $45.00".
 */
export function ticketWords(ticket, currency) {
  const night = ticket.nightLabel ?? (ticket.everyNight ? 'Every night' : null)

  return [ticket.attendeeName ?? ticket.label, night, formatAmount(ticket.dueCents, currency)]
    .filter(Boolean)
    .join(' — ')
}

/**
 * What stops the cancellation being sent, field by field (SPEC3-XI §12.14).
 *
 * @param {string[]} chosen The ticked ticket ids.
 * @param {string} reason The reason as typed.
 * @returns {Array<{field: string, message: string}>} The problems.
 */
export function cancellationProblems(chosen, reason) {
  const found = []
  const length = reason.trim().length

  if (chosen.length === 0) found.push({ field: 'tickets', message: 'Choose at least one ticket.' })
  if (chosen.length > VENUE_CANCEL_LIMITS.maxTickets) {
    found.push({
      field: 'tickets',
      message: `Choose ${VENUE_CANCEL_LIMITS.maxTickets} tickets at most.`,
    })
  }
  if (length < REASON_LIMITS.min) {
    found.push({ field: 'reason', message: 'Give a reason of at least 10 characters.' })
  } else if (length > REASON_LIMITS.max) {
    found.push({ field: 'reason', message: '500 characters at most.' })
  }

  return found
}

/**
 * @typedef {object} CancelUnpaidTicketsDialogProps
 * @property {string} eventId The event the booking is for.
 * @property {string} orderReference The booking.
 * @property {Function} onClose Called when the person closes the dialog without cancelling.
 * @property {Function} onCancelled Given the cancellation's `data` once tickets are cancelled.
 */

/**
 * The dialog. Rendered by its owner while open.
 *
 * @param {CancelUnpaidTicketsDialogProps} props Component props.
 * @returns {JSX.Element} The dialog.
 */
export function CancelUnpaidTicketsDialog({ eventId, orderReference, onClose, onCancelled }) {
  const id = useId()
  const headingId = `${id}-heading`
  const headingRef = useRef(null)
  const summaryRef = useRef(null)
  const allRef = useRef(null)
  const promptRef = useRef(null)
  const declinedRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [booking, setBooking] = useState(null)
  const [currency, setCurrency] = useState('USD')
  const [reading, setReading] = useState(true)
  // Whether the server has answered a read with the booking's tickets: only
  // then can the dialog say the booking has none waiting.
  const [readAnswered, setReadAnswered] = useState(false)
  const [readDeclined, setReadDeclined] = useState(false)
  const [readFailure, setReadFailure] = useState(null)
  const [chosen, setChosen] = useState([])
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState([])
  const [refusal, setRefusal] = useState(null)
  const [changedNote, setChangedNote] = useState(null)
  const [stepUpFor, setStepUpFor] = useState(null)
  const [busy, setBusy] = useState(false)

  const cancellable = (booking?.tickets ?? []).filter((ticket) => ticket.cancellable)
  const allTicked = cancellable.length > 0 && cancellable.every((t) => chosen.includes(t.ticketId))
  const someTicked = cancellable.some((ticket) => chosen.includes(ticket.ticketId))
  const errors = Object.fromEntries(problems.map((problem) => [problem.field, problem.message]))

  // A native checkbox has no `indeterminate` attribute, only the property.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someTicked && !allTicked
  })

  /**
   * Ask for a second factor, in place, and move focus into the prompt: the
   * button that was pressed may be gone with the form, and focus left on the
   * page behind would escape the dialog.
   *
   * @param {'read'|'cancel'} kind What waits for it.
   * @returns {void}
   */
  const askStepUp = useCallback(
    (kind) => {
      setStepUpFor(kind)
      setReadDeclined(false)
      focusAfterRender(promptRef)
    },
    [focusAfterRender],
  )

  /**
   * Read the booking's unpaid tickets, ticking every cancellable one.
   *
   * @returns {Promise<boolean>} Whether it was read.
   */
  const read = useCallback(async () => {
    setReading(true)
    setReadFailure(null)

    try {
      const response = await apiFetch(`/v1/events/${encodeURIComponent(eventId)}/venue-bookings`, {
        query: { order: orderReference },
      })
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        const found =
          (body.data.bookings ?? []).find((entry) => entry.orderReference === orderReference) ??
          null

        setBooking(found)
        setReadAnswered(true)
        setCurrency(body.data.currency ?? 'USD')
        setChosen(
          (found?.tickets ?? [])
            .filter((ticket) => ticket.cancellable)
            .map((ticket) => ticket.ticketId),
        )
        return true
      }

      if (body?.error?.code === 'STEP_UP_REQUIRED') {
        askStepUp('read')
        return false
      }

      setReadFailure(
        refusalSentence(response.status, body, 'This booking’s tickets could not be read.'),
      )
    } catch {
      setReadFailure('The service is not responding. Nothing has been read or cancelled.')
    } finally {
      setReading(false)
    }

    return false
  }, [askStepUp, eventId, orderReference])

  // Read on opening; the heading has focus meanwhile. The dialog is drawn
  // afresh for each booking it opens on, so this runs once.
  useEffect(() => {
    read()
  }, [read])

  /**
   * Send the cancellation.
   *
   * @param {object} [submitted] The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(submitted) {
    submitted?.preventDefault()
    setRefusal(null)
    setChangedNote(null)

    const found = cancellationProblems(chosen, reason)

    setProblems(found)

    if (found.length > 0) {
      focusAfterRender(summaryRef)
      return
    }

    setBusy(true)

    try {
      // In the booking's own order, whatever order they were ticked in.
      const ticketIds = booking.tickets
        .map((ticket) => ticket.ticketId)
        .filter((ticketId) => chosen.includes(ticketId))
      const response = await apiFetch(
        `/v1/orders/${encodeURIComponent(orderReference)}/venue-cancellations`,
        { method: 'POST', body: JSON.stringify({ ticketIds, reason: reason.trim() }) },
      )
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        onCancelled(body.data)
        return
      }

      const code = body?.error?.code ?? null

      if (code === 'STEP_UP_REQUIRED') {
        askStepUp('cancel')
        return
      }

      if (code === 'VENUE_BOOKING_CHANGED') {
        // Nothing was cancelled: read the booking as it is now, say why, and
        // start again from its heading. The reason typed is kept.
        await read()
        setChangedNote(refusalSentence(response.status, body, 'This booking changed.'))
        focusAfterRender(headingRef)
        return
      }

      // A change that waited too long behind another is answered 503
      // `SERVICE_UNAVAILABLE` with the API's sentence (the specification calls
      // it `TRY_AGAIN`); the shared rule keeps that sentence for either code.
      // A `TRY_AGAIN` that came without one gets the specification's words.
      const said = typeof body?.error?.message === 'string' ? body.error.message.trim() : ''

      setRefusal(
        code === 'TRY_AGAIN' && !said
          ? TRY_AGAIN_SENTENCE
          : refusalSentence(response.status, body, 'No ticket was cancelled.'),
      )

      focusAfterRender(summaryRef)
    } catch {
      setRefusal(NOT_ANSWERING)
      focusAfterRender(summaryRef)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Tick or untick one ticket.
   *
   * @param {string} ticketId The ticket.
   * @returns {void}
   */
  function toggle(ticketId) {
    setChosen((current) =>
      current.includes(ticketId)
        ? current.filter((one) => one !== ticketId)
        : [...current, ticketId],
    )
  }

  /**
   * "Select all": ticks every cancellable ticket, unless every one is ticked
   * already, when it unticks them. From in between, it ticks all.
   *
   * @returns {void}
   */
  function toggleAll() {
    setChosen(allTicked ? [] : cancellable.map((ticket) => ticket.ticketId))
  }

  const count = chosen.length
  const fees = booking?.feesCents ?? 0
  const subtitle = `Booking ${orderReference}${booking?.buyerName ? ` — ${booking.buyerName}` : ''}`

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      closeOnOverlayClick={false}
      showCloseButton={false}
      initialFocusRef={headingRef}
      aria-labelledby={headingId}
      size="lg"
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <div className="space-y-4 text-ink">
        <div>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-xl font-semibold text-ink focus-visible:outline-none"
          >
            Cancel unpaid tickets
          </h2>
          <p className="mt-1 text-sm break-words text-ink-muted">{subtitle}</p>
        </div>

        <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
          {reading && !stepUpFor ? 'Reading this booking’s tickets…' : ''}
          {busy ? 'Cancelling the tickets…' : ''}
        </p>

        {stepUpFor ? (
          <div ref={promptRef} tabIndex={-1} className="focus-visible:outline-none">
            <StepUpPrompt
              action={stepUpFor === 'read' ? 'see this booking’s tickets' : 'cancel these tickets'}
              onConfirmed={() => {
                const next = stepUpFor

                setStepUpFor(null)
                // The prompt is gone: the heading holds focus until the answer
                // moves it.
                focusAfterRender(headingRef)

                if (next === 'read') read()
                else send()
              }}
              onCancel={() => {
                const declined = stepUpFor

                setStepUpFor(null)

                if (declined === 'read') {
                  setReadDeclined(true)
                  focusAfterRender(declinedRef)
                } else {
                  setRefusal(STEP_UP_DECLINED_SENTENCE)
                  focusAfterRender(summaryRef)
                }
              }}
            />
          </div>
        ) : null}

        {readDeclined && !stepUpFor ? (
          <div ref={declinedRef} tabIndex={-1} className="space-y-3 focus-visible:outline-none">
            <p className="text-sm text-ink">{readStepUpSentence('see this booking’s tickets')}</p>
            <Button type="button" onClick={() => askStepUp('read')}>
              Confirm and continue
            </Button>
          </div>
        ) : null}

        {readFailure ? (
          <Alert variant="error" title="Not read">
            <p>{readFailure}</p>
          </Alert>
        ) : null}

        {changedNote ? (
          <Alert variant="warning" title="This booking has changed">
            <p>{changedNote}</p>
          </Alert>
        ) : null}

        {readAnswered && !reading && !readFailure && !stepUpFor && !booking ? (
          <p className="text-sm text-ink">
            This booking has no tickets waiting to be paid at the door now. Nothing was cancelled.
          </p>
        ) : null}

        {booking && !stepUpFor ? (
          <form onSubmit={send} noValidate className="space-y-4">
            {problems.length > 0 || refusal ? (
              <div
                ref={summaryRef}
                tabIndex={-1}
                className="rounded-card border border-status-danger/25 bg-status-danger-soft p-4 focus-visible:outline-none"
              >
                <h3 className="text-sm font-semibold text-status-danger">
                  {refusal
                    ? 'Nothing was cancelled'
                    : problems.length === 1
                      ? 'One thing to fix before cancelling'
                      : `${problems.length} things to fix before cancelling`}
                </h3>
                {refusal ? (
                  <p className="mt-1 text-sm break-words text-status-danger">{refusal}</p>
                ) : null}
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

            <div className="space-y-2 text-sm text-ink">
              <p>
                These tickets were booked to pay at the door and have not been paid for. Cancelling
                them frees their places, and nobody owes their price any more.
              </p>
              <p>
                {fees > 0
                  ? 'Desi-Event keeps the booking fee paid online for them; nothing is refunded.'
                  : 'Nothing was paid online for them, so nothing is refunded.'}
              </p>
              <p className="font-medium">This can't be undone.</p>
            </div>

            <fieldset
              id={`${id}-tickets`}
              tabIndex={-1}
              aria-describedby={errors.tickets ? `${id}-tickets-error` : undefined}
              className="space-y-2 rounded-card border border-line p-4 focus-visible:outline-none"
            >
              <legend className="px-1 text-sm font-semibold text-ink">Tickets to cancel</legend>

              {cancellable.length > 0 ? (
                <label className="flex min-h-11 items-center gap-3 border-b border-line pb-2 text-sm font-medium text-ink">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allTicked}
                    disabled={busy}
                    onChange={toggleAll}
                    className="size-6 shrink-0 rounded border-line-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  />
                  {`Select all ${cancellable.length} unpaid ${tickets(cancellable.length)}`}
                </label>
              ) : null}

              <ul className="space-y-2">
                {booking.tickets.map((ticket) => {
                  const boxId = `${id}-ticket-${ticket.ticketId}`
                  const hints = [
                    ticket.heldBy === 'SOMEONE_ELSE' ? 'Passed on to someone else' : null,
                    ticket.offerPending
                      ? 'Offered to someone else; the offer will be withdrawn'
                      : null,
                    ticket.cancellable
                      ? null
                      : 'That night is over, so this ticket stays as it is.',
                  ].filter(Boolean)
                  const hintId = hints.length > 0 ? `${boxId}-hint` : undefined

                  return (
                    <li key={ticket.ticketId} className="flex min-h-11 items-start gap-3 py-1">
                      <input
                        id={boxId}
                        type="checkbox"
                        checked={ticket.cancellable && chosen.includes(ticket.ticketId)}
                        disabled={busy || !ticket.cancellable}
                        aria-describedby={hintId}
                        onChange={() => toggle(ticket.ticketId)}
                        className="mt-0.5 size-6 shrink-0 rounded border-line-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      />
                      <div className="min-w-0">
                        <label htmlFor={boxId} className="text-sm break-words text-ink">
                          {ticketWords(ticket, currency)}
                        </label>
                        {hints.length > 0 ? (
                          <p id={hintId} className="text-sm text-ink-muted">
                            {hints.join(' ')}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {errors.tickets ? (
                <p id={`${id}-tickets-error`} className="text-sm font-medium text-status-danger">
                  {errors.tickets}
                </p>
              ) : null}
            </fieldset>

            <FormField
              label="Reason"
              id={`${id}-reason`}
              required
              description={VENUE_CANCEL_REASON_DESCRIPTION}
              {...(errors.reason ? { error: errors.reason } : {})}
            >
              <Textarea
                rows={3}
                maxLength={REASON_LIMITS.max + 50}
                value={reason}
                disabled={busy}
                onChange={(change) => setReason(change.target.value)}
              />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" loading={busy} disabled={count === 0}>
                {`Cancel ${count} unpaid ${tickets(count)}`}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Keep them
              </Button>
            </div>
          </form>
        ) : null}

        {!booking && !stepUpFor ? (
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}
