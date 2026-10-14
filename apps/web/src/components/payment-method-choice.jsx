'use client'

/**
 * How a buyer pays: by card now, or the ticket price at the door (SPEC3 §12.1,
 * SPEC3-XI §12.1).
 *
 * Two native radios in a `<fieldset>`, each with its hint joined by
 * `aria-describedby`, so a screen reader hears what each way costs before it
 * is chosen. The checkout draws this only while paying at the venue is offered
 * for the basket — the latest quote says so (or the event, before anything is
 * held) and the ticket price after any promo is above 0 — and keeps the choice
 * in its own state: nothing here is stored or put in the address.
 *
 * Nothing here decides a price. Changing the choice asks the server for a new
 * quote, and the summary shows what it answers.
 *
 * @module components/payment-method-choice
 */

import { useId } from 'react'

import { AT_VENUE, CARD } from '../lib/checkout-api.js'
import { taxNameInSentence } from '../lib/pricing.js'

/** The legend of the choice. */
export const PAYMENT_CHOICE_LEGEND = 'How do you want to pay?'

/** The card option's hint. */
export const CARD_HINT = 'The tickets, the booking fee and any tax, paid now (simulated).'

/**
 * The pay-at-the-venue option's hint (SPEC3-XI §12.1), with the place's tax
 * named as a sentence names it ("sales tax", "HST").
 *
 * @param {object} [place] Where the event is held: `{ country, region }`.
 * @returns {string} The hint.
 */
export function venueHint(place = {}) {
  return `Pay the booking fee now (simulated) and the ticket price at the door. No ${taxNameInSentence(place)} is added to tickets paid at the venue. Until a ticket is paid for, the organiser or The Desi Events can cancel it, and the booking fee is not refunded if they do. If you pass a ticket on, whoever holds it pays at the door.`
}

/**
 * @typedef {object} PaymentMethodChoiceProps
 * @property {'CARD'|'AT_VENUE'} value The chosen way.
 * @property {function('CARD'|'AT_VENUE'): void} onChange Called with the new way.
 * @property {{country?: string|null, region?: string|null}} [place] Where the event is held, for the tax's name.
 * @property {boolean} [disabled] Whether the choice can be changed now.
 */

/**
 * The choice.
 *
 * @param {PaymentMethodChoiceProps} props Component props.
 * @returns {JSX.Element} The fieldset.
 */
export function PaymentMethodChoice({ value, onChange, place = {}, disabled = false }) {
  const id = useId()
  const options = [
    { method: CARD, label: 'Pay by card now', hint: CARD_HINT },
    { method: AT_VENUE, label: 'Pay at the venue', hint: venueHint(place) },
  ]

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-bold text-ink">{PAYMENT_CHOICE_LEGEND}</legend>
      {options.map((option) => {
        const hintId = `${id}-${option.method}-hint`

        return (
          <div key={option.method} className="flex items-start gap-3">
            <input
              id={`${id}-${option.method}`}
              type="radio"
              name={`${id}-payment-method`}
              value={option.method}
              checked={value === option.method}
              onChange={() => onChange(option.method)}
              aria-describedby={hintId}
              className="mt-0.5 size-6 shrink-0 accent-action-primary"
            />
            <div className="min-w-0">
              <label
                htmlFor={`${id}-${option.method}`}
                className="block min-h-6 text-sm font-semibold text-ink"
              >
                {option.label}
              </label>
              <p id={hintId} className="mt-0.5 text-sm text-ink-muted">
                {option.hint}
              </p>
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}
