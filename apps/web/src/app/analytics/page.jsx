/**
 * Organiser analytics.
 *
 * ## Nothing is computed here
 *
 * Every figure comes from the API, which derives money from the append-only
 * ledger and counts from the rows that are the fact. A screen that did its own
 * arithmetic would be a second opinion about somebody's sales, and two opinions
 * is one too many.
 *
 * ## Why there are no charts
 *
 * Because a table is the accessible form and a chart is the decoration, and
 * this cycle had to deliver the first. Every number an organiser needs is in a
 * table with a caption, real headers and a scope — the thing a chart would have
 * needed as its "accessible equivalent" anyway. Adding canvas on top of these
 * is a later, purely visual change; shipping the chart first and the table
 * "soon" is how a screen ends up permanently unusable by somebody.
 *
 * ## Filters
 *
 * Links, not a form, so the page works with no JavaScript, is bookmarkable, and
 * announces the current selection through `aria-current`. Only organisations
 * the session says the caller belongs to are offered; asking for another is
 * refused by the API regardless, and offering it would be an invitation to try.
 *
 * @module app/analytics/page
 */

import Link from 'next/link'

import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../components/page-state.jsx'
import { ReadRefusal } from '../../components/read-refusal.jsx'
import { Figure, ModeBanner, ScrollableTable } from '../../components/money-figure.jsx'
import { formatPrice } from '../../lib/pricing.js'
import { getAnalytics } from '../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Analytics', robots: { index: false, follow: false } }

/** Table styling, written once so every table on the page reads the same. */
const TABLE = 'min-w-full border-collapse text-sm'
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'
const TD = 'border-b border-line px-3 py-2 text-ink'
const NUM = `${TD} text-right tabular-nums`

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
    return <Empty title={caption} description="Nothing has been sold in this grouping yet." />
  }

  return (
    <ScrollableTable label={caption}>
      <table className={TABLE}>
        <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Item
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {unit}
            </th>
            {money ? (
              <th scope="col" className={`${TH} text-right`}>
                Line value
              </th>
            ) : null}
            <th scope="col" className={`${TH} text-right`}>
              Refunded
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.id}-${row.currency}`}>
              <th scope="row" className={`${TD} font-normal`}>
                {row.label}
              </th>
              <td className={NUM}>{row.quantity}</td>
              {money ? (
                <td className={NUM}>{formatPrice(row.lineValueCents, row.currency)}</td>
              ) : null}
              <td className={NUM}>{row.refundedQuantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * @typedef {object} AnalyticsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The analytics overview.
 *
 * @param {AnalyticsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AnalyticsPage({ searchParams }) {
  const query = await searchParams
  const session = await readSession()

  const organizations = (session?.memberships ?? [])
    .filter((membership) => sessionCan(session, 'report:view', membership.organizationId))
    .map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName ?? membership.organizationId,
    }))

  const asked = query?.organizationId ?? null
  const chosen = organizations.find((organization) => organization.id === asked)

  // An organisation asked for and not available is refused, not substituted.
  //
  // Falling back to the first membership was the first draft, and it is a quiet
  // lie on a money screen: the address says one organisation and the page shows
  // another's figures, with nothing on it saying so. Somebody who bookmarks,
  // shares or screenshots that URL is handing on a number attributed to the
  // wrong organisation. The refusal reads the same whether the identifier
  // belongs to somebody else or to nobody, so it is not an oracle either.
  if (asked && !chosen) {
    return <Forbidden area="Analytics for that organisation" />
  }

  const organizationId = chosen?.id ?? organizations[0]?.id

  let view = null
  let failure = null

  if (organizationId) {
    try {
      view = await getAnalytics({
        organizationId,
        currency: query?.currency ?? 'USD',
        eventId: query?.eventId,
        from: query?.from,
        to: query?.to,
      })
    } catch (error) {
      failure = error
    }
  }

  /**
   * A link that keeps the current filters and changes one of them.
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

  return (
    <div>
      <Breadcrumbs
        trail={[{ href: '/organizer/events', label: 'Organiser' }, { label: 'Analytics' }]}
      />

      <h1 className="mt-3 text-h2 font-semibold text-ink">Analytics</h1>
      <p className="mt-2 text-ink-muted">
        What this organisation sold, holds, is owed and let in. Money is derived from the
        append-only ledger; everything else is counted from the tickets, seats and check-ins
        themselves. The two are shown separately because they are different measurements —
        multiplying tickets by face value does not produce revenue.
      </p>

      {organizations.length === 0 ? (
        <Empty
          title="No organisation to report on"
          description="This account is not a member of an organisation that it may see reports for."
        />
      ) : null}

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.id === organizationId

              return (
                <li key={organization.id}>
                  <Link
                    href={withFilters({ organizationId: organization.id })}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                        : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                    }`}
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

      {view ? (
        <>
          <ModeBanner mode={view.mode} notice={view.modeNotice} />
          <AsOf asOf={new Date().toISOString()} />

          <p className="mt-2 text-sm text-ink-muted">
            Dates and windows are in <strong>{view.timeZone}</strong>. Money figures are in{' '}
            <strong>{view.currency}</strong> only — amounts in another currency are counted in their
            own rows and never added to these.
          </p>

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
                <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                  Tickets and attendance
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Measure
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className={`${TD} font-normal`}>
                      Live tickets
                    </th>
                    <td className={NUM}>{view.tickets.live}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={`${TD} font-normal`}>
                      Admitted
                    </th>
                    <td className={NUM}>{view.checkIns.admitted}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={`${TD} font-normal`}>
                      Checked in
                    </th>
                    <td className={NUM}>
                      {view.checkIns.percent === null
                        ? 'No live tickets yet'
                        : `${view.checkIns.percent}%`}
                    </td>
                  </tr>
                  {view.tickets.byLostState.map((lost) => (
                    <tr key={lost.state}>
                      <th scope="row" className={`${TD} font-normal`}>
                        {lost.label}
                      </th>
                      <td className={NUM}>{lost.count}</td>
                    </tr>
                  ))}
                  {view.movement.transfers.map((transfer) => (
                    <tr key={transfer.status}>
                      <th scope="row" className={`${TD} font-normal`}>
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
                  <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                    General admission
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Ticket type
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Sold
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
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
                        <th scope="row" className={`${TD} font-normal`}>
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
                description="This organisation sells no unreserved tickets, or none have been created yet."
              />
            )}

            {view.inventory.reserved.bySection.length > 0 ? (
              <ScrollableTable label="Reserved seats by section">
                <table className={TABLE}>
                  <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                    Reserved seats by section
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Section
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Seats
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Available
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Sold
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Blocked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.inventory.reserved.bySection.map((group) => (
                      <tr key={group.id ?? group.name}>
                        <th scope="row" className={`${TD} font-normal`}>
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
                  <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                    Reserved seats by price zone
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Price zone
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Seats
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Available
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Sold
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.inventory.reserved.byPriceZone.map((group) => (
                      <tr key={group.id ?? group.name}>
                        <th scope="row" className={`${TD} font-normal`}>
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
                <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                  Notifications and exceptions
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Measure
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.notifications.map((row) => (
                    <tr key={row.status}>
                      <th scope="row" className={`${TD} font-normal`}>
                        Notifications {row.status.toLowerCase().replace(/_/gu, ' ')}
                      </th>
                      <td className={NUM}>{row.count}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className={`${TD} font-normal`}>
                      Reconciliation items open
                    </th>
                    <td className={NUM}>{view.exceptions.open}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={`${TD} font-normal`}>
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
              From hold to payment
            </h2>

            <ScrollableTable label="From hold to payment">
              <table className={TABLE}>
                <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                  From hold to payment
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Step
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.funnel.steps.map((step) => (
                    <tr key={step.key}>
                      <th scope="row" className={`${TD} font-normal`}>
                        {step.label}
                      </th>
                      <td className={NUM}>{step.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>

            {view.funnel.missing.map((missing) => (
              <p key={missing} className="mt-3 text-sm text-ink-muted">
                {missing}
              </p>
            ))}
          </section>

          <p className="mt-8">
            <a
              href={`/api/v1/analytics/export.csv?organizationId=${encodeURIComponent(organizationId)}&currency=${encodeURIComponent(view.currency)}`}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-action-primary px-4 text-sm font-semibold text-action-primary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Download as CSV
            </a>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            The export carries the same figures under an explicit column list — no buyer, no
            address, and nothing about how anybody paid. Its first rows say which payment mode
            produced it.
          </p>
        </>
      ) : null}
    </div>
  )
}
