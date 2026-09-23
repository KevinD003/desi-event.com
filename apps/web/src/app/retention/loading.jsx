/**
 * What retention pages show while their reads are in flight.
 *
 * Every page here is rendered on request and waits on the API before it can
 * draw anything. This is the Suspense fallback the App Router puts around them:
 * on a navigation between pages in this area it appears at once, in place of
 * the page, while the shell and its rail stay put. It is words in a polite
 * status region, not a spinner, and it cannot outlast the read — each read
 * gives up after five seconds and the page then draws its refusal.
 *
 * It does not cover the area's layout, which checks the session before
 * anything streams, so a signed-out visitor is still redirected with a real
 * redirect rather than a streamed one. No page under it calls `notFound()` or
 * `redirect()`, which is what keeps streaming from changing a status code.
 *
 * @module app/retention/loading
 */

import { Loading } from '../../components/page-state.jsx'

/**
 * The fallback.
 *
 * @returns {JSX.Element} The loading state.
 */
export default function RetentionLoading() {
  return <Loading label="the retention record" />
}
