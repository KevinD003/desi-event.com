'use client'

/**
 * One page of referral codes, with "Find on this page" (SPEC3 §12.5,
 * SPEC3-XI §12.5).
 *
 * A code's text never goes in a web address, so the list cannot be searched by
 * it on the server; this filters the page already drawn, in the browser, by a
 * code's text or its label. When nothing on the page matches, "No code on this
 * page matches." is said once, politely.
 *
 * Every copy is said, the second as the first: the sentence is drawn afresh
 * each time, because a live region that is handed the words it already holds
 * changes nothing and says nothing. Typing in the finder forgets the last
 * copy, so clearing it does not say "Copied" again for nothing.
 *
 * The table becomes stacked cards below 640 px, so nothing scrolls sideways
 * at 320 px (WCAG 1.4.10); each card's cells keep their column's name, hidden
 * from screen readers, which read the table's own headers.
 *
 * @module app/admin/referral-codes/referral-code-list
 */

import Link from 'next/link'
import { useId, useState } from 'react'

import { Badge } from '../../../components/ui.jsx'
import { TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { formatInstantIn } from '../../../lib/format.js'
import { CopyCodeButton } from './copy-code-button.jsx'
import {
  NO_MATCH,
  REFERRAL_CODES_PATH,
  REFERRAL_EXPIRY_ZONE,
  STACKED_WIDE as STACKED,
  STATUS_WORDS,
  makerName,
  usesDetail,
  usesText,
  waivedText,
  worksForText,
} from './referral-vocabulary.js'

/**
 * Whether a code matches what was typed: its text or its label, ignoring case.
 *
 * @param {object} code The code.
 * @param {string} text What was typed.
 * @returns {boolean} Whether it matches.
 */
export function matchesFind(code, text) {
  const needle = text.trim().toLowerCase()

  if (!needle) return true

  return (
    code.referralCode.toLowerCase().includes(needle) ||
    (code.label ?? '').toLowerCase().includes(needle)
  )
}

/**
 * A cell with its column's name for the stacked cards.
 *
 * @param {object} props Component props.
 * @param {string} props.name The column's name.
 * @param {ReactNode} props.children The cell.
 * @param {string} [props.className] Extra classes.
 * @returns {JSX.Element} The cell.
 */
function Cell({ name, children, className = '' }) {
  return (
    <td className={`${STACKED.cell} ${className}`}>
      <span aria-hidden="true" className={STACKED.label}>
        {name}
      </span>
      <span className="min-w-0">{children}</span>
    </td>
  )
}

/**
 * @typedef {object} ReferralCodeListProps
 * @property {object[]} codes The page of codes.
 * @property {string} caption What the table is, for its caption.
 */

/**
 * The list.
 *
 * @param {ReferralCodeListProps} props Component props.
 * @returns {JSX.Element} The finder and the table.
 */
export function ReferralCodeList({ codes, caption }) {
  const id = useId()
  const [find, setFind] = useState('')
  // The words, and how many times they were said: each saying is a new node.
  const [copied, setCopied] = useState({ words: '', said: 0 })
  const shown = codes.filter((code) => matchesFind(code, find))
  const nothing = find.trim() !== '' && shown.length === 0

  return (
    <div className="mt-4 space-y-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-find`} className="text-sm font-medium text-ink">
          Find on this page
        </label>
        <p id={`${id}-find-hint`} className="text-sm text-ink-muted">
          By the code or its label. Only the codes on this page are searched.
        </p>
        <input
          id={`${id}-find`}
          type="search"
          value={find}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-find-hint`}
          onChange={(changed) => {
            setFind(changed.target.value)
            setCopied((last) => ({ words: '', said: last.said }))
          }}
          className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        />
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-ink">
        {nothing ? NO_MATCH : <span key={copied.said}>{copied.words}</span>}
      </p>

      {shown.length > 0 ? (
        <table className={STACKED.table}>
          <caption className="sr-only">{caption}</caption>
          <thead className={STACKED.thead}>
            <tr>
              {[
                'Code',
                'Label',
                'Works for',
                'Uses',
                'Booking fees waived',
                'Expires',
                'Status',
                'Made by',
                'Open',
              ].map((heading) => (
                <th key={heading} scope="col" className={STACKED.th}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={STACKED.tbody}>
            {shown.map((code) => {
              const status = STATUS_WORDS[code.status] ?? { label: code.status, tone: 'neutral' }
              const detail = usesDetail(code)

              return (
                <tr key={code.id} className={STACKED.row}>
                  {/* The text columns may break a long word anywhere: a table
                      column is never narrower than its longest unbreakable
                      word, and one long name or typed code would otherwise
                      push the nine columns past a 1024 px screen. */}
                  <Cell name="Code">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono wrap-anywhere text-ink">{code.referralCode}</span>
                      <CopyCodeButton
                        code={code}
                        onAnnounce={(words) =>
                          setCopied((last) => ({ words, said: last.said + 1 }))
                        }
                      />
                    </span>
                  </Cell>
                  <Cell name="Label">
                    {code.label ? (
                      <span className="wrap-anywhere">{code.label}</span>
                    ) : (
                      <span className="text-ink-muted">None</span>
                    )}
                  </Cell>
                  <Cell name="Works for">
                    <span className="wrap-anywhere">{worksForText(code)}</span>
                  </Cell>
                  <Cell name="Uses">
                    <span className="tabular-nums">{usesText(code)}</span>
                    {detail ? <span className="block text-xs text-ink-muted">{detail}</span> : null}
                  </Cell>
                  <Cell name="Booking fees waived">
                    <span className="tabular-nums">{waivedText(code.waived)}</span>
                  </Cell>
                  <Cell name="Expires">
                    {code.expiresAt ? (
                      <time dateTime={code.expiresAt}>
                        {formatInstantIn(code.expiresAt, REFERRAL_EXPIRY_ZONE)}
                      </time>
                    ) : (
                      <span className="text-ink-muted">Never</span>
                    )}
                  </Cell>
                  <Cell name="Status">
                    <Badge variant={status.tone} srLabel="Status:">
                      {status.label}
                    </Badge>
                  </Cell>
                  <Cell name="Made by">
                    <span className="wrap-anywhere">{makerName(code.createdBy)}</span>
                  </Cell>
                  <Cell name="Open">
                    <Link
                      href={`${REFERRAL_CODES_PATH}/${encodeURIComponent(code.id)}`}
                      className={TEXT_LINK}
                    >
                      Open
                      <span className="sr-only">
                        {' '}
                        the code {code.label ? `for ${code.label}` : 'without a label'}
                      </span>
                    </Link>
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
