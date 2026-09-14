'use client'

/**
 * Ticket selection and the running order summary.
 *
 * Every amount shown here is computed with `computeOrderTotals` from
 * `@desi-event/pricing` — the same function the API uses — so the number in
 * the summary is the number the server will arrive at, down to the paisa. The
 * server still recomputes it from the ticket type rows at order time; a price
 * the browser sends is never trusted, and this component never sends one.
 *
 * Reserving is a genuine call to `POST /v1/holds`. When the ticketing service
 * cannot be reached the basket says exactly that instead of pretending seats
 * were held.
 *
 * @module components/checkout-basket
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader } from './ui.jsx'

import { getApiClient } from '../lib/api.js'
import { formatAmount, formatPrice, priceSelection, taxLabelForCurrency } from '../lib/pricing.js'
import { QuantityStepper, clampQuantity } from './quantity-stepper.jsx'

/** Nothing selected, service not yet contacted. */
const IDLE = 'idle'

/**
 * The largest quantity a tier will sell in one order right now: the organiser's
 * per-order cap, or what is actually left, whichever is smaller.
 *
 * @param {object} tier A ticket type with availability folded in.
 * @returns {number} A non-negative maximum.
 */
export function maxSelectable(tier) {
  if (tier.isSoldOut) return 0

  return Math.max(0, Math.min(tier.maxPerOrder ?? 10, tier.availableQuantity ?? 0))
}

/**
 * Place a hold on every selected tier through the contract client.
 *
 * @param {Array<{ticketTypeId: string, quantity: number}>} lines Selected lines.
 * @returns {Promise<object[]>} One hold record per line.
 * @throws {ApiClientError} When the ticketing service refuses or cannot be reached.
 */
async function reserveThroughApi(lines) {
  const client = getApiClient()

  const holds = await Promise.all(
    lines.map((line) =>
      client.holds.create({ ticketTypeId: line.ticketTypeId, quantity: line.quantity }),
    ),
  )

  return holds.map((hold) => hold?.data).filter(Boolean)
}

/**
 * @typedef {object} CheckoutBasketProps
 * @property {object} event The event being bought into.
 * @property {object[]} ticketTypes Ticket tiers with availability folded in.
 * @property {Function} [reserve] Override for the hold call; supplied by tests.
 */

/**
 * Quantity selection plus a live order summary.
 *
 * @param {CheckoutBasketProps} props Component props.
 * @returns {JSX.Element} The rendered basket.
 */
export function CheckoutBasket({ event, ticketTypes, reserve = reserveThroughApi }) {
  const [quantities, setQuantities] = useState({})
  const [status, setStatus] = useState(IDLE)

  const currency = ticketTypes[0]?.currency ?? 'INR'

  const lines = useMemo(
    () =>
      ticketTypes
        .map((tier) => ({
          ticketTypeId: tier.id,
          name: tier.name,
          quantity: quantities[tier.id] ?? 0,
          unitPriceCents: tier.priceCents,
        }))
        .filter((line) => line.quantity > 0),
    [ticketTypes, quantities],
  )

  const totals = useMemo(() => priceSelection({ lines, currency }), [lines, currency])
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0)

  /**
   * Record a new quantity for one tier.
   *
   * @param {object} tier The tier being changed.
   * @param {number} quantity The requested quantity.
   * @returns {void}
   */
  function setQuantity(tier, quantity) {
    const next = clampQuantity(quantity, tier.minPerOrder ?? 1, maxSelectable(tier))

    setStatus(IDLE)
    setQuantities((current) => ({ ...current, [tier.id]: next }))
  }

  /**
   * Try to hold the selected tickets.
   *
   * @returns {Promise<void>} Resolves once the attempt has finished either way.
   */
  async function handleReserve() {
    setStatus('reserving')

    try {
      await reserve(lines)
      setStatus('held')
    } catch (error) {
      console.warn('[desi-event/web] could not reserve tickets:', error?.message ?? error)
      setStatus('unavailable')
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <section aria-labelledby="choose-tickets" className="min-w-0">
        <h2 id="choose-tickets" className="font-display text-xl font-semibold text-indigo-night-900">
          Choose your tickets
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Seats are held for ten minutes once you reserve them, which is plenty of time to argue
          about who is paying.
        </p>

        <ul className="mt-4 divide-y divide-slate-200 rounded-card border border-slate-200 bg-white">
          {ticketTypes.map((tier) => {
            const max = maxSelectable(tier)
            const availabilityId = `availability-${tier.id}`

            return (
              <li key={tier.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-indigo-night-900">{tier.name}</p>
                  {tier.description ? (
                    <p className="mt-1 text-sm text-slate-600">{tier.description}</p>
                  ) : null}
                  <p id={availabilityId} className="mt-1 text-sm text-slate-500">
                    {tier.isSoldOut
                      ? 'Sold out'
                      : `${formatPrice(tier.priceCents, tier.currency)} each · up to ${max} per order`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {tier.isSoldOut ? (
                    <Badge variant="danger" srLabel="Availability:">
                      Sold out
                    </Badge>
                  ) : (
                    <QuantityStepper
                      label={tier.name}
                      value={quantities[tier.id] ?? 0}
                      min={tier.minPerOrder ?? 1}
                      max={max}
                      describedBy={availabilityId}
                      onChange={(quantity) => setQuantity(tier, quantity)}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <Card as="section" aria-labelledby="order-summary" className="lg:sticky lg:top-24">
        <CardHeader>
          <h2 id="order-summary" className="font-display text-lg font-semibold text-indigo-night-900">
            Order summary
          </h2>
          <p className="text-sm text-slate-500">
            {ticketCount === 0
              ? 'No tickets selected yet'
              : `${ticketCount} ${ticketCount === 1 ? 'ticket' : 'tickets'} for ${event.title}`}
          </p>
        </CardHeader>

        <CardBody>
          <dl className="space-y-2 text-sm">
            {totals.lineItems.map((line) => (
              <div key={line.ticketTypeId} className="flex justify-between gap-3">
                <dt className="min-w-0 text-slate-700">
                  {line.name} <span className="text-slate-500">× {line.quantity}</span>
                </dt>
                <dd className="shrink-0 tabular-nums text-slate-900">
                  {formatAmount(line.subtotalCents, totals.currency)}
                </dd>
              </div>
            ))}

            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
              <dt className="text-slate-700">Subtotal</dt>
              <dd className="tabular-nums text-slate-900" data-testid="summary-subtotal">
                {formatAmount(totals.subtotalCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-700">Booking fee</dt>
              <dd className="tabular-nums text-slate-900">
                {formatAmount(totals.feesCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-700">{taxLabelForCurrency(totals.currency)}</dt>
              <dd className="tabular-nums text-slate-900">
                {formatAmount(totals.taxCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-semibold">
              <dt className="text-indigo-night-900">Total</dt>
              <dd className="tabular-nums text-indigo-night-900" data-testid="summary-total">
                {formatAmount(totals.totalCents, totals.currency)}
              </dd>
            </div>
          </dl>

          {status === 'held' ? (
            <Alert variant="success" title="Tickets held" className="mt-4">
              Your seats are reserved for the next ten minutes. Complete payment to confirm them.
            </Alert>
          ) : null}

          {status === 'unavailable' ? (
            <Alert variant="warning" title="We could not reach the ticketing service" className="mt-4">
              Nothing has been reserved and you have not been charged. Please try again in a moment.
            </Alert>
          ) : null}
        </CardBody>

        <CardFooter className="flex-col items-stretch gap-3">
          <Button
            fullWidth
            size="lg"
            disabled={ticketCount === 0}
            loading={status === 'reserving'}
            onClick={handleReserve}
          >
            {ticketCount === 0 ? 'Select tickets to continue' : 'Reserve tickets'}
          </Button>
          <p className="text-xs text-slate-500">
            Totals are confirmed by our ticketing service before any payment is taken.{' '}
            <Link
              href={`/events/${event.slug}`}
              className="rounded-sm underline underline-offset-2 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
            >
              Back to {event.title}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
