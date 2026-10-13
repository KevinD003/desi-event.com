/**
 * The choice between paying by card now and paying at the venue (SPEC3 §12.1,
 * SPEC3-XI §12.1): a fieldset with its legend, two radios each described by
 * its hint, and the hint naming the place's tax as a sentence does.
 *
 * @module components/payment-method-choice.test
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  CARD_HINT,
  PAYMENT_CHOICE_LEGEND,
  PaymentMethodChoice,
  venueHint,
} from './payment-method-choice.jsx'

describe('PaymentMethodChoice', () => {
  it('groups two radios under the legend, each described by its hint', () => {
    render(<PaymentMethodChoice value="CARD" onChange={() => {}} place={{ country: 'US' }} />)

    const group = screen.getByRole('group', { name: PAYMENT_CHOICE_LEGEND })
    const card = screen.getByRole('radio', { name: 'Pay by card now' })
    const venue = screen.getByRole('radio', { name: 'Pay at the venue' })

    expect(group).toContainElement(card)
    expect(card).toBeChecked()
    expect(venue).not.toBeChecked()
    expect(card).toHaveAccessibleDescription(CARD_HINT)
    expect(venue).toHaveAccessibleDescription(venueHint({ country: 'US' }))
  })

  it('says the pay-at-the-venue hint exactly, with the tax named as a sentence names it', () => {
    expect(venueHint({ country: 'US', region: 'TX' })).toBe(
      'Pay the booking fee now (simulated) and the ticket price at the door. No sales tax is added to tickets paid at the venue. Until a ticket is paid for, the organiser or Desi-Event can cancel it, and the booking fee is not refunded if they do. If you pass a ticket on, whoever holds it pays at the door.',
    )
    expect(venueHint({ country: 'CA', region: 'ON' })).toContain(
      'No HST is added to tickets paid at the venue.',
    )
    expect(venueHint({})).toContain('No tax is added to tickets paid at the venue.')
    // The rule that tickets paid at the venue cannot be passed on is gone (SPEC3-XI §12.1).
    expect(venueHint({ country: 'US' })).not.toContain('can’t be passed on')
    expect(venueHint({ country: 'US' })).not.toContain("can't be passed on")
  })

  it('reports the way chosen, and takes no choice while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<PaymentMethodChoice value="CARD" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Pay at the venue' }))
    expect(onChange).toHaveBeenCalledWith('AT_VENUE')

    rerender(<PaymentMethodChoice value="AT_VENUE" onChange={onChange} disabled />)
    expect(screen.getByRole('radio', { name: 'Pay by card now' })).toBeDisabled()
  })

  it('gives each radio a 24 px target', () => {
    render(<PaymentMethodChoice value="CARD" onChange={() => {}} />)

    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('size-6')
  })
})
