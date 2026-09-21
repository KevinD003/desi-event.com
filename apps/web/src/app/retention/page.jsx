/**
 * What a retention rehearsal counted, and the three things it could not do.
 *
 * A read-only table of `RetentionSweep` rows. There is no button on this page
 * that starts a sweep, activates enforcement or deletes a row, and none of
 * those is a missing feature:
 *
 *   - **Nothing starts a sweep from a browser.** The API exposes no route that
 *     does, because it holds no queue client. Initiation is an operator action
 *     against the worker.
 *   - **Nothing activates enforcement.** That is a worker environment variable,
 *     set by whoever deploys the worker, and a page that could flip it would be
 *     a page that could switch on a policy nobody has approved.
 *   - **Nothing deletes.** No deletion path exists anywhere in the repository,
 *     and a `DRY_RUN` row claiming a non-zero `affectedCount` is refused by a
 *     database CHECK constraint whatever any code believes.
 *
 * ## What the screen must keep apart
 *
 * Three readings that all look like an empty table: nothing has ever run here,
 * it ran and declined, and it ran and found nothing. `summariseSweeps` decides
 * which sentence the page leads with, because an operator who conflates the
 * first two goes looking for a broken worker.
 *
 * ## Why the approval status is on every row
 *
 * Not once in the header. Each row carries its own `approval` from the server,
 * and it is rendered beside the count, because a number lifted out of this table
 * into a ticket or a screenshot has to bring its status with it.
 *
 * ## Why there is a rollup above the table
 *
 * The table is paginated and newest-first, which makes it good at "what
 * happened recently" and useless at "is any class being missed". A class whose
 * last rehearsal was four pages ago looks exactly like a class that has never
 * been rehearsed: both are simply not on the page in front of you.
 *
 * Filtering makes it actively misleading. Narrow to `FAILED` and every row on
 * screen is a failure, which reads as a system in which everything is broken.
 * The rollup ignores the filters on purpose — it is the fixed reference the
 * narrowed view is read against.
 *
 * It renders `null` as a sentence rather than a blank, because "no rehearsal
 * has ever covered this class" is a finding, and a finding rendered as an empty
 * cell is a finding nobody reads.
 *
 * ## Why the rollup is tolerated as absent
 *
 * `summary` is optional in the response contract, so this page must render
 * without it. That is not defensive padding: making a new field required on a
 * live response schema is a breaking change, and Fastify serialises against
 * that schema — a required field a handler forgot would have the API rejecting
 * its own payload.
 *
 * @module app/retention/page
 */

import { retentionFailureDescription } from '@desi-event/schemas'

import { AsOf, Failure } from '../../components/page-state.jsx'
import { listRetentionSweeps } from '../../lib/privacy-api.js'
import { describeRefusal } from '../../lib/privacy-vocabulary.js'
import {
  retentionClassDescription,
  retentionClassLabel,
  summariseSweeps,
  sweepStateDescription,
  sweepStateLabel,
} from '../../lib/retention-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Retention rehearsals',
  robots: { index: false, follow: false },
}

/**
 * Render a date as a plain ISO day, or a dash when there is none.
 *
 * @param {string|null} value An ISO timestamp.
 * @returns {string} The day, or an em dash.
 */
function day(value) {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : '—'
}

/**
 * What one class's most recent run says, in a sentence.
 *
 * Three different facts, and none of them is "nothing". A class with no run at
 * all is the one most worth saying out loud: it is the gap an operator cannot
 * see from a paginated table, because absence from a page looks identical to
 * absence from the system.
 *
 * @param {object} entry One `summary` entry.
 * @returns {string} The sentence.
 */
function standing(entry) {
  const { latest, runCount } = entry

  if (!latest) return 'No rehearsal has ever covered this class.'

  if (latest.state === 'SKIPPED_DISABLED') {
    return `Last run declined — enforcement is not activated where it ran. ${runCount} run${runCount === 1 ? '' : 's'} recorded.`
  }

  if (latest.state === 'FAILED') {
    return `Last run failed. ${retentionFailureDescription(latest.failureCode) ?? 'No reason was recorded.'}`
  }

  return `Last run counted ${latest.examinedCount}, of which ${latest.heldCount} held back. ${runCount} run${runCount === 1 ? '' : 's'} recorded.`
}

/**
 * @typedef {object} RetentionPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The rehearsal log.
 *
 * @param {RetentionPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function RetentionPage({ searchParams }) {
  const params = (await searchParams) ?? {}

  let sweeps = null
  let notEvaluated = []
  let pagination = null
  let summary = []
  let failure = null

  try {
    const answer = await listRetentionSweeps({
      retentionClass: params.retentionClass,
      state: params.state,
      page: params.page,
    })

    sweeps = answer.data ?? []
    notEvaluated = answer.notEvaluated ?? []
    pagination = answer.pagination ?? null
    // Optional in the contract, so absent is a shape this page has to handle
    // rather than a case it can assume away.
    summary = Array.isArray(answer.summary) ? answer.summary : []
  } catch (error) {
    failure = describeRefusal(error)
  }

  // Only when the read actually succeeded. `sweeps` is still null after a
  // refusal, and `summariseSweeps(null)` answers NONE_RECORDED — so passing it
  // through regardless printed "nothing has run here" above the error alert,
  // telling an operator whose request was refused that the system is idle.
  // That is the precise misreading this vocabulary exists to prevent, produced
  // by the page meant to prevent it.
  const reading = sweeps === null ? null : summariseSweeps(sweeps)
  const readAt = new Date().toISOString()

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold text-indigo-night-900">Retention rehearsals</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          What a retention sweep <em>would</em> reach, if the proposed durations were adopted.
          Nothing on this page has deleted anything, and nothing on this page can: there is no
          deletion path in this system, and the database refuses to record a rehearsal that claims
          to have changed something.
        </p>
      </header>

      {reading ? (
        <p
          className="mt-6 rounded-md border border-marigold-300 bg-marigold-50 px-4 py-3 text-sm text-indigo-night-900"
          data-testid="retention-reading"
        >
          {reading.sentence}
        </p>
      ) : null}

      {failure ? <Failure what={failure.title} detail={failure.detail} /> : null}

      {summary.length > 0 ? (
        <section className="mt-8" aria-labelledby="where-each-class-stands">
          <h2 id="where-each-class-stands" className="text-lg font-semibold text-indigo-night-900">
            Where each class stands
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">
            The most recent run for every evaluated class, whatever this page is filtered to. The
            table below answers what happened recently; this answers whether anything is being
            missed.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="retention-standing">
            {summary.map((entry) => (
              <li
                key={entry.retentionClass}
                className="rounded-card border border-slate-200 bg-slate-50 p-4"
              >
                <p className="font-medium text-indigo-night-900">
                  {retentionClassLabel(entry.retentionClass)}
                </p>
                <p className="mt-1 text-sm text-slate-700">{standing(entry)}</p>
                {entry.latest ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Cut-off {day(entry.latest.olderThan)} — {entry.latest.approval}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sweeps && sweeps.length > 0 ? (
        <>
          <AsOf asOf={readAt} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Retention rehearsals across the platform, newest first. Every duration is proposed
                and none is approved.
              </caption>
              <thead>
                <tr className="border-b border-slate-300 text-slate-700">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Class
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Outcome
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Counted
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Held back
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Deleted
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Cut-off
                  </th>
                </tr>
              </thead>
              <tbody>
                {sweeps.map((sweep) => (
                  <tr key={sweep.id} className="border-b border-slate-200 align-top">
                    <th scope="row" className="py-3 pr-4 font-medium text-indigo-night-900">
                      {retentionClassLabel(sweep.retentionClass)}
                      <span className="mt-1 block text-xs font-normal text-slate-600">
                        {retentionClassDescription(sweep.retentionClass)}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-slate-700">
                        {sweep.approval}
                      </span>
                    </th>
                    <td className="py-3 pr-4">
                      {sweepStateLabel(sweep.state)}
                      <span className="mt-1 block text-xs text-slate-600">
                        {sweepStateDescription(sweep.state)}
                      </span>
                      {sweep.failureCode ? (
                        <span className="mt-1 block text-xs text-slate-700">
                          {retentionFailureDescription(sweep.failureCode)}
                          {/*
                            The code as well as the wording. The wording is what
                            an operator reads; the code is what they quote into
                            a ticket, and a screen that showed only prose would
                            make them retype an approximation of it.
                          */}
                          <span className="mt-1 block font-mono text-slate-600">
                            {sweep.failureCode}
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{sweep.examinedCount}</td>
                    <td className="py-3 pr-4 tabular-nums">{sweep.heldCount}</td>
                    <td className="py-3 pr-4 tabular-nums">{sweep.affectedCount}</td>
                    <td className="py-3 pr-4 tabular-nums">{day(sweep.olderThan)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination ? (
            <p className="mt-4 text-sm text-slate-600">
              Showing {sweeps.length} of {pagination.total ?? sweeps.length}.
            </p>
          ) : null}
        </>
      ) : null}

      {notEvaluated.length > 0 ? (
        <section className="mt-10" aria-labelledby="not-evaluated">
          <h2 id="not-evaluated" className="text-lg font-semibold text-indigo-night-900">
            Not evaluated
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">
            Named by the policy, but no rehearsal covers them. Listed rather than left out: a class
            that quietly disappeared from the table above would read as one that was swept and found
            empty, which is a different claim.
          </p>
          <ul className="mt-4 space-y-4">
            {notEvaluated.map((entry) => (
              <li key={entry.retentionClass} className="border-l-2 border-slate-300 pl-4">
                <p className="font-medium text-indigo-night-900">
                  {retentionClassLabel(entry.retentionClass)}
                </p>
                <p className="mt-1 text-sm text-slate-700">{entry.reason}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Proposed at {entry.proposedDays} days — {entry.approval}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
