'use client'

/**
 * A single-use code, shown once, to the person who has to hand it over.
 *
 * When codes are not emailed (the `MANUAL` delivery mode, which is how this
 * site runs unless a mail server is configured), the API returns the code
 * exactly once, in the response that minted it, and keeps only its digest.
 * This panel is the only place it is ever drawn. The rules it keeps, each for
 * a reason:
 *
 * - **It lives in the parent's React state and nowhere else.** Never in
 *   `localStorage` or `sessionStorage`, never in a web address, never in a
 *   link: a code in a URL survives in history, in the next page's referrer and
 *   in server logs long after it is spent. "I have handed it over" is the
 *   parent's cue to drop it.
 * - **Copying is offered, not assumed.** The clipboard API is used when the
 *   browser allows it; when it does not, the field's text is selected and the
 *   person is told to copy it themselves.
 * - **The outcome is announced politely.** A `status` region, never an alert:
 *   only the door workspace interrupts.
 * - **Focus moves to the heading** when the panel appears, so a keyboard or
 *   screen-reader user is taken to the code rather than left on a button that
 *   has gone.
 *
 * Shared by the team invitation, organiser invitation and ticket transfer
 * screens, so the words that differ come in as props.
 *
 * ## The ready-to-send message
 *
 * A screen may pass a `letter`: the same words the site's mailer would send in
 * `EMAIL` mode, composed in the browser from `@desi-event/schemas/code-letters`,
 * for the person to copy into an email of their own. The letter contains the
 * code, so it follows every rule above: it lives in the parent's state beside
 * the code, is drawn in a read-only field, is copied only when asked, and goes
 * when the code goes. It names the page where the code is typed and never
 * carries the code in a link; `acceptPath` is still a path, never an address
 * with the code in it.
 *
 * @module components/one-time-code-panel
 */

import { useEffect, useId, useRef, useState } from 'react'

import { Button } from './ui.jsx'

/**
 * A moment, in words, for the "works until" sentence.
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @returns {string|null} The moment, or null when there is none to state.
 */
function untilWords(value) {
  const time = value ? Date.parse(value) : Number.NaN

  if (!Number.isFinite(time)) return null

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(time),
  )
}

/**
 * @typedef {object} OneTimeCodePanelProps
 * @property {string} code The code, exactly as the API returned it.
 * @property {string} [heading] What the panel is called.
 * @property {string} [codeLabel] The visible label on the code's field.
 * @property {string|null} [recipient] Who it is for — an address when the caller may see it, otherwise null.
 * @property {string|null} [expiresAt] When the code stops working.
 * @property {string} acceptPath The page where the recipient types it in.
 * @property {string} acceptPlace How to reach that page in words: "Your account → Join an organisation".
 * @property {string} [lostAdvice] What to do if the code is lost.
 * @property {{subject: string, text: string}|null} [letter] A ready-to-send message carrying the code.
 * @property {Function} onDone Called when the person says they have handed it over.
 */

/**
 * The panel.
 *
 * @param {OneTimeCodePanelProps} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export function OneTimeCodePanel({
  code,
  heading = 'Hand this code over',
  codeLabel = 'Invitation code',
  recipient = null,
  expiresAt = null,
  acceptPath,
  acceptPlace,
  lostAdvice = 'If it is lost, issue a new code, which stops this one working.',
  letter = null,
  onDone,
}) {
  const id = useId()
  const headingRef = useRef(null)
  const fieldRef = useRef(null)
  const letterRef = useRef(null)
  const hasLetter = Boolean(letter && typeof letter.text === 'string' && letter.text !== '')
  const [announcement, setAnnouncement] = useState('')
  const who = recipient ?? 'the person it is for'
  const until = untilWords(expiresAt)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  /**
   * Select the whole code in its field, for copying by hand.
   *
   * @returns {void}
   */
  function selectCode() {
    fieldRef.current?.focus()
    fieldRef.current?.select()
  }

  /**
   * Select the whole message in its field, for copying by hand.
   *
   * @returns {void}
   */
  function selectLetter() {
    letterRef.current?.focus()
    letterRef.current?.select()
  }

  /**
   * Put the code on the clipboard, or select it when the browser will not.
   *
   * @returns {Promise<void>} Resolves once the outcome is announced.
   */
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')

      await navigator.clipboard.writeText(code)
      setAnnouncement('Copied the code to your clipboard.')
    } catch {
      selectCode()
      setAnnouncement(
        'This browser did not let the page copy it. The code is selected: copy it with your keyboard or menu.',
      )
    }
  }

  /**
   * Put the whole message on the clipboard, or select it when the browser will not.
   *
   * @returns {Promise<void>} Resolves once the outcome is announced.
   */
  async function copyLetter() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')

      await navigator.clipboard.writeText(letter.text)
      setAnnouncement('Copied the message to your clipboard.')
    } catch {
      selectLetter()
      setAnnouncement(
        'This browser did not let the page copy it. The message is selected: copy it with your keyboard or menu.',
      )
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="mt-4 rounded-card border border-line-strong bg-surface-raised p-5 shadow-card"
    >
      <h3
        id={`${id}-heading`}
        ref={headingRef}
        tabIndex={-1}
        className="font-semibold text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        {heading}
      </h3>

      <div className="mt-3">
        <label htmlFor={`${id}-code`} className="block text-sm font-medium text-ink">
          {codeLabel}
        </label>
        <input
          ref={fieldRef}
          id={`${id}-code`}
          type="text"
          readOnly
          value={code}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={`${id}-how`}
          onFocus={(focused) => focused.currentTarget.select()}
          className="mt-1 block min-h-11 w-full rounded-control border border-line-strong bg-surface-subtle px-3 font-mono text-sm break-all text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        />
      </div>

      <div id={`${id}-how`} className="mt-3 space-y-2 text-sm text-ink-muted">
        <p>
          Send this code to {who} yourself, by a message or in person. It works once, only for
          someone signed in as {who}
          {until ? `, until ${until}` : ''}.
        </p>
        <p>
          Ask them to open {acceptPlace} ({acceptPath}) and type it in.
        </p>
        <p>
          This page will not show it again. {lostAdvice} Treat it like a password until it is used.
        </p>
      </div>

      {hasLetter ? (
        <div className="mt-4">
          <label htmlFor={`${id}-letter`} className="block text-sm font-medium text-ink">
            Message to send them
          </label>
          <p id={`${id}-subject`} className="mt-1 text-sm text-ink-muted">
            Subject: <span className="text-ink">{letter.subject}</span>
          </p>
          <textarea
            ref={letterRef}
            id={`${id}-letter`}
            readOnly
            rows={14}
            value={letter.text}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={`${id}-subject`}
            className="mt-2 block w-full rounded-control border border-line-strong bg-surface-subtle px-3 py-2 font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          />
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-ink">
        {announcement}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" onClick={copy}>
          Copy the code
        </Button>
        {hasLetter ? (
          <Button type="button" variant="secondary" className="min-h-11" onClick={copyLetter}>
            Copy the message
          </Button>
        ) : null}
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => onDone()}>
          I have handed it over
        </Button>
      </div>
    </section>
  )
}
