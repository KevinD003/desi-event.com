import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Card, CardHeader, CardBody, CardFooter } from './Card.jsx'
import { Badge } from './Badge.jsx'
import { Skeleton } from './Skeleton.jsx'
import { EmptyState } from './EmptyState.jsx'
import { Button } from './Button.jsx'

describe('Card', () => {
  it('renders the element the document outline needs', () => {
    render(
      <ul>
        <Card as="li" data-testid="card">
          <CardHeader as="header">
            <h3>Garba Night</h3>
          </CardHeader>
          <CardBody>Saturday, 12 October</CardBody>
          <CardFooter>
            <Button>Book</Button>
          </CardFooter>
        </Card>
      </ul>,
    )

    expect(screen.getByRole('listitem')).toBe(screen.getByTestId('card'))
    expect(screen.getByRole('heading', { level: 3, name: 'Garba Night' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book' })).toBeInTheDocument()
  })

  it('keeps interactive content operable and merges caller classes', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Card interactive className="mt-4" data-testid="card">
        <CardBody>
          <a href="#tickets" onClick={onClick}>
            Tickets
          </a>
        </CardBody>
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass('mt-4')
    expect(screen.getByTestId('card').className).toContain('focus-within:ring-2')

    await user.click(screen.getByRole('link', { name: 'Tickets' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Badge', () => {
  it('reads the colour out loud when colour is the only cue', () => {
    render(
      <Badge variant="danger" srLabel="Status:">
        Sold out
      </Badge>,
    )

    // "Sold out" alone is ambiguous once the red pill is invisible.
    expect(screen.getByText('Status:')).toHaveClass('sr-only')
    expect(screen.getByText('Sold out').parentElement).toHaveTextContent('Status: Sold out')
  })

  it('falls back to the neutral variant for an unknown token', () => {
    render(
      <Badge variant="fuchsia" data-testid="badge">
        Draft
      </Badge>,
    )

    expect(screen.getByTestId('badge').className).toContain('bg-slate-100')
  })
})

describe('Skeleton', () => {
  it('stays out of the accessibility tree', () => {
    render(<Skeleton data-testid="skeleton" />)

    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders one bar per requested line, the last one short', () => {
    const { container } = render(<Skeleton lines={3} data-testid="skeleton" />)

    const bars = container.querySelectorAll('[data-testid="skeleton"] > span')
    expect(bars).toHaveLength(3)
    expect(bars[2].className).toContain('w-2/3')
  })
})

describe('EmptyState', () => {
  it('is reachable by heading navigation and offers the way out', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <EmptyState
        icon="🎪"
        title="No events yet"
        description="Publish your first event to start selling tickets."
        action={<Button onClick={onClick}>Create an event</Button>}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'No events yet' })).toBeInTheDocument()
    expect(screen.getByText('Publish your first event to start selling tickets.')).toBeInTheDocument()
    expect(screen.getByText('🎪')).toHaveAttribute('aria-hidden', 'true')

    await user.click(screen.getByRole('button', { name: 'Create an event' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('lets the caller pick a heading level that fits the page outline', () => {
    render(<EmptyState title="No orders" headingLevel="h3">Nothing here yet.</EmptyState>)

    expect(screen.getByRole('heading', { level: 3, name: 'No orders' })).toBeInTheDocument()
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })
})
