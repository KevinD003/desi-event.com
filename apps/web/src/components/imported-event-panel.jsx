/**
 * The ticket box of an event copied from its Sulekha listing (SPEC2-XI I-E).
 *
 * Tickets for such an event are sold on Sulekha, not here, so the box says so
 * first, then the prices as Sulekha listed them on the day they were read (or
 * that it lists none), then — while an administrator at The Desi Events has its
 * link on and the link goes to the listing's own site — "Buy tickets on
 * Sulekha" through The Desi Events' own redirect, with the same note as any
 * website link. There is no button to buy on The Desi Events, no "not on sale"
 * sentence, and what the listing said about availability is never shown.
 *
 * A Server Component: nothing here has state.
 *
 * @module components/imported-event-panel
 */

import { importedPricesSentence } from '../lib/imports.js'
import { EventWebsiteLink } from './event-website-link.jsx'

/**
 * @typedef {object} ImportedEventPanelProps
 * @property {object} importedFrom The event's `importedFrom`.
 * @property {string} slug The event's web address.
 * @property {{host: string}|null} websiteLink The event's website link, as the API sends it.
 * @property {boolean} [uncounted] Whether this reader's visits are left uncounted.
 */

/**
 * The box's contents.
 *
 * @param {ImportedEventPanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function ImportedEventPanel({ importedFrom, slug, websiteLink, uncounted = false }) {
  const source = importedFrom.sourceName ?? 'Sulekha'

  return (
    <div className="mt-5">
      <p className="font-semibold text-ink">
        {`Tickets for this event are sold on ${source}, not on The Desi Events.`}
      </p>
      <p className="mt-3 text-ink-muted">{importedPricesSentence(importedFrom)}</p>
      {importedFrom.ticketsOnSource ? (
        <EventWebsiteLink
          slug={slug}
          link={websiteLink ?? null}
          uncounted={uncounted}
          label={`Buy tickets on ${source}`}
          button
        />
      ) : null}
    </div>
  )
}
