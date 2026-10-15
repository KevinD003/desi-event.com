/**
 * The note shown when the page is rendering the curated catalogue because the
 * live API could not be reached.
 *
 * Saying so is the honest option. The alternative — showing sample listings as
 * though they were on sale — would eventually sell somebody a ticket to an
 * event that does not exist.
 *
 * @module components/sample-data-notice
 */

import { Alert } from './ui.jsx'

/**
 * @typedef {object} SampleDataNoticeProps
 * @property {boolean} show Whether the surrounding page fell back to sample data.
 * @property {string} [className] Spacing around the notice. Defaults to a top margin.
 */

/**
 * A quiet, non-blocking notice about offline data.
 *
 * @param {SampleDataNoticeProps} props Component props.
 * @returns {JSX.Element|null} The notice, or `null` when the live API answered.
 */
export function SampleDataNotice({ show, className = 'mt-6' }) {
  if (!show) return null

  return (
    <Alert
      variant="info"
      title="Showing our sample programme"
      className={`rounded-card ${className}`}
    >
      The live listings service is not answering right now, so these are curated example events.
      Prices and availability are illustrative and nothing here can be bought.
    </Alert>
  )
}
