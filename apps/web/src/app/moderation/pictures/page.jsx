/**
 * Pictures waiting for a decision: new pictures and replacement covers added
 * to posted events (SPEC2-XI X-3).
 *
 * A draft's pictures are approved with the event. Once an event is posted, a
 * new picture waits on its own until somebody on the Desi-Event team other
 * than the person who uploaded it approves it, and a new cover waits beside
 * the current one, which stays on the public page until then. This is that
 * queue, oldest first, each picture beside its event and, for a new cover, the
 * cover it would replace. The decision is the same one the review page takes,
 * with its own second factor; the server refuses the uploader (`SELF_REVIEW`)
 * and a member of the event's organisation (`CONFLICT_OF_INTEREST`).
 *
 * The filter is links, so it works without JavaScript and can be bookmarked.
 *
 * @module app/moderation/pictures/page
 */

import Link from 'next/link'

import { ModerationMediaReview } from '../../../components/moderation-media-review.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { statusReading } from '../../../lib/event-status.js'
import { getMediaQueue } from '../../../lib/organizer-api.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pictures waiting',
  robots: { index: false, follow: false },
}

/** The path of this page. */
const PATH = '/moderation/pictures'

/** What the page says about itself. */
export const INTRODUCTION =
  'New pictures and new covers added to events that are already posted. Each appears on the event’s page only once somebody on the Desi-Event team other than the person who uploaded it approves it; a new cover takes the current cover’s place only then.'

/** The two lists. */
export const FILTERS = Object.freeze([
  { value: 'PENDING', label: 'Waiting', empty: 'No picture is waiting for a decision.' },
  { value: 'REJECTED', label: 'Taken down', empty: 'No picture on a posted event was taken down.' },
])

/**
 * One picture and its event.
 *
 * @param {object} props Component props.
 * @param {object} props.item A `mediaQueueItemSchema` row.
 * @returns {JSX.Element} The list item.
 */
function QueueItem({ item }) {
  const reading = statusReading(item.event.status)
  const uploaded = formatInstant(item.createdAt)

  return (
    <li className={`space-y-4 p-4 sm:p-5 ${PANEL}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words text-ink">
            <Link
              href={`/moderation/events/${encodeURIComponent(item.event.id)}`}
              className={TEXT_LINK}
            >
              {item.event.title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{item.event.organizationName}</p>
        </div>
        <Badge variant={reading.tone} srLabel="Event:">
          {reading.label}
        </Badge>
      </div>
      <p className="text-sm text-ink">
        {item.uploadedByOrganiser
          ? 'Uploaded by the organisation'
          : 'Uploaded by the Desi-Event team in an editing session'}
        {uploaded ? (
          <>
            {' '}
            on <time dateTime={item.createdAt}>{uploaded}</time>
          </>
        ) : null}
        .
      </p>
      {item.replacesMediaId ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <figure className="space-y-2">
            <figcaption className="text-sm font-semibold text-ink">
              The current cover, on the page until the new one is approved
            </figcaption>
            {/* Fetched with this reader's session, like the picture beside it. */}
            <img
              src={`/api/v1/media/${encodeURIComponent(item.replacesMediaId)}`}
              alt={`The current cover of ${item.event.title}`}
              loading="lazy"
              className="h-auto max-h-64 w-full rounded-control bg-surface-subtle object-contain"
            />
          </figure>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Replaces the current cover</p>
            <ModerationMediaReview media={[item]} approvePending />
          </div>
        </div>
      ) : (
        <ModerationMediaReview media={[item]} approvePending />
      )}
    </li>
  )
}

/**
 * @typedef {object} PicturesPageProps
 * @property {Promise<Record<string, string>>} [searchParams] The resolved query string.
 */

/**
 * The page.
 *
 * @param {PicturesPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PicturesWaitingPage({ searchParams } = {}) {
  const query = (await searchParams) ?? {}
  const filter = FILTERS.find((each) => each.value === query.status) ?? FILTERS[0]
  const page = readPage(query.page)

  let pictures = []
  let pagination = null
  let failure = null

  try {
    const result = await getMediaQueue({ status: filter.value, page, perPage: LIST_PAGE_SIZE })

    pictures = result.pictures
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  const beyond = !failure && isPastTheEnd(pictures.length, pagination, page)
  const statusParam = filter.value === FILTERS[0].value ? null : filter.value

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Trust and safety
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Pictures waiting for a decision</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>

      <nav aria-label="Filter by decision" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((each) => {
            const current = each.value === filter.value

            return (
              <li key={each.value}>
                <Link
                  href={listHref(PATH, {
                    status: each.value === FILTERS[0].value ? null : each.value,
                  })}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
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

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The pictures waiting"
          action="see the pictures waiting"
        />
      ) : null}

      {beyond ? (
        <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
          <p className="font-medium text-ink">Page {page} is past the end of this list</p>
          <p className="mt-3">
            <Link
              href={listHref(PATH, { status: statusParam, page: 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Go to the first page
            </Link>
          </p>
        </div>
      ) : null}

      {!failure && !beyond && pictures.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing here" description={filter.empty} />
        </div>
      ) : null}

      {pictures.length > 0 ? (
        <ol className="mt-6 space-y-4">
          {pictures.map((item) => (
            <QueueItem key={item.id} item={item} />
          ))}
        </ol>
      ) : null}

      {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
          {pagination.hasPreviousPage ? (
            <Link
              href={listHref(PATH, { status: statusParam, page: page - 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Previous page
            </Link>
          ) : null}
          {pagination.hasNextPage ? (
            <Link
              href={listHref(PATH, { status: statusParam, page: page + 1 })}
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
