'use client'

/**
 * Who is going: one optional name per ticket or seat.
 *
 * Every box is optional. A ticket nobody names carries the buyer's own name,
 * exactly as every ticket did before names could be given, and the hint says
 * so with the buyer's name in it. Blank boxes are dropped before the order is
 * sent, never sent as empty strings.
 *
 * A name is printed on the ticket and read out at the door, which masks email
 * addresses — so a box refuses an address here, before the server does, and
 * says why in words beside the box.
 *
 * @module components/attendee-names
 */

import { useId } from 'react'

/** The most characters a name may have; the server's own limit. */
export const ATTENDEE_NAME_MAX = 100

/** What the box says when an address was typed as a name. */
export const ADDRESS_AS_NAME = 'Type the guest’s name, not an email address.'

/**
 * Why a typed name will be refused, or null when it is fine (or blank).
 *
 * @param {string} value What was typed.
 * @returns {string|null} The problem, in a sentence.
 */
export function attendeeNameProblem(value) {
  const text = String(value ?? '').trim()

  if (text.length === 0) return null
  if (/\S+@\S+\.\S+/u.test(text)) return ADDRESS_AS_NAME
  // Control characters: a name cannot carry a line break or a tab.
  if (/\p{Cc}/u.test(text)) return 'A name cannot contain line breaks or tabs.'
  if (text.length > ATTENDEE_NAME_MAX) return `Keep a name to ${ATTENDEE_NAME_MAX} characters.`

  return null
}

/**
 * The names to send, blanks dropped.
 *
 * @param {Array<{key: string, ticketTypeId: string, eventSeatId?: string|null}>} slots The tickets.
 * @param {Record<string, string>} values What was typed, by slot key.
 * @returns {Array<{ticketTypeId: string, eventSeatId?: string, name: string}>} The attendees.
 */
export function attendeesFrom(slots, values) {
  return slots
    .map((slot) => ({ slot, name: String(values[slot.key] ?? '').trim() }))
    .filter(({ name }) => name.length > 0)
    .map(({ slot, name }) => ({
      ticketTypeId: slot.ticketTypeId,
      ...(slot.eventSeatId ? { eventSeatId: slot.eventSeatId } : {}),
      name,
    }))
}

/**
 * Whether any typed name will be refused.
 *
 * Given the tickets on screen, only their boxes count: a name typed for a seat
 * the buyer then dropped, or a ticket they took off the quantity, is neither
 * shown nor sent, so it must not hold up paying with no box to fix.
 *
 * @param {Record<string, string>} values What was typed, by slot key.
 * @param {Array<{key: string}>} [slots] The tickets on screen; every value counts without them.
 * @returns {boolean} True when one would be.
 */
export function hasNameProblems(values, slots) {
  const typed = values ?? {}
  const checked = slots ? slots.map((slot) => typed[slot.key]) : Object.values(typed)

  return checked.some((value) => attendeeNameProblem(value) !== null)
}

/**
 * @typedef {object} AttendeeSlot
 * @property {string} key A stable key.
 * @property {string} label What the box is for, e.g. `Ticket 2 of 3 — General admission, Night 2`.
 * @property {string} ticketTypeId The tier.
 * @property {string|null} [eventSeatId] The seat, for reserved seating.
 */

/**
 * The fieldset of names.
 *
 * @param {object} props Component props.
 * @param {AttendeeSlot[]} props.slots One per ticket or seat.
 * @param {Record<string, string>} props.values What was typed, by slot key.
 * @param {function(string, string): void} props.onChange Record a box's new value.
 * @param {string|null} [props.buyerName] The buyer, named in the hint.
 * @param {boolean} [props.disabled] Whether the boxes can be edited now.
 * @returns {JSX.Element|null} The fieldset, or nothing with no tickets.
 */
export function AttendeeNames({ slots, values, onChange, buyerName = null, disabled = false }) {
  const id = useId()

  if (slots.length === 0) return null

  const hint = buyerName
    ? `Leave a box blank to put your own name, ${buyerName}, on that ticket.`
    : 'Leave a box blank to put your own name on that ticket.'

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-bold text-ink">Who is going?</legend>
      <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
        {hint} Each name is printed on its ticket and shown at the door.
      </p>
      <ol className="mt-3 space-y-3">
        {slots.map((slot) => {
          const inputId = `${id}-${slot.key}`
          const problem = attendeeNameProblem(values[slot.key])
          const problemId = `${inputId}-problem`

          return (
            <li key={slot.key}>
              <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
                {slot.label}
              </label>
              <input
                id={inputId}
                type="text"
                value={values[slot.key] ?? ''}
                onChange={(changed) => onChange(slot.key, changed.target.value)}
                maxLength={ATTENDEE_NAME_MAX}
                autoComplete="off"
                disabled={disabled}
                aria-invalid={problem ? 'true' : undefined}
                aria-describedby={problem ? `${id}-hint ${problemId}` : `${id}-hint`}
                className="mt-1 min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:opacity-60 aria-invalid:border-status-danger"
              />
              {problem ? (
                <p id={problemId} className="mt-1 text-sm text-status-danger">
                  {problem}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </fieldset>
  )
}
