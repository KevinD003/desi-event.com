/**
 * The notification queue: every message the outbox holds, in every status.
 *
 * The operations board shows the stuck ones — dead letters, failures, retries
 * waiting. This is the whole outbox, filterable, so that any message can be
 * found and opened, and so that "did it go?" has an answer for the ones that
 * did as well as the ones that did not.
 *
 * ## Platform work only
 *
 * `GET /v1/operations/notifications` asks `reconciliation:manage`, which no
 * organisation role carries. The operations area also admits an
 * organisation's finance staff, for their refunds; they are refused here in
 * the same words as any other page they may not open, rather than being sent
 * into a request the API would refuse.
 *
 * ## What a row carries, and what it never does
 *
 * A template, a channel, a status, a count, some instants, a failure category
 * and the stored error the API has already cleared of addresses. Never a
 * recipient — the payload has no field for one, and this page does not
 * invent one — and never the worker's lease, which the payload does carry and
 * this page does not read. "Sent" means handed to the (simulated) mail
 * service and says nothing about an inbox.
 *
 * ## Filters in the address bar
 *
 * A plain GET form, so a filtered view works before JavaScript arrives and can
 * be bookmarked. Values are checked against the API's own lists before they
 * are sent: a hand-edited address with an unknown status gets the unfiltered
 * queue and a sentence saying so, not a validation error.
 *
 * ## The order
 *
 * Dead letters, failures and scheduled retries first, the longest-waiting of
 * them first, then everything else. The API used to sort by the status column,
 * which PostgreSQL orders by the enum's declaration order and which put dead
 * letters near the end; it now reads the two tiers separately
 * (`apps/api/src/lib/ranked-page.js`), and the page says what it does.
 *
 * ## A page past the end is not an empty outbox
 *
 * A page number from the address can outlive the list. When a page has no rows
 * but the queue has some, the page says so, says how many there are, and links
 * to the first page; "the outbox is empty" is kept for an outbox that is.
 *
 * @module app/operations/notifications/page
 */

import Link from 'next/link'
import { NOTIFICATION_STATUSES } from '@desi-event/schemas'

import { ScrollableTable } from '../../../components/money-figure.jsx'
import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { readSession, sessionCan } from '../../../lib/session.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  STATUS_TONE_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  listNotifications,
  readPage,
} from '../../../lib/workspace-api.js'
import {
  CHANNELS_IN_WORDS,
  FAILURE_CATEGORIES_IN_WORDS,
  notificationStatusInWords,
} from './notification-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Notification queue', robots: { index: false, follow: false } }

/** Where this page lives. */
const PATH = '/operations/notifications'

/** The failure categories the API filters by. */
const FAILURE_CATEGORIES = Object.freeze(['PERMANENT', 'TRANSIENT'])

/** A header cell. */
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-3 align-top text-ink'

/**
 * A filter control.
 *
 * `max-w-full`, with its wrapper's, because a `<select>` is as wide as its
 * longest option: "Permanent: it will fail the same way again" made the failure
 * filter wider than a 320 px screen, and the whole page scrolled sideways. A
 * capped select still opens its full list; only the closed control shrinks.
 */
const CONTROL =
  'min-h-11 max-w-full rounded-control border border-line-strong bg-surface px-3.5 py-2 text-base text-ink shadow-control sm:text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** A filter's label and control, never wider than the form. */
const FIELD = 'flex max-w-full min-w-0 flex-col gap-1'

/** A quiet text link. */
const LINK =
  'rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** "Clear the filters": a quiet link, with a 44-pixel target. */
const CLEAR_LINK =
  'inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * A count with its noun, singular or plural.
 *
 * @param {number} count How many.
 * @returns {string} "1 message", "3 messages".
 */
function messagesInWords(count) {
  return `${count} message${count === 1 ? '' : 's'}`
}

/**
 * An instant in a cell, or a word for its absence.
 *
 * @param {object} props Component props.
 * @param {string|null} props.value The instant.
 * @param {string} props.absent What to say when there is none.
 * @returns {JSX.Element} The cell's content.
 */
function When({ value, absent }) {
  const printed = formatInstant(value)

  if (!printed) return <span className="text-ink-subtle">{absent}</span>

  return <time dateTime={value}>{printed}</time>
}

/**
 * Previous and next, keeping the filters.
 *
 * @param {object} props Component props.
 * @param {object|null} props.pagination The API's page counters.
 * @param {Record<string, string>} props.filters The filters in force.
 * @returns {JSX.Element|null} The navigation, or nothing for a single page.
 */
function Pager({ pagination, filters }) {
  if (!pagination || pagination.totalPages <= 1) return null

  return (
    <nav
      aria-label="Pages of the notification queue"
      className="mt-4 flex flex-wrap items-center gap-3 text-sm"
    >
      <span className="text-ink-muted">
        Page {pagination.page} of {pagination.totalPages}
      </span>
      {pagination.hasPreviousPage ? (
        <Link
          href={listHref(PATH, { ...filters, page: pagination.page - 1 })}
          className={PAGER_LINK_CLASSES}
        >
          Previous page
        </Link>
      ) : null}
      {pagination.hasNextPage ? (
        <Link
          href={listHref(PATH, { ...filters, page: pagination.page + 1 })}
          className={PAGER_LINK_CLASSES}
        >
          Next page
        </Link>
      ) : null}
    </nav>
  )
}

/**
 * A page with no rows in a queue that has some.
 *
 * @param {object} props Component props.
 * @param {number} props.page The page asked for.
 * @param {object|null} props.pagination The API's page counters.
 * @param {Record<string, string>} props.filters The filters in force.
 * @param {boolean} props.filtered Whether any filter narrows the queue.
 * @returns {JSX.Element} The notice, with a way back.
 */
function PastTheEnd({ page, pagination, filters, filtered }) {
  const total = Number.isInteger(pagination?.total) ? pagination.total : null

  return (
    <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
      <p className="font-medium text-ink">Page {page} is past the end of the queue</p>
      <p className="mt-1 text-sm text-ink-muted">
        {total === null
          ? 'There is nothing on this page. The queue may have shrunk since the link was made.'
          : `There ${total === 1 ? 'is' : 'are'} ${messagesInWords(total)} ${
              filtered ? 'matching these filters' : 'in all'
            }, on ${pagination.totalPages} page${pagination.totalPages === 1 ? '' : 's'}.`}
      </p>
      <p className="mt-3">
        <Link href={listHref(PATH, { ...filters, page: 1 })} className={PAGER_LINK_CLASSES}>
          Go to the first page
        </Link>
      </p>
    </div>
  )
}

/**
 * @typedef {object} NotificationQueuePageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The queue.
 *
 * @param {NotificationQueuePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function NotificationQueuePage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()

  // A platform capability, asked with no organisation.
  if (!sessionCan(session, 'reconciliation:manage')) {
    return (
      <Forbidden
        area="The notification queue"
        backHref="/operations"
        backLabel="Back to operations"
      />
    )
  }

  const status = NOTIFICATION_STATUSES.includes(query.status) ? query.status : ''
  const failureCategory = FAILURE_CATEGORIES.includes(query.failureCategory)
    ? query.failureCategory
    : ''
  const ignored =
    (query.status && !status) || (query.failureCategory && !failureCategory) ? true : false
  const page = readPage(query.page)
  const filters = { status, failureCategory }
  const filtered = Boolean(status || failureCategory)

  let messages = null
  let pagination = null
  let failure = null

  try {
    const answer = await listNotifications({
      status,
      failureCategory,
      page,
      perPage: LIST_PAGE_SIZE,
    })

    messages = answer.messages
    pagination = answer.pagination
  } catch (error) {
    failure = error
  }

  const beyond = messages ? isPastTheEnd(messages.length, pagination, page) : false

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/operations', label: 'Operations' },
          { href: null, label: 'Notifications' },
        ]}
      />
      <h1 className="mt-3 text-h2 font-semibold text-ink">Notification queue</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Every message the outbox holds, in every status: dead letters, failures and scheduled
        retries first, the longest-waiting of them first, then everything else. Neither recipients
        nor contents are shown: this answers “did it go?”, not “who was it to?” or “what did it
        say?”. Sent means handed to the (simulated) mail service; this build has no real one, and
        nothing here can see an inbox.
      </p>

      <form
        method="get"
        action={PATH}
        className="mt-6 flex flex-wrap items-end gap-4 rounded-card border border-line bg-surface-subtle p-4"
      >
        <div className={FIELD}>
          <label htmlFor="notification-status" className="text-sm font-medium text-ink">
            Status
          </label>
          <select id="notification-status" name="status" defaultValue={status} className={CONTROL}>
            <option value="">Every status</option>
            {NOTIFICATION_STATUSES.map((member) => (
              <option key={member} value={member}>
                {notificationStatusInWords(member).label}
              </option>
            ))}
          </select>
        </div>
        <div className={FIELD}>
          <label htmlFor="notification-failure" className="text-sm font-medium text-ink">
            Failure
          </label>
          <select
            id="notification-failure"
            name="failureCategory"
            defaultValue={failureCategory}
            className={CONTROL}
          >
            <option value="">Any, or none</option>
            {FAILURE_CATEGORIES.map((member) => (
              <option key={member} value={member}>
                {FAILURE_CATEGORIES_IN_WORDS[member]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-control bg-action-primary px-4 text-sm font-semibold text-action-primary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Apply
        </button>
        {filtered ? (
          <Link href={PATH} className={CLEAR_LINK}>
            Clear the filters
          </Link>
        ) : null}
      </form>

      {ignored ? (
        <p className="mt-3 text-sm text-ink-muted">
          A filter in the address was not one this queue knows, so it was left out.
        </p>
      ) : null}

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The notification queue"
          action="see the notification queue"
          backHref="/operations"
          backLabel="Back to operations"
        />
      ) : null}

      {messages && beyond ? (
        <PastTheEnd page={page} pagination={pagination} filters={filters} filtered={filtered} />
      ) : null}

      {messages && messages.length === 0 && !beyond ? (
        <Empty
          title={filtered ? 'Nothing matches these filters' : 'The outbox is empty'}
          description={
            filtered
              ? 'No message is in that state. Clear the filters to see the whole outbox.'
              : 'It holds no message, in any status.'
          }
        />
      ) : null}

      {messages && messages.length > 0 ? (
        <>
          <AsOf asOf={new Date().toISOString()} />
          <ScrollableTable label="Notification queue">
            <table className="w-full min-w-[60rem] border-collapse text-sm">
              <caption className="sr-only">
                Outbox messages{pagination ? `, ${pagination.total} in all` : ''}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Message
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Attempts
                  </th>
                  <th scope="col" className={TH}>
                    Scheduled for
                  </th>
                  <th scope="col" className={TH}>
                    Last attempt
                  </th>
                  <th scope="col" className={TH}>
                    Handed to the mail service
                  </th>
                  <th scope="col" className={TH}>
                    Failure
                  </th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => {
                  const words = notificationStatusInWords(message.status)

                  return (
                    <tr key={message.id}>
                      <th scope="row" className={`${TD} font-normal`}>
                        <Link
                          href={`${PATH}/${encodeURIComponent(message.id)}`}
                          className={`${LINK} font-mono font-medium`}
                        >
                          {message.template}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {CHANNELS_IN_WORDS[message.channel] ?? message.channel}
                        </span>
                        {message.lastError ? (
                          <span className="mt-1 block max-w-md text-xs break-words text-ink-muted">
                            {message.lastError}
                          </span>
                        ) : null}
                      </th>
                      <td className={TD}>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            STATUS_TONE_CLASSES[words.tone] ?? STATUS_TONE_CLASSES.neutral
                          }`}
                        >
                          {words.label}
                        </span>
                      </td>
                      <td className={`${TD} tabular-nums`}>
                        {message.attempts} of {message.maxAttempts}
                      </td>
                      <td className={TD}>
                        <When value={message.scheduledFor} absent="Not scheduled" />
                      </td>
                      <td className={TD}>
                        <When value={message.lastAttemptAt} absent="Not tried" />
                      </td>
                      <td className={TD}>
                        <When value={message.sentAt} absent="Not handed over" />
                      </td>
                      <td className={TD}>
                        {message.failureCategory ? (
                          (FAILURE_CATEGORIES_IN_WORDS[message.failureCategory] ??
                          message.failureCategory)
                        ) : (
                          <span className="text-ink-subtle">None</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollableTable>

          {pagination ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing {messages.length} of {pagination.total}.
            </p>
          ) : null}
          <Pager pagination={pagination} filters={filters} />
        </>
      ) : null}
    </div>
  )
}
