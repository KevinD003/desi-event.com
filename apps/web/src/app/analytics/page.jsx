/**
 * Organiser analytics: visits to an organisation's event pages, or to one of
 * them, beside what it sold, holds, is owed and let in.
 *
 * ## Nothing is computed here
 *
 * Every figure comes from the API, which derives money from the append-only
 * ledger, counts from the rows that are the fact, and visits from the daily
 * totals its roll-up keeps. A screen that did its own arithmetic would be a
 * second opinion about somebody's sales, and two opinions is one too many. The
 * page formats and lays out; it does not add visits up.
 *
 * ## The chart and its table
 *
 * Visits per day are drawn as a server-rendered SVG with one count axis, a
 * legend and a text description, and the same figures are in a table below
 * it; the table is the equivalent, not a fallback.
 *
 * ## Who sees what
 *
 * An organisation's members see its figures when their role holds
 * `report:view`; only organisations the session says the caller belongs to are
 * offered, and asking for another is refused rather than substituted. A
 * platform administrator, who holds the platform list's `analytics:view_all`,
 * may open any organisation's or event's figures (usually from that list); the
 * API authorises the read through the platform's `report:view` and sends no
 * money to an account without the finance capability.
 *
 * ## Filters
 *
 * Links, not a form, so the page works with no JavaScript, is bookmarkable, and
 * announces the current selection through `aria-current`. The period defaults
 * to everything.
 *
 * @module app/analytics/page
 */

import Link from 'next/link'

import { CountFigure } from '../../components/count-figure.jsx'
import { Figure, ModeBanner, ScrollableTable } from '../../components/money-figure.jsx'
import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../components/page-state.jsx'
import { ReadRefusal } from '../../components/read-refusal.jsx'
import { CAPTION, NUM, ROW_TH, TABLE, TD, TH, TH_NUM } from '../../components/report-table.js'
import { TrafficChart } from '../../components/traffic-chart.jsx'
import {
  CardPlacements,
  EventsTraffic,
  TrafficByDay,
  TrafficSources,
  ticketAndSeatClicks,
} from '../../components/traffic-tables.jsx'
import { Alert } from '../../components/ui.jsx'
import { TEXT_LINK } from '../../components/workspace-kit.jsx'
import { admits } from '../../lib/areas.js'
import { getAnalytics } from '../../lib/organizer-api.js'
import { formatPrice } from '../../lib/pricing.js'
import { readSession, sessionCan } from '../../lib/session.js'
import { CHART_CAPTION } from '../../lib/traffic-chart.js'
import {
  DEFAULT_ANALYTICS_PERIOD,
  DEMONSTRATION_NOTICE,
  ORDERS_PAID_ON_DAYS_LABEL,
  PERIODS,
  REFUNDED_ORDERS_NOTE,
  VISIT_COUNTING_NOTES,
  freshness,
  periodFor,
  periodFrom,
  trafficStatusLabel,
  websiteLinkLine,
} from '../../lib/traffic.js'
import { formatInstant } from '../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Analytics', robots: { index: false, follow: false } }

/**
 * Orders booked to pay at the venue that wait for their payment at the door,
 * and are not counted as paid until it is taken (SPEC3 §9.10).
 *
 * @param {number} count `funnel.atVenue.bookedUnpaid`.
 * @returns {string|null} The sentence, or null for none.
 */
export function bookedUnpaidSentence(count) {
  if (!count || count < 1) return null

  return count === 1
    ? '1 order booked to pay at the venue is waiting for payment at the door and is not counted as paid.'
    : `${count.toLocaleString('en-US')} orders booked to pay at the venue are waiting for payment at the door and are not counted as paid.`
}

/** Where tickets paid at the venue are counted, and where their money is not (SPEC3 §9.10). */
export const VENUE_COUNTING_NOTE =
  'Tickets booked to pay at the venue are in the ticket counts. What is paid at the door is taken by the organiser and is not in the money figures, which come from the ledger.'

/**
 * Unpaid tickets booked to pay at the venue that were cancelled, their places
 * freed (SPEC3-XI §9.10).
 *
 * @param {number} count `venuePayments.cancelledUnpaidTickets`.
 * @returns {string|null} The sentence, or null for none.
 */
export function cancelledUnpaidSentence(count) {
  if (!count || count < 1) return null

  return count === 1
    ? '1 unpaid ticket booked to pay at the venue was cancelled, and its place was freed.'
    : `${count.toLocaleString('en-US')} unpaid tickets booked to pay at the venue were cancelled, and their places were freed.`
}

/** The funnel's heading: it starts with visitors and ends with paid orders. */
export const FUNNEL_TITLE = 'From visit to payment'

/** The classes of a period or organisation chip, current or not. */
const CHIP =
  'inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'
const CHIP_CURRENT = `${CHIP} bg-action-primary font-semibold text-action-primary-ink shadow-control`
const CHIP_OTHER = `${CHIP} border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink`

/**
 * One breakdown, as a table.
 *
 * A `caption` rather than a heading above the table, because the caption is
 * what a screen reader announces when it enters the table and is the only
 * label that travels with it.
 *
 * @param {object} props Component props.
 * @param {string} props.caption What this table counts.
 * @param {string} props.unit What the first numeric column holds.
 * @param {Array<object>} props.rows The grouped rows.
 * @param {boolean} props.money Whether to show the value column.
 * @returns {JSX.Element} The table, or an empty note.
 */
function Breakdown({ caption, unit, rows, money }) {
  if (rows.length === 0) {
    return <Empty title={caption} description="Nothing has been sold in this grouping." />
  }

  // Unpaid tickets booked to pay at the venue and cancelled: not counted as
  // sold (their places went back to stock), so said beside the count when any
  // were (SPEC3-XI §9.10).
  const cancelled = rows.some((row) => (row.cancelledQuantity ?? 0) > 0)

  return (
    <ScrollableTable label={caption}>
      <table className={TABLE}>
        <caption className={CAPTION}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Item
            </th>
            <th scope="col" className={TH_NUM}>
              {unit}
            </th>
            {money ? (
              <th scope="col" className={TH_NUM}>
                Line value
              </th>
            ) : null}
            <th scope="col" className={TH_NUM}>
              Refunded
            </th>
            {cancelled ? (
              <th scope="col" className={TH_NUM}>
                Cancelled unpaid
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.id}-${row.currency}`}>
              <th scope="row" className={ROW_TH}>
                {row.label}
              </th>
              <td className={NUM}>{row.quantity}</td>
              {money ? (
                <td className={NUM}>{formatPrice(row.lineValueCents, row.currency)}</td>
              ) : null}
              <td className={NUM}>{row.refundedQuantity}</td>
              {cancelled ? <td className={NUM}>{row.cancelledQuantity ?? 0}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * The visits: how fresh they are, the six figures, the chart and its table,
 * where they came from and, for an organisation, each event's.
 *
 * @param {object} props Component props.
 * @param {object} props.traffic The API's `traffic` branch.
 * @param {boolean} props.eventView Whether the page is about one event.
 * @param {string} props.organizationId Whose figures.
 * @param {boolean} props.own Whether the reader belongs to the organisation.
 * @param {Record<string, string>} props.keep The period, for each event's link.
 * @returns {JSX.Element} The sections.
 */
function Visits({ traffic, eventView, organizationId, own, keep }) {
  const fresh = freshness(traffic)
  const totals = traffic.totals
  const percent = traffic.conversion.visitorToOrderPercent

  return (
    <>
      {traffic.includesDemonstration ? (
        <Alert variant="warning" title={DEMONSTRATION_NOTICE.title} className="mt-6">
          {DEMONSTRATION_NOTICE.body}
        </Alert>
      ) : null}

      <section aria-labelledby="visits-heading" className="mt-8">
        <h2 id="visits-heading" className="text-xl font-semibold text-ink">
          {eventView
            ? 'Visits to this event’s page'
            : own
              ? 'Visits to your event pages'
              : 'Visits to this organisation’s event pages'}
        </h2>
        {fresh.tone === 'stale' ? (
          <Alert variant="warning" className="mt-3">
            {fresh.sentence} Days are UTC days.
          </Alert>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">{fresh.sentence} Days are UTC days.</p>
        )}

        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CountFigure
            label="Page views"
            value={totals.views}
            hint="Each time the page was opened. Opening it again within half an hour counts once."
          />
          <CountFigure
            label="Visitors"
            value={totals.visitors}
            hint={`Counted once a day for each event, without cookies and without keeping anybody’s address. Somebody who comes back on another day is counted again.${
              eventView ? '' : ' This total adds up each event’s daily visitors.'
            }`}
          />
          <CountFigure
            label="Event card clicks"
            value={totals.cardClicks}
            hint="Clicks on the event’s card on the home page, the events list and search results."
          />
          <CountFigure
            label="Ticket and seat clicks"
            value={ticketAndSeatClicks(totals)}
            hint="Presses of “Choose tickets” and “Choose seats” on the event page."
          />
          <CountFigure
            label={own ? 'Visits to your website' : 'Visits to the organiser’s website'}
            value={totals.websiteRedirects}
            hint={`People sent to ${
              own ? 'your own website' : 'the organiser’s own website'
            } by the event page’s link. Counted only while the Desi-Event team has that link turned on.`}
          />
          <CountFigure
            label="Visitors to paid orders"
            value={percent === null ? 'No visitors counted' : `${percent}%`}
            hint={`${ORDERS_PAID_ON_DAYS_LABEL} divided by visitors over the same days. ${REFUNDED_ORDERS_NOTE} An order can come from somebody whose visit was not counted, so this is a guide rather than an exact rate.`}
          />
        </dl>

        {eventView ? (
          <p className="mt-4 text-sm text-ink">
            {websiteLinkLine(traffic.event, { reader: own ? 'organiser' : 'administrator' })}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="per-day-heading" className="mt-8">
        <h2 id="per-day-heading" className="text-xl font-semibold text-ink">
          Per day
        </h2>
        <TrafficChart id="visits-chart" caption={CHART_CAPTION} days={traffic.byDay} />
        <TrafficByDay days={traffic.byDay} open={traffic.byDay.length <= 31} />
        <p className="mt-2 text-sm text-ink-muted">
          {ORDERS_PAID_ON_DAYS_LABEL} counts the orders paid in each UTC day. {REFUNDED_ORDERS_NOTE}
        </p>
        {traffic.seriesTruncated ? (
          <p className="mt-2 text-sm text-ink-muted">
            Only the latest 366 days are drawn and listed; the totals above cover the whole period.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="sources-heading" className="mt-8">
        <h2 id="sources-heading" className="text-xl font-semibold text-ink">
          Where visits came from
        </h2>
        <TrafficSources sources={traffic.sources} total={totals.views} />
        <CardPlacements placements={traffic.cardPlacements} />
        <p className="mt-3 text-sm text-ink-muted">
          Only the referring site’s name is used to sort a visit into these groups; the address of
          the page somebody came from is never sent or kept.
        </p>
      </section>

      {eventView ? null : (
        <section aria-labelledby="events-heading" className="mt-8">
          <h2 id="events-heading" className="text-xl font-semibold text-ink">
            {own ? 'Your events' : 'This organisation’s events'}
          </h2>
          <EventsTraffic
            rows={traffic.byEvent}
            organizationId={organizationId}
            keep={keep}
            caption={
              own ? 'Your events in this period' : 'This organisation’s events in this period'
            }
          />
        </section>
      )}
    </>
  )
}

/**
 * @typedef {object} AnalyticsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The analytics page.
 *
 * @param {AnalyticsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AnalyticsPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()

  const organizations = (session?.memberships ?? [])
    .filter((membership) => sessionCan(session, 'report:view', membership.organizationId))
    .map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName ?? membership.organizationId,
    }))

  const platformViewer = sessionCan(session, 'analytics:view_all')
  const asked = query.organizationId ?? null
  const chosen = organizations.find((organization) => organization.id === asked)

  // An organisation asked for and not available is refused, not substituted.
  //
  // Falling back to the first membership was the first draft, and it is a quiet
  // lie on a money screen: the address says one organisation and the page shows
  // another's figures, with nothing on it saying so. The refusal reads the same
  // whether the identifier belongs to somebody else or to nobody, so it is not
  // an oracle either. A platform administrator is the exception: they may read
  // any organisation's figures, and the API authorises that read itself.
  if (asked && !chosen && !platformViewer) {
    return <Forbidden area="Analytics for that organisation" />
  }

  const organizationId = chosen?.id ?? (asked && platformViewer ? asked : organizations[0]?.id)
  const outside =
    Boolean(organizationId) && !chosen && organizations.every((o) => o.id !== organizationId)

  // The period: an explicit window wins; otherwise a named period, by default
  // everything.
  const explicit = Boolean(query.from || query.to)
  const period = explicit ? null : periodFor(query.range, DEFAULT_ANALYTICS_PERIOD)
  const from = explicit ? query.from : (periodFrom(period.key) ?? undefined)
  const to = explicit ? query.to : undefined
  const eventId = query.eventId || undefined
  const keep = explicit ? { from: query.from, to: query.to } : { range: period.key }

  let view = null
  let failure = null
  let unknownEvent = false

  if (organizationId) {
    const read = (narrowTo) =>
      getAnalytics({
        organizationId,
        currency: query.currency ?? 'USD',
        eventId: narrowTo,
        from,
        to,
      })

    try {
      view = await read(eventId)

      // An event of another organisation, or of none, matches nothing: say so,
      // then show the organisation's own figures rather than a page of zeros.
      if (eventId && !view.traffic?.event && view.organizationName !== null) {
        unknownEvent = true
        view = await read(undefined)
      }
    } catch (error) {
      failure = error
    }
  }

  /**
   * A link that keeps the current filters and changes some of them.
   *
   * @param {Record<string, string|undefined>} changes What to change.
   * @returns {string} The href.
   */
  const withFilters = (changes) => {
    const next = new URLSearchParams()

    for (const [key, value] of Object.entries({ ...query, ...changes })) {
      if (value) next.set(key, value)
    }

    return `/analytics?${next.toString()}`
  }

  const event = view?.traffic?.event ?? null
  const organizationName = view?.organizationName ?? chosen?.name ?? null
  const organizationHref = withFilters({ eventId: undefined })
  const noSuchOrganization = Boolean(view) && view.organizationName === null && outside

  // The trail starts where this reader came from: the platform list for an
  // organisation they read from outside, and for a platform administrator the
  // organiser area does not admit (one with no organisation of their own, who
  // would be refused there); otherwise the organiser area, which is plain text
  // when it would refuse them too.
  const organiserCrumb = admits(session, 'organizer')
    ? { href: '/organizer/events', label: 'Organiser' }
    : { label: 'Organiser' }
  const fromPlatformList = outside || (platformViewer && !organiserCrumb.href)
  const trail = event
    ? outside
      ? [
          { href: '/analytics/events', label: 'Every event’s visits' },
          { href: organizationHref, label: organizationName ?? 'Organisation' },
          { label: event.title },
        ]
      : [organiserCrumb, { href: organizationHref, label: 'Analytics' }, { label: event.title }]
    : fromPlatformList
      ? [{ href: '/analytics/events', label: 'Every event’s visits' }, { label: 'Analytics' }]
      : [organiserCrumb, { label: 'Analytics' }]

  return (
    <div>
      <Breadcrumbs trail={trail} />

      <h1 className="mt-3 text-h2 font-semibold text-ink">
        {event ? `Analytics for ${event.title}` : 'Analytics'}
      </h1>
      {event ? (
        <p className="mt-1 text-ink-muted">
          {[
            organizationName,
            trafficStatusLabel(event),
            event.startsAt ? `starts ${formatInstant(event.startsAt)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : outside && organizationName ? (
        <p className="mt-1 text-ink-muted">{organizationName}</p>
      ) : null}
      <p className="mt-2 text-ink-muted">
        What this organisation’s event pages were visited for, what it sold, holds, is owed and let
        in. Visits are counted on this site without cookies; money is derived from the append-only
        ledger; everything else is counted from the tickets, seats and check-ins themselves.
      </p>

      {organizations.length === 0 && !platformViewer ? (
        <Empty
          title="No organisation to report on"
          description="This account is not a member of an organisation that it may see reports for."
        />
      ) : null}

      {organizations.length === 0 && platformViewer && !asked ? (
        <>
          <Empty
            title="No organisation of your own"
            description="You do not belong to an organisation, so nothing is shown here. As a platform administrator you can see every event’s visits, and open any event’s figures from there."
          />
          <p className="mt-3">
            <Link href="/analytics/events" className={TEXT_LINK}>
              See every event’s visits
            </Link>
          </p>
        </>
      ) : null}

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.id === organizationId

              return (
                <li key={organization.id}>
                  <Link
                    href={withFilters({ organizationId: organization.id, eventId: undefined })}
                    aria-current={current ? 'page' : undefined}
                    className={current ? CHIP_CURRENT : CHIP_OTHER}
                  >
                    {organization.name}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The analytics view"
          action="see this organisation’s analytics"
        />
      ) : null}

      {noSuchOrganization ? (
        <Empty title="No such organisation" description="No organisation has that reference." />
      ) : null}

      {view && !noSuchOrganization ? (
        <>
          <ModeBanner mode={view.mode} notice={view.modeNotice} />
          <AsOf asOf={new Date().toISOString()} />

          {unknownEvent ? (
            <Empty
              title="No such event here"
              description="No event with that reference belongs to this organisation. Nothing from another organisation is shown."
            />
          ) : null}

          <nav aria-label="Choose a period" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {PERIODS.map((each) => {
                const current = !explicit && period.key === each.key

                return (
                  <li key={each.key}>
                    <Link
                      href={withFilters({ range: each.key, from: undefined, to: undefined })}
                      aria-current={current ? 'page' : undefined}
                      className={current ? CHIP_CURRENT : CHIP_OTHER}
                    >
                      {each.label}
                    </Link>
                  </li>
                )
              })}
              {explicit ? (
                <li>
                  <span aria-current="page" className={CHIP_CURRENT}>
                    Custom period
                  </span>
                </li>
              ) : null}
            </ul>
          </nav>

          <p className="mt-2 text-sm text-ink-muted">
            Dates and windows are in <strong>{view.timeZone}</strong>. Money figures are in{' '}
            <strong>{view.currency}</strong> only — amounts in another currency are counted in their
            own rows and never added to these.
          </p>

          {view.traffic ? (
            <Visits
              traffic={view.traffic}
              eventView={Boolean(event)}
              organizationId={organizationId}
              own={!outside}
              keep={keep}
            />
          ) : null}

          {view.moneyVisible && view.money ? (
            <section aria-labelledby="money-heading" className="mt-8">
              <h2 id="money-heading" className="text-xl font-semibold text-ink">
                Money, from the ledger
              </h2>

              {view.money.integrity.imbalances.length > 0 ? (
                <p
                  role="status"
                  className="mt-3 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger"
                >
                  {view.money.integrity.imbalances.length} ledger batch
                  {view.money.integrity.imbalances.length === 1 ? ' does' : 'es do'} not add up.
                  Until somebody has looked, the figures below are built on something that should be
                  impossible.
                </p>
              ) : null}

              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Figure
                  label="Gross collected"
                  cents={view.money.totals.grossCollectedCents}
                  currency={view.currency}
                  hint="What buyers handed over, from the asset side of the ledger."
                />
                <Figure
                  label="Owed to this organisation"
                  cents={view.money.totals.organizerPayableCents}
                  currency={view.currency}
                  hint="A liability, not revenue. Refunds and disputes are held against it."
                />
                <Figure
                  label="Tax payable"
                  cents={view.money.totals.taxPayableCents}
                  currency={view.currency}
                  hint="Collected for an authority. Never revenue."
                />
              </dl>
            </section>
          ) : (
            <section aria-labelledby="money-heading" className="mt-8">
              <h2 id="money-heading" className="text-xl font-semibold text-ink">
                Money
              </h2>
              {view.moneyWithheld === 'STEP_UP' ? (
                <>
                  <Empty
                    title="Confirm your identity to see the money"
                    description="This account may see these figures, but the server will not send them to a session that has not presented a second factor recently. The counts below are unaffected."
                  />
                  <p className="mt-3 text-sm">
                    <Link
                      href={`/sign-in?next=${encodeURIComponent(`/analytics?organizationId=${view.organizationId}`)}`}
                      className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      Confirm your identity
                    </Link>
                  </p>
                </>
              ) : (
                <Empty
                  title="Money figures are not included for this account"
                  description="Seeing what an organisation is owed needs the finance capability in it. The figures are not hidden on this page — the server did not send them."
                />
              )}
            </section>
          )}

          <section aria-labelledby="tickets-heading" className="mt-8">
            <h2 id="tickets-heading" className="text-xl font-semibold text-ink">
              Tickets and attendance
            </h2>
            <ScrollableTable label="Tickets and attendance">
              <table className={TABLE}>
                <caption className={CAPTION}>Tickets and attendance</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Measure
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className={ROW_TH}>
                      Live tickets
                    </th>
                    <td className={NUM}>{view.tickets.live}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={ROW_TH}>
                      Admitted
                    </th>
                    <td className={NUM}>{view.checkIns.admitted}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={ROW_TH}>
                      Checked in
                    </th>
                    <td className={NUM}>
                      {view.checkIns.percent === null
                        ? 'No live tickets'
                        : `${view.checkIns.percent}%`}
                    </td>
                  </tr>
                  {view.tickets.byLostState.map((lost) => (
                    <tr key={lost.state}>
                      <th scope="row" className={ROW_TH}>
                        {lost.label}
                      </th>
                      <td className={NUM}>{lost.count}</td>
                    </tr>
                  ))}
                  {view.movement.transfers.map((transfer) => (
                    <tr key={transfer.status}>
                      <th scope="row" className={ROW_TH}>
                        Transfers {transfer.status.toLowerCase()}
                      </th>
                      <td className={NUM}>{transfer.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </section>

          <section aria-labelledby="inventory-heading" className="mt-8">
            <h2 id="inventory-heading" className="text-xl font-semibold text-ink">
              Inventory
            </h2>

            {view.inventory.generalAdmission.length > 0 ? (
              <ScrollableTable label="General admission inventory">
                <table className={TABLE}>
                  <caption className={CAPTION}>General admission</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Ticket type
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Sold
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Remaining
                      </th>
                      <th scope="col" className={TH}>
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.inventory.generalAdmission.map((type) => (
                      <tr key={type.ticketTypeId}>
                        <th scope="row" className={ROW_TH}>
                          {type.name}
                        </th>
                        <td className={NUM}>
                          {type.quantitySold} of {type.quantityTotal}
                        </td>
                        <td className={NUM}>{type.quantityRemaining}</td>
                        <td className={TD}>
                          {/* The word, not only a colour. */}
                          {type.oversold ? 'Oversold — investigate' : type.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            ) : (
              <Empty
                title="No general-admission tiers"
                description="This organisation sells no unreserved tickets, or none have been created."
              />
            )}

            {view.inventory.reserved.bySection.length > 0 ? (
              <ScrollableTable label="Reserved seats by section">
                <table className={TABLE}>
                  <caption className={CAPTION}>Reserved seats by section</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Section
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Seats
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Available
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Sold
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Blocked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.inventory.reserved.bySection.map((group) => (
                      <tr key={group.id ?? group.name}>
                        <th scope="row" className={ROW_TH}>
                          {group.name}
                        </th>
                        <td className={NUM}>{group.total}</td>
                        <td className={NUM}>{group.available}</td>
                        <td className={NUM}>{group.sold}</td>
                        <td className={NUM}>{group.blocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            ) : null}

            {view.inventory.reserved.byPriceZone.length > 0 ? (
              <ScrollableTable label="Reserved seats by price zone">
                <table className={TABLE}>
                  <caption className={CAPTION}>Reserved seats by price zone</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Price zone
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Seats
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Available
                      </th>
                      <th scope="col" className={TH_NUM}>
                        Sold
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.inventory.reserved.byPriceZone.map((group) => (
                      <tr key={group.id ?? group.name}>
                        <th scope="row" className={ROW_TH}>
                          {group.name}
                        </th>
                        <td className={NUM}>{group.total}</td>
                        <td className={NUM}>{group.available}</td>
                        <td className={NUM}>{group.sold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            ) : null}
          </section>

          {view.venuePayments &&
          (view.venuePayments.ticketsUnpaid > 0 ||
            view.venuePayments.paidAtDoorCents > 0 ||
            view.venuePayments.cancelledUnpaidTickets > 0) ? (
            <section aria-labelledby="venue-heading" className="mt-8">
              <h2 id="venue-heading" className="text-xl font-semibold text-ink">
                Paying at the venue
              </h2>
              <p className="mt-2 text-sm text-ink-muted">{VENUE_COUNTING_NOTE}</p>
              {cancelledUnpaidSentence(view.venuePayments.cancelledUnpaidTickets) ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {cancelledUnpaidSentence(view.venuePayments.cancelledUnpaidTickets)}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="sales-heading" className="mt-8">
            <h2 id="sales-heading" className="text-xl font-semibold text-ink">
              Sales
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Line value is what the order lines were priced at — not revenue. What the organisation
              keeps after fees, tax and everything given back is in the money section above.
            </p>

            <Breakdown
              caption="Sales by event"
              unit="Tickets"
              rows={view.sales.byEvent}
              money={view.moneyVisible}
            />
            <Breakdown
              caption="Sales by session"
              unit="Tickets"
              rows={view.sales.bySession}
              money={view.moneyVisible}
            />
            <Breakdown
              caption="Sales by ticket type"
              unit="Tickets"
              rows={view.sales.byTicketType}
              money={view.moneyVisible}
            />
            <Breakdown
              caption="Sales by date"
              unit="Tickets"
              rows={view.sales.byDate}
              money={view.moneyVisible}
            />
          </section>

          <section aria-labelledby="operations-heading" className="mt-8">
            <h2 id="operations-heading" className="text-xl font-semibold text-ink">
              Operations
            </h2>

            <ScrollableTable label="Notifications and exceptions">
              <table className={TABLE}>
                <caption className={CAPTION}>Notifications and exceptions</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Measure
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.notifications.map((row) => (
                    <tr key={row.status}>
                      <th scope="row" className={ROW_TH}>
                        Notifications {row.status.toLowerCase().replace(/_/gu, ' ')}
                      </th>
                      <td className={NUM}>{row.count}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className={ROW_TH}>
                      Reconciliation items open
                    </th>
                    <td className={NUM}>{view.exceptions.open}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={ROW_TH}>
                      Reconciliation items escalated
                    </th>
                    <td className={NUM}>{view.exceptions.escalated}</td>
                  </tr>
                </tbody>
              </table>
            </ScrollableTable>
          </section>

          <section aria-labelledby="funnel-heading" className="mt-8">
            <h2 id="funnel-heading" className="text-xl font-semibold text-ink">
              {FUNNEL_TITLE}
            </h2>

            <ScrollableTable label={FUNNEL_TITLE}>
              <table className={TABLE}>
                <caption className={CAPTION}>{FUNNEL_TITLE}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Step
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.funnel.steps.map((step) => (
                    <tr key={step.key}>
                      <th scope="row" className={ROW_TH}>
                        {step.label}
                      </th>
                      <td className={NUM}>{step.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
            <p className="mt-3 text-sm text-ink-muted">
              Orders paid counts the orders started in this period that are paid now.{' '}
              {REFUNDED_ORDERS_NOTE}
            </p>
            {bookedUnpaidSentence(view.funnel.atVenue?.bookedUnpaid) ? (
              <p className="mt-2 text-sm text-ink-muted">
                {bookedUnpaidSentence(view.funnel.atVenue.bookedUnpaid)}
              </p>
            ) : null}

            {view.funnel.missing.length > 0 ? (
              <>
                <h3 className="mt-4 text-base font-semibold text-ink">Not counted</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  {view.funnel.missing.map((missing) => (
                    <li key={missing}>{missing}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section aria-labelledby="counting-heading" className="mt-8">
            <h2 id="counting-heading" className="text-xl font-semibold text-ink">
              What these figures count
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {VISIT_COUNTING_NOTES.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <p className="mt-8">
            <a
              href={`/api/v1/analytics/export.csv?${new URLSearchParams(
                Object.entries({
                  organizationId,
                  currency: view.currency,
                  eventId: event ? event.id : undefined,
                  from,
                  to,
                }).filter(([, value]) => Boolean(value)),
              ).toString()}`}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-action-primary px-4 text-sm font-semibold text-action-primary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Download as CSV
            </a>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            The export carries the same figures under an explicit column list — no buyer, no
            address, no visitor code, and nothing about how anybody paid. Its first rows say which
            payment mode produced it and how visits were counted.
          </p>
        </>
      ) : null}
    </div>
  )
}
