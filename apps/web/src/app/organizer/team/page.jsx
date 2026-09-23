/**
 * Team and roles: who is in an organisation, in which role, admitting to which doors.
 *
 * ## Addresses are the server's decision, drawn exactly as it made it
 *
 * `GET /v1/organizations/:id/members` answers in one of three shapes, told
 * apart by `emailVisibility`, and this page draws each one as it is:
 *
 *   - `FULL` — an owner or administrator of *this* organisation who confirmed a
 *     second factor recently. Each address the payload carries is shown.
 *   - `STEP_UP_REQUIRED` — the same person without the recent confirmation. No
 *     address, and the step-up is offered in place; once it succeeds the page
 *     redraws and the server decides again.
 *   - `HIDDEN` — everybody else who may read the list. No address, no stand-in
 *     and no hint that one could be revealed.
 *
 * The email column exists only under `FULL`, and it reads `email` only then.
 * An `email` field that arrived under either other shape — a presenter bug, a
 * proxy that cached the wrong answer — is never read, and a name is passed
 * through the same address scrubber the API uses before it is drawn. Nothing
 * is derived from a name.
 *
 * ## No invite form
 *
 * The API issues invitations but has nothing to deliver them with: there is no
 * email provider in this build, and `apps/api/src/routes/teams.js` logs "no
 * delivery provider is configured" and moves on. A form here would create an
 * invitation nobody receives. So the page says so, and lists the invitations
 * that exist so they can be withdrawn.
 *
 * ## Door scopes, in the API's terms
 *
 * Owners and administrators admit to every event of the organisation; managers,
 * staff and door scanners admit only to the events their scope names, and no
 * scope admits nobody; every other role does not work a door. See
 * `./team-vocabulary.js` for where that comes from.
 *
 * @module app/organizer/team/page
 */

import Link from 'next/link'
import { withoutAddresses } from '@desi-event/schemas'

import { ScrollableTable } from '../../../components/money-figure.jsx'
import { AsOf, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { StepUpForRead } from '../../../components/step-up-for-read.jsx'
import { formatEventDate } from '../../../lib/format.js'
import { membershipsWith, readSession, sessionCan } from '../../../lib/session.js'
import { formatInstant, getTeam, listOrganizationEvents } from '../../../lib/workspace-api.js'
import { InvitationActions, MemberActions } from './member-actions.jsx'
import { TeamAnnouncer } from './team-announcer.jsx'
import { isEventScoped, isOrganizationWide, roleLabel } from './team-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Team and roles', robots: { index: false, follow: false } }

/** A header cell. */
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-3 align-top text-ink'

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
 * A name as this page may draw it.
 *
 * Under `FULL` the name is the member's name. Under either other visibility,
 * anything address-shaped in it is replaced, the way the API replaces it —
 * so a name that somehow still carried one cannot put back what the list
 * withholds.
 *
 * @param {string|null|undefined} name The name from the payload.
 * @param {boolean} full Whether this list may show addresses.
 * @returns {string} The name to draw.
 */
function safeName(name, full) {
  const text = typeof name === 'string' && name.trim() ? name : 'Unnamed member'

  return full ? text : withoutAddresses(text)
}

/**
 * What a member's door authority is, in words.
 *
 * @param {object} props Component props.
 * @param {string} props.role The member's role.
 * @param {string[]} props.scopedEventIds The events their scope names.
 * @param {Map<string, string>|null} props.titles Event titles by id, or null when unread.
 * @returns {JSX.Element} The description.
 */
function DoorScope({ role, scopedEventIds, titles }) {
  if (isOrganizationWide(role)) {
    return <span>Any event of this organisation</span>
  }

  if (!isEventScoped(role)) {
    return <span className="text-ink-muted">Does not work a door</span>
  }

  if (scopedEventIds.length === 0) {
    return <span className="text-status-warning">Admits nobody: no event named</span>
  }

  if (!titles) {
    return (
      <span>
        Admits to {scopedEventIds.length} named event{scopedEventIds.length === 1 ? '' : 's'}
      </span>
    )
  }

  const named = scopedEventIds.map((id) => titles.get(id)).filter(Boolean)
  const unnamed = scopedEventIds.length - named.length

  return (
    <span>
      Admits to: {named.join(', ')}
      {named.length > 0 && unnamed > 0 ? ', and ' : ''}
      {unnamed > 0
        ? `${unnamed} ${named.length > 0 ? 'other ' : ''}event${unnamed === 1 ? '' : 's'} this page could not name`
        : ''}
    </span>
  )
}

/**
 * What the page says about addresses, per visibility.
 *
 * @param {object} props Component props.
 * @param {string} props.visibility The server's `emailVisibility`.
 * @returns {JSX.Element} The note, or the step-up.
 */
function AddressNotice({ visibility }) {
  if (visibility === 'FULL') {
    return (
      <p className="mt-4 text-sm text-ink-muted">
        Addresses are shown because you manage this team and confirmed your second factor recently.
        Nobody else who can read this list sees them.
      </p>
    )
  }

  if (visibility === 'STEP_UP_REQUIRED') {
    return (
      <>
        <p className="mt-4 text-sm text-ink-muted">
          No addresses are shown. You manage this team, and addresses are shown to you only after a
          recent confirmation of your second factor.
        </p>
        <StepUpForRead action="see team members’ email addresses" />
      </>
    )
  }

  return (
    <p className="mt-4 text-sm text-ink-muted">
      Email addresses are shown only to owners and administrators who have confirmed a second factor
      recently.
    </p>
  )
}

/**
 * @typedef {object} TeamPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The team screen.
 *
 * @param {TeamPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function TeamPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()
  const organizations = membershipsWith(session, 'organization:view_members')

  if (organizations.length === 0) {
    return <Forbidden area="Team" backHref="/organizer" backLabel="Back to the workspace" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === query.organizationId) ??
    organizations[0]
  const organizationId = selected.organizationId

  const [team, eventList] = await Promise.all([
    attempt(() => getTeam(organizationId)),
    attempt(() => listOrganizationEvents(organizationId)),
  ])

  // Asked in this organisation, never unscoped: holding a capability in one
  // organisation is not holding it in another. The API asks again.
  const mayChangeRoles = sessionCan(session, 'team:role_manage', organizationId)
  const mayRemove = sessionCan(session, 'team:remove', organizationId)
  const mayWithdraw = sessionCan(session, 'team:invite', organizationId)
  const callerRole = selected.role

  const data = team.value
  const full = data?.emailVisibility === 'FULL'
  const assignable = (data?.assignableRoles ?? []).filter((role) => role !== 'OWNER')

  /**
   * Whether the caller's role reaches a member's, as the API's
   * `assertMayActOn` decides it: they may grant that role, or both are owners.
   *
   * @param {string} role The member's current role.
   * @returns {boolean} True when the API would let them act.
   */
  const reaches = (role) =>
    assignable.includes(role) || (role === 'OWNER' && callerRole === 'OWNER')

  const events = eventList.value
    ? eventList.value.events.map((event) => ({
        id: event.id,
        title: event.title,
        when: formatEventDate(event.startsAt, event.timezone ?? 'Asia/Kolkata'),
      }))
    : null
  const titles = events ? new Map(events.map((event) => [event.id, event.title])) : null
  // Set only when the picker's one page could not hold every event, so the
  // picker can say how many it leaves out.
  const eventPagination = eventList.value?.pagination ?? null
  const eventTotal =
    eventPagination?.hasNextPage && Number.isInteger(eventPagination.total)
      ? eventPagination.total
      : null
  const actionsColumn = mayChangeRoles || mayRemove
  const now = Date.now()

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Team and roles</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Who is in {selected.organizationName ?? 'this organisation'}, in which role, and which doors
        they may admit people through. What you can change is decided by your own role here, and the
        server checks it again whatever this page offers.
      </p>

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.organizationId === organizationId

              return (
                <li key={organization.organizationId}>
                  <Link
                    href={`/organizer/team?organizationId=${encodeURIComponent(organization.organizationId)}`}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink'
                        : 'bg-surface-subtle text-ink-muted hover:bg-line'
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

      {team.error ? (
        <ReadRefusal
          error={team.error}
          what="This organisation’s team"
          action="see this team"
          backHref="/organizer"
          backLabel="Back to the workspace"
        />
      ) : null}

      {data ? (
        <TeamAnnouncer>
          <AddressNotice visibility={data.emailVisibility} />
          <AsOf asOf={new Date(now).toISOString()} />

          <section aria-labelledby="members-heading" className="mt-8">
            <h2 id="members-heading" className="text-lg font-semibold text-ink">
              Members <span className="font-normal text-ink-muted">({data.members.length})</span>
            </h2>

            {eventList.error ? (
              <p className="mt-2 text-sm text-ink-muted">
                This organisation’s events could not be read, so door scopes are shown as a count
                and cannot be changed from here just now.
              </p>
            ) : null}

            {data.members.length === 0 ? (
              <Empty
                title="No members"
                description="This organisation has no members this account can see."
              />
            ) : (
              <ScrollableTable label="Members">
                <table className="w-full min-w-[48rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Members of {selected.organizationName ?? 'this organisation'}, with their roles
                    and door scopes
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Name
                      </th>
                      {full ? (
                        <th scope="col" className={TH}>
                          Email
                        </th>
                      ) : null}
                      <th scope="col" className={TH}>
                        Role
                      </th>
                      <th scope="col" className={TH}>
                        Joined
                      </th>
                      <th scope="col" className={TH}>
                        Door scope
                      </th>
                      {actionsColumn ? (
                        <th scope="col" className={TH}>
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((member) => {
                      const name = safeName(member.displayName, full)
                      const offerRoleChange = mayChangeRoles && !member.self && reaches(member.role)
                      const offerRemove = mayRemove && !member.self && reaches(member.role)

                      return (
                        <tr key={member.id}>
                          <th scope="row" className={`${TD} font-medium`}>
                            {name}
                            {member.self ? <span className="text-ink-muted"> (you)</span> : null}
                          </th>
                          {full ? (
                            <td className={`${TD} break-all`}>{member.email ?? '—'}</td>
                          ) : null}
                          <td className={TD}>{roleLabel(member.role)}</td>
                          <td className={`${TD} text-ink-muted`}>
                            <time dateTime={member.joinedAt}>
                              {formatInstant(member.joinedAt) ?? '—'}
                            </time>
                          </td>
                          <td className={TD}>
                            <DoorScope
                              role={member.role}
                              scopedEventIds={member.scopedEventIds ?? []}
                              titles={titles}
                            />
                          </td>
                          {actionsColumn ? (
                            <td className={TD}>
                              {member.self ? (
                                <span className="text-ink-muted">
                                  Your own role and membership are changed by somebody else here.
                                </span>
                              ) : offerRoleChange || offerRemove ? (
                                <MemberActions
                                  organizationId={organizationId}
                                  member={{
                                    id: member.id,
                                    name,
                                    role: member.role,
                                    scopedEventIds: member.scopedEventIds ?? [],
                                  }}
                                  assignableRoles={assignable}
                                  events={events}
                                  eventTotal={eventTotal}
                                  offerRoleChange={offerRoleChange}
                                  offerRemove={offerRemove}
                                />
                              ) : (
                                <span className="text-ink-muted">
                                  Your role here cannot change this member’s.
                                </span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </section>

          <section aria-labelledby="invitations-heading" className="mt-10">
            <h2 id="invitations-heading" className="text-lg font-semibold text-ink">
              Invitations still open{' '}
              <span className="font-normal text-ink-muted">({data.invitations.length})</span>
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              Inviting someone new needs email delivery, which this build does not have. Existing
              invitations are listed so they can be withdrawn.
            </p>

            {data.invitations.length === 0 ? (
              <Empty title="No open invitations" description="Nothing is waiting to be accepted." />
            ) : (
              <ScrollableTable label="Open invitations">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <caption className="sr-only">Invitations waiting to be accepted</caption>
                  <thead>
                    <tr>
                      {full ? (
                        <th scope="col" className={TH}>
                          Email
                        </th>
                      ) : null}
                      <th scope="col" className={TH}>
                        Role
                      </th>
                      <th scope="col" className={TH}>
                        Invited by
                      </th>
                      <th scope="col" className={TH}>
                        Issued
                      </th>
                      <th scope="col" className={TH}>
                        Expires
                      </th>
                      {mayWithdraw ? (
                        <th scope="col" className={TH}>
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.invitations.map((invitation) => {
                      const expired = Date.parse(invitation.expiresAt) <= now

                      return (
                        <tr key={invitation.id}>
                          {full ? (
                            <td className={`${TD} break-all`}>{invitation.email ?? '—'}</td>
                          ) : null}
                          <td className={TD}>{roleLabel(invitation.role)}</td>
                          <td className={TD}>
                            {invitation.invitedByName
                              ? safeName(invitation.invitedByName, full)
                              : 'Not recorded'}
                          </td>
                          <td className={`${TD} text-ink-muted`}>
                            <time dateTime={invitation.createdAt}>
                              {formatInstant(invitation.createdAt) ?? '—'}
                            </time>
                          </td>
                          <td className={TD}>
                            <time dateTime={invitation.expiresAt}>
                              {formatInstant(invitation.expiresAt) ?? '—'}
                            </time>
                            {expired ? (
                              <span className="block text-status-warning">
                                Expired: it can no longer be accepted.
                              </span>
                            ) : null}
                          </td>
                          {mayWithdraw ? (
                            <td className={TD}>
                              <InvitationActions
                                organizationId={organizationId}
                                invitation={{ id: invitation.id, role: invitation.role }}
                              />
                            </td>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </section>
        </TeamAnnouncer>
      ) : null}
    </div>
  )
}
