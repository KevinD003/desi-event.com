/**
 * One import: its plan, applying it, and approving and publishing its events
 * (SPEC2-XI I-H).
 *
 * A plan is applied within the hour it was made; after that it has expired
 * and the file is planned again. Applying creates or updates each listing's
 * event as a draft under "The Desi Events", with a ticket type for each price
 * it lists, and sends it for review; approving one publishes it with its
 * tickets on sale here. Imports copy no pictures and keep no link to the
 * listing (ADR 0015, addendum 2026-10-15 (2)), so there is nothing to copy
 * again and nothing to open.
 *
 * The page asks its own question (`event:import`) as the list does, and asks
 * whether this session may also review (`moderation:review`), which approving
 * needs; the API decides both again. Should the run's answer still carry an
 * address of the listing's site (a run made by an older build), it is dropped
 * here before anything reaches the browser.
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

/** The addresses a row of an older build's run carried, none of which the browser gets. */
const SOURCE_ADDRESS_FIELDS = Object.freeze([
  'sourceUrl',
  'ticketUrl',
  'url',
  'imageUrls',
  'images',
])

/**
 * The run as the browser may hold it: every address of the listing's site
 * dropped, from a row and from each picture an older build's run recorded.
 *
 * @param {object} run The API's run.
 * @returns {object} The same run, without them.
 */
export function withoutSourceAddresses(run) {
  return {
    ...run,
    rows: (run.rows ?? []).map((row) => {
      const kept = { ...row }

      for (const field of SOURCE_ADDRESS_FIELDS) delete kept[field]

      kept.pictures = (row.pictures ?? []).map((picture) => {
        const keptPicture = { ...picture }

        delete keptPicture.url

        return keptPicture
      })

      return kept
    }),
  }
}

/** What an applied run's page says about pictures: an import copies none. */
export const NO_PICTURES_SENTENCE =
  'Imports copy no pictures: each imported event shows a generated poster until a picture is added to it in an editing session.'

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
  let failure = null

  try {
    run = (await getImportRun(runId)).run
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
          {`Nothing has been imported. Check the plan, tick “Update from the listing” for any published event you want updated, and import it before ${formatInstant(run.expiresAt)}.`}
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
          {`Imported events wait for review: approve and publish them here, which puts their tickets on sale here. A moderator may approve one from the review queue first; it is then published from here. ${NO_PICTURES_SENTENCE}`}
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
