/**
 * The finance overview.
 *
 * Every figure here comes from the API, which derives it from the append-only
 * ledger. Nothing is computed in this file: a screen that did its own
 * arithmetic would be a second opinion about money, and two opinions about
 * money is one too many.
 *
 * ## What is above the numbers, and why
 *
 * Two things, in this order. The mode banner, because a mock-mode figure is not
 * an accounting record. Then the integrity alert, when there is one: a ledger
 * batch whose entries do not add up means the totals below it are built on
 * something that should be impossible, and a footnote under them would be read
 * after somebody had already believed them.
 *
 * ## The organisation picker
 *
 * Links rather than a form, so it works with no JavaScript, is bookmarkable,
 * and announces the current one through `aria-current`. Only organisations the
 * session says the caller belongs to are offered; asking for another one is
 * refused by the API regardless, and offering it would be an invitation to try.
 *
 * @module app/finance/page
 */

import Link from 'next/link'

import { Figure, ModeBanner, ScrollableTable } from '../../components/money-figure.jsx'
import { formatPrice } from '../../lib/pricing.js'
import { getFinanceSummary } from '../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Finance', robots: { index: false, follow: false } }

/**
 * How each activity row reads.
 *
 * @type {ReadonlyArray<{key: string, label: string, hint: string}>}
 */
const ACTIVITY = Object.freeze([
  {
    key: 'refundsRequested',
    label: 'Refunds in flight',
    hint: 'Asked for and not yet settled. Held back from what may be paid out.',
  },
  { key: 'refundsSettled', label: 'Refunds settled', hint: 'Money that has gone back.' },
  {
    key: 'disputes',
    label: 'Disputes',
    hint: 'Claimed back by a buyer. Held until the claim resolves.',
  },
  { key: 'transfers', label: 'Transfers', hint: 'Moved onward to a connected account.' },
  { key: 'payouts', label: 'Payouts', hint: 'Sent to an organiser’s bank.' },
])

/**
 * @typedef {object} FinancePageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The overview.
 *
 * @param {FinancePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function FinancePage({ searchParams }) {
  const query = await searchParams
  const session = await readSession()

  // Only what the session already says this caller belongs to. The API refuses
  // anything else anyway; offering it would be an invitation to try.
  const organizations = (session?.memberships ?? [])
    .filter((membership) => sessionCan(session, 'finance:view', membership.organizationId))
    .map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName ?? membership.organizationId,
    }))

  const requested = query?.organizationId
  const chosen = organizations.find((organization) => organization.id === requested)
  const organizationId = chosen?.id ?? organizations[0]?.id

  let summary = null
  let failure = null

  try {
    summary = await getFinanceSummary({ organizationId, currency: 'INR' })
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Finance</h1>
      <p className="mt-2 text-ink-muted">
        Derived from the ledger, which is appended to and never edited. An order total is written
        once at checkout and never corrected; nothing on this page reads one.
      </p>

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.id === organizationId

              return (
                <li key={organization.id}>
                  <Link
                    href={`/finance?organizationId=${organization.id}`}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink'
                        : 'bg-surface-subtle text-ink-muted hover:bg-line'
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
        <p
          role="alert"
          className="mt-6 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger"
        >
          The finance view could not be loaded: {failure}. Nothing here is stale — it is absent, and
          a figure guessed from a cache would be worse than none.
        </p>
      ) : null}

      {summary ? (
        <>
          <ModeBanner mode={summary.mode} notice={summary.modeNotice} />

          {summary.integrity.imbalances.length > 0 ? (
            <section
              aria-labelledby="integrity-heading"
              className="mt-4 rounded-card border border-status-danger/25 bg-status-danger-soft p-4"
            >
              <h2 id="integrity-heading" className="font-semibold text-status-danger">
                {summary.integrity.imbalances.length} ledger{' '}
                {summary.integrity.imbalances.length === 1 ? 'batch does' : 'batches do'} not add up
              </h2>
              <p className="mt-1 text-sm text-status-danger">
                Every batch is balanced by a database check when it posts, so this should be
                impossible. Until somebody has looked, the figures below are built on something that
                should not exist.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-status-danger">
                {summary.integrity.imbalances.map((imbalance) => (
                  <li key={imbalance.batchId}>
                    <span className="font-mono">{imbalance.reference}</span> — {imbalance.problem}:
                    entries total {formatPrice(imbalance.actualDebitCents, summary.currency)} debit
                    against {formatPrice(imbalance.actualCreditCents, summary.currency)} credit
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="totals-heading" className="mt-8">
            <h2 id="totals-heading" className="text-lg font-semibold text-ink">
              Totals
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Figure
                label="Gross collected"
                cents={summary.totals.grossCollectedCents}
                currency={summary.currency}
                hint="What buyers handed over, before anything went back."
              />
              <Figure
                label="Ticket face value"
                cents={summary.totals.faceValueCents}
                currency={summary.currency}
              />
              <Figure
                label="Discounts given"
                cents={summary.totals.discountCents}
                currency={summary.currency}
                hint="Contra-revenue: a discount reduces what was earned rather than costing anything."
              />
              <Figure
                label="Tax payable"
                cents={summary.totals.taxPayableCents}
                currency={summary.currency}
                hint="Collected on an authority’s behalf. Never revenue."
              />
              <Figure
                label="Platform fee revenue"
                cents={summary.totals.platformFeeRevenueCents}
                currency={summary.currency}
              />
              <Figure
                label="Owed to organisers"
                cents={summary.totals.organizerPayableCents}
                currency={summary.currency}
                hint="A liability. The buyer’s money is not the platform’s revenue."
              />
            </dl>
          </section>

          <section aria-labelledby="accounts-heading" className="mt-8">
            <h2 id="accounts-heading" className="text-lg font-semibold text-ink">
              Clearing accounts
            </h2>
            <ScrollableTable label="Clearing accounts">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <caption className="sr-only">
                  Each account’s debits, credits and balance over the window
                </caption>
                <thead>
                  <tr className="border-b border-line-strong text-left">
                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">
                      Account
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold text-ink">
                      Debits
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold text-ink">
                      Credits
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold text-ink">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.accounts.map((account) => (
                    <tr key={account.code} className="border-b border-line">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-ink">
                        {account.label}
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink">
                        {formatPrice(account.debitCents, summary.currency)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink">
                        {formatPrice(account.creditCents, summary.currency)}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums text-ink">
                        {formatPrice(account.balanceCents, summary.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </section>

          <section aria-labelledby="activity-heading" className="mt-8">
            <h2 id="activity-heading" className="text-lg font-semibold text-ink">
              Activity
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ACTIVITY.map((row) => (
                <Figure
                  key={row.key}
                  label={`${row.label} (${summary.activity[row.key].count})`}
                  cents={summary.activity[row.key].amountCents}
                  currency={summary.currency}
                  hint={row.hint}
                />
              ))}
            </dl>
          </section>

          <p className="mt-8">
            <a
              href={`/api/v1/finance/export.csv${organizationId ? `?organizationId=${organizationId}` : ''}`}
              className="inline-flex rounded-lg bg-action-primary px-4 py-2 text-sm font-semibold text-action-primary-ink hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              download
            >
              Download as a spreadsheet
            </a>
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            The export carries no buyer, no address and nothing about how anybody paid, and its
            first row says which mode produced the figures.
          </p>
        </>
      ) : null}
    </div>
  )
}
