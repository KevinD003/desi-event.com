/**
 * One organisation, as a moderator reads it before deciding.
 *
 * Everything the decision is made from on one screen: the profile the
 * organisation gives the public, how many members and events it has, where it
 * stands, and every decision so far with the reason recorded at the time. The
 * decision itself is `components/verification-decision.jsx`; the API holds the
 * transition table and asks for a recent second factor.
 *
 * A reviewer who belongs to this organisation is told that somebody else on
 * the Desi-Event team decides, in place of the decision: the session says
 * which organisations they are in, and the API refuses them all the same.
 *
 * @file app/moderation/organizations/id/page.jsx
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { Badge } from '../../../../components/ui.jsx'
import { VerificationDecision } from '../../../../components/verification-decision.jsx'
import { PANEL, TEXT_LINK } from '../../../../components/workspace-kit.jsx'
import { verificationReading } from '../../../../lib/organization-vocabulary.js'
import { CONFLICT_OF_INTEREST_NOTICE, belongsTo } from '../../../../lib/review-independence.js'
import { readSession } from '../../../../lib/session.js'
import { formatInstant, getVerificationReview } from '../../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Check an organisation', robots: { index: false, follow: false } }

/**
 * One fact, as a term and its description.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children What it says.
 * @returns {JSX.Element} The pair.
 */
function Fact({ term, children }) {
  return (
    <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-ink-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words text-ink sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  )
}

/**
 * @typedef {object} ReviewOrganizationPageProps
 * @property {Promise<{id: string}>} params The resolved route parameters.
 */

/**
 * The review page.
 *
 * @param {ReviewOrganizationPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ReviewOrganizationPage({ params }) {
  const { id } = await params

  let review = null
  let failure = null

  try {
    review = await getVerificationReview(id)
  } catch (error) {
    failure = error
  }

  if (failure) {
    return (
      <div>
        <p>
          <Link href="/moderation/organizations" className={TEXT_LINK}>
            Back to organisation checks
          </Link>
        </p>
        <ReadRefusal
          error={failure}
          what="This organisation"
          action="check this organisation"
          backHref="/moderation/organizations"
          backLabel="Back to organisation checks"
        />
      </div>
    )
  }

  const { organization, verification, memberCount, eventCount } = review
  // A member of the organisation does not decide on it; the API refuses them
  // too (`CONFLICT_OF_INTEREST`), so no decision is offered.
  const session = await readSession()
  const memberHere = belongsTo(session, organization.id)
  const reading = verificationReading(verification.status)
  const history = [...(verification.history ?? [])].reverse()

  return (
    <div>
      <p>
        <Link href="/moderation/organizations" className={TEXT_LINK}>
          Back to organisation checks
        </Link>
      </p>
      <p className="mt-4 text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Trust and safety
      </p>
      <h1 className="mt-2 text-h2 font-semibold break-words text-ink">{organization.name}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={reading.tone} size="lg" srLabel="State:">
          {reading.label}
        </Badge>
        <span className="text-sm text-ink-muted">
          {verification.eligible
            ? 'It may publish events and be paid.'
            : 'It may not publish events or be paid.'}
        </span>
      </p>

      <section aria-labelledby="profile-heading" className="mt-8">
        <h2 id="profile-heading" className="text-xl font-semibold text-ink">
          What it tells the public
        </h2>
        <dl className={`mt-3 divide-y divide-line px-5 ${PANEL}`}>
          <Fact term="Public page">/organizers/{organization.slug}</Fact>
          <Fact term="Legal name">{organization.legalName ?? 'Not given'}</Fact>
          <Fact term="Website">{organization.websiteUrl ?? 'Not given'}</Fact>
          <Fact term="About">{organization.description ?? 'Not given'}</Fact>
          <Fact term="Time zone">{organization.timezone}</Fact>
          <Fact term="Created">
            <time dateTime={organization.createdAt}>{formatInstant(organization.createdAt)}</time>
          </Fact>
          <Fact term="Members">{memberCount}</Fact>
          <Fact term="Events">{eventCount}</Fact>
        </dl>
      </section>

      {verification.status === 'REQUIRES_INFORMATION' && verification.note ? (
        <section aria-labelledby="asked-heading" className="mt-8">
          <h2 id="asked-heading" className="text-xl font-semibold text-ink">
            What was asked for
          </h2>
          <p className={`mt-3 p-4 text-sm whitespace-pre-line text-ink ${PANEL}`}>
            {verification.note}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-xl font-semibold text-ink">
          What has happened so far
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing recorded.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {history.map((event) => (
              <li key={event.id} className={`p-4 text-sm ${PANEL}`}>
                <p className="font-medium text-ink">
                  {event.fromStatus ? `${verificationReading(event.fromStatus).label} → ` : ''}
                  {verificationReading(event.toStatus).label}
                </p>
                <p className="mt-1 text-ink-muted">
                  <time dateTime={event.createdAt}>{formatInstant(event.createdAt) ?? '—'}</time>
                </p>
                {event.reason ? (
                  <p className="mt-1 whitespace-pre-line text-ink">{event.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="decision-heading" className="mt-10">
        <h2 id="decision-heading" className="text-xl font-semibold text-ink">
          Decide
        </h2>
        <VerificationDecision
          organizationId={organization.id}
          organizationName={organization.name}
          status={verification.status}
          notYours={memberHere ? CONFLICT_OF_INTEREST_NOTICE : null}
        />
      </section>
    </div>
  )
}
