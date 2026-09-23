'use client'

/**
 * One polite place on the team screen where the outcome of an action is said.
 *
 * Each row's controls could announce for themselves, and that is what the
 * refund and reconciliation panels do. It does not work here, for one reason:
 * removing somebody removes their row. The refresh that follows a successful
 * removal unmounts the very component that would have said "removed", and a
 * screen-reader user is left with focus on nothing and no word of what
 * happened. So the announcement lives above the table, in a component the
 * refresh does not replace, and the row hands its sentence up through context.
 *
 * Polite, not assertive: an outcome somebody asked for is not an interruption.
 *
 * @module app/organizer/team/team-announcer
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'

/** The announcing function, or null outside a {@link TeamAnnouncer}. */
const AnnounceContext = createContext(null)

/**
 * @typedef {object} TeamAnnouncerProps
 * @property {object} children The table and its sections.
 */

/**
 * The shared announcement region, and the context that feeds it.
 *
 * @param {TeamAnnouncerProps} props Component props.
 * @returns {JSX.Element} The region and its children.
 */
export function TeamAnnouncer({ children }) {
  const [message, setMessage] = useState('')
  const regionRef = useRef(null)

  const announce = useCallback((text, { focus = false } = {}) => {
    setMessage(text)
    // Focus follows when the control that was pressed is about to disappear.
    if (focus) queueMicrotask(() => regionRef.current?.focus())
  }, [])

  return (
    <AnnounceContext value={announce}>
      <p
        ref={regionRef}
        tabIndex={-1}
        aria-live="polite"
        role="status"
        className="mt-4 rounded-sm text-sm font-medium text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        {message}
      </p>
      {children}
    </AnnounceContext>
  )
}

/**
 * The announcing function, when a {@link TeamAnnouncer} is above.
 *
 * @returns {Function|null} `announce(text, { focus })`, or null.
 */
export function useAnnounce() {
  return useContext(AnnounceContext)
}
