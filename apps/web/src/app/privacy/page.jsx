/**
 * The privacy request queue.
 *
 * Every erasure this organisation has raised, in the order they were raised.
 * The queue is the first thing an operator sees and the place they come back to
 * after acting, so it carries the state of each request plainly rather than
 * burying it behind a click.
 *
 * ## What a row is allowed to show
 *
 * An opaque subject id, a state, a reason, timestamps, and an outcome code once
 * there is one. No name, no address, no value. That is not a rendering choice —
 * `privacyRequestSchema` has no `subjectEmail` and no `subjectName`, because the
 * payload identifies the person to the system without naming them to whoever is
 * reading the screen. A column here that resolved the id to a person would undo
 * that.
 *
 * ## Why there is no subject search
 *
 * Because finding a person by address is the oracle this whole surface exists
 * to not be. An operator arrives with a subject id from a support process; the
 * screens take it from there.
 *
 * @module app/privacy/page
 */

import Link from 'next/link'

import { AsOf, Empty, Failure, Forbidden } from '../../components/page-state.jsx'
import { listPrivacyRequests } from '../../lib/privacy-api.js'
import { privacyOrganizations, readSession } from '../../lib/session.js'
import {
  describeRefusal,
  holdDecisionLabel,
  outcomeLabel,
  requestReasonLabel,
  requestStateLabel,
} from '../../lib/privacy-vocabulary.js'
import { OrganizationPicker } from './organization-picker.jsx'
import { StateBadge } from './state-badge.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy requests',
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} PrivacyRequestsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The queue.
 *
 * @param {PrivacyRequestsPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PrivacyRequestsPage({ searchParams }) {
  const session = await readSession()
  const organizations = privacyOrganizations(session)
  const params = (await searchParams) ?? {}

  if (organizations.length === 0) {
    return <Forbidden area="The privacy queue" backHref="/" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === params.organizationId) ??
    organizations[0]

  let requests = null
  let pagination = null
  let failure = null

  try {
    const answer = await listPrivacyRequests(selected.organizationId, {
      state: params.state,
      page: params.page,
    })

    requests = answer.data ?? []
    pagination = answer.pagination ?? null
  } catch (error) {
    failure = describeRefusal(error)
  }

  const readAt = new Date().toISOString()

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold text-ink">Privacy requests</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          Erasures raised in this organisation. A request changes nothing until somebody types back
          the phrase the server issued, and what it can reach is limited to this
          organisation&rsquo;s own records.
        </p>
      </header>

      <OrganizationPicker
        organizations={organizations}
        selectedId={selected.organizationId}
        state={params.state ?? ''}
      />

      {failure ? <Failure what={failure.title} detail={failure.detail} /> : null}

      {requests && requests.length === 0 ? (
        <Empty
          title="No requests"
          description="Nothing has been raised in this organisation yet. That is the expected resting state — an empty queue is not a broken one."
        />
      ) : null}

      {requests && requests.length > 0 ? (
        <>
          <AsOf asOf={readAt} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Privacy requests in {selected.organizationName ?? 'this organisation'}, newest first
              </caption>
              <thead>
                <tr className="border-b border-line-strong text-ink-muted">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Subject
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Why
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Holds
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Raised
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="border-b border-line align-top">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/privacy/requests/${request.id}?organizationId=${selected.organizationId}`}
                        className="rounded-sm font-mono text-xs break-all underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        {request.subjectId}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <StateBadge state={request.state} label={requestStateLabel(request.state)} />
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {requestReasonLabel(request.reason)}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {holdDecisionLabel(request.holdDecision)}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      <time dateTime={request.requestedAt}>{request.requestedAt}</time>
                    </td>
                    <td className="py-3 text-ink-muted">
                      {outcomeLabel(request.outcomeCode) ?? (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing {requests.length} of {pagination.total ?? requests.length}.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}
