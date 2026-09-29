'use client'

/**
 * Ticket selection, the running order summary, and the purchase itself.
 *
 * ## Two figures, and which one is charged
 *
 * Before anything is held, the summary is the browser's own estimate:
 * `computeOrderTotals` from `@desi-event/pricing`, with the fee terms the API
 * published for this event — the same function and terms the API charges with.
 * Once the tickets are held, the summary is the server's quote
 * (`POST /v1/orders/quote`), computed by the very function that takes the
 * payment, with the holds and any promo code; the pay button names that
 * figure, and it is sent back as `expectedTotalCents`. If the server's figure
 * has moved by the time the order is placed — a code used up meanwhile — the
 * order is refused before anything is charged (409 `PRICE_CHANGED`), the quote
 * is asked for again, and the buyer is shown the new total to pay. A price the
 * browser computed is never sent, and never trusted.
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
 * 2. **Name the tickets, if you like, and apply a code.** Each ticket may carry
 *    a guest's name; a blank one carries the buyer's.
 * 3. **Pay, simulated.** `POST /v1/orders` with the holds, the names, the code,
 *    the quoted total, and an `Idempotency-Key` minted for this attempt and kept
 *    only in memory, so a retry after a lost answer cannot book twice.
 *    `PAYMENT_MODE` is `MOCK`: no card is asked for and no money moves.
 * 4. **Booked.** The reference, the total, and where the tickets are.
 *
 * Seated tiers are bought by seat, on the night's seat map; the list links
 * there instead of offering a quantity.
 *
 * @module components/checkout-basket
 */

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'

import {
  heldUntil,
  newAttemptKey,
  placeOrderThroughApi,
  quoteThroughApi,
  releaseThroughApi,
  reserveThroughApi,
} from '../lib/checkout-api.js'
import { formatEventStart } from '../lib/format.js'
import { formatAmount, formatPrice, priceSelection } from '../lib/pricing.js'
import { describeApiRefusal } from '../lib/refusal.js'
import { groupTiersBySession, sessionDisplayLabel, sessionForTier } from '../lib/sessions.js'
import { AttendeeNames, attendeesFrom, hasNameProblems } from './attendee-names.jsx'
import { BookedOrder } from './booked-order.jsx'
import { OUTLINE_LINK, PRIMARY_LINK } from './link-classes.js'
import { EventArt } from './event-art.jsx'
import { OrderSummary, totalsFromEstimate, totalsFromQuote } from './order-summary.jsx'
import { PromoCodeField } from './promo-code-field.jsx'
import { QuantityStepper, clampQuantity } from './quantity-stepper.jsx'
import { tierAllIn } from './ticket-tiers.jsx'
import { Alert, Badge, Button } from './ui.jsx'

// Moved to lib/checkout-api.js, where the seat checkout reaches them too;
// re-exported so every existing import of them from here keeps working.
export { placeOrderThroughApi, releaseThroughApi, reserveThroughApi }

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
 * One box per ticket for the guests' names, labelled with its tier and night.
 *
 * @param {Array<{ticketTypeId: string, name: string, quantity: number}>} lines The held lines.
 * @param {function(string): (string|null)} nightOf A tier's night, in words.
 * @returns {Array<{key: string, label: string, ticketTypeId: string}>} The slots.
 */
export function attendeeSlots(lines, nightOf) {
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  const slots = []
  let position = 0

  for (const line of lines) {
    const night = nightOf(line.ticketTypeId)

    for (let index = 0; index < line.quantity; index += 1) {
      position += 1
      slots.push({
        key: `${line.ticketTypeId}:${index}`,
        label: `Ticket ${position} of ${total} — ${line.name}${night ? `, ${night}` : ''}`,
        ticketTypeId: line.ticketTypeId,
      })
    }
  }

  return slots
}

/**
 * @typedef {object} CheckoutBasketProps
 * @property {object} event The event being bought into, with `feeTerms` and `sessions` when the API sent them.
 * @property {object[]} ticketTypes Ticket tiers with availability folded in.
 * @property {{name: string, email: string}|null} [buyer] The signed-in buyer, or null.
 * @property {string} [signInHref] Where a signed-out visitor signs in, returning here.
 * @property {Function} [reserve] Override for the hold calls; supplied by tests.
 * @property {Function} [release] Override for releasing holds; supplied by tests.
 * @property {Function} [quote] Override for the quote call; supplied by tests.
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
  quote: requestQuote = quoteThroughApi,
  placeOrder = placeOrderThroughApi,
}) {
  const [quantities, setQuantities] = useState({})
  const [status, setStatus] = useState(IDLE)
  const [holds, setHolds] = useState([])
  const [order, setOrder] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteFailure, setQuoteFailure] = useState(null)
  const [promoCode, setPromoCode] = useState(null)
  const [promoOutcome, setPromoOutcome] = useState(null)
  const [names, setNames] = useState({})
  const [priceChanged, setPriceChanged] = useState(false)
  const attemptKey = useRef(null)

  /**
   * Start a new purchase attempt: a fresh idempotency key, because the last
   * one is spent once the server has answered it.
   *
   * @returns {void}
   */
  const renewAttempt = () => {
    attemptKey.current = newAttemptKey()
  }

  const currency = ticketTypes[0]?.currency ?? 'USD'
  const sessions = useMemo(() => event?.sessions ?? [], [event?.sessions])
  const tiersById = useMemo(
    () => new Map(ticketTypes.map((tier) => [tier.id, tier])),
    [ticketTypes],
  )

  /**
   * A tier's night in words, when the event has more than one.
   *
   * @param {string} ticketTypeId The tier.
   * @returns {string|null} The night's label.
   */
  const nightOf = (ticketTypeId) => {
    if (sessions.length <= 1) return null

    const session = sessionForTier(tiersById.get(ticketTypeId), sessions)

    return session ? sessionDisplayLabel(session) : 'Every night'
  }

  /**
   * A quote line's night in words, by session id.
   *
   * @param {string|null} sessionId The night.
   * @returns {string|null} Its label.
   */
  const nightOfSession = (sessionId) => {
    if (sessions.length <= 1) return null

    const session = sessions.find((candidate) => candidate.id === sessionId)

    return session ? sessionDisplayLabel(session) : 'Every night'
  }

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
  // The fee terms the API published for this event, so the estimate here is
  // the total the order will come to rather than one priced with the defaults.
  const feeTerms = event?.feeTerms ?? null
  const estimate = useMemo(
    () => priceSelection({ lines, currency, place, feeTerms }),
    [lines, currency, place, feeTerms],
  )
  const ticketCount = lines.reduce((sum, line) => sum + line.quantity, 0)
  const busy = status === 'reserving' || status === 'paying' || quoting
  const holding = status === 'held' || status === 'paying' || status === 'pay-failed'

  /**
   * Ask the server what the basket comes to now, with a code or without.
   *
   * @param {object} options Options.
   * @param {string|null} options.code The code to try, or null for none.
   * @param {string[]} options.holdIds The holds, when there are some.
   * @returns {Promise<object|null>} The quote, or null when it could not be had.
   */
  async function refreshQuote({ code, holdIds }) {
    setQuoting(true)
    setQuoteFailure(null)

    try {
      const next = await requestQuote({
        eventId: event.id,
        lines,
        promoCode: code ?? undefined,
        holdIds,
      })

      setQuote(next)
      setPromoOutcome(next?.promo ?? null)
      // Only a code that took is kept for the order. An unknown one would be
      // refused there, and one that gives nothing has no business on it.
      setPromoCode(next?.promo?.applied ? next.promo.code : null)

      return next
    } catch (error) {
      // No server figure, so nothing to pay against: Pay waits until a quote
      // answers, and the buyer is told why and can ask again. The estimate
      // stays on screen, labelled as one.
      setQuote(null)
      setQuoteFailure({ refusal: describeApiRefusal(error), code: code ?? null, holdIds })

      return null
    } finally {
      setQuoting(false)
    }
  }

  /**
   * Record a new quantity for one tier, releasing anything already held: the
   * holds were for the old selection, and so was the quote.
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
    setQuote(null)
    setQuoteFailure(null)
    setPriceChanged(false)
    setStatus(IDLE)
    // A code that took stays chosen, and is checked again with the new
    // selection when it is reserved; until then the summary is an estimate.
    setPromoOutcome(promoCode ? { code: promoCode, applied: true, pending: true } : null)
    setQuantities((current) => ({ ...current, [tier.id]: next }))
  }

  /**
   * Hold the selected tickets for this account, then ask for the quote.
   *
   * @returns {Promise<void>} Resolves once the attempt has finished either way.
   */
  async function handleReserve() {
    setStatus('reserving')
    setRefusal(null)
    setQuoteFailure(null)
    setPriceChanged(false)

    try {
      const taken = await reserve(lines)

      setHolds(taken)
      attemptKey.current = newAttemptKey()
      setStatus('held')
      await refreshQuote({ code: promoCode, holdIds: taken.map((hold) => hold.id) })
    } catch (error) {
      setRefusal(describeApiRefusal(error))
      setStatus('reserve-failed')
    }
  }

  /**
   * Try a promo code.
   *
   * @param {string} code The normalised code.
   * @returns {Promise<void>} Resolves once the quote answered.
   */
  async function applyCode(code) {
    setRefusal(null)
    await refreshQuote({ code, holdIds: holds.map((hold) => hold.id) })
  }

  /**
   * Stop using the code.
   *
   * @returns {void}
   */
  function removeCode() {
    setPromoCode(null)
    setPromoOutcome(null)
    setQuote(null)

    if (holding) void refreshQuote({ code: null, holdIds: holds.map((hold) => hold.id) })
  }

  /**
   * Place the order, with the simulated payment.
   *
   * @returns {Promise<void>} Resolves once the attempt has finished either way.
   */
  async function handlePay() {
    // Paid only against the server's own figure; the button is not offered
    // without one.
    if (!quote) return

    setStatus('paying')
    setRefusal(null)
    setPriceChanged(false)

    const slots = attendeeSlots(lines, nightOf)

    try {
      const placed = await placeOrder({
        eventId: event.id,
        buyer,
        lines,
        holdIds: holds.map((hold) => hold.id),
        idempotencyKey: attemptKey.current,
        // The code and the total from the same quote, so the precondition is
        // the figure for exactly the code sent.
        promoCode: quote.promo?.applied ? quote.promo.code : undefined,
        attendees: attendeesFrom(slots, names),
        expectedTotalCents: quote.totalCents,
      })

      // The key is not cleared: the booked view replaces the form, and the
      // next reservation mints its own.
      setOrder(placed)
      setHolds([])
      setQuantities({})
      setStatus('paid')
    } catch (error) {
      const described = describeApiRefusal(error)

      // The server's figure moved since the quote. Nothing was charged; ask
      // again, show the new total, and let the buyer decide.
      if (error?.code === 'PRICE_CHANGED') {
        // A new attempt: the refused one is spent.
        renewAttempt()
        await refreshQuote({ code: promoCode, holdIds: holds.map((hold) => hold.id) })
        setPriceChanged(true)
        setStatus('held')
        return
      }

      setRefusal(described)
      // A lapsed hold cannot be paid for; the buyer has to reserve again.
      if (described.state === 'expired') {
        setHolds([])
        setQuote(null)
        setStatus('expired')
      } else {
        setStatus('pay-failed')
      }
    }
  }

  if (status === 'paid' && order) {
    return (
      <BookedOrder
        order={order}
        event={event}
        named={Object.values(names).some((name) => String(name).trim())}
      />
    )
  }

  const until = heldUntil(holds)
  const totals = quote
    ? totalsFromQuote(quote, nightOfSession)
    : totalsFromEstimate(estimate, nightOf)
  const salesTaxUncalculated = place.country === 'US' && estimate.taxPolicy?.rateBps === 0
  const groups = groupTiersBySession(ticketTypes, sessions)
  const slots = holding ? attendeeSlots(lines, nightOf) : []
  const namesRefused = hasNameProblems(names, slots)
  const payable = Boolean(quote) && !quoting && !namesRefused

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

        {groups.map((group) => (
          <div key={group.key} className="mt-6">
            {group.heading ? (
              <h3 className="text-base font-bold text-ink">{group.heading}</h3>
            ) : null}
            <ul className={`flex flex-col gap-3 ${group.heading ? 'mt-3' : ''}`}>
              {group.tiers.map((tier) => (
                <TierRow
                  key={tier.id}
                  tier={tier}
                  event={event}
                  session={sessionForTier(tier, sessions)}
                  quantity={quantities[tier.id] ?? 0}
                  place={place}
                  feeTerms={feeTerms}
                  disabled={busy}
                  onChange={(quantity) => setQuantity(tier, quantity)}
                />
              ))}
            </ul>
          </div>
        ))}

        {holding ? (
          <Alert variant="success" title="Tickets held" className="mt-5">
            {until ? `Held for you until ${until}.` : 'Held for you for a limited time.'} Payment on
            this site is simulated: you will not be asked for a card, and no money moves.
          </Alert>
        ) : null}

        {holding && buyer ? (
          <div className="mt-6 border-t border-line pt-6">
            <AttendeeNames
              slots={slots}
              values={names}
              onChange={(key, value) => setNames((current) => ({ ...current, [key]: value }))}
              buyerName={buyer.name}
              disabled={status === 'paying'}
            />
          </div>
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
            <EventArt event={event} className="h-full" decorative sizes="96px" />
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
              ? 'No tickets selected'
              : `${ticketCount} ${ticketCount === 1 ? 'ticket' : 'tickets'} for ${event.title}`}
          </p>

          <OrderSummary
            totals={totals}
            place={place}
            promoCode={quote?.promo?.applied ? quote.promo.code : null}
            salesTaxUncalculated={salesTaxUncalculated}
          />

          {ticketCount > 0 ? (
            <div className="mt-5 border-t border-line pt-5">
              <PromoCodeField
                promo={promoOutcome}
                currency={currency}
                onApply={applyCode}
                onRemove={removeCode}
                busy={quoting}
                disabled={status === 'paying' || status === 'reserving'}
                disabledReason={buyer ? null : 'You can use a promo code after signing in.'}
              />
            </div>
          ) : null}

          {quoteFailure && !quoting ? (
            <Alert variant="warning" title="We could not get the total" className="mt-5">
              {quoteFailure.refusal.state === 'network'
                ? 'The ticketing service did not answer.'
                : quoteFailure.refusal.detail}{' '}
              {holding
                ? 'Your tickets are still held, and nothing has been charged. You can pay once the ticketing service has priced them.'
                : 'Nothing has been reserved or charged.'}
              <span className="mt-3 block">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void refreshQuote({ code: quoteFailure.code, holdIds: quoteFailure.holdIds })
                  }
                >
                  Ask for the total again
                </Button>
              </span>
            </Alert>
          ) : null}

          {priceChanged && quote ? (
            <Alert variant="warning" title="The total changed" className="mt-5">
              The total is now {formatAmount(quote.totalCents, quote.currency)}. Nothing was
              charged. Check the summary and pay again.
            </Alert>
          ) : null}

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
                disabled={!payable}
                onClick={handlePay}
              >
                {quote
                  ? `Pay ${formatAmount(quote.totalCents, quote.currency)} (simulated)`
                  : 'Pay (simulated)'}
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
            {holding && namesRefused ? (
              <p className="text-xs text-status-danger">
                One of the names needs changing before you can pay.
              </p>
            ) : null}
          </div>
        </div>

        <p className="border-t border-line px-5 py-4 text-xs text-ink-muted sm:px-8">
          {quote
            ? 'This total is the ticketing service’s own quote for the tickets you hold.'
            : 'The ticketing service prices the order again before it is placed.'}{' '}
          <Link href={`/events/${event.slug}`} className={QUIET_LINK}>
            Back to {event.title}
          </Link>
        </p>
      </section>
    </div>
  )
}

/**
 * One tier in the list: its name and price, and a stepper, a seat-map link or
 * the reason it cannot be chosen.
 *
 * @param {object} props Component props.
 * @param {object} props.tier The tier.
 * @param {object} props.event The event.
 * @param {object|null} props.session The tier's night.
 * @param {number} props.quantity How many are chosen.
 * @param {object} props.place Where the event is held.
 * @param {Array<object>|null} props.feeTerms The event's fee terms.
 * @param {boolean} props.disabled Whether the stepper can be used now.
 * @param {function(number): void} props.onChange Record a new quantity.
 * @returns {JSX.Element} The row.
 */
function TierRow({ tier, event, session, quantity, place, feeTerms, disabled, onChange }) {
  const max = maxSelectable(tier)
  const availabilityId = `availability-${tier.id}`
  const chosen = quantity > 0
  const seatMap = tier.reserved && session?.hasSeatMap ? session : null
  const allIn = tier.reserved || tier.isSoldOut ? null : tierAllIn(tier, place, feeTerms)

  return (
    <li
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
            ? seatMap
              ? `${formatPrice(tier.priceCents, tier.currency)} each · chosen seat by seat on the seat map`
              : `${formatPrice(tier.priceCents, tier.currency)} each · sold by seat, and there is no seat map to choose from here`
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
          seatMap && tier.isSoldOut ? (
            // Its own seats, not the night's: another zone having seats does
            // not make this one worth a trip to the map.
            <Badge variant="danger" srLabel="Availability:">
              Sold out
            </Badge>
          ) : seatMap ? (
            <Link
              href={`/events/${encodeURIComponent(event.slug)}/seats/${encodeURIComponent(seatMap.id)}`}
              className={OUTLINE_LINK}
              aria-describedby={availabilityId}
            >
              Choose seats
            </Link>
          ) : (
            <Badge variant="neutral" srLabel="Availability:">
              Not sold here
            </Badge>
          )
        ) : tier.isSoldOut ? (
          <Badge variant="danger" srLabel="Availability:">
            Sold out
          </Badge>
        ) : (
          <QuantityStepper
            label={tier.name}
            value={quantity}
            min={tier.minPerOrder ?? 1}
            max={max}
            describedBy={availabilityId}
            disabled={disabled}
            onChange={onChange}
          />
        )}
      </div>
    </li>
  )
}
