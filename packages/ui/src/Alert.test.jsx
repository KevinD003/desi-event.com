import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Alert } from './Alert.jsx'

describe('Alert', () => {
  it('interrupts the screen reader for failures', () => {
    render(<Alert variant="error">Your card was declined.</Alert>)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Your card was declined.')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })

  it('interrupts for warnings too', () => {
    render(<Alert variant="warning">Only three tickets left.</Alert>)

    expect(screen.getByRole('alert')).toHaveTextContent('Only three tickets left.')
  })

  it('stays polite for routine confirmations', () => {
    render(<Alert variant="success">Order confirmed.</Alert>)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is polite by default', () => {
    render(<Alert>Doors open at 19:00.</Alert>)

    expect(screen.getByRole('status')).toHaveTextContent('Doors open at 19:00.')
  })

  it('renders a title above the message', () => {
    render(
      <Alert variant="error" title="Payment failed">
        Try another card.
      </Alert>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Payment failed')
    expect(alert).toHaveTextContent('Try another card.')
  })

  it('offers no close button unless it can do something with the click', () => {
    render(<Alert>Nothing to dismiss.</Alert>)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gives the close button a real name and calls back when it is used', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    render(
      <Alert variant="info" onDismiss={onDismiss} dismissLabel="Dismiss venue notice">
        The venue has changed.
      </Alert>,
    )

    const close = screen.getByRole('button', { name: 'Dismiss venue notice' })

    // Reachable by keyboard, not only by mouse.
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
