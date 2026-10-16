'use client'

/**
 * A description box with a little formatting, and a preview of what it makes.
 *
 * The text stays plain text with a few marks — `**bold**`, `*italic*`, `- ` for
 * a list, `[label](https://…)` for a link — because that is what the server
 * stores and what `RichText` renders, without HTML anywhere on the way. The
 * toolbar buttons only type those marks around the selection, and keep focus
 * and the selection in the box so a keyboard user carries on typing.
 *
 * The preview is the same `RichText` the public page uses, so what is shown
 * here is what is published.
 *
 * @module components/rich-text-field
 */

import { useRef, useState } from 'react'

import { RichText } from './rich-text.jsx'
import { Button, FormField, Textarea } from './ui.jsx'
import { DESCRIPTION_LIMIT } from '../lib/event-content.js'

/**
 * Wrap or prefix the selection of a textarea.
 *
 * @param {string} value The box's text.
 * @param {number} start The selection start.
 * @param {number} end The selection end.
 * @param {'bold'|'italic'|'list'|'link'} kind What to apply.
 * @returns {{value: string, start: number, end: number}} The new text and selection.
 */
export function applyFormat(value, start, end, kind) {
  const selected = value.slice(start, end)
  const before = value.slice(0, start)
  const after = value.slice(end)

  if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '*'
    const inner = selected || (kind === 'bold' ? 'bold text' : 'italic text')

    return {
      value: `${before}${mark}${inner}${mark}${after}`,
      start: start + mark.length,
      end: start + mark.length + inner.length,
    }
  }

  if (kind === 'link') {
    const label = selected || 'link text'
    const text = `[${label}](https://)`

    // Select the address part, which is what somebody types next.
    return {
      value: `${before}${text}${after}`,
      start: start + label.length + 3,
      end: start + text.length - 1,
    }
  }

  // A list: every selected line becomes an item. With no selection, the line
  // the cursor is on does.
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const listed = lines.map((line) => (/^[-*] /u.test(line) ? line : `- ${line}`)).join('\n')

  return {
    value: `${value.slice(0, lineStart)}${listed}${value.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + listed.length,
  }
}

/** The toolbar's buttons. */
const TOOLS = Object.freeze([
  { kind: 'bold', label: 'Bold' },
  { kind: 'italic', label: 'Italic' },
  { kind: 'list', label: 'Bulleted list' },
  { kind: 'link', label: 'Link' },
])

/**
 * @typedef {object} RichTextFieldProps
 * @property {string} label The label.
 * @property {string} id The textarea's id.
 * @property {string} value The text.
 * @property {Function} onChange Called with the new text.
 * @property {boolean} [disabled] Whether the box is read-only.
 * @property {boolean} [required] Whether it is required.
 * @property {string} [error] A problem to show under the box.
 * @property {number} [max] The most characters.
 */

/**
 * The field.
 *
 * @param {RichTextFieldProps} props Component props.
 * @returns {JSX.Element} The field.
 */
export function RichTextField({
  label,
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  error = null,
  max = DESCRIPTION_LIMIT,
}) {
  const box = useRef(null)
  const [preview, setPreview] = useState(false)
  const length = value.length
  const over = length > max

  /**
   * Apply one tool to the selection, keeping focus in the box.
   *
   * @param {'bold'|'italic'|'list'|'link'} kind The tool.
   * @returns {void}
   */
  function format(kind) {
    const textarea = box.current

    if (!textarea) return

    const next = applyFormat(value, textarea.selectionStart, textarea.selectionEnd, kind)

    onChange(next.value)
    // After React has written the new value, put the selection back.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(next.start, next.end)
    })
  }

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label={`Formatting for ${label.toLowerCase()}`}
        aria-controls={id}
        className="flex flex-wrap gap-2"
      >
        {TOOLS.map((tool) => (
          <Button
            key={tool.kind}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || preview}
            // Keep the selection: a mouse press would otherwise move focus
            // to the button and the textarea would forget what was selected.
            onMouseDown={(press) => press.preventDefault()}
            onClick={() => format(tool.kind)}
          >
            {tool.label}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={preview}
          onClick={() => setPreview((current) => !current)}
        >
          {preview ? 'Back to editing' : 'Preview'}
        </Button>
      </div>

      {preview ? (
        <div
          aria-label={`Preview of the ${label.toLowerCase()}`}
          role="region"
          className="min-h-24 rounded-control border border-line bg-surface-subtle p-3 text-ink"
        >
          {value.trim() ? (
            <RichText text={value} />
          ) : (
            <p className="text-ink-muted">Nothing written.</p>
          )}
        </div>
      ) : null}

      <div className={preview ? 'hidden' : undefined}>
        <FormField
          label={label}
          id={id}
          required={required}
          description={`${length.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} characters`}
          {...(error
            ? { error }
            : over
              ? { error: `That is ${(length - max).toLocaleString('en-US')} characters too long.` }
              : {})}
        >
          <Textarea
            ref={box}
            rows={10}
            value={value}
            disabled={disabled}
            onChange={(change) => onChange(change.target.value)}
          />
        </FormField>
      </div>

      <details className="text-sm text-ink-muted">
        <summary className="cursor-pointer rounded-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus">
          How formatting works
        </summary>
        <ul className="mt-2 list-disc space-y-1 ps-6">
          <li>A blank line starts a new paragraph.</li>
          <li>
            <code>**bold**</code> and <code>*italic*</code>.
          </li>
          <li>
            A line starting with <code>- </code> is a bullet point.
          </li>
          <li>
            <code>[label](https://example.com)</code> is a link. Only https addresses become links;
            anything else is shown as typed.
          </li>
        </ul>
      </details>
    </div>
  )
}
