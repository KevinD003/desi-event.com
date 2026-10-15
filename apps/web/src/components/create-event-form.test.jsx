/**
 * Creating a draft event: a refusal is said, and focus is put on it.
 *
 * The refusal is drawn only once the API has answered — after an `await` — and
 * the Create button is disabled while the request is out, so focus has nowhere
 * to stay. These pin that it reaches the refusal rather than the page.
 *
 * @module components/create-event-form.test
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { CreateEventForm } = await import('./create-event-form.jsx')

const ORGANIZATIONS = [{ organizationId: 'org00000000000000000001', name: 'Garba Nights' }]

/**
 * A response as `apiFetch` returns it.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The body.
 * @returns {object} The response.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * Submit the form as it stands.
 *
 * @param {HTMLElement} container The rendered container.
 * @returns {void}
 */
function submit(container) {
  fireEvent.submit(container.querySelector('form'))
}

beforeEach(() => {
  apiFetch.mockReset()
  push.mockReset()
})

describe('the create-event form', () => {
  it('goes to the new draft’s editor when it is created', async () => {
    apiFetch.mockResolvedValue(answer(201, { data: { id: 'evt00000000000000000001' } }))

    const { container } = render(<CreateEventForm organizations={ORGANIZATIONS} />)

    submit(container)

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/organizer/events/evt00000000000000000001'),
    )
  })

  it('moves focus to the refusal, which is drawn only once the answer is in', async () => {
    apiFetch.mockResolvedValue(
      answer(422, {
        error: { code: 'VALIDATION_FAILED', message: 'The event ends before it starts.' },
      }),
    )

    const { container } = render(<CreateEventForm organizations={ORGANIZATIONS} />)

    submit(container)

    const refusal = (await screen.findByText('The event was not created')).closest(
      '[tabindex="-1"]',
    )

    expect(refusal).not.toBeNull()
    await waitFor(() => expect(refusal).toHaveFocus())
    expect(push).not.toHaveBeenCalled()
  })

  it('moves focus to the refusal when the service does not answer', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const { container } = render(<CreateEventForm organizations={ORGANIZATIONS} />)

    submit(container)

    const refusal = (await screen.findByText(/The ticketing service is not responding/u)).closest(
      '[tabindex="-1"]',
    )

    expect(refusal).not.toBeNull()
    await waitFor(() => expect(refusal).toHaveFocus())
  })
})
