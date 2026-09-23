import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaymentModeNotice } from './payment-mode-notice.jsx'

describe('PaymentModeNotice', () => {
  it('says payments are simulated, in the words the rest of the site uses', () => {
    render(<PaymentModeNotice />)

    expect(screen.getByText('Payments on this site are simulated')).toBeInTheDocument()
    // The deployment's own wording is for operators: a project milestone is
    // not something a buyer can act on.
    expect(document.body).not.toHaveTextContent(/phase 2|integration required/i)
  })

  it('tells the buyer what will and will not happen', () => {
    render(<PaymentModeNotice />)

    expect(document.body).toHaveTextContent(/will not be asked for a\s+card/i)
    expect(document.body).toHaveTextContent(/no money moves/i)
    expect(document.body).toHaveTextContent(/a demonstration, not a ticket to a real event/i)
  })

  it('promises no DEMO stamp that the order and ticket pages do not carry', () => {
    render(<PaymentModeNotice />)

    expect(document.body).not.toHaveTextContent('DEMO')
    expect(document.body).toHaveTextContent(/say the payment was simulated/i)
  })

  it('is a labelled region rather than an unannounced block of colour', () => {
    render(<PaymentModeNotice />)

    expect(screen.getByRole('complementary')).toHaveAccessibleName(
      'Payments on this site are simulated',
    )
  })

  it('offers no choice, because there is none to offer', () => {
    const { container } = render(<PaymentModeNotice />)

    expect(container.querySelectorAll('input, select, button, [role="radio"]')).toHaveLength(0)
  })

  it('animates nothing, so reduced motion has nothing to suppress', () => {
    const { container } = render(<PaymentModeNotice />)

    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0)
  })
})
