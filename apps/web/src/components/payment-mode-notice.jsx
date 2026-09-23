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

/**
 * The demonstration-payments notice.
 *
 * @returns {JSX.Element} The rendered notice.
 */
export function PaymentModeNotice() {
  return (
    <aside
      data-testid="payment-mode-notice"
      aria-labelledby="payment-mode-heading"
      className="mt-6 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-status-warning"
    >
      <p id="payment-mode-heading" className="font-semibold">
        Payments on this site are simulated
      </p>
      <p className="mt-2 text-sm">
        Checkout uses a simulated payment provider. You will not be asked for a card, no money
        moves, and your order and tickets say the payment was simulated. A ticket issued here is a
        demonstration, not a ticket to a real event.
      </p>
    </aside>
  )
}
