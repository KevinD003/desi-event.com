/**
 * Sign in.
 *
 * The door every signed-in page sends people to, and the way back: `next`
 * carries the page they asked for, and they return to it.
 *
 * @module app/sign-in/page
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SignInForm } from '../../components/sign-in-form.jsx'
import { safeNextPath } from '../../lib/next-path.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in',
  // Nothing here is worth indexing, and an indexed sign-in page is a phishing
  // target with our name on it.
  robots: { index: false, follow: false },
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
  // Only a path on this site, checked the way a browser will read it; see
  // `lib/next-path.js` for the backslash and whitespace tricks the old check
  // let through. With no usable `next`, the account page.
  const next = safeNextPath(query?.next)

  // Already signed in: there is nothing to do here.
  if (await readSession()) redirect(next)

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold text-ink">Sign in</h1>
      <p className="mt-3 text-ink-muted">
        Your tickets live in your account, and so does the workspace if you run events.
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
