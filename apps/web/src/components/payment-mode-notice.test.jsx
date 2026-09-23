import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PRODUCTION_PAYMENTS_DISABLED_MESSAGE } from '@desi-event/schemas'

import { PaymentModeNotice } from './payment-mode-notice.jsx'

describe('PaymentModeNotice', () => {
  it('says production payments are disabled, in those words', () => {
    render(<PaymentModeNotice />)

    expect(screen.getByText(PRODUCTION_PAYMENTS_DISABLED_MESSAGE)).toBeInTheDocument()
    expect(document.body).toHaveTextContent('Phase 2 integration required')
  })

  it('tells the buyer what will and will not happen', () => {
    render(<PaymentModeNotice />)

    expect(document.body).toHaveTextContent(/will not be asked for a\s+card/i)
    expect(document.body).toHaveTextContent(/no money moves/i)
    expect(document.body).toHaveTextContent(/a demonstration, not a ticket to a real event/i)
  })

  it('marks what the flow produces as DEMO', () => {
    render(<PaymentModeNotice />)

    expect(document.body).toHaveTextContent('DEMO')
  })

  it('is a labelled region rather than an unannounced block of colour', () => {
    render(<PaymentModeNotice />)

    expect(screen.getByRole('complementary')).toHaveAccessibleName(
      PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
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
