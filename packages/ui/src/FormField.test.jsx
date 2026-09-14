import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormField } from './FormField.jsx'
import { Input } from './Input.jsx'
import { Textarea } from './Textarea.jsx'
import { Select } from './Select.jsx'
import { Button } from './Button.jsx'

/** A form that only reveals its error once the user submits an empty field. */
function EmailForm() {
  const [error, setError] = useState(null)
  const [value, setValue] = useState('')

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setError(value.includes('@') ? null : 'Enter a valid email address')
      }}
    >
      <FormField label="Email" description="We send your tickets here." error={error} required>
        <Input value={value} onChange={(event) => setValue(event.target.value)} />
      </FormField>
      <Button type="submit">Continue</Button>
    </form>
  )
}

describe('FormField', () => {
  it('ties the label to the control so clicking the label focuses it', async () => {
    const user = userEvent.setup()

    render(
      <FormField label="Display name">
        <Input />
      </FormField>,
    )

    await user.click(screen.getByText('Display name'))
    const input = screen.getByRole('textbox', { name: /display name/i })

    expect(input).toHaveFocus()

    await user.keyboard('Asha')
    expect(input).toHaveValue('Asha')
  })

  it('generates a unique id per field so two fields never collide', () => {
    render(
      <>
        <FormField label="City">
          <Input />
        </FormField>
        <FormField label="Region">
          <Input />
        </FormField>
      </>,
    )

    const city = screen.getByRole('textbox', { name: 'City' })
    const region = screen.getByRole('textbox', { name: 'Region' })

    expect(city.id).toBeTruthy()
    expect(city.id).not.toBe(region.id)
  })

  it('describes the control with its help text', () => {
    render(
      <FormField label="Phone" description="Used only for venue updates.">
        <Input />
      </FormField>,
    )

    expect(screen.getByRole('textbox', { name: 'Phone' })).toHaveAccessibleDescription(
      'Used only for venue updates.',
    )
  })

  it('announces a validation error, points aria-describedby at it, and marks the control invalid', async () => {
    const user = userEvent.setup()

    render(<EmailForm />)

    const input = screen.getByRole('textbox', { name: /email/i })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a valid email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    // The help text stays described alongside the error.
    expect(input).toHaveAccessibleDescription(/We send your tickets here\./)
    expect(input).toHaveAccessibleDescription(/Enter a valid email address/)

    await user.type(input, 'asha@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('marks the control required for assistive technology and names it as required', () => {
    render(
      <FormField label="Full name" required>
        <Input />
      </FormField>,
    )

    const input = screen.getByRole('textbox', { name: /full name/i })
    expect(input).toBeRequired()
    // The asterisk is decorative; the word is what assistive technology reads.
    expect(input).toHaveAccessibleName(/\(required\)/)
  })

  it('preserves an aria-describedby the caller put on the control', () => {
    render(
      <>
        <p id="external-note">Shown on your ticket.</p>
        <FormField label="Attendee" description="One name per ticket.">
          <Input aria-describedby="external-note" />
        </FormField>
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Attendee' })
    expect(input.getAttribute('aria-describedby')).toContain('external-note')
    expect(input).toHaveAccessibleDescription(/Shown on your ticket\./)
    expect(input).toHaveAccessibleDescription(/One name per ticket\./)
  })

  it('wires a textarea and a select the same way', () => {
    render(
      <>
        <FormField label="Description" error="Too short">
          <Textarea />
        </FormField>
        <FormField label="Currency">
          <Select options={[{ value: 'GBP', label: 'Pound sterling' }]} />
        </FormField>
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'Currency' })).not.toHaveAttribute('aria-invalid')
  })

  it('supports a render function for controls it cannot clone', () => {
    const renderControl = vi.fn((controlProps) => <input {...controlProps} />)

    render(
      <FormField label="Promo code" error="Unknown code">
        {renderControl}
      </FormField>,
    )

    const input = screen.getByRole('textbox', { name: 'Promo code' })
    expect(renderControl).toHaveBeenCalledTimes(1)
    expect(renderControl.mock.calls[0][0]).toMatchObject({ id: input.id, 'aria-invalid': true })
  })

  it('rejects children that are neither an element nor a render function', () => {
    expect(() => render(<FormField label="Broken">just a string</FormField>)).toThrow(TypeError)
  })
})
