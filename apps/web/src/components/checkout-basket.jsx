'use client'

/**
 * Ticket selection, the running order summary, and the purchase itself.
 *
 * Every amount shown here is computed with `computeOrderTotals` from
 * `@desi-event/pricing`, with the fee terms the API published for this event —
 * the same function and the same terms the API charges with — so the number in
 * the summary is the number the order will come to. The server still
 * recomputes it from the ticket type rows; a price the browser sends is never
 * trusted, and this component never sends one.
 *
 * ## Why buying needs an account
 *
 * A ticket lives in the buyer's account: this build delivers no email, so a
 * guest purchase would issue tickets nobody could ever see, and there is no
 * route that lets a guest claim them later. So a signed-out visitor can choose
 * and see the price, and is asked to sign in before anything is held; sign-in
 * brings them back here.
 *
 * ## The steps, and what each one does
 *
 * 1. **Reserve.** `POST /v1/holds` for each chosen tier, through the same-origin
 *    proxy so the holds belong to this account. One refused hold releases the
 *    ones already taken. Changing the selection afterwards releases them too.
 * 2. **Pay, simulated.** `POST /v1/orders` with the holds and an
 *    `Idempotency-Key` minted for this attempt and kept only in memory, so a
 *    retry after a lost answer cannot book twice. `PAYMENT_MODE` is `MOCK`:
 *    the order is captured by the in-memory provider, no card is asked for and
 *    no money moves, and every screen that follows says so.
 * 3. **Booked.** The reference, the total, and where the tickets are.
 *
 * Seated tiers are shown and not sold: they are bought by seat, and this site
 * has no seat picker.
 *
 * @module components/checkout-basket
 */

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'

import { apiFetch } from '../lib/api-fetch.js'
import { formatEventStart } from '../lib/format.js'
import { formatAmount, formatPrice, priceSelection, taxLabelForPlace } from '../lib/pricing.js'
import { describeApiRefusal, refusalFromResponse } from '../lib/refusal.js'
import { MirrorDivider } from './festive-decor.jsx'
import { CheckIcon } from './icons.jsx'
import { OUTLINE_LINK, PRIMARY_LINK } from './link-classes.js'
import { EventPoster } from './poster.jsx'
import { QuantityStepper, clampQuantity } from './quantity-stepper.jsx'
import { tierAllIn } from './ticket-tiers.jsx'
import { Alert, Badge, Button } from './ui.jsx'

/** Nothing selected, service not yet contacted. */
const IDLE = 'idle'

/** Classes for a quiet in-text link. */
const QUIET_LINK =
  'rounded-sm font-bold text-accent-strong underline underline-offset-2 hover:decoration-2'

/**
 * The largest quantity a tier will sell in one order right now: the organiser's
 * per-order cap, or what is actually left, whichever is smaller.
 *
 * @param {object} tier A ticket type with availability folded in.
 * @returns {number} A non-negative maximum.
 */
export function maxSelectable(tier) {
  if (tier.isSoldOut || tier.reserved) return 0

  return Math.max(0, Math.min(tier.maxPerOrder ?? 10, tier.availableQuantity ?? 0))
}

/**
 * An error carrying a refusal, in the shape `describeApiRefusal` reads.
 *
 * @param {Response} response A response that was not ok.
 * @returns {Promise<Error>} The error.
 */
async function refusalError(response) {
  const refusal = await refusalFromResponse(response)

  return Object.assign(new Error(refusal.message ?? `The API answered ${refusal.status}.`), refusal)
}

/**
 * Release holds, quietly. A hold left behind lapses on its own when its time runs out;
 * releasing it early only gives the tickets back sooner.
 *
 * @param {string[]} holdIds The holds.
 * @returns {Promise<void>} Resolves when every attempt has finished.
 */
export async function releaseThroughApi(holdIds) {
  await Promise.all(
    holdIds.map((id) =>
      apiFetch(`/v1/holds/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null),
    ),
  )
}

/**
 * Hold every selected tier for this account.
 *
 * One at a time, so a refusal part-way releases what was already held rather
 * than leaving half a basket reserved.
 *
 * @param {Array<{ticketTypeId: string, quantity: number}>} lines Selected lines.
 * @returns {Promise<object[]>} One hold record per line.
 * @throws {Error} A refusal or a network failure.
 */
export async function reserveThroughApi(lines) {
  const holds = []

  for (const line of lines) {
    let response

    try {
      response = await apiFetch('/v1/holds', {
        method: 'POST',
        body: JSON.stringify({ ticketTypeId: line.ticketTypeId, quantity: line.quantity }),
      })
    } catch (error) {
      await releaseThroughApi(holds.map((hold) => hold.id))
      throw error
    }

    if (!response.ok) {
      const error = await refusalError(response)

      await releaseThroughApi(holds.map((hold) => hold.id))
      throw error
    }

    holds.push((await response.json()).data)
  }

  return holds
}

/**
 * Place the order against the holds, with the simulated payment.
 *
 * @param {object} request What to buy.
 * @param {string} request.eventId The event.
 * @param {{name: string, email: string}} request.buyer The signed-in buyer.
 * @param {Array<{ticketTypeId: string, quantity: number}>} request.lines Selected lines.
 * @param {string[]} request.holdIds The holds being spent.
 * @param {string} request.idempotencyKey This attempt's key.
 * @returns {Promise<object>} The order.
 * @throws {Error} A refusal or a network failure.
 */
export async function placeOrderThroughApi({ eventId, buyer, lines, holdIds, idempotencyKey }) {
  const response = await apiFetch('/v1/orders', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      eventId,
      buyerEmail: buyer.email,
      buyerName: buyer.name,
      items: lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
      holdIds,
    }),
  })

  if (!response.ok) throw await refusalError(response)

  return (await response.json()).data
}

/**
 * A fresh idempotency key for one purchase attempt. Held in memory only.
 *
 * @returns {string} The key.
 */
function newAttemptKey() {
  return globalThis.crypto.randomUUID()
}

/**
 * When the earliest hold lapses, on the buyer's own clock.
 *
 * @param {object[]} holds The holds.
 * @returns {string|null} A time, or null when none says.
 */
function heldUntil(holds) {
  const times = holds
    .map((hold) => Date.parse(hold?.expiresAt))
    .filter((time) => Number.isFinite(time))

  if (times.length === 0) return null

  return new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(
    new Date(Math.min(...times)),
  )
}

/**
 * @typedef {object} CheckoutBasketProps
 * @property {object} event The event being bought into, with `feeTerms` when the API sent them.
 * @property {object[]} ticketTypes Ticket tiers with availability folded in.
 * @property {{name: string, email: string}|null} [buyer] The signed-in buyer, or null.
 * @property {string} [signInHref] Where a signed-out visitor signs in, returning here.
 * @property {Function} [reserve] Override for the hold calls; supplied by tests.
 * @property {Function} [release] Override for releasing holds; supplied by tests.
 * @property {Function} [placeOrder] Override for the order call; supplied by tests.
 */

/**
 * Quantity selection, the order summary, and the purchase.
 *
 * @param {CheckoutBasketProps} props Component props.
 * @returns {JSX.Element} The rendered basket.
 */
export function CheckoutBasket({
  event,
  ticketTypes,
  buyer = null,
  signInHref = '/sign-in',
  reserve = reserveThroughApi,
  release = releaseThroughApi,
  placeOrder = placeOrderThroughApi,
}) {
  const [quantities, setQuantities] = useState({})
  const [status, setStatus] = useState(IDLE)
  const [holds, setHolds] = useState([])
  const [order, setOrder] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const attemptKey = useRef(null)

  const currency = ticketTypes[0]?.currency ?? 'USD'

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

  // Where the event is held decides the tax, so the basket quotes the same
  // jurisdiction the server will charge against rather than guessing from the
  // currency.
  const place = useMemo(
    () => ({ country: event?.venue?.country ?? null, region: event?.venue?.region ?? null }),
    [event?.venue?.country, event?.venue?.region],
  )
  // The fee terms the API published for this event, so the total here is the
  // total the order will come to rather than one priced with the defaults.
  const feeTerms = event?.feeTerms ?? null
  const totals = useMemo(
    () => priceSelection({ lines, currency, place, feeTerms }),
    [lines, currency, place, feeTerms],
  )
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0)
  const busy = status === 'reserving' || status === 'paying'

  /**
   * Record a new quantity for one tier, releasing anything already held: the
   * holds were for the old selection.
   *
   * @param {object} tier The tier being changed.
   * @param {number} quantity The requested quantity.
   * @returns {void}
   */
  function setQuantity(tier, quantity) {
    const next = clampQuantity(quantity, tier.minPerOrder ?? 1, maxSelectable(tier))

    if (holds.length > 0) void release(holds.map((hold) => hold.id))

    setHolds([])
    setRefusal(null)
    setStatus(IDLE)
    setQuantities((current) => ({ ...current, [tier.id]: next }))
  }

  /**
   * Hold the selected tickets for this account.
   *
   * @returns {Promise<void>} Resolves once the attempt has finished either way.
   */
  async function handleReserve() {
    setStatus('reserving')
    setRefusal(null)

    try {
      const taken = await reserve(lines)

      setHolds(taken)
      attemptKey.current = newAttemptKey()
      setStatus('held')
    } catch (error) {
      setRefusal(describeApiRefusal(error))
      setStatus('reserve-failed')
    }
  }

  /**
   * Place the order, with the simulated payment.
   *
   * @returns {Promise<void>} Resolves once the attempt has finished either way.
   */
  async function handlePay() {
    setStatus('paying')
    setRefusal(null)

    try {
      const placed = await placeOrder({
        eventId: event.id,
        buyer,
        lines,
        holdIds: holds.map((hold) => hold.id),
        idempotencyKey: attemptKey.current,
      })

      // The key is not cleared: the booked view replaces the form, and the
      // next reservation mints its own.
      setOrder(placed)
      setHolds([])
      setQuantities({})
      setStatus('paid')
    } catch (error) {
      const described = describeApiRefusal(error)

      setRefusal(described)
      // A lapsed hold cannot be paid for; the buyer has to reserve again.
      if (described.state === 'expired') {
        setHolds([])
        setStatus('expired')
      } else {
        setStatus('pay-failed')
      }
    }
  }

  if (status === 'paid' && order) return <Booked order={order} event={event} />

  const until = heldUntil(holds)
  const holding = status === 'held' || status === 'paying' || status === 'pay-failed'
  const salesTaxUncalculated = place.country === 'US' && totals.taxPolicy?.rateBps === 0

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start lg:gap-8">
      <section
        aria-labelledby="choose-tickets"
        className="min-w-0 rounded-card bg-surface-raised p-5 shadow-card sm:p-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="choose-tickets" className="text-h2 font-semibold text-ink">
              Choose your tickets
            </h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">
              Reserving holds your tickets for a while, and the held notice says until when — plenty
              of time to argue about who is paying.
            </p>
          </div>
          <p aria-hidden="true" className="text-xs text-ink-subtle sm:text-right">
            Face value, then with the booking fee
          </p>
        </div>

        <ul className="mt-6 flex flex-col gap-3">
          {ticketTypes.map((tier) => {
            const max = maxSelectable(tier)
            const availabilityId = `availability-${tier.id}`
            const chosen = (quantities[tier.id] ?? 0) > 0
            const allIn = tier.reserved || tier.isSoldOut ? null : tierAllIn(tier, place, feeTerms)

            return (
              <li
                key={tier.id}
                className={`grid grid-cols-1 items-center gap-3 rounded-2xl border-[1.5px] p-4 transition-colors duration-(--duration-fast) sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-5 sm:pl-5 ${
                  chosen ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-raised'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-bold text-ink">{tier.name}</p>
                  {tier.description ? (
                    <p className="mt-0.5 text-sm text-ink-muted">{tier.description}</p>
                  ) : null}
                  <p id={availabilityId} className="mt-1 text-sm text-ink-muted">
                    {tier.reserved
                      ? `${formatPrice(tier.priceCents, tier.currency)} each · seats are chosen on a seat map, which this site does not have, so these are not sold here`
                      : tier.isSoldOut
                        ? 'Sold out'
                        : `${formatPrice(tier.priceCents, tier.currency)} each · up to ${max} per order`}
                  </p>
                </div>

                <p className="text-left sm:text-right">
                  <span className="block font-bold text-ink tabular-nums">
                    {formatPrice(tier.priceCents, tier.currency)}
                  </span>
                  {allIn ? (
                    <span className="block text-xs text-ink-muted tabular-nums">
                      {formatPrice(allIn.totalCents, tier.currency)} with fees
                      {allIn.taxCents > 0 ? ' and tax' : ''}
                    </span>
                  ) : null}
                </p>

                <div className="flex shrink-0 items-center gap-3">
                  {tier.reserved ? (
                    <Badge variant="neutral" srLabel="Availability:">
                      Not sold here
                    </Badge>
                  ) : tier.isSoldOut ? (
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
                      disabled={busy}
                      onChange={(quantity) => setQuantity(tier, quantity)}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {holding ? (
          <Alert variant="success" title="Tickets held" className="mt-5">
            {until ? `Held for you until ${until}.` : 'Held for you for a limited time.'} Payment on
            this site is simulated: you will not be asked for a card, and no money moves.
          </Alert>
        ) : null}
      </section>

      <section
        aria-labelledby="order-summary"
        className="overflow-hidden rounded-card bg-surface-raised shadow-card lg:sticky lg:top-28"
      >
        <div className="flex items-center gap-4 bg-surface-subtle px-5 py-4 sm:px-6">
          <div
            aria-hidden="true"
            className="h-16 w-24 shrink-0 overflow-hidden rounded-control bg-surface-inverse"
          >
            <EventPoster event={event} className="h-full" />
          </div>
          <div className="min-w-0">
            <p className="leading-5 font-bold text-ink">{event.title}</p>
            {event.startsAt ? (
              <p className="mt-1 text-xs text-ink-muted">{formatEventStart(event)}</p>
            ) : null}
          </div>
        </div>

        <div className="px-5 pt-6 pb-5 sm:px-8">
          <h2 id="order-summary" className="text-h3 font-semibold text-ink">
            Order summary
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {ticketCount === 0
              ? 'No tickets selected yet'
              : `${ticketCount} ${ticketCount === 1 ? 'ticket' : 'tickets'} for ${event.title}`}
          </p>

          <dl className="mt-5 space-y-3 text-[0.9375rem]">
            {totals.lineItems.map((line) => (
              <div key={line.ticketTypeId} className="flex justify-between gap-3">
                <dt className="min-w-0 text-ink">
                  {line.name} <span className="text-ink-muted">× {line.quantity}</span>
                </dt>
                <dd className="shrink-0 font-bold text-ink tabular-nums">
                  {formatAmount(line.subtotalCents, totals.currency)}
                </dd>
              </div>
            ))}

            <div className="flex justify-between gap-3 border-t border-line pt-3">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="font-bold text-ink tabular-nums" data-testid="summary-subtotal">
                {formatAmount(totals.subtotalCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Booking fee</dt>
              <dd className="font-bold text-ink tabular-nums">
                {formatAmount(totals.feesCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">
                {taxLabelForPlace(place)}
                {salesTaxUncalculated ? (
                  <span className="block text-xs text-ink-subtle">
                    US sales tax is not calculated in this demo
                  </span>
                ) : null}
              </dt>
              <dd className="font-bold text-ink tabular-nums">
                {formatAmount(totals.taxCents, totals.currency)}
              </dd>
            </div>
          </dl>

          <MirrorDivider className="my-5" />

          <div className="flex items-end justify-between gap-3">
            <p className="flex flex-col">
              <span className="text-base font-bold text-ink">Total</span>
              <span className="text-micro font-bold tracking-eyebrow text-ink-subtle uppercase">
                {totals.currency}
              </span>
            </p>
            <p
              className="font-display text-4xl leading-none font-bold text-ink tabular-nums"
              data-testid="summary-total"
            >
              {formatAmount(totals.totalCents, totals.currency)}
            </p>
          </div>

          {status === 'reserve-failed' && refusal ? (
            refusal.state === 'network' ? (
              <Alert
                variant="warning"
                title="We could not reach the ticketing service"
                className="mt-5"
              >
                Nothing has been reserved and you have not been charged. Please try again in a
                moment.
              </Alert>
            ) : (
              <Alert variant="warning" title="Nothing was reserved" className="mt-5">
                {refusal.detail}
              </Alert>
            )
          ) : null}

          {status === 'expired' ? (
            <Alert variant="warning" title="The hold ran out" className="mt-5">
              The hold on these tickets has run out. Nothing was charged. Reserve again to carry on.
            </Alert>
          ) : null}

          {status === 'pay-failed' && refusal ? (
            <Alert variant="warning" title="The order was not placed" className="mt-5">
              {refusal.state === 'network'
                ? 'The service did not answer. Trying again is safe: the same attempt cannot book twice, and nothing is charged in this build.'
                : refusal.detail}
            </Alert>
          ) : null}

          <div className="mt-6 flex flex-col items-stretch gap-3">
            {buyer === null && ticketCount > 0 ? (
              <>
                <Link href={signInHref} className={PRIMARY_LINK}>
                  Sign in to buy
                </Link>
                <p className="text-xs text-ink-muted">
                  Tickets are kept in your account, and this site sends no email, so buying needs
                  one. Signing in brings you back here.
                </p>
              </>
            ) : holding ? (
              <Button
                fullWidth
                size="lg"
                className="min-h-14 text-[1.0625rem]"
                loading={status === 'paying'}
                onClick={handlePay}
              >
                Pay {formatAmount(totals.totalCents, totals.currency)} (simulated)
              </Button>
            ) : (
              <Button
                fullWidth
                size="lg"
                className="min-h-14 text-[1.0625rem]"
                disabled={ticketCount === 0}
                loading={status === 'reserving'}
                onClick={handleReserve}
              >
                {ticketCount === 0 ? 'Select tickets to continue' : 'Reserve tickets'}
              </Button>
            )}
          </div>
        </div>

        <p className="border-t border-line px-5 py-4 text-xs text-ink-muted sm:px-8">
          The ticketing service prices the order again before it is placed.{' '}
          <Link href={`/events/${event.slug}`} className={QUIET_LINK}>
            Back to {event.title}
          </Link>
        </p>
      </section>
    </div>
  )
}

/**
 * The booking, once the order has been placed.
 *
 * A polite status, not an assertive alert: it replaces the form the buyer just
 * pressed, and nothing about it is urgent.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order as the API returned it.
 * @param {object} [props.event] The event, for its poster and title.
 * @returns {JSX.Element} The confirmation.
 */
function Booked({ order, event = null }) {
  const tickets = (order.tickets ?? []).length

  return (
    <section
      aria-labelledby="booked-heading"
      role="status"
      className="overflow-hidden rounded-card bg-surface-raised shadow-card"
    >
      <div aria-hidden="true" className="h-1 bg-status-success" />
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-status-success-soft text-status-success"
        >
          <CheckIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="booked-heading" className="text-h2 font-semibold text-status-success">
            Booked
          </h2>
          {event?.title ? <p className="mt-1 font-bold text-ink">{event.title}</p> : null}
          <p className="mt-3 text-ink">
            Order <span className="font-mono font-semibold tracking-wide">{order.reference}</span>
            {tickets > 0 ? ` · ${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}` : ''} ·{' '}
            {formatAmount(order.totalCents, order.currency)}
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The payment was simulated: no card was asked for and no money moved. The tickets are in
            your account now.
          </p>
          <p className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/tickets" className={PRIMARY_LINK}>
              Your tickets
            </Link>
            <Link
              href={`/account/orders/${encodeURIComponent(order.reference)}`}
              className={OUTLINE_LINK}
            >
              This order
            </Link>
          </p>
        </div>
        {event?.slug ? (
          <div
            aria-hidden="true"
            className="hidden h-20 w-30 shrink-0 overflow-hidden rounded-control sm:block"
          >
            <EventPoster event={event} className="h-full" />
          </div>
        ) : null}
      </div>
    </section>
  )
}
