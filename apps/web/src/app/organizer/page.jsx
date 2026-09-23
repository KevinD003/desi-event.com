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

/** Classes for a destination card. */
const CARD =
  'block h-full rounded-card border border-line bg-surface-raised p-4 transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

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
      <h1 className="text-3xl font-bold text-ink">Organiser workspace</h1>
      <p className="mt-2 max-w-prose text-ink-muted">
        What you look after, and where each part of it is done.
      </p>

      <section aria-labelledby="workspace-organisations" className="mt-8">
        <h2 id="workspace-organisations" className="text-lg font-semibold text-ink">
          Your organisations
        </h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-ink-muted">
            You are not a member of any organisation. What you can open here comes from a platform
            role.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {memberships.map((membership) => {
              const held = PLAIN_WORDS.filter(([capability]) =>
                (membership.capabilities ?? []).includes(capability),
              )

              return (
                <li
                  key={membership.organizationId}
                  className="rounded-card border border-line bg-surface-raised p-4"
                >
                  <p className="font-semibold break-words text-ink">
                    {membership.organizationName ?? 'An organisation'}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    Your role: <span className="font-medium text-ink">{membership.role}</span>
                  </p>
                  {held.length > 0 ? (
                    <ul
                      className="mt-3 flex flex-wrap gap-1.5"
                      aria-label="What this role lets you do"
                    >
                      {held.map(([capability, words]) => (
                        <li
                          key={capability}
                          className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-muted"
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
      </section>

      {groups.map((group) =>
        group.items.length > 0 ? (
          <section key={group.id} aria-labelledby={`workspace-${group.id}`} className="mt-10">
            <h2 id={`workspace-${group.id}`} className="text-lg font-semibold text-ink">
              {group.label}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={CARD}>
                    <span className="font-semibold text-ink">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  )
}
