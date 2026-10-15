/**
 * Create an account.
 *
 * The door beside sign-in, for somebody who has never been here: buying a
 * ticket needs an account, and this is where one is made. `next` works as it
 * does on sign-in, checked by `safeNextPath`, so creating an account from a
 * checkout comes back to the checkout.
 *
 * @module app/register/page
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthFrame } from '../../components/auth-frame.jsx'
import { TEXT_LINK } from '../../components/link-classes.js'
import { RegisterForm } from '../../components/register-form.jsx'
import { DEFAULT_NEXT_PATH, safeNextPath, signInHref } from '../../lib/next-path.js'
import { readSession } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
}

/**
 * The page.
 *
 * @param {object} props Route props.
 * @param {Promise<Record<string, string>>} props.searchParams The query.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function RegisterPage({ searchParams }) {
  const query = await searchParams
  const next = safeNextPath(query?.next)

  // Already signed in: there is nothing to create.
  if (await readSession()) redirect(next)

  return (
    <AuthFrame
      headingId="register-heading"
      title="Create an account"
      lead="Your tickets are kept in your account. It takes a name, an email address and a password."
    >
      <RegisterForm next={next} />

      <p className="mt-8 border-t border-line pt-6 text-sm text-ink-muted">
        Already have one?{' '}
        <Link
          href={next === DEFAULT_NEXT_PATH ? '/sign-in' : signInHref(next)}
          className={TEXT_LINK}
        >
          Sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
