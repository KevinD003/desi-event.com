/**
 * The organiser workspace's front page.
 *
 * The workspace had no front page: its first screen was the event list, and
 * somebody whose job was the door, the team or the money started on a list of
 * events they could not edit. This says, per organisation, what this account
 * holds there and where each of those things is done.
 *
 * Built from the session alone — the memberships `GET /v1/auth/me` returned —
 * so it makes no request of its own and shows nothing the session did not
 * already carry. It describes what the account may be offered; the API still
 * decides every action.
 *
 * @module app/organizer/page
 */

import Link from 'next/link'

import { LINK_PANEL, PageHeader, PANEL, Section } from '../../components/workspace-kit.jsx'
import { workspaceGroups } from '../../lib/navigation.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Organiser workspace', robots: { index: false, follow: false } }

/**
 * What a capability lets somebody do, in words, for the ones worth saying.
 *
 * Capabilities not listed are held but not described: this is a summary for a
 * person, not an audit of their grants.
 *
 * @type {ReadonlyArray<Array<string>>}
 */
const PLAIN_WORDS = Object.freeze([
  ['event:create', 'Create and edit events'],
  ['venue:manage', 'Manage venues and seating maps'],
  ['ticket:check_in', 'Admit people at the door'],
  ['report:view', 'See how events are selling'],
  ['finance:view', 'See the money'],
  ['order:refund_approve', 'Approve refunds'],
  ['team:invite', 'Invite people to the team'],
  ['team:role_manage', 'Change who can do what'],
  ['privacy:redact', 'Handle erasure requests'],
])

/**
 * What each destination is for, in a line, for the ones on this page.
 *
 * Words about the place, not promises about what is in it: a destination
 * card says what somebody goes there to do, and the page they land on says
 * what there is. A destination not listed here is drawn with its name alone.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PURPOSE = Object.freeze({
  '/organizer/events': 'Drafts, reviews, publishing and sales, one event at a time.',
  '/organizer/venues': 'Addresses, access and seating maps.',
  '/organizer/check-in': 'Admit people at the door from a phone.',
  '/organizer/team': 'Who is in the organisation, and in which role.',
  '/analytics': 'What sold, what is held and who came in.',
  '/finance': 'Figures from the ledger, refunds and payout setup.',
  '/operations': 'What the system could not finish on its own.',
  '/operations/notifications': 'Messages that have not gone yet.',
  '/moderation/events': 'Events waiting for a moderator’s decision.',
  '/privacy': 'Access and erasure requests, exports and holds.',
  '/retention': 'What the retention rules would remove, rehearsed.',
})

/**
 * The workspace front page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerHomePage() {
  const session = await readSession()
  const memberships = session?.memberships ?? []
  const groups = workspaceGroups(session).map((group) => ({
    ...group,
    items: group.items.filter((item) => item.href !== '/organizer'),
  }))

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Organiser workspace"
        description="What you look after, and where each part of it is done."
      />

      <Section id="workspace-organisations" title="Your organisations" className="mt-10">
        {memberships.length === 0 ? (
          <p className="mt-3 text-ink-muted">
            You are not a member of any organisation. What you can open here comes from a platform
            role.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {memberships.map((membership) => {
              const held = PLAIN_WORDS.filter(([capability]) =>
                (membership.capabilities ?? []).includes(capability),
              )

              return (
                <li key={membership.organizationId} className={`p-5 ${PANEL}`}>
                  <p className="font-display text-lg font-semibold break-words text-ink">
                    {membership.organizationName ?? 'An organisation'}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Your role: <span className="font-semibold text-ink">{membership.role}</span>
                  </p>
                  {held.length > 0 ? (
                    <ul
                      className="mt-4 flex flex-wrap gap-2"
                      aria-label="What this role lets you do"
                    >
                      {held.map(([capability, words]) => (
                        <li
                          key={capability}
                          className="rounded-full border border-accent-line bg-accent-soft px-3 py-1 text-xs font-medium text-ink"
                        >
                          {words}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {groups.map((group) =>
        group.items.length > 0 ? (
          <Section key={group.id} id={`workspace-${group.id}`} title={group.label}>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={`group ${LINK_PANEL}`}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-display text-lg font-semibold text-ink">
                        {item.label}
                      </span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="size-5 shrink-0 text-accent-strong transition-transform duration-(--duration-fast) ease-standard motion-safe:group-hover:translate-x-0.5"
                      >
                        <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z" />
                      </svg>
                    </span>
                    {PURPOSE[item.href] ? (
                      <span className="mt-1 block text-sm text-ink-muted">
                        {PURPOSE[item.href]}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null,
      )}
    </div>
  )
}
