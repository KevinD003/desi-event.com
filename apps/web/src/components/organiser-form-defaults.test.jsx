/**
 * The defaults the organiser forms start from.
 *
 * The catalogue is American, so a new ticket type starts in US dollars and a
 * new venue in the US. These are starting points rather than limits — every
 * other currency and country is still one choice away — and the tests say both
 * halves of that.
 *
 * @module components/organiser-form-defaults.test
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { EventTiersEditor } = await import('./event-tiers-editor.jsx')
const { VenueForm } = await import('./venue-form.jsx')

describe('a new ticket type', () => {
  it('is priced in US dollars unless the organiser says otherwise', () => {
    render(<EventTiersEditor event={{ id: 'evtdefaults', ticketTypes: [] }} />)

    const currency = screen.getByLabelText(/^Currency/)
    const offered = [...currency.querySelectorAll('option')].map((option) => option.value)

    expect(currency).toHaveValue('USD')
    expect(offered[0]).toBe('USD')
    // Still multi-currency: rupees, pounds and the rest are on the list.
    expect(offered).toEqual(expect.arrayContaining(['INR', 'GBP', 'CAD', 'AUD']))
  })

  it('asks for the face value in cents, with a dollar example', () => {
    render(<EventTiersEditor event={{ id: 'evtdefaults', ticketTypes: [] }} />)

    expect(screen.getByLabelText(/^Face value, in cents/)).toBeInTheDocument()
    expect(screen.getByText(/\$35\.00 is 3500/)).toBeInTheDocument()
  })
})

describe('a new venue', () => {
  it('starts in the US, and the country can still be changed', () => {
    render(<VenueForm organizations={[]} />)

    const country = screen.getByLabelText(/^Country/)

    expect(country).toHaveValue('US')
    expect(country).not.toBeDisabled()
  })
})
