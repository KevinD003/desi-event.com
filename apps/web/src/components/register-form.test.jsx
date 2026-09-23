/**
 * Creating an account.
 *
 * The properties worth pinning: the form posts, so a press before the script
 * arrives keeps the password out of the URL; it sends exactly the three fields
 * the API takes, and never a role; it refuses a password the API would refuse
 * before asking; success is a full navigation to `next`; a refusal is said in
 * the shared vocabulary, never with an endpoint in it; and the form says what
 * this build cannot do — confirm the address, reset a password — up front.
 *
 * @module components/register-form.test
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { RegisterForm } = await import('./register-form.jsx')

/**
 * A response the mocked `apiFetch` will resolve with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @param {Record<string, string>} [headers] Response headers.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

/**
 * Fill the form in.
 *
 * @param {object} user A user-event instance.
 * @param {object} [fields] Values to type in place of the defaults.
 * @returns {Promise<void>} Resolves once typed.
 */
async function fill(user, fields = {}) {
  const { name, email, password } = {
    name: 'Meera Iyer',
    email: 'meera@example.test',
    password: 'correct horse',
    ...fields,
  }

  if (name) await user.type(screen.getByLabelText(/your name/i), name)
  if (email) await user.type(screen.getByLabelText(/email address/i), email)
  if (password) await user.type(screen.getByLabelText(/^password/i), password)
}

let assign

beforeEach(() => {
  apiFetch.mockReset()
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RegisterForm', () => {
  it('is served as a form that posts, so its fields cannot reach a URL', () => {
    const html = renderToStaticMarkup(<RegisterForm next="/account" />)

    expect(html).toMatch(/<form[^>]*\smethod="post"/u)
    expect(html).toMatch(/name="password"/u)
  })

  it('sends the name, the address and the password, and nothing else', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: {} }))
    render(<RegisterForm next="/events/qawwali/checkout" />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/auth/register')
    expect(options.method).toBe('POST')
    // No role: an organiser account without an organisation opens onto nothing.
    expect(JSON.parse(options.body)).toEqual({
      displayName: 'Meera Iyer',
      email: 'meera@example.test',
      password: 'correct horse',
    })
  })

  it('goes where the person was going, with a full navigation', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: {} }))
    render(<RegisterForm next="/events/qawwali/checkout" />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/events/qawwali/checkout'))
  })

  it('refuses a password the API would refuse, without asking it', async () => {
    const user = userEvent.setup()

    render(<RegisterForm next="/account" />)

    await fill(user, { password: 'short' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least eight characters/i)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('repeats the API’s own words for a conflict', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: { code: 'CONFLICT', message: 'An account with this email address already exists.' },
      }),
    )
    render(<RegisterForm next="/account" />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email address already exists.',
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it('says how long to wait when sign-ups are being throttled, and names no endpoint', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(
        429,
        { error: { code: 'RATE_LIMITED', message: 'Slow down at /v1/auth/register.' } },
        { 'retry-after': '120' },
      ),
    )
    render(<RegisterForm next="/account" />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent(/2 minutes/)
    expect(alert.textContent).not.toContain('/v1/')
  })

  it('says nothing was created when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('fetch failed'))
    render(<RegisterForm next="/account" />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no account was created/i)
  })

  it('says up front that the address is not confirmed and a password cannot be reset', () => {
    render(<RegisterForm next="/account" />)

    expect(screen.getByText(/sends no email, so it is not confirmed/i)).toBeInTheDocument()
    expect(screen.getByText(/forgotten password cannot be reset/i)).toBeInTheDocument()
  })
})
