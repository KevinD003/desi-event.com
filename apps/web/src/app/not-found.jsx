/**
 * The 404 page for URLs that match no route at all.
 *
 * Next.js renders this file through its router — not through the render-error
 * path `notFound()` uses — so an unmatched URL genuinely answers `404` with the
 * complete page in the first response. Routes that discover a *missing
 * resource* render {@link NotFoundView} directly instead; see
 * `components/not-found-view.jsx` for why.
 *
 * @module app/not-found
 */

import { NotFoundView } from '../components/not-found-view.jsx'

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

/**
 * The not-found page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function NotFound() {
  return <NotFoundView />
}
