/**
 * One labelled count, for a definition list of figures.
 *
 * The visits section of the analytics page shows counts beside the money
 * figures, and they should look like the same kind of thing without being
 * formatted as money: `Figure` in `money-figure.jsx` turns minor units into a
 * currency, which would make "1,204 page views" read "$12.04". This is that
 * component's shape with the value taken as it comes — a number is printed
 * with thousands separated, a string (a percentage, or a sentence saying
 * there is nothing to divide by) as it is.
 *
 * The hint sits inside the `dd`, for the reason `Figure` gives: a `div` grouping
 * a definition list's entries may hold only `dt` and `dd`.
 *
 * @module components/count-figure
 */

import { formatCount } from '../lib/traffic.js'
import { PANEL } from './workspace-kit.jsx'

/**
 * @typedef {object} CountFigureProps
 * @property {string} label What the number is.
 * @property {number|string} value The count, or the words to show instead.
 * @property {string} [hint] A sentence under the number.
 */

/**
 * One labelled count.
 *
 * @param {CountFigureProps} props Component props.
 * @returns {JSX.Element} The figure, for use inside a `dl`.
 */
export function CountFigure({ label, value, hint }) {
  const shown = typeof value === 'number' ? formatCount(value) : value

  return (
    <div className={`p-4 sm:p-5 ${PANEL}`}>
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1">
        <span className="block font-display text-h3 font-semibold break-words text-ink tabular-nums">
          {shown}
        </span>
        {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
      </dd>
    </div>
  )
}
