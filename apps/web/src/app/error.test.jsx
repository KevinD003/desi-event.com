/**
 * The route error boundary: a whole page, with its own header and footer,
 * that says nothing about the error itself and offers a retry.
 *
 * @module app/error.test
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RouteError from './error.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the route error page', () => {
  it('is a whole page: one banner, one main the skip link reaches, one contentinfo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RouteError error={new Error('boom')} reset={() => {}} />)

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(screen.getByRole('main').id).toBe('main-content')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong at our end' }),
    ).toBeTruthy()
  })

  it('shows nothing of the error, and sends it to the console instead', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <RouteError error={new Error('secret internal detail')} reset={() => {}} />,
    )

    expect(container.textContent).not.toContain('secret internal detail')
    expect(logged).toHaveBeenCalled()
    expect(container.textContent).toContain(
      'Nothing has been ordered and you have not been charged.',
    )
    expect(container.textContent).not.toMatch(/—/u)
  })

  it('tries the page again, and leads to the listing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = vi.fn()

    render(<RouteError error={new Error('boom')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'Browse every event' })).toHaveAttribute(
      'href',
      '/events',
    )
  })
})
