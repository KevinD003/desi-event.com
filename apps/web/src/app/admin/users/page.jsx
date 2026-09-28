/**
 * People and roles: finding an account, changing its platform role, and
 * putting it into an organisation directly.
 *
 * The page is a shell; the search and every change happen in client
 * components that talk to the API through the same-origin proxy. Nothing here
 * decides who may do what — the area admits a super administrator and the API
 * checks again, with a recent second factor, on every change.
 *
 * @module app/admin/users/page
 */

import { UserSearch } from './user-search.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'People and roles', robots: { index: false, follow: false } }

/**
 * The screen.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function PeopleAndRolesPage() {
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
