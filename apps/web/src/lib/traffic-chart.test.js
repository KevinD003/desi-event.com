import { describe, expect, it } from 'vitest'

import {
  CHART_CAPTION,
  DEFAULT_SIZE,
  TABLE_SUMMARY,
  chartDescription,
  chartModel,
  isEmptySeries,
  niceMax,
} from './traffic-chart.js'

/**
 * A series of `n` days ending on Oct 1.
 *
 * @param {number} n Days.
 * @param {function(number): {views: number, visitors: number}} figures The figures of day `i`.
 * @returns {Array<object>} The series.
 */
function series(n, figures = (i) => ({ views: i % 7, visitors: i % 3 })) {
  const end = Date.parse('2026-10-01T00:00:00.000Z')

  return Array.from({ length: n }, (_unused, i) => ({
    day: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    ...figures(i),
  }))
}

describe('niceMax', () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 5],
    [7, 10],
    [11, 20],
    [40, 50],
    [51, 100],
    [999, 1000],
    [1001, 2000],
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceMax(value)).toBe(expected)
  })
})

describe('chartModel', () => {
  it('draws every bar inside the plot, standing on the baseline', () => {
    const model = chartModel(series(30))

    for (const bar of model.bars) {
      expect(bar.y + bar.h).toBeCloseTo(model.baseline, 1)
      expect(bar.y).toBeGreaterThanOrEqual(DEFAULT_SIZE.padding.top)
      expect(bar.h).toBeGreaterThanOrEqual(0)
    }
  })

  it('leaves a 2px gap between bars up to 90 days, and none at 200', () => {
    const thirty = chartModel(series(30))
    const twoHundred = chartModel(series(200))
    const slot30 = (DEFAULT_SIZE.width - 56) / 30

    expect(thirty.bars[0].w).toBe(Math.floor(slot30) - 2)
    expect(thirty.bars[1].x - (thirty.bars[0].x + thirty.bars[0].w)).toBeCloseTo(
      slot30 - thirty.bars[0].w,
      1,
    )
    expect(twoHundred.bars[0].w).toBe(Math.max(1, Math.floor((DEFAULT_SIZE.width - 56) / 200)))
  })

  it('uses one count axis for both series, from zero to a round maximum', () => {
    const model = chartModel(series(5, (i) => ({ views: i * 3, visitors: 13 - i })))

    expect(model.max).toBe(20)
    expect(model.ticks.map((tick) => tick.value)).toEqual([0, 10, 20])
    expect(model.ticks[0].y).toBe(model.baseline)
    // The visitors line is scaled on the same axis as the bars.
    expect(model.points[0].cy).toBeCloseTo(model.baseline - (13 / 20) * (240 - 12 - 28), 1)
  })

  it('rounds the tops of bars and draws no bar for a day with no views', () => {
    const model = chartModel(series(3, (i) => ({ views: i, visitors: 0 })))

    expect(model.bars[0].path).toBeNull()
    expect(model.bars[2].path).toMatch(/^M[\d.]+,[\d.]+ V[\d.]+ Q/u)
  })

  it('draws the visitors as one line through every day', () => {
    const model = chartModel(series(4))

    expect(model.line.split(' ')).toHaveLength(4)
    expect(model.line.startsWith('M')).toBe(true)
  })

  it('labels the first, middle and last day from five days, and the ends below that', () => {
    expect(chartModel(series(9)).xLabels.map((label) => label.label)).toEqual([
      'Sep 23',
      'Sep 27',
      'Oct 1',
    ])
    expect(chartModel(series(3)).xLabels.map((label) => label.label)).toEqual(['Sep 29', 'Oct 1'])
    expect(chartModel(series(1)).xLabels.map((label) => label.label)).toEqual(['Oct 1'])
  })
})

describe('chartDescription', () => {
  it('names the period, the totals and the peak day', () => {
    const days = series(3, (i) => ({ views: [2, 9, 4][i], visitors: [1, 5, 3][i] }))

    expect(chartDescription(days)).toBe(
      'Daily page views and visitors from Sep 29 to Oct 1 (UTC). 15 page views in all, the most on Sep 30 (9). 9 visitors in all. Every day is listed in the table below the chart.',
    )
  })

  it('says so when nothing was counted', () => {
    const days = series(2, () => ({ views: 0, visitors: 0 }))

    expect(isEmptySeries(days)).toBe(true)
    expect(chartDescription(days)).toBe(
      'Daily page views and visitors from Sep 30 to Oct 1 (UTC). No page views were counted.',
    )
  })

  it('says one day as one day', () => {
    expect(chartDescription(series(1, () => ({ views: 1, visitors: 1 })))).toMatch(
      /^Daily page views and visitors on Oct 1 \(UTC\)\./u,
    )
  })
})

describe('the words', () => {
  it('captions the chart and its table as the screens say them', () => {
    expect(CHART_CAPTION).toBe('Page views and visitors per day (UTC)')
    expect(TABLE_SUMMARY).toBe('Visits per day, as a table')
  })
})
