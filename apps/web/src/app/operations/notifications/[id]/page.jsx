/**
 * One outbox message, seen from the outside, and what an operator may do about it.
 *
 * ## What it shows
 *
 * Its template and channel, its status and what that means, how many attempts
 * it has had of how many, when it is due, when it was last tried, when it was
 * handed over, and the stored error — which the API has already cleared of
 * addresses, and which is drawn as text and nothing else.
 *
 * ## What it never shows
 *
 * The recipient and the contents: the API returns neither, in any form, and
 * this page adds no field for them. The worker's lease: the payload carries
 * its expiry, and this page reads it for one purpose only — deciding whether a
 * claimed message may be withdrawn, which the API allows once the lease has
 * lapsed — and passes that on as a yes or a no. The expiry itself is not drawn
 * and does not reach the browser, and no sentence on the page describes the
 * lease either: the only trace of it is whether "Withdraw it" is offered.
 *
 * ## Retry and withdraw
 *
 * Offered only in the statuses the API accepts (see `../notification-vocabulary.js`),
 * each with a reason and the step-up the API asks for. A message that moved on
 * while the page was open is refused with 409 and said as that.
 *
 * ## What a direct address gets you
 *
 * The same as the queue: this needs `reconciliation:manage`, and without it
 * the page refuses in the words every refused page uses. A message the API
 * does not find reads the same as one this account may not see.
 *
 * @module app/operations/notifications/id/page
 */

import Link from 'next/link'

import { AsOf, Breadcrumbs, Forbidden } from '../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { readSession, sessionCan } from '../../../../lib/session.js'
import {
  STATUS_TONE_CLASSES,
  formatInstant,
  getNotification,
} from '../../../../lib/workspace-api.js'
import { NotificationActions } from '../notification-actions.jsx'
import {
  CHANNELS_IN_WORDS,
  FAILURE_CATEGORIES_IN_WORDS,
  HANDED_TO,
  notificationStatusInWords,
} from '../notification-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Notification', robots: { index: false, follow: false } }

/** A card in the facts grid. */
const CARD = 'rounded-card border border-line bg-surface-raised shadow-card p-4'

/** A quiet text link. */
const LINK =
  'rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * Whether a claimed message's lease had lapsed when this page was drawn.
 *
 * Read on the server and reduced to a boolean, so the instant itself is never
 * printed and never sent to the browser. The API judges it again by its own
 * clock when the button is pressed.
 *
 * @param {object} notification The message.
 * @param {number} now The current time.
 * @returns {boolean} True when a claimed message's hold has lapsed.
 */
function leaseHasLapsed(notification, now) {
  if (notification.status !== 'CLAIMED' || !notification.leaseExpiresAt) return false

  const expires = Date.parse(notification.leaseExpiresAt)

  return Number.isFinite(expires) && expires <= now
}

/**
 * One instant, as a row of the timeline.
 *
 * @param {object} props Component props.
 * @param {string} props.label What the instant is.
 * @param {string|null} props.value The instant.
 * @param {string} props.absent What to say when there is none.
 * @returns {JSX.Element} The row.
 */
function Moment({ label, value, absent }) {
  const printed = formatInstant(value)

  return (
    <div className="flex flex-wrap gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{printed ? <time dateTime={value}>{printed}</time> : absent}</dd>
    </div>
  )
}

/**
 * @typedef {object} NotificationDetailProps
 * @property {Promise<{id: string}>} params The route parameters.
 */

/**
 * The detail screen.
 *
 * @param {NotificationDetailProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered screen.
 */
export default async function NotificationDetailPage({ params }) {
  const { id } = await params
  const session = await readSession()

  if (!sessionCan(session, 'reconciliation:manage')) {
    return (
      <Forbidden
        area="The notification queue"
        backHref="/operations"
        backLabel="Back to operations"
      />
    )
  }

  let notification = null
  let failure = null

  try {
    notification = await getNotification(id)
  } catch (error) {
    failure = error
  }

  if (!notification) {
    return (
      <div>
        <Breadcrumbs
          trail={[
            { href: '/operations', label: 'Operations' },
            { href: '/operations/notifications', label: 'Notifications' },
            { href: null, label: 'Message' },
          ]}
        />
        <h1 className="mt-3 text-h2 font-semibold text-ink">Message</h1>
        <ReadRefusal
          error={failure}
          what="This message"
          action="see this message"
          backHref="/operations/notifications"
          backLabel="Back to the notification queue"
        />
      </div>
    )
  }

  const now = Date.now()
  const words = notificationStatusInWords(notification.status)
  const lapsed = leaseHasLapsed(notification, now)

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/operations', label: 'Operations' },
          { href: '/operations/notifications', label: 'Notifications' },
          { href: null, label: notification.template },
        ]}
      />

      <h1 className="mt-3 font-mono text-h2 font-semibold break-all text-ink">
        {notification.template}
      </h1>
      <p className="mt-2 text-ink-muted">
        {CHANNELS_IN_WORDS[notification.channel] ?? notification.channel} message, template version{' '}
        {notification.templateVersion}. Neither who it is to nor what it says is shown here.
      </p>
      <AsOf asOf={new Date(now).toISOString()} />

      <section aria-labelledby="status-heading" className="mt-8">
        <h2 id="status-heading" className="text-xl font-semibold text-ink">
          Where it stands
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={CARD}>
            <dt className="text-sm text-ink-muted">Status</dt>
            <dd className="mt-1">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-sm font-semibold ${
                  STATUS_TONE_CLASSES[words.tone] ?? STATUS_TONE_CLASSES.neutral
                }`}
              >
                {words.label}
              </span>
              <span className="mt-2 block text-sm text-ink-muted">
                {notification.status === 'SENT' && !notification.sentAt
                  ? 'Marked sent, but no time of hand-over was recorded, so this page does not say it was handed over.'
                  : words.meaning}
              </span>
            </dd>
          </div>
          <div className={CARD}>
            <dt className="text-sm text-ink-muted">Attempts</dt>
            <dd className="mt-1">
              <span className="block font-semibold text-ink tabular-nums">
                {notification.attempts} of {notification.maxAttempts}
              </span>
              <span className="mt-1 block text-sm text-ink-muted">
                Putting it back in the queue counts again from zero.
              </span>
            </dd>
          </div>
          <div className={CARD}>
            <dt className="text-sm text-ink-muted">Failure</dt>
            <dd className="mt-1">
              <span className="block font-semibold text-ink">
                {notification.failureCategory
                  ? (FAILURE_CATEGORIES_IN_WORDS[notification.failureCategory] ??
                    notification.failureCategory)
                  : 'None recorded'}
              </span>
              <span className="mt-1 block text-sm text-ink-muted">
                {notification.suppressible
                  ? 'The recipient’s preferences may turn this kind of message down.'
                  : 'Sent whatever the recipient’s preferences say: it is not the kind that may be turned down.'}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="timeline-heading" className="mt-8">
        <h2 id="timeline-heading" className="text-xl font-semibold text-ink">
          When
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Moment label="Written" value={notification.createdAt} absent="Not recorded" />
          <Moment label="Scheduled for" value={notification.scheduledFor} absent="Not scheduled" />
          <Moment label="Last attempt" value={notification.lastAttemptAt} absent="Not tried" />
          <Moment
            label={`Handed to ${HANDED_TO}`}
            value={notification.sentAt}
            absent="Not handed over"
          />
        </dl>
      </section>

      <section aria-labelledby="error-heading" className="mt-8">
        <h2 id="error-heading" className="text-xl font-semibold text-ink">
          What stopped it
        </h2>
        {notification.lastError ? (
          <p className="mt-3 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 font-mono text-sm break-words whitespace-pre-wrap text-ink">
            {notification.lastError}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">No error is recorded against it.</p>
        )}
        <p className="mt-2 text-sm text-ink-muted">
          The stored error, with any address in it replaced before it left the server.
        </p>
      </section>

      <section aria-labelledby="actions-heading" className="mt-8">
        <h2 id="actions-heading" className="text-xl font-semibold text-ink">
          What you can do
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Two things, each with a reason and a recent confirmation of your second factor. Neither
          edits the message, changes who it is to or marks it sent: only the worker that watched it
          being handed over may record that.
        </p>
        <NotificationActions
          notification={{ id: notification.id, status: notification.status }}
          leaseLapsed={lapsed}
        />
      </section>

      <p className="mt-8 text-sm">
        <Link href="/operations/notifications" className={LINK}>
          Back to the notification queue
        </Link>
      </p>
    </div>
  )
}
