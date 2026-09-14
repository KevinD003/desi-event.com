import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { QuantityStepper, clampQuantity } from './quantity-stepper.jsx'

describe('clampQuantity', () => {
  it('treats anything at or below zero as an empty line', () => {
    expect(clampQuantity(0, 1, 8)).toBe(0)
    expect(clampQuantity(-4, 1, 8)).toBe(0)
  })

  it('rejects values that are not numbers at all', () => {
    expect(clampQuantity(Number.NaN, 1, 8)).toBe(0)
    expect(clampQuantity(Number.POSITIVE_INFINITY, 1, 8)).toBe(0)
  })

  it('lifts a below-minimum request up to the tier minimum', () => {
    expect(clampQuantity(1, 2, 8)).toBe(2)
  })

  it('never exceeds what is left', () => {
    expect(clampQuantity(99, 1, 3)).toBe(3)
  })

  it('never exceeds what is left even when the minimum is higher', () => {
    expect(clampQuantity(5, 4, 2)).toBe(2)
  })

  it('returns nothing selectable for a sold-out tier', () => {
    expect(clampQuantity(3, 1, 0)).toBe(0)
  })

  it('floors a fractional request rather than pricing a third of a ticket', () => {
    expect(clampQuantity(2.9, 1, 8)).toBe(2)
  })
})

/**
 * Render a stepper with a spy for its change handler.
 *
 * @param {object} [props] Props overriding the defaults.
 * @returns {{user: object, onChange: Function}} The interaction session and the spy.
 */
function renderStepper(props = {}) {
  const onChange = vi.fn()
  render(
    <QuantityStepper label="Garden Seating" value={0} min={1} max={6} onChange={onChange} {...props} />,
  )

  return { user: userEvent.setup(), onChange }
}

describe('QuantityStepper', () => {
  it('gives the number field an accessible name tied to the tier', () => {
    renderStepper()

    expect(screen.getByLabelText('Quantity of Garden Seating')).toBeInTheDocument()
  })

  it('names its buttons in full, so a screen reader does not just hear "minus"', () => {
    renderStepper()

    expect(screen.getByRole('button', { name: 'Add one Garden Seating' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove one Garden Seating' })).toBeInTheDocument()
  })

  it('jumps from empty straight to the tier minimum', async () => {
    const { user, onChange } = renderStepper({ value: 0, min: 2 })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('increments one at a time above the minimum', async () => {
    const { user, onChange } = renderStepper({ value: 3 })

    await user.click(screen.getByRole('button', { name: 'Add one Garden Seating' }))

    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('clears the line when decrementing below the minimum', async () => {
    const { user, onChange } = renderStepper({ value: 2, min: 2 })

    await user.click(screen.getByRole('button', { name: 'Remove one Garden Seating' }))

    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('cannot go below empty', () => {
    renderStepper({ value: 0 })

    expect(screen.getByRole('button', { name: 'Remove one Garden Seating' })).toBeDisabled()
  })

  it('cannot go above what the tier will sell', () => {
    renderStepper({ value: 6, max: 6 })

    expect(screen.getByRole('button', { name: 'Add one Garden Seating' })).toBeDisabled()
  })

  it('accepts a typed quantity', async () => {
    const { user, onChange } = renderStepper({ value: 0 })

    await user.type(screen.getByLabelText('Quantity of Garden Seating'), '4')

    expect(onChange).toHaveBeenLastCalledWith(4)
  })

  it('clamps a typed quantity that exceeds availability', async () => {
    const { user, onChange } = renderStepper({ value: 0, max: 3 })

    await user.type(screen.getByLabelText('Quantity of Garden Seating'), '9')

    expect(onChange).toHaveBeenLastCalledWith(3)
  })

  it('disables everything for a tier that cannot be bought', () => {
    renderStepper({ disabled: true })

    expect(screen.getByLabelText('Quantity of Garden Seating')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add one Garden Seating' })).toBeDisabled()
  })

  it('points the field at the availability text describing the tier', () => {
    render(
      <QuantityStepper
        label="Lawn Entry"
        value={1}
        min={1}
        max={4}
        describedBy="availability-lawn"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Quantity of Lawn Entry')).toHaveAttribute(
      'aria-describedby',
      'availability-lawn',
    )
  })
})
