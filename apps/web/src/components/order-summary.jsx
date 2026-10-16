/**
 * The money of an order, line by line: what each line comes to, the subtotal,
 * any discount, the booking fee, any waiver of it, tax and what is paid.
 *
 * One summary for both checkouts — tickets by quantity and seats by the map —
 * so a figure is laid out the same way wherever a buyer reads it. It shows
 * whatever totals it is given: the browser's own estimate before anything is
 * held, and the server's quote once it is, which is the figure the order is
 * charged.
 *
 * ## Paying at the venue (SPEC3 §12.1)
 *
 * A pay-at-the-venue booking pays the booking fee online and the ticket price
 * at the door, with no tax on the tickets. So instead of one total it ends in
 * two figures: what is paid now (simulated), or "Nothing to pay online" when a
 * referral code removed the whole fee, and what is paid at the door. The tax
 * row keeps the place's tax by name, with what it comes to (nothing, unless the
 * booking fee itself is taxed), and says no tax is added to the tickets.
 *
 * The booking fee is shown before any waiver, and a waiver from a referral
 * code is its own row, so a buyer sees what the code removed.
 *
 * @module components/order-summary
 */

import {
  formatAmount,
  taxLabelForPlace,
  taxNameForPlace,
  taxNameInSentence,
} from '../lib/pricing.js'

/**
 * @typedef {object} SummaryLine
 * @property {string} key A stable key.
 * @property {string} name What the line is.
 * @property {number} quantity How many.
 * @property {number} subtotalCents What it comes to.
 * @property {string|null} [night] Which night it is for, in words.
 */

/**
 * @typedef {object} SummaryTotals
 * @property {string} currency ISO 4217 code.
 * @property {SummaryLine[]} lines The lines.
 * @property {number} subtotalCents Before discount, fees and tax.
 * @property {number} discountCents Taken off by a code.
 * @property {number} feesCents The booking fee charged, after any waiver.
 * @property {number} [feeGrossCents] The booking fee before a referral code; `feesCents` when absent.
 * @property {number} [feeWaivedCents] What a referral code removed of it.
 * @property {number} taxCents Tax.
 * @property {number} totalCents What is paid online.
 * @property {'CARD'|'AT_VENUE'} [paymentMethod] How the ticket price is paid; CARD when absent.
 * @property {number} [venueDueCents] What is paid at the door, for AT_VENUE.
 */

/**
 * The summary list and what is paid.
 *
 * @param {object} props Component props.
 * @param {SummaryTotals} props.totals What to show.
 * @param {{country?: string|null, region?: string|null}} [props.place] Where the event is held, for the tax's name.
 * @param {string|null} [props.promoCode] The code a discount came from, to name it.
 * @param {boolean} [props.salesTaxUncalculated] Whether to say US sales tax is not calculated.
 * @returns {JSX.Element} The summary.
 */
export function OrderSummary({
  totals,
  place = null,
  promoCode = null,
  salesTaxUncalculated = false,
}) {
  const { currency } = totals
  const atVenue = totals.paymentMethod === 'AT_VENUE'
  const feeGross = Number.isInteger(totals.feeGrossCents) ? totals.feeGrossCents : totals.feesCents
  const waived = totals.feeWaivedCents ?? 0

  return (
    <>
      <dl className="mt-5 space-y-3 text-[0.9375rem]">
        {totals.lines.map((line) => (
          <div key={line.key} className="flex justify-between gap-3">
            <dt className="min-w-0 text-ink">
              {line.name} <span className="text-ink-muted">× {line.quantity}</span>
              {line.night ? (
                <span className="block text-xs text-ink-muted">{line.night}</span>
              ) : null}
            </dt>
            <dd className="shrink-0 font-bold text-ink tabular-nums">
              {formatAmount(line.subtotalCents, currency)}
            </dd>
          </div>
        ))}

        <div className="flex justify-between gap-3 border-t border-line pt-3">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="font-bold text-ink tabular-nums" data-testid="summary-subtotal">
            {formatAmount(totals.subtotalCents, currency)}
          </dd>
        </div>
        {totals.discountCents > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">{promoCode ? `Discount (${promoCode})` : 'Discount'}</dt>
            <dd
              className="font-bold text-status-success tabular-nums"
              data-testid="summary-discount"
            >
              −{formatAmount(totals.discountCents, currency)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Booking fee</dt>
          <dd className="font-bold text-ink tabular-nums" data-testid="summary-fee">
            {formatAmount(feeGross, currency)}
          </dd>
        </div>
        {waived > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Booking fee waived (referral code)</dt>
            <dd
              className="font-bold text-status-success tabular-nums"
              data-testid="summary-fee-waived"
            >
              −{formatAmount(waived, currency)}
            </dd>
          </div>
        ) : null}
        {atVenue ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">
              {totals.taxCents > 0
                ? `${taxNameForPlace(place ?? {})} on the booking fee`
                : taxNameForPlace(place ?? {})}
              <span className="block text-xs text-ink-subtle">
                No {taxNameInSentence(place ?? {})} is added to tickets paid at the venue.
              </span>
            </dt>
            <dd className="font-bold text-ink tabular-nums">
              {formatAmount(totals.taxCents, currency)}
            </dd>
          </div>
        ) : (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">
              {taxLabelForPlace(place ?? {})}
              {salesTaxUncalculated ? (
                <span className="block text-xs text-ink-subtle">
                  US sales tax is not calculated in this demo
                </span>
              ) : null}
            </dt>
            <dd className="font-bold text-ink tabular-nums">
              {formatAmount(totals.taxCents, currency)}
            </dd>
          </div>
        )}
      </dl>

      <div aria-hidden="true" className="my-5 h-px bg-line" />

      {atVenue ? (
        <div className="space-y-3">
          {totals.totalCents > 0 ? (
            <div className="flex items-end justify-between gap-3">
              <p className="text-base font-bold text-ink">Pay now (simulated)</p>
              <p
                className="font-display text-2xl leading-none font-bold text-ink tabular-nums"
                data-testid="summary-online"
              >
                {formatAmount(totals.totalCents, currency)}
              </p>
            </div>
          ) : (
            <p className="text-base font-bold text-ink" data-testid="summary-online">
              Nothing to pay online
            </p>
          )}
          <div className="flex items-end justify-between gap-3">
            <p className="flex flex-col">
              <span className="text-base font-bold text-ink">Pay at the door</span>
              <span className="text-micro font-bold tracking-eyebrow text-ink-subtle uppercase">
                {currency}
              </span>
            </p>
            <p
              className="font-display text-4xl leading-none font-bold text-ink tabular-nums"
              data-testid="summary-door"
            >
              {formatAmount(totals.venueDueCents ?? 0, currency)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <p className="flex flex-col">
            <span className="text-base font-bold text-ink">Total</span>
            <span className="text-micro font-bold tracking-eyebrow text-ink-subtle uppercase">
              {currency}
            </span>
          </p>
          <p
            className="font-display text-4xl leading-none font-bold text-ink tabular-nums"
            data-testid="summary-total"
          >
            {formatAmount(totals.totalCents, currency)}
          </p>
        </div>
      )}
    </>
  )
}

/**
 * Totals from the browser's own pricing (`priceSelection`), in the summary's shape.
 *
 * @param {object} priced What `priceSelection` returned.
 * @param {function(string): (string|null)} [nightOf] The night a line's tier is for, in words.
 * @param {'CARD'|'AT_VENUE'} [paymentMethod] What it was priced for.
 * @returns {SummaryTotals} The totals.
 */
export function totalsFromEstimate(priced, nightOf = () => null, paymentMethod = 'CARD') {
  return {
    currency: priced.currency,
    lines: priced.lineItems.map((line) => ({
      key: line.ticketTypeId,
      name: line.name,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      night: nightOf(line.ticketTypeId),
    })),
    subtotalCents: priced.subtotalCents,
    discountCents: priced.discountCents ?? 0,
    feesCents: priced.feesCents,
    feeGrossCents: priced.feeGrossCents ?? priced.feesCents,
    feeWaivedCents: priced.feeWaivedCents ?? 0,
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
    paymentMethod: paymentMethod === 'AT_VENUE' ? 'AT_VENUE' : 'CARD',
    venueDueCents: priced.venueDueCents ?? 0,
  }
}

/**
 * Totals from the server's quote, in the summary's shape.
 *
 * @param {object} quote The quote's `data`.
 * @param {function(string|null): (string|null)} [nightOfSession] A night's label, by session id.
 * @returns {SummaryTotals} The totals.
 */
export function totalsFromQuote(quote, nightOfSession = () => null) {
  return {
    currency: quote.currency,
    lines: quote.lines.map((line, index) => ({
      key: `${line.ticketTypeId}:${line.unitPriceCents}:${index}`,
      name: line.name,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      night: nightOfSession(line.sessionId ?? null),
    })),
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    feesCents: quote.feesCents,
    feeGrossCents: Number.isInteger(quote.feeGrossCents) ? quote.feeGrossCents : quote.feesCents,
    feeWaivedCents: quote.feeWaivedCents ?? 0,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    paymentMethod: quote.paymentMethod === 'AT_VENUE' ? 'AT_VENUE' : 'CARD',
    venueDueCents: quote.venueDueCents ?? 0,
  }
}
