/**
 * A refused read is drawn as the state it is, with the way forward.
 *
 * The properties worth pinning: a lapsed step-up is offered the step-up, not a
 * refusal; an account missing a second factor is sent to set one up; a lost
 * session is sent to sign in and brought back to this page; a refusal and a
 * missing item read identically; a rate limit says how long; and none of it
 * repeats the API's message, which names endpoints.
 *
 * @module components/read-refusal.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/finance/refunds/abc',
  useSearchParams: () => new URLSearchParams('x=1'),
}))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { ReadRefusal } = await import('./read-refusal.jsx')

/**
 * An error as `callApi` throws it.
 *
 * @param {object} fields Status, code, message.
 * @returns {Error} The error.
 */
function refused(fields) {
  return Object.assign(new Error(fields.message ?? 'The API answered.'), fields)
}

/**
 * Render the refusal for an error.
 *
 * @param {Error} error The error.
 * @returns {HTMLElement} The container.
 */
function draw(error) {
  const { container } = render(
    <ReadRefusal
      error={error}
      what="This refund"
      action="see this refund"
      backHref="/operations"
      backLabel="Back to operations"
    />,
  )

  return container
}

afterEach(cleanup)

describe('ReadRefusal', () => {
  it('offers the step-up in place of a refusal when the window lapsed', () => {
    const container = draw(
      refused({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        message: 'Authenticate at /v1/auth/step-up and retry.',
      }),
    )

    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeTruthy()
    expect(container.textContent).not.toMatch(/not for this account|\/v1\//i)
  })

  it('sends an account without a second factor to set one up', () => {
    const container = draw(
      refused({
        status: 403,
        code: 'MFA_ENROLMENT_REQUIRED',
        message: 'Enrol one at /v1/auth/mfa/totp, then try again.',
      }),
    )

    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' }).getAttribute('href')).toBe(
      '/account/security',
    )
    expect(container.textContent).not.toContain('/v1/')
  })

  it('sends a lost session to sign in, and back to this page', () => {
    draw(refused({ status: 401, code: 'UNAUTHORIZED' }))

    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Ffinance%2Frefunds%2Fabc%3Fx%3D1',
    )
  })

  it('reads a refusal and a missing item identically', () => {
    const forbidden = draw(refused({ status: 403, code: 'FORBIDDEN' })).textContent

    cleanup()

    const missing = draw(refused({ status: 404, code: 'NOT_FOUND' })).textContent

    expect(forbidden).toBe(missing)
    expect(screen.getByRole('link', { name: 'Back to operations' })).toBeTruthy()
  })

  it('says how long to wait when the API said', () => {
    draw(refused({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 180 }))

    expect(screen.getByText(/Wait about 3 minutes, then try again\./)).toBeTruthy()
  })

  it('says the service is not answering when nothing came back', () => {
    const container = draw(new TypeError('fetch failed'))

    expect(container.textContent).toMatch(/This refund could not be loaded\. Nothing reached/)
  })

  it('never repeats the API’s own message', () => {
    const container = draw(
      refused({ status: 500, message: 'column "secret_internal" does not exist' }),
    )

    expect(container.textContent).not.toContain('secret_internal')
  })
})
