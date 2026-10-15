import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { RichTextField, applyFormat } from './rich-text-field.jsx'

/**
 * The field with its own state, as the editor holds it.
 *
 * @param {object} props Component props.
 * @param {string} [props.initial] The starting text.
 * @returns {JSX.Element} The field.
 */
function Harness({ initial = '' }) {
  const [text, setText] = useState(initial)

  return (
    <RichTextField label="Description" id="event-description" value={text} onChange={setText} />
  )
}

describe('applying a format to the selection', () => {
  it('wraps the selection in bold or italic marks and keeps it selected', () => {
    expect(applyFormat('A big night', 2, 5, 'bold')).toEqual({
      value: 'A **big** night',
      start: 4,
      end: 7,
    })
    expect(applyFormat('A big night', 2, 5, 'italic').value).toBe('A *big* night')
  })

  it('makes every selected line a list item, once', () => {
    expect(applyFormat('Chai\n- Samosas\nJalebi', 0, 20, 'list').value).toBe(
      '- Chai\n- Samosas\n- Jalebi',
    )
  })

  it('turns the selection into a link label and selects the address to type', () => {
    const next = applyFormat('See the map', 8, 11, 'link')

    expect(next.value).toBe('See the [map](https://)')
    expect(next.value.slice(next.start, next.end)).toBe('https://')
  })
})

describe('the field', () => {
  it('counts characters against the limit and says when it is too long', async () => {
    const user = userEvent.setup()

    render(
      <RichTextField
        label="Description"
        id="d"
        value={'x'.repeat(21)}
        max={20}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('21 of 20 characters')).toBeInTheDocument()
    expect(screen.getByText('That is 1 characters too long.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('button', { name: 'Back to editing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('previews the text the way the public page renders it, with no HTML', async () => {
    const user = userEvent.setup()

    render(<Harness initial={'A **big** night <script>x</script>'} />)

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    const preview = screen.getByRole('region', { name: 'Preview of the description' })

    expect(preview.querySelector('strong')).toHaveTextContent('big')
    expect(preview.querySelector('script')).toBeNull()
    expect(preview).toHaveTextContent('<script>x</script>')
  })

  it('has a toolbar of real buttons that keep focus in the box', async () => {
    const user = userEvent.setup()

    render(<Harness initial="night" />)

    const box = screen.getByLabelText(/^Description/)

    box.focus()
    box.setSelectionRange(0, 5)
    await user.click(screen.getByRole('button', { name: 'Bold' }))

    expect(box).toHaveValue('**night**')
    expect(screen.getByRole('toolbar', { name: 'Formatting for description' })).toBeInTheDocument()
  })
})
