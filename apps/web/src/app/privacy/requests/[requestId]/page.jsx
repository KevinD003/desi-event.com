/**
 * One privacy request, in full.
 *
 * The state, why it was raised, what a hold evaluation decided, the scope the
 * server computed, the evidence timeline, and — when the state allows — the
 * commands.
 *
 * ## What the scope table is for
 *
 * An operator about to confirm an irreversible action is owed the difference
 * between "there was nothing of this kind" and "this organisation may not touch
 * it". Both render as a zero, which is why every row carries a status as well
 * as a count. `OUT_OF_SCOPE` most often means the person is also known to
 * another organisation, and erasing the shared account here would reach beyond
 * this organisation's own records — that is a limitation, not a failure, and
 * the screen says so rather than letting a zero imply completeness.
 *
 * The scope is a **snapshot taken when the request was raised**. Nothing
 * recomputes it at confirmation time, so a screen that presented it as current
 * would be presenting a figure that may have moved. It is labelled accordingly.
 *
 * ## What the timeline is, and is not
 *
 * Request-scoped. Hold placement and release are written against the hold, not
 * the request, so they do not appear here — the holds screen is where those
 * live. Saying so is better than implying this is everything that ever happened
 * to the subject.
 *
 * Every field on it is an opaque id, an enum, a closed-vocabulary code or a
 * timestamp. There is no before-value and no after-value, which is what makes
 * the timeline safe to read about somebody who has already been erased.
 *
 * @module app/privacy/requests/requestId/page
 */

import Link from 'next/link'

import { Breadcrumbs, Empty, Failure, Forbidden } from '../../../../components/page-state.jsx'
import { getPrivacyRequest, listPrivacyRequestEvents } from '../../../../lib/privacy-api.js'
import { privacyOrganizations, readSession } from '../../../../lib/session.js'
import {
  auditActionLabel,
  auditResultLabel,
  categoryLabel,
  describeRefusal,
  holdDecisionLabel,
  isAwaitingConfirmation,
  isCancellable,
  outcomeLabel,
  requestReasonLabel,
  requestStateDescription,
  requestStateLabel,
  scopeStatusDescription,
  scopeStatusLabel,
} from '../../../../lib/privacy-vocabulary.js'
import { RequestActions } from '../../request-actions.jsx'
import { StateBadge } from '../../state-badge.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy request',
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} PrivacyRequestPageProps
 * @property {Promise<Record<string, string>>} params The resolved route params.
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The detail screen.
 *
 * @param {PrivacyRequestPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PrivacyRequestPage({ params, searchParams }) {
  const session = await readSession()
  const organizations = privacyOrganizations(session)
  const { requestId } = await params
  const query = (await searchParams) ?? {}

  if (organizations.length === 0) {
    return (
      <Forbidden area="This privacy request" backHref="/privacy" backLabel="Back to requests" />
    )
  }

  const selected =
    organizations.find((organization) => organization.organizationId === query.organizationId) ??
    organizations[0]

  let request = null
  let events = []
  let failure = null

  try {
    const answer = await getPrivacyRequest(selected.organizationId, requestId)

    request = answer.data ?? null
  } catch (error) {
    failure = describeRefusal(error)
  }

  if (request) {
    try {
      const answer = await listPrivacyRequestEvents(selected.organizationId, requestId)

      events = answer.data ?? []
    } catch {
      // The timeline is evidence, not the record itself. Losing it should not
      // take the page down — the state above it is still true and still useful.
      events = []
    }
  }

  const trail = [
    { href: '/privacy', label: 'Privacy requests' },
    { href: null, label: request ? request.subjectId : 'Request' },
  ]

  return (
    <>
      <Breadcrumbs trail={trail} />

      {failure ? <Failure what={failure.title} detail={failure.detail} /> : null}

      {request ? (
        <>
          <header className="mt-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-indigo-night-900">Privacy request</h1>
              <StateBadge state={request.state} label={requestStateLabel(request.state)} />
            </div>
            <p className="mt-2 max-w-3xl text-slate-700">
              {requestStateDescription(request.state)}
            </p>
          </header>

          <section aria-labelledby="facts-heading" className="mt-8">
            <h2 id="facts-heading" className="text-lg font-semibold text-indigo-night-900">
              The record
            </h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-slate-600">Subject</dt>
                <dd className="font-mono text-sm break-all text-indigo-night-900">
                  {request.subjectId}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Why it was raised</dt>
                <dd className="text-sm text-indigo-night-900">
                  {requestReasonLabel(request.reason)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Hold evaluation</dt>
                <dd className="text-sm text-indigo-night-900">
                  {holdDecisionLabel(request.holdDecision)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Outcome</dt>
                <dd className="text-sm text-indigo-night-900">
                  {outcomeLabel(request.outcomeCode) ?? 'Not yet settled'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Policy version</dt>
                <dd className="font-mono text-sm text-indigo-night-900">{request.policyVersion}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Correlation</dt>
                <dd className="font-mono text-xs break-all text-indigo-night-900">
                  {request.correlationId}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Raised</dt>
                <dd className="text-sm text-indigo-night-900">
                  <time dateTime={request.requestedAt}>{request.requestedAt}</time>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-600">Completed</dt>
                <dd className="text-sm text-indigo-night-900">
                  {request.completedAt ? (
                    <time dateTime={request.completedAt}>{request.completedAt}</time>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="scope-heading" className="mt-8">
            <h2 id="scope-heading" className="text-lg font-semibold text-indigo-night-900">
              What this would reach
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-700">
              Counts by category, as computed when this request was raised. Categories rather than
              columns, and counts rather than values — a preview an operator reads must not double
              as a map of where the personal data lives. This is a snapshot: nothing recomputes it
              at confirmation time.
            </p>

            {Array.isArray(request.scope) && request.scope.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                  <caption className="sr-only">Personal-data categories in scope</caption>
                  <thead>
                    <tr className="border-b border-slate-300 text-slate-700">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Category
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Rows
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        What happens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.scope.map((entry) => (
                      <tr key={entry.category} className="border-b border-slate-200 align-top">
                        <th scope="row" className="py-3 pr-4 font-medium text-indigo-night-900">
                          {categoryLabel(entry.category)}
                        </th>
                        <td className="py-3 pr-4 tabular-nums text-slate-700">{entry.rows}</td>
                        <td className="py-3 text-slate-700">
                          {scopeStatusLabel(entry.status)}
                          {scopeStatusDescription(entry.status) ? (
                            <span className="mt-1 block text-xs text-slate-600">
                              {scopeStatusDescription(entry.status)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No scope recorded"
                description="The preview has not been computed for this request yet. That is expected before it is raised against the engine."
              />
            )}
          </section>

          <RequestActions
            organizationId={selected.organizationId}
            request={request}
            canConfirm={isAwaitingConfirmation(request.state)}
            canCancel={isCancellable(request.state)}
          />

          <section aria-labelledby="timeline-heading" className="mt-8">
            <h2 id="timeline-heading" className="text-lg font-semibold text-indigo-night-900">
              Evidence
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-700">
              What was recorded against this request. Holds are recorded against the hold rather
              than the request, so placing or releasing one appears on the{' '}
              <Link
                href="/privacy/holds"
                className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                holds screen
              </Link>{' '}
              and not here.
            </p>

            {events.length === 0 ? (
              <Empty
                title="Nothing recorded yet"
                description="Either nothing has happened, or the evidence could not be read just now. The state above is still accurate."
              />
            ) : (
              <ol className="mt-3 space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-card border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-indigo-night-900">
                        {auditActionLabel(event.action)}
                      </p>
                      <time dateTime={event.occurredAt} className="text-xs text-slate-600">
                        {event.occurredAt}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      {auditResultLabel(event.result)} · {event.reasonCode}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </>
  )
}
