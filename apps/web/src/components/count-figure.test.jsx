/**
 * A count is shown as a count — thousands separated, never as money — and a
 * sentence in its place is shown as it is, inside a well-formed definition
 * list entry.
 *
 * @module components/count-figure.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CountFigure } from './count-figure.jsx'

afterEach(cleanup)

describe('CountFigure', () => {
  it('prints a number with thousands separated and no currency', () => {
    const { container } = render(
      <dl>
        <CountFigure label="Page views" value={1204} hint="Each time the page was opened." />
      </dl>,
    )

    expect(screen.getByText('1,204')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\$/u)
    expect(screen.getByText('Page views').tagName).toBe('DT')
  })

  it('prints words as they are, for a figure with nothing to divide by', () => {
    render(
      <dl>
        <CountFigure label="Visitors to paid orders" value="No visitors counted" />
      </dl>,
    )

    expect(screen.getByText('No visitors counted')).toBeTruthy()
  })

  it('keeps the hint inside the dd, so the list holds only dt and dd', () => {
    const { container } = render(
      <dl>
        <CountFigure label="Visitors" value={3} hint="Counted once a day for each event." />
      </dl>,
    )

    const group = container.querySelector('dl > div')

    expect([...group.children].map((child) => child.tagName)).toEqual(['DT', 'DD'])
    expect(group.querySelector('dd').textContent).toContain('Counted once a day for each event.')
  })
})
