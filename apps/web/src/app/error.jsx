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
import { Diamond, ScallopHem, Toran } from '../components/festive-decor.jsx'
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
    <div>
      <section className="relative isolate overflow-hidden bg-surface-inverse text-ink-inverse">
        <Toran />
        <div className="relative mx-auto max-w-2xl px-4 pt-24 pb-20 text-center sm:px-6">
          <p className="flex items-center justify-center gap-2.5 text-micro font-bold tracking-eyebrow text-accent-inverse uppercase">
            <Diamond />
            Something went wrong
            <Diamond />
          </p>
          <h1 className="mt-5 text-h1 font-semibold text-ink-inverse">
            Something went wrong at our end
          </h1>
          <p className="mt-4 text-body text-ink-inverse-muted">
            The page could not be loaded. Nothing has been ordered and you have not been charged.
            Try again — and if it keeps happening, the listings below are still reachable.
          </p>
        </div>
        <ScallopHem />
      </section>
      <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-3 px-4 pt-10 sm:px-6">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Link href="/events" className={`${OUTLINE_LINK} min-h-12 text-base`}>
          Browse every event
        </Link>
      </div>
    </div>
  )
}
