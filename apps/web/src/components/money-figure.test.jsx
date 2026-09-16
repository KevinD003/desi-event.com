import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AgingBadge, Figure, ModeBanner } from './money-figure.jsx'

describe('ModeBanner', () => {
  it('says a mock figure is a demonstration, as a status rather than an alert', () => {
    render(<ModeBanner mode="MOCK" notice="DEMO — no money moved." />)

    const banner = screen.getByRole('status')

    // A standing condition, not something that just happened. `role="alert"`
    // would interrupt a screen reader on every page load for a fact that is
    // true all the time.
    expect(banner).toHaveTextContent('Demonstration data')
    expect(banner).toHaveTextContent('no money moved')
  })

  it('distinguishes the sandbox from the mock', () => {
    render(<ModeBanner mode="STRIPE_TEST" notice="SANDBOX — test mode." />)

    expect(screen.getByRole('status')).toHaveTextContent('Sandbox data')
  })
})

describe('Figure', () => {
  it('renders an amount in its own currency', () => {
    render(
      <dl>
        <Figure label="Owed to organisers" cents={1_234_500} currency="INR" />
      </dl>,
    )

    expect(screen.getByText('Owed to organisers')).toBeInTheDocument()
    // Formatted rather than printed: 1234500 minor units is not what a finance
    // person reads, and a screen that shows the raw integer invites arithmetic.
    expect(screen.getByText(/12,345/)).toBeInTheDocument()
  })

  it('shows a hint when one explains the number', () => {
    render(
      <dl>
        <Figure label="Tax payable" cents={100} hint="Collected on an authority’s behalf." />
      </dl>,
    )

    expect(screen.getByText(/authority/)).toBeInTheDocument()
  })
})

describe('AgingBadge', () => {
  it.each([
    ['FRESH', 'Fresh'],
    ['AGING', 'Ageing'],
    ['OVERDUE', 'Overdue'],
  ])('reads %s as a word and not only as a colour', (band, reading) => {
    render(<AgingBadge band={band} hours={12} />)

    // WCAG 1.4.1: a badge that differs only by colour tells a colour-blind
    // reader nothing.
    expect(screen.getByText(new RegExp(reading))).toBeInTheDocument()
  })

  it('says how long the item has been open', () => {
    render(<AgingBadge band="OVERDUE" hours={96} />)

    expect(screen.getByText(/96/)).toBeInTheDocument()
    expect(screen.getByTitle('hours')).toBeInTheDocument()
  })
})
