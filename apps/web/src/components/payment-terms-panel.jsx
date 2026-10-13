'use client'

/**
 * An event's booking fee (the platform fee) and whether it can be paid for at
 * the venue, as the Desi-Event team sets them (SPEC3 §12.3, SPEC3-XI §12.3).
 *
 * Three parts: the booking fee and its form, the pay-at-the-venue switch and
 * its limit, and the changes to both, newest first. Every write sends what the
 * administrator read as a precondition (`expectedSequence`, `seen`), so a
 * change somebody else made meanwhile is refused rather than overwritten, and
 * a reason the organiser reads with the administrator's name. The server asks
 * for a second factor (PAYMENT_TERMS); this only reacts to being asked.
 *
 * The page decides who may change anything and hands this booleans and a
 * reason it may not (`readOnly`): an administrator who belongs to the event's
 * organisation, a deleted event, an event sold on its listing's own site. The
 * API decides every write again.
 *
 * @module components/payment-terms-panel
 */

import { computePlatformFee } from '@desi-event/pricing'
import {
  ORGANISER_VISIBLE_REASON_DESCRIPTION,
  REASON_LIMITS,
  reasonSchema,
} from '@desi-event/schemas/payment-terms'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { STEP_UP_DECLINED_SENTENCE, useStepUpRetry } from './step-up-retry.jsx'
import { Alert, Button, FormField, Textarea } from './ui.jsx'
import { TEXT_LINK } from './workspace-kit.jsx'
import { apiFetch } from '../lib/api-fetch.js'
import {
  DELETED_TERMS_SENTENCE,
  FEE_FORM_LIMITS,
  MEMBER_TERMS_SENTENCE,
  SOLD_ON_SOURCE_TERMS_SENTENCE,
  UNPOSTED_TERMS_SENTENCE,
  VENUE_LIMIT_BOUNDS,
  amountBoundsSentence,
  currencySymbol,
  currentFeeSentence,
  historyLines,
  lastFeeChangeSentence,
  parsePercentage,
  parseVenueLimit,
  percentText,
  venueLimitWords,
  venueStatusText,
} from '../lib/event-control.js'
import { parseMoneyInput, toMoneyInput } from '../lib/money.js'
import { formatAmount } from '../lib/pricing.js'
import { parseRetryAfter, refusalSentence } from '../lib/refusal.js'

/** What the panel says about the booking fee before anything else. */
export const FEE_INTRODUCTION =
  'Buyers pay a booking fee (the platform fee) on every ticket. It is Desi-Event’s money, not the organiser’s.'

/** What the panel says about paying at the venue. */
export const VENUE_INTRODUCTION =
  'When it’s on, buyers can choose to pay the ticket price at the door. They still pay the booking fee online, unless a referral code removes it. No sales tax is added to tickets paid at the venue; the organiser may still owe sales tax on those sales.'

/**
 * The limit's hint (SPEC3-XI §12.3): across all buyers, with no limit per
 * account. The last sentence says what the count includes: an unpaid ticket
 * whose night is over still counts, and can no longer be cancelled
 * (`unpaidVenueTickets`, `VENUE_NIGHT_OVER`).
 */
export const VENUE_LIMIT_HINT =
  'Across all buyers. Once this many are booked and unpaid, buyers pay by card. Unpaid tickets for nights that are over still count.'

/** What turning paying at the venue off leaves as it is. */
export const VENUE_OFF_NOTE =
  'Tickets already booked to pay at the venue stay booked. New buyers pay by card.'

/** What saving a booking fee changes, and what it does not. */
export const FEE_NOTE =
  'Orders already placed keep the fee they were charged. The new fee applies to orders placed after you save.'

/**
 * "1 ticket is" or "3 tickets are".
 *
 * @param {number} count How many.
 * @returns {string} The words.
 */
function waitingNow(count) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'ticket is' : 'tickets are'} waiting now.`
}

/**
 * What a reason box holds wrong, in the form's words.
 *
 * @param {string} reason What was typed.
 * @returns {string|null} The problem, or null.
 */
function reasonProblem(reason) {
  const parsed = reasonSchema.safeParse(reason)

  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Give a reason.')
}

/**
 * A reason box for this panel: the organiser reads the reason with the
 * administrator's name.
 *
 * @param {object} props Component props.
 * @param {string} props.id The textarea's id.
 * @param {string} props.value What is typed.
 * @param {Function} props.onChange Given the new text.
 * @param {string|null} props.error What is wrong with it.
 * @param {boolean} props.disabled Whether it takes input.
 * @returns {JSX.Element} The field.
 */
function ReasonField({ id, value, onChange, error, disabled }) {
  const used = value.trim().length

  return (
    <FormField
      label="Reason"
      id={id}
      required
      description={`${ORGANISER_VISIBLE_REASON_DESCRIPTION} ${used.toLocaleString('en-US')} of ${REASON_LIMITS.max.toLocaleString('en-US')} characters.`}
      {...(error ? { error } : {})}
    >
      <Textarea
        rows={3}
        maxLength={REASON_LIMITS.max + 50}
        value={value}
        disabled={disabled}
        onChange={(change) => onChange(change.target.value)}
      />
    </FormField>
  )
}

/**
 * The form's problems, each a link to its field; takes focus on a failed submit.
 *
 * @param {object} props Component props.
 * @param {object} props.summaryRef The container's ref, for focus.
 * @param {Array<{id: string, message: string}>} props.problems The problems.
 * @returns {JSX.Element|null} The summary, or nothing.
 */
function ErrorSummary({ summaryRef, problems }) {
  if (problems.length === 0) return null

  return (
    <div ref={summaryRef} tabIndex={-1} className="focus-visible:outline-none">
      <Alert variant="error" title="Check these and try again">
        <ul className="list-disc space-y-1 pl-5">
          {problems.map((problem) => (
            <li key={problem.id}>
              <a className="underline underline-offset-4" href={`#${problem.id}`}>
                {problem.message}
              </a>
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  )
}

/**
 * A refusal from the API, which takes focus.
 *
 * @param {object} props Component props.
 * @param {object} props.refusalRef The container's ref, for focus.
 * @param {string} props.title The heading.
 * @param {string|null} props.refusal The sentence, or null for none.
 * @param {Function|null} [props.onReload] Offered when the page should be read again.
 * @returns {JSX.Element|null} The refusal, or nothing.
 */
function Refusal({ refusalRef, title, refusal, onReload = null }) {
  if (!refusal) return null

  return (
    <div ref={refusalRef} tabIndex={-1} className="focus-visible:outline-none">
      <Alert variant="error" title={title}>
        <p>{refusal}</p>
        {onReload ? (
          <Button type="button" variant="secondary" className="mt-3" onClick={onReload}>
            Reload
          </Button>
        ) : null}
      </Alert>
    </div>
  )
}

/**
 * @typedef {object} PaymentTermsPanelProps
 * @property {string} eventId The event.
 * @property {object} terms `paymentTerms.get`'s `data`.
 * @property {'member'|'deleted'|'source'|null} [readOnly] Why nothing can be changed here, or null.
 * @property {boolean} [canCancelUnpaid] Whether the session may cancel unpaid pay-at-the-venue tickets.
 * @property {{priceCents: number, currency: string}|null} [example] The event's cheapest paid public ticket.
 * @property {string} [timeZone] The event's zone, for dates.
 * @property {boolean} [showingOlder] Whether the history shown is an older page.
 */

/**
 * The panel.
 *
 * @param {PaymentTermsPanelProps} props Component props.
 * @returns {JSX.Element} The section.
 */
export function PaymentTermsPanel({
  eventId,
  terms: initialTerms,
  readOnly = null,
  canCancelUnpaid = false,
  example = null,
  timeZone = 'UTC',
  showingOlder = false,
}) {
  const router = useRouter()
  const id = useId()
  const focusAfterRender = useFocusAfterRender()
  const [terms, setTerms] = useState(initialTerms)
  const currency = terms.fee.currency
  const venue = terms.venuePayment
  const editable = readOnly === null

  // The booking fee form.
  const [source, setSource] = useState(terms.fee.source)
  const [percent, setPercent] = useState(
    percentText(
      terms.fee.source === 'EVENT' ? terms.fee.percentageBps : terms.siteDefault.percentageBps,
    ),
  )
  const [amount, setAmount] = useState(
    toMoneyInput(
      terms.fee.source === 'EVENT'
        ? terms.fee.flatCentsPerTicket
        : terms.siteDefault.flatCentsPerTicket,
      currency,
    ),
  )
  const [feeReason, setFeeReason] = useState('')
  const [feeErrors, setFeeErrors] = useState({})
  const [feeRefusal, setFeeRefusal] = useState(null)
  const [feeStale, setFeeStale] = useState(false)
  const [feeBusy, setFeeBusy] = useState(false)
  const [feeSaved, setFeeSaved] = useState('')
  const feeSummaryRef = useRef(null)
  const feeRefusalRef = useRef(null)
  const feeSubmitRef = useRef(null)

  // The pay-at-the-venue form.
  const [limit, setLimit] = useState(String(venue.limit ?? VENUE_LIMIT_BOUNDS.suggested))
  const [venueReason, setVenueReason] = useState('')
  const [venueErrors, setVenueErrors] = useState({})
  const [venueRefusal, setVenueRefusal] = useState(null)
  const [venueStale, setVenueStale] = useState(false)
  const [venueBusy, setVenueBusy] = useState(false)
  const [venueSaved, setVenueSaved] = useState('')
  const venueSummaryRef = useRef(null)
  const venueRefusalRef = useRef(null)
  const venueStatusRef = useRef(null)
  const venueActionsRef = useRef(null)

  // The prompt takes focus when it is drawn, and backing out of it puts focus
  // on what was not changed: the button that sent the write stays drawn, but
  // it is disabled while the write waits.
  const feeStepUp = useStepUpRetry({
    action: 'change this event’s booking fee',
    takeFocus: true,
    onDeclined: () => {
      setFeeRefusal(STEP_UP_DECLINED_SENTENCE)
      focusAfterRender(feeRefusalRef)
    },
  })
  const venueStepUp = useStepUpRetry({
    action: 'change paying at the venue for this event',
    takeFocus: true,
    onDeclined: () => {
      setVenueRefusal(STEP_UP_DECLINED_SENTENCE)
      focusAfterRender(venueRefusalRef)
    },
  })

  // The page is read again from the server; it draws this panel afresh from
  // what the server says now.
  const reload = () => router.refresh()

  /**
   * Send one write and take the view it answers with.
   *
   * @param {object} options What to send and how to report it.
   * @param {string} options.path The path under the event.
   * @param {object} options.body The body.
   * @param {object} options.stepUp The step-up hook for this form.
   * @param {Function} options.setBusy Its busy flag.
   * @param {Function} options.setRefusal Its refusal sentence.
   * @param {Function} options.setStale Whether to offer a reload.
   * @param {object} options.refusalRef Where focus goes on a refusal.
   * @param {string} options.fallback What to say when the server gives no sentence.
   * @returns {Promise<object|null>} The new view, or null.
   */
  async function write({
    path,
    body,
    stepUp,
    setBusy,
    setRefusal,
    setStale,
    refusalRef,
    fallback,
  }) {
    setBusy(true)
    setRefusal(null)
    setStale(false)

    try {
      const response = await apiFetch(`/v1/platform/events/${encodeURIComponent(eventId)}${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok && parsed?.data) {
        setTerms(parsed.data)
        return parsed.data
      }

      // Asked for a second factor: ask, and send the same write again.
      const retried = stepUp.refused(parsed, () =>
        write({ path, body, stepUp, setBusy, setRefusal, setStale, refusalRef, fallback }),
      )

      if (retried) return retried

      setRefusal(
        refusalSentence(
          response.status,
          parsed,
          fallback,
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      setStale(parsed?.error?.code === 'PAYMENT_TERMS_CHANGED')
      focusAfterRender(refusalRef)
      return null
    } catch {
      setRefusal(`The service is not responding. ${fallback}`)
      focusAfterRender(refusalRef)
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Save the booking fee.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function saveFee(submitted) {
    submitted.preventDefault()
    setFeeSaved('')

    const errors = {}
    let bps = null
    let cents = null

    if (source === 'EVENT') {
      const parsedPercent = parsePercentage(percent)
      const parsedAmount = parseMoneyInput(amount, currency)

      if ('error' in parsedPercent) errors.percentage = parsedPercent.error
      else bps = parsedPercent.bps

      if ('error' in parsedAmount || parsedAmount.cents > FEE_FORM_LIMITS.maxFlatCents) {
        errors.amount = amountBoundsSentence(currency)
      } else {
        cents = parsedAmount.cents
      }
    }

    const reasonError = reasonProblem(feeReason)

    if (reasonError) errors.reason = reasonError

    setFeeErrors(errors)

    if (Object.keys(errors).length > 0) {
      focusAfterRender(feeSummaryRef)
      return
    }

    const body =
      source === 'EVENT'
        ? {
            source,
            percentageBps: bps,
            flatCentsPerTicket: cents,
            reason: feeReason.trim(),
            expectedSequence: terms.fee.sequence,
          }
        : { source, reason: feeReason.trim(), expectedSequence: terms.fee.sequence }

    const saved = await write({
      path: '/platform-fee',
      body,
      stepUp: feeStepUp,
      setBusy: setFeeBusy,
      setRefusal: setFeeRefusal,
      setStale: setFeeStale,
      refusalRef: feeRefusalRef,
      fallback: 'The booking fee was not changed.',
    })

    if (saved) {
      setFeeReason('')
      setFeeSaved('Booking fee saved. It applies to new orders from now.')
      // Back to the button, which a confirmed second factor took focus from.
      focusAfterRender(feeSubmitRef)
    }
  }

  /**
   * Switch paying at the venue on or off, or change its limit.
   *
   * @param {'on'|'limit'|'off'} action What was pressed.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function saveVenue(action) {
    setVenueSaved('')

    const errors = {}
    let parsedLimit = null

    if (action !== 'off') {
      const parsed = parseVenueLimit(limit)

      if ('error' in parsed) errors.limit = parsed.error
      else parsedLimit = parsed.limit
    }

    const reasonError = reasonProblem(venueReason)

    if (reasonError) errors.reason = reasonError

    setVenueErrors(errors)

    if (Object.keys(errors).length > 0) {
      focusAfterRender(venueSummaryRef)
      return
    }

    const body = {
      enabled: action !== 'off',
      ...(action !== 'off' ? { limit: parsedLimit } : {}),
      seen: { enabled: venue.enabled, limit: venue.limit ?? null },
      reason: venueReason.trim(),
    }

    const saved = await write({
      path: '/venue-payment',
      body,
      stepUp: venueStepUp,
      setBusy: setVenueBusy,
      setRefusal: setVenueRefusal,
      setStale: setVenueStale,
      refusalRef: venueRefusalRef,
      fallback: 'Paying at the venue was not changed.',
    })

    if (saved) {
      const shown = venueLimitWords(Number(saved.venuePayment.limit ?? parsedLimit ?? 0))

      setVenueReason('')
      // Turning on or off swaps the buttons, and a confirmed second factor
      // took focus from them: focus goes to the first one drawn now, or to the
      // switch's state when no button is left (an online event turned off).
      focusAfterRender(
        () => venueActionsRef.current?.querySelector('button') ?? venueStatusRef.current,
      )
      setVenueSaved(
        action === 'off'
          ? `Paying at the venue turned off. ${VENUE_OFF_NOTE}`
          : action === 'on'
            ? `Paying at the venue turned on, ${shown}.`
            : `Limit saved: ${shown}.`,
      )
    }
  }

  // The live example: the cheapest paid public ticket under the terms the form
  // shows, or under the terms in force while the form holds something invalid.
  const exampleFee = (() => {
    if (!example) return null

    let feeConfig = {
      percentageBps: terms.siteDefault.percentageBps,
      flatCents: terms.siteDefault.flatCentsPerTicket,
      currency,
    }

    if (source === 'EVENT') {
      const parsedPercent = parsePercentage(percent)
      const parsedAmount = parseMoneyInput(amount, currency)

      if ('bps' in parsedPercent && 'cents' in parsedAmount) {
        feeConfig = { percentageBps: parsedPercent.bps, flatCents: parsedAmount.cents, currency }
      } else if (terms.fee.source === 'EVENT') {
        feeConfig = {
          percentageBps: terms.fee.percentageBps,
          flatCents: terms.fee.flatCentsPerTicket,
          currency,
        }
      }
    }

    try {
      return computePlatformFee({ subtotalCents: example.priceCents, quantity: 1, feeConfig })
    } catch {
      return null
    }
  })()

  const feeProblems = [
    feeErrors.percentage ? { id: `${id}-percentage`, message: feeErrors.percentage } : null,
    feeErrors.amount ? { id: `${id}-amount`, message: feeErrors.amount } : null,
    feeErrors.reason ? { id: `${id}-fee-reason`, message: feeErrors.reason } : null,
  ].filter(Boolean)
  const venueProblems = [
    venueErrors.limit ? { id: `${id}-limit`, message: venueErrors.limit } : null,
    venueErrors.reason ? { id: `${id}-venue-reason`, message: venueErrors.reason } : null,
  ].filter(Boolean)

  const lastChange = lastFeeChangeSentence(terms.fee, timeZone)
  const lines = historyLines(terms.history, {
    currency,
    timeZone,
    olderUnknown: terms.historyHasMore,
  })
  const oldest = terms.history.at(-1) ?? null
  const eventPath = `/admin/events/${encodeURIComponent(eventId)}`
  const unpaid = venue.unpaidTickets ?? 0
  const symbol = currencySymbol(currency)

  return (
    <section
      id="payment-terms"
      aria-labelledby={`${id}-heading`}
      className="mt-8 max-w-3xl space-y-6 rounded-card border border-line bg-surface-raised p-5"
    >
      <h2 id={`${id}-heading`} className="text-xl font-semibold text-ink">
        Booking fee and payment
      </h2>

      {readOnly === 'deleted' ? <p className="text-sm text-ink">{DELETED_TERMS_SENTENCE}</p> : null}
      {readOnly === 'member' ? <p className="text-sm text-ink">{MEMBER_TERMS_SENTENCE}</p> : null}
      {readOnly === 'source' ? (
        <p className="text-sm text-ink">{SOLD_ON_SOURCE_TERMS_SENTENCE}</p>
      ) : null}
      {editable && !terms.posted ? (
        <p className="text-sm text-ink">{UNPOSTED_TERMS_SENTENCE}</p>
      ) : null}

      {/* 1. The booking fee. */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-ink">Booking fee</h3>
        <p className="text-sm text-ink">{FEE_INTRODUCTION}</p>
        <p className="text-sm font-medium text-ink">
          {currentFeeSentence(terms.fee, terms.siteDefault)}
        </p>
        {lastChange ? <p className="text-sm break-words text-ink-muted">{lastChange}</p> : null}

        <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-ink">
          {feeSaved}
        </p>

        {editable ? (
          <form onSubmit={saveFee} noValidate className="space-y-4">
            <ErrorSummary summaryRef={feeSummaryRef} problems={feeProblems} />
            <Refusal
              refusalRef={feeRefusalRef}
              title="The booking fee was not changed"
              refusal={feeRefusal}
              onReload={feeStale ? reload : null}
            />

            <fieldset className="space-y-2" disabled={feeBusy}>
              <legend className="text-sm font-semibold text-ink">Which booking fee</legend>
              {[
                ['SITE_DEFAULT', 'Use the site default'],
                ['EVENT', 'Set this event’s own fee'],
              ].map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={`${id}-source`}
                    value={value}
                    checked={source === value}
                    onChange={() => setSource(value)}
                    className="size-6 accent-action-primary"
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            {source === 'EVENT' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-percentage`} className="block text-sm font-bold text-ink">
                    Percentage of the ticket price
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id={`${id}-percentage`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={percent}
                      disabled={feeBusy}
                      onChange={(change) => setPercent(change.target.value)}
                      aria-invalid={feeErrors.percentage ? 'true' : undefined}
                      aria-describedby={`${id}-percentage-hint${feeErrors.percentage ? ` ${id}-percentage-error` : ''}`}
                      className="min-h-11 w-28 rounded-control border border-line-strong bg-surface-raised px-3 text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    />
                    <span aria-hidden="true" className="text-ink">
                      %
                    </span>
                  </div>
                  <p id={`${id}-percentage-hint`} className="mt-1 text-xs text-ink-muted">
                    From 0 to 30, with at most two decimal places.
                  </p>
                  {feeErrors.percentage ? (
                    <p
                      id={`${id}-percentage-error`}
                      className="mt-1 text-sm font-medium text-status-danger"
                    >
                      {feeErrors.percentage}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={`${id}-amount`} className="block text-sm font-bold text-ink">
                    Amount per ticket ({currency})
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <span aria-hidden="true" className="text-ink">
                      {symbol}
                    </span>
                    <input
                      id={`${id}-amount`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      disabled={feeBusy}
                      onChange={(change) => setAmount(change.target.value)}
                      aria-invalid={feeErrors.amount ? 'true' : undefined}
                      aria-describedby={`${id}-amount-hint${feeErrors.amount ? ` ${id}-amount-error` : ''}`}
                      className="min-h-11 w-32 rounded-control border border-line-strong bg-surface-raised px-3 text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    />
                  </div>
                  <p id={`${id}-amount-hint`} className="mt-1 text-xs text-ink-muted">
                    Up to {formatAmount(FEE_FORM_LIMITS.maxFlatCents, currency)}.
                  </p>
                  {feeErrors.amount ? (
                    <p
                      id={`${id}-amount-error`}
                      className="mt-1 text-sm font-medium text-status-danger"
                    >
                      {feeErrors.amount}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <p className="text-sm text-ink" data-testid="fee-example">
              {example
                ? exampleFee === null
                  ? ''
                  : `A ${formatAmount(example.priceCents, example.currency)} ticket would carry a booking fee of ${formatAmount(exampleFee, currency)}.`
                : 'This event has no paid tickets, so no booking fee is charged.'}
            </p>

            <ReasonField
              id={`${id}-fee-reason`}
              value={feeReason}
              onChange={setFeeReason}
              error={feeErrors.reason ?? null}
              disabled={feeBusy}
            />

            <p className="text-sm text-ink-muted">{FEE_NOTE}</p>

            <Button ref={feeSubmitRef} type="submit" loading={feeBusy} disabled={feeStepUp.waiting}>
              Save booking fee
            </Button>
          </form>
        ) : null}

        {/* Outside the form: the prompt is a form of its own, and a form
            inside a form would send both when it is confirmed. */}
        {editable ? feeStepUp.prompt : null}
      </div>

      {/* 2. Paying at the venue. */}
      <div className="space-y-3 border-t border-line pt-6">
        <h3 className="text-lg font-semibold text-ink">Pay at the venue</h3>
        <p
          ref={venueStatusRef}
          tabIndex={-1}
          className="text-sm font-medium text-ink focus-visible:outline-none"
          data-testid="venue-status"
        >
          {venueStatusText(venue)}
        </p>
        <p className="text-sm text-ink">{VENUE_INTRODUCTION}</p>
        {venue.enabled ? <p className="text-sm text-ink">{waitingNow(unpaid)}</p> : null}

        {unpaid > 0 && canCancelUnpaid && readOnly !== 'deleted' ? (
          <p className="text-sm">
            <Link href={`${eventPath}/venue-bookings`} className={TEXT_LINK}>
              Bookings waiting to be paid at the door: {unpaid.toLocaleString('en-US')}{' '}
              {unpaid === 1 ? 'ticket' : 'tickets'} — review
            </Link>
          </p>
        ) : null}

        {terms.isOnline && !venue.enabled ? (
          <p className="text-sm text-ink">
            This is an online event, so there is no venue to pay at.
          </p>
        ) : null}
        {terms.isOnline && venue.enabled ? (
          <p className="text-sm text-ink">
            This event is online, so paying at the venue is not offered even though the switch is
            on.
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-ink">
          {venueSaved}
        </p>

        {editable && !(terms.isOnline && !venue.enabled) ? (
          <form
            onSubmit={(submitted) => {
              submitted.preventDefault()
              void saveVenue(venue.enabled ? (terms.isOnline ? 'off' : 'limit') : 'on')
            }}
            noValidate
            className="space-y-4"
          >
            <ErrorSummary summaryRef={venueSummaryRef} problems={venueProblems} />
            <Refusal
              refusalRef={venueRefusalRef}
              title="Paying at the venue was not changed"
              refusal={venueRefusal}
              onReload={venueStale ? reload : null}
            />

            {!terms.isOnline ? (
              <div>
                <label htmlFor={`${id}-limit`} className="block text-sm font-bold text-ink">
                  Most tickets waiting to be paid at the door
                </label>
                <input
                  id={`${id}-limit`}
                  type="number"
                  inputMode="numeric"
                  min={VENUE_LIMIT_BOUNDS.min}
                  max={VENUE_LIMIT_BOUNDS.max}
                  step={1}
                  value={limit}
                  disabled={venueBusy}
                  onChange={(change) => setLimit(change.target.value)}
                  aria-invalid={venueErrors.limit ? 'true' : undefined}
                  aria-describedby={`${id}-limit-hint${venueErrors.limit ? ` ${id}-limit-error` : ''}`}
                  className="mt-1 min-h-11 w-36 rounded-control border border-line-strong bg-surface-raised px-3 text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                />
                <p id={`${id}-limit-hint`} className="mt-1 text-xs text-ink-muted">
                  {VENUE_LIMIT_HINT}
                </p>
                {venueErrors.limit ? (
                  <p
                    id={`${id}-limit-error`}
                    className="mt-1 text-sm font-medium text-status-danger"
                  >
                    {venueErrors.limit}
                  </p>
                ) : null}
              </div>
            ) : null}

            <ReasonField
              id={`${id}-venue-reason`}
              value={venueReason}
              onChange={setVenueReason}
              error={venueErrors.reason ?? null}
              disabled={venueBusy}
            />

            <div ref={venueActionsRef} className="flex flex-wrap items-center gap-2">
              {!venue.enabled ? (
                <Button
                  type="button"
                  loading={venueBusy}
                  disabled={venueStepUp.waiting}
                  onClick={() => void saveVenue('on')}
                >
                  Turn on paying at the venue
                </Button>
              ) : (
                <>
                  {!terms.isOnline ? (
                    <Button
                      type="button"
                      loading={venueBusy}
                      disabled={venueStepUp.waiting}
                      onClick={() => void saveVenue('limit')}
                    >
                      Save limit
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={venueBusy || venueStepUp.waiting}
                    onClick={() => void saveVenue('off')}
                    aria-describedby={`${id}-off-note`}
                  >
                    Turn off paying at the venue
                  </Button>
                </>
              )}
            </div>
            {venue.enabled ? (
              <p id={`${id}-off-note`} className="text-sm text-ink-muted">
                {VENUE_OFF_NOTE}
              </p>
            ) : null}
          </form>
        ) : null}

        {/* Outside the form, for the same reason as the booking fee's. */}
        {editable ? venueStepUp.prompt : null}
      </div>

      {/* 3. The changes, newest first. */}
      <div className="space-y-3 border-t border-line pt-6">
        <h3 className="text-lg font-semibold text-ink">Changes</h3>
        {lines.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {showingOlder
              ? 'There are no older changes.'
              : 'The booking fee and payment settings have never been changed.'}
          </p>
        ) : (
          <ol className="space-y-2">
            {lines.map((line, index) => (
              <li
                key={`${terms.history[index].at}-${index}`}
                className="text-sm break-words text-ink"
              >
                {line}
              </li>
            ))}
          </ol>
        )}
        <p className="flex flex-wrap gap-4 text-sm">
          {terms.historyHasMore && oldest ? (
            <Link
              href={`${eventPath}?${new URLSearchParams({ changesBefore: oldest.at }).toString()}#payment-terms`}
              className={TEXT_LINK}
            >
              Show older changes
            </Link>
          ) : null}
          {showingOlder ? (
            <Link href={`${eventPath}#payment-terms`} className={TEXT_LINK}>
              Show the newest changes
            </Link>
          ) : null}
        </p>
      </div>
    </section>
  )
}
