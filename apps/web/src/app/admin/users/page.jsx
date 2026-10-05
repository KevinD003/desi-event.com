/**
 * People and roles: finding an account, changing its platform role, and
 * putting it into an organisation directly.
 *
 * The page is a shell; the search and every change happen in client
 * components that talk to the API through the same-origin proxy. Nothing here
 * decides who may do what — the API checks again, with a recent second factor,
 * on every change.
 *
 * The area admits platform administrators as well as super administrators,
 * because it is where organisers are invited. This page is the super
 * administrators' alone (`platform:admin`), so it asks again and tells a
 * platform administrator who opens it, in words, that it is not theirs —
 * rather than drawing a search whose every answer would be a refusal.
 *
 * @module app/admin/users/page
 */

import Link from 'next/link'

import { SECONDARY_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { readSession } from '../../../lib/session.js'
import { UserSearch } from './user-search.jsx'

/** What a platform administrator who opens this page is told. */
export const SUPER_ADMINISTRATORS_ONLY =
  'Changing platform roles and putting people into organisations directly are held by platform super administrators alone. Your role, platform administrator, does not include them, and nothing on this page can grant them.'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'People and roles', robots: { index: false, follow: false } }

/**
 * The screen.
 *
 * @returns {Promise<JSX.Element>} The rendered page, or the refusal.
 */
export default async function PeopleAndRolesPage() {
  const session = await readSession()

  if (!sessionCan(session, 'platform:admin')) {
    return (
      <div>
        <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
          Workspace · Platform administration
        </p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">Not for you</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">{SUPER_ADMINISTRATORS_ONLY}</p>
        <p className="mt-6">
          <Link href="/admin/organizer-invitations" className={SECONDARY_LINK}>
            Back to organiser invitations
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Trust and safety
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">People and roles</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Find an account by its email address, name or id. You can change its platform role, or put
        it into an organisation with a role — including owner, for an organisation whose only owner
        has left. Every change needs a reason and a recent confirmation of your second factor, and
        ends every session the account holds.
      </p>

      <UserSearch />
    </div>
  )
}
