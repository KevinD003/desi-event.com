/**
 * Sign in.
 *
 * The only unauthenticated page in the organiser half of the site, and the door
 * every other organiser screen sends people to.
 *
 * @module app/sign-in/page
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SignInForm } from '../../components/sign-in-form.jsx'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in',
  // Nothing here is worth indexing, and an indexed sign-in page is a phishing
  // target with our name on it.
  robots: { index: false, follow: false },
}

/**
 * Where to go after signing in.
 *
 * Only a path on this site is accepted. An absolute URL in `next` is the open
 * redirect that turns a sign-in page into somebody else's phishing hop.
 *
 * @param {unknown} value The `next` query parameter.
 * @returns {string} A safe path.
 */
export function safeNext(value) {
  const candidate = typeof value === 'string' ? value : ''

  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/organizer/events'
}

/**
 * The sign-in page.
 *
 * @param {object} props Route props.
 * @param {Promise<Record<string, string>>} props.searchParams The query.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function SignInPage({ searchParams }) {
  const query = await searchParams
  const next = safeNext(query?.next)

  // Already signed in: there is nothing to do here.
  if (await readSession()) redirect(next)

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold text-ink">Sign in</h1>
      <p className="mt-3 text-ink-muted">
        For organisers and staff. Buying a ticket does not need an account.
      </p>

      <div className="mt-8">
        <SignInForm next={next} />
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        <Link
          href="/events"
          className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Back to what&rsquo;s on
        </Link>
      </p>
    </div>
  )
}
