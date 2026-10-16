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
 * It no longer repeats the rail. Its lower half used to be a grid of link
 * cards, one per rail entry, which with the rail beside it and an area's tabs
 * above made three menus on one screen; the rail is the way around, and
 * this page is about what the account looks after.
 *
 * @module app/organizer/page
 */

import { PageHeader, Section } from '../../components/workspace-kit.jsx'
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
 * The workspace front page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerHomePage() {
  const session = await readSession()
  const memberships = session?.memberships ?? []

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Organiser workspace"
        description="What you look after, and what your role lets you do in each organisation. The menu leads to each part of it."
      />

      <Section id="workspace-organisations" title="Your organisations" className="mt-10">
        {memberships.length === 0 ? (
          <p className="mt-3 text-ink-muted">
            You are not a member of any organisation. What you can open here comes from a platform
            role.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {memberships.map((membership) => {
              const held = PLAIN_WORDS.filter(([capability]) =>
                (membership.capabilities ?? []).includes(capability),
              )

              return (
                <li key={membership.organizationId} className="py-5">
                  <p className="font-display text-title font-bold break-words text-ink">
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
    </div>
  )
}
