/**
 * A step-up for seeing something.
 *
 * The properties worth pinning: it explains before it asks; the prompt opens
 * only when the person chooses; a confirmed step-up redraws the page from the
 * server instead of showing anything this component held; and two of them on
 * one page do not share a heading id.
 *
 * @module components/step-up-for-read.test
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

const { StepUpForRead } = await import('./step-up-for-read.jsx')

beforeEach(() => {
  refresh.mockReset()
  apiFetch.mockReset()
})

afterEach(cleanup)

describe('StepUpForRead', () => {
  it('explains what is waiting before asking for anything', () => {
    render(<StepUpForRead action="see this refund" />)

    expect(screen.getByRole('region', { name: 'Confirm it is you' })).toBeTruthy()
    expect(screen.getByText(/Confirm to see this refund\./)).toBeTruthy()
    expect(screen.queryByLabelText(/your password/i)).toBeNull()
  })

  it('redraws the page from the server once the step-up is accepted', async () => {
    apiFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))

    render(<StepUpForRead action="see this refund" />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText(/code from your authenticator/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/auth/step-up')
  })

  it('sends a privileged account with no second factor to set one up', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'MFA_ENROLMENT_REQUIRED',
            message: 'Enrol one at /v1/auth/mfa/totp before performing sensitive actions.',
          },
        }),
        { status: 401 },
      ),
    )

    const { container } = render(<StepUpForRead action="see this refund" />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    const link = await screen.findByRole('link', { name: 'Set up two-step sign-in' })

    expect(link.getAttribute('href')).toBe('/account/security')
    // The endpoint the API named is not shown to a person.
    expect(container.textContent).not.toContain('/v1/')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('gives each instance its own heading', () => {
    render(
      <>
        <StepUpForRead action="see this refund" />
        <StepUpForRead action="see this queue" />
      </>,
    )

    const ids = screen.getAllByRole('heading', { name: 'Confirm it is you' }).map((h) => h.id)

    expect(new Set(ids).size).toBe(2)
  })
})
