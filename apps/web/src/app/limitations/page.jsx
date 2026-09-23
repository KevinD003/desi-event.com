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

import { Diamond, MirrorDivider } from '../../components/festive-decor.jsx'
import { TEXT_LINK } from '../../components/link-classes.js'
import { PageHero } from '../../components/page-hero.jsx'
import { LIMITATIONS } from '../../lib/limitations.js'

export const metadata = {
  title: 'What this site does not do',
  description:
    'The capabilities this build of Desi-Event does not have, with the status of each and what it means for you.',
}

/** Classes for an in-text link. */
const LINK = TEXT_LINK

/**
 * The smaller things a visitor should know, as the page lists them under the
 * recorded limitations.
 */
const ALSO = Object.freeze([
  {
    key: 'seated',
    text: 'Seated tiers are shown on an event’s page but are not sold here: there is no seat picker for buyers.',
  },
  {
    key: 'organisations',
    text: 'Organiser accounts are set up by the platform. There is no way to create an organisation for yourself.',
  },
  {
    key: 'tax',
    text: 'US sales tax is not calculated: checkout shows it as $0.00 for an event in the United States.',
  },
  {
    key: 'privacy',
    text: (
      <>
        There is no self-service copy of your data and no self-service account deletion. What is
        kept, and who sees it, is on{' '}
        <Link href="/account/privacy" className={LINK}>
          your privacy page
        </Link>{' '}
        once you are signed in.
      </>
    ),
  },
  { key: 'fictional', text: 'Every event, organiser and price on this site is fictional.' },
])

/**
 * The page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function LimitationsPage() {
  return (
    <div>
      <PageHero
        headingId="limitations-heading"
        eyebrow="Plainly"
        title="What this site does not do"
        lead="Desi-Event is a demonstration build. These are the things somebody might expect of a ticketing site that this one does not do, what each one’s status is, and what happens instead."
      />

      <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
        <ul className="space-y-4">
          {LIMITATIONS.map((limitation) => (
            <li
              key={limitation.id}
              aria-labelledby={`limitation-${limitation.id}`}
              className="rounded-card bg-surface-raised p-6 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <h2 id={`limitation-${limitation.id}`} className="text-h3 font-semibold text-ink">
                  {limitation.name}
                </h2>
                <p className="text-sm">
                  <span className="sr-only">Status: </span>
                  <span className="inline-flex items-center rounded-full bg-status-mock-soft px-3 py-1 font-mono text-xs font-bold tracking-wide text-status-mock">
                    {limitation.status}
                  </span>
                </p>
              </div>
              <p className="mt-3 max-w-prose text-ink">{limitation.meaning}</p>
            </li>
          ))}
        </ul>

        <MirrorDivider className="my-12" />

        <h2 className="text-h2 font-semibold text-ink">Also in this build</h2>
        <ul className="mt-4 max-w-prose space-y-3 text-ink">
          {ALSO.map((item) => (
            <li key={item.key} className="flex items-start gap-3">
              <Diamond className="mt-2 h-2.5 w-2.5 fill-accent" />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-sm text-ink-muted">
          <Link href="/events" className={`${LINK} inline-flex min-h-11 items-center`}>
            Back to what’s on
          </Link>
        </p>
      </div>
    </div>
  )
}
