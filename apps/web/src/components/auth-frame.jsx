/**
 * The frame round the sign-in and account pages: the form on a white card, and
 * beside it on a wide screen a night panel that says what an account is for.
 *
 * The panel is not a second form and holds nothing to act on; everything a
 * person needs is in the card, which comes first in the reading order even
 * though the panel is drawn to its left. On a phone the panel is not drawn at
 * all, so the form is the first thing on the screen.
 *
 * @module components/auth-frame
 */

import { BrandMark, GarbaRings, Toran } from './festive-decor.jsx'
import { CheckIcon } from './icons.jsx'
import { FadeIn } from './motion.jsx'

/** What an account is for, in three true sentences. */
const REASONS = Object.freeze([
  'Your tickets are kept in your account, with an entry pass for each.',
  'Orders and transfers are on your account pages; this site sends no email.',
  'Payments on this site are simulated — no card, no money moves.',
])

/**
 * @typedef {object} AuthFrameProps
 * @property {string} headingId The `h1`'s id.
 * @property {string} title The page's heading.
 * @property {ReactNode} lead A sentence under it.
 * @property {ReactNode} children The form and the links below it.
 */

/**
 * The sign-in and account-creation layout.
 *
 * @param {AuthFrameProps} props Component props.
 * @returns {JSX.Element} The layout.
 */
export function AuthFrame({ headingId, title, lead, children }) {
  return (
    <div className="mx-auto grid max-w-content grid-cols-1 gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-stretch lg:gap-12">
      <FadeIn className="order-1 lg:order-2">
        <section
          aria-labelledby={headingId}
          className="rounded-card bg-surface-raised p-6 shadow-dialog sm:p-8"
        >
          <BrandMark className="h-10 w-10" />
          <h1 id={headingId} className="mt-5 text-h1 font-semibold text-ink">
            {title}
          </h1>
          <p className="mt-3 text-ink-muted">{lead}</p>
          <div className="mt-8">{children}</div>
        </section>
      </FadeIn>

      <aside
        aria-label="What an account is for"
        className="relative isolate order-2 hidden overflow-hidden rounded-card bg-surface-inverse px-10 pt-20 pb-12 text-ink-inverse lg:order-1 lg:flex lg:flex-col lg:justify-end"
      >
        <Toran />
        <GarbaRings className="absolute -top-32 -right-64 -z-10 h-[34rem] w-[34rem]" />
        <p className="font-display text-h1 font-semibold text-ink-inverse">
          Your nights out,
          <span className="block text-accent-inverse italic">all in one place.</span>
        </p>
        <ul className="mt-8 flex flex-col gap-4">
          {REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-ink-inverse-muted">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-inverse/15 text-accent-inverse"
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </span>
              {reason}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
