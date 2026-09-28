/**
 * The organisation verification queue.
 *
 * Waiting organisations oldest first — the one that has waited longest should
 * be looked at first — and every other state newest first. The server sorts;
 * this renders. The filter is a set of links, so it works with no JavaScript,
 * can be bookmarked, and says which one is current through `aria-current`.
 *
 * No contact address appears here: a queue is read on a shared screen, and a
 * decision does not need one. The API does not send it.
 *
 * @module app/moderation/organizations/page
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { verificationReading } from '../../../lib/organization-vocabulary.js'
import {
  PAGER_LINK_CLASSES,
  formatInstant,
  getVerificationQueue,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Organisation checks', robots: { index: false, follow: false } }

/**
 * The states a moderator filters by, and how each reads.
 *
 * @type {ReadonlyArray<{value: string|null, label: string}>}
 */
export const FILTERS = Object.freeze([
  { value: null, label: 'Waiting for review' },
  { value: 'REQUIRES_INFORMATION', label: 'Needs information' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REVOKED', label: 'Revoked' },
])

/** How much of an organiser's note the queue shows. */
const NOTE_EXCERPT = 180

/**
 * The start of a note, cut at a word.
 *
 * @param {string|null} note The note.
 * @returns {string|null} The excerpt.
 */
function excerpt(note) {
  if (!note) return null
  if (note.length <= NOTE_EXCERPT) return note

  return `${note.slice(0, NOTE_EXCERPT).replace(/\s+\S*$/u, '')}…`
}

/**
 * @typedef {object} VerificationQueuePageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The queue.
 *
 * @param {VerificationQueuePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function VerificationQueuePage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const status = FILTERS.some((filter) => filter.value && filter.value === query.status)
    ? query.status
    : undefined
  const page = readPage(query.page)

  let organizations = []
  let pagination = null
  let failure = null

  try {
    const result = await getVerificationQueue({ status, page })

    organizations = result.organizations
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Trust and safety
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Organisation checks</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Organisations asking to be verified, oldest request first. Verification is what lets an
        organisation publish events and be paid.
      </p>

      <nav aria-label="Filter by state" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const current = (status ?? null) === filter.value
            const href = filter.value
              ? `/moderation/organizations?status=${filter.value}`
              : '/moderation/organizations'

            return (
              <li key={filter.label}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                    current
                      ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                      : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  {filter.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The organisation queue"
          action="see the organisation queue"
        />
      ) : null}

      {!failure && organizations.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here"
            description="No organisation is in this state. Organisers ask for verification from their own organisation page."
          />
        </div>
      ) : null}

      {organizations.length > 0 ? (
        <ol className="mt-6 space-y-3">
          {organizations.map((organization) => {
            const reading = verificationReading(organization.status)
            const note = excerpt(organization.organiserNote)

            return (
              <li
                key={organization.organizationId}
                className={`p-4 transition-shadow duration-(--duration-base) ease-standard focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 hover:shadow-card-hover sm:p-5 ${PANEL}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold break-words text-ink">
                      <Link
                        href={`/moderation/organizations/${encodeURIComponent(organization.organizationId)}`}
                        className={TEXT_LINK}
                      >
                        {organization.name}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {organization.legalName ? `${organization.legalName} · ` : ''}
                      {organization.submittedAt ? (
                        <>
                          Since{' '}
                          <time dateTime={organization.submittedAt}>
                            {formatInstant(organization.submittedAt)}
                          </time>
                        </>
                      ) : (
                        'No date recorded'
                      )}
                      {` · ${organization.memberCount} member${organization.memberCount === 1 ? '' : 's'}`}
                      {` · ${organization.eventCount} event${organization.eventCount === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <Badge variant={reading.tone} size="lg" srLabel="State:">
                    {reading.label}
                  </Badge>
                </div>
                {note ? (
                  <p className="mt-3 text-sm break-words text-ink">
                    <span className="font-medium">Their note: </span>
                    {note}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}

      {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
          {pagination.hasPreviousPage ? (
            <Link
              href={listHref('/moderation/organizations', { status, page: page - 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Previous page
            </Link>
          ) : null}
          {pagination.hasNextPage ? (
            <Link
              href={listHref('/moderation/organizations', { status, page: page + 1 })}
              className={PAGER_LINK_CLASSES}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
