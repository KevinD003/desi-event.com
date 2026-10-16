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
 * A new code for an open invitation is held here too, for the same reason.
 * Issuing it withdraws the invitation it replaces, so that invitation's row —
 * the component that asked for the code — goes at the next refresh, and
 * anything on the page can refresh it: another withdrawal, a role change, an
 * invitation sent. A code held in that row would go with it, shown once and
 * never handed over. Held here, it survives every refresh until the person
 * says they have handed it over.
 *
 * @module app/organizer/team/team-announcer
 */

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { ACCEPT_PATH, ACCEPT_PLACE } from './team-vocabulary.js'

/** The announcing function, or null outside a {@link TeamAnnouncer}. */
const AnnounceContext = createContext(null)

/** The function that holds a newly issued code, or null outside a {@link TeamAnnouncer}. */
const HoldCodeContext = createContext(null)

/**
 * @typedef {object} HeldCode
 * @property {string} code The code, exactly as the API returned it.
 * @property {string|null} recipient Its address, when the caller may see it.
 * @property {string|null} expiresAt When it stops working.
 * @property {string} what The invitation, in words: "the invitation to join as staff".
 */

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
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [held, setHeld] = useState(null)
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

  /** @type {function(HeldCode): void} */
  const holdCode = useCallback((issued) => setHeld(issued), [])

  return (
    <AnnounceContext value={announce}>
      <HoldCodeContext value={holdCode}>
        <p
          ref={regionRef}
          tabIndex={-1}
          aria-live="polite"
          role="status"
          className="mt-4 rounded-sm text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
        >
          {message}
        </p>
        {held ? (
          <div className="mt-4 max-w-xl">
            <OneTimeCodePanel
              code={held.code}
              heading="New invitation code"
              recipient={held.recipient}
              expiresAt={held.expiresAt}
              acceptPath={ACCEPT_PATH}
              acceptPlace={ACCEPT_PLACE}
              onDone={() => {
                // Dropped from memory first, then the list is read again.
                setHeld(null)
                announce(`The new code for ${held.what} is handed over.`, { focus: true })
                router.refresh()
              }}
            />
          </div>
        ) : null}
        {children}
      </HoldCodeContext>
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

/**
 * The function that holds a newly issued code above the table, when a
 * {@link TeamAnnouncer} is above.
 *
 * @returns {function(HeldCode): void|null} `holdCode(issued)`, or null.
 */
export function useHoldCode() {
  return useContext(HoldCodeContext)
}
