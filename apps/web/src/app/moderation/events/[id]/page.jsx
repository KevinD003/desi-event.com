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
 * A reviewer who belongs to the event's organisation is told that somebody
 * else on the team at The Desi Events decides, in place of the decision controls: the
 * session says which organisations they are in, and the API refuses them all
 * the same.
 *
 * @file app/moderation/events/id/page.jsx
 */

import Link from 'next/link'

import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { Alert, Badge, Card, CardBody } from '../../../../components/ui.jsx'
import { ModerationDecision } from '../../../../components/moderation-decision.jsx'
import { ModerationMediaReview } from '../../../../components/moderation-media-review.jsx'
import { RichText } from '../../../../components/rich-text.jsx'
import { WebsiteRedirectPanel } from '../../../../components/website-redirect-panel.jsx'
import { accessibilityLabel, mergedAccessibility } from '../../../../lib/accessibility.js'
import { sessionCan } from '../../../../lib/capabilities.js'
import { formatEventDate, formatEventTime, formatVenueAddress } from '../../../../lib/format.js'
import { mediaReadFailure } from '../../../../lib/media.js'
import { statusReading } from '../../../../lib/event-status.js'
import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS } from '../../../../lib/event-content.js'
import { formatPrice } from '../../../../lib/pricing.js'
import {
  getEventMedia,
  getEventReadiness,
  getEventSessions,
  getEventTicketTypes,
  getModerationHistory,
  getOrganizerEvent,
} from '../../../../lib/organizer-api.js'
import {
  CONFLICT_OF_INTEREST_NOTICE,
  IMPORTED_EVENT_NO_EDITOR_NOTICE,
  belongsTo,
} from '../../../../lib/review-independence.js'
import { readSession } from '../../../../lib/session.js'

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
          {ready ? 'Ready' : 'Not ready'}
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

  const [sessions, tiers, readiness, history, media] = await Promise.all([
    getEventSessions(id).catch(() => ({ data: [] })),
    // The organiser's read, so hidden and complimentary ticket types are
    // flagged here; the event's own list is the fallback.
    getEventTicketTypes(id).catch(() => null),
    getEventReadiness(id).catch(() => ({
      ready: false,
      status: event.status,
      publishable: ['Readiness could not be read.'],
      sellable: [],
      inventory: [],
      organizerVerified: false,
    })),
    getModerationHistory(id).catch(() => []),
    // A failed read stays a failure. Drawn as an empty list it would tell the
    // moderator "This event has no pictures" right above an approval that
    // approves every picture waiting.
    getEventMedia(id).catch((error) => ({ data: null, failure: mediaReadFailure(error) })),
  ])

  const picturesUnknown = !Array.isArray(media.data)
  // A member of the organisation does not review its events; the API refuses
  // them too (`CONFLICT_OF_INTEREST`), so the controls are not offered.
  const session = await readSession()
  // An import the platform-held organisation holds has nobody to make changes
  // (SPEC2-XI O16): "request changes" is not offered, and the reason goes to
  // nobody. A door scanner there is no conflict of interest (ADR 0019).
  const noEditor = Boolean(event.importedFrom)
  const memberHere = belongsTo(session, event.organizationId ?? event.organization?.id ?? null, {
    platformHeld: noEditor,
  })

  const reading = statusReading(event.status)
  const address = formatVenueAddress(event.venue)
  const access = mergedAccessibility(event)
  const policies = event.policies ?? {}
  const ticketTypes = tiers?.data ?? event.ticketTypes ?? []
  const performers =
    event.performers?.length > 0
      ? event.performers
      : (event.artists ?? []).map((name) => ({ name, role: null, bio: null }))
  const links = SOCIAL_NETWORKS.filter((network) => event.socialLinks?.[network])

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

      {/* The Desi Events team's own page for this event: editing it once it is
          posted, deleting it, restoring it. Offered to platform editors only;
          a moderator reviews here and nowhere else. */}
      {sessionCan(session, 'event:platform_edit') ? (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href={`/admin/events/${encodeURIComponent(event.id)}`}
            className="inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {event.status === 'DELETED'
              ? 'Open its record as the team at The Desi Events'
              : 'Open in the editor as the team at The Desi Events'}
          </Link>
          {event.status !== 'DELETED' ? (
            <Link
              href={`/admin/events/${encodeURIComponent(event.id)}#delete-event`}
              className="inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Delete…
            </Link>
          ) : null}
        </p>
      ) : null}

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
                    {/* Rendered the way the public page renders it, so what is
                        approved is what is published — with every link's
                        address written out after its label, because a label
                        can say anything and point anywhere. */}
                    <dd className="text-ink-muted">
                      <RichText text={event.description} showDestinations />
                    </dd>
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
                  {performers.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Line-up</dt>
                      <dd className="text-ink-muted">
                        <ol className="list-decimal space-y-1 pl-5">
                          {performers.map((performer, index) => (
                            <li key={`${performer.name}-${index}`}>
                              {performer.name}
                              {performer.role ? ` — ${performer.role}` : ''}
                              {performer.bio ? (
                                <span className="block text-xs">{performer.bio}</span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                  ) : null}
                  {event.runningOrder?.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Running order</dt>
                      <dd className="text-ink-muted">
                        <ul className="space-y-1">
                          {event.runningOrder.map((item, index) => (
                            <li key={`${item.time}-${index}`}>
                              {item.time} {item.title}
                              {item.note ? ` (${item.note})` : ''}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {event.faq?.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Questions people ask</dt>
                      <dd className="text-ink-muted">
                        <ul className="space-y-2">
                          {event.faq.map((item, index) => (
                            <li key={`${item.question}-${index}`}>
                              <span className="font-medium text-ink">{item.question}</span>
                              <span className="block whitespace-pre-line">{item.answer}</span>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {event.dressCode ? (
                    <div>
                      <dt className="font-medium text-ink">Dress code</dt>
                      <dd className="whitespace-pre-line text-ink-muted">{event.dressCode}</dd>
                    </div>
                  ) : null}
                  {event.directions ? (
                    <div>
                      <dt className="font-medium text-ink">Parking and directions</dt>
                      <dd className="whitespace-pre-line text-ink-muted">{event.directions}</dd>
                    </div>
                  ) : null}
                  {event.publicEmail || event.publicPhone ? (
                    <div>
                      <dt className="font-medium text-ink">Public contact</dt>
                      <dd className="text-ink-muted">
                        {[event.publicEmail, event.publicPhone].filter(Boolean).join(' · ')}
                      </dd>
                    </div>
                  ) : null}
                  {/* The organiser's own site, written out. Whether the public
                      page links to it is the website panel's switch, decided
                      apart from the listing. */}
                  <div>
                    <dt className="font-medium text-ink">Website</dt>
                    <dd className="break-all text-ink-muted">{event.websiteUrl ?? 'None given'}</dd>
                  </div>
                  {/* Each link written out in full, not as a label, so the
                      moderator sees where it goes before approving it. */}
                  {links.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Links</dt>
                      <dd className="text-ink-muted">
                        <ul className="space-y-1">
                          {links.map((network) => (
                            <li key={network} className="break-all">
                              {SOCIAL_NETWORK_LABELS[network]}: {event.socialLinks[network]}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {event.sponsors?.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Sponsors</dt>
                      <dd className="text-ink-muted">
                        <ul className="space-y-1">
                          {event.sponsors.map((sponsor, index) => (
                            <li key={`${sponsor.name}-${index}`} className="break-all">
                              {sponsor.name}
                              {sponsor.level ? ` (${sponsor.level})` : ''}
                              {sponsor.url ? ` — ${sponsor.url}` : ''}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {ticketTypes.length > 0 ? (
                    <div>
                      <dt className="font-medium text-ink">Ticket types</dt>
                      <dd className="text-ink-muted">
                        <ul className="space-y-1">
                          {ticketTypes.map((tier) => (
                            <li key={tier.id} className="flex flex-wrap items-center gap-2">
                              <span>
                                {tier.name} — {formatPrice(tier.priceCents, tier.currency)}
                              </span>
                              {tier.visibility === 'HIDDEN' ? (
                                <Badge variant="neutral" srLabel="Visibility:">
                                  Hidden
                                </Badge>
                              ) : null}
                              {tier.complimentary ? (
                                <Badge variant="info" srLabel="Kind:">
                                  Complimentary
                                </Badge>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </dd>
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

          <section aria-labelledby="pictures-heading">
            <h2 id="pictures-heading" className="text-xl font-semibold text-ink">
              Pictures
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Approving this event also approves every picture still waiting for review. Take down
              any picture that should not be public first; a picture taken down stays down.
            </p>
            {picturesUnknown ? (
              <div className="mt-3">
                <Alert variant="error" title="Approval is held until the pictures can be shown">
                  <p>
                    This page cannot show this event&rsquo;s pictures, so it cannot say whether any
                    are waiting. Approving would also approve pictures you have not seen. Reload the
                    page to try again.
                  </p>
                </Alert>
                <ReadRefusal
                  error={media.failure}
                  what="This event’s pictures"
                  action="see this event’s pictures"
                />
              </div>
            ) : (
              <div className="mt-3">
                {PUBLICLY_VISIBLE_STATUSES.has(event.status) &&
                media.data.some((item) => item.moderationStatus === 'PENDING') ? (
                  <p className="mb-3 text-sm text-ink">
                    {(() => {
                      const waiting = media.data.filter(
                        (item) => item.moderationStatus === 'PENDING',
                      ).length

                      return `${waiting.toLocaleString('en-US')} ${waiting === 1 ? 'picture is' : 'pictures are'} waiting for a decision on this posted event.`
                    })()}{' '}
                    <Link
                      href="/moderation/pictures"
                      className="font-medium underline underline-offset-4 hover:text-accent-strong"
                    >
                      Pictures waiting
                    </Link>
                  </p>
                ) : null}
                <ModerationMediaReview
                  media={media.data}
                  notYours={memberHere ? CONFLICT_OF_INTEREST_NOTICE : null}
                  approvePending={PUBLICLY_VISIBLE_STATUSES.has(event.status)}
                />
              </div>
            )}
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

            {/* Drawn whatever the status, and in the same place: it says
                "Nothing to decide" itself once the event has left review. The
                decision's own refresh is what moves the event on, and swapping
                the component out here at that moment unmounted the live region
                announcing the outcome a quarter of a second after it spoke. */}
            <div className="mt-3">
              {event.status === 'REVIEW_PENDING' ? (
                <p className="mb-3 text-sm text-ink-muted">
                  Approving also approves every picture still waiting for review.
                </p>
              ) : null}
              <ModerationDecision
                event={event}
                notYours={memberHere ? CONFLICT_OF_INTEREST_NOTICE : null}
                noEditor={noEditor ? IMPORTED_EVENT_NO_EDITOR_NOTICE : null}
                approveBlockedReason={
                  picturesUnknown
                    ? `Approving is not offered while the pictures cannot be shown: it would also approve pictures you have not seen. ${noEditor ? 'Rejecting is' : 'Asking for changes and rejecting are'} still available.`
                    : null
                }
              />
            </div>

            <p className="mt-3 text-sm text-ink-muted">
              {noEditor
                ? 'Your reason is kept on the event’s record. The organisation holding this event has no members but door scanners, so it goes to nobody.'
                : 'Your reason goes to the organiser. Your name does not: they are negotiating with the platform, not with you.'}
            </p>
          </section>

          {/* Every status but deleted: the website link is switched at any
              time, apart from the review, and only administrators get the
              controls. A deleted event's switch is kept as it is for a
              restore and the API refuses a decision, so nobody gets them. */}
          <WebsiteRedirectPanel
            eventId={event.id}
            websiteUrl={event.websiteUrl ?? null}
            state={event.websiteRedirect ?? null}
            pagePublic={PUBLICLY_VISIBLE_STATUSES.has(event.status)}
            canDecide={sessionCan(session, 'website_redirect:manage')}
            deleted={event.status === 'DELETED'}
          />
        </aside>
      </div>
    </div>
  )
}
