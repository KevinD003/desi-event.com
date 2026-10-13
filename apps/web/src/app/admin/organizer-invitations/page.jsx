/**
 * Organiser invitations: the only way anybody comes to post events here.
 *
 * Somebody on the Desi-Event team — a platform administrator or super
 * administrator — invites an email address to start an organisation. The
 * invitation carries a code that works once, for that address, for fourteen
 * days. Accepting it creates the organisation, verified, with the invited
 * person as its owner; every event they create is still reviewed by the team
 * before it can be published.
 *
 * The page lists the shared queue (waiting first), offers the invite form, and
 * lets any member of the team withdraw an invitation or issue a new code for
 * it. The filter is a set of links, so it works without JavaScript, can be
 * bookmarked, and says which one is current through `aria-current`; the name
 * search is a GET form, which is safe because organisation names are public.
 * The list cannot be searched by email address: an address in a query string
 * is written to access logs.
 *
 * This page reads `status`, `q` and `page` from its address and nothing else.
 * A code is never read from, or put into, a web address.
 *
 * The page asks the session's own `organizer:invite` first: the
 * administration area also admits finance administrators, for booking fee
 * refunds alone (SPEC3 §12.11), and they are told this page is not for them
 * rather than shown an invite form the API would refuse. The API decides again
 * on every read and write, with a recent second factor for every code it issues.
 *
 * @module app/admin/organizer-invitations/page
 */

import Link from 'next/link'

import { ReadRefusal, RefusalNotice } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { PANEL, TABLE_FRAME, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { readSession } from '../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  formatInstant,
  getOrganizerInvitations,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'
import { OrganizerInvitationActions } from './organizer-invitation-actions.jsx'
import { InvitationAnnouncer } from './organizer-invitation-announcer.jsx'
import {
  DELIVERY_LABELS,
  DELIVERY_LINES,
  LIFETIME_DAYS,
  NOT_FOR_THIS_ACCOUNT,
  STATUS_FILTERS,
  STATUS_LABELS,
  STATUS_TONES,
  invitationDescription,
  rowActions,
  statusSentence,
} from './organizer-invitation-vocabulary.js'
import { OrganizerInviteForm } from './organizer-invite-form.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Organiser invitations', robots: { index: false, follow: false } }

/** The path of this page. */
const PATH = '/admin/organizer-invitations'

/**
 * The name search from the address bar, when it is one the API would take.
 *
 * Trimmed; dropped when shorter than two characters, longer than 120, or
 * carrying a control character, rather than sent to be refused.
 *
 * @param {unknown} value The raw `q` parameter.
 * @returns {string|undefined} The search, or nothing.
 */
export function readNameSearch(value) {
  if (typeof value !== 'string') return undefined

  const text = value.trim()

  if (text.length < 2 || text.length > 120 || /\p{Cc}/u.test(text)) return undefined

  return text
}

/**
 * @typedef {object} OrganizerInvitationsPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The screen.
 *
 * @param {OrganizerInvitationsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerInvitationsPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const filter = STATUS_FILTERS.find((each) => each.value === query.status) ?? STATUS_FILTERS[0]
  const status = filter.value
  const q = readNameSearch(query.q)
  const page = readPage(query.page)
  const session = await readSession()

  if (!sessionCan(session, 'organizer:invite')) {
    return (
      <div>
        <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
          Workspace · Platform administration
        </p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">Organiser invitations</h1>
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  const inviterName = session?.user?.displayName ?? null

  let invitations = []
  let pagination = null
  let deliveryMode = null
  let failure = null

  try {
    const result = await getOrganizerInvitations({ status, q, page })

    invitations = result.invitations
    pagination = result.pagination
    deliveryMode = result.deliveryMode
  } catch (error) {
    failure = error
  }

  // Before the list answers, the session says how codes go out: `auth.me`
  // carries the same mode.
  const mode =
    deliveryMode ??
    (session?.deliveryMode === 'EMAIL' || session?.deliveryMode === 'MANUAL'
      ? session.deliveryMode
      : null)
  const beyond = !failure && isPastTheEnd(invitations.length, pagination, page)
  const filterHref = (value) => listHref(PATH, { status: value === 'PENDING' ? null : value, q })

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Organiser invitations</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Organisers join Desi-Event only through an invitation from the Desi-Event team. Each
        invitation carries a code that works once, for the email address it names, for{' '}
        {LIFETIME_DAYS} days. Accepting it creates the organisation, verified, with that person as
        its owner. Every event they create is still reviewed by the Desi-Event team before it can be
        published.
      </p>
      {mode ? (
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{DELIVERY_LINES[mode]}</p>
      ) : null}

      <section aria-labelledby="invite-heading" className={`mt-6 p-4 sm:p-6 ${PANEL}`}>
        <h2 id="invite-heading" className="text-lg font-semibold text-ink">
          Invite an organiser
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          The name, description and website you write here are what the organisation’s public page
          shows under its Verified badge; the person you invite cannot change the name when they
          accept.
        </p>
        <OrganizerInviteForm deliveryMode={mode} inviterName={inviterName} />
      </section>

      <section aria-labelledby="list-heading" className="mt-10">
        <h2 id="list-heading" className="text-lg font-semibold text-ink">
          Invitations sent
        </h2>

        <nav aria-label="Filter by status" className="mt-4">
          <ul className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((each) => {
              const current = each.value === status

              return (
                <li key={each.value}>
                  <Link
                    href={filterHref(each.value)}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                        : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                    }`}
                  >
                    {each.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <form
          method="get"
          action={PATH}
          role="search"
          className="mt-4 flex flex-wrap items-end gap-2"
        >
          {status !== 'PENDING' ? <input type="hidden" name="status" value={status} /> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="invitation-name-search" className="text-sm font-medium text-ink">
              Organisation name
            </label>
            <input
              id="invitation-name-search"
              type="search"
              name="q"
              defaultValue={q ?? ''}
              minLength={2}
              maxLength={120}
              autoComplete="off"
              className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            />
          </div>
          <button type="submit" className={PAGER_LINK_CLASSES}>
            Search
          </button>
          {q ? (
            <Link
              href={listHref(PATH, { status: status === 'PENDING' ? null : status })}
              className={PAGER_LINK_CLASSES}
            >
              Clear the search
            </Link>
          ) : null}
        </form>

        {failure ? (
          <ReadRefusal
            error={failure}
            what="The list of organiser invitations"
            action="see the organiser invitations"
          />
        ) : null}

        {beyond ? (
          <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
            <p className="font-medium text-ink">Page {page} is past the end of this list</p>
            <p className="mt-1 text-sm text-ink-muted">
              There is nothing on this page. The list may have shrunk since the link was made.
            </p>
            <p className="mt-3">
              <Link
                href={listHref(PATH, { status: status === 'PENDING' ? null : status, q, page: 1 })}
                className={PAGER_LINK_CLASSES}
              >
                Go to the first page
              </Link>
            </p>
          </div>
        ) : null}

        {!failure && !beyond && invitations.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No invitations match."
              description="Nothing here fits this filter."
            />
          </div>
        ) : null}

        <InvitationAnnouncer>
          {invitations.length > 0 ? (
            <div className={`mt-4 ${TABLE_FRAME}`}>
              <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
                <caption className="sr-only">Organiser invitations, {filter.label}</caption>
                <thead>
                  <tr className="border-b border-line-strong text-ink-muted">
                    <th scope="col" className="pr-4 font-semibold">
                      Sent to
                    </th>
                    <th scope="col" className="pr-4 font-semibold">
                      Invitation
                    </th>
                    <th scope="col" className="pr-4 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="pr-4 font-semibold">
                      Sent by
                    </th>
                    <th scope="col" className="pr-4 font-semibold">
                      How the code went out
                    </th>
                    <th scope="col" className="font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => {
                    const offers = rowActions(invitation)

                    return (
                      <tr key={invitation.id} className="border-b border-line align-top">
                        <td className="pr-4 break-all text-ink">{invitation.email}</td>
                        <td className="pr-4 text-ink">
                          {invitation.status === 'ACCEPTED' && invitation.organization ? (
                            <>
                              New organisation:{' '}
                              <Link
                                href={`/moderation/organizations/${encodeURIComponent(invitation.organization.id)}`}
                                className={TEXT_LINK}
                              >
                                {invitation.organization.name}
                              </Link>
                            </>
                          ) : (
                            invitationDescription(invitation)
                          )}
                          {invitation.organizationWebsiteUrl ? (
                            <p className="mt-1 text-xs break-all text-ink-muted">
                              Website: {invitation.organizationWebsiteUrl}
                            </p>
                          ) : null}
                        </td>
                        <td className="pr-4">
                          <Badge
                            variant={STATUS_TONES[invitation.status] ?? 'neutral'}
                            srLabel="Status:"
                          >
                            {STATUS_LABELS[invitation.status] ?? invitation.status}
                          </Badge>
                          <p className="mt-1 text-xs text-ink-muted">
                            {statusSentence(invitation, formatInstant)}
                          </p>
                        </td>
                        <td className="pr-4 text-ink">
                          {invitation.invitedByName ?? 'Not recorded'}
                        </td>
                        <td className="pr-4 text-ink-muted">
                          {DELIVERY_LABELS[invitation.deliveryMode] ?? invitation.deliveryMode}
                        </td>
                        <td className="min-w-[16rem]">
                          {offers.withdraw || offers.reissue ? (
                            <OrganizerInvitationActions
                              invitation={invitation}
                              inviterName={inviterName}
                            />
                          ) : (
                            <span className="text-ink-muted">None</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </InvitationAnnouncer>

        {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
          <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
            {pagination.hasPreviousPage ? (
              <Link
                href={listHref(PATH, {
                  status: status === 'PENDING' ? null : status,
                  q,
                  page: page - 1,
                })}
                className={PAGER_LINK_CLASSES}
              >
                Previous page
              </Link>
            ) : null}
            {pagination.hasNextPage ? (
              <Link
                href={listHref(PATH, {
                  status: status === 'PENDING' ? null : status,
                  q,
                  page: page + 1,
                })}
                className={PAGER_LINK_CLASSES}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}
