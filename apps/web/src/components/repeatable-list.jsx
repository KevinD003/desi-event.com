'use client'

/**
 * A list of rows somebody can add to, remove from and reorder.
 *
 * Each row is a `fieldset` whose legend numbers it, and every button says which
 * row it acts on — "Remove question 2", not a column of identical "Remove"s a
 * screen reader cannot tell apart. Reordering is two buttons rather than a drag
 * handle, because a drag handle is a mouse-only control. What changed is said
 * in a polite status, and focus follows the row that moved or was added.
 *
 * At the limit the Add button is replaced by a sentence saying so, instead of a
 * button that does nothing.
 *
 * @module components/repeatable-list
 */

import { useEffect, useRef, useState } from 'react'

import { Button } from './ui.jsx'

/**
 * @typedef {object} RepeatableListProps
 * @property {string} noun What one row is, in lower case: "question", "performer".
 * @property {string} title The list's heading.
 * @property {string} [description] A sentence under the heading.
 * @property {object[]} rows The rows.
 * @property {Function} onChange Called with the new rows.
 * @property {Function} blank Makes an empty row.
 * @property {Function} renderRow `(row, index, update)` → the row's fields; `update(patch)` changes it.
 * @property {number} max The most rows the list takes.
 * @property {boolean} [disabled] Whether the list is read-only.
 * @property {string} idPrefix Prefix for the list's ids.
 */

/**
 * The list.
 *
 * @param {RepeatableListProps} props Component props.
 * @returns {JSX.Element} The list.
 */
export function RepeatableList({
  noun,
  title,
  description = null,
  rows,
  onChange,
  blank,
  renderRow,
  max,
  disabled = false,
  idPrefix,
}) {
  const [status, setStatus] = useState('')
  const [focusRow, setFocusRow] = useState(null)
  const list = useRef(null)
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)

  useEffect(() => {
    if (focusRow === null) return

    const row = list.current?.querySelector(`[data-row="${focusRow}"]`)
    const target = row?.querySelector('input, textarea, select') ?? row

    target?.focus()
    setFocusRow(null)
  }, [focusRow])

  /**
   * Replace the rows and say what happened.
   *
   * @param {object[]} next The rows.
   * @param {string} message What changed.
   * @param {number|null} focus The row to move focus into.
   * @returns {void}
   */
  const change = (next, message, focus) => {
    onChange(next)
    setStatus(message)
    setFocusRow(focus)
  }

  /**
   * Change one row.
   *
   * @param {number} index The row.
   * @param {object} patch The changed fields.
   * @returns {void}
   */
  const update = (index, patch) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  /**
   * Swap a row with its neighbour.
   *
   * @param {number} index The row.
   * @param {-1|1} by Up or down.
   * @returns {void}
   */
  const move = (index, by) => {
    const next = [...rows]
    const [row] = next.splice(index, 1)

    next.splice(index + by, 0, row)
    change(
      next,
      `${Noun} ${index + 1} moved ${by < 0 ? 'up' : 'down'}; it is now ${noun} ${index + by + 1}.`,
      index + by,
    )
  }

  return (
    <fieldset id={idPrefix} className="space-y-3 rounded-card border border-line p-4">
      <legend className="px-1 text-base font-semibold text-ink">{title}</legend>
      {description ? <p className="text-sm text-ink-muted">{description}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">None added.</p>
      ) : (
        <ol ref={list} className="space-y-3">
          {rows.map((row, index) => (
            // Rows have no ids of their own; the position is what the legend
            // and the buttons name, so it is the honest key. The boxes are
            // controlled, so a removal re-renders every value from the rows.
            <li key={index} data-row={index} tabIndex={-1} className="focus-visible:outline-none">
              <fieldset
                id={`${idPrefix}-${index}`}
                className="space-y-3 rounded-card border border-line bg-surface-subtle p-3"
              >
                <legend className="px-1 text-sm font-medium text-ink">
                  {Noun} {index + 1}
                </legend>

                {renderRow(row, index, (patch) => update(index, patch))}

                {disabled ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      aria-label={`Move ${noun} ${index + 1} up`}
                      onClick={() => move(index, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === rows.length - 1}
                      aria-label={`Move ${noun} ${index + 1} down`}
                      onClick={() => move(index, 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${noun} ${index + 1}`}
                      onClick={() =>
                        change(
                          rows.filter((_, at) => at !== index),
                          `${Noun} ${index + 1} removed.`,
                          null,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </fieldset>
            </li>
          ))}
        </ol>
      )}

      {disabled ? null : rows.length >= max ? (
        <p className="text-sm text-ink-muted">
          That is the most this list takes ({max}). Remove one to add another.
        </p>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            change([...rows, blank()], `${Noun} ${rows.length + 1} added.`, rows.length)
          }
        >
          Add a {noun}
        </Button>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </fieldset>
  )
}
