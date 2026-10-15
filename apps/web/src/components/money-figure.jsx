/**
 * The pieces a money screen is made of.
 *
 * Three of them, and each exists because the same mistake is easy to make three
 * different ways.
 *
 * `ModeBanner` is first on every finance and operations page, and says what
 * produced the figures. A mock-mode figure is not an accounting record; a
 * screen that does not say so is one somebody will eventually paste into a
 * return. It is `role="status"` rather than `role="alert"` — it is a standing
 * condition rather than something that just happened — and it is the first
 * thing after the heading in the reading order as well as on the page.
 *
 * `Figure` renders an amount with its own currency's formatting and marks the
 * number up as a number: a screen reader reading "$12,000.00" out of a table
 * cell with no label is reading a string.
 *
 * `AgingBadge` turns the band the server computed into a colour and a word.
 * The band is computed server-side on purpose — the queue screen and the detail
 * screen must not disagree about whether something is late — and this only
 * renders it.
 *
 * @module components/money-figure
 */

import { formatPrice } from '../lib/pricing.js'
import { PANEL, TABLE_FRAME } from './workspace-kit.jsx'

/**
 * @typedef {object} ModeBannerProps
 * @property {string} mode `MOCK` or `STRIPE_TEST`.
 * @property {string} notice The sentence the server supplied.
 */

/**
 * Say what produced these figures, before any of them.
 *
 * @param {ModeBannerProps} props Component props.
 * @returns {JSX.Element} The banner.
 */
export function ModeBanner({ mode, notice }) {
  const demonstration = mode !== 'STRIPE_TEST'

  return (
    <p
      role="status"
      className={`mt-6 flex items-start gap-3 rounded-card border p-4 text-sm ${
        demonstration
          ? 'border-accent-line bg-accent-soft text-ink'
          : 'border-status-info/25 bg-status-info-soft text-ink'
      }`}
    >
      {/* A diamond, the site's mark for "read this first". Decoration: the
          words beside it say what it means. */}
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2.5 shrink-0 rotate-45 rounded-[2px] ${
          demonstration ? 'bg-accent' : 'bg-status-info'
        }`}
      />
      <span>
        <span className="font-semibold">
          {demonstration ? 'Demonstration data' : 'Sandbox data'}
        </span>{' '}
        {notice}
      </span>
    </p>
  )
}

/**
 * @typedef {object} FigureProps
 * @property {string} label What the number is.
 * @property {number} cents The amount, in minor units.
 * @property {string} [currency] ISO 4217 code. Defaults to US dollars, the catalogue's currency.
 * @property {string} [hint] A sentence under the number.
 */

/**
 * One labelled amount.
 *
 * @param {FigureProps} props Component props.
 * @returns {JSX.Element} The figure.
 */
export function Figure({ label, cents, currency = 'USD', hint }) {
  return (
    <div className={`p-4 sm:p-5 ${PANEL}`}>
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      {/*
        The hint lives inside the `dd`, not beside it. A `div` wrapping a
        definition-list group may contain only `dt` and `dd` — a `p` as a third
        sibling breaks the list's structure, which is what a screen reader
        navigates it by, and axe's `definition-list` rule says so under WCAG
        1.3.1. Found by the sweep on this component's first run.
      */}
      <dd className="mt-1">
        <span className="block font-display text-h2 font-semibold break-words text-ink tabular-nums">
          {formatPrice(cents, currency)}
        </span>
        {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
      </dd>
    </div>
  )
}

/**
 * @typedef {object} ScrollableTableProps
 * @property {string} label What the table is, for the scroll region's name.
 * @property {object} children The table.
 */

/**
 * A table that scrolls sideways, reachable by keyboard.
 *
 * A `overflow-x-auto` container is scrollable by mouse and by touch and — in
 * Safari especially — by nothing else: there is no focusable element inside a
 * wide table's overflow, so a keyboard user cannot reach the columns off the
 * right edge. `tabIndex={0}` with a `role="region"` and a name is the remedy
 * axe's `scrollable-region-focusable` rule asks for, under WCAG 2.1.1.
 *
 * @param {ScrollableTableProps} props Component props.
 * @returns {JSX.Element} The scrollable region.
 */
export function ScrollableTable({ label, children }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`mt-4 ${TABLE_FRAME} focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none`}
    >
      {children}
    </div>
  )
}

/**
 * @typedef {object} AgingBadgeProps
 * @property {string} band `FRESH`, `AGING` or `OVERDUE`.
 * @property {number} hours How long it has been open.
 */

/**
 * How late a work item is.
 *
 * Colour *and* a word: a badge that only differs by colour tells a colour-blind
 * reader nothing, and WCAG 1.4.1 says so.
 *
 * @param {AgingBadgeProps} props Component props.
 * @returns {JSX.Element} The badge.
 */
export function AgingBadge({ band, hours }) {
  const tone = {
    FRESH: 'border-line-strong bg-surface-subtle text-ink',
    AGING: 'border-status-warning/30 bg-status-warning-soft text-status-warning',
    OVERDUE: 'border-status-danger/25 bg-status-danger-soft text-status-danger',
  }[band]

  const reading = { FRESH: 'Fresh', AGING: 'Ageing', OVERDUE: 'Overdue' }[band] ?? band

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}
    >
      {reading}
      <span className="font-normal">
        · open {hours}
        <abbr title="hours">h</abbr>
      </span>
    </span>
  )
}
