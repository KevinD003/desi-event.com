/**
 * One reconciliation item, and the decision somebody has to make about it.
 *
 * ## Both sides, or none
 *
 * What this system believed when the problem happened, and what the provider
 * last said. The decision is made by comparing them, so a screen that showed
 * one would be asking somebody to decide with half the evidence. Neither side
 * is a provider payload: both are projected onto a reviewed key allow list
 * before they leave the API, so a writer who one day stores the raw object
 * ships nothing rather than a card's last four digits onto a screen that gets
 * read on a shared desk.
 *
 * ## What a direct URL gets you
 *
 * Exactly what the queue would have: the API re-authorises every read, and an
 * item belonging to an organisation you have no finance access to answers the
 * same way as an item that does not exist. Guessing identifiers is not a way
 * in, and the wording of the refusal does not tell you which of the two
 * happened.
 *
 * ## What is deliberately absent
 *
 * A form that edits the payment, the order, the amount or the status. Every one
 * of the five things an operator may do ends in the domain service asking the
 * provider and deciding for itself; none of them takes a status from this page.
 *
 * @module app/operations/reconciliation/id/page
 */

import Link from 'next/link'

import { ReconciliationActions } from '../../../../components/reconciliation-actions.jsx'
import { AsOf, Breadcrumbs, Empty, Failure, Forbidden } from '../../../../components/page-state.jsx'
import { getReconciliationTask } from '../../../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/** Table chrome, shared by the two evidence tables. */
const TABLE = 'min-w-full border-collapse text-sm'

/** A header cell. */
const TH = 'border-b border-line px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-2 text-ink'

/**
 * What each kind of item means, in a sentence.
 *
 * Written out rather than derived from the enum, because
 * `PROVIDER_MISMATCH` tells an operator nothing they did not already know and
 * "a webhook arrived that disagrees with the stored payment" tells them where
 * to look.
 *
 * @type {Readonly<Record<string, string>>}
 */
const KINDS = Object.freeze({
  PAYMENT_TIMEOUT:
    'The provider did not answer when the charge was made. It may or may not have gone through.',
  PROVIDER_MISMATCH:
    'A webhook arrived that disagrees with the stored payment, or names one this system has never heard of.',
  REFUND_UNKNOWN: 'A refund was sent and the provider did not say what became of it.',
  WEBHOOK_DEAD_LETTER: 'A webhook could not be processed after every retry.',
  TRANSFER_STUCK:
    'A payout was submitted and the provider did not answer. The money may or may not have left.',
})

/**
 * How each state should be read.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATES = Object.freeze({
  OPEN: 'Nobody has taken this yet.',
  IN_PROGRESS: 'Somebody has claimed it.',
  ESCALATED: 'Somebody asked for help. It is still open.',
  RESOLVED: 'Closed. The history stays readable and nothing can reopen it.',
})

/**
 * The three aging bands, as words.
 *
 * @type {Readonly<Record<string, string>>}
 */
const AGING = Object.freeze({
  FRESH: 'Fresh',
  AGING: 'Aging',
  OVERDUE: 'Overdue',
})

/**
 * One side of the evidence as a table.
 *
 * A definition list would be the tidier markup, but the two sides are compared
 * key by key and a table with a row header per key is what lets a screen reader
 * announce "status — succeeded" on one side and "status — requires_payment" on
 * the other without the listener holding both in their head.
 *
 * @param {object} props Component props.
 * @param {string} props.caption Which side.
 * @param {object|null} props.evidence The projected evidence.
 * @param {string} props.absent What to say when there is none.
 * @returns {JSX.Element} The table, or a note.
 */
function Evidence({ caption, evidence, absent }) {
  if (evidence === null) {
    return <Empty title={caption} description={absent} />
  }

  const rows = Object.entries(evidence)

  if (rows.length === 0) {
    return (
      <Empty
        title={caption}
        description="Something was recorded, and none of it was on the list of things this screen may show. That is the allow list working, not an error — ask an engineer to read the row if the decision needs it."
      />
    )
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className={TABLE}>
        <caption className="px-3 py-2 text-left text-sm font-semibold text-ink">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Field
            </th>
            <th scope="col" className={TH}>
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <th scope="row" className={`${TD} font-normal`}>
                {key}
              </th>
              <td className={`${TD} font-mono`}>{value === null ? '—' : String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * @typedef {object} ReconciliationDetailProps
 * @property {Promise<{id: string}>} params The route parameters.
 */

/**
 * The detail screen.
 *
 * @param {ReconciliationDetailProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered screen.
 */
export default async function ReconciliationDetailPage({ params }) {
  const { id } = await params
  const session = await readSession()
  const mayAct = sessionCan(session, 'reconciliation:manage')

  let task = null
  let failure = null

  try {
    task = await getReconciliationTask(id)
  } catch (error) {
    // 403 and 404 are shown as the same refusal, because telling them apart is
    // how somebody with a list of identifiers learns which ones are real.
    if (error?.status === 403 || error?.status === 404) {
      return (
        <Forbidden
          area="This reconciliation item"
          backHref="/operations"
          backLabel="Back to operations"
        />
      )
    }

    failure = error?.message ?? null
  }

  if (!task) {
    return (
      <div>
        <Breadcrumbs
          trail={[
            { href: '/operations', label: 'Operations' },
            { href: null, label: 'Reconciliation item' },
          ]}
        />
        <h1 className="mt-3 text-2xl font-bold text-ink">Reconciliation item</h1>
        <Failure what="This item" detail={failure} />
      </div>
    )
  }

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/operations', label: 'Operations' },
          { href: null, label: task.kind.replace(/_/gu, ' ').toLowerCase() },
        ]}
      />

      <h1 className="mt-3 text-2xl font-bold text-ink">
        {task.kind.replace(/_/gu, ' ').toLowerCase()}
      </h1>
      <p className="mt-2 text-ink-muted">{KINDS[task.kind] ?? 'Something needs establishing.'}</p>
      <AsOf asOf={new Date().toISOString()} />

      <section aria-labelledby="status-heading" className="mt-8">
        <h2 id="status-heading" className="text-lg font-semibold text-ink">
          Where it stands
        </h2>
        {/*
          Every hint lives inside its `dd`. A `div` wrapping a definition-list
          group may contain only `dt` and `dd`; a `p` as a third sibling breaks
          the structure a screen reader navigates the list by, and axe's
          `definition-list` rule fails it under WCAG 1.3.1. The sweep found
          exactly this on its first run over this screen — and had found it
          once before, on `Figure`, which is why that component already has the
          same comment.
        */}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-card border border-line bg-surface-raised p-4">
            <dt className="text-sm text-ink-muted">State</dt>
            <dd className="mt-1">
              <span className="block font-semibold text-ink">{task.state}</span>
              <span className="mt-1 block text-sm text-ink-muted">{STATES[task.state]}</span>
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface-raised p-4">
            <dt className="text-sm text-ink-muted">Open for</dt>
            <dd className="mt-1">
              <span className="block font-semibold text-ink">
                {task.ageHours} hour{task.ageHours === 1 ? '' : 's'}
              </span>
              <span className="mt-1 block text-sm text-ink-muted">{AGING[task.aging]}</span>
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface-raised p-4">
            <dt className="text-sm text-ink-muted">Times the provider has been asked</dt>
            <dd className="mt-1">
              <span className="block font-semibold text-ink">{task.attempts}</span>
              <span className="mt-1 block text-sm text-ink-muted">
                Asking again reads an answer; it does not change one.
              </span>
            </dd>
          </div>
        </dl>

        {task.lastError ? (
          <p className="mt-3 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-status-warning">
            {task.lastError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="what-heading" className="mt-8">
        <h2 id="what-heading" className="text-lg font-semibold text-ink">
          What it is about
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Order</dt>
            <dd className="font-mono text-ink">{task.orderReference ?? 'No order named'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Provider reference</dt>
            <dd className="font-mono text-ink">{task.providerRef ?? 'None'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">Organisation</dt>
            <dd className="text-ink">
              {task.organizationId
                ? 'Scoped to one organisation'
                : 'Not scoped — only the platform can see this one'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="evidence-heading" className="mt-8">
        <h2 id="evidence-heading" className="text-lg font-semibold text-ink">
          Both sides of the evidence
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          What this system believed when the problem happened, beside what the provider last said.
          Neither is the provider’s raw object: both are reduced to a reviewed list of fields before
          they leave the server.
        </p>

        <Evidence
          caption="What this system believed"
          evidence={task.localState}
          absent="Nothing was recorded on this side. That is unusual and worth saying in a note."
        />
        <Evidence
          caption="What the provider said"
          evidence={task.providerState}
          absent="The provider has not been asked since this item was opened, or it had nothing to say."
        />
      </section>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-lg font-semibold text-ink">
          What people have written
        </h2>
        {(task.notes?.length ?? 0) === 0 ? (
          <Empty
            title="No notes yet"
            description="Nobody has recorded what they found. The first person to look should."
          />
        ) : (
          <ol className="mt-3 space-y-3">
            {task.notes.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="rounded-card border border-line bg-surface-raised p-4"
              >
                <p className="text-sm text-ink-muted">
                  <time dateTime={entry.at}>{entry.at}</time>
                </p>
                <p className="mt-1 text-ink">{entry.note}</p>
              </li>
            ))}
          </ol>
        )}

        {task.resolution ? (
          <p className="mt-3 rounded-card border border-status-success/25 bg-status-success-soft p-4 text-sm text-status-success">
            Closed as <strong>{task.resolution}</strong>
            {task.resolvedAt ? (
              <>
                {' '}
                on <time dateTime={task.resolvedAt}>{task.resolvedAt}</time>
              </>
            ) : null}
            . {task.resolutionNote}
          </p>
        ) : null}

        {task.escalationReason ? (
          <p className="mt-3 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-status-warning">
            Escalated: {task.escalationReason}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="actions-heading" className="mt-8">
        <h2 id="actions-heading" className="text-lg font-semibold text-ink">
          What you can do
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Five things, and none of them writes a payment, an order, a ticket, a refund or a ledger
          row directly. Resolving asks the provider once more and applies what it says — so an
          unknown answer leaves the item open, and a disagreement has to be escalated rather than
          closed.
        </p>
        <ReconciliationActions task={task} mayAct={mayAct} />
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
