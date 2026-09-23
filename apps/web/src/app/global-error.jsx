'use client'

/**
 * The global error boundary.
 *
 * This catches failures in the root layout itself, so it cannot rely on that
 * layout being rendered — it has to supply its own `html` and `body` elements.
 * For the same reason it deliberately uses inline styles rather than Tailwind
 * classes: if the failure happened before the stylesheet was applied, utility
 * classes would render as unstyled markup.
 *
 * Like the route boundary, it shows the visitor nothing they cannot act on. No
 * message, no stack, no digest in the page body.
 *
 * @module app/global-error
 */

import { useEffect } from 'react'

/**
 * @typedef {object} GlobalErrorProps
 * @property {Error} error The error that was thrown, carrying a `digest` in production.
 * @property {Function} reset Re-renders the root, retrying the render that failed.
 */

/**
 * The full-document error page shown when the root layout fails.
 *
 * @param {GlobalErrorProps} props Component props supplied by Next.js.
 * @returns {JSX.Element} The rendered document.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[desi-event/web] root render failed:', error)
  }, [error])

  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // The page and ink tokens, as hex: this renders without the stylesheet.
          // `semantic-classes.test.js` checks they still equal the tokens.
          backgroundColor: '#fff6e0',
          color: '#2a1b59',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0 }}>
            Desi-Event is temporarily unavailable
          </h1>
          <p style={{ marginTop: '1rem', fontSize: '1.05rem', lineHeight: 1.6 }}>
            Something failed while loading the site. Nothing has been ordered and you have not been
            charged.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.75rem',
              height: '3rem',
              padding: '0 1.5rem',
              fontSize: '1rem',
              fontWeight: 500,
              // The primary action and its ink, 7.22:1.
              color: '#ffffff',
              backgroundColor: '#993800',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Reload the page
          </button>
        </main>
      </body>
    </html>
  )
}
