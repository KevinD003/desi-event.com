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

import { DEMO_LABEL, PRODUCTION_PAYMENTS_DISABLED_MESSAGE } from '@desi-event/schemas'

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
      className="mt-6 rounded-card border border-amber-300 bg-amber-50 p-4 text-amber-900"
    >
      <p id="payment-mode-heading" className="font-semibold">
        {PRODUCTION_PAYMENTS_DISABLED_MESSAGE}
      </p>
      <p className="mt-2 text-sm">
        Checkout runs against an in-memory demonstration provider. You will not be asked for a card,
        no money moves, and every order, receipt and ticket this produces is marked {DEMO_LABEL}. A
        ticket issued here admits nobody.
      </p>
    </aside>
  )
}
