/**
 * Page views and visitors per day, drawn on the server.
 *
 * One count axis: page views are bars and visitors a 2px line with markers,
 * both on the same scale, so neither series can be made to look larger by its
 * axis. The two are told apart by shape as well as colour (bars against a line
 * and dots), and a legend names both. Text never wears a series colour: tick
 * labels and the legend are in the ink tokens, and grid lines are the quiet
 * `line` token.
 *
 * Accessible as an image with a name and a description: the `<title>` is the
 * caption and `aria-describedby` points at a `<desc>` written from the data
 * (the period, the totals and the busiest day). Every figure the chart draws
 * is also in the per-day table under it (`TrafficByDay`), which is the
 * equivalent rather than a fallback.
 *
 * Hovering needs no JavaScript: each day has a column-wide target behind the
 * marks whose native tooltip names the day and both counts, and each bar and
 * marker carries its own. The chart is a server component and ships nothing
 * to the browser.
 *
 * On a narrow screen the chart keeps a readable width and scrolls sideways in
 * a keyboard-reachable region, as the tables do, rather than shrinking its
 * labels below legibility.
 *
 * @module components/traffic-chart
 */

import { DEFAULT_SIZE, chartDescription, chartModel, isEmptySeries } from '../lib/traffic-chart.js'
import { dayNamer, formatCount } from '../lib/traffic.js'

/**
 * @typedef {object} TrafficChartProps
 * @property {string} id A prefix for the chart's element ids, unique on the page.
 * @property {string} caption The chart's name.
 * @property {Array<{day: string, views: number, visitors: number}>} days One entry per UTC day, oldest first.
 */

/**
 * The legend: a swatch and a name per series, in the ink tokens.
 *
 * @returns {JSX.Element} The legend.
 */
function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-4 text-sm text-ink">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-chart-views" />
        Page views
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="relative inline-flex h-3 w-4 items-center">
          <span className="block h-0.5 w-4 bg-chart-visitors" />
          <span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-chart-visitors" />
        </span>
        Visitors
      </li>
    </ul>
  )
}

/**
 * The chart, or a sentence when there is nothing to draw.
 *
 * @param {TrafficChartProps} props Component props.
 * @returns {JSX.Element} The figure.
 */
export function TrafficChart({ id, caption, days }) {
  if (days.length === 0 || isEmptySeries(days)) {
    return <p className="mt-3 text-sm text-ink-muted">No page views were counted in this period.</p>
  }

  const model = chartModel(days)
  // Tooltips name days as the axis and the description do: with the year once
  // the series runs into a second one.
  const nameDay = dayNamer(days)
  const titleId = `${id}-title`
  const descId = `${id}-desc`
  const captionId = `${id}-caption`
  const { width, height, padding } = DEFAULT_SIZE
  const left = padding.left
  const right = width - padding.right
  // Each day's share of the plot's width: the hover target behind its marks.
  const columnWidth = (right - left) / days.length
  const top = model.ticks.at(-1).y

  return (
    <figure aria-labelledby={captionId} className="mt-4">
      <figcaption id={captionId} className="text-sm font-semibold text-ink">
        {caption}
      </figcaption>
      <Legend />
      <div
        role="region"
        aria-label={`${caption}, scrolls sideways`}
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-card focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="h-auto w-full min-w-[36rem]"
        >
          <title id={titleId}>{caption}</title>
          <desc id={descId}>{chartDescription(days)}</desc>

          {model.ticks.map((tick) => (
            <g key={`tick-${tick.value}`}>
              <line
                x1={left}
                x2={right}
                y1={tick.y}
                y2={tick.y}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={left - 6}
                y={tick.y}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-muted text-[12px]"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {model.points.map((point, index) => (
            <rect
              key={`target-${point.day}`}
              data-chart-target=""
              x={point.cx - columnWidth / 2}
              y={top}
              width={columnWidth}
              height={model.baseline - top}
              fill="transparent"
            >
              <title>{`${nameDay(point.day)}: ${formatCount(days[index].views)} page views, ${formatCount(point.visitors)} visitors`}</title>
            </rect>
          ))}

          {model.bars.map((bar) =>
            bar.path ? (
              <path key={`bar-${bar.day}`} d={bar.path} className="fill-chart-views">
                <title>{`${nameDay(bar.day)}: ${formatCount(bar.views)} page views`}</title>
              </path>
            ) : null,
          )}

          <path
            d={model.line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-chart-visitors"
          />

          {model.points.map((point) => (
            <circle
              key={`point-${point.day}`}
              cx={point.cx}
              cy={point.cy}
              r={4}
              strokeWidth={2}
              className="fill-chart-visitors stroke-surface-raised"
            >
              <title>{`${nameDay(point.day)}: ${formatCount(point.visitors)} visitors`}</title>
            </circle>
          ))}

          {model.xLabels.map((label) => (
            <text
              key={`x-${label.x}`}
              x={label.x}
              y={model.baseline + 20}
              textAnchor="middle"
              className="fill-ink-muted text-[12px]"
            >
              {label.label}
            </text>
          ))}
        </svg>
      </div>
    </figure>
  )
}
