/**
 * The page for an address that cannot be read: branded, honest about what
 * happened, never indexed, and showing nothing from the address.
 *
 * @module app/bad-address/page.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import BadAddressPage, { metadata } from './page.jsx'

afterEach(cleanup)

describe('the bad-address page', () => {
  it('says plainly that the address could not be read, under one heading', () => {
    render(<BadAddressPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'That address could not be read' }),
    ).toBeTruthy()
    expect(screen.getByText(/Part of the link looks cut off/u)).toBeTruthy()
  })

  it('leads on to the listing and home', () => {
    render(<BadAddressPage />)

    expect(screen.getByRole('link', { name: 'Browse every event' })).toHaveAttribute(
      'href',
      '/events',
    )
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/')
  })

  it('is never indexed, and has a title of its own', () => {
    expect(metadata.title).toBe('That address could not be read')
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
