'use client'

/**
 * Moving focus to something once it is on screen.
 *
 * ## Why not `queueMicrotask(() => ref.current?.focus())`
 *
 * That line works inside a click handler and fails after an `await`, and the
 * difference is invisible in the code. A click is a discrete event: React
 * renders its updates in a microtask it queues before yours, so by the time
 * yours runs the element is there. After an `await` there is no event, React
 * gives the same updates default priority and renders them in a later task —
 * so the microtask runs first, finds the refusal that has not been drawn yet,
 * or the opener that is not drawn while its panel is open, and focus falls to
 * the page. A keyboard or screen-reader user is sent back to the top and is
 * never told the request failed.
 *
 * ## What this does instead
 *
 * The request is a state change, so it is rendered in the same pass as the
 * state that draws the target, whatever priority that pass has; the focus
 * happens in an effect, after that pass is committed and every ref is
 * attached. One request per call, so the same refusal twice in a row is
 * focused twice.
 *
 * ## Each request waits for its own commit
 *
 * A request is numbered, and only the effect of the commit that drew that
 * number takes it. Without the number, an earlier commit's effects can take it
 * first: a press that lands just after the page hydrates, before the
 * hydrating commit has run its effects, opens a panel whose heading is not
 * drawn yet; the hydrating commit's effect found no heading, dropped the
 * request, and the commit that drew the heading had nothing left to focus.
 * Measured on the restore dialog, about one press in seven.
 *
 * @module components/focus-after-render
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * @typedef {{ current: (HTMLElement|null) }} ElementRef
 */

/**
 * @typedef {ElementRef|function(): (HTMLElement|null|undefined)} FocusTarget
 * A ref, or a function that returns the element once it is rendered.
 */

/**
 * A function that moves focus to a target after the next commit.
 *
 * @returns {function(FocusTarget): void} `focusAfterRender(target)`.
 */
export function useFocusAfterRender() {
  const pending = useRef(/** @type {{ target: FocusTarget, request: number }|null} */ (null))
  const issued = useRef(0)
  const [requests, setRequests] = useState(0)

  useEffect(() => {
    const request = pending.current

    // Not yet: this commit is an earlier one than the request's own.
    if (!request || request.request !== requests) return

    pending.current = null

    const { target } = request
    const element = typeof target === 'function' ? target() : target.current

    element?.focus()
  }, [requests])

  return useCallback((target) => {
    issued.current += 1
    pending.current = { target, request: issued.current }
    setRequests(issued.current)
  }, [])
}
