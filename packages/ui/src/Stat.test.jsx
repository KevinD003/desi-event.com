import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { ROLL_MS, Stat } from './Stat.jsx'

/** Whether the platform asks for reduced motion, per test. */
let reduce = false
/** Animation frames waiting to run, as the browser would hold them. */
let frames = []
let now = 0

beforeEach(() => {
  reduce = false
  frames = []
  now = 0
  vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') ? reduce : false }))
  vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Advance time and run the frames that were waiting.
 *
 * @param {number} ms Milliseconds.
 * @returns {void}
 */
function advance(ms) {
  now += ms
  const pending = frames
  frames = []
  act(() => pending.forEach((callback) => callback(now)))
}

describe('Stat', () => {
  it('reads as its label then its figure, grouped, in tabular numerals', () => {
    const { container } = render(
      <Stat label="Tickets sold" value={1284} hint="Since doors opened" />,
    )

    expect(container.firstChild).toHaveTextContent('Tickets sold1,284Since doors opened')
    expect(screen.getByText('1,284')).toHaveClass('tabular-nums', 'font-display')
  })

  it('formats money with the formatter it is given', () => {
    const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

    render(<Stat label="Taken" value={1284.5} format={(value) => dollars.format(value)} />)

    expect(screen.getByText('$1,284.50')).toBeInTheDocument()
  })

  it('shows a word as it is', () => {
    render(<Stat label="Payouts" value="Simulated" />)

    expect(screen.getByText('Simulated')).toBeInTheDocument()
  })

  it('does not roll on first render: a figure arrives as it is', () => {
    render(<Stat label="Admitted" value={40} roll />)

    expect(screen.getByText('40')).toBeInTheDocument()
    expect(frames).toHaveLength(0)
  })

  it('rolls a changed number to its new value, telling a screen reader only the final one', () => {
    const { rerender } = render(<Stat label="Admitted" value={40} roll />)

    rerender(<Stat label="Admitted" value={50} roll />)
    advance(ROLL_MS / 2)

    // Mid-roll: the moving digits are hidden; the final value is read.
    const moving = screen.getByText(/^4\d$/)
    expect(moving).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('50')).toHaveClass('sr-only')

    advance(ROLL_MS)

    expect(screen.getByText('50')).not.toHaveClass('sr-only')
    expect(screen.queryByText(/^4\d$/)).toBeNull()
  })

  it('jumps straight to the new value under reduced motion', () => {
    reduce = true
    const { rerender } = render(<Stat label="Admitted" value={40} roll />)

    rerender(<Stat label="Admitted" value={50} roll />)

    expect(frames).toHaveLength(0)
    expect(screen.getByText('50')).not.toHaveClass('sr-only')
  })

  it('jumps unless asked to roll', () => {
    const { rerender } = render(<Stat label="Admitted" value={40} />)

    rerender(<Stat label="Admitted" value={50} />)

    expect(frames).toHaveLength(0)
    expect(screen.getByText('50')).toBeInTheDocument()
  })
})
