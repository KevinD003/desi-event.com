/**
 * One event, as a moderator reads it before deciding.
 *
 * Three things on one screen, because a decision needs all three and a
 * moderator who has to open tabs to find them will stop checking one of them:
 *
 *   - **What the listing says.** The same fields a visitor would read.
 *   - **Who is behind it.** Whether the organisation is verified, which is a
 *     platform fact rather than an opinion about the listing.
 *   - **Why it is or is not ready.** The structured readiness result, every
 *     blocker rather than the first.
 *
 * Plus the history, which is the record of the negotiation so far: a second
 * moderator picking this up should not have to guess what the first one asked
 * for.
 *
 * @file app/moderation/events/id/page.jsx
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { Alert, Badge, Card, CardBody } from '../../../../components/ui.jsx'
import { ModerationDecision } from '../../../../components/moderation-decision.jsx'
import { accessibilityLabel, mergedAccessibility } from '../../../../lib/accessibility.js'
import { formatEventDate, formatEventTime, formatVenueAddress } from '../../../../lib/format.js'
import { statusReading } from '../../../../lib/event-status.js'
import {
  getEventReadiness,
  getEventSessions,
  getModerationHistory,
  getOrganizerEvent,
} from '../../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Review an event', robots: { index: false, follow: false } }

/**
 * One line of the readiness result.
 *
 * @param {object} props Component props.
 * @param {boolean} props.ready Whether this part is done.
 * @param {string} props.title What it is.
 * @param {string[]} props.blockers Everything outstanding.
 * @returns {JSX.Element} The line.
 */
function Readiness({ ready, title, blockers }) {
  return (
    <li className="rounded-card border border-line bg-surface-raised shadow-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={ready ? 'success' : 'warning'} srLabel="Status:">
          {ready ? 'Ready' : 'Not yet'}
        </Badge>
        <span className="font-medium text-ink">{title}</span>
      </div>
      {blockers.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * @typedef {object} ReviewEventPageProps
 * @property {Promise<{id: string}>} params The resolved route parameters.
 */

/**
 * The review page.
 *
 * @param {ReviewEventPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ReviewEventPage({ params }) {
  const { id } = await params

  let event = null
  let failure = null

  try {
    event = await getOrganizerEvent(id)
  } catch (error) {
    failure = error
  }

  if (!event) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-h2 font-semibold text-ink">That event could not be opened</h1>
        <ReadRefusal error={failure} what="This event" action="review this event" />
        <p className="mt-4">
          <Link
            href="/moderation/events"
            className="underline underline-offset-4 hover:text-accent-strong"
          >
            Back to the queue
          </Link>
        </p>
      </div>
    )
  }

  const [sessions, readiness, history] = await Promise.all([
    getEventSessions(id).catch(() => ({ data: [] })),
    getEventReadiness(id).catch(() => ({
      ready: false,
      status: event.status,
      publishable: ['Readiness could not be read.'],
      sellable: [],
      inventory: [],
      organizerVerified: false,
    })),
    getModerationHistory(id).catch(() => []),
  ])

  const reading = statusReading(event.status)
  const address = formatVenueAddress(event.venue)
  const access = mergedAccessibility(event)
  const policies = event.policies ?? {}

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/moderation/events"
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Review queue
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-muted">
            {event.title}
          </li>
        </ol>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-h2 font-semibold text-ink">{event.title}</h1>
        <Badge variant={reading.tone} srLabel="State:">
          {reading.label}
        </Badge>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="listing-heading">
            <h2 id="listing-heading" className="text-xl font-semibold text-ink">
              What the listing says
            </h2>

            <Card className="mt-3">
              <CardBody>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-ink">Summary</dt>
                    <dd className="text-ink-muted">{event.summary}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Description</dt>
                    <dd className="whitespace-pre-line text-ink-muted">{event.description}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">When</dt>
                    <dd className="text-ink-muted">
                      {formatEventDate(event.startsAt, event.timezone)} ·{' '}
                      {formatEventTime(event.startsAt, event.timezone)} ({event.timezone})
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Where</dt>
                    <dd className="text-ink-muted">
                      {event.isOnline ? 'Online' : address.join(', ') || 'No venue chosen'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Sessions</dt>
                    <dd className="text-ink-muted">
                      {(sessions.data ?? []).length} — {(event.ticketTypes ?? []).length} ticket
                      type
                      {(event.ticketTypes ?? []).length === 1 ? '' : 's'}
                    </dd>
                  </div>
                  {event.ageRestriction ? (
                    <div>
                      <dt className="font-medium text-ink">Age restriction</dt>
                      <dd className="text-ink-muted">{event.ageRestriction} and over</dd>
                    </div>
                  ) : null}
                  {event.artists?.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Line-up</dt>
                      <dd className="text-ink-muted">{event.artists.join(', ')}</dd>
                    </div>
                  ) : null}
                  {access.features.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Accessibility claimed</dt>
                      <dd className="text-ink-muted">
                        {access.features.map(accessibilityLabel).join(', ')}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="font-medium text-ink">Refund policy</dt>
                    <dd className="text-ink-muted">
                      {policies.refund ?? 'None given — an event cannot be published without one.'}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 text-sm">
                  <a
                    className="underline underline-offset-4 hover:text-accent-strong"
                    href={`/events/${event.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the page as a visitor would see it
                  </a>
                </p>
              </CardBody>
            </Card>
          </section>

          <section aria-labelledby="organiser-heading">
            <h2 id="organiser-heading" className="text-xl font-semibold text-ink">
              Who is behind it
            </h2>

            <Card className="mt-3">
              <CardBody>
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {event.organization?.name ?? 'Unnamed organisation'}
                  {/* A platform fact, not an opinion about the listing. An
                      unverified organisation cannot publish at all, so this is
                      the first thing worth knowing. */}
                  <Badge
                    variant={readiness.organizerVerified ? 'success' : 'warning'}
                    srLabel="Verification:"
                  >
                    {readiness.organizerVerified ? 'Verified' : 'Not verified'}
                  </Badge>
                </p>
                {event.organization?.description ? (
                  <p className="mt-2 text-sm text-ink-muted">{event.organization.description}</p>
                ) : null}
                {event.organization?.slug ? (
                  <p className="mt-2 text-sm">
                    <Link
                      href={`/organizers/${event.organization.slug}`}
                      className="underline underline-offset-4 hover:text-accent-strong"
                    >
                      Their public page
                    </Link>
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </section>

          {history.length > 0 ? (
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" className="text-xl font-semibold text-ink">
                What has happened so far
              </h2>
              <ol className="mt-3 space-y-2">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-card border border-line bg-surface-raised shadow-card p-3 text-sm"
                  >
                    <p className="font-medium text-ink">
                      {entry.fromStatus ? `${statusReading(entry.fromStatus).label} → ` : ''}
                      {statusReading(entry.toStatus).label}
                    </p>
                    <p className="text-ink-muted">
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString('en-US')}
                      </time>
                    </p>
                    {entry.reason ? <p className="mt-1 text-ink-muted">{entry.reason}</p> : null}
                    {entry.requestedChanges ? (
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
                        {Object.entries(entry.requestedChanges).map(([field, note]) => (
                          <li key={field}>
                            <span className="font-medium">{field}:</span> {note}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <section aria-labelledby="readiness-heading">
            <h2 id="readiness-heading" className="text-xl font-semibold text-ink">
              Whether it is ready
            </h2>
            <ul className="mt-3 space-y-2">
              <Readiness
                ready={readiness.organizerVerified}
                title="Organisation verified"
                blockers={
                  readiness.organizerVerified
                    ? []
                    : ['This organisation has not been verified by the platform.']
                }
              />
              <Readiness
                ready={readiness.publishable.length === 0}
                title="Listing complete"
                blockers={readiness.publishable}
              />
              <Readiness
                ready={readiness.sellable.length === 0}
                title="Something to sell"
                blockers={readiness.sellable}
              />
              <Readiness
                ready={readiness.inventory.length === 0}
                title="Inventory prepared"
                blockers={readiness.inventory}
              />
            </ul>
          </section>

          <section aria-labelledby="decision-panel-heading">
            <h2 id="decision-panel-heading" className="text-xl font-semibold text-ink">
              Your decision
            </h2>

            {event.status === 'REVIEW_PENDING' ? (
              <div className="mt-3">
                <ModerationDecision event={event} />
              </div>
            ) : (
              <Alert variant="info" title="Nothing to decide" className="mt-3">
                <p>
                  This event is {reading.label.toLowerCase()}. A decision can only be taken on
                  something waiting for review.
                </p>
              </Alert>
            )}

            <p className="mt-3 text-sm text-ink-muted">
              Your reason goes to the organiser. Your name does not: they are negotiating with the
              platform, not with you.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
