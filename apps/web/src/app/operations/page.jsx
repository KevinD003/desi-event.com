/**
 * The operations board: everything the machine could not finish on its own.
 *
 * Four queues on one page, because the question somebody on shift asks is "what
 * needs me", not "show me the reconciliation table". Each one is a link to
 * where the work is actually done; nothing is actioned from here, which keeps
 * this page a read and keeps every state change behind its own step-up.
 *
 * ## Why it degrades rather than fails
 *
 * Each queue is fetched independently and a failure in one is reported in
 * place. An operations board that goes blank because one endpoint is slow is a
 * board nobody trusts during the incident it exists for.
 *
 * ## Scoping
 *
 * The reconciliation and notification queues are platform-scoped; the refund
 * queue is per organisation. A caller who is an organiser rather than platform
 * operations sees their own refunds and is told plainly that the other two are
 * not theirs, rather than being shown an empty table.
 *
 * @module app/operations/page
 */

import Link from 'next/link'

import { AgingBadge } from '../../components/money-figure.jsx'
import { EmptyState } from '../../components/ui.jsx'
import { formatPrice } from '../../lib/pricing.js'
import {
  getNotificationQueue,
  getReconciliationQueue,
  getRefundQueue,
} from '../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Operations', robots: { index: false, follow: false } }

/**
 * Fetch one queue, reporting a failure rather than throwing it.
 *
 * @param {Function} load What to call.
 * @returns {Promise<{value: object|null, failure: string|null}>} What came back.
 */
async function attempt(load) {
  try {
    return { value: await load(), failure: null }
  } catch (error) {
    return { value: null, failure: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * @typedef {object} QueueSectionProps
 * @property {string} id The heading's id, for `aria-labelledby`.
 * @property {string} title What the queue is.
 * @property {string} description Why somebody is looking at it.
 * @property {string|null} failure What went wrong, if anything.
 * @property {number} count How many items.
 * @property {object} children The rows.
 */

/**
 * One queue, with its own failure state.
 *
 * @param {QueueSectionProps} props Component props.
 * @returns {JSX.Element} The section.
 */
function QueueSection({ id, title, description, failure, count, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title} {failure ? null : <span className="font-normal text-ink-muted">({count})</span>}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>

      {failure ? (
        <p
          role="alert"
          className="mt-3 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger"
        >
          This queue could not be loaded: {failure}.
        </p>
      ) : (
        children
      )}
    </section>
  )
}

/**
 * The board.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OperationsPage() {
  const session = await readSession()
  const platform = sessionCan(session, 'reconciliation:manage')

  const organizations = (session?.memberships ?? []).filter((membership) =>
    sessionCan(session, 'finance:view', membership.organizationId),
  )
  const organizationId = organizations[0]?.organizationId

  const [reconciliation, notifications, refunds] = await Promise.all([
    platform
      ? attempt(() => getReconciliationQueue({ state: 'OPEN' }))
      : { value: null, failure: null },
    platform ? attempt(() => getNotificationQueue()) : { value: null, failure: null },
    organizationId
      ? attempt(() => getRefundQueue({ organizationId }))
      : { value: null, failure: null },
  ])

  const stuck = (notifications.value?.messages ?? []).filter((message) =>
    ['DEAD_LETTER', 'FAILED', 'RETRY_SCHEDULED'].includes(message.status),
  )
  const unresolved = (refunds.value?.refunds ?? []).filter((refund) =>
    ['REQUESTED', 'APPROVED', 'SUBMITTED', 'TIMEOUT', 'RECONCILIATION_REQUIRED'].includes(
      refund.status,
    ),
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Operations</h1>
      <p className="mt-2 text-ink-muted">
        What the machine could not finish on its own. Nothing is actioned from this page — each item
        links to where the work is done, behind its own second factor.
      </p>

      {!platform ? (
        <p className="mt-4 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-muted">
          The reconciliation and notification queues are platform work and are not shown here. Your
          organisation’s refunds are below.
        </p>
      ) : null}

      {platform ? (
        <QueueSection
          id="reconciliation-heading"
          title="Payment reconciliation"
          description="Where the system does not know what happened: a provider that did not answer, a webhook that contradicts the stored payment, a refund whose outcome is unknown. Oldest first, because the one that has been unknown longest is the most urgent."
          failure={reconciliation.failure}
          count={reconciliation.value?.tasks.length ?? 0}
        >
          {(reconciliation.value?.tasks.length ?? 0) === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Nothing unresolved"
                description="Every payment this system has taken agrees with what the provider says about it."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {reconciliation.value.tasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-card border border-line bg-surface-raised p-4 focus-within:ring-2 focus-within:ring-focus"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      <Link
                        href={`/operations/reconciliation/${task.id}`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        {task.kind.replace(/_/gu, ' ').toLowerCase()}
                      </Link>
                      {task.orderReference ? (
                        <span className="ml-2 font-mono text-sm text-ink-muted">
                          {task.orderReference}
                        </span>
                      ) : null}
                    </p>
                    <AgingBadge band={task.aging} hours={task.ageHours} />
                  </div>
                  {task.lastError ? (
                    <p className="mt-1 text-sm text-ink-muted">{task.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueueSection>
      ) : null}

      {platform ? (
        <QueueSection
          id="notifications-heading"
          title="Notifications that did not go"
          description="Dead letters and messages waiting on a retry. Neither recipients nor payloads are shown: an operations screen answers “did this go?”, not “who was it to?” or “what did it say?”."
          failure={notifications.failure}
          count={stuck.length}
        >
          {stuck.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Everything went"
                description="No message is dead-lettered or waiting on a retry."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {stuck.map((message) => (
                <li
                  key={message.id}
                  className="rounded-card border border-line bg-surface-raised p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">{message.template}</p>
                    <span className="rounded-full border border-line-strong bg-surface-subtle px-2 py-0.5 text-xs font-medium text-ink">
                      {message.status.replace(/_/gu, ' ').toLowerCase()} · {message.attempts}/
                      {message.maxAttempts}
                    </span>
                  </div>
                  {message.lastError ? (
                    <p className="mt-1 text-sm text-ink-muted">{message.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueueSection>
      ) : null}

      {organizationId ? (
        <QueueSection
          id="refunds-heading"
          title="Refunds waiting"
          description="Asked for and not yet settled. Each one holds money back from what may be paid out, so a refund nobody moves on is a payout nobody can make."
          failure={refunds.failure}
          count={unresolved.length}
        >
          {unresolved.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Nothing outstanding"
                description="No refund is waiting on a decision or on a provider."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {unresolved.map((refund) => (
                <li
                  key={refund.id}
                  className="rounded-card border border-line bg-surface-raised p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      <Link
                        href={`/finance/refunds/${refund.id}`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        {formatPrice(refund.amountCents, refund.currency)}
                      </Link>
                      {refund.orderReference ? (
                        <span className="ml-2 font-mono text-sm text-ink-muted">
                          {refund.orderReference}
                        </span>
                      ) : null}
                    </p>
                    <span className="rounded-full border border-line-strong bg-surface-subtle px-2 py-0.5 text-xs font-medium text-ink">
                      {refund.status.replace(/_/gu, ' ').toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {refund.reason.replace(/_/gu, ' ').toLowerCase()}
                    {refund.attempts > 0 ? ` · ${refund.attempts} submission attempt(s)` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </QueueSection>
      ) : null}

      <p className="mt-10 text-sm text-ink-muted">
        <Link href="/finance" className="underline underline-offset-4 hover:text-accent-strong">
          The finance overview
        </Link>{' '}
        has the figures these queues are about.
      </p>
    </div>
  )
}
