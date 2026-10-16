'use client'

/**
 * The route error boundary.
 *
 * Next requires this to be a Client Component. It deliberately shows no stack
 * trace, no error message and no digest in the body of the page: the visitor
 * cannot act on any of it, and an internal message is exactly the kind of thing
 * that should not be rendered to the public. The detail goes to the console,
 * where a developer can find it.
 *
 * It replaces everything below the root layout, the area's own shell
 * included, so it draws a header and footer of its own (`bare-chrome.jsx`):
 * the page still has its banner, its `main` (the skip link's target) and its
 * `contentinfo`, and a way home.
 *
 * @module app/error
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { Icon } from '@desi-event/ui/icons'

import { BareFooter, BareHeader } from '../components/bare-chrome.jsx'
import { OUTLINE_LINK } from '../components/link-classes.js'
import { Button } from '../components/ui.jsx'

/**
 * @typedef {object} ErrorBoundaryProps
 * @property {Error} error The error that was thrown, carrying a `digest` in production.
 * @property {Function} reset Re-renders the segment, retrying the render that failed.
 */

/**
 * The error page shown when a route fails to render.
 *
 * @param {ErrorBoundaryProps} props Component props supplied by Next.js.
 * @returns {JSX.Element} The rendered page.
 */
export default function RouteError({ error, reset }) {
  useEffect(() => {
    console.error('[desi-event/web] route render failed:', error)
  }, [error])

  return (
    <>
      <BareHeader />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-bleed px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
          <h1 className="max-w-[14ch] text-display text-ink">Something went wrong at our end</h1>
          <p className="mt-6 max-w-[52ch] text-body text-ink-muted">
            The page could not be loaded. Nothing has been ordered and you have not been charged.
            Try again. If it keeps happening, every event is still listed.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={reset}>
              <Icon name="refresh" className="h-4.5 w-4.5" />
              Try again
            </Button>
            <Link href="/events" className={`${OUTLINE_LINK} min-h-12 text-base`}>
              Browse every event
            </Link>
          </div>
        </div>
      </main>
      <BareFooter />
    </>
  )
}
