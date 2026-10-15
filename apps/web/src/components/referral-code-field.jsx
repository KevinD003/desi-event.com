'use client'

/**
 * A referral code box for checkout: a code from the team at The Desi Events
 * that removes the booking fee from this booking (SPEC3 §12.1, §8.2).
 *
 * The server decides everything, and says only whether the code was applied:
 * an unknown code, an expired one, one used up or one for other events all
 * read "This referral code can't be used for this booking.", one sentence for
 * every cause, so the box tells a guesser nothing about which codes exist.
 *
 * ## Where the code is, and where it never is
 *
 * In this component's state while it is typed, in the checkout's state once it
 * is applied, and in the bodies of the quote and the order — and nowhere else:
 * never in the address, `localStorage`, `sessionStorage`, a cookie, a log or an
 * analytics event. The box is separate from the promo code's: they are
 * different things from different people.
 *
 * ## Names
 *
 * Its buttons read "Apply" and "Remove", as the promo code's do, and are named
 * "Apply referral code" and "Remove referral code" for a screen reader, the
 * visible word first (WCAG 2.5.3), so the two boxes' buttons are told apart.
 *
 * ## Focus
 *
 * A code that is not accepted puts focus back in the box, with the sentence
 * joined to it by `aria-describedby`, so the buyer can correct it at once.
 * Removing a code empties the box and puts focus in it.
 *
 * @module components/referral-code-field
 */

import { useEffect, useId, useRef, useState } from 'react'

import { Button } from './ui.jsx'

/** The longest code a buyer may send (`referralCodeEntrySchema`). */
export const REFERRAL_ENTRY_MAX_LENGTH = 64

/** What each state of the box says (SPEC3 §12.1). */
export const REFERRAL_FIELD_COPY = Object.freeze({
  label: 'Referral code (optional)',
  hint: 'From the team at The Desi Events. It removes the booking fee, not the ticket price.',
  applied: 'Booking fee removed with your referral code.',
  notAccepted: 'This referral code can’t be used for this booking.',
  nothingToWaive: 'There’s no booking fee on this booking, so no referral code is needed.',
  rateLimited: 'Too many referral codes were tried. Wait a few minutes, then try again.',
  signedOut: 'You can use a referral code after signing in.',
})

/**
 * What the box says about a code waiting to be checked.
 *
 * @param {'unchecked'|'pending'} status Never checked, or checked before and waiting again.
 * @param {string} reserveNoun What reserving holds: `tickets` or `seats`.
 * @returns {string} The sentence.
 */
export function waitingCopy(status, reserveNoun = 'tickets') {
  return status === 'unchecked'
    ? `Your referral code is checked when you reserve your ${reserveNoun}. Until then the total above includes the booking fee.`
    : `Your referral code is checked again when you reserve your ${reserveNoun}.`
}

/**
 * @typedef {object} ReferralState
 * @property {'unchecked'|'pending'|'applied'|'NOT_ACCEPTED'|'NOTHING_TO_WAIVE'|'rate-limited'} status Where the code stands.
 * @property {string|null} [code] The code chosen, while it is chosen (unchecked, pending, applied).
 */

/**
 * @typedef {object} ReferralCodeFieldProps
 * @property {ReferralState|null} referral Where the code stands, or null when none is in play.
 * @property {function(string): (Promise<void>|void)} onApply Use this code.
 * @property {function(): void} onRemove Stop using the code.
 * @property {boolean} [disabled] Whether the box can be used now.
 * @property {boolean} [signedOut] Whether the buyer is signed out: the box is shown disabled, and says why.
 * @property {boolean} [busy] Whether a quote is being asked for.
 * @property {string} [reserveNoun] What reserving holds: `tickets` or `seats`.
 */

/**
 * The box, its button and a polite status beside it.
 *
 * @param {ReferralCodeFieldProps} props Component props.
 * @returns {JSX.Element} The field.
 */
export function ReferralCodeField({
  referral,
  onApply,
  onRemove,
  disabled = false,
  signedOut = false,
  busy = false,
  reserveNoun = 'tickets',
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  // Set when the buyer's own action should end with focus in the box: a code
  // refused, or a code removed. Taken by the effect after the render that
  // draws the box again, so the focus lands on what is on screen.
  const wantsFocus = useRef(false)
  const id = useId()
  const inputId = `${id}-referral`
  const hintId = `${id}-referral-hint`
  const statusId = `${id}-referral-status`

  const status = referral?.status ?? null
  const chosen = status === 'unchecked' || status === 'pending' || status === 'applied'
  const refused = status === 'NOT_ACCEPTED' || status === 'rate-limited'

  useEffect(() => {
    if (status === 'NOT_ACCEPTED' || status === 'rate-limited') wantsFocus.current = true
  }, [referral, status])

  useEffect(() => {
    if (!wantsFocus.current) return

    wantsFocus.current = false
    inputRef.current?.focus()
  })

  const message = signedOut
    ? REFERRAL_FIELD_COPY.signedOut
    : status === 'unchecked' || status === 'pending'
      ? waitingCopy(status, reserveNoun)
      : status === 'applied'
        ? REFERRAL_FIELD_COPY.applied
        : status === 'NOT_ACCEPTED'
          ? REFERRAL_FIELD_COPY.notAccepted
          : status === 'NOTHING_TO_WAIVE'
            ? REFERRAL_FIELD_COPY.nothingToWaive
            : status === 'rate-limited'
              ? REFERRAL_FIELD_COPY.rateLimited
              : ''

  /**
   * Use what was typed.
   *
   * @param {object} submitted The submit event.
   * @returns {Promise<void>} Resolves once the checkout has dealt with it.
   */
  async function apply(submitted) {
    submitted.preventDefault()

    const code = draft.trim()

    if (!code) return

    await onApply(code)
  }

  /**
   * Stop using the code, empty the box and put focus in it.
   *
   * @returns {void}
   */
  function remove() {
    setDraft('')
    wantsFocus.current = true
    onRemove()
  }

  const inactive = disabled || signedOut

  return (
    <form onSubmit={apply} noValidate>
      <label htmlFor={inputId} className="block text-sm font-bold text-ink">
        {REFERRAL_FIELD_COPY.label}
      </label>
      <p id={hintId} className="mt-1 text-sm text-ink-muted">
        {REFERRAL_FIELD_COPY.hint}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            id={inputId}
            name="referralCode"
            type="text"
            value={chosen ? (referral?.code ?? draft) : draft}
            onChange={(changed) => setDraft(changed.target.value)}
            maxLength={REFERRAL_ENTRY_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            readOnly={chosen}
            disabled={inactive}
            aria-invalid={refused ? 'true' : undefined}
            aria-describedby={message ? `${hintId} ${statusId}` : hintId}
            className="min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 font-mono text-ink uppercase focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-60"
          />
        </div>
        {chosen ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || disabled}
            onClick={remove}
            aria-label="Remove referral code"
          >
            Remove
          </Button>
        ) : (
          <Button
            type="submit"
            variant="secondary"
            disabled={inactive || busy || draft.trim() === ''}
            loading={busy}
            aria-label="Apply referral code"
          >
            Apply
          </Button>
        )}
      </div>
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={`mt-2 min-h-5 text-sm ${
          status === 'applied'
            ? 'text-status-success'
            : refused
              ? 'font-medium text-status-danger'
              : 'text-ink-muted'
        }`}
      >
        {message}
      </p>
    </form>
  )
}
