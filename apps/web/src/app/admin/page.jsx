/**
 * The front of platform administration: what is waiting for the team at The
 * Desi Events.
 *
 * It used to send the reader on to the first section their session was
 * offered, because there was nothing here of its own. Now it is the area's
 * overview: one row per queue the team works, each with the figure the API
 * gives for it and the way to it. Events waiting for review (the moderation
 * queue), imported events waiting for "Approve and publish", organiser
 * invitations not yet accepted, and booking-fee refunds, which have no queue
 * (a refund is found by its order) and say so instead of showing a number.
 *
 * Every figure is the API's own count for the list it names, read the same
 * way that list's page reads it, and never invented: a row whose read fails
 * says so and still leads to its page, where the refusal is explained in
 * full. A row is drawn only for somebody whose session holds the capability
 * its page asks for; the API asks again on every read.
 *
 * Not a grid of link cards repeating the rail: the rail is the way around
 * the area, and this page is about what needs doing.
 *
 * @module app/admin/page
 */

import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { PageHeader } from '../../components/workspace-kit.jsx'
import { sessionCan } from '../../lib/capabilities.js'
import { getPendingImports } from '../../lib/imports-api.js'
import { getModerationQueue } from '../../lib/organizer-api.js'
import { readSession } from '../../lib/session.js'
import { getOrganizerInvitations } from '../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Platform administration',
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} Queue
 * @property {string} id A stable key, also the row's heading id.
 * @property {string} title What the queue is.
 * @property {string} capability What a session must hold to be shown it.
 * @property {string} href Where it is worked.
 * @property {string} action The link's words.
 * @property {string} icon The row's glyph.
 * @property {function(number): string} [describe] The sentence under the figure.
 * @property {function(): Promise<number>} [count] Reads the figure from the API.
 * @property {string} [note] For a queue with no figure: what the page does instead.
 */

/**
 * The number of entries a list answer holds: the API's own total when it
 * paginates, the length of the list when it does not.
 *
 * @param {object[]} list The entries returned.
 * @param {object|null} pagination The answer's pagination.
 * @returns {number} The count.
 */
export function countOf(list, pagination) {
  return Number.isInteger(pagination?.total) ? pagination.total : list.length
}

/**
 * @param {number} count A figure.
 * @param {string} one The noun for one.
 * @param {string} many The noun for several.
 * @returns {string} "1 event", "3 events".
 */
function plural(count, one, many) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * The queues the overview can show, in the order the team works them.
 *
 * @type {ReadonlyArray<Queue>}
 */
export const QUEUES = Object.freeze([
  {
    id: 'review',
    title: 'Events waiting for review',
    capability: 'moderation:review',
    href: '/moderation/events',
    action: 'Review events',
    icon: 'shield',
    describe: (count) =>
      count === 0
        ? 'Nothing is waiting for a moderator.'
        : `${plural(count, 'event is', 'events are')} waiting for a moderator before it can be published.`,
    count: async () => {
      const { events, pagination } = await getModerationQueue()

      return countOf(events, pagination)
    },
  },
  {
    id: 'imports',
    title: 'Imported events waiting for approval',
    capability: 'event:import',
    href: '/admin/imports',
    action: 'Open imports',
    icon: 'upload',
    describe: (count) =>
      count === 0
        ? 'Every imported event has been approved or set aside.'
        : `${plural(count, 'imported event is', 'imported events are')} waiting for “Approve and publish”.`,
    count: async () => (await getPendingImports()).pending?.total ?? 0,
  },
  {
    id: 'invitations',
    title: 'Organiser invitations not yet accepted',
    capability: 'organizer:invite',
    href: '/admin/organizer-invitations',
    action: 'See invitations',
    icon: 'mail',
    describe: (count) =>
      count === 0
        ? 'No invitation is waiting to be accepted.'
        : `${plural(count, 'invitation is', 'invitations are')} waiting for the organiser to accept.`,
    count: async () => {
      const { invitations, pagination } = await getOrganizerInvitations({ status: 'PENDING' })

      return countOf(invitations, pagination)
    },
  },
  {
    id: 'fee-refunds',
    title: 'Booking fee refunds',
    capability: 'platform_fee:refund',
    href: '/admin/fee-refunds',
    action: 'Refund a booking fee',
    icon: 'receipt',
    note: 'There is no queue: a booking fee is refunded by hand, one order at a time, found by its reference.',
  },
])

/**
 * Read one queue's figure, keeping a failure to the row it belongs to.
 *
 * @param {Queue} queue The queue.
 * @returns {Promise<{queue: Queue, count: number|null, failed: boolean}>} The figure, or a failure.
 */
async function readQueue(queue) {
  if (!queue.count) return { queue, count: null, failed: false }

  try {
    return { queue, count: await queue.count(), failed: false }
  } catch {
    return { queue, count: null, failed: true }
  }
}

/**
 * One queue: its figure, what the figure means, and the way to it.
 *
 * @param {object} props Component props.
 * @param {Queue} props.queue The queue.
 * @param {number|null} props.count Its figure, when it has one and it was read.
 * @param {boolean} props.failed Whether reading it failed.
 * @returns {JSX.Element} The row.
 */
function QueueRow({ queue, count, failed }) {
  const headingId = `queue-${queue.id}`
  const waiting = Number.isInteger(count) && count > 0

  return (
    <li
      aria-labelledby={headingId}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 py-6 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
    >
      <span
        aria-hidden="true"
        className={`flex size-11 items-center justify-center rounded-control ${
          waiting ? 'bg-accent-soft text-accent-strong' : 'bg-surface-subtle text-ink-muted'
        }`}
      >
        <Icon name={queue.icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 id={headingId} className="text-title text-ink">
          {queue.title}
        </h2>
        {queue.note ? (
          <p className="mt-1 max-w-[60ch] text-label text-ink-muted">{queue.note}</p>
        ) : failed ? (
          <p className="mt-1 max-w-[60ch] text-label text-ink-muted">
            This figure could not be read just now. The page itself says why.
          </p>
        ) : (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <data
              value={count}
              className="font-display text-h2 leading-none font-bold text-ink tabular-nums"
            >
              {count.toLocaleString('en-US')}
            </data>
            <span className="text-label text-ink-muted">{queue.describe(count)}</span>
          </p>
        )}
      </div>
      <Link
        href={queue.href}
        className="col-start-2 inline-flex min-h-11 items-center gap-2 justify-self-start rounded-control text-label font-semibold text-accent-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:col-start-3 sm:justify-self-end"
      >
        {queue.action}
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>
    </li>
  )
}

/**
 * The overview.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AdminPage() {
  const session = await readSession()
  const offered = QUEUES.filter((queue) => sessionCan(session, queue.capability))
  const rows = await Promise.all(offered.map(readQueue))

  return (
    <div>
      <PageHeader
        title="Platform administration"
        description="What is waiting for the team at The Desi Events. Each figure is the count the list behind it holds right now."
      />
      {rows.length > 0 ? (
        <ul
          aria-label="Waiting for the team"
          className="mt-8 divide-y divide-line border-y border-line"
        >
          {rows.map((row) => (
            <QueueRow key={row.queue.id} {...row} />
          ))}
        </ul>
      ) : (
        <p className="mt-8 max-w-[60ch] text-body text-ink-muted">
          Nothing in this area keeps a queue this account works. Its sections are in the menu.
        </p>
      )}
    </div>
  )
}
