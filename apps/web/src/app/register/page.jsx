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
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold text-ink">Create an account</h1>
      <p className="mt-3 text-ink-muted">
        Your tickets are kept in your account. It takes a name, an email address and a password.
      </p>

      <div className="mt-8">
        <RegisterForm next={next} />
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        Already have one?{' '}
        <Link
          href={next === DEFAULT_NEXT_PATH ? '/sign-in' : signInHref(next)}
          className="rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
