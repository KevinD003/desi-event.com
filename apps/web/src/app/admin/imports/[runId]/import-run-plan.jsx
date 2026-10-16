'use client'

/**
 * A run's plan, and what can be done with it (SPEC2-XI I-H).
 *
 * One table, one row per listing: what applying the plan does to it (in
 * words), the curator's notes, and the event it wrote. Imports copy no
 * pictures (ADR 0015, addendum 2026-10-15 (2)); only a run applied by an older
 * build that did has a "Pictures" column, read-only, saying how that went. Two
 * actions, each sent once more after a second factor when the API asks for
 * one:
 *
 *   - **"Import these {n} events"** (`POST …/apply`, the MODERATION window),
 *     while the plan is new. A published event whose listing has changed is
 *     left alone unless its "Update from the listing" box is ticked.
 *   - **"Approve and publish {n} events"** (`POST …/approve`, the
 *     EVENT_PUBLISH window), once it is applied. Each event waiting for
 *     review, approved by a moderator, or (an older run) published with
 *     pictures waiting has
 *     a box; the answer is reported event by event in a polite live region.
 *     A run of hundreds of listings is not ticked box by box: "Tick all {n}
 *     shown" ticks every such event at once, or the first {limit} of them when
 *     there are more, since one request approves at most `approveLimit`
 *     (`IMPORT_LIMITS.approveItems`). Once those are published the page is
 *     read again, so the same button ticks the next ones. More boxes ticked
 *     by hand than one request takes are refused before anything is sent.
 *
 * There is no "Retry pictures": nothing is copied, so nothing is copied again.
 * The page is read again after every action, so what it shows is what the API
 * holds. No address of the listing's site reaches this component: the server
 * page drops any an older run carried.
 *
 * `@file` rather than `@module`: the path is not a valid JSDoc namepath.
 *
 * @file app/admin/imports/runId/import-run-plan
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { useFocusAfterRender } from '../../../../components/focus-after-render.jsx'
import { TEXT_LINK } from '../../../../components/link-classes.js'
import { StepUpPrompt } from '../../../../components/step-up-prompt.jsx'
import { Alert, Badge, Button } from '../../../../components/ui.jsx'
import { apiFetch } from '../../../../lib/api-fetch.js'
import { statusReading } from '../../../../lib/event-status.js'
import { describeApiRefusal, parseRetryAfter, refusalSentence } from '../../../../lib/refusal.js'
import {
  MEDIA_STATUSES,
  PICTURE_STATUSES,
  approveSentence,
  failureReason,
  planReading,
  ticketTypeCount,
  ticketTypesLine,
  writtenCount,
} from '../import-vocabulary.js'

/** A link in the events column: never less than a 24 px target (WCAG 2.5.8). */
const EVENT_LINK_TARGET = 'inline-flex min-h-6 items-center'

/** Statuses on the public site: approving one only approves its waiting pictures. */
const PUBLIC = new Set([
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'POSTPONED',
  'CANCELLED',
  'COMPLETED',
])

/**
 * Whether "Approve and publish" can act on a row's event.
 *
 * @param {object} row A run row.
 * @returns {boolean} True for an event of this run, still held for import, waiting for review, approved, published with an imported ticket type still waiting to go on sale, or (an older run) published with pictures waiting.
 */
export function approvable(row) {
  const event = row.event

  if (!event || !event.inThisRun || event.reassigned) return false
  if (event.status === 'REVIEW_PENDING' || event.status === 'APPROVED') return true

  // Published, with a ticket type the import made still waiting (a DRAFT):
  // approving puts it on sale. One whose imported tiers are all closed, sold
  // out on the listing, has nothing to put on sale, and the API refuses it;
  // it used to be ticked in every "Tick all" batch and refused every time.
  if (event.status === 'PUBLISHED' && (event.ticketTypes?.waiting ?? 0) > 0) {
    return true
  }

  return (
    PUBLIC.has(event.status) &&
    (row.pictures ?? []).some(
      (picture) => picture.status === 'STORED' && picture.mediaStatus === 'PENDING',
    )
  )
}

/**
 * One picture's line.
 *
 * @param {object} props Component props.
 * @param {object} props.picture The picture.
 * @param {number} props.index Its place among the listing's pictures.
 * @returns {JSX.Element} The line.
 */
function PictureLine({ picture, index }) {
  const status = PICTURE_STATUSES[picture.status] ?? { label: picture.status, tone: 'neutral' }
  const reason = picture.status === 'FAILED' ? failureReason(picture.failureCode) : null
  const approval = picture.mediaStatus ? MEDIA_STATUSES[picture.mediaStatus] : null

  return (
    <li>
      <span className="font-medium text-ink">
        {picture.role === 'COVER' ? 'Cover' : `Picture ${index + 1}`}
      </span>
      {': '}
      {status.label}
      {approval ? `, ${approval}` : ''}
      {picture.note ? ` (${picture.note})` : ''}
      {reason ? <span className="block text-status-danger">{reason}</span> : null}
    </li>
  )
}

/**
 * @typedef {object} ImportRunPlanProps
 * @property {object} run The run, as the server page read it, without picture addresses.
 * @property {boolean} canApprove Whether this session may approve (the server page asked).
 * @property {number} [approveLimit] The most events one approval request names
 *   (`IMPORT_LIMITS.approveItems`, which the server page passes).
 */

/**
 * The plan and its actions.
 *
 * @param {ImportRunPlanProps} props Component props.
 * @returns {JSX.Element} The plan.
 */
export function ImportRunPlan({ run, canApprove, approveLimit = 100 }) {
  const router = useRouter()
  const id = useId()
  const focusAfterRender = useFocusAfterRender()
  const messageRef = useRef(null)
  const [updateFromSource, setUpdateFromSource] = useState([])
  const [chosen, setChosen] = useState([])
  const [busy, setBusy] = useState(null)
  const [stepUp, setStepUp] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [done, setDone] = useState(null)
  const [results, setResults] = useState([])

  const previewed = run.status === 'PREVIEWED'
  const applied = run.status === 'APPLIED'
  const toWrite = writtenCount(run.rows, updateFromSource)
  const approvableRows = applied ? run.rows.filter(approvable) : []
  const picked = approvableRows.filter((row) => chosen.includes(row.event.id))
  const nextBatch = approvableRows.slice(0, approveLimit)
  const tooMany = picked.length > approveLimit
  // Only a run an older build applied, which copied pictures, has any.
  const picturesShown = run.rows.some((row) => (row.pictures ?? []).length > 0)
  const titles = new Map(
    run.rows.filter((row) => row.event).map((row) => [row.event.id, row.title]),
  )

  /**
   * Toggle a value in a list held in state.
   *
   * @param {Function} set The setter.
   * @param {string} value The value.
   * @param {boolean} on Whether it is now ticked.
   * @returns {void} Nothing.
   */
  function toggle(set, value, on) {
    set((current) =>
      on ? [...new Set([...current, value])] : current.filter((each) => each !== value),
    )
  }

  /**
   * Send one action.
   *
   * @param {'apply'|'approve'} action Which.
   * @param {boolean} [retried] Whether this is the one retry after a step-up.
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  async function send(action, retried = false) {
    const requests = {
      apply: {
        path: `/v1/platform/imports/${encodeURIComponent(run.id)}/apply`,
        body: { planDigest: run.planDigest, updateFromSource },
        failed: 'Nothing was imported.',
      },
      approve: {
        path: `/v1/platform/imports/${encodeURIComponent(run.id)}/approve`,
        body: {
          items: picked.map((row) => ({ eventId: row.event.id, revision: row.event.revision })),
        },
        failed: 'Nothing was approved.',
      },
    }
    const request = requests[action]

    setBusy(action)
    setRefusal(null)
    setDone(null)
    if (action === 'approve') setResults([])

    try {
      const response = await apiFetch(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      })
      const parsed = await response.json().catch(() => null)

      if (response.ok) {
        if (action === 'approve') {
          setResults(parsed?.data?.results ?? [])
          setChosen([])
        } else {
          setDone(
            'The plan was applied. Its events wait for review: approve and publish them here.',
          )
          setUpdateFromSource([])
        }

        focusAfterRender(messageRef)
        router.refresh()
        return
      }

      if (parsed?.error?.code === 'STEP_UP_REQUIRED' && !retried) {
        setStepUp(action)
        return
      }

      setRefusal(
        refusalSentence(
          response.status,
          parsed,
          request.failed,
          parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
        ),
      )
      focusAfterRender(messageRef)
      // A plan that changed or expired, or an event that moved on, reads
      // differently now: show what the API holds.
      if (response.status === 409) router.refresh()
    } catch {
      setRefusal(describeApiRefusal(null).detail)
      focusAfterRender(messageRef)
    } finally {
      setBusy(null)
    }
  }

  const stepUpActions = {
    apply: 'import these events',
    approve: 'approve and publish these events',
  }

  return (
    <div className="mt-6">
      <div ref={messageRef} tabIndex={-1} className="focus-visible:outline-none">
        {/* Always drawn, so what is put in it is announced; plain markup
            inside, since an Alert is a live region of its own. */}
        <div role="status" aria-live="polite">
          {done ? (
            <div className="rounded-card border border-status-success/25 bg-status-success-soft p-4 text-sm text-ink">
              <p className="font-semibold">Done</p>
              <p className="mt-1">{done}</p>
            </div>
          ) : null}
          {results.length > 0 ? (
            <div className="rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
              <p className="font-semibold">Approve and publish</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {results.map((result) => (
                  <li key={result.eventId}>
                    {approveSentence(result, titles.get(result.eventId) ?? 'An event')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {refusal ? (
          <Alert variant="error" title="Not done">
            <p>{refusal}</p>
          </Alert>
        ) : null}
      </div>

      {/*
        Positioned, so the screen-reader-only words in the wide table (a
        badge's "Status:", the caption) scroll inside this frame: a scroll box
        clips only the absolutely positioned descendants whose containing
        block it is, and without one they widened the page at 320 px. A named,
        focusable region, so the columns past the edge can be reached by
        keyboard when no row has a box to tick (WCAG 2.1.1; as
        `ScrollableTable` does).
      */}
      <div
        role="region"
        aria-label={`The plan for ${run.fileName}, scrolls sideways`}
        tabIndex={0}
        className="relative mt-4 overflow-x-auto rounded-card border border-line bg-surface-raised shadow-card focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
      >
        <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            {`The plan for ${run.fileName}, one row per listing`}
          </caption>
          <thead className="bg-surface-subtle">
            <tr className="border-b border-line-strong text-ink-muted">
              <th scope="col" className="py-3 pr-4 pl-4 font-semibold">
                {previewed ? 'Update from the listing' : applied ? 'Approve' : 'Choose'}
              </th>
              <th scope="col" className="py-3 pr-4 font-semibold">
                Listing
              </th>
              <th scope="col" className="py-3 pr-4 font-semibold">
                What applying does
              </th>
              <th scope="col" className="py-3 pr-4 font-semibold">
                Notes
              </th>
              {picturesShown ? (
                <th scope="col" className="py-3 pr-4 font-semibold">
                  Pictures
                </th>
              ) : null}
              <th scope="col" className="py-3 pr-4 font-semibold">
                Event
              </th>
            </tr>
          </thead>
          <tbody>
            {run.rows.map((row) => {
              const reading = planReading(row)
              const event = row.event
              const eventReading = event ? statusReading(event.status) : null
              const updateBox = previewed && row.updatable
              const approveBox = applied && canApprove && approvable(row)

              return (
                <tr key={row.sourceId} className="border-b border-line align-top">
                  <td className="py-3 pr-4 pl-4">
                    {updateBox ? (
                      <input
                        type="checkbox"
                        id={`${id}-update-${row.sourceId}`}
                        aria-label={`Update “${row.title}” from the listing`}
                        checked={updateFromSource.includes(row.sourceId)}
                        onChange={(changed) =>
                          toggle(setUpdateFromSource, row.sourceId, changed.target.checked)
                        }
                        className="h-6 w-6 accent-action-primary"
                      />
                    ) : null}
                    {approveBox ? (
                      <input
                        type="checkbox"
                        id={`${id}-approve-${event.id}`}
                        aria-label={`Approve “${row.title}”`}
                        checked={chosen.includes(event.id)}
                        onChange={(changed) => toggle(setChosen, event.id, changed.target.checked)}
                        className="h-6 w-6 accent-action-primary"
                      />
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-ink">{row.title}</p>
                    <p className="text-xs text-ink-muted">
                      {`Listing ${row.sourceId}`}
                      {row.city ? ` · ${row.city}` : ''}
                      {row.endTimeListed ? '' : ' · No end time listed'}
                    </p>
                    {ticketTypesLine(row) ? (
                      <p className="text-xs text-ink-muted">{`${ticketTypesLine(row)}${
                        row.currency ? `, in ${row.currency}` : ''
                      }`}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={reading.tone} srLabel="Plan:">
                      {reading.label}
                    </Badge>
                    <p className="mt-1 max-w-xs text-xs text-ink-muted">{reading.detail}</p>
                  </td>
                  <td className="py-3 pr-4">
                    {row.importNotes.length > 0 ? (
                      <ul className="max-w-xs list-disc space-y-1 pl-4 text-xs text-ink-muted">
                        {row.importNotes.map((note, index) => (
                          <li key={`${index}-${note}`}>{note}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-ink-muted">None</span>
                    )}
                  </td>
                  {picturesShown ? (
                    <td className="py-3 pr-4">
                      {(row.pictures ?? []).length > 0 ? (
                        <ul className="max-w-xs space-y-1 text-xs text-ink-muted">
                          {row.pictures.map((picture, index) => (
                            <PictureLine key={picture.id} picture={picture} index={index} />
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-ink-muted">None</span>
                      )}
                    </td>
                  ) : null}
                  <td className="py-3 pr-4">
                    {event ? (
                      <>
                        <Badge variant={eventReading.tone} srLabel="Status:">
                          {eventReading.label}
                        </Badge>
                        {event.ticketTypes && event.ticketTypes.imported > 0 ? (
                          <p className="mt-1 text-xs text-ink-muted">
                            {`${event.ticketTypes.onSale} of ${ticketTypeCount(event.ticketTypes.imported)} on sale`}
                          </p>
                        ) : null}
                        {event.reassigned ? (
                          <p className="mt-1 text-xs text-ink-muted">
                            {`Moved to ${event.organizationName ?? 'an organiser’s organisation'}`}
                          </p>
                        ) : null}
                        {/*
                          Each link at least 24 px high: wrapped one above the
                          other in a narrow column, two text-high links left
                          too little room to touch either (WCAG 2.5.8).
                        */}
                        <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          {event.status === 'REVIEW_PENDING' ? (
                            <Link
                              href={`/moderation/events/${encodeURIComponent(event.id)}`}
                              className={`${TEXT_LINK} ${EVENT_LINK_TARGET}`}
                            >
                              {`Review “${row.title}”`}
                            </Link>
                          ) : null}
                          <Link
                            href={`/admin/events/${encodeURIComponent(event.id)}`}
                            className={`${TEXT_LINK} ${EVENT_LINK_TARGET}`}
                          >
                            {`Open “${row.title}”`}
                          </Link>
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-ink-muted">Not written</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {stepUp ? (
        <div className="mt-4">
          <StepUpPrompt
            action={stepUpActions[stepUp]}
            onConfirmed={() => {
              const action = stepUp

              setStepUp(null)
              void send(action, true)
            }}
            onCancel={() => setStepUp(null)}
          />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {previewed ? (
          toWrite > 0 ? (
            <Button
              type="button"
              className="min-h-11"
              disabled={busy !== null || stepUp !== null}
              onClick={() => void send('apply')}
            >
              {busy === 'apply'
                ? 'Importing…'
                : toWrite === 1
                  ? 'Import this 1 event'
                  : `Import these ${toWrite} events`}
            </Button>
          ) : (
            <p className="text-sm text-ink-muted">Nothing in this plan would be imported.</p>
          )
        ) : null}

        {applied && canApprove && approvableRows.length > 1 ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={busy !== null || stepUp !== null}
            onClick={() => setChosen(nextBatch.map((row) => row.event.id))}
          >
            {approvableRows.length > approveLimit
              ? `Tick the first ${approveLimit} of ${approvableRows.length} shown`
              : `Tick all ${approvableRows.length} shown`}
          </Button>
        ) : null}

        {applied && canApprove && chosen.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={busy !== null || stepUp !== null}
            onClick={() => setChosen([])}
          >
            Untick all
          </Button>
        ) : null}

        {applied && canApprove && approvableRows.length > 0 ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy !== null || stepUp !== null || picked.length === 0 || tooMany}
            aria-describedby={tooMany ? `${id}-too-many` : undefined}
            onClick={() => void send('approve')}
          >
            {busy === 'approve'
              ? 'Approving…'
              : `Approve and publish ${picked.length} ${picked.length === 1 ? 'event' : 'events'}`}
          </Button>
        ) : null}

        {applied && canApprove && approvableRows.length > approveLimit ? (
          <p className="w-full text-sm text-ink-muted">
            {`${approvableRows.length} events are waiting to be approved here. One approval takes at most ${approveLimit}: tick the first ${approveLimit}, approve and publish them, then tick the next ones the same way.`}
          </p>
        ) : null}

        {tooMany ? (
          <p id={`${id}-too-many`} className="w-full text-sm font-medium text-status-danger">
            {`${picked.length} events are ticked, and one approval takes at most ${approveLimit}. Untick ${picked.length - approveLimit}, or use “Untick all” and tick the first ${approveLimit}.`}
          </p>
        ) : null}

        {applied && !canApprove ? (
          <p className="text-sm text-ink-muted">
            Approving and publishing needs a moderator’s review rights as well, which this account
            does not have.
          </p>
        ) : null}
      </div>
    </div>
  )
}
