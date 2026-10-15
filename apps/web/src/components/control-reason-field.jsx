'use client'

/**
 * The reason box every full-control action asks for: deleting, restoring,
 * cancelling a night and opening an editing session as the team at
 * The Desi Events.
 *
 * One box, so each says the same thing about where the reason goes and who
 * reads it (SPEC2-XI §0.8), counts against the same limits the server checks,
 * and is labelled and described the same way.
 *
 * @module components/control-reason-field
 */

import { FormField, Textarea } from './ui.jsx'
import { REASON_DESCRIPTION, REASON_LIMITS } from '../lib/event-control.js'

/**
 * @typedef {object} ControlReasonFieldProps
 * @property {string} id The textarea's id, which an error summary links to.
 * @property {string} label What the box asks.
 * @property {string} value What is typed.
 * @property {Function} onChange Given the new text.
 * @property {string|null} [error] What is wrong with it, shown under the box.
 * @property {boolean} [disabled] Whether it takes input.
 * @property {object} [inputRef] A ref to the textarea, to move focus to it.
 */

/**
 * The box.
 *
 * @param {ControlReasonFieldProps} props Component props.
 * @returns {JSX.Element} The field.
 */
export function ControlReasonField({
  id,
  label,
  value,
  onChange,
  error = null,
  disabled = false,
  inputRef,
}) {
  const used = value.trim().length

  return (
    <FormField
      label={label}
      id={id}
      required
      description={`${REASON_DESCRIPTION} ${used.toLocaleString('en-US')} of ${REASON_LIMITS.max.toLocaleString('en-US')} characters; at least ${REASON_LIMITS.min.toLocaleString('en-US')}.`}
      {...(error ? { error } : {})}
    >
      <Textarea
        ref={inputRef}
        rows={3}
        maxLength={REASON_LIMITS.max + 50}
        value={value}
        disabled={disabled}
        onChange={(change) => onChange(change.target.value)}
      />
    </FormField>
  )
}
