/**
 * What this site does not do.
 *
 * One public page that names every capability a visitor might expect and this
 * build does not have, each with the status the project records for it and
 * what it means for somebody using the site. The status words are the
 * project's own, from the Phase 4 brief and its report, and are shown exactly
 * as recorded so the page and the report cannot disagree about a word.
 *
 * Nothing here is "coming". A capability is listed because it is missing now,
 * and the page says what happens instead — a seated ticket stays with its
 * buyer, a door check-in needs a connection — rather than when it might
 * change, which nobody here can promise.
 *
 * The list itself is `lib/limitations.js`, so a test can hold it to the
 * recorded wording without rendering the page.
 *
 * The page asks nothing of the API: every statement is a property of this
 * build, so there is nothing to fetch and nothing that can fail to load.
 *
 * @module app/limitations/page
 */

import Link from 'next/link'

import { LIMITATIONS } from '../../lib/limitations.js'

export const metadata = {
  title: 'What this site does not do',
  description:
    'The capabilities this build of Desi-Event does not have, with the status of each and what it means for you.',
}

/** Classes for an in-text link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function LimitationsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
        What this site does not do
      </h1>
      <p className="mt-3 max-w-prose text-ink-muted">
        Desi-Event is a demonstration build. These are the things somebody might expect of a
        ticketing site that this one does not do, what each one’s status is, and what happens
        instead.
      </p>

      <ul className="mt-10 space-y-4">
        {LIMITATIONS.map((limitation) => (
          <li
            key={limitation.id}
            aria-labelledby={`limitation-${limitation.id}`}
            className="rounded-card border border-line bg-surface-raised p-5"
          >
            <h2 id={`limitation-${limitation.id}`} className="text-lg font-semibold text-ink">
              {limitation.name}
            </h2>
            <p className="mt-1 text-sm">
              <span className="text-ink-muted">Status: </span>
              <span className="font-mono font-semibold tracking-wide text-ink">
                {limitation.status}
              </span>
            </p>
            <p className="mt-3 max-w-prose text-ink">{limitation.meaning}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-xl font-semibold text-ink">Also in this build</h2>
      <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5 text-ink">
        <li>
          Seated tiers are shown on an event’s page but are not sold here: there is no seat picker
          for buyers.
        </li>
        <li>
          Organiser accounts are set up by the platform. There is no way to create an organisation
          for yourself.
        </li>
        <li>
          There is no self-service copy of your data and no self-service account deletion. What is
          kept, and who sees it, is on{' '}
          <Link href="/account/privacy" className={LINK}>
            your privacy page
          </Link>{' '}
          once you are signed in.
        </li>
        <li>Every event, organiser and price on this site is fictional.</li>
      </ul>

      <p className="mt-10 text-sm text-ink-muted">
        <Link href="/events" className={LINK}>
          Back to what’s on
        </Link>
      </p>
    </div>
  )
}
