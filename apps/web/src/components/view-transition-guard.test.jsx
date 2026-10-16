/**
 * A skipped page transition is not reported as an error, and nothing else is
 * hidden.
 *
 * @module components/view-transition-guard.test
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewTransitionGuard, isSkippedTransition } from './view-transition-guard.jsx'

afterEach(cleanup)

/**
 * A DOMException-like reason.
 *
 * @param {string} name Its name.
 * @param {string} message Its message.
 * @returns {Error} The reason.
 */
function reason(name, message) {
  return Object.assign(new Error(message), { name })
}

/**
 * Dispatch an unhandled rejection and say whether it was marked handled.
 *
 * @param {unknown} value The rejection's reason.
 * @returns {boolean} True when a listener called `preventDefault`.
 */
function dispatch(value) {
  const event = new Event('unhandledrejection', { cancelable: true })

  event.reason = value
  window.dispatchEvent(event)

  return event.defaultPrevented
}

describe('isSkippedTransition', () => {
  it.each([
    ['InvalidStateError', 'Transition was aborted because of invalid state'],
    ['TimeoutError', 'Transition was aborted because of timeout in DOM update'],
    ['AbortError', 'Transition was skipped'],
    [
      'InvalidStateError',
      'View transition was skipped because document visibility state is hidden.',
    ],
    ['InvalidStateError', 'Skipping view transition because viewport size changed.'],
  ])('recognises the browser’s %s: %s', (name, message) => {
    expect(isSkippedTransition(reason(name, message))).toBe(true)
  })

  it.each([
    [reason('TypeError', 'Failed to fetch')],
    [reason('AbortError', 'The user aborted a request.')],
    [reason('TimeoutError', 'signal timed out')],
    ['Transition was aborted because of invalid state'],
    [null],
    [undefined],
  ])('leaves anything else alone: %s', (value) => {
    expect(isSkippedTransition(value)).toBe(false)
  })
})

describe('ViewTransitionGuard', () => {
  it('marks a skipped transition handled while mounted, and stops listening when unmounted', () => {
    const { unmount } = render(<ViewTransitionGuard />)
    const skipped = reason(
      'TimeoutError',
      'Transition was aborted because of timeout in DOM update',
    )

    expect(dispatch(skipped)).toBe(true)
    expect(dispatch(reason('TypeError', 'Failed to fetch'))).toBe(false)

    unmount()

    expect(dispatch(skipped)).toBe(false)
  })

  it('draws nothing', () => {
    const { container } = render(<ViewTransitionGuard />)

    expect(container.innerHTML).toBe('')
  })
})
