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

import { AuthFrame } from '../../components/auth-frame.jsx'
import { TEXT_LINK } from '../../components/link-classes.js'
import { SignInForm } from '../../components/sign-in-form.jsx'
import { DEFAULT_NEXT_PATH, safeNextPath } from '../../lib/next-path.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in',
  // Nothing here is worth indexing, and an indexed sign-in page is a phishing
  // target with our name on it.
  robots: { index: false, follow: false },
}

/**
 * The account-creation page, carrying the same `next`.
 *
 * @param {string} next A path already checked by `safeNextPath`.
 * @returns {string} The link.
 */
function registerHref(next) {
  return next === DEFAULT_NEXT_PATH ? '/register' : `/register?next=${encodeURIComponent(next)}`
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
    <AuthFrame
      headingId="sign-in-heading"
      title="Sign in"
      lead="Your tickets live in your account, and so does the workspace if you run events."
    >
      <SignInForm next={next} />

      <div className="mt-8 border-t border-line pt-6 text-sm text-ink-muted">
        <p>
          New here?{' '}
          <Link href={registerHref(next)} className={TEXT_LINK}>
            Create an account
          </Link>
        </p>
        <p className="mt-2">
          <Link href="/events" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            Back to what&rsquo;s on
          </Link>
        </p>
      </div>
    </AuthFrame>
  )
}
