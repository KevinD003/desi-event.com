'use client'

/**
 * A promo code box for checkout: type a code, apply it, see what it did.
 *
 * The server decides everything. Applying a code asks for a quote with it, and
 * the quote says whether it took and, when it did not, why — in a sentence the
 * buyer can act on ("That code has ended."), never a count of how many uses are
 * left or anything else that invents urgency.
 *
 * The code lives in component state and in the request body, and nowhere
 * else: not in the URL, not in storage, not in a log.
 *
 * @module components/promo-code-field
 */

import { useId, useState } from 'react'

import {
  PROMO_CODE_MAX_LENGTH,
  appliedCopy,
  isPromoCodeShape,
  normalisePromoCode,
  reasonCopy,
} from '../lib/promo.js'
import { Button } from './ui.jsx'

/**
 * @typedef {object} PromoCodeFieldProps
 * @property {object|null} promo The latest quote's `promo`, or null when no code is in play; `pending` when a code waits for the next quote, and `unchecked` too when it has never been checked.
 * @property {string} currency The order's currency, for a fixed amount.
 * @property {string} [reserveNoun] What reserving holds, for the waiting copy: `tickets` or `seats`.
 * @property {function(string): Promise<void>} onApply Quote with this code.
 * @property {function(): void} onRemove Quote without a code.
 * @property {boolean} [disabled] Whether the box can be used now.
 * @property {string|null} [disabledReason] Why not, in a sentence, shown instead of the box.
 * @property {boolean} [busy] Whether a quote is being asked for.
 */

/**
 * The box, its buttons and a polite status beside it.
 *
 * @param {PromoCodeFieldProps} props Component props.
 * @returns {JSX.Element} The field.
 */
export function PromoCodeField({
  promo,
  currency,
  onApply,
  onRemove,
  disabled = false,
  disabledReason = null,
  busy = false,
  reserveNoun = 'tickets',
}) {
  const [draft, setDraft] = useState('')
  const [shapeError, setShapeError] = useState(null)
  const id = useId()
  const inputId = `${id}-code`
  const statusId = `${id}-status`

  if (disabledReason) {
    return <p className="text-sm text-ink-muted">{disabledReason}</p>
  }

  const applied = Boolean(promo?.applied)
  // Chosen, and waiting for the next quote: shown as chosen, with Remove, but
  // never said to have taken when the server has not said so.
  const chosen = applied || Boolean(promo?.pending)
  const outcome = promo
    ? promo.unchecked
      ? `${promo.code} is checked when you reserve your ${reserveNoun}. Until then the total above does not include it.`
      : promo.pending
        ? `${promo.code} is checked again when you reserve your ${reserveNoun}.`
        : applied
          ? appliedCopy(promo, currency)
          : reasonCopy(promo.reason)
    : (shapeError ?? '')

  /**
   * Apply what was typed.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the quote has answered.
   */
  async function apply(submitted) {
    submitted.preventDefault()

    const code = normalisePromoCode(draft)

    if (!isPromoCodeShape(code)) {
      setShapeError(
        'A code is 3 to 32 letters, numbers, hyphens or underscores. Check it and try again.',
      )
      return
    }

    setShapeError(null)
    await onApply(code)
  }

  return (
    <form onSubmit={apply} noValidate>
      <label htmlFor={inputId} className="block text-sm font-bold text-ink">
        Promo code
      </label>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <input
            id={inputId}
            name="promoCode"
            type="text"
            value={chosen ? promo.code : draft}
            onChange={(changed) => setDraft(changed.target.value)}
            maxLength={PROMO_CODE_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            readOnly={chosen}
            disabled={disabled}
            aria-describedby={statusId}
            className="min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 font-mono text-ink uppercase focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-60"
          />
        </div>
        {chosen ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onRemove()}>
            Remove
          </Button>
        ) : (
          <Button type="submit" variant="secondary" disabled={disabled || busy} loading={busy}>
            Apply
          </Button>
        )}
      </div>
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={`mt-2 min-h-5 text-sm ${applied ? 'text-status-success' : 'text-ink-muted'}`}
      >
        {outcome}
      </p>
    </form>
  )
}
