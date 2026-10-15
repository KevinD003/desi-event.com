/**
 * One import: its plan, applying it, approving and publishing its events, and
 * copying its pictures again (SPEC2-XI I-H).
 *
 * A plan is applied within the hour it was made; after that it has expired
 * and the file is planned again. Applying creates or updates each listing's
 * event as a draft under "Sulekha Events" and sends it for review; approving
 * one publishes it, with its Sulekha ticket link on.
 *
 * The page asks its own question (`event:import`) as the list does, and asks
 * whether this session may also review (`moderation:review`), which approving
 * needs; the API decides both again. The run's answer names the listing
 * site's picture addresses, which are dropped here before anything reaches the
 * browser.
 *
 * `@file` rather than `@module`: the path's `[runId]` segment is not a valid
 * JSDoc namepath.
 *
 * @file app/admin/imports/runId/page.jsx
 */

import Link from 'next/link'
import { IMPORT_LIMITS } from '@desi-event/schemas/imports'

import { ReadRefusal, RefusalNotice } from '../../../../components/read-refusal.jsx'
import { Badge } from '../../../../components/ui.jsx'
import { TEXT_LINK } from '../../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../../lib/capabilities.js'
import { getImportRun } from '../../../../lib/imports-api.js'
import { readSession } from '../../../../lib/session.js'
import { formatInstant } from '../../../../lib/workspace-api.js'
import { IMPORTS_PATH, NOT_FOR_THIS_ACCOUNT, RUN_STATUSES } from '../import-vocabulary.js'
import { ImportRunPlan } from './import-run-plan.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Import', robots: { index: false, follow: false } }

/**
 * The run as the browser may hold it: every picture's source address dropped.
 *
 * @param {object} run The API's run.
 * @returns {object} The same run, without them.
 */
export function withoutSourceAddresses(run) {
  return {
    ...run,
    rows: (run.rows ?? []).map((row) => ({
      ...row,
      pictures: (row.pictures ?? []).map((picture) => {
        const kept = { ...picture }

        delete kept.url

        return kept
      }),
    })),
  }
}

/**
 * Where the run's pictures stand, in a sentence.
 *
 * @param {{total: number, stored: number, failed: number, waiting: number}} pictures The counts.
 * @param {number} waiting How many the last request left waiting.
 * @returns {string} The sentence.
 */
export function picturesSentence(pictures, waiting) {
  if (!pictures || pictures.total === 0) return 'The listings in this run name no pictures.'

  const line = `Pictures: ${pictures.stored} of ${pictures.total} copied, ${pictures.failed} not copied, ${pictures.waiting} waiting.`

  return waiting > 0 ? `${line} ${waiting} pictures are still waiting: use Retry pictures.` : line
}

/**
 * @typedef {object} ImportRunPageProps
 * @property {Promise<{runId: string}>} params The route's parameters.
 */

/**
 * The screen.
 *
 * @param {ImportRunPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ImportRunPage({ params }) {
  const { runId } = await params
  const session = await readSession()

  const eyebrow = (
    <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
      Workspace · Platform administration ·{' '}
      <Link href={IMPORTS_PATH} className={TEXT_LINK}>
        Imports
      </Link>
    </p>
  )

  if (!sessionCan(session, 'event:import')) {
    return (
      <div>
        {eyebrow}
        <h1 className="mt-2 text-h2 font-semibold text-ink">Import</h1>
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let run = null
  let picturesWaiting = 0
  let failure = null

  try {
    const result = await getImportRun(runId)

    run = result.run
    picturesWaiting = result.picturesWaiting
  } catch (error) {
    failure = error
  }

  if (failure || !run) {
    return (
      <div>
        {eyebrow}
        <h1 className="mt-2 text-h2 font-semibold text-ink">Import</h1>
        <ReadRefusal
          error={failure}
          what="This import"
          action="see this import"
          backHref={IMPORTS_PATH}
          backLabel="Back to the imports"
        />
      </div>
    )
  }

  const status = RUN_STATUSES[run.status] ?? { label: run.status, tone: 'neutral' }

  return (
    <div>
      {eyebrow}
      <h1 className="mt-2 text-h2 font-semibold break-all text-ink">{run.fileName}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
        <Badge variant={status.tone} srLabel="Status:">
          {status.label}
        </Badge>
        <span>
          {`${run.eventCount} ${run.eventCount === 1 ? 'listing' : 'listings'}, planned ${formatInstant(run.createdAt)}`}
          {run.createdByName ? ` by ${run.createdByName}` : ''}
          {run.appliedAt ? `; applied ${formatInstant(run.appliedAt)}` : ''}
          {run.appliedAt && run.appliedByName ? ` by ${run.appliedByName}` : ''}.
        </span>
      </p>

      {run.status === 'PREVIEWED' ? (
        <p className="mt-3 max-w-3xl text-ink-muted">
          {`Nothing has been imported. Check the plan, tick “Update from Sulekha” for any published event you want updated, and import it before ${formatInstant(run.expiresAt)}.`}
        </p>
      ) : null}

      {run.status === 'EXPIRED' ? (
        <p className="mt-3 max-w-3xl text-ink-muted">
          This plan was not applied within its hour, so it cannot be applied now. Upload the file
          again to plan it afresh.
        </p>
      ) : null}

      {run.status === 'APPLIED' ? (
        <p className="mt-3 max-w-3xl text-ink-muted">
          {`${picturesSentence(run.pictures, picturesWaiting)} Imported events wait for review: approve and publish them here. A moderator may approve one from the review queue first; it is then published from here.`}
        </p>
      ) : null}

      <ImportRunPlan
        run={withoutSourceAddresses(run)}
        canApprove={sessionCan(session, 'moderation:review')}
        approveLimit={IMPORT_LIMITS.approveItems}
      />
    </div>
  )
}
