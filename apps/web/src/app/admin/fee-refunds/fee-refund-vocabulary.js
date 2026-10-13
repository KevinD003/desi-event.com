/**
 * What the booking-fee refund page says (SPEC3 §12.6, SPEC3-XI §12.6).
 *
 * Pure, so the server page, the client form and their tests read the same
 * sentences.
 *
 * @module app/admin/fee-refunds/fee-refund-vocabulary
 */

import { formatAmount } from '../../../lib/pricing.js'

/** What the page says first. */
export const INTRODUCTION =
  'Refund the booking fee of one order. This refunds only the booking fee and any tax on it. It does not refund the ticket price, does not cancel the tickets and does not change the order’s status.'

/** What a session without `platform_fee:refund` is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Booking fees are refunded by hand by the Desi-Event team’s platform, finance and super administrators. Nothing on this page can grant it.'

/**
 * What a reference that is not in the form references take is told: the
 * finance refunds page's sentence, without its clause about narrowing a list.
 */
export const MALFORMED_REFERENCE =
  'That order reference is not in the form references take — letters, digits and dashes, 4 to 32 of them.'

/** What a reference no order has is told. */
export const NO_SUCH_ORDER = 'No order has that reference.'

/** The note on a disputed payment. */
export const DISPUTED_NOTE = 'This payment is disputed, so its fee can’t be refunded here.'

/** The shape of an order reference, once trimmed and upper-cased. */
export const ORDER_REFERENCE = /^[A-Z0-9-]{4,32}$/u

/** How an order was paid, in words. */
export const PAYMENT_METHOD_WORDS = Object.freeze({ CARD: 'Card', AT_VENUE: 'At the venue' })

/**
 * A reference as typed, ready for the path, or null when it is not one.
 *
 * @param {string} typed What was typed.
 * @returns {string|null} The reference, trimmed and upper-cased, or null.
 */
export function readReference(typed) {
  const reference = String(typed ?? '')
    .trim()
    .toUpperCase()

  return ORDER_REFERENCE.test(reference) ? reference : null
}

/**
 * The part of the fee kept when unpaid tickets were cancelled (SPEC3-XI
 * §12.6), or null when none was.
 *
 * @param {{feeKeptCents: number, currency: string}} preview The preview.
 * @returns {string|null} The sentence, or null.
 */
export function keptSentence(preview) {
  if (!(preview.feeKeptCents > 0)) return null

  return `Kept when unpaid tickets were cancelled: ${formatAmount(preview.feeKeptCents, preview.currency)}. It can’t be refunded.`
}

/**
 * What a refund of this order's booking fee would give back now: the fee left
 * and the tax charged on it, together.
 *
 * The preview names the two apart (`refundableFeeCents`, `taxOnFeeCents`, as
 * SPEC3 §7.4 lists them), and the refund gives back both and compares the
 * administrator's figure with both (`expectedRefundableCents`; anything else
 * is refused `PRICE_CHANGED`). So the amount shown, the button and the figure
 * sent are this sum, never the fee alone: on an order whose fee carried tax
 * the fee alone is both the wrong amount and a refund that can never go
 * through.
 *
 * @param {{refundableFeeCents: number, taxOnFeeCents?: number}} preview The preview.
 * @returns {number} Integer cents.
 */
export function refundableCents(preview) {
  return (preview?.refundableFeeCents ?? 0) + (preview?.taxOnFeeCents ?? 0)
}

/**
 * The refund button's words.
 *
 * @param {{refundableFeeCents: number, taxOnFeeCents?: number, currency: string}} preview The preview.
 * @returns {string} "Refund $3.35 booking fee (simulated)".
 */
export function refundButtonLabel(preview) {
  return `Refund ${formatAmount(refundableCents(preview), preview.currency)} booking fee (simulated)`
}

/**
 * What a refund that went through says.
 *
 * @param {number} cents What was refunded.
 * @param {string} currency The order's currency.
 * @returns {string} "Booking fee refunded (simulated): $3.35."
 */
export function refundedSentence(cents, currency) {
  return `Booking fee refunded (simulated): ${formatAmount(cents, currency)}.`
}

/** The heading of a refund that did not go through. */
export const NOT_REFUNDED_TITLE = 'The booking fee was not refunded'

/** The heading of a refund whose outcome the payment provider has not given. */
export const UNSETTLED_TITLE = 'The booking fee refund has not settled'

/**
 * What became of a refund that was sent, from its status as the API recorded
 * it.
 *
 * `platformFees.refund` answers 200 whatever the payment provider said: the
 * refund is recorded either way, and its `status` is the outcome. Only
 * `SUCCEEDED` is a refund; the success sentence is never said for anything
 * else. A refund refused or failed gave nothing back and set nothing aside,
 * so the fee can be refunded again (`DECLINED`, `FAILED`; `CANCELLED` was never
 * sent). A refund the provider has not answered for keeps the fee set aside
 * while it is established whether it went (`TIMEOUT` and
 * `RECONCILIATION_REQUIRED` open an operations item; anything else is still
 * waiting on the provider). The provider is simulated in this build, and the
 * words say so.
 *
 * @param {{status?: string, amountCents?: number}|null|undefined} refund The refund in the answer.
 * @param {number} fallbackCents What was asked for, when the answer carried no amount.
 * @param {string} currency The order's currency.
 * @returns {{tone: 'success'|'error'|'warning', title: string|null, sentence: string}} What to say.
 */
export function refundOutcome(refund, fallbackCents, currency) {
  const status = refund?.status ?? null

  if (status === 'SUCCEEDED') {
    return {
      tone: 'success',
      title: null,
      sentence: refundedSentence(refund?.amountCents ?? fallbackCents, currency),
    }
  }

  if (status === 'DECLINED') {
    return {
      tone: 'error',
      title: NOT_REFUNDED_TITLE,
      sentence:
        'The payment provider (simulated) refused this refund, so nothing was refunded. The fee can be refunded again once the cause is fixed.',
    }
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    return {
      tone: 'error',
      title: NOT_REFUNDED_TITLE,
      sentence:
        'The refund did not go through to the payment provider (simulated), so nothing was refunded. The fee can be refunded again once the cause is fixed.',
    }
  }

  if (status === 'TIMEOUT' || status === 'RECONCILIATION_REQUIRED') {
    return {
      tone: 'warning',
      title: UNSETTLED_TITLE,
      sentence:
        'The payment provider (simulated) did not say whether the refund went through. An operations item is open to establish it, and the fee stays set aside for this refund until then.',
    }
  }

  return {
    tone: 'warning',
    title: UNSETTLED_TITLE,
    sentence:
      'The payment provider (simulated) has not said whether the refund went through. The fee stays set aside for this refund until it does.',
  }
}
