'use client'

/**
 * Keeps a skipped page transition from being reported as an error.
 *
 * A navigation crossfades through the browser's View Transitions API
 * (`page-transition.jsx`). The browser is allowed to skip one: the tab is
 * hidden, another navigation starts before the first has painted, or the new
 * page takes longer than the browser will wait to draw. The page still
 * changes, instantly, which is the right outcome. But the browser also
 * rejects the transition's promises, and the one React leaves unobserved
 * surfaces as an "unhandled rejection" in the console: an error about
 * nothing going wrong.
 *
 * This listens for exactly those rejections, the browser's own messages for a
 * transition it skipped or aborted, and marks them handled. Every other
 * rejection is left alone, so a real failure still reaches the console and
 * the error reporting a deployment wires up.
 *
 * @module components/view-transition-guard
 */

import { useEffect } from 'react'

/** The browser's messages for a view transition it skipped or aborted. */
const SKIPPED =
  /^(?:Transition was (?:aborted|skipped)\b|View transition was skipped\b|Skipping view transition\b)/u

/**
 * Whether a rejection is a skipped or aborted view transition.
 *
 * @param {unknown} reason The rejection's reason.
 * @returns {boolean} True for the browser's own transition outcomes only.
 */
export function isSkippedTransition(reason) {
  if (typeof reason !== 'object' || reason === null) return false

  const { name, message } = /** @type {{name?: unknown, message?: unknown}} */ (reason)

  return (
    ['AbortError', 'InvalidStateError', 'TimeoutError'].includes(name) &&
    typeof message === 'string' &&
    SKIPPED.test(message)
  )
}

/**
 * The guard. Render it once, inside `<body>`; it draws nothing.
 *
 * @returns {null} Nothing.
 */
export function ViewTransitionGuard() {
  useEffect(() => {
    /**
     * Mark a skipped transition's rejection handled.
     *
     * @param {PromiseRejectionEvent} event The rejection.
     * @returns {void}
     */
    function onRejection(event) {
      if (isSkippedTransition(event.reason)) event.preventDefault()
    }

    window.addEventListener('unhandledrejection', onRejection)

    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  return null
}
