/**
 * The website links: every event whose organiser gave a website address, for
 * the platform administrators who turn each event's link on or off.
 *
 * An event's public page shows "Visit the organiser's website" only while an
 * administrator has the link on. The organiser cannot move the switch: a new
 * address waits here until an administrator decides on it, and while the link
 * is on it keeps going to the address that was approved. This page is the
 * queue; each row opens the event's review page at its website panel, where
 * the decision is made.
 *
 * The moderation layout admits moderators too, who may read an event but not
 * decide its link; they get the refusal here, and the API refuses the list to
 * them all the same. The filter and the search are links and a GET form, so
 * they work without JavaScript and can be bookmarked.
 *
 * @module app/moderation/websites/page
 */

import Link from 'next/link'

import { ReadRefusal, RefusalNotice } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { statusReading } from '../../../lib/event-status.js'
import { getWebsiteLinks } from '../../../lib/organizer-api.js'
import { readSession } from '../../../lib/session.js'
import { administratorSummary } from '../../../lib/website-redirect.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Website links', robots: { index: false, follow: false } }

/** The path of this page. */
const PATH = '/moderation/websites'

/** What a session without the capability is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Website links are decided by platform administrators. Nothing on this page can grant it.'

/** What the page says about every list. */
export const INTRODUCTION =
  'Events whose organisers have given a website address. Each event’s public page shows “Visit the organiser’s website” only while its link is on, and only platform administrators turn a link on or off.'

/**
 * The states an administrator filters by: how each reads, what its list is,
 * and what an empty one says. The API orders the two waiting lists oldest
 * first and the others by their last change.
 *
 * @type {ReadonlyArray<{value: string, label: string, intro: string, empty: string}>}
 */
export const FILTERS = Object.freeze([
  {
    value: 'waiting',
    label: 'Waiting for a decision',
    intro:
      'Addresses waiting for a decision on events that are in review, approved or public, the one waiting longest first.',
    empty: 'No website address is waiting for a decision.',
  },
  {
    value: 'drafts',
    label: 'Drafts and others',
    intro:
      'Addresses waiting for a decision on events that are not in review, approved or public: drafts, events sent back for changes, and rejected or archived events, the one waiting longest first. A link turned on here shows only while the event’s page is public.',
    empty:
      'No address is waiting for a decision on a draft, an event sent back for changes, or a rejected or archived event.',
  },
  {
    value: 'on',
    label: 'On',
    intro: 'Events whose website link is on, the most recently decided first.',
    empty: 'No event has its website link on.',
  },
  {
    value: 'off',
    label: 'Off',
    intro:
      'Addresses an administrator decided to leave off or turned off, the most recently decided first.',
    empty: 'No website link has been turned off.',
  },
  {
    value: 'all',
    label: 'All',
    intro: 'Every event with a website address or a link on, the most recently changed first.',
    empty: 'No organiser has given a website address.',
  },
])

/** The longest search the API takes. */
const SEARCH_MAX = 100

/**
 * The search from the address bar, when it is one the API would take.
 *
 * Trimmed; dropped when shorter than two characters, longer than the API's
 * limit, or carrying a control character, rather than sent to be refused.
 *
 * @param {unknown} value The raw `q` parameter.
 * @returns {string|undefined} The search, or nothing.
 */
export function readWebsiteSearch(value) {
  if (typeof value !== 'string') return undefined

  const text = value.trim()

  if (text.length < 2 || text.length > SEARCH_MAX || /\p{Cc}/u.test(text)) return undefined

  return text
}

/**
 * The links on how many pages, in words.
 *
 * @param {number} total How many events are in the list.
 * @param {number} totalPages How many pages they fill.
 * @returns {string} The sentence.
 */
function pastTheEndSentence(total, totalPages) {
  const events = total === 1 ? 'one event' : `${total} events`

  return `There ${total === 1 ? 'is' : 'are'} ${events} in this list, on ${
    totalPages === 1 ? 'one page' : `${totalPages} pages`
  }.`
}

/**
 * One event's row.
 *
 * @param {object} props Component props.
 * @param {object} props.link The API's row.
 * @returns {JSX.Element} The list item.
 */
function WebsiteLinkRow({ link }) {
  const reading = statusReading(link.status)
  const redirect = link.redirect ?? null
  const summary = administratorSummary(redirect, { websiteUrl: link.websiteUrl ?? null })

  return (
    <li
      className={`p-4 transition-shadow duration-(--duration-base) ease-standard focus-within:outline-2 focus-within:outline-focus focus-within:outline-offset-2 hover:shadow-card-hover sm:p-5 ${PANEL}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words text-ink">
            <Link
              href={`/moderation/events/${encodeURIComponent(link.eventId)}#website-link`}
              className={TEXT_LINK}
            >
              {link.title}
            </Link>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="break-words">{link.organizationName}</span>
            {link.organizationVerified ? <Badge variant="success">Verified</Badge> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={reading.tone} srLabel="Event:">
            {reading.label}
          </Badge>
          <Badge variant={summary.tone} size="lg" srLabel="Website link:">
            {summary.label}
          </Badge>
          {redirect?.pending ? <Badge variant="warning">Waiting for a decision</Badge> : null}
        </div>
      </div>
      <p className="mt-3 text-sm text-ink">
        <span className="font-medium">Address: </span>
        {link.websiteUrl ? (
          <span className="break-all">{link.websiteUrl}</span>
        ) : (
          <span className="text-ink-muted">None given</span>
        )}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{summary.sentences.join(' ')}</p>
    </li>
  )
}

/**
 * @typedef {object} WebsiteLinksPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The page.
 *
 * @param {WebsiteLinksPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function WebsiteLinksPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const filter = FILTERS.find((each) => each.value === query.state) ?? FILTERS[0]
  const state = filter.value
  const q = readWebsiteSearch(query.q)
  const searchDropped = typeof query.q === 'string' && query.q.trim() !== '' && q === undefined
  const page = readPage(query.page)
  const session = await readSession()

  const heading = (
    <>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Trust and safety
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Website links</h1>
    </>
  )

  if (!sessionCan(session, 'website_redirect:manage')) {
    return (
      <div>
        {heading}
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let links = []
  let pagination = null
  let failure = null

  try {
    const result = await getWebsiteLinks({ state, q, page, perPage: LIST_PAGE_SIZE })

    links = result.links
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  const beyond = !failure && isPastTheEnd(links.length, pagination, page)
  const stateParam = (value) => (value === FILTERS[0].value ? null : value)

  return (
    <div>
      {heading}
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">{filter.intro}</p>

      <nav aria-label="Filter by state" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((each) => {
            const current = each.value === state

            return (
              <li key={each.value}>
                <Link
                  href={listHref(PATH, { state: stateParam(each.value), q })}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus ${
                    current
                      ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                      : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  {each.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <form
        method="get"
        action={PATH}
        role="search"
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        {stateParam(state) ? <input type="hidden" name="state" value={state} /> : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="website-link-search" className="text-sm font-medium text-ink">
            Search by event title or web address
          </label>
          <input
            id="website-link-search"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            minLength={2}
            maxLength={SEARCH_MAX}
            autoComplete="off"
            aria-describedby={searchDropped ? 'website-link-search-note' : undefined}
            className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
        </div>
        <button type="submit" className={PAGER_LINK_CLASSES}>
          Search
        </button>
        {q ? (
          <Link href={listHref(PATH, { state: stateParam(state) })} className={PAGER_LINK_CLASSES}>
            Clear the search
          </Link>
        ) : null}
      </form>
      {searchDropped ? (
        <p id="website-link-search-note" className="mt-2 text-sm text-ink-muted">
          A search needs 2 to {SEARCH_MAX} letters, numbers or symbols, so this list is not
          filtered.
        </p>
      ) : null}

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The list of website links"
          action="see the website links"
        />
      ) : null}

      {beyond ? (
        <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
          <p className="font-medium text-ink">Page {page} is past the end of this list</p>
          <p className="mt-1 text-sm text-ink-muted">
            {Number.isInteger(pagination?.total)
              ? pastTheEndSentence(pagination.total, pagination.totalPages)
              : 'There is nothing on this page. The list may have shrunk since the link was made.'}
          </p>
          <p className="mt-3">
            <Link
              href={listHref(PATH, { state: stateParam(state), q, page: 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Go to the first page
            </Link>
          </p>
        </div>
      ) : null}

      {!failure && !beyond && links.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here"
            description={q ? `No event in this list matches “${q}”.` : filter.empty}
          />
        </div>
      ) : null}

      {links.length > 0 ? (
        <ol className="mt-6 space-y-3">
          {links.map((link) => (
            <WebsiteLinkRow key={link.eventId} link={link} />
          ))}
        </ol>
      ) : null}

      {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
          {pagination.hasPreviousPage ? (
            <Link
              href={listHref(PATH, { state: stateParam(state), q, page: page - 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Previous page
            </Link>
          ) : null}
          {pagination.hasNextPage ? (
            <Link
              href={listHref(PATH, { state: stateParam(state), q, page: page + 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
