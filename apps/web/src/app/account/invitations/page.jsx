/**
 * Joining an organisation with an invitation code.
 *
 * ## Why there is a form here rather than a link
 *
 * An invitation code is a bearer secret bound to an address. A link carrying
 * it would put it in the browser's history, in the `Referer` header of
 * whatever page loaded next, in every proxy's access log on the way, and in
 * any screenshot of the address bar — and it would still be there after the
 * invitation had been used. So the code is handed over by whoever invited you,
 * out of band, and typed into a field here. This page reads no query
 * parameter, so a code put in its address is never read or pre-filled.
 *
 * The server holds only the code's digest. It has never held the code.
 *
 * ## How the code arrived
 *
 * Said from the delivery mode `GET /v1/auth/me` reports, so the sentence is
 * true in the deployment it is read in: handed over by whoever invited you
 * when codes are not emailed, or emailed to the invited address when they are.
 *
 * This page is for team codes. An organiser invitation from the team at The
 * Desi Events has its own page, and the page says so.
 *
 * @module app/account/invitations/page
 */

import Link from 'next/link'

import { readSession } from '../../../lib/session.js'
import { InvitationAcceptForm } from './invitation-accept-form.jsx'

/** A link that reads as a link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * How a team code reaches the person typing it, per delivery mode.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOW_THE_CODE_ARRIVES = Object.freeze({
  MANUAL:
    'Codes are not emailed from this site, so the code does not arrive on its own: whoever invited you hands it to you themselves.',
  EMAIL:
    'The code is emailed to the address the invitation was sent to. If it has not arrived, ask whoever invited you to issue a new one.',
})

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Join an organisation', robots: { index: false, follow: false } }

/**
 * The join screen.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function JoinOrganisationPage() {
  const session = await readSession()
  const arrives = HOW_THE_CODE_ARRIVES[session?.deliveryMode] ?? null

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Your account
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Join an organisation</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Somebody who runs an organisation on this site has invited you to its team. Type the
        invitation code they gave you. It works once, and only for the email address it was issued
        to, so sign in with that address first.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        {arrives ? `${arrives} ` : null}
        <Link href="/limitations" className={LINK}>
          What this site does not do
        </Link>
      </p>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        The code is only ever typed in, never carried in a web address — an address with a secret in
        it survives in your history and in somebody’s server log long after the invitation is used.
      </p>

      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Sent an organiser invitation by the team at The Desi Events? Enter that code at{' '}
        <Link href="/account/organizations/new" className={LINK}>
          Accept an organiser invitation
        </Link>{' '}
        instead.
      </p>

      <InvitationAcceptForm />
    </div>
  )
}
