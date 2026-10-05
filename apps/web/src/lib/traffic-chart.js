/**
 * The geometry of the visits chart, and the words that describe it.
 *
 * Pure: the server-rendered chart draws what this returns, and nothing about
 * the chart needs client JavaScript. Page views per day are bars and visitors
 * per day are a line with markers, both counts on **one** y-axis — never two —
 * so neither series can be made to look bigger by its scale. The shapes differ
 * (bars against a line and dots), so the two are never told apart by colour
 * alone, and the same figures are always in the table under the chart.
 *
 * @module lib/traffic-chart
 */

import { formatCount, formatDay } from './traffic.js'

/** The chart's caption and accessible title. */
export const CHART_CAPTION = 'Page views and visitors per day (UTC)'

/** The summary of the table that holds every figure the chart draws. */
export const TABLE_SUMMARY = 'Visits per day, as a table'

/** The default drawing box. */
export const DEFAULT_SIZE = Object.freeze({
  width: 720,
  height: 240,
  padding: Object.freeze({ top: 12, right: 12, bottom: 28, left: 44 }),
})

/** Bars are drawn with a gap between them up to this many days. */
export const GAP_UP_TO_DAYS = 90

const round = (value) => Math.round(value * 100) / 100

/**
 * The top of the y-axis: 1, 2 or 5 times a power of ten, at least `n` and at least 1.
 *
 * @param {number} n The largest value drawn.
 * @returns {number} The axis maximum.
 */
export function niceMax(n) {
  const value = Math.max(1, Number(n) || 0)
  const power = 10 ** Math.floor(Math.log10(value))

  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) return step * power
  }

  return 10 * power
}

/**
 * A bar with a rounded top, anchored to the baseline.
 *
 * @param {number} x Left edge.
 * @param {number} y Top.
 * @param {number} w Width.
 * @param {number} baseline The axis line.
 * @returns {string} An SVG path.
 */
function barPath(x, y, w, baseline) {
  const r = Math.min(4, w / 2, baseline - y)

  return [
    `M${round(x)},${round(baseline)}`,
    `V${round(y + r)}`,
    `Q${round(x)},${round(y)} ${round(x + r)},${round(y)}`,
    `H${round(x + w - r)}`,
    `Q${round(x + w)},${round(y)} ${round(x + w)},${round(y + r)}`,
    `V${round(baseline)}`,
    'Z',
  ].join(' ')
}

/**
 * Everything the chart draws.
 *
 * @param {Array<{day: string, views: number, visitors: number}>} days One entry per UTC day, oldest first.
 * @param {object} [size] The drawing box.
 * @param {number} [size.width] Width.
 * @param {number} [size.height] Height.
 * @param {{top: number, right: number, bottom: number, left: number}} [size.padding] Room for the axes.
 * @returns {{bars: Array<object>, line: string, points: Array<object>, ticks: Array<object>, xLabels: Array<object>, max: number, baseline: number}} The marks.
 */
export function chartModel(days, { width, height, padding } = {}) {
  const box = {
    width: width ?? DEFAULT_SIZE.width,
    height: height ?? DEFAULT_SIZE.height,
    padding: padding ?? DEFAULT_SIZE.padding,
  }
  const n = days.length
  const plotW = box.width - box.padding.left - box.padding.right
  const plotH = box.height - box.padding.top - box.padding.bottom
  const baseline = box.padding.top + plotH
  const max = niceMax(Math.max(0, ...days.map((day) => Math.max(day.views, day.visitors))))
  const slot = n > 0 ? plotW / n : plotW
  const w = Math.max(1, Math.floor(slot) - (n <= GAP_UP_TO_DAYS ? 2 : 0))
  const yOf = (value) => baseline - (Math.max(0, value) / max) * plotH

  const bars = days.map((day, index) => {
    const x = box.padding.left + index * slot + (slot - w) / 2
    const y = yOf(day.views)
    const h = baseline - y

    return {
      x: round(x),
      y: round(y),
      w,
      h: round(h),
      day: day.day,
      views: day.views,
      path: h > 0 ? barPath(x, y, w, baseline) : null,
    }
  })

  const points = days.map((day, index) => ({
    cx: round(box.padding.left + index * slot + slot / 2),
    cy: round(yOf(day.visitors)),
    day: day.day,
    visitors: day.visitors,
  }))

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.cx},${point.cy}`)
    .join(' ')

  const ticks = [0, max / 2, max].map((value) => ({
    y: round(yOf(value)),
    value,
    label: formatCount(value),
  }))

  const labelled = n === 0 ? [] : n >= 5 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1]
  const xLabels = [...new Set(labelled)].map((index) => ({
    x: points[index].cx,
    label: formatDay(days[index].day),
  }))

  return { bars, line, points, ticks, xLabels, max, baseline: round(baseline) }
}

/**
 * Whether there is anything to draw.
 *
 * @param {Array<{views: number, visitors: number}>} days The series.
 * @returns {boolean} True when every day is zero.
 */
export function isEmptySeries(days) {
  return days.every((day) => !day.views && !day.visitors)
}

/**
 * The chart in words, from its data: the period, the totals and the peak.
 *
 * @param {Array<{day: string, views: number, visitors: number}>} days The series.
 * @returns {string} The description.
 */
export function chartDescription(days) {
  if (days.length === 0) return 'No days to show.'

  const first = formatDay(days[0].day)
  const last = formatDay(days.at(-1).day)
  const span = days.length === 1 ? `on ${first}` : `from ${first} to ${last}`
  const totalViews = days.reduce((sum, day) => sum + day.views, 0)
  const totalVisitors = days.reduce((sum, day) => sum + day.visitors, 0)

  if (totalViews === 0 && totalVisitors === 0) {
    return `Daily page views and visitors ${span} (UTC). No page views were counted.`
  }

  const peak = days.reduce((best, day) => (day.views > best.views ? day : best), days[0])

  return [
    `Daily page views and visitors ${span} (UTC).`,
    `${formatCount(totalViews)} page views in all, the most on ${formatDay(peak.day)} (${formatCount(peak.views)}).`,
    `${formatCount(totalVisitors)} visitors in all.`,
    'Every day is listed in the table below the chart.',
  ].join(' ')
}
