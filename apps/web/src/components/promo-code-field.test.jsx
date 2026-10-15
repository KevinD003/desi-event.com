import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PromoCodeField } from './promo-code-field.jsx'

/**
 * Render the field.
 *
 * @param {object} [props] Props overriding the defaults.
 * @returns {{user: object, onApply: Function, onRemove: Function}} The session and the callbacks.
 */
function renderField(props = {}) {
  const onApply = vi.fn(async () => undefined)
  const onRemove = vi.fn()

  render(
    <PromoCodeField promo={null} currency="USD" onApply={onApply} onRemove={onRemove} {...props} />,
  )

  return { user: userEvent.setup(), onApply, onRemove }
}

describe('the promo code box', () => {
  it('has a visible label, and sends the code trimmed and upper-cased', async () => {
    const { user, onApply } = renderField()
    const input = screen.getByLabelText('Promo code')

    expect(input).toHaveAttribute('maxLength', '32')
    expect(input).toHaveAttribute('autoComplete', 'off')

    await user.type(input, '  save10 ')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('SAVE10')
  })

  it('refuses a code of the wrong shape without asking the server', async () => {
    const { user, onApply } = renderField()

    await user.type(screen.getByLabelText('Promo code'), 'no!')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'A code is 3 to 32 letters, numbers, hyphens or underscores. Check it and try again.',
    )
  })

  it('says what an applied code does, politely, and offers to remove it', async () => {
    const { user, onRemove } = renderField({
      promo: { code: 'SAVE10', applied: true, reason: null, percentBps: 1000, amountCents: null },
    })

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent('SAVE10 applied: 10% off.')
    expect(screen.getByLabelText('Promo code')).toHaveValue('SAVE10')
    expect(screen.getByLabelText('Promo code')).toHaveAttribute('readOnly')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('says why a code gave nothing, in words a buyer can act on', () => {
    renderField({ promo: { code: 'NOPE', applied: false, reason: 'UNKNOWN' } })

    expect(screen.getByRole('status')).toHaveTextContent('That code is not valid for this event.')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('says a code kept before reserving is checked again then, and promises nothing', () => {
    renderField({ promo: { code: 'SAVE10', applied: true, pending: true } })

    expect(screen.getByRole('status')).toHaveTextContent(
      'SAVE10 is checked again when you reserve your tickets.',
    )
  })

  it('says a code nobody has checked is checked on reserving, and that the total leaves it out', () => {
    renderField({
      promo: { code: 'SAVE10', applied: false, pending: true, unchecked: true },
      reserveNoun: 'seats',
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'SAVE10 is checked when you reserve your seats. Until then the total above does not include it.',
    )
    expect(screen.getByRole('status')).not.toHaveTextContent('again')
    // Chosen, so it can be taken back; never shown as having taken.
    expect(screen.getByLabelText('Promo code')).toHaveValue('SAVE10')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveClass('text-status-success')
  })

  it('shows only the reason when a code cannot be used here', () => {
    renderField({ disabledReason: 'You can use a promo code after signing in.' })

    expect(screen.getByText('You can use a promo code after signing in.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Promo code')).toBeNull()
  })

  it('cannot be used while the order is being placed', () => {
    renderField({ disabled: true })

    expect(screen.getByLabelText('Promo code')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
})
