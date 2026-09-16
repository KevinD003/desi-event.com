import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner.jsx'

describe('Spinner', () => {
  it('announces its label through a polite live region', () => {
    render(<Spinner label="Loading events" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading events')
  })

  it('announces a generic label by default', () => {
    render(<Spinner />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('hides itself from assistive technology when a parent owns the announcement', () => {
    const { container } = render(<Spinner label={null} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to the default size when handed an unknown token', () => {
    const { container } = render(<Spinner size="enormous" label={null} />)

    expect(container.querySelector('span > span')).toHaveClass('h-5', 'w-5')
  })
})
