'use client'

/**
 * A write refused for want of a fresh second factor: ask for it, then send the
 * same write again.
 *
 * The Desi-Event team edits somebody else's posted event in an editing session,
 * and every write in it needs a second factor from the last 10 minutes
 * (SPEC2-XI X-A). The server decides when that has lapsed and answers 403
 * `STEP_UP_REQUIRED`; the nights, ticket types and pictures each send their own
 * writes, so each step asks where the write was made, rather than leaving a
 * refusal sentence and a button somewhere else on the page to find.
 *
 * `refused(body, retry)` takes a refused answer. For `STEP_UP_REQUIRED` it shows
 * the prompt and returns a promise that settles with whatever `retry()` settles
 * with once the second factor is accepted, or with null when the person backs
 * out (after `onDeclined`). For anything else it returns null, and the caller
 * shows the refusal as it always did. A `PLATFORM_EDIT_NOT_OPEN` answer under
 * the Desi-Event team's authority also tells the editor, so its banner offers to
 * open the session again.
 *
 * Nothing here decides when to ask: the server's answer does.
 *
 * With `takeFocus`, the prompt takes focus when it is drawn. A write sent from
 * a button the person just pressed leaves focus there, and the prompt asking
 * them to go on is somewhere below it; without the move a keyboard or
 * screen-reader user is not told it appeared, and a form that swaps its button
 * for the prompt drops focus to the page. It is not the default: a write sent
 * by autosave while the person types elsewhere must not pull them away.
 *
 * @module components/step-up-retry
 */

import { useCallback, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'
import { StepUpPrompt } from './step-up-prompt.jsx'
import { PLATFORM_STEP_UP_SENTENCE } from '../lib/event-control.js'

/** What a step says when the person backs out of the second factor. */
export const STEP_UP_DECLINED_SENTENCE =
  'Not saved: confirm it’s you to make this change. Nothing has been sent.'

/**
 * @typedef {object} StepUpRetryOptions
 * @property {string} action What is waiting, in words, for the prompt: "save this change".
 * @property {boolean} [platform] Whether the edits are made in the Desi-Event team's editing session.
 * @property {Function} [onSittingEnded] Called when a write finds that session closed.
 * @property {Function} [onDeclined] Called when the person backs out of the prompt.
 * @property {boolean} [takeFocus] Whether the prompt takes focus when it is drawn.
 */

/**
 * @typedef {object} StepUpRetry
 * @property {Function} refused Take a refused answer's body and a function that sends the write again; a promise for `STEP_UP_REQUIRED`, else null.
 * @property {JSX.Element|null} prompt The prompt to render while a write waits, or null.
 * @property {boolean} waiting Whether a write is waiting for the second factor.
 */

/**
 * The hook.
 *
 * @param {StepUpRetryOptions} options Options.
 * @returns {StepUpRetry} The handler and the prompt.
 */
export function useStepUpRetry({
  action,
  platform = false,
  onSittingEnded,
  onDeclined,
  takeFocus = false,
}) {
  const [waiting, setWaiting] = useState(false)
  const promptRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  // The write waiting for the second factor: what to send again, and whom to
  // tell how it went. A ref, because the prompt's buttons read it after the
  // render that created them.
  const pending = useRef(null)

  const refused = useCallback(
    (body, retry) => {
      const code = body?.error?.code ?? null

      if (code === 'PLATFORM_EDIT_NOT_OPEN' && platform) onSittingEnded?.()
      if (code !== 'STEP_UP_REQUIRED') return null

      // One question at a time: a write still waiting from before is given up,
      // and its caller told so, rather than left waiting for ever.
      pending.current?.resolve(null)

      return new Promise((resolve) => {
        pending.current = { retry, resolve }
        setWaiting(true)
        if (takeFocus) focusAfterRender(promptRef)
      })
    },
    [focusAfterRender, onSittingEnded, platform, takeFocus],
  )

  /**
   * Send the waiting write again, now the second factor is fresh.
   *
   * @returns {void}
   */
  function confirmed() {
    const current = pending.current

    pending.current = null
    setWaiting(false)

    if (!current) return

    Promise.resolve()
      .then(() => current.retry())
      .then(current.resolve, () => current.resolve(null))
  }

  /**
   * Give the waiting write up.
   *
   * @returns {void}
   */
  function declined() {
    const current = pending.current

    pending.current = null
    setWaiting(false)
    onDeclined?.()
    current?.resolve(null)
  }

  const prompt = waiting ? (
    <div
      ref={promptRef}
      tabIndex={-1}
      className="space-y-2 focus-visible:outline-none"
      data-slot="step-up-retry"
    >
      {platform ? (
        <p className="text-sm font-medium text-ink">{PLATFORM_STEP_UP_SENTENCE}</p>
      ) : null}
      <StepUpPrompt action={action} onConfirmed={confirmed} onCancel={declined} />
    </div>
  ) : null

  return { refused, prompt, waiting }
}
