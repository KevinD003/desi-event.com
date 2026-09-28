import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { RepeatableList } from './repeatable-list.jsx'
import { Input } from './ui.jsx'

/**
 * A list of questions with its own state.
 *
 * @param {object} props Component props.
 * @param {object[]} props.initial The starting rows.
 * @param {number} [props.max] The most rows.
 * @returns {JSX.Element} The list.
 */
function Questions({ initial, max = 30 }) {
  const [rows, setRows] = useState(initial)

  return (
    <RepeatableList
      noun="question"
      title="Questions people ask"
      idPrefix="event-faq"
      rows={rows}
      onChange={setRows}
      blank={() => ({ question: '' })}
      max={max}
      renderRow={(row, index, update) => (
        <Input
          aria-label={`Question ${index + 1} text`}
          value={row.question}
          onChange={(change) => update({ question: change.target.value })}
        />
      )}
    />
  )
}

describe('a repeatable list', () => {
  it('names the row every button acts on', () => {
    render(<Questions initial={[{ question: 'Parking?' }, { question: 'Food?' }]} />)

    expect(screen.getByRole('button', { name: 'Remove question 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move question 2 down' })).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Question 1' })).toBeInTheDocument()
  })

  it('moves a row, says so politely, and keeps focus on it', async () => {
    const user = userEvent.setup()

    render(<Questions initial={[{ question: 'Parking?' }, { question: 'Food?' }]} />)

    await user.click(screen.getByRole('button', { name: 'Move question 2 up' }))

    expect(screen.getByLabelText('Question 1 text')).toHaveValue('Food?')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Question 2 moved up; it is now question 1.',
    )
    expect(screen.getByLabelText('Question 1 text')).toHaveFocus()
  })

  it('adds a row and puts focus in it, and removes one', async () => {
    const user = userEvent.setup()

    render(<Questions initial={[{ question: 'Parking?' }]} />)

    await user.click(screen.getByRole('button', { name: 'Add a question' }))
    expect(screen.getByLabelText('Question 2 text')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Remove question 1' }))
    expect(screen.getByLabelText('Question 1 text')).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Question 1 removed.')
  })

  it('says it is full instead of offering an Add that does nothing', () => {
    render(<Questions initial={[{ question: 'A' }, { question: 'B' }]} max={2} />)

    expect(screen.queryByRole('button', { name: 'Add a question' })).not.toBeInTheDocument()
    expect(screen.getByText(/That is the most this list takes \(2\)/)).toBeInTheDocument()
  })
})
