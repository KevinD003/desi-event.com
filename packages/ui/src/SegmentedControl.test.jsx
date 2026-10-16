import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SegmentedControl } from './SegmentedControl.jsx'

const OPTIONS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'drafts', label: 'Drafts', disabled: true },
]

describe('SegmentedControl', () => {
  it('is a group of native radios named by its legend', () => {
    render(<SegmentedControl label="Which events" options={OPTIONS} />)

    expect(screen.getByRole('group', { name: 'Which events' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Upcoming' })).toBeChecked()
  })

  it('moves the choice with the arrow keys, as radios do, and reports it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SegmentedControl label="Which events" options={OPTIONS} onChange={onChange} />)

    await user.tab()
    expect(screen.getByRole('radio', { name: 'Upcoming' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: 'Past' })).toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith('past', expect.anything())
  })

  it('submits with a form, under its name', () => {
    const { container } = render(
      <form>
        <SegmentedControl label="View" name="view" options={OPTIONS} defaultValue="past" />
      </form>,
    )

    expect(new FormData(container.querySelector('form')).get('view')).toBe('past')
  })

  it('follows a controlled value', () => {
    const { rerender } = render(
      <SegmentedControl label="View" options={OPTIONS} value="upcoming" onChange={() => {}} />,
    )

    rerender(<SegmentedControl label="View" options={OPTIONS} value="past" onChange={() => {}} />)

    expect(screen.getByRole('radio', { name: 'Past' })).toBeChecked()
  })

  it('cannot choose a disabled segment', () => {
    render(<SegmentedControl label="View" options={OPTIONS} />)

    expect(screen.getByRole('radio', { name: 'Drafts' })).toBeDisabled()
  })

  it('draws the focus outline on the segment whose radio has keyboard focus, at 44px', () => {
    render(<SegmentedControl label="View" options={OPTIONS} />)

    const segment = screen.getByRole('radio', { name: 'Past' }).closest('label')

    expect(segment).toHaveClass(
      'min-h-11',
      'has-[:focus-visible]:outline-2',
      'has-[:focus-visible]:outline-focus',
    )
  })
})
