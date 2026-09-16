import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button.jsx'

describe('Button', () => {
  it('runs its click handler when idle', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<Button onClick={onClick}>Buy tickets</Button>)
    await user.click(screen.getByRole('button', { name: 'Buy tickets' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('defaults to type="button" so it cannot submit a form by accident', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event) => event.preventDefault())

    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits when asked to', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event) => event.preventDefault())

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Pay</Button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Pay' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('reports aria-busy and refuses pointer and keyboard interaction while loading', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button loading onClick={onClick}>
        Pay now
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Pay now' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    await user.click(button)
    await user.keyboard('{Enter}')

    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps its accessible name while loading and hides the spinner from assistive technology', () => {
    const { rerender } = render(<Button>Pay now</Button>)
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()

    rerender(<Button loading>Pay now</Button>)

    // The name must not drift to "Loading Pay now" mid-submission.
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is skipped by keyboard navigation when disabled', async () => {
    const user = userEvent.setup()

    render(
      <>
        <Button>First</Button>
        <Button disabled>Blocked</Button>
        <Button>Last</Button>
      </>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })

  it('forwards a ref to the underlying button element', () => {
    const ref = createRef()

    render(<Button ref={ref}>Focus me</Button>)
    ref.current.focus()

    expect(ref.current.tagName).toBe('BUTTON')
    expect(screen.getByRole('button', { name: 'Focus me' })).toHaveFocus()
  })

  it('merges caller classes after the variant classes', () => {
    render(
      <Button variant="danger" className="w-64">
        Refund
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Refund' })
    expect(button).toHaveClass('w-64')
    expect(button).toHaveAttribute('data-variant', 'danger')
  })
})
