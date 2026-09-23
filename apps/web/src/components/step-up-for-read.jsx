'use client'

/**
 * A step-up for seeing something, not only for doing something.
 *
 * Finance, refund and reconciliation reads sit behind the `FINANCE_VIEW`
 * step-up window, and a team's email addresses behind `MEMBER_EMAIL_VIEW`.
 * Before Phase 4, a page whose read was refused for a lapsed window showed a
 * failure — or on two detail pages "Not for you" — with no way forward, when
 * the person was one password and one code away from the page. This offers
 * that step, in place, and reloads the page once it is done so the server
 * decides again with the fresh confirmation.
 *
 * It holds nothing it read: the refusal carried no data, and the page redraws
 * from the server afterwards.
 *
 * @module components/step-up-for-read
 */

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { StepUpPrompt } from './step-up-prompt.jsx'
import { Button } from './ui.jsx'

/**
 * @typedef {object} StepUpForReadProps
 * @property {string} action What will be shown once confirmed, in words: "see this refund".
 */

/**
 * The read-time step-up.
 *
 * @param {StepUpForReadProps} props Component props.
 * @returns {JSX.Element} The explanation and, on request, the prompt.
 */
export function StepUpForRead({ action }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // Unique per instance: a board with two refused queues draws this once, but
  // nothing stops a page drawing it twice, and two headings sharing one id
  // would label both sections with the first.
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-card border border-status-info/25 bg-status-info-soft p-5 text-ink"
    >
      <h2 id={headingId} className="text-lg font-semibold text-status-info">
        Confirm it is you
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink">
        You are signed in, but it has been a while since you confirmed your password and second
        factor, and this is only shown after a recent confirmation. Confirm to {action}. The window
        is kept short on purpose; nothing is shown or changed until you do.
      </p>

      {open ? (
        <div className="mt-4">
          <StepUpPrompt
            action={action}
            onConfirmed={() => {
              setOpen(false)
              router.refresh()
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : (
        <Button type="button" className="mt-4" onClick={() => setOpen(true)}>
          Confirm and continue
        </Button>
      )}
    </section>
  )
}
