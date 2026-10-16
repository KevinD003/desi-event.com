'use client'

/**
 * One polite place above a list where the outcome of a row's action is said.
 *
 * A row's own status region is enough while the row stays. It is not enough
 * when the action removes the row: the refresh that follows a deletion
 * unmounts the very region that would have said "deleted", and focus, left on
 * a button that no longer exists, falls to the page. So the sentence is handed
 * up to a region the refresh does not replace, and focus can be moved to it —
 * the same arrangement as the team screen's announcer.
 *
 * Polite, not assertive: an outcome somebody asked for is not an interruption.
 *
 * @module components/outcome-announcer
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'

import { useFocusAfterRender } from './focus-after-render.jsx'

/** The announcing function, or null outside an {@link OutcomeAnnouncer}. */
const AnnounceContext = createContext(null)

/**
 * @typedef {object} OutcomeAnnouncerProps
 * @property {object} children The list and whatever replaces it when it empties.
 * @property {string} [className] Extra classes for the region.
 */

/**
 * The shared region, and the context that feeds it.
 *
 * @param {OutcomeAnnouncerProps} props Component props.
 * @returns {JSX.Element} The region and its children.
 */
export function OutcomeAnnouncer({ children, className = '' }) {
  const [message, setMessage] = useState('')
  const regionRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()

  const announce = useCallback(
    (text, { focus = false } = {}) => {
      setMessage(text)
      // Focus follows when the control that was pressed is about to disappear.
      if (focus) focusAfterRender(regionRef)
    },
    [focusAfterRender],
  )

  return (
    <AnnounceContext value={announce}>
      <p
        ref={regionRef}
        tabIndex={-1}
        aria-live="polite"
        role="status"
        data-testid="outcome-announcer"
        className={`rounded-sm text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus ${className}`}
      >
        {message}
      </p>
      {children}
    </AnnounceContext>
  )
}

/**
 * The announcing function, when an {@link OutcomeAnnouncer} is above.
 *
 * @returns {Function|null} `announce(text, { focus })`, or null.
 */
export function useOutcomeAnnouncer() {
  return useContext(AnnounceContext)
}
