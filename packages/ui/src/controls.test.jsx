import { describe, it, expect, vi } from 'vitest'
import { createRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './Input.jsx'
import { Textarea } from './Textarea.jsx'
import { Select } from './Select.jsx'
import { Label } from './Label.jsx'

const CURRENCIES = [
  { value: 'GBP', label: 'Pound sterling' },
  { value: 'INR', label: 'Indian rupee' },
  { value: 'AED', label: 'UAE dirham', disabled: true },
]

describe('Input', () => {
  it('accepts typing and reports each change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <>
        <Label htmlFor="name">Attendee name</Label>
        <Input id="name" onChange={onChange} />
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Attendee name' })
    await user.type(input, 'Ravi')

    expect(input).toHaveValue('Ravi')
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('advertises its invalid state to assistive technology', () => {
    render(<Input aria-label="Email" invalid />)

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('takes the invalid state from a parent field that sets aria-invalid', () => {
    render(<Input aria-label="Email" aria-invalid />)

    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.className).toContain('border-rose-500')
  })

  it('says nothing about validity while the field is fine', () => {
    render(<Input aria-label="Email" />)

    expect(screen.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute('aria-invalid')
  })

  it('refuses input when disabled', async () => {
    const user = userEvent.setup()

    render(<Input aria-label="Email" disabled />)
    const input = screen.getByRole('textbox', { name: 'Email' })

    await user.type(input, 'nope')
    expect(input).toHaveValue('')
  })

  it('forwards its ref so callers can focus it', () => {
    const ref = createRef()

    render(<Input aria-label="Email" ref={ref} />)
    ref.current.focus()

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
  })
})

describe('Textarea', () => {
  it('accepts multi-line text', async () => {
    const user = userEvent.setup()

    render(<Textarea aria-label="Description" />)
    const textarea = screen.getByRole('textbox', { name: 'Description' })

    await user.type(textarea, 'Line one{Enter}Line two')

    expect(textarea).toHaveValue('Line one\nLine two')
    expect(textarea).toHaveAttribute('rows', '4')
  })

  it('advertises its invalid state', () => {
    render(<Textarea aria-label="Description" invalid />)

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Select', () => {
  it('renders options and reports the chosen value', async () => {
    const user = userEvent.setup()

    function CurrencyPicker() {
      const [value, setValue] = useState('GBP')

      return (
        <>
          <Label htmlFor="currency">Currency</Label>
          <Select
            id="currency"
            options={CURRENCIES}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p>Chosen: {value}</p>
        </>
      )
    }

    render(<CurrencyPicker />)

    const select = screen.getByRole('combobox', { name: 'Currency' })
    await user.selectOptions(select, 'INR')

    expect(select).toHaveValue('INR')
    expect(screen.getByText('Chosen: INR')).toBeInTheDocument()
  })

  it('keeps disabled options unselectable', () => {
    render(<Select aria-label="Currency" options={CURRENCIES} />)

    expect(screen.getByRole('option', { name: 'UAE dirham' })).toBeDisabled()
  })

  it('renders a placeholder as the leading option', () => {
    render(<Select aria-label="Currency" options={CURRENCIES} placeholder="Choose a currency" />)

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Choose a currency')
    expect(options[0]).toHaveValue('')
  })

  it('locks the placeholder out once the field is required', () => {
    render(
      <Select aria-label="Currency" options={CURRENCIES} placeholder="Choose a currency" required defaultValue="" />,
    )

    expect(screen.getByRole('option', { name: 'Choose a currency' })).toBeDisabled()
  })

  it('prefers hand-written children over the options prop', () => {
    render(
      <Select aria-label="Currency" options={CURRENCIES}>
        <option value="LKR">Sri Lankan rupee</option>
      </Select>,
    )

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Sri Lankan rupee' })).toBeInTheDocument()
  })
})

describe('Label', () => {
  it('moves focus to its control when clicked', async () => {
    const user = userEvent.setup()

    render(
      <>
        <Label htmlFor="promo">Promo code</Label>
        <Input id="promo" />
      </>,
    )

    await user.click(screen.getByText('Promo code'))

    expect(screen.getByRole('textbox', { name: 'Promo code' })).toHaveFocus()
  })

  it('spells out the required marker for screen readers', () => {
    render(
      <>
        <Label htmlFor="promo" required>
          Promo code
        </Label>
        <Input id="promo" />
      </>,
    )

    expect(screen.getByText('(required)')).toHaveClass('sr-only')
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })
})
