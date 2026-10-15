'use client'

/**
 * "Copy code": puts one referral code on the clipboard (SPEC3 §12.5, §12.12).
 *
 * The button's accessible name is never the code itself: "Copy code for
 * {label}", or "Copy referral code" for a code without a label — and the
 * visible words are where that name begins, so a person using speech input
 * says what they see (WCAG 2.5.3). Without a label the button reads "Copy
 * referral code" on screen too.
 *
 * What happened is said politely: "Copied", or, when the browser will not let
 * the page write to the clipboard, how to copy it by hand. A page with many
 * buttons passes `onAnnounce` and keeps one live region of its own; a button on
 * its own keeps its own region, where the words are drawn afresh for each
 * press, so a second copy is said as the first was.
 *
 * The code goes to the clipboard and nowhere else: not to storage, a log or an
 * analytics event.
 *
 * @module app/admin/referral-codes/copy-code-button
 */

import { useState } from 'react'

import { Button } from '../../../components/ui.jsx'
import { copyLabel } from './referral-vocabulary.js'

/** What the button says once the code is on the clipboard. */
export const COPIED = 'Copied'

/** What it says when the browser would not let the page copy. */
export const COPY_REFUSED =
  'This browser did not let the page copy it. Select the code and copy it with your keyboard or menu.'

/**
 * @typedef {object} CopyCodeButtonProps
 * @property {{referralCode: string, label: string|null}} code The code.
 * @property {function(string): void} [onAnnounce] Where to say what happened; the button's own region when absent.
 * @property {'sm'|'md'} [size] The button's size.
 */

/**
 * The button.
 *
 * @param {CopyCodeButtonProps} props Component props.
 * @returns {JSX.Element} The button, and its live region when it keeps one.
 */
export function CopyCodeButton({ code, onAnnounce, size = 'sm' }) {
  // The words, and how many times they were said: each saying is a new node.
  const [said, setSaid] = useState({ words: '', times: 0 })
  const name = copyLabel(code)
  const visible = code.label ? 'Copy code' : 'Copy referral code'

  /**
   * Say what happened, in the page's region or the button's own.
   *
   * @param {string} words The sentence.
   * @returns {void}
   */
  function announce(words) {
    if (onAnnounce) onAnnounce(words)
    else setSaid((last) => ({ words, times: last.times + 1 }))
  }

  /**
   * Put the code on the clipboard.
   *
   * @returns {Promise<void>} Resolves once the outcome is said.
   */
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')

      await navigator.clipboard.writeText(code.referralCode)
      announce(COPIED)
    } catch {
      announce(COPY_REFUSED)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        onClick={copy}
        aria-label={name === visible ? undefined : name}
      >
        {visible}
      </Button>
      {onAnnounce ? null : (
        <span role="status" aria-live="polite" className="ml-2 text-sm text-ink-muted">
          <span key={said.times}>{said.words}</span>
        </span>
      )}
    </>
  )
}
