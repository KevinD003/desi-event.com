/**
 * Accepting an organiser invitation.
 *
 * Organisations are not made from an account here. Organisers join Desi-Event
 * by invitation from the Desi-Event team, and this is where the invitation's
 * code is typed. The API answers every other way of creating an organisation
 * with a refusal.
 *
 * In the account area, which admits any signed-in session: the person
 * accepting is not yet in any organisation, and the organiser workspace would
 * refuse them. What accepting does, and what the organisation still cannot do,
 * is said before the form, not after it.
 *
 * ## Why there is a form here rather than a link
 *
 * An invitation code is a bearer secret bound to an address. A link carrying
 * it would put it in the browser's history, in the `Referer` header of
 * whatever page loaded next and in every proxy's access log on the way. So the
 * code is typed. This page reads no query parameter, so a code put in its
 * address is never read or pre-filled.
 *
 * @file app/account/organizations/new/page.jsx
 */

import Link from 'next/link'

import { OrganizerInvitationAcceptForm } from './organizer-invitation-accept-form.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Accept an organiser invitation',
  robots: { index: false, follow: false },
}

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The join screen.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function AcceptOrganizerInvitationPage() {
  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Your account
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Accept an organiser invitation</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Organisers join Desi-Event by invitation from the Desi-Event team. If the team has sent you
        an organiser invitation code, type it here while signed in with the email address it was
        sent to. The code is typed, not followed from a link, so it never sits in your browser
        history.
      </p>

      <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-sm text-ink-muted">
        <li>
          Accepting it starts the organisation your invitation names, and you become its owner. It
          is verified from the start, because the Desi-Event team invited you.
        </li>
        <li>
          Every event you create is reviewed by the Desi-Event team before it can be published.
        </li>
        <li>
          Payments on this site are simulated: no real card is charged and nobody is paid out.{' '}
          <Link href="/limitations" className={LINK}>
            What this site does not do
          </Link>
        </li>
        <li>
          Your account’s email address is recorded as the organisation’s contact address for the
          platform. It is not shown publicly.
        </li>
        <li>
          Owners must use two-step sign-in. If you have not set it up, you will be asked to before
          the workspace opens.
        </li>
      </ul>

      <p className="mt-4 max-w-2xl text-sm text-ink-muted">
        Invited to somebody’s team instead? Enter that code at{' '}
        <Link href="/account/invitations" className={LINK}>
          Join an organisation’s team
        </Link>
        .
      </p>

      <OrganizerInvitationAcceptForm />
    </div>
  )
}
