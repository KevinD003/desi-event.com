import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VisuallyHidden } from './VisuallyHidden.jsx'

describe('VisuallyHidden', () => {
  it('keeps its content in the accessibility tree', () => {
    render(
      <button type="button">
        <span aria-hidden="true">×</span>
        <VisuallyHidden>Remove ticket</VisuallyHidden>
      </button>,
    )

    // The icon alone would leave the button nameless.
    expect(screen.getByRole('button')).toHaveAccessibleName('Remove ticket')
  })

  it('clips rather than hiding, so the text is never removed from the tree', () => {
    render(<VisuallyHidden data-testid="skip">Skip to content</VisuallyHidden>)

    const element = screen.getByTestId('skip')
    expect(element).toHaveClass('sr-only')
    expect(element).not.toHaveClass('hidden')
    expect(element).toBeInTheDocument()
    expect(screen.getByText('Skip to content')).toBe(element)
  })

  it('can reveal itself on focus for skip links', () => {
    render(
      <VisuallyHidden as="a" href="#main" focusable data-testid="skip-link">
        Skip to content
      </VisuallyHidden>,
    )

    const link = screen.getByRole('link', { name: 'Skip to content' })
    expect(link).toHaveClass('sr-only', 'focus:not-sr-only')
  })

  it('renders the element the caller asks for', () => {
    render(<VisuallyHidden as="h2">Ticket options</VisuallyHidden>)

    expect(screen.getByRole('heading', { level: 2, name: 'Ticket options' })).toBeInTheDocument()
  })
})
