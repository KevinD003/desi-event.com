/**
 * What a deleted event's own page says to the people who ran it, and to the
 * team at The Desi Events: when it was deleted, by whom (as far as the reader
 * may be told), why, and what deleting it did.
 *
 * Only the team at The Desi Events restores; the organiser is told to ask them.
 * The team is told above "Restore…" that nothing was erased, that it can be
 * restored at any time, and what it comes back as, at which address.
 * The controls it offers come in as booleans the server page worked out: this
 * component names no capability.
 *
 * Renders on the server; the restore and refund controls are client islands.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/deleted-event-summary
 */

import Link from 'next/link'

import { FinishRefundsButton } from './finish-refunds-button.jsx'
import { TEXT_LINK } from './link-classes.js'
import { RestoreEventDialog } from './restore-event-dialog.jsx'
import { Badge } from './ui.jsx'
import {
  deletedByReading,
  deletedRefundSentences,
  deletionOutcomeReading,
  restoreSentences,
  slugReleased,
} from '../lib/event-control.js'
import { statusReading } from '../lib/event-status.js'
import { formatEventDate, formatEventTime } from '../lib/format.js'

/**
 * @typedef {object} DeletedEventSummaryProps
 * @property {object} event The deleted event, with its `deletion` record.
 * @property {boolean} [mayRestore] Whether this reader may restore it (the team at The Desi Events).
 * @property {boolean} [mayFinishRefunds] Whether this reader may send the refunds it still owes.
 * @property {object|null} [refundCounts] For an event whose deletion refunded its orders: the counts of
 *   a deletion preview read now, which say what is still owed back; nothing is said about refunds without them.
 * @property {string|null} [refundsHref] The organisation's refund queue, for a reader who may read it.
 */

/**
 * The summary.
 *
 * @param {DeletedEventSummaryProps} props Component props.
 * @returns {JSX.Element} The section.
 */
export function DeletedEventSummary({
  event,
  mayRestore = false,
  mayFinishRefunds = false,
  refundCounts = null,
  refundsHref = null,
}) {
  const deletion = event.deletion ?? null
  const refunded = deletion?.outcome === 'CANCEL_AND_REFUND'
  const refundSentences = refunded ? deletedRefundSentences(refundCounts) : []
  const zone = event.timezone ?? 'UTC'
  const reading = statusReading('DELETED')

  return (
    <section
      aria-labelledby="deleted-event-heading"
      className="max-w-3xl space-y-4 rounded-card border border-status-danger/25 bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="deleted-event-heading" className="text-xl font-semibold text-ink">
          This event was deleted
        </h2>
        <Badge variant={reading.tone} srLabel="State:">
          {reading.label}
        </Badge>
      </div>

      <p className="text-ink">{reading.next}</p>

      {deletion ? (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-ink">When and by whom</dt>
            <dd className="text-ink">
              {formatEventDate(deletion.deletedAt, zone)} at{' '}
              {formatEventTime(deletion.deletedAt, zone)}, by {deletedByReading(deletion)}.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Reason given</dt>
            <dd className="whitespace-pre-line text-ink">{deletion.reason}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">What deleting it did</dt>
            <dd className="text-ink">{deletionOutcomeReading(deletion.outcome)}</dd>
          </div>
          {refunded && (refundSentences.length > 0 || refundsHref) ? (
            <div>
              <dt className="font-semibold text-ink">Refunds</dt>
              {refundSentences.map((sentence) => (
                <dd key={sentence} className="text-ink">
                  {sentence}
                </dd>
              ))}
              {refundsHref ? (
                <dd className="mt-1">
                  <Link href={refundsHref} className={TEXT_LINK}>
                    The organisation’s refund queue
                  </Link>
                </dd>
              ) : null}
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-ink">Before it was deleted</dt>
            <dd className="text-ink">{statusReading(deletion.statusBefore).label}</dd>
          </div>
        </dl>
      ) : null}

      {refunded && mayFinishRefunds ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            Any refunds it still owes, and any that did not go through, are sent from here. Orders
            whose payment is disputed are left to the finance team.
          </p>
          <FinishRefundsButton eventId={event.id} />
        </div>
      ) : null}

      {mayRestore ? (
        <div className="space-y-3">
          <div data-testid="restore-sentences" className="space-y-1 text-sm text-ink">
            {restoreSentences(event).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
          <RestoreEventDialog event={event} />
        </div>
      ) : slugReleased(event) ? (
        // Never public, so its address was freed when it was deleted and the
        // placeholder it holds now is no address anybody has seen.
        <p className="text-sm text-ink">
          {`Only the team at The Desi Events can restore a deleted event. Ask them, naming it by its title, “${event.title}”: it was never public, and its web address was freed when it was deleted.`}
        </p>
      ) : (
        <p className="text-sm text-ink">
          Only the team at The Desi Events can restore a deleted event. Ask them, naming its web
          address, <code className="font-mono">{event.slug}</code>.
        </p>
      )}
    </section>
  )
}
