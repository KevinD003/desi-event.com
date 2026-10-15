/**
 * The website link's switch as the organiser sees it: read-only.
 *
 * Under the "Your website" field. On or off, since when, who on the team at
 * The Desi Events decided and why, and where the link goes — in the sentences
 * of `lib/website-redirect.js`. Nothing here can change the switch; the last
 * line says who can.
 *
 * Plain presentational markup with no hooks, so it renders inside the editor's
 * client step and on a server page alike.
 *
 * @module components/website-redirect-status
 */

import { Badge } from './ui.jsx'
import { organiserSummary } from '../lib/website-redirect.js'

/**
 * @typedef {object} WebsiteRedirectStatusProps
 * @property {object|null} state The switch, as the API's `websiteRedirect`.
 * @property {string|null} [websiteUrl] The organiser's current address, as saved.
 * @property {string} [headingLevel] `h3` (default) or `h2`.
 */

/**
 * The read-only status.
 *
 * @param {WebsiteRedirectStatusProps} props Component props.
 * @returns {JSX.Element} The status.
 */
export function WebsiteRedirectStatus({ state, websiteUrl = null, headingLevel = 'h3' }) {
  const summary = organiserSummary(state, { websiteUrl })
  const Heading = headingLevel === 'h2' ? 'h2' : 'h3'

  return (
    <div
      role="group"
      aria-labelledby="website-link-status-heading"
      className="space-y-2 rounded-card border border-line bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading id="website-link-status-heading" className="text-base font-semibold text-ink">
          Website link on your event page
        </Heading>
        <Badge variant={summary.tone} srLabel="Website link:">
          {summary.label}
        </Badge>
        {summary.pending ? <Badge variant="warning">Waiting for a decision</Badge> : null}
      </div>
      {summary.sentences.map((sentence) => (
        <p key={sentence} className="text-sm text-ink-muted">
          {sentence}
        </p>
      ))}
    </div>
  )
}
