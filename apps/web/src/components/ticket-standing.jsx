'use client'

/**
 * Whether a ticket admits, said once and kept in step with its pass.
 *
 * ## The contradiction this closes
 *
 * A ticket's page used to work out "Admits. Ready to use." from the ticket's
 * status alone, on the server, while the pass beside it was refused by the
 * API for reasons the status does not carry: the order is not paid, the event
 * was cancelled, or the ticket has no credential to draw. The page then said
 * "Admits. Ready to use." above "This ticket no longer admits anybody, so it
 * has no pass.", and both could not be true.
 *
 * The pass endpoint is the authority (it runs the door's own check), so when
 * it refuses with a 409 the pass reports the API's own sentence here, and
 * every part of the page that says whether the ticket admits says "Does not
 * admit" with that sentence. Nothing is stored: a reload asks again.
 *
 * Outside a provider (a unit test of the pass alone) the hooks are inert.
 *
 * @module components/ticket-standing
 */

import { createContext, useContext, useMemo, useState } from 'react'

import { StatusIcon } from './ui.jsx'

/** The page's standing: what the pass endpoint refused with, if anything. */
const StandingContext = createContext(null)

/**
 * Holds what the pass endpoint said, for the page's parts that say whether
 * the ticket admits.
 *
 * @param {{children: ReactNode}} props Component props.
 * @returns {JSX.Element} The provider.
 */
export function TicketStandingProvider({ children }) {
  const [refusal, setRefusal] = useState(null)
  const value = useMemo(() => ({ refusal, refuse: setRefusal }), [refusal])

  return <StandingContext.Provider value={value}>{children}</StandingContext.Provider>
}

/**
 * The standing, or null outside a provider.
 *
 * @returns {{refusal: string|null, refuse: function(string): void}|null} The standing.
 */
export function useTicketStanding() {
  return useContext(StandingContext)
}

/**
 * Whether the ticket admits, after anything the pass endpoint said.
 *
 * @param {boolean} admits What the ticket's status says.
 * @param {{refusal: string|null}|null} standing The page's standing.
 * @returns {boolean} Whether it admits.
 */
function admitsAfter(admits, standing) {
  return admits && !standing?.refusal
}

/**
 * The sentence under "Where it stands".
 *
 * @param {object} props Component props.
 * @param {boolean} props.admits Whether the ticket's status admits.
 * @param {string} props.label What its status means, in words.
 * @returns {JSX.Element} The sentence.
 */
export function TicketStanding({ admits, label }) {
  const standing = useTicketStanding()
  const yes = admitsAfter(admits, standing)

  return (
    <p
      data-admits={yes ? 'true' : 'false'}
      className={`mt-4 flex items-start gap-2.5 text-label ${yes ? 'text-status-success' : 'text-ink'}`}
    >
      <StatusIcon tone={yes ? 'success' : 'neutral'} className="mt-px" />
      <span>
        {/* The word, not only the colour. */}
        <strong className="font-semibold">{yes ? 'Admits' : 'Does not admit'}.</strong>{' '}
        {yes || !standing?.refusal ? label : standing.refusal}
      </span>
    </p>
  )
}

/**
 * The same standing as a chip on the ticket's face.
 *
 * @param {object} props Component props.
 * @param {boolean} props.admits Whether the ticket's status admits.
 * @returns {JSX.Element} The chip.
 */
export function TicketStandingChip({ admits }) {
  const standing = useTicketStanding()
  const yes = admitsAfter(admits, standing)

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pr-3 pl-1.5 text-sm font-semibold ${
        yes
          ? 'bg-status-success-soft text-status-success'
          : 'bg-status-neutral-soft text-status-neutral'
      }`}
    >
      <StatusIcon tone={yes ? 'success' : 'neutral'} />
      {yes ? 'Admits' : 'Does not admit'}
    </span>
  )
}
