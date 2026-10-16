import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { Toaster, toast } from './Toast.jsx'

describe('Toaster and toast', () => {
  it('announces politely, never assertively, and never as an alert', async () => {
    const { container } = render(<Toaster />)
    const region = container.querySelector('section')

    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-label', expect.stringMatching(/^Notifications/))
    // Out of the Tab order: it takes focus only when asked for by its shortcut.
    expect(region).toHaveAttribute('tabindex', '-1')

    act(() => {
      toast('Copied', { description: 'The order number is on your clipboard.' })
    })

    expect(await screen.findByText('Copied')).toBeInTheDocument()
    expect(document.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull()
  })

  it('never takes focus from what the reader is doing', async () => {
    render(
      <>
        <button type="button">Copy order number</button>
        <Toaster />
      </>,
    )

    const button = screen.getByRole('button', { name: 'Copy order number' })
    button.focus()

    act(() => {
      toast('Copied')
    })

    await screen.findByText('Copied')
    expect(button).toHaveFocus()
  })

  it('draws the toast in the theme: an ink plate with the floating shadow', async () => {
    render(<Toaster />)

    act(() => {
      toast('Saved')
    })

    const words = await screen.findByText('Saved')
    const plate = words.closest('[data-sonner-toast]')

    expect(plate).toHaveClass('bg-surface-inverse', 'text-ink-inverse', 'shadow-floating')
  })
})
