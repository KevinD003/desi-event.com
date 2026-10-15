/**
 * Every reconciliation item, in every state.
 *
 * The operations board shows the open ones. This lists all of them — claimed,
 * escalated and resolved as well — filterable by state, kind and age, so that
 * every item's own page is reachable, including the closed ones whose history
 * somebody needs to read.
 *
 * ## Who sees which items
 *
 * Decided by `GET /v1/operations/reconciliation`, which branches on whether an
 * organisation is named (`scopeFor` in `apps/api/src/routes/reconciliation.js`):
 *
 *   - with one, the caller needs `finance:view` there and sees that
 *     organisation's items;
 *   - without one, the caller needs `reconciliation:manage` — a platform
 *     capability no organisation role carries — and sees every item.
 *
 * So the scope picker offers "every organisation" only to a session holding
 * the platform capability, and otherwise only the organisations it holds
 * finance access in. Both reads sit behind the `FINANCE_VIEW` step-up window;
 * a lapsed one is offered the step-up in place.
 *
 * ## What a row never carries
 *
 * The provider's reference, the payment, order and refund ids, and either side
 * of the evidence. The list payload has all of them — it is the same shape as
 * the detail — and this page reads none of them. An item's evidence is for the
 * person deciding it, on its own page; a list is for finding it. There is no
 * search by reference either: the API matches provider references and internal
 * ids there, and a filter for them would put them in the address bar.
 *
 * ## The order
 *
 * Open, claimed and escalated items first, oldest first, then the resolved
 * ones. The API used to sort by the state column, which PostgreSQL orders by
 * the enum's declaration order and which put an escalated item after every
 * resolved one; it now reads the two tiers separately
 * (`apps/api/src/lib/ranked-page.js`), and the page says what it does.
 *
 * ## A page past the end is not an empty list
 *
 * A page number from the address can outlive the list. When a page has no rows
 * but the list has some, the page says so, says how many there are, and links
 * to the first page. The empty state speaks only for the scope being shown: an
 * organisation's view cannot see items that belong to no organisation, so it
 * does not speak for "every payment".
 *
 * @module app/operations/reconciliation/page
 */

import Link from 'next/link'
import { RECONCILIATION_KINDS, RECONCILIATION_STATES } from '@desi-event/schemas'

import { AgingBadge, ScrollableTable } from '../../../components/money-figure.jsx'
import { AsOf, Breadcrumbs, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { membershipsWith, readSession, sessionCan } from '../../../lib/session.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  STATUS_TONE_CLASSES,
  isPastTheEnd,
  listHref,
  listReconciliationTasks,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reconciliation', robots: { index: false, follow: false } }

/** Where this page lives. */
const PATH = '/operations/reconciliation'

/**
 * Each kind in words: the board's words, capitalised.
 *
 * @type {Readonly<Record<string, string>>}
 */
const KINDS = Object.freeze({
  PAYMENT_TIMEOUT: 'Payment timeout',
  PROVIDER_MISMATCH: 'Provider mismatch',
  REFUND_UNKNOWN: 'Refund unknown',
  WEBHOOK_DEAD_LETTER: 'Webhook dead letter',
  TRANSFER_STUCK: 'Transfer stuck',
})

/**
 * Each state in words, with its tone and the detail page's sentence for it.
 *
 * @type {Readonly<Record<string, {label: string, tone: string, meaning: string}>>}
 */
const STATES = Object.freeze({
  OPEN: { label: 'Open', tone: 'pending', meaning: 'Nobody has claimed it.' },
  IN_PROGRESS: { label: 'In progress', tone: 'info', meaning: 'Somebody has claimed it.' },
  ESCALATED: {
    label: 'Escalated',
    tone: 'warning',
    meaning: 'Somebody asked for help. It is still open.',
  },
  RESOLVED: {
    label: 'Resolved',
    tone: 'success',
    meaning: 'Closed. The history stays readable and nothing can reopen it.',
  },
})

/**
 * The age filters the API accepts, with the thresholds from
 * `AGING_THRESHOLDS` in `apps/api/src/lib/reconciliation.js`.
 *
 * @type {ReadonlyArray<{value: string, label: string}>}
 */
const AGES = Object.freeze([
  { value: 'AGING', label: 'Ageing: open 24 hours or more' },
  { value: 'OVERDUE', label: 'Overdue: open 72 hours or more' },
])

/** A header cell. */
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-3 align-top text-ink'

/** A filter control. */
const CONTROL =
  'min-h-11 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-base text-ink shadow-control sm:text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

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
 * @returns {string} "1 item", "3 items".
 */
function itemsInWords(count) {
  return `${count} item${count === 1 ? '' : 's'}`
}

/**
 * A state in words, or its code for one this page has not met.
 *
 * @param {string} state A reconciliation state.
 * @returns {{label: string, tone: string, meaning: string}} The words.
 */
function stateInWords(state) {
  return STATES[state] ?? { label: state, tone: 'neutral', meaning: '' }
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
      aria-label="Pages of reconciliation items"
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
 * A page with no rows in a list that has some.
 *
 * @param {object} props Component props.
 * @param {number} props.page The page asked for.
 * @param {object|null} props.pagination The API's page counters.
 * @param {Record<string, string>} props.filters The filters in force.
 * @param {boolean} props.filtered Whether any filter narrows the list.
 * @returns {JSX.Element} The notice, with a way back.
 */
function PastTheEnd({ page, pagination, filters, filtered }) {
  const total = Number.isInteger(pagination?.total) ? pagination.total : null

  return (
    <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
      <p className="font-medium text-ink">Page {page} is past the end of this list</p>
      <p className="mt-1 text-sm text-ink-muted">
        {total === null
          ? 'There is nothing on this page. The list may have shrunk since the link was made.'
          : `There ${total === 1 ? 'is' : 'are'} ${itemsInWords(total)} ${
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
 * @typedef {object} ReconciliationListPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The reconciliation list.
 *
 * @param {ReconciliationListPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ReconciliationListPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()
  const platform = sessionCan(session, 'reconciliation:manage')
  const organizations = membershipsWith(session, 'finance:view')

  if (!platform && organizations.length === 0) {
    return (
      <Forbidden
        area="The reconciliation list"
        backHref="/operations"
        backLabel="Back to operations"
      />
    )
  }

  // An organisation this session holds finance access in, or — for the
  // platform, and only the platform — none, which is every organisation.
  const chosen = organizations.find(
    (organization) => organization.organizationId === query.organizationId,
  )
  const organizationId = chosen?.organizationId ?? (platform ? '' : organizations[0].organizationId)
  const scopeName = organizationId
    ? ((chosen ?? organizations[0]).organizationName ?? 'this organisation')
    : 'every organisation'

  const state = RECONCILIATION_STATES.includes(query.state) ? query.state : ''
  const kind = RECONCILIATION_KINDS.includes(query.kind) ? query.kind : ''
  const aging = AGES.some((age) => age.value === query.aging) ? query.aging : ''
  const page = readPage(query.page)
  const filters = { organizationId, state, kind, aging }
  const filtered = Boolean(state || kind || aging)
  const scopes = [
    ...(platform ? [{ value: '', label: 'Every organisation' }] : []),
    ...organizations.map((organization) => ({
      value: organization.organizationId,
      label: organization.organizationName ?? organization.organizationId,
    })),
  ]

  let tasks = null
  let pagination = null
  let failure = null

  try {
    const answer = await listReconciliationTasks({
      organizationId,
      state,
      kind,
      aging,
      page,
      perPage: LIST_PAGE_SIZE,
    })

    tasks = answer.tasks
    pagination = answer.pagination
  } catch (error) {
    failure = error
  }

  const beyond = tasks ? isPastTheEnd(tasks.length, pagination, page) : false

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/operations', label: 'Operations' },
          { href: null, label: 'Reconciliation' },
        ]}
      />
      <h1 className="mt-3 text-h2 font-semibold text-ink">Reconciliation</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Every item where the system did not know what happened to money, for {scopeName}: open,
        claimed, escalated and resolved alike, the unresolved ones first and the oldest of those
        first. Each opens on its own page, where both sides of the evidence are and where it is
        decided. To see the items in one state, filter by it.
      </p>

      <form
        method="get"
        action={PATH}
        className="mt-6 flex flex-wrap items-end gap-4 rounded-card border border-line bg-surface-subtle p-4"
      >
        {scopes.length > 1 ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="reconciliation-scope" className="text-sm font-medium text-ink">
              Whose items
            </label>
            <select
              id="reconciliation-scope"
              name="organizationId"
              defaultValue={organizationId}
              className={CONTROL}
            >
              {scopes.map((scope) => (
                <option key={scope.value || 'platform'} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </select>
          </div>
        ) : organizationId ? (
          <input type="hidden" name="organizationId" value={organizationId} />
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="reconciliation-state" className="text-sm font-medium text-ink">
            State
          </label>
          <select id="reconciliation-state" name="state" defaultValue={state} className={CONTROL}>
            <option value="">Every state</option>
            {RECONCILIATION_STATES.map((member) => (
              <option key={member} value={member}>
                {stateInWords(member).label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reconciliation-kind" className="text-sm font-medium text-ink">
            Kind
          </label>
          <select id="reconciliation-kind" name="kind" defaultValue={kind} className={CONTROL}>
            <option value="">Every kind</option>
            {RECONCILIATION_KINDS.map((member) => (
              <option key={member} value={member}>
                {KINDS[member] ?? member}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reconciliation-age" className="text-sm font-medium text-ink">
            Age
          </label>
          <select id="reconciliation-age" name="aging" defaultValue={aging} className={CONTROL}>
            <option value="">Any age</option>
            {AGES.map((age) => (
              <option key={age.value} value={age.value}>
                {age.label}
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
          <Link href={listHref(PATH, { organizationId })} className={CLEAR_LINK}>
            Clear the filters
          </Link>
        ) : null}
      </form>

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The reconciliation list"
          action="see the reconciliation items"
          backHref="/operations"
          backLabel="Back to operations"
        />
      ) : null}

      {tasks && beyond ? (
        <PastTheEnd page={page} pagination={pagination} filters={filters} filtered={filtered} />
      ) : null}

      {tasks && tasks.length === 0 && !beyond ? (
        <Empty
          title={filtered ? 'No item matches these filters' : 'Nothing to reconcile'}
          description={
            filtered
              ? 'Nothing is in that state, of that kind or that old. Clear the filters to see every item.'
              : organizationId
                ? `There is no reconciliation item for ${scopeName}, in any state.`
                : 'There is no reconciliation item at all, in any state.'
          }
        />
      ) : null}

      {tasks && tasks.length > 0 ? (
        <>
          <AsOf asOf={new Date().toISOString()} />
          <ScrollableTable label="Reconciliation items">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">Reconciliation items for {scopeName}</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Kind
                  </th>
                  <th scope="col" className={TH}>
                    About
                  </th>
                  <th scope="col" className={TH}>
                    State
                  </th>
                  <th scope="col" className={TH}>
                    Age
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Times the provider was asked
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const words = stateInWords(task.state)

                  return (
                    <tr key={task.id}>
                      <th scope="row" className={`${TD} font-normal`}>
                        <Link
                          href={`${PATH}/${encodeURIComponent(task.id)}`}
                          className={`${LINK} font-medium`}
                        >
                          {KINDS[task.kind] ?? task.kind}
                        </Link>
                      </th>
                      <td className={TD}>
                        {task.orderReference ? (
                          <>
                            Order <span className="font-mono">{task.orderReference}</span>
                          </>
                        ) : (
                          <span className="text-ink-muted">No order named</span>
                        )}
                        {task.refundId ? (
                          <span className="block text-xs text-ink-muted">A refund on it</span>
                        ) : null}
                      </td>
                      <td className={TD}>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            STATUS_TONE_CLASSES[words.tone] ?? STATUS_TONE_CLASSES.neutral
                          }`}
                        >
                          {words.label}
                        </span>
                        {words.meaning ? (
                          <span className="mt-1 block text-xs text-ink-muted">{words.meaning}</span>
                        ) : null}
                      </td>
                      <td className={TD}>
                        <AgingBadge band={task.aging} hours={task.ageHours} />
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{task.attempts}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollableTable>

          {pagination ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing {tasks.length} of {pagination.total}.
            </p>
          ) : null}
          <Pager pagination={pagination} filters={filters} />
        </>
      ) : null}
    </div>
  )
}
