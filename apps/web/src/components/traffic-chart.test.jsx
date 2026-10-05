/**
 * The visits chart: an image with a name and a data-written description, one
 * count axis, a legend naming both series, series colours on marks only, and a
 * sentence instead of an empty plot.
 *
 * @module components/traffic-chart.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CHART_CAPTION } from '../lib/traffic-chart.js'
import { TrafficChart } from './traffic-chart.jsx'

afterEach(cleanup)

/**
 * A run of days with counts.
 *
 * @param {Array<Array<number>>} counts `[views, visitors]` per day.
 * @returns {Array<{day: string, views: number, visitors: number}>} The days, from Oct 1.
 */
function daysOf(counts) {
  return counts.map(([views, visitors], index) => ({
    day: `2026-10-${String(index + 1).padStart(2, '0')}`,
    views,
    visitors,
  }))
}

describe('TrafficChart', () => {
  it('is an image named by its caption and described by the data', () => {
    render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [3, 2],
          [12, 7],
          [5, 4],
        ])}
      />,
    )

    const chart = screen.getByRole('img', { name: CHART_CAPTION })

    expect(chart.tagName.toLowerCase()).toBe('svg')
    expect(chart.getAttribute('aria-labelledby')).toBe('visits-title')
    expect(chart.getAttribute('aria-describedby')).toBe('visits-desc')
    expect(chart.querySelector('#visits-title').textContent).toBe(CHART_CAPTION)

    const description = chart.querySelector('#visits-desc').textContent

    expect(description).toMatch(/from Oct 1 to Oct 3 \(UTC\)/u)
    expect(description).toMatch(/20 page views in all, the most on Oct 2 \(12\)/u)
    expect(description).toMatch(/13 visitors in all/u)
  })

  it('is a figure with the caption as its visible name', () => {
    render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [1, 1],
          [2, 1],
        ])}
      />,
    )

    const figure = screen.getByRole('figure', { name: CHART_CAPTION })

    expect(within(figure).getByText(CHART_CAPTION, { selector: 'figcaption' })).toBeTruthy()
  })

  it('has a legend naming both series, in ink, never in a series colour', () => {
    const { container } = render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [1, 1],
          [2, 1],
        ])}
      />,
    )
    const legend = container.querySelector('figure ul')

    expect(within(legend).getByText('Page views')).toBeTruthy()
    expect(within(legend).getByText('Visitors')).toBeTruthy()
    expect(legend.className).toContain('text-ink')

    // Text never wears a series colour: no text- or fill- utility on a text
    // element names a chart token.
    for (const element of container.querySelectorAll('text, ul, li, figcaption')) {
      expect(element.getAttribute('class') ?? '').not.toMatch(/(?:text|fill)-chart-/u)
    }
  })

  it('draws the bars and the visitors line in their series colours', () => {
    const { container } = render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [4, 1],
          [0, 0],
          [6, 3],
        ])}
      />,
    )

    // A day with no page views has no bar.
    expect(container.querySelectorAll('path.fill-chart-views')).toHaveLength(2)
    expect(container.querySelectorAll('path.stroke-chart-visitors')).toHaveLength(1)
    expect(container.querySelectorAll('circle.fill-chart-visitors')).toHaveLength(3)
  })

  it('uses one count axis: a single column of tick labels from zero', () => {
    const { container } = render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [30, 12],
          [45, 20],
        ])}
      />,
    )
    const tickLabels = [...container.querySelectorAll('text[text-anchor="end"]')].map(
      (text) => text.textContent,
    )

    expect(tickLabels).toEqual(['0', '25', '50'])
    expect(
      new Set(
        [...container.querySelectorAll('text[text-anchor="end"]')].map((t) => t.getAttribute('x')),
      ).size,
    ).toBe(1)
  })

  it('gives every day a hover target naming the day and both counts', () => {
    const { container } = render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [4, 1],
          [0, 0],
          [1234, 3],
        ])}
      />,
    )
    const targets = [...container.querySelectorAll('rect[data-chart-target]')]

    expect(targets).toHaveLength(3)
    expect(targets[2].querySelector('title').textContent).toBe(
      'Oct 3: 1,234 page views, 3 visitors',
    )
    expect(targets.every((target) => Number(target.getAttribute('height')) > 0)).toBe(true)
  })

  it('scrolls sideways in a named, keyboard-reachable region rather than shrinking', () => {
    render(<TrafficChart id="visits" caption={CHART_CAPTION} days={daysOf([[1, 1]])} />)

    const region = screen.getByRole('region', { name: `${CHART_CAPTION}, scrolls sideways` })

    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.className).toContain('overflow-x-auto')
  })

  it('says nothing was counted, and draws no plot, when every day is zero', () => {
    const { container } = render(
      <TrafficChart
        id="visits"
        caption={CHART_CAPTION}
        days={daysOf([
          [0, 0],
          [0, 0],
        ])}
      />,
    )

    expect(screen.getByText('No page views were counted in this period.')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('says the same with no days at all', () => {
    const { container } = render(<TrafficChart id="visits" caption={CHART_CAPTION} days={[]} />)

    expect(screen.getByText('No page views were counted in this period.')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })
})
