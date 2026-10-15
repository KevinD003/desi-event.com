/**
 * Choosing events for a referral code (SPEC3 §12.5): a search over every
 * organisation's events, deleted ones left out; "Add" buttons; removable chips
 * of 24 px targets that put focus back in the search; a polite region that
 * says what happened once; Enter that searches without submitting the form
 * around it; and the most a code can name.
 *
 * @module app/admin/referral-codes/referral-event-picker.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { EventFilterField, ReferralEventPicker } = await import('./referral-event-picker.jsx')

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status < 300, status, headers: new Headers(), json: async () => body }
}

/**
 * The picker with its own state, inside a form that records a submit.
 *
 * @param {object} props Component props.
 * @param {Function} props.onSubmit Called when the form is submitted.
 * @param {number} [props.max] The most events.
 * @returns {JSX.Element} The harness.
 */
function Harness({ onSubmit, max = 50 }) {
  const [selected, setSelected] = useState([])

  return (
    <form
      onSubmit={(submitted) => {
        submitted.preventDefault()
        onSubmit()
      }}
    >
      <ReferralEventPicker selected={selected} onChange={setSelected} max={max} />
    </form>
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue(
    answer(200, {
      data: [
        { id: 'cevent0000000000000000001', title: 'Diwali Mela' },
        { id: 'cevent0000000000000000002', title: 'Navratri Night' },
      ],
    }),
  )
})

describe('ReferralEventPicker', () => {
  it('searches on Enter without submitting the form, leaving deleted events out', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<Harness onSubmit={onSubmit} />)

    await user.type(screen.getByRole('searchbox', { name: 'Find an event' }), 'diwali{Enter}')

    expect(await screen.findByRole('list', { name: 'Events found' })).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledWith('/v1/platform/events', {
      query: { q: 'diwali', perPage: 20, deleted: 'exclude' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('2 events found.')
  })

  it('adds an event as a chip, and removing it puts focus back in the search', async () => {
    const user = userEvent.setup()

    render(<Harness onSubmit={vi.fn()} />)

    await user.type(screen.getByRole('searchbox', { name: 'Find an event' }), 'night')
    await user.click(screen.getByRole('button', { name: 'Search events' }))
    await user.click(await screen.findByRole('button', { name: 'Add Diwali Mela' }))

    expect(screen.getByRole('list', { name: 'Chosen events' })).toHaveTextContent('Diwali Mela')
    expect(screen.getByRole('button', { name: 'Added Diwali Mela' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Added Diwali Mela.')

    const remove = screen.getByRole('button', { name: 'Remove Diwali Mela' })

    expect(remove).toHaveClass('min-h-6', 'min-w-6')
    await user.click(remove)

    expect(screen.queryByRole('list', { name: 'Chosen events' })).toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Find an event' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Removed Diwali Mela.')
  })

  it('stops adding at the most a code can name, and says so', async () => {
    const user = userEvent.setup()

    render(<Harness onSubmit={vi.fn()} max={1} />)

    await user.type(screen.getByRole('searchbox', { name: 'Find an event' }), 'night')
    await user.click(screen.getByRole('button', { name: 'Search events' }))
    await user.click(await screen.findByRole('button', { name: 'Add Diwali Mela' }))

    expect(screen.getByRole('button', { name: 'Add Navratri Night' })).toBeDisabled()
    expect(screen.getByText('1 event is chosen, the most a code can name.')).toBeInTheDocument()
  })

  it('says when nothing matches, and gives the API’s sentence when the search is refused', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: [] }))
    render(<Harness onSubmit={vi.fn()} />)

    await user.type(screen.getByRole('searchbox', { name: 'Find an event' }), 'zzz{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No event matches.'))

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'FORBIDDEN', message: 'You cannot list every event.' } }),
    )
    await user.click(screen.getByRole('button', { name: 'Search events' }))

    expect(await screen.findByText('You cannot list every event.')).toBeInTheDocument()
  })
})

describe('EventFilterField', () => {
  it('carries the chosen event to a GET form as eventId, one at a time', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <EventFilterField initial={{ id: 'cevent0000000000000000009', title: 'Old night' }} />
      </form>,
    )

    expect(container.querySelector('input[type="hidden"][name="eventId"]')).toHaveValue(
      'cevent0000000000000000009',
    )

    await user.type(screen.getByRole('searchbox', { name: 'Event' }), 'diwali{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Add Diwali Mela' }))

    const hidden = container.querySelectorAll('input[type="hidden"][name="eventId"]')

    expect(hidden).toHaveLength(1)
    expect(hidden[0]).toHaveValue('cevent0000000000000000001')
  })
})
