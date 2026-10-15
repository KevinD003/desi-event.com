import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { TimeZoneSelect } from './time-zone-select.jsx'

describe('TimeZoneSelect', () => {
  it('offers the common zones, then every other zone once mounted', async () => {
    render(<TimeZoneSelect aria-label="Time zone" value="America/New_York" onChange={vi.fn()} />)

    const select = screen.getByRole('combobox', { name: 'Time zone' })

    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(50))

    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label)

    expect(groups).toEqual(['Common', 'All time zones'])
    expect(select.querySelector('option[value="Asia/Tokyo"]')).not.toBeNull()
    expect(select.querySelector('option[value="America/Los_Angeles"]')).toHaveTextContent(
      'America/Los Angeles',
    )
  })

  it('keeps a stored zone the list does not know', () => {
    render(<TimeZoneSelect aria-label="Time zone" value="Mars/Olympus_Mons" onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Mars/Olympus_Mons')
  })
})
