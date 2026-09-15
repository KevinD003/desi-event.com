/**
 * The moderation area.
 *
 * Signed in, and holding `moderation:review`. The check is here rather than in
 * each page — a page that forgets is a page that leaks, and there is no way to
 * forget a layout — and it is a real one: `readSession` asks the API who the
 * caller is, so a forged cookie gets the same answer as no cookie.
 *
 * What this decides is only whether to render. Every decision inside is
 * authorised again by the API, which additionally demands a recent second
 * factor under the `MODERATION` step-up policy.
 *
 * `noindex` on the whole area. Nothing under here is public, and the queue in
 * particular is a list of things nobody outside the platform should know exist.
 *
 * @module app/moderation/layout
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { readSession, sessionCan } from '../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} ModerationLayoutProps
 * @property {object} children The page.
 */

/**
 * The moderation shell.
 *
 * @param {ModerationLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function ModerationLayout({ children }) {
  const session = await readSession()

  if (!session) redirect('/sign-in?next=/moderation/events')

  if (!sessionCan(session, 'moderation:review')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-indigo-night-900">Not for you</h1>
        <p className="mt-2 text-slate-700">
          This area is for platform moderators. If you think you should have access, ask an
          administrator — nothing here can grant it to you.
        </p>
        <p className="mt-4">
          <Link href="/" className="underline underline-offset-4 hover:text-marigold-700">
            Back to the site
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4">
        <nav aria-label="Moderation">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <Link
                href="/moderation/events"
                className="rounded-sm font-medium text-indigo-night-900 underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
              >
                Review queue
              </Link>
            </li>
          </ul>
        </nav>
        <p className="text-sm text-slate-600">
          Signed in as <span className="font-medium">{session.user?.displayName}</span>
        </p>
      </div>

      <div className="mt-8">{children}</div>
    </div>
  )
}
