/**
 * One refund, and the decision somebody has to make about it.
 *
 * ## The amount is not a field on this page
 *
 * It was computed from the order's own lines when the refund was requested, and
 * the database will not let the sum of a refund exceed what the order took —
 * that is a CHECK constraint and a conditional `UPDATE`, not a validation this
 * screen performs. Nothing here can propose a different figure, because a
 * screen that could would be a screen where "the browser said 90,000" decides
 * how much of somebody's money goes back.
 *
 * ## What it never shows and never asks for
 *
 * A card number, a CVC, an expiry, a token, a provider secret. Giving money
 * back uses the payment this system already holds a reference to. A refund
 * screen that asked a person to type a card would be a phishing page with a
 * legitimate URL, and the fact that the developer meant well would not help
 * whoever typed it.
 *
 * `providerRefundId` is shown, because that is the string somebody needs when
 * they ring the provider. It identifies the refund, not the instrument.
 *
 * ## What a direct URL gets you
 *
 * The API loads the row, works out which organisation owns the order's event,
 * and asserts against *that* — not against anything in the request. A refund
 * belonging to somebody else answers the same way as an identifier nobody has
 * used.
 *
 * @module app/finance/refunds/id/page
 */

import Link from 'next/link'

import { Figure, ScrollableTable } from '../../../../components/money-figure.jsx'
import { RefundActions } from '../../../../components/refund-actions.jsx'
import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { getRefund } from '../../../../lib/organizer-api.js'
import { membershipsWith } from '../../../../lib/capabilities.js'
import { describeApiRefusal } from '../../../../lib/refusal.js'
import { readSession, sessionCan } from '../../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Refund', robots: { index: false, follow: false } }

/** Table chrome. */
const TABLE = 'min-w-full border-collapse text-sm'

/** A header cell. */
const TH = 'border-b border-line px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-2 text-ink'

/** A numeric cell. */
const NUM = `${TD} text-right tabular-nums`

/**
 * What each state means, and whether anybody is waiting.
 *
 * Nine states, spelled out, because `RECONCILIATION_REQUIRED` tells a finance
 * user nothing and "the provider did not say what happened, and somebody is
 * establishing it" tells them whether to chase it.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATES = Object.freeze({
  REQUESTED: 'Asked for. Nothing has been sent and no money has moved.',
  APPROVED: 'Agreed. Still nothing sent — sending is a separate command.',
  SUBMITTED: 'Sent to the provider. Waiting to hear what happened.',
  SUCCEEDED: 'The money has gone back.',
  DECLINED: 'The provider refused it. It can be approved again once the cause is fixed.',
  FAILED: 'It did not go. It can be approved again once the cause is fixed.',
  TIMEOUT:
    'The provider did not answer. That is not a failure — it may or may not have gone, and somebody is establishing which.',
  RECONCILIATION_REQUIRED:
    'The provider did not say what happened, and an operations item is open to establish it.',
  CANCELLED: 'Ended without being sent.',
})

/**
 * @typedef {object} RefundDetailProps
 * @property {Promise<{id: string}>} params The route parameters.
 */

/**
 * The refund detail screen.
 *
 * @param {RefundDetailProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered screen.
 */
export default async function RefundDetailPage({ params }) {
  const { id } = await params
  const session = await readSession()

  // The list is kept per organisation, for its finance team; somebody who is
  // not on one is not offered a crumb to a list that would have nothing for
  // them.
  const listCrumb =
    membershipsWith(session, 'finance:view').length > 0
      ? [{ href: '/finance/refunds', label: 'Refunds' }]
      : []

  let refund = null
  let failure = null

  try {
    refund = await getRefund(id)
  } catch (error) {
    const { state } = describeApiRefusal(error)

    // Refused and missing read alike. A lapsed step-up or a missing second
    // factor is neither: it used to land here too, and "Not for you" was
    // wrong for somebody one confirmation away from the page.
    if (state === 'permission-denied' || state === 'not-found') {
      return <Forbidden area="This refund" backHref="/operations" backLabel="Back to operations" />
    }

    failure = error
  }

  if (!refund) {
    return (
      <div>
        <Breadcrumbs
          trail={[
            { href: '/finance', label: 'Finance' },
            ...listCrumb,
            { href: null, label: 'Refund' },
          ]}
        />
        <h1 className="mt-3 text-2xl font-bold text-ink">Refund</h1>
        <ReadRefusal error={failure} what="This refund" action="see this refund" />
      </div>
    )
  }

  // Asked once the row is loaded, because the organisation is the one that owns
  // the order's event and nothing in the URL is trusted to name it. The API
  // asserts the same thing again; this only decides what to draw.
  const organizationId = refund.organizationId ?? null
  const mayApprove = sessionCan(session, 'order:refund_approve', organizationId)
  const maySubmit = sessionCan(session, 'order:refund', organizationId)

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/finance', label: 'Finance' },
          ...(listCrumb.length > 0 && organizationId
            ? [
                {
                  href: `/finance/refunds?organizationId=${encodeURIComponent(organizationId)}`,
                  label: 'Refunds',
                },
              ]
            : listCrumb),
          { href: null, label: refund.orderReference ?? 'Refund' },
        ]}
      />

      <h1 className="mt-3 text-2xl font-bold text-ink">
        Refund on {refund.orderReference ?? 'an order'}
      </h1>
      <p className="mt-2 text-ink-muted">{STATES[refund.status] ?? 'Its state is unfamiliar.'}</p>
      <AsOf asOf={new Date().toISOString()} />

      <section aria-labelledby="amount-heading" className="mt-8">
        <h2 id="amount-heading" className="text-lg font-semibold text-ink">
          What goes back
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Computed from the order’s own lines when this was requested. It is not editable here, and
          the database will not accept a refund that takes an order past what it was paid.
        </p>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Total"
            cents={refund.amountCents}
            currency={refund.currency}
            hint="The whole refund."
          />
          {refund.allocation ? (
            <>
              <Figure
                label="Face value"
                cents={refund.allocation.faceValueCents}
                currency={refund.currency}
                hint="The ticket price itself."
              />
              <Figure
                label="Fee"
                cents={refund.allocation.feeCents}
                currency={refund.currency}
                hint="The platform fee, given back or kept per policy."
              />
              <Figure
                label="Tax"
                cents={refund.allocation.taxCents}
                currency={refund.currency}
                hint="Collected for an authority, and returned with the rest."
              />
            </>
          ) : null}
        </dl>

        {refund.allocation ? null : (
          <Empty
            title="No breakdown recorded"
            description="This refund names an amount without saying how it divides across face value, fee and tax. That is a partial refund taken as a figure rather than as lines."
          />
        )}
      </section>

      <section aria-labelledby="lines-heading" className="mt-8">
        <h2 id="lines-heading" className="text-lg font-semibold text-ink">
          Which lines
        </h2>
        {refund.items.length === 0 ? (
          <Empty
            title="No lines"
            description="This refund was requested as an amount rather than against particular order lines."
          />
        ) : (
          <ScrollableTable label="Refunded lines">
            <table className={TABLE}>
              <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">
                Refunded lines
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Order line
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Tickets
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {refund.items.map((item) => (
                  <tr key={item.orderItemId}>
                    <th scope="row" className={`${TD} font-mono font-normal`}>
                      {item.orderItemId}
                    </th>
                    <td className={NUM}>{item.quantity}</td>
                    <td className={NUM}>
                      {(item.amountCents / 100).toFixed(2)} {refund.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </section>

      <section aria-labelledby="why-heading" className="mt-8">
        <h2 id="why-heading" className="text-lg font-semibold text-ink">
          Why, and what has happened to it
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Reason</dt>
            <dd className="text-ink">
              {refund.reason.replace(/_/gu, ' ').toLowerCase()}
              {refund.reasonNote ? ` — ${refund.reasonNote}` : ''}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Provider reference</dt>
            <dd className="font-mono text-ink">
              {refund.providerRefundId ?? 'None yet — nothing has been sent'}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Attempts</dt>
            <dd className="text-ink">{refund.attempts}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Tickets revoked</dt>
            <dd className="text-ink">{refund.ticketsRevoked ? 'Yes' : 'Not yet'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Inventory returned</dt>
            <dd className="text-ink">{refund.inventoryReturned ? 'Yes' : 'Not yet'}</dd>
          </div>
          {refund.submittedAt ? (
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-muted">Sent</dt>
              <dd className="text-ink">
                <time dateTime={refund.submittedAt}>{refund.submittedAt}</time>
              </dd>
            </div>
          ) : null}
          {refund.settledAt ? (
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-muted">Settled</dt>
              <dd className="text-ink">
                <time dateTime={refund.settledAt}>{refund.settledAt}</time>
              </dd>
            </div>
          ) : null}
        </dl>

        {refund.failureCode ? (
          <p className="mt-3 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger">
            The provider gave the code <span className="font-mono">{refund.failureCode}</span>.
            Whatever caused it has to be fixed before this is approved again — approving a refund
            that will fail the same way is a second failure, not a retry.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="actions-heading" className="mt-8">
        <h2 id="actions-heading" className="text-lg font-semibold text-ink">
          What you can do
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Approving and sending are separate commands, and whoever asked for a refund may not
          approve their own unless they hold the capability that says one person may do both. No
          card details are shown here and none are asked for; giving money back uses the payment
          this system already holds a reference to.
        </p>
        <RefundActions refund={refund} mayApprove={mayApprove} maySubmit={maySubmit} />
      </section>

      <p className="mt-8 text-sm">
        <Link
          href="/operations"
          className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Back to operations
        </Link>
      </p>
    </div>
  )
}
