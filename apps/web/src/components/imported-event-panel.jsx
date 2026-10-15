/**
 * What the ticket box adds for an event imported from an organiser's own
 * listing (SPEC2-XI I-E; ADR 0015, addendum 2026-10-15 (2)).
 *
 * Such an event is sold here like any other: the box above this shows its
 * ticket types and "Choose tickets", and checkout takes the order (payments on
 * this site are simulated). This panel adds two things beneath them:
 *
 *   - where the prices come from: "Prices are as the organiser listed them on
 *     30 September 2026.", never naming the site the listing was read from;
 *   - "Reserve on WhatsApp", the company's own WhatsApp chat
 *     (`lib/contact.js`), opened in a new tab with a message naming the
 *     event, its day and its place, as the company's own site offers. Only
 *     while the event can still be reserved (`reservable`: announced, on sale,
 *     paused or sold out, and not yet started; `reservableOnWhatsApp` in
 *     `lib/imports.js`); a cancelled, postponed or finished event keeps the
 *     prices note alone.
 *
 * Nothing here links to, or redirects through, any other site, and nothing
 * about the visitor is put in the chat's address.
 *
 * A Server Component: nothing here has state.
 *
 * @module components/imported-event-panel
 */

import {
  RESERVE_ON_WHATSAPP_LABEL,
  RESERVE_ON_WHATSAPP_NAME,
  reserveOnWhatsAppUrl,
} from '../lib/contact.js'
import { importedPricesSentence } from '../lib/imports.js'
import { SECONDARY_LINK } from './link-classes.js'

/** The note under the WhatsApp button, which describes it. */
export const RESERVE_NOTE =
  'Opens a WhatsApp chat with the team at The Desi Events, with a message about this event ready for you to send.'

/**
 * @typedef {object} ImportedEventPanelProps
 * @property {object} event The public event: `title`, `startsAt`, `timezone` and `venue`.
 * @property {object} importedFrom The event's `importedFrom`.
 * @property {boolean} [reservable] Whether to offer "Reserve on WhatsApp". The page passes `reservableOnWhatsApp(event)`.
 */

/**
 * The prices note and the WhatsApp button.
 *
 * @param {ImportedEventPanelProps} props Component props.
 * @returns {JSX.Element} The panel.
 */
export function ImportedEventPanel({ event, importedFrom, reservable = true }) {
  return (
    <div className="mt-5" data-testid="imported-event-panel">
      <p className="text-sm text-ink-muted">{importedPricesSentence(importedFrom)}</p>
      {reservable ? <ReserveOnWhatsApp event={event} /> : null}
    </div>
  )
}

/**
 * The "Reserve on WhatsApp" button and the note that describes it.
 *
 * @param {object} props Component props.
 * @param {object} props.event The public event.
 * @returns {JSX.Element} The button and its note.
 */
function ReserveOnWhatsApp({ event }) {
  return (
    <>
      <p className="mt-4">
        <a
          href={reserveOnWhatsAppUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={RESERVE_ON_WHATSAPP_NAME}
          aria-describedby="reserve-on-whatsapp-note"
          className={`${SECONDARY_LINK} w-full`}
        >
          {RESERVE_ON_WHATSAPP_LABEL}
        </a>
      </p>
      <p id="reserve-on-whatsapp-note" className="mt-1 text-sm text-ink-muted">
        {RESERVE_NOTE}
      </p>
    </>
  )
}
