/**
 * The orders somebody has placed while signed in: their purchase history.
 *
 * ## Simulated, said once and plainly
 *
 * No payment on this site moves money. That is said near the top in a full
 * sentence, and again in each paid order's own status ("Paid — simulated"),
 * because a notice is skimmed and a status is read. Neither says a payment
 * "succeeded".
 *
 * ## A page, not "your recent orders"
 *
 * `GET /v1/orders` is paged, newest first. The page says which slice it is
 * showing and of how many, and offers real Previous and Next links with
 * `page=` in the query — a list that silently stopped at twenty would read as
 * the whole history.
 *
 * ## A failure is not an empty list
 *
 * If the read fails, the page says so and shows no list at all. "You have no
 * orders yet" drawn over a dead API would tell somebody their tickets were
 * gone. The refusal is drawn by `ReadRefusal`, which never repeats the API's
 * message.
 *
 * Signing in is the account layout's job; this page renders only inside it.
 *
 * @module app/account/orders/page
 */

import Link from 'next/link'

import { Empty } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { getMyOrders } from '../../../lib/account-api.js'
import { formatAmount } from '../../../lib/pricing.js'
import {
  eventWhenText,
  orderHref,
  orderStatusMeaning,
  orderTitle,
  ordersPageHref,
  readPage,
  ticketCount,
} from './order-status.js'
import { StatusChip } from './status-chip.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orders', robots: { index: false, follow: false } }

/** How many orders a page shows. The API's own default. */
const PER_PAGE = 20

/** Classes for a text link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/** Classes for a Previous or Next link. */
const PAGER =
  'inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface-raised px-4 text-sm font-medium text-ink hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * One fact on an order card, omitted when there is nothing to say.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children The value.
 * @returns {JSX.Element|null} The row, or nothing.
 */
function Detail({ term, children }) {
  if (children === '' || children === null || children === undefined) return null

  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-subtle">{term}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  )
}

/**
 * One order.
 *
 * The event is the heading and the link, because that is what somebody is
 * looking for; the reference is beside it for anybody who has one to match.
 *
 * @param {object} props Component props.
 * @param {object} props.order One order from `GET /v1/orders`.
 * @returns {JSX.Element} The card.
 */
function OrderCard({ order }) {
  const count = ticketCount(order)

  return (
    <li className="rounded-card border border-line bg-surface p-4 focus-within:ring-2 focus-within:ring-focus sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold text-ink sm:text-lg">
          <Link
            href={orderHref(order.reference)}
            className="rounded-sm underline decoration-accent-line underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {orderTitle(order)}
          </Link>
        </h2>
        <StatusChip meaning={orderStatusMeaning(order.status)} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Detail term="When">{eventWhenText(order.event)}</Detail>
        <Detail term="Reference">
          <span className="font-mono">{order.reference}</span>
        </Detail>
        <Detail term="Tickets">{String(count)}</Detail>
        <Detail term="Total">{formatAmount(order.totalCents, order.currency)}</Detail>
      </dl>
    </li>
  )
}

/**
 * Previous and Next, as links, only where there is somewhere to go.
 *
 * @param {object} props Component props.
 * @param {object} props.pagination The API's page counters.
 * @returns {JSX.Element|null} The navigation, or nothing for a single page.
 */
function Pager({ pagination }) {
  const previous = pagination.page > 1
  const next = Boolean(pagination.hasNextPage)

  if (!previous && !next) return null

  return (
    <nav aria-label="Order pages" className="mt-8 flex items-center justify-between gap-4">
      {previous ? (
        <Link
          href={ordersPageHref(Math.min(pagination.page - 1, pagination.totalPages || 1))}
          className={PAGER}
        >
          Previous
        </Link>
      ) : (
        <span />
      )}

      {pagination.totalPages > 0 ? (
        <p className="text-sm text-ink-muted">
          Page {pagination.page} of {pagination.totalPages}
        </p>
      ) : null}

      {next ? (
        <Link href={ordersPageHref(pagination.page + 1)} className={PAGER}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

/**
 * Which slice of the history this is, in words.
 *
 * @param {object} props Component props.
 * @param {number} props.shown How many orders are on this page.
 * @param {object} props.pagination The API's page counters.
 * @returns {JSX.Element} The sentence.
 */
function Range({ shown, pagination }) {
  const first = (pagination.page - 1) * pagination.perPage + 1
  const last = first + shown - 1

  return (
    <p className="mt-6 text-sm text-ink-muted">
      {pagination.total === shown
        ? `${shown === 1 ? 'One order' : `All ${shown} orders`}, newest first.`
        : `Orders ${first} to ${last} of ${pagination.total}, newest first.`}
    </p>
  )
}

/**
 * @typedef {object} OrdersPageProps
 * @property {Promise<Record<string, string|string[]|undefined>>} searchParams The URL's query.
 */

/**
 * The orders page.
 *
 * @param {OrdersPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrdersPage({ searchParams }) {
  const page = readPage(await searchParams)

  let orders = []
  let pagination = null
  let failure = null

  try {
    ;({ orders, pagination } = await getMyOrders({ page, perPage: PER_PAGE }))
  } catch (error) {
    failure = error
  }

  // Counters the API did not send are rebuilt from what it did, so a missing
  // block cannot be read as "there is more".
  const counters = pagination ?? {
    page,
    perPage: PER_PAGE,
    total: orders.length,
    totalPages: orders.length > 0 ? 1 : 0,
    hasNextPage: false,
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Your orders</h1>
      <p className="mt-2 text-ink-muted">
        Orders placed while signed in to this account. Open one to see what it was for, what it cost
        and the tickets it gave you.
      </p>

      <p className="mt-4 rounded-card border border-status-mock/25 bg-status-mock-soft p-4 text-sm text-ink">
        <strong className="font-semibold">Payments on this site are simulated.</strong> No card was
        charged and no money moved for any order here, whatever its status says.
      </p>

      {failure ? <ReadRefusal error={failure} what="Your orders" action="see your orders" /> : null}

      {!failure && orders.length === 0 && counters.total === 0 ? (
        <>
          <Empty
            title="You have no orders yet"
            description="Tickets you buy while signed in to this account appear here."
          />
          <p className="mt-4">
            <Link href="/events" className={LINK}>
              Find an event
            </Link>
          </p>
        </>
      ) : null}

      {!failure && orders.length === 0 && counters.total > 0 ? (
        <>
          <Empty
            title={`There are no orders on page ${page}`}
            description={`This account has ${counters.total === 1 ? 'one order' : `${counters.total} orders`}, and this page is past the last of them.`}
          />
          <p className="mt-4">
            <Link href={ordersPageHref(1)} className={LINK}>
              Go to the newest orders
            </Link>
          </p>
        </>
      ) : null}

      {!failure && orders.length > 0 ? (
        <>
          <Range shown={orders.length} pagination={counters} />
          <ul className="mt-4 grid gap-3">
            {orders.map((order) => (
              <OrderCard key={order.reference} order={order} />
            ))}
          </ul>
          <Pager pagination={counters} />
        </>
      ) : null}
    </div>
  )
}
