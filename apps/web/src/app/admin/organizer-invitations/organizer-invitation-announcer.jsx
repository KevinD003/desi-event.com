'use client'

/**
 * One polite place on the organiser invitations screen where the outcome of a
 * row's action is said, and where a reissued code is held.
 *
 * A row cannot do either for itself. Withdrawing an invitation, or issuing a
 * new code in its place, takes it out of the waiting list, so the refresh that
 * follows unmounts the very row that would have said what happened — and
 * anything on the page can refresh it: another row's withdrawal, an invitation
 * sent from the form. A new code held in that row would go with it, shown once
 * and never handed over. Held here, above the table, it survives every refresh
 * until the person says they have handed it over.
 *
 * The same pattern as the team screen's announcer, for the same reason.
 *
 * @module app/admin/organizer-invitations/organizer-invitation-announcer
 */

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../components/focus-after-render.jsx'
import { OneTimeCodePanel } from '../../../components/one-time-code-panel.jsx'
import { JOIN_PATH, JOIN_PLACE } from './organizer-invitation-vocabulary.js'

/** The announcing function, or null outside an {@link InvitationAnnouncer}. */
const AnnounceContext = createContext(null)

/** The function that holds a new code, or null outside an {@link InvitationAnnouncer}. */
const HoldCodeContext = createContext(null)

/**
 * @typedef {object} HeldInvitationCode
 * @property {string} code The code, exactly as the API returned it.
 * @property {string} recipient The address it is for.
 * @property {string|null} expiresAt When it stops working.
 * @property {{subject: string, text: string}|null} letter The ready-to-send message.
 */

/**
 * The shared announcement region, the held code, and the context that feeds them.
 *
 * @param {object} props Component props.
 * @param {object} props.children The table and its sections.
 * @returns {JSX.Element} The region and its children.
 */
export function InvitationAnnouncer({ children }) {
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

  /** @type {function(HeldInvitationCode): void} */
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
          <div className="mt-4 max-w-2xl">
            <OneTimeCodePanel
              code={held.code}
              heading={`New organiser invitation code for ${held.recipient}`}
              recipient={held.recipient}
              expiresAt={held.expiresAt}
              acceptPath={JOIN_PATH}
              acceptPlace={JOIN_PLACE}
              lostAdvice="If it is lost, issue a new code from this list, which stops this one working."
              letter={held.letter}
              onDone={() => {
                // Dropped from memory first, then the list is read again.
                setHeld(null)
                announce(`The new code for ${held.recipient} is handed over.`, { focus: true })
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
 * The announcing function, when an {@link InvitationAnnouncer} is above.
 *
 * @returns {Function|null} `announce(text, { focus })`, or null.
 */
export function useInvitationAnnounce() {
  return useContext(AnnounceContext)
}

/**
 * The function that holds a new code above the table, when an
 * {@link InvitationAnnouncer} is above.
 *
 * @returns {function(HeldInvitationCode): void|null} `holdCode(issued)`, or null.
 */
export function useHoldInvitationCode() {
  return useContext(HoldCodeContext)
}
