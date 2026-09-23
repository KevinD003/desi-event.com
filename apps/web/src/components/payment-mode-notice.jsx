/**
 * What the buyer is told before they choose a quantity.
 *
 * Desi-Event has no payment integration. Checkout runs against an in-memory
 * provider that authorises, captures and refunds nothing, which is a perfectly
 * honest way to demonstrate a ticketing flow and a dishonest way to present
 * one. So the notice is rendered on the server, above the basket, on every
 * visit — not behind a toggle, not only after a failure, and not only for
 * developers.
 *
 * There is no payment-method selector anywhere on this page, because there is
 * no second method to select. Nothing a browser can send changes which provider
 * runs; see `packages/providers/src/payment-mode.js`.
 *
 * @module components/payment-mode-notice
 */

// The `./payments` subpath, not the barrel. Two strings from the barrel pull
// `entities.js` in behind them, and with it the *shape* of every private
// column — `Organization.contactEmail`, `Organization.payoutCurrency`. The
// values never reached a browser; the schema describing them did, in every
// bundle, since before this component existed. The browser-bundle scan now
// looks for exactly that, which is how it was found.
//
// Neither string is imported any more. PRODUCTION_PAYMENTS_DISABLED_MESSAGE is
// the deployment's and the operator's wording — "Phase 2 integration required"
// is a project milestone, not something a buyer can act on — and the notice
// used to promise that every order, receipt and ticket is "marked DEMO", when
// the pages a buyer then sees say "simulated" and never DEMO. The buyer is told
// what is true in the words the rest of the site uses.

import { ShieldIcon } from './icons.jsx'

/**
 * The demonstration-payments notice.
 *
 * A marigold bar and a shield beside the words, on the warning's soft ground:
 * noticeable before the quantities, without dressing a standing fact up as an
 * alarm. The text is ink, measured on that ground; the colour carries nothing
 * the words do not.
 *
 * @returns {JSX.Element} The rendered notice.
 */
export function PaymentModeNotice() {
  return (
    <aside
      data-testid="payment-mode-notice"
      aria-labelledby="payment-mode-heading"
      className="flex items-start gap-4 rounded-card border-l-4 border-highlight bg-status-warning-soft px-5 py-4 text-ink sm:px-6 sm:py-5"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-highlight text-highlight-ink"
      >
        <ShieldIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p id="payment-mode-heading" className="text-[1.0625rem] font-bold text-ink">
          Payments on this site are simulated
        </p>
        <p className="mt-1 max-w-3xl text-[0.9375rem] leading-6 text-ink">
          Checkout uses a simulated payment provider. You will not be asked for a card, no money
          moves, and your order and tickets say the payment was simulated. A ticket issued here is a
          demonstration, not a ticket to a real event.
        </p>
      </div>
    </aside>
  )
}
