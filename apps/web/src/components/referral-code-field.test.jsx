/**
 * The referral code box (SPEC3 §12.1): every state says the specification's
 * sentence in one polite region, focus goes back to the box when a code is
 * refused or removed, the buttons are told apart from the promo code's, and the
 * code is never written to browser storage.
 *
 * @module components/referral-code-field.test
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  REFERRAL_ENTRY_MAX_LENGTH,
  REFERRAL_FIELD_COPY,
  ReferralCodeField,
  waitingCopy,
} from './referral-code-field.jsx'

let setItem

beforeEach(() => {
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  setItem.mockRestore()
})

/**
 * The box's polite status region.
 *
 * @returns {HTMLElement} The region.
 */
function status() {
  return screen.getByRole('status')
}

describe('ReferralCodeField', () => {
  it('labels the box, describes it, and keeps it out of autofill and spelling', () => {
    render(<ReferralCodeField referral={null} onApply={() => {}} onRemove={() => {}} />)

    const box = screen.getByRole('textbox', { name: REFERRAL_FIELD_COPY.label })

    expect(box).toHaveAttribute('autocomplete', 'off')
    expect(box).toHaveAttribute('spellcheck', 'false')
    expect(box).toHaveAttribute('autocapitalize', 'characters')
    expect(box).toHaveAttribute('maxlength', String(REFERRAL_ENTRY_MAX_LENGTH))
    expect(box).toHaveAccessibleDescription(REFERRAL_FIELD_COPY.hint)
    expect(status()).toHaveAttribute('aria-live', 'polite')
    expect(status()).toHaveTextContent('')
  })

  it('sends what was typed when Apply is pressed, named apart from the promo code’s button', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()

    render(<ReferralCodeField referral={null} onApply={onApply} onRemove={() => {}} />)

    const apply = screen.getByRole('button', { name: 'Apply referral code' })

    expect(apply).toBeDisabled()
    await user.type(screen.getByRole('textbox'), '  partner-2026 ')
    await user.click(apply)

    expect(onApply).toHaveBeenCalledWith('partner-2026')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('says a code waits to be checked, before reserving and after', () => {
    const { rerender } = render(
      <ReferralCodeField
        referral={{ status: 'unchecked', code: 'PARTNER-2026' }}
        onApply={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(status()).toHaveTextContent(waitingCopy('unchecked'))
    expect(waitingCopy('unchecked')).toBe(
      'Your referral code is checked when you reserve your tickets. Until then the total above includes the booking fee.',
    )

    rerender(
      <ReferralCodeField
        referral={{ status: 'pending', code: 'PARTNER-2026' }}
        onApply={() => {}}
        onRemove={() => {}}
        reserveNoun="seats"
      />,
    )
    expect(status()).toHaveTextContent(
      'Your referral code is checked again when you reserve your seats.',
    )
  })

  it('says a code is applied, offers Remove, and puts focus in the emptied box after it', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const { rerender } = render(
      <ReferralCodeField
        referral={{ status: 'applied', code: 'PARTNER-2026' }}
        onApply={() => {}}
        onRemove={onRemove}
      />,
    )

    expect(status()).toHaveTextContent(REFERRAL_FIELD_COPY.applied)
    expect(screen.getByRole('textbox')).toHaveValue('PARTNER-2026')
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')

    await user.click(screen.getByRole('button', { name: 'Remove referral code' }))
    expect(onRemove).toHaveBeenCalledTimes(1)

    rerender(<ReferralCodeField referral={null} onApply={() => {}} onRemove={onRemove} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('says one sentence for every code it does not accept, and puts focus back in the box', () => {
    const { rerender } = render(
      <ReferralCodeField
        referral={{ status: 'pending', code: 'NOPE-1234' }}
        onApply={() => {}}
        onRemove={() => {}}
      />,
    )

    rerender(
      <ReferralCodeField
        referral={{ status: 'NOT_ACCEPTED' }}
        onApply={() => {}}
        onRemove={() => {}}
      />,
    )

    const box = screen.getByRole('textbox')

    expect(status()).toHaveTextContent('This referral code can’t be used for this booking.')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveFocus()
    expect(box).toHaveAccessibleDescription(
      `${REFERRAL_FIELD_COPY.hint} ${REFERRAL_FIELD_COPY.notAccepted}`,
    )
  })

  it('says when there is no fee to remove, and when too many codes were tried', () => {
    const { rerender } = render(
      <ReferralCodeField
        referral={{ status: 'NOTHING_TO_WAIVE' }}
        onApply={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(status()).toHaveTextContent(
      'There’s no booking fee on this booking, so no referral code is needed.',
    )

    rerender(
      <ReferralCodeField
        referral={{ status: 'rate-limited' }}
        onApply={() => {}}
        onRemove={() => {}}
      />,
    )
    expect(status()).toHaveTextContent(
      'Too many referral codes were tried. Wait a few minutes, then try again.',
    )
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('is disabled for a signed-out buyer, and says why', () => {
    render(<ReferralCodeField referral={null} onApply={() => {}} onRemove={() => {}} signedOut />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(status()).toHaveTextContent('You can use a referral code after signing in.')
  })
})
