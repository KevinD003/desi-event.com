/**
 * Legal and fraud holds.
 *
 * A hold is the thing that refuses an erasure, so this screen is the answer to
 * "why can this person not be redacted". It lists what is active, what has been
 * released, and offers placing and releasing.
 *
 * ## `matterReference` points at a matter; it never describes one
 *
 * The field is bounded to 120 characters and required, and that bound is a
 * safety property rather than a formatting preference. An unbounded field here
 * is the obvious place for somebody to type the circumstances, and the
 * circumstances are personal data about the person whose erasure is being
 * blocked — recorded in the one subsystem that exists to keep that data out.
 * The screen says so at the point of entry, because a warning after the fact is
 * a warning that arrived too late.
 *
 * ## Two holds are not a conflict
 *
 * Two matters are two holds, by design. The API permits a second, so this
 * screen does not pretend otherwise or try to talk somebody out of it.
 *
 * @module app/privacy/holds/page
 */

import { AsOf, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { TABLE_FRAME } from '../../../components/workspace-kit.jsx'
import { listPrivacyHolds } from '../../../lib/privacy-api.js'
import { privacyOrganizations, readSession } from '../../../lib/session.js'
import { holdKindLabel, holdStateLabel } from '../../../lib/privacy-vocabulary.js'
import { HoldActions } from '../hold-actions.jsx'
import { StateBadge } from '../state-badge.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy holds',
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} PrivacyHoldsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The holds screen.
 *
 * @param {PrivacyHoldsPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PrivacyHoldsPage({ searchParams }) {
  const session = await readSession()
  const organizations = privacyOrganizations(session)
  const params = (await searchParams) ?? {}

  if (organizations.length === 0) {
    return <Forbidden area="Privacy holds" backHref="/" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === params.organizationId) ??
    organizations[0]

  let holds = null
  let failure = null

  try {
    const answer = await listPrivacyHolds(selected.organizationId, { state: params.state })

    holds = answer.data ?? []
  } catch (error) {
    failure = error
  }

  const readAt = new Date().toISOString()

  return (
    <>
      <header>
        <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
          Workspace · Trust and safety
        </p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">Privacy holds</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          A hold stops an erasure from running. While one is active, a request against that subject
          is refused and nothing is changed. Releasing a hold is its own recorded decision.
        </p>
      </header>

      <HoldActions organizationId={selected.organizationId} />

      {failure ? (
        <ReadRefusal error={failure} what="The privacy holds" action="see the privacy holds" />
      ) : null}

      {holds && holds.length === 0 ? (
        <Empty
          title="No holds"
          description="Nothing is blocking an erasure in this organisation. That is the expected resting state."
        />
      ) : null}

      {holds && holds.length > 0 ? (
        <>
          <AsOf asOf={readAt} />
          <div className={`mt-4 ${TABLE_FRAME}`}>
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Holds in {selected.organizationName ?? 'this organisation'}
              </caption>
              <thead>
                <tr className="border-b border-line-strong text-ink-muted">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Subject
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Kind
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Matter
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Placed
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Release
                  </th>
                </tr>
              </thead>
              <tbody>
                {holds.map((hold) => (
                  <tr key={hold.id} className="border-b border-line align-top">
                    <td className="py-3 pr-4 font-mono text-xs break-all text-ink">
                      {hold.subjectId}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">{holdKindLabel(hold.kind)}</td>
                    <td className="py-3 pr-4">
                      <StateBadge state={hold.state} label={holdStateLabel(hold.state)} />
                    </td>
                    <td className="py-3 pr-4 break-all text-ink-muted">{hold.matterReference}</td>
                    <td className="py-3 pr-4 text-ink-muted">
                      <time dateTime={hold.placedAt}>{hold.placedAt}</time>
                    </td>
                    <td className="py-3">
                      {hold.state === 'ACTIVE' ? (
                        <HoldActions
                          organizationId={selected.organizationId}
                          hold={hold}
                          releaseOnly
                        />
                      ) : (
                        <span className="text-xs text-ink-muted">
                          {hold.releaseReasonCode ?? 'Released'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  )
}
