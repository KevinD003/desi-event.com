/**
 * The money of an order, line by line: what each line comes to, the subtotal,
 * any discount, the booking fee, tax and the total.
 *
 * One summary for both checkouts — tickets by quantity and seats by the map —
 * so a figure is laid out the same way wherever a buyer reads it. It shows
 * whatever totals it is given: the browser's own estimate before anything is
 * held, and the server's quote once it is, which is the figure the order is
 * charged.
 *
 * @module components/order-summary
 */

import { formatAmount, taxLabelForPlace } from '../lib/pricing.js'
import { MirrorDivider } from './festive-decor.jsx'

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
 * @property {number} feesCents The booking fee.
 * @property {number} taxCents Tax.
 * @property {number} totalCents What the order comes to.
 */

/**
 * The summary list and the total.
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
          <dd className="font-bold text-ink tabular-nums">
            {formatAmount(totals.feesCents, currency)}
          </dd>
        </div>
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
      </dl>

      <MirrorDivider className="my-5" />

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
    </>
  )
}

/**
 * Totals from the browser's own pricing (`priceSelection`), in the summary's shape.
 *
 * @param {object} priced What `priceSelection` returned.
 * @param {function(string): (string|null)} [nightOf] The night a line's tier is for, in words.
 * @returns {SummaryTotals} The totals.
 */
export function totalsFromEstimate(priced, nightOf = () => null) {
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
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
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
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
  }
}
