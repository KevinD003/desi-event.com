import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
}))

const { loadEventBySlug } = await import('../../../../lib/api.js')
const { default: CheckoutPage, generateMetadata } = await import('./page.jsx')

const missing = { params: Promise.resolve({ slug: 'no-such-event-at-all' }) }

describe('the checkout page when the event is missing', () => {
  beforeEach(() => {
    loadEventBySlug.mockReset()
    loadEventBySlug.mockResolvedValue({ event: null, usedFallback: false })
  })

  it('renders the not-found view rather than an empty page', async () => {
    render(await CheckoutPage(missing))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not on the bill/i)
  })

  it('offers no basket, no quantities and no way to pay', async () => {
    render(await CheckoutPage(missing))

    expect(screen.queryByRole('button', { name: /pay|checkout|place order/i })).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('stays out of the index', async () => {
    const metadata = await generateMetadata(missing)

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
