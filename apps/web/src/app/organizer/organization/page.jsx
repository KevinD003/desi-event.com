/**
 * An organisation's own page in the workspace: what it is called, where its
 * public page is, and where it stands with verification.
 *
 * Verification is what lets an organisation publish events and be paid, so
 * this is where an organiser asks for it, answers a moderator's question, and
 * reads every decision made so far with its reason. The request form is
 * offered only to somebody who holds `organization:submit_verification` in
 * this organisation, and only from a state the API accepts a request from;
 * the API decides again either way.
 *
 * @module app/organizer/organization/page
 */

import Link from 'next/link'

import { Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge } from '../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import {
  SUBMITTABLE_STATUSES,
  US_TIMEZONE_OPTIONS,
  verificationReading,
} from '../../../lib/organization-vocabulary.js'
import { membershipsWith, readSession, sessionCan } from '../../../lib/session.js'
import {
  formatInstant,
  getOrganizationProfile,
  getVerification,
} from '../../../lib/workspace-api.js'
import { VerificationRequestForm } from './verification-request-form.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Organisation', robots: { index: false, follow: false } }

/**
 * Read one thing, reporting a failure rather than throwing it.
 *
 * @param {Function} load What to call.
 * @returns {Promise<{value: object|null, error: object|null}>} What came back.
 */
async function attempt(load) {
  try {
    return { value: await load(), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

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
 * A time zone in the words the create form used, or its name.
 *
 * @param {string} zone An IANA zone.
 * @returns {string} The label.
 */
function zoneLabel(zone) {
  return US_TIMEZONE_OPTIONS.find((option) => option.value === zone)?.label ?? zone
}

/**
 * @typedef {object} OrganizationPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The organisation screen.
 *
 * @param {OrganizationPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizationPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()
  const organizations = membershipsWith(session, 'organization:view_members')

  if (organizations.length === 0) {
    return <Forbidden area="Organisation" backHref="/organizer" backLabel="Back to the workspace" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === query.organizationId) ??
    organizations[0]
  const organizationId = selected.organizationId

  const [profile, verification] = await Promise.all([
    attempt(() => getOrganizationProfile(organizationId)),
    attempt(() => getVerification(organizationId)),
  ])

  const state = verification.value
  const reading = state ? verificationReading(state.status) : null
  const maySubmit =
    sessionCan(session, 'organization:submit_verification', organizationId) &&
    Boolean(state) &&
    SUBMITTABLE_STATUSES.includes(state.status)
  const history = [...(state?.history ?? [])].reverse()

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Events and venues
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">
        {profile.value?.name ?? selected.organizationName ?? 'Organisation'}
      </h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Its public details, and where it stands with verification. A verified organisation may
        publish events and be paid. Until then its events can be drafted, sent for review and
        approved, but not published or sold.
      </p>

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.organizationId === organizationId

              return (
                <li key={organization.organizationId}>
                  <Link
                    href={`/organizer/organization?organizationId=${encodeURIComponent(organization.organizationId)}`}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                        : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                    }`}
                  >
                    {organization.organizationName ?? organization.organizationId}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {profile.error ? (
        <ReadRefusal
          error={profile.error}
          what="This organisation’s details"
          action="see this organisation"
          backHref="/organizer"
          backLabel="Back to the workspace"
        />
      ) : null}

      {profile.value ? (
        <section aria-labelledby="profile-heading" className="mt-8">
          <h2 id="profile-heading" className="text-xl font-semibold text-ink">
            Details
          </h2>
          <dl className={`mt-3 divide-y divide-line px-5 ${PANEL}`}>
            <Fact term="Public page">
              <Link
                href={`/organizers/${encodeURIComponent(profile.value.slug)}`}
                className={TEXT_LINK}
              >
                /organizers/{profile.value.slug}
              </Link>
            </Fact>
            <Fact term="Time zone">{zoneLabel(profile.value.timezone)}</Fact>
            <Fact term="Legal name">{profile.value.legalName ?? 'Not given'}</Fact>
            <Fact term="Website">{profile.value.websiteUrl ?? 'Not given'}</Fact>
            <Fact term="About">{profile.value.description ?? 'Not given'}</Fact>
          </dl>
        </section>
      ) : null}

      {verification.error && !profile.error ? (
        <ReadRefusal
          error={verification.error}
          what="This organisation’s verification"
          action="see its verification"
        />
      ) : null}

      {state && reading ? (
        <section aria-labelledby="verification-heading" className="mt-10">
          <h2 id="verification-heading" className="text-xl font-semibold text-ink">
            Verification
          </h2>
          <div className={`mt-3 p-5 ${PANEL}`}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant={reading.tone} size="lg" srLabel="Verification:">
                {reading.label}
              </Badge>
              <span className="text-sm text-ink-muted">
                {state.eligible
                  ? 'It may publish events and be paid.'
                  : 'It may not publish events or be paid.'}
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-muted">{reading.meaning}</p>

            {state.status === 'REQUIRES_INFORMATION' && state.note ? (
              <div className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-ink">
                <p className="font-semibold">What the moderator asked for</p>
                <p className="mt-1 whitespace-pre-line">{state.note}</p>
              </div>
            ) : null}

            {maySubmit ? (
              <VerificationRequestForm organizationId={organizationId} status={state.status} />
            ) : null}
          </div>

          <h3 className="mt-6 font-semibold text-ink">What has happened so far</h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nothing: nobody has asked for a check.</p>
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
      ) : null}
    </div>
  )
}
