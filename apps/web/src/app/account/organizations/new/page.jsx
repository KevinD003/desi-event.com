/**
 * Creating an organisation of your own.
 *
 * In the account area, which admits any signed-in session: nobody needs a role
 * to start an organisation, and the organiser workspace would refuse somebody
 * who is not yet in one. What a new organisation cannot do is said before the
 * form, not after it — it starts unverified, and cannot publish or be paid
 * until a moderator verifies it.
 *
 * @file app/account/organizations/new/page.jsx
 */

import Link from 'next/link'

import { CreateOrganizationForm } from './create-organization-form.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Create an organisation', robots: { index: false, follow: false } }

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The create screen.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function CreateOrganizationPage() {
  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Your account
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Create an organisation</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        An organisation is who puts events on here. You become its owner, and can invite the rest of
        your team once it exists.
      </p>

      <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-sm text-ink-muted">
        <li>
          It starts unverified. You can draft events straight away, but it cannot publish them or be
          paid until a moderator has verified it — you ask for that from its organisation page.
        </li>
        <li>
          Payments on this site are simulated: no real card is charged and nobody is paid out.{' '}
          <Link href="/limitations" className={LINK}>
            What this site does not do
          </Link>
        </li>
        <li>
          Your account’s email address is recorded as its contact address for the platform. It is
          not shown publicly.
        </li>
        <li>
          Owners must use two-step sign-in. If you have not set it up, you will be asked to before
          the workspace opens.
        </li>
      </ul>

      <CreateOrganizationForm />
    </div>
  )
}
