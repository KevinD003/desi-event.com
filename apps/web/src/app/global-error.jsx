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
    <html lang="en-US">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          // The page and ink tokens, as hex: this renders without the stylesheet.
          // `semantic-classes.test.js` checks every one still equals a token.
          backgroundColor: '#ffffff',
          color: '#29094a',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        {/* The purple plate the site's footer is drawn on, with the name in
            words: the logo is a file this page may not be able to fetch. */}
        <header
          style={{
            backgroundColor: '#32105e',
            color: '#ffffff',
            padding: '1rem 1.5rem',
            borderBottom: '2px solid #b60254',
          }}
        >
          <p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
            The Desi Events
          </p>
        </header>
        <main
          style={{ flex: 1, maxWidth: '40rem', padding: '4rem 1.5rem', boxSizing: 'border-box' }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.25rem, 1.5rem + 3vw, 3.5rem)',
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            The Desi Events is temporarily unavailable
          </h1>
          <p
            style={{
              marginTop: '1.25rem',
              fontSize: '1.0625rem',
              lineHeight: 1.65,
              color: '#5a4e72',
            }}
          >
            Something failed while loading the site. Nothing has been ordered and you have not been
            charged.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              minHeight: '3rem',
              padding: '0 1.5rem',
              fontSize: '1rem',
              fontWeight: 700,
              // The primary action (the kit magenta) and its ink.
              color: '#ffffff',
              backgroundColor: '#b60254',
              border: 'none',
              borderRadius: '0.625rem',
              cursor: 'pointer',
            }}
          >
            Reload the page
          </button>
        </main>
        <footer style={{ backgroundColor: '#32105e', color: '#d2c8e8', padding: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem' }}>
            Payments on this site are simulated. No card is charged and no money moves.
          </p>
        </footer>
      </body>
    </html>
  )
}
