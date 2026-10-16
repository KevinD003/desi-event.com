'use client'

/**
 * Choosing seats at one night, and buying them.
 *
 * The same steps as the ticket basket, with seats instead of quantities:
 *
 * 1. **Choose.** On the grid (`SeatPicker`). A wheelchair space brings its
 *    companion seat and the other way round — the rule the server enforces,
 *    from the same function. A running estimate prices each seat at its own
 *    price. A polite status says what changed.
 * 2. **Reserve.** `POST /v1/sessions/:id/holds` with the chosen seat ids and
 *    nothing else; tier, price and hold time are the server's. If a seat went
 *    meanwhile, the map is read again and the seat that went is named.
 *    Changing the selection afterwards gives the hold back.
 * 3. **Quote, name, apply a code.** The server's quote for exactly the held
 *    seats; a name for each seat, all optional; a promo code.
 * 4. **Pay, simulated.** `POST /v1/orders` with one line per tier (counted
 *    from the hold's own seats, companions included), the hold, the names by
 *    seat, the code and the quoted total as a precondition. Booked only when
 *    the order comes back `PAID`; one placed and not settled shows the API's
 *    own sentence, takes Pay away and links to the order (`UnsettledPayment`).
 *
 * Signed-out visitors can look and see every price; reserving needs an
 * account, and signing in brings them back here.
 *
 * Paying at the venue and referral codes work as in the ticket basket (SPEC3
 * §6.5, §12.1): the same choice, the same box, the same urgent alerts when Pay
 * meets a changed booking fee, a switched-off or full venue payment, or a
 * referral code that stopped applying, and the same confirmation, "Booked —
 * pay at the door", for a booking to pay at the venue.
 *
 * @module components/seat-checkout
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  AT_VENUE,
  CARD,
  REFERRAL_WITHDRAWN_SENTENCE,
  VENUE_REFUSAL_CODES,
  VENUE_UNAVAILABLE_ANNOUNCEMENT,
  heldUntil,
  holdSeatsThroughApi,
  loadSeatMapThroughApi,
  newAttemptKey,
  payButtonLabel,
  placeOrderThroughApi,
  priceChangedNotice,
  quoteThroughApi,
  releaseThroughApi,
  totalUpdatedAnnouncement,
  venuePaymentOffered,
  venueRefusalSentence,
} from '../lib/checkout-api.js'
import { isBooked, notBookedNotice } from '../lib/checkout-outcome.js'
import { priceSelection } from '../lib/pricing.js'
import { describeApiRefusal } from '../lib/refusal.js'
import {
  MAX_SEATS_PER_ORDER,
  companionGroup,
  flattenSeats,
  groupSelectionIntoItems,
  limitingTier,
  selectionAnnouncement,
  selectionLimit,
  selectionLines,
  selectionShortfalls,
  toggleSeat,
} from '../lib/seat-map.js'
import { AttendeeNames, attendeesFrom, hasNameProblems } from './attendee-names.jsx'
import { BookedOrder } from './booked-order.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { PRIMARY_LINK } from './link-classes.js'
import { OrderSummary, totalsFromEstimate, totalsFromQuote } from './order-summary.jsx'
import { PaymentMethodChoice } from './payment-method-choice.jsx'
import { PromoCodeField } from './promo-code-field.jsx'
import { ReferralCodeField } from './referral-code-field.jsx'
import { SeatPicker } from './seat-picker.jsx'
import { Alert, Button } from './ui.jsx'
import { UnsettledPayment } from './unsettled-payment.jsx'

/**
 * @typedef {object} SeatCheckoutProps
 * @property {object} event The event, with its venue and fee terms.
 * @property {object} initialMap The night's seat map, as the page read it.
 * @property {{name: string, email: string}|null} [buyer] The signed-in buyer, or null.
 * @property {string} [signInHref] Where a signed-out visitor signs in, returning here.
 * @property {Function} [holdSeats] Override for the seat hold; supplied by tests.
 * @property {Function} [loadSeatMap] Override for reading the map again; supplied by tests.
 * @property {Function} [release] Override for releasing a hold; supplied by tests.
 * @property {Function} [quote] Override for the quote; supplied by tests.
 * @property {Function} [placeOrder] Override for the order; supplied by tests.
 */

/**
 * What one order may hold, in words: the map's ceiling, any tier that allows
 * fewer, and any tier that sells more than one at a time. The limits are the
 * server's own; a sentence that said "up to 6" where one zone sells two would
 * be promising a selection the hold then refuses.
 *
 * @param {object[]} tiers The map's tiers.
 * @param {number} limit The map's ceiling.
 * @returns {string} The sentence, or sentences.
 */
export function perOrderSentence(tiers, limit) {
  const parts = [`Up to ${limit} seats in one order.`]

  for (const tier of tiers) {
    if (Number.isInteger(tier.maxPerOrder) && tier.maxPerOrder < limit) {
      parts.push(
        `A selection with seats sold as “${tier.name}” can have at most ${tier.maxPerOrder}.`,
      )
    }
  }

  for (const tier of tiers) {
    if (Number.isInteger(tier.minPerOrder) && tier.minPerOrder > 1) {
      parts.push(`Seats sold as “${tier.name}” are sold at least ${tier.minPerOrder} at a time.`)
    }
  }

  return parts.join(' ')
}

/**
 * The seat picker, the running summary and the purchase.
 *
 * @param {SeatCheckoutProps} props Component props.
 * @returns {JSX.Element} The checkout.
 */
export function SeatCheckout({
  event,
  initialMap,
  buyer = null,
  signInHref = '/sign-in',
  holdSeats = holdSeatsThroughApi,
  loadSeatMap = loadSeatMapThroughApi,
  release = releaseThroughApi,
  quote: requestQuote = quoteThroughApi,
  placeOrder = placeOrderThroughApi,
}) {
  const [map, setMap] = useState(initialMap)
  const [selected, setSelected] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [status, setStatus] = useState('idle')
  const [hold, setHold] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [promoCode, setPromoCode] = useState(null)
  const [promoOutcome, setPromoOutcome] = useState(null)
  const [names, setNames] = useState({})
  const [refusal, setRefusal] = useState(null)
  const [quoteFailure, setQuoteFailure] = useState(null)
  const [lostSeats, setLostSeats] = useState([])
  // What the checkout says once Pay was refused and the quote asked for again
  // (SPEC3 §6.5): `{ title, sentence, urgent }`, or null.
  const [notice, setNotice] = useState(null)
  const [order, setOrder] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState(CARD)
  // The referral code the next quote is asked with, and where it stands.
  const [referralCode, setReferralCode] = useState(null)
  const [referral, setReferral] = useState(null)
  // Bumped to empty the referral box when a code is cleared for the buyer.
  const [referralBox, setReferralBox] = useState(0)
  const attemptKey = useRef(null)
  const unsettledRef = useRef(null)
  const noticeRef = useRef(null)
  const summaryHeadingRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  /**
   * Start a new purchase attempt: a fresh idempotency key, because the last
   * one is spent once the server has answered it.
   *
   * @returns {void}
   */
  const renewAttempt = () => {
    attemptKey.current = newAttemptKey()
  }

  const seats = useMemo(() => flattenSeats(map), [map])
  const seatsById = useMemo(() => new Map(seats.map((seat) => [seat.seatId, seat])), [seats])
  const seatsByEventSeat = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats])
  const tiersById = useMemo(() => new Map((map.tiers ?? []).map((tier) => [tier.id, tier])), [map])
  const currency = map.tiers?.[0]?.currency ?? 'USD'
  const limit = Math.min(map.maxSeatsPerOrder ?? MAX_SEATS_PER_ORDER, MAX_SEATS_PER_ORDER)
  const shortfalls = selectionShortfalls(selected, seatsById, tiersById)
  const place = useMemo(
    () => ({ country: event?.venue?.country ?? null, region: event?.venue?.region ?? null }),
    [event?.venue?.country, event?.venue?.region],
  )
  const feeTerms = event?.feeTerms ?? null

  const estimate = useMemo(
    () =>
      priceSelection({
        lines: selectionLines(selected, seatsById, tiersById),
        currency,
        place,
        feeTerms,
        paymentMethod,
      }),
    [selected, seatsById, tiersById, currency, place, feeTerms, paymentMethod],
  )

  const holding = status === 'held' || status === 'paying' || status === 'pay-failed'
  // An order is waiting on its payment: nothing here may change until that is
  // settled, and the page says where to look instead.
  const unsettled = status === 'unsettled'
  const busy = status === 'reserving' || status === 'paying' || quoting || unsettled
  const items = hold ? groupSelectionIntoItems(hold.seats) : []
  const venueOffered = venuePaymentOffered({ quote, event, estimate })

  // "Pay at the venue" stopped being offered while it was chosen, before a
  // quote was asked for it (the seats chosen came to nothing): back to card,
  // and the buyer is told and taken to the summary. A quote that refuses it is
  // dealt with where it is asked for.
  useEffect(() => {
    if (paymentMethod !== AT_VENUE || venueOffered || quoting) return

    setPaymentMethod(CARD)
    setAnnouncement(VENUE_UNAVAILABLE_ANNOUNCEMENT)
    focusAfterRender(summaryHeadingRef)
  }, [paymentMethod, venueOffered, quoting, focusAfterRender])

  /**
   * Give back a hold that no longer matches the selection.
   *
   * @returns {void}
   */
  function dropHold() {
    if (hold) void release([hold.id])

    setHold(null)
    setQuote(null)
    setQuoteFailure(null)
    setNotice(null)
    setStatus('idle')
    // A referral code the last quote applied is checked again with the next.
    if (referral?.status === 'applied') setReferral({ status: 'pending', code: referral.code })
    // A code a quote took is checked again with the next hold; one no quote
    // has answered for is still only chosen, and says so.
    setPromoOutcome((current) =>
      promoCode
        ? current?.unchecked
          ? current
          : { code: promoCode, applied: true, pending: true }
        : null,
    )
  }

  /**
   * Choose or unchoose a seat, keeping companions together.
   *
   * @param {string} seatId A `Seat` id.
   * @returns {void}
   */
  function onToggle(seatId) {
    // The smallest limit among the tiers the selection would include, as the
    // server reads it: a zone that sells two to an order caps a mixed
    // selection at two, whatever the other zone allows.
    const result = toggleSeat(selected, seatId, seats, (next) =>
      selectionLimit(next, seatsById, tiersById, limit),
    )

    if (result.refused === 'limit') {
      const binding =
        result.limit < limit
          ? limitingTier([...selected, ...companionGroup(seatId, seats)], seatsById, tiersById)
          : null

      setAnnouncement(
        binding
          ? `Seats sold as "${binding.name}" are sold at most ${binding.maxPerOrder} to an order, so this selection can have ${result.limit}.`
          : `You can choose up to ${result.limit} seats in one order.`,
      )
      return
    }

    if (result.refused === 'unavailable') {
      setAnnouncement(
        `Seat ${seatsById.get(seatId)?.label ?? ''} cannot be chosen: the seat sold with it is taken.`,
      )
      return
    }

    if (hold) dropHold()

    setRefusal(null)
    setLostSeats([])
    setAnnouncement(selectionAnnouncement(selected, result.selected, seatsById))
    setSelected(result.selected)
  }

  /**
   * Record what a quote said about the referral code it was asked with.
   *
   * @param {object|null} outcome The quote's `referral`.
   * @param {string} code The code it was asked with.
   * @returns {void}
   */
  function takeReferralOutcome(outcome, code) {
    if (outcome?.applied) {
      setReferralCode(code)
      setReferral({ status: 'applied', code })
      return
    }

    // Not applied: not sent with the order, whatever the reason.
    setReferralCode(null)
    setReferral({
      status: outcome?.reason === 'NOTHING_TO_WAIVE' ? 'NOTHING_TO_WAIVE' : 'NOT_ACCEPTED',
    })
  }

  /**
   * Ask the server what the held seats come to, with codes or without, to pay
   * by card or at the venue.
   *
   * @param {object} held The hold.
   * @param {string|null} code The promo code to try.
   * @param {object} [options] Options.
   * @param {'CARD'|'AT_VENUE'} [options.method] How the ticket price would be paid.
   * @param {string|null} [options.referralTry] The referral code to try, or null for none.
   * @returns {Promise<object|null>} The quote, or null when it could not be had.
   */
  async function refreshQuote(held, code, { method = paymentMethod, referralTry = null } = {}) {
    setQuoting(true)
    setQuoteFailure(null)

    try {
      const next = await requestQuote({
        eventId: event.id,
        lines: groupSelectionIntoItems(held.seats),
        promoCode: code ?? undefined,
        holdIds: [held.id],
        // CARD is the default and is not named.
        paymentMethod: method === AT_VENUE ? AT_VENUE : undefined,
        referralCode: referralTry ?? undefined,
      })

      setQuote(next)
      setPromoOutcome(next?.promo ?? null)
      setPromoCode(next?.promo?.applied ? next.promo.code : null)

      if (referralTry) takeReferralOutcome(next?.referral ?? null, referralTry)

      const said = totalUpdatedAnnouncement(next)

      if (said) setAnnouncement(said)

      return next
    } catch (error) {
      // Paying at the venue is not to be had for these seats now: back to
      // card, said politely, and the card quote asked for instead.
      if (method === AT_VENUE && VENUE_REFUSAL_CODES.has(error?.code)) {
        setPaymentMethod(CARD)
        setAnnouncement(VENUE_UNAVAILABLE_ANNOUNCEMENT)
        focusAfterRender(summaryHeadingRef)

        return refreshQuote(held, code, { method: CARD, referralTry })
      }

      // Too many referral codes tried: the box says so, and the seats are
      // priced without one.
      if (referralTry && error?.status === 429) {
        setReferralCode(null)
        setReferral({ status: 'rate-limited' })

        return refreshQuote(held, code, { method, referralTry: null })
      }

      // No server figure, so nothing to pay against: Pay waits until a quote
      // answers, and the buyer is told why and can ask again. The estimate
      // stays on screen, labelled as one.
      setQuote(null)
      setQuoteFailure({
        refusal: describeApiRefusal(error),
        code: code ?? null,
        method,
        referralTry,
      })

      return null
    } finally {
      setQuoting(false)
    }
  }

  /**
   * Choose how to pay, and ask for the quote again when seats are held.
   *
   * @param {'CARD'|'AT_VENUE'} method The way chosen.
   * @returns {void}
   */
  function choosePaymentMethod(method) {
    setPaymentMethod(method)
    setNotice(null)
    setAnnouncement('')

    if (hold) void refreshQuote(hold, promoCode, { method, referralTry: referralCode })
  }

  /**
   * Use a referral code: checked by the quote once the seats are held, and
   * said to be waiting until then.
   *
   * @param {string} code What the buyer typed, trimmed.
   * @returns {Promise<void>} Resolves once the quote answered, when one was asked for.
   */
  async function applyReferral(code) {
    setRefusal(null)

    if (!hold) {
      setReferralCode(code)
      setReferral({ status: 'unchecked', code })
      return
    }

    await refreshQuote(hold, promoCode, { method: paymentMethod, referralTry: code })
  }

  /**
   * Stop using the referral code, and price the held seats without it.
   *
   * @returns {void}
   */
  function removeReferral() {
    const wasApplied = referral?.status === 'applied'

    setReferralCode(null)
    setReferral(null)

    if (hold && wasApplied) void refreshQuote(hold, promoCode, { method: paymentMethod })
  }

  /**
   * Read the map again after a seat went, and name the ones that did.
   *
   * @returns {Promise<void>} Resolves once the map is fresh.
   */
  async function refreshAfterLoss() {
    try {
      const fresh = await loadSeatMap(map.sessionId)
      const freshSeats = new Map(flattenSeats(fresh).map((seat) => [seat.seatId, seat]))
      const lost = selected.filter((seatId) => !freshSeats.get(seatId)?.available)

      setMap(fresh)
      setLostSeats(lost.map((seatId) => seatsById.get(seatId)?.label ?? 'a seat'))
      setSelected(selected.filter((seatId) => !lost.includes(seatId)))
    } catch {
      // The refusal already says a seat went; the stale map is still honest
      // about everything else, and the server refuses a seat that is gone.
    }
  }

  /**
   * Hold the chosen seats, then ask for the quote.
   *
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function handleReserve() {
    setStatus('reserving')
    setRefusal(null)
    setQuoteFailure(null)
    setLostSeats([])
    setNotice(null)

    try {
      const held = await holdSeats(map.sessionId, selected)

      setHold(held)
      attemptKey.current = newAttemptKey()
      setStatus('held')
      setAnnouncement(
        `${held.seats.length} ${held.seats.length === 1 ? 'seat' : 'seats'} held for you.`,
      )
      await refreshQuote(held, promoCode, { method: paymentMethod, referralTry: referralCode })
    } catch (error) {
      const described = describeApiRefusal(error)

      setRefusal(described)
      setStatus('reserve-failed')

      if (error?.code === 'SEAT_UNAVAILABLE' || error?.status === 409) {
        await refreshAfterLoss()
      }
    }
  }

  /**
   * Place the order for the held seats.
   *
   * @returns {Promise<void>} Resolves once the attempt is over.
   */
  async function handlePay() {
    // Paid only against the server's own figure; the button is not offered
    // without one.
    if (!quote) return

    setStatus('paying')
    setRefusal(null)
    setNotice(null)

    const method = quote.paymentMethod === AT_VENUE ? AT_VENUE : CARD

    try {
      const placed = await placeOrder({
        eventId: event.id,
        buyer,
        lines: items,
        holdIds: [hold.id],
        idempotencyKey: attemptKey.current,
        // The code and the total from the same quote, so the precondition is
        // the figure for exactly the code sent.
        promoCode: quote.promo?.applied ? quote.promo.code : undefined,
        attendees: attendeesFrom(nameSlots, names),
        // What is paid online and, for a booking to pay at the venue, what is
        // paid at the door: both preconditions, never prices.
        expectedTotalCents: quote.totalCents,
        paymentMethod: method === AT_VENUE ? AT_VENUE : undefined,
        referralCode: quote.referral?.applied ? (referralCode ?? undefined) : undefined,
        expectedVenueDueCents: method === AT_VENUE ? quote.venueDueCents : undefined,
      })

      // A booking only if it is paid. Anything else is an order to look at,
      // not a success, and not a reason to pay again.
      if (!isBooked(placed)) {
        setRefusal(notBookedNotice(placed))
        setStatus('unsettled')
        focusAfterRender(unsettledRef)
        return
      }

      setOrder(placed)
      setHold(null)
      setSelected([])
      // The referral code goes with the form.
      setReferralCode(null)
      setReferral(null)
      setStatus('paid')
    } catch (error) {
      if (error?.code === 'PRICE_CHANGED') {
        // A new attempt: the refused one is spent. A booking fee the
        // administrators changed is urgent; anything else is today's notice.
        renewAttempt()

        const next = await refreshQuote(hold, promoCode, { method, referralTry: referralCode })

        if (next) setNotice(priceChangedNotice(quote, next))
        setStatus('held')
        return
      }

      // Paying at the venue was switched off, became full, or is not to be had
      // for these seats: back to card, priced again, and the buyer is taken to
      // the alert. Pay waits for them.
      if (method === AT_VENUE && VENUE_REFUSAL_CODES.has(error?.code)) {
        renewAttempt()
        setPaymentMethod(CARD)
        await refreshQuote(hold, promoCode, { method: CARD, referralTry: referralCode })
        setNotice({
          urgent: true,
          title: 'Paying at the venue is not available',
          sentence: venueRefusalSentence(error),
        })
        setStatus('held')
        focusAfterRender(noticeRef)
        return
      }

      // The referral code stopped applying: it is cleared, the booking fee is
      // back, and the buyer sees the new total before paying.
      if (error?.code === 'REFERRAL_NOT_ACCEPTED') {
        renewAttempt()
        setReferralCode(null)
        setReferral(null)
        setReferralBox((current) => current + 1)
        await refreshQuote(hold, promoCode, { method })
        setNotice({
          urgent: true,
          title: 'The booking fee is back',
          sentence: REFERRAL_WITHDRAWN_SENTENCE,
        })
        setStatus('held')
        return
      }

      const described = { ...describeApiRefusal(error), code: error?.code ?? null }

      setRefusal(described)

      // An order was placed and whether it was paid is being checked. Its seats
      // are its own until then; Pay is taken away, not offered again.
      if (described.state === 'payment-unsettled') {
        setStatus('unsettled')
        focusAfterRender(unsettledRef)
        return
      }

      // A declined card spent this attempt: the same key would be answered
      // with the same decline. The hold is still the buyer's, so the next
      // press of Pay is a new attempt against it.
      if (described.state === 'payment-declined') {
        renewAttempt()
        setStatus('pay-failed')
        return
      }

      // The order was cancelled and nothing was charged; its hold is not to be
      // relied on, so it is given back and the seats chosen again.
      if (error?.code === 'ORDER_CANCELLED' && hold) void release([hold.id])

      if (described.state === 'expired' || error?.status === 409) {
        setHold(null)
        setQuote(null)
        setStatus('expired')
        await refreshAfterLoss()
      } else {
        setStatus('pay-failed')
      }
    }
  }

  const nameSlots = holding
    ? (hold?.seats ?? []).map((heldSeat) => {
        const seat = seatsByEventSeat.get(heldSeat.id)
        const tier = tiersById.get(heldSeat.ticketTypeId)

        return {
          key: heldSeat.id,
          eventSeatId: heldSeat.id,
          ticketTypeId: heldSeat.ticketTypeId,
          label: [
            `Seat ${heldSeat.label}`,
            seat?.rowLabel ? `row ${seat.rowLabel}` : null,
            seat?.sectionName ?? null,
          ]
            .filter(Boolean)
            .join(', ')
            .concat(tier ? ` — ${tier.name}` : ''),
        }
      })
    : []

  if (status === 'paid' && isBooked(order)) {
    return (
      <BookedOrder
        order={order}
        event={event}
        named={Object.values(names).some((name) => String(name).trim())}
        venueDueCents={quote?.venueDueCents ?? null}
      />
    )
  }

  const totals = quote
    ? totalsFromQuote(quote)
    : totalsFromEstimate(estimate, undefined, paymentMethod)
  const until = hold ? heldUntil([hold]) : null
  const namesRefused = hasNameProblems(names, nameSlots)
  const onSale = (map.tiers ?? []).some((tier) => tier.onSale)
  const payable = Boolean(quote) && !quoting && !namesRefused

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-8">
      <section
        aria-labelledby="choose-seats"
        className="min-w-0 rounded-card bg-surface-raised p-5 shadow-card sm:p-8"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="choose-seats" className="text-h2 font-semibold text-ink">
            Choose your seats
          </h2>
          <a
            href="#your-selection"
            className="rounded-sm text-sm font-bold text-accent-strong underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          >
            Skip to your selection
          </a>
        </div>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {perOrderSentence(map.tiers ?? [], limit)} Choosing a wheelchair space also chooses its
          companion seat, and the other way round.
        </p>

        {!onSale ? (
          <Alert variant="info" title="These seats are not on sale now" className="mt-5">
            The map shows the seats and their prices; none of them can be reserved at the moment.
          </Alert>
        ) : null}

        <div className="mt-6">
          <SeatPicker map={map} selected={selected} onToggle={onToggle} disabled={busy} />
        </div>
      </section>

      <section
        id="your-selection"
        aria-labelledby="selection-heading"
        tabIndex={-1}
        className="overflow-hidden rounded-card bg-surface-raised shadow-card focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus lg:sticky lg:top-28"
      >
        <div className="px-5 pt-6 pb-5 sm:px-8">
          <h2
            id="selection-heading"
            ref={summaryHeadingRef}
            tabIndex={-1}
            className="rounded-sm text-h3 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          >
            Your selection
          </h2>
          <p role="status" aria-live="polite" className="mt-1 min-h-5 text-sm text-ink-muted">
            {announcement}
          </p>

          {selected.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No seats chosen.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Chosen seats">
              {selected.map((seatId) => {
                const seat = seatsById.get(seatId)

                return (
                  <li
                    key={seatId}
                    className="rounded-full bg-surface-subtle px-3 py-1 text-sm font-semibold text-ink"
                  >
                    {seat
                      ? `${seat.sectionName}${seat.rowLabel ? `, row ${seat.rowLabel}` : ''}, seat ${seat.label}`
                      : 'Seat'}
                  </li>
                )
              })}
            </ul>
          )}

          <OrderSummary
            totals={totals}
            place={place}
            promoCode={quote?.promo?.applied ? quote.promo.code : null}
            salesTaxUncalculated={place.country === 'US' && estimate.taxPolicy?.rateBps === 0}
          />

          {selected.length > 0 && venueOffered ? (
            <div className="mt-5 border-t border-line pt-5">
              <PaymentMethodChoice
                value={paymentMethod}
                onChange={choosePaymentMethod}
                place={place}
                disabled={status === 'paying' || status === 'reserving' || quoting || unsettled}
              />
            </div>
          ) : null}

          {holding ? (
            <Alert variant="success" title="Seats held" className="mt-5">
              {until ? `Held for you until ${until}.` : 'Held for you for a limited time.'} Payment
              on this site is simulated: you will not be asked for a card, and no money moves.
            </Alert>
          ) : null}

          {holding && buyer ? (
            <div className="mt-5 border-t border-line pt-5">
              <AttendeeNames
                slots={nameSlots}
                values={names}
                onChange={(key, value) => setNames((current) => ({ ...current, [key]: value }))}
                buyerName={buyer.name}
                disabled={status === 'paying'}
              />
            </div>
          ) : null}

          {selected.length > 0 ? (
            <div className="mt-5 border-t border-line pt-5">
              <PromoCodeField
                promo={promoOutcome}
                currency={currency}
                onApply={async (code) => {
                  setRefusal(null)
                  if (hold) {
                    await refreshQuote(hold, code, {
                      method: paymentMethod,
                      referralTry: referralCode,
                    })
                  } else {
                    // Seats cannot be priced until they are held, so the code
                    // is kept and checked with the first quote — and said to
                    // be exactly that, not to have taken.
                    setPromoCode(code)
                    setPromoOutcome({ code, applied: false, pending: true, unchecked: true })
                  }
                }}
                onRemove={() => {
                  setPromoCode(null)
                  setPromoOutcome(null)
                  if (hold) {
                    void refreshQuote(hold, null, {
                      method: paymentMethod,
                      referralTry: referralCode,
                    })
                  }
                }}
                busy={quoting}
                disabled={status === 'paying' || status === 'reserving' || unsettled}
                disabledReason={buyer ? null : 'You can use a promo code after signing in.'}
                reserveNoun="seats"
              />
            </div>
          ) : null}

          {selected.length > 0 ? (
            <div className="mt-5 border-t border-line pt-5">
              <ReferralCodeField
                key={referralBox}
                referral={referral}
                onApply={applyReferral}
                onRemove={removeReferral}
                busy={quoting}
                disabled={status === 'paying' || status === 'reserving' || unsettled}
                signedOut={!buyer}
                reserveNoun="seats"
              />
            </div>
          ) : null}

          {lostSeats.length > 0 ? (
            <Alert variant="warning" title="A seat went" className="mt-5">
              {lostSeats.length === 1
                ? `Seat ${lostSeats[0]} was taken by somebody else while you were choosing.`
                : `Seats ${lostSeats.join(' and ')} were taken by somebody else while you were choosing.`}{' '}
              Nothing was reserved or charged. Choose again from the seats still open.
            </Alert>
          ) : status === 'reserve-failed' && refusal ? (
            <Alert variant="warning" title="Nothing was reserved" className="mt-5">
              {refusal.state === 'network'
                ? 'We could not reach the ticketing service. Nothing has been reserved and you have not been charged.'
                : refusal.detail}
            </Alert>
          ) : null}

          {status === 'expired' && refusal ? (
            refusal.code === 'ORDER_CANCELLED' ? (
              <Alert variant="warning" title="The order was cancelled" className="mt-5">
                {refusal.detail}
              </Alert>
            ) : (
              <Alert variant="warning" title="The hold ran out" className="mt-5">
                The hold on these seats ran out or one of them went. Nothing was charged. Choose
                your seats again to carry on.
              </Alert>
            )
          ) : null}

          {holding && quoteFailure && !quoting ? (
            <Alert variant="warning" title="We could not get the total" className="mt-5">
              {quoteFailure.refusal.state === 'network'
                ? 'The ticketing service did not answer. Your seats are still held, and nothing has been charged.'
                : quoteFailure.refusal.detail}{' '}
              You can pay once the ticketing service has priced these seats.
              <span className="mt-3 block">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void refreshQuote(hold, quoteFailure.code, {
                      method: quoteFailure.method,
                      referralTry: quoteFailure.referralTry,
                    })
                  }
                >
                  Ask for the total again
                </Button>
              </span>
            </Alert>
          ) : null}

          {notice ? (
            <div ref={noticeRef} tabIndex={-1} className="mt-5 focus-visible:outline-none">
              <Alert variant="warning" title={notice.title} urgent={notice.urgent}>
                {notice.sentence}
              </Alert>
            </div>
          ) : null}

          {status === 'pay-failed' && refusal ? (
            <Alert
              variant="warning"
              title={
                refusal.state === 'payment-declined' ? refusal.title : 'The order was not placed'
              }
              className="mt-5"
            >
              {refusal.state === 'network'
                ? 'The service did not answer. Trying again is safe: the same attempt cannot book twice, and nothing is charged in this build.'
                : refusal.detail}
            </Alert>
          ) : null}

          {unsettled && refusal ? (
            <UnsettledPayment refusal={refusal} focusRef={unsettledRef} />
          ) : null}

          <div className="mt-6 flex flex-col items-stretch gap-3">
            {buyer === null ? (
              <>
                <Link href={signInHref} className={PRIMARY_LINK}>
                  Sign in to reserve
                </Link>
                <p className="text-xs text-ink-muted">
                  Tickets are kept in your account; receipts are not emailed. So reserving needs an
                  account: signing in brings you back to this map.
                </p>
              </>
            ) : holding || unsettled ? (
              <Button
                fullWidth
                size="lg"
                className="min-h-14 text-[1.0625rem]"
                loading={status === 'paying'}
                disabled={!payable || unsettled}
                onClick={handlePay}
              >
                {payButtonLabel(quote)}
              </Button>
            ) : (
              <Button
                fullWidth
                size="lg"
                className="min-h-14 text-[1.0625rem]"
                disabled={selected.length === 0 || !onSale || shortfalls.length > 0}
                loading={status === 'reserving'}
                onClick={handleReserve}
              >
                {selected.length === 0
                  ? 'Choose seats to continue'
                  : `Reserve ${selected.length} ${selected.length === 1 ? 'seat' : 'seats'}`}
              </Button>
            )}
            {holding && namesRefused ? (
              <p className="text-xs text-status-danger">
                One of the names needs changing before you can pay.
              </p>
            ) : null}
            {!holding && shortfalls.length > 0 ? (
              <ul className="space-y-1 text-xs text-status-danger">
                {shortfalls.map(({ tier, count, minimum }) => (
                  <li key={tier.id}>
                    Seats sold as “{tier.name}” are sold at least {minimum} at a time, and you have
                    chosen {count}. Choose {minimum - count} more of them, or none.
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
