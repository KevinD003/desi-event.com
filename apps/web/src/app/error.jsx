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
 * @module app/error
 */

import { useEffect } from 'react'
import Link from 'next/link'
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
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p aria-hidden="true" className="font-display text-6xl text-accent">
        ◍
      </p>
      <h1 className="mt-6 text-3xl font-bold text-ink sm:text-4xl">
        Something went wrong at our end
      </h1>
      <p className="mt-4 text-lg text-ink-muted">
        The page could not be loaded. Nothing has been ordered and you have not been charged. Try
        again — and if it keeps happening, the listings below are still reachable.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/events"
          className="inline-flex h-12 items-center justify-center rounded-lg border border-line-strong bg-surface-raised px-6 text-base font-medium text-ink transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Browse every event
        </Link>
      </div>
    </div>
  )
}
