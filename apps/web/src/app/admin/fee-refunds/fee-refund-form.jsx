'use client'

/**
 * Refunding one order's booking fee by hand (SPEC3 §12.6, SPEC3-XI §12.6).
 *
 * Two steps. First the order is found by its reference: the reference goes in
 * the path of a GET, as it does for `orders.get` — an order reference is not a
 * credential. The answer is the order's booking-fee figures: the event, how it
 * was paid, the fee charged, what a referral code waived, what was already
 * refunded, what was kept when unpaid tickets were cancelled (never
 * refundable), and what can be refunded now: the fee left and the tax on it,
 * together (`refundableCents`). Then, with a reason, the refund: a second
 * factor (FINANCE_ACTION) when the server asks, and the amount shown sent as a
 * precondition, so a change in between is refused (`PRICE_CHANGED`) rather
 * than refunded; the figures are then read again, so the card and the button
 * show what is left now.
 *
 * The refund's answer is a 200 whatever the payment provider said, so what it
 * says follows the refund's `status` (`refundOutcome`): the success sentence
 * for a refund that settled, and only for one; a refund refused or failed says
 * nothing was refunded; one the provider has not answered for says so, and
 * links to the refund for an account that can open it.
 *
 * In this build payments are simulated: nothing here moves money, and the
 * button and every outcome say so.
 *
 * @module app/admin/fee-refunds/fee-refund-form
 */

import { reasonSchema } from '@desi-event/schemas/payment-terms'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { ControlReasonField } from '../../../components/control-reason-field.jsx'
import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { STEP_UP_DECLINED_SENTENCE, useStepUpRetry } from '../../../components/step-up-retry.jsx'
import { Alert, Button } from '../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { formatAmount } from '../../../lib/pricing.js'
import { parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'
import { orderStatusMeaning } from '../../account/orders/order-status.js'
import {
  DISPUTED_NOTE,
  MALFORMED_REFERENCE,
  NO_SUCH_ORDER,
  PAYMENT_METHOD_WORDS,
  keptSentence,
  readReference,
  refundButtonLabel,
  refundOutcome,
  refundableCents,
} from './fee-refund-vocabulary.js'

/**
 * One row of the result card.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children Its value.
 * @returns {JSX.Element} The row.
 */
function Fact({ term, children }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="font-medium text-ink tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * The form.
 *
 * @param {object} props Component props.
 * @param {boolean} [props.canReadRefunds] Whether this account can open a refund's own page
 *   (decided by the server page), so a refund that did not settle links to it.
 * @returns {JSX.Element} Finding the order, its figures and the refund.
 */
export function FeeRefundForm({ canReadRefunds = false }) {
  const id = useId()
  const focusAfterRender = useFocusAfterRender()
  const [typed, setTyped] = useState('')
  const [referenceError, setReferenceError] = useState(null)
  const [finding, setFinding] = useState(false)
  const [findRefusal, setFindRefusal] = useState(null)
  const [preview, setPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const referenceRef = useRef(null)
  const resultRef = useRef(null)
  const reasonRef = useRef(null)
  const refusalRef = useRef(null)
  const doneRef = useRef(null)
  const stepUp = useStepUpRetry({
    action: 'refund this booking fee',
    takeFocus: true,
    onDeclined: () => {
      setRefusal(STEP_UP_DECLINED_SENTENCE)
      focusAfterRender(refusalRef)
    },
  })

  /**
   * Find the order.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the figures, or the refusal, are shown.
   */
  async function find(submitted) {
    submitted.preventDefault()

    const reference = readReference(typed)

    setFindRefusal(null)
    setRefusal(null)
    setOutcome(null)

    if (!reference) {
      setReferenceError(MALFORMED_REFERENCE)
      setPreview(null)
      focusAfterRender(referenceRef)
      return
    }

    setReferenceError(null)
    setFinding(true)

    try {
      const response = await apiFetch(`/v1/platform/orders/${encodeURIComponent(reference)}/fee`)
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) {
        setPreview(body.data)
        setReason('')
        setReasonError(null)
        focusAfterRender(resultRef)
        return
      }

      setPreview(null)

      if (response.status === 404) {
        setReferenceError(NO_SUCH_ORDER)
        focusAfterRender(referenceRef)
        return
      }

      setFindRefusal(
        refusalSentence(
          response.status,
          body,
          'The order could not be found.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(refusalRef)
    } catch {
      setPreview(null)
      setFindRefusal('The service is not responding. The order could not be found.')
      focusAfterRender(refusalRef)
    } finally {
      setFinding(false)
    }
  }

  /**
   * Read the order's figures again, quietly, after a refusal that says they
   * changed: the card and the button then show what is left now. A failure
   * leaves the figures as they were; the refusal already said what to do.
   *
   * @param {string} reference The order.
   * @returns {Promise<void>} Resolves once read, or not.
   */
  async function reread(reference) {
    try {
      const response = await apiFetch(`/v1/platform/orders/${encodeURIComponent(reference)}/fee`)
      const body = await response.json().catch(() => null)

      if (response.ok && body?.data) setPreview(body.data)
    } catch {
      // The figures stay as they were.
    }
  }

  /**
   * Send the refund.
   *
   * @param {object} body The body.
   * @returns {Promise<object|null>} The API's answer, or null.
   */
  async function send(body) {
    setBusy(true)
    setRefusal(null)

    try {
      const response = await apiFetch(
        `/v1/platform/orders/${encodeURIComponent(preview.reference)}/fee-refund`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      const parsed = await response.json().catch(() => null)

      if (response.ok && parsed?.data) return parsed.data

      const retried = stepUp.refused(parsed, () => send(body))

      if (retried) return retried

      setRefusal(
        refusalSentence(
          response.status,
          parsed,
          'The booking fee was not refunded.',
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(refusalRef)

      if (parsed?.error?.code === 'PRICE_CHANGED') await reread(preview.reference)

      return null
    } catch {
      setRefusal('The service is not responding. The booking fee was not refunded.')
      focusAfterRender(refusalRef)
      return null
    } finally {
      setBusy(false)
    }
  }

  /**
   * Check the reason and refund.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function refund(submitted) {
    submitted.preventDefault()
    setOutcome(null)

    const parsed = reasonSchema.safeParse(reason)

    if (!parsed.success) {
      setReasonError(parsed.error.issues[0]?.message ?? 'Give a reason of at least 10 characters.')
      focusAfterRender(reasonRef)
      return
    }

    setReasonError(null)

    const asked = refundableCents(preview)
    const answered = await send({ reason: parsed.data, expectedRefundableCents: asked })

    if (!answered) return

    const said = refundOutcome(answered.refund, asked, preview.currency)

    setPreview(answered.fee ?? preview)
    // The reason is kept for a refund that did not go through, to send again.
    if (said.tone !== 'error') setReason('')
    setOutcome({ ...said, refundId: answered.refund?.id ?? null })
    focusAfterRender(doneRef)
  }

  const kept = preview ? keptSentence(preview) : null
  const refundable = preview && refundableCents(preview) > 0 && !preview.disputed
  const status = preview ? orderStatusMeaning(preview.status) : null

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={find} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-reference`} className="text-sm font-medium text-ink">
            Order reference
          </label>
          <input
            ref={referenceRef}
            id={`${id}-reference`}
            type="text"
            value={typed}
            onChange={(changed) => setTyped(changed.target.value)}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={referenceError ? 'true' : undefined}
            aria-describedby={referenceError ? `${id}-reference-error` : undefined}
            className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 font-mono text-sm text-ink uppercase focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
        </div>
        <Button type="submit" variant="secondary" loading={finding} disabled={finding}>
          Find order
        </Button>
        {referenceError ? (
          <p id={`${id}-reference-error`} className="w-full text-sm font-medium text-status-danger">
            {referenceError}
          </p>
        ) : null}
      </form>

      {findRefusal || refusal ? (
        <div ref={refusalRef} tabIndex={-1} className="focus-visible:outline-none">
          <Alert
            variant="error"
            title={findRefusal ? 'The order was not found' : 'The booking fee was not refunded'}
          >
            <p>{findRefusal ?? refusal}</p>
          </Alert>
        </div>
      ) : null}

      {preview ? (
        <section aria-labelledby={`${id}-result`} className={`p-4 sm:p-6 ${PANEL}`}>
          <h2
            id={`${id}-result`}
            ref={resultRef}
            tabIndex={-1}
            className="text-lg font-semibold text-ink focus-visible:outline-none"
          >
            Order <span className="font-mono">{preview.reference}</span>
          </h2>
          <p className="mt-1 text-sm text-ink">
            <Link
              href={`/admin/events/${encodeURIComponent(preview.eventId)}`}
              className={TEXT_LINK}
            >
              {preview.eventTitle}
            </Link>
          </p>
          <dl className="mt-4 max-w-xl space-y-2">
            <Fact term="Payment">
              {PAYMENT_METHOD_WORDS[preview.paymentMethod] ?? preview.paymentMethod}
            </Fact>
            <Fact term="Order status">{status.label}</Fact>
            <Fact term="Booking fee charged">
              {formatAmount(preview.feesCents, preview.currency)}
            </Fact>
            <Fact term="Waived with a referral code">
              {formatAmount(preview.feeWaivedCents, preview.currency)}
            </Fact>
            <Fact term="Already refunded">
              {formatAmount(preview.feeRefundedCents, preview.currency)}
            </Fact>
            {preview.taxOnFeeCents > 0 ? (
              <Fact term="Tax on the booking fee">
                {formatAmount(preview.taxOnFeeCents, preview.currency)}
              </Fact>
            ) : null}
          </dl>
          <p className="mt-4 text-base font-semibold text-ink" data-testid="fee-refundable">
            Can be refunded: {formatAmount(refundableCents(preview), preview.currency)}
          </p>
          {kept ? <p className="mt-2 text-sm text-ink">{kept}</p> : null}
          {preview.disputed ? (
            <p className="mt-2 text-sm font-medium text-ink">{DISPUTED_NOTE}</p>
          ) : null}

          {refundable ? (
            <div className="mt-6 max-w-2xl space-y-4">
              <form onSubmit={refund} noValidate className="space-y-4">
                <ControlReasonField
                  id={`${id}-reason`}
                  label="Reason"
                  value={reason}
                  onChange={setReason}
                  error={reasonError}
                  disabled={busy}
                  inputRef={reasonRef}
                />
                <Button type="submit" loading={busy} disabled={busy || stepUp.waiting}>
                  {refundButtonLabel(preview)}
                </Button>
              </form>
              {/* Outside the form: the prompt is a form of its own, and a form
                  inside a form would send the refund again when it is
                  confirmed. */}
              {stepUp.prompt}
            </div>
          ) : null}

          {/* Not a live region: the refund form it replaces held focus, so
              focus moves here and the sentence is read once, on arrival. */}
          {outcome?.tone === 'success' ? (
            <p
              ref={doneRef}
              tabIndex={-1}
              className="mt-4 text-sm font-semibold text-status-success focus-visible:outline-none"
            >
              {outcome.sentence}
            </p>
          ) : null}
          {/* A refund that did not settle: focus moves to what became of it. */}
          {outcome && outcome.tone !== 'success' ? (
            <div ref={doneRef} tabIndex={-1} className="mt-4 focus-visible:outline-none">
              <Alert variant={outcome.tone} title={outcome.title}>
                <p>{outcome.sentence}</p>
                {canReadRefunds && outcome.refundId ? (
                  <p className="mt-2">
                    <Link
                      href={`/finance/refunds/${encodeURIComponent(outcome.refundId)}`}
                      className={TEXT_LINK}
                    >
                      See this refund
                    </Link>
                  </p>
                ) : null}
              </Alert>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
