/**
 * Imports: events listed on Sulekha, brought onto Desi-Event by the Desi-Event
 * team (SPEC2-XI I-H).
 *
 * An administrator uploads a listing file; the API plans it (nothing but the
 * plan is written) and the plan opens on its own page, where it is applied and
 * its events approved and published. This page holds the upload form and the
 * runs, newest first.
 *
 * The administration layout admits a platform administrator on other
 * capabilities too, and a moderator is never admitted; this page asks its own
 * question again (`event:import`, held by platform administrators and super
 * administrators), and the API refuses every read and write to anybody else.
 *
 * @module app/admin/imports/page
 */

import Link from 'next/link'
import { IMPORT_LIMITS } from '@desi-event/schemas/imports'

import { ReadRefusal, RefusalNotice } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { PANEL, TABLE_FRAME, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { getImportRuns } from '../../../lib/imports-api.js'
import { readSession } from '../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'
import {
  IMPORTS_PATH,
  NOT_FOR_THIS_ACCOUNT,
  PLAN_ACTIONS,
  RUN_STATUSES,
  runPath,
} from './import-vocabulary.js'
import { ImportUploadForm } from './import-upload-form.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Imports', robots: { index: false, follow: false } }

/** What the page says about itself. */
export const INTRODUCTION =
  'Bring events listed on Sulekha onto Desi-Event. Upload a listing file to plan an import; the plan opens on its own page, where you apply it within the hour. Each imported event is held under “Sulekha Events”, names the organiser who presents it, and sells its tickets on Sulekha. It is published only once you, or a moderator, approve it.'

/**
 * What applying a run did, in a line.
 *
 * @param {Record<string, number>|null} summary Counts by action.
 * @returns {string} The line.
 */
export function summaryLine(summary) {
  if (!summary) return 'Not applied'

  const parts = Object.entries(summary)
    .filter(([, count]) => Number.isInteger(count) && count > 0)
    .map(([action, count]) => `${PLAN_ACTIONS[action]?.label ?? action}: ${count}`)

  return parts.length > 0 ? parts.join(' · ') : 'Nothing written'
}

/**
 * @typedef {object} ImportsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The screen.
 *
 * @param {ImportsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ImportsPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const page = readPage(query.page)
  const session = await readSession()

  const heading = (
    <>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Imports</h1>
    </>
  )

  if (!sessionCan(session, 'event:import')) {
    return (
      <div>
        {heading}
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let runs = []
  let pagination = null
  let failure = null

  try {
    const result = await getImportRuns({ page })

    runs = result.runs
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  const beyond = !failure && isPastTheEnd(runs.length, pagination, page)

  return (
    <div>
      {heading}
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>

      <section aria-labelledby="upload-heading" className={`mt-6 p-4 sm:p-6 ${PANEL}`}>
        <h2 id="upload-heading" className="text-lg font-semibold text-ink">
          Plan an import
        </h2>
        <ImportUploadForm maxBytes={IMPORT_LIMITS.datasetBytes} />
      </section>

      <section aria-labelledby="runs-heading" className="mt-10">
        <h2 id="runs-heading" className="text-lg font-semibold text-ink">
          Imports planned
        </h2>

        {failure ? (
          <ReadRefusal error={failure} what="The list of imports" action="see the imports" />
        ) : null}

        {beyond ? (
          <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
            <p className="font-medium text-ink">Page {page} is past the end of this list</p>
            <p className="mt-3">
              <Link href={IMPORTS_PATH} className={PAGER_LINK_CLASSES}>
                Go to the first page
              </Link>
            </p>
          </div>
        ) : null}

        {!failure && !beyond && runs.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Nothing has been imported."
              description="Upload a listing file above to plan the first import."
            />
          </div>
        ) : null}

        {runs.length > 0 ? (
          <div className={`mt-4 ${TABLE_FRAME}`}>
            <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
              <caption className="sr-only">Imports, newest first</caption>
              <thead>
                <tr className="border-b border-line-strong text-ink-muted">
                  <th scope="col" className="pr-4 font-semibold">
                    File
                  </th>
                  <th scope="col" className="pr-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="pr-4 font-semibold">
                    Listings
                  </th>
                  <th scope="col" className="pr-4 font-semibold">
                    Planned
                  </th>
                  <th scope="col" className="font-semibold">
                    What applying it did
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const status = RUN_STATUSES[run.status] ?? { label: run.status, tone: 'neutral' }

                  return (
                    <tr key={run.id} className="border-b border-line align-top">
                      <td className="pr-4 break-all">
                        <Link href={runPath(run.id)} className={TEXT_LINK}>
                          {run.fileName}
                        </Link>
                      </td>
                      <td className="pr-4">
                        <Badge variant={status.tone} srLabel="Status:">
                          {status.label}
                        </Badge>
                      </td>
                      <td className="pr-4 text-ink tabular-nums">{run.eventCount}</td>
                      <td className="pr-4 text-ink-muted">
                        {formatInstant(run.createdAt)}
                        {run.createdByName ? ` by ${run.createdByName}` : ''}
                        {run.appliedAt ? (
                          <span className="block">
                            Applied {formatInstant(run.appliedAt)}
                            {run.appliedByName ? ` by ${run.appliedByName}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-ink-muted">{summaryLine(run.summary)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
          <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
            {pagination.hasPreviousPage ? (
              <Link
                href={listHref(IMPORTS_PATH, { page: page - 1 })}
                className={PAGER_LINK_CLASSES}
              >
                Previous page
              </Link>
            ) : null}
            {pagination.hasNextPage ? (
              <Link
                href={listHref(IMPORTS_PATH, { page: page + 1 })}
                className={PAGER_LINK_CLASSES}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}
