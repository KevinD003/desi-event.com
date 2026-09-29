/**
 * Promo codes: the discounts an organisation offers, and making new ones.
 *
 * Offered to members who hold `promo:manage` in an organisation (event
 * managers and up). A code is a bearer discount — whoever reads it can use
 * it — so viewers, staff, door scanners and finance are not shown them, and
 * the API refuses them whatever this page does.
 *
 * The page lists each code with its discount, what it applies to, its window
 * in a stated zone, how often it has been used, and its status as a word and
 * a shape, never a colour alone. An optional `?eventId=` narrows the list to
 * one event's codes and the organisation-wide ones: the query carries ids,
 * never a code. The list is paged (`?page=`, digits only), with the count in
 * the heading the organisation's total, not the length of one page.
 *
 * Making a code, pausing, resuming and deleting are client components
 * (`components/promo-code-form.jsx`, `components/promo-code-actions.jsx`);
 * making and resuming ask for a recent second factor when the API does.
 *
 * @module app/organizer/promo-codes/page
 */

import Link from 'next/link'

import { ScrollableTable } from '../../../components/money-figure.jsx'
import { AsOf, Empty, Forbidden } from '../../../components/page-state.jsx'
import { PromoCodeActions } from '../../../components/promo-code-actions.jsx'
import { PromoCodeForm } from '../../../components/promo-code-form.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { TEXT_LINK } from '../../../components/link-classes.js'
import { StatusIcon } from '../../../components/ui.jsx'
import { listPromoCodes } from '../../../lib/organizer-api.js'
import {
  describeDiscount,
  organisationZone,
  promoStatusLabel,
  promoWindowText,
  usesText,
} from '../../../lib/promo.js'
import { membershipsWith, readSession } from '../../../lib/session.js'
import { listOrganizationEvents } from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Promo codes', robots: { index: false, follow: false } }

/** What an id in the query string must look like before it is sent anywhere. */
const ID_SHAPE = /^[a-z][a-z0-9]{7,31}$/u

/** What a page number in the query string must look like. */
const PAGE_SHAPE = /^[1-9][0-9]{0,4}$/u

/** Classes for a Previous or Next link. */
const PAGER =
  'inline-flex min-h-11 items-center justify-center rounded-control border border-action-secondary-line bg-action-secondary px-4 text-sm font-semibold text-action-secondary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * The page asked for, or the first.
 *
 * @param {Record<string, string>} query The query string.
 * @returns {number} A page number, 1 or more.
 */
function readPage(query) {
  return typeof query?.page === 'string' && PAGE_SHAPE.test(query.page) ? Number(query.page) : 1
}

/**
 * Previous and Next, as links, only where there is somewhere to go.
 *
 * @param {object} props Component props.
 * @param {{page: number, totalPages: number, hasNextPage: boolean}} props.pagination The API's page counters.
 * @param {function(number): string} props.hrefFor The link to a page.
 * @returns {JSX.Element|null} The navigation, or nothing for a single page.
 */
function Pager({ pagination, hrefFor }) {
  const previous = pagination.page > 1
  const next = Boolean(pagination.hasNextPage)

  if (!previous && !next) return null

  return (
    <nav aria-label="Promo code pages" className="mt-6 flex items-center justify-between gap-4">
      {previous ? (
        <Link
          href={hrefFor(Math.min(pagination.page - 1, pagination.totalPages || 1))}
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
        <Link href={hrefFor(pagination.page + 1)} className={PAGER}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

/** A header cell. */
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-3 align-top text-ink'

/** The glyph beside each status word. */
const STATUS_TONES = Object.freeze({
  ACTIVE: 'success',
  PAUSED: 'warning',
  SCHEDULED: 'pending',
  ENDED: 'neutral',
  USED_UP: 'neutral',
})

/**
 * Read one thing, reporting a failure rather than throwing it.
 *
 * @param {Function} load What to call.
 * @returns {Promise<{value: object|null, error: object|null}>} What came back.
 */
async function attempt(load) {
  try {
    return { value: await load(), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

/**
 * @typedef {object} PromoCodesPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The promo codes screen.
 *
 * @param {PromoCodesPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PromoCodesPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()
  const organizations = membershipsWith(session, 'promo:manage')

  if (organizations.length === 0) {
    return <Forbidden area="Promo codes" backHref="/organizer" backLabel="Back to the workspace" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === query.organizationId) ??
    organizations[0]
  const organizationId = selected.organizationId
  const eventId =
    typeof query.eventId === 'string' && ID_SHAPE.test(query.eventId) ? query.eventId : null
  const page = readPage(query)

  const [list, eventList] = await Promise.all([
    attempt(() => listPromoCodes(organizationId, { eventId, page })),
    attempt(() => listOrganizationEvents(organizationId)),
  ])

  const events = (eventList.value?.events ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    timezone: event.timezone,
    currency: event.currency ?? null,
  }))
  const zoneOf = new Map(events.map((event) => [event.id, event.timezone]))
  const wideZone = organisationZone(events)
  const filtered = eventId ? (events.find((event) => event.id === eventId) ?? null) : null
  const codes = list.value?.codes ?? []
  const pagination = list.value?.pagination ?? null
  const total = Number.isInteger(pagination?.total) ? pagination.total : codes.length
  const base = `/organizer/promo-codes?organizationId=${encodeURIComponent(organizationId)}`
  const hrefFor = (target) =>
    `${base}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}${target > 1 ? `&page=${target}` : ''}`

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Sales
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Promo codes</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Discounts {selected.organizationName ?? 'this organisation'} offers at checkout. Anybody who
        has a code can use it, so share it only with the people it is for. A code for one event
        works only there; one for every event works across this organiser’s events.
      </p>

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.organizationId === organizationId

              return (
                <li key={organization.organizationId}>
                  <Link
                    href={`/organizer/promo-codes?organizationId=${encodeURIComponent(organization.organizationId)}`}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                        : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                    }`}
                  >
                    {organization.organizationName ?? organization.organizationId}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {eventId ? (
        <p className="mt-4 text-sm text-ink">
          Showing the codes for {filtered ? filtered.title : 'one event'} and the codes for every
          event.{' '}
          <Link href={base} className={TEXT_LINK}>
            Show every code
          </Link>
        </p>
      ) : null}

      {list.error ? (
        <ReadRefusal
          error={list.error}
          what="This organisation’s promo codes"
          action="see these promo codes"
          backHref="/organizer"
          backLabel="Back to the workspace"
        />
      ) : (
        <section aria-labelledby="codes-heading" className="mt-8">
          <h2 id="codes-heading" className="text-xl font-semibold text-ink">
            Codes <span className="font-normal text-ink-muted">({total})</span>
          </h2>
          <AsOf asOf={new Date().toISOString()} />
          {pagination && pagination.totalPages > 1 && codes.length > 0 ? (
            <p className="mt-1 text-sm text-ink-muted">
              Codes {(pagination.page - 1) * pagination.perPage + 1} to{' '}
              {(pagination.page - 1) * pagination.perPage + codes.length} of {total}, newest first.
            </p>
          ) : null}

          {codes.length === 0 && total > 0 ? (
            <Empty
              title={`There are no codes on page ${page}`}
              description={`This list has ${total === 1 ? 'one code' : `${total} codes`}, and this page is past the last of them.`}
            />
          ) : codes.length === 0 ? (
            <Empty
              title="No promo codes"
              description={
                eventId
                  ? 'No code applies to this event. Codes you make below appear here.'
                  : 'This organiser has no promo codes. Codes you make below appear here.'
              }
            />
          ) : (
            <ScrollableTable label="Promo codes">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <caption className="sr-only">
                  Promo codes of {selected.organizationName ?? 'this organisation'}, with their
                  discounts, windows, uses and status
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Discount
                    </th>
                    <th scope="col" className={TH}>
                      Applies to
                    </th>
                    <th scope="col" className={TH}>
                      Window
                    </th>
                    <th scope="col" className={TH}>
                      Uses
                    </th>
                    <th scope="col" className={TH}>
                      Status
                    </th>
                    <th scope="col" className={TH}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => {
                    const status = promoStatusLabel(code.status)
                    const zone = (code.eventId && zoneOf.get(code.eventId)) || wideZone

                    return (
                      <tr key={code.id}>
                        <th scope="row" className={`${TD} font-mono font-semibold`}>
                          {code.code}
                        </th>
                        <td className={TD}>{describeDiscount(code)}</td>
                        <td className={TD}>{code.event ? code.event.title : 'All events'}</td>
                        <td className={`${TD} text-ink-muted`}>{promoWindowText(code, zone)}</td>
                        <td className={TD}>{usesText(code)}</td>
                        <td className={TD}>
                          <span className="inline-flex items-center gap-1.5">
                            <StatusIcon tone={STATUS_TONES[code.status] ?? 'neutral'} />
                            {status.text}
                          </span>
                        </td>
                        <td className={TD}>
                          <PromoCodeActions
                            organizationId={organizationId}
                            code={{
                              id: code.id,
                              code: code.code,
                              status: code.status,
                              active: code.active,
                              endsAt: code.endsAt ?? null,
                              redemptionCount: code.redemptionCount,
                              ordersCount: code.ordersCount,
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          )}
          {pagination ? <Pager pagination={pagination} hrefFor={hrefFor} /> : null}
        </section>
      )}

      <section className="mt-10">
        {eventList.error ? (
          <p className="mb-2 text-sm text-ink-muted">
            This organisation’s events could not be read, so a new code can only be for every event
            just now.
          </p>
        ) : null}
        <PromoCodeForm
          key={organizationId}
          organizationId={organizationId}
          events={events}
          defaultEventId={eventId}
          timeZone={wideZone}
        />
      </section>
    </div>
  )
}
