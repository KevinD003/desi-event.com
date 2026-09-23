/**
 * Two-step sign-in, as a person sets it up.
 *
 * The properties that matter are about the two secrets that pass through:
 * the TOTP secret is shown once and dropped the moment it has done its job,
 * the recovery codes are shown once and dropped when the person says they
 * have them, and neither ever reaches storage. And a wrong password when
 * turning the factor off is reported as a wrong password, not as a lost
 * session.
 *
 * @module app/account/security/two-step.test
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

const { TwoStep, groupSecret } = await import('./two-step.jsx')

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const URI = `otpauth://totp/Desi-Event:meera?secret=${SECRET}&issuer=Desi-Event`

/**
 * A JSON response.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {Response} The response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

afterEach(cleanup)

describe('setting it up', () => {
  it('shows the secret as a QR code and as typed text, then drops it once confirmed', async () => {
    apiFetch
      .mockResolvedValueOnce(
        json(200, {
          data: { factorId: 'ckfactor0000000000000001', secret: SECRET, uri: URI, digits: 6, periodSeconds: 30, algorithm: 'SHA1' },
        }),
      )
      .mockResolvedValueOnce(
        json(200, { data: { factorId: 'ckfactor0000000000000001', recoveryCodes: ['ABCD2345EF', 'GHJK6789LM'] } }),
      )

    const { container } = render(<TwoStep required={false} factors={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))

    await screen.findByRole('img', { name: /qr code for your authenticator app/i })
    expect(container.textContent).toContain(groupSecret(SECRET))

    fireEvent.change(screen.getByLabelText(/six-digit code/i), { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByRole('heading', { name: /save your recovery codes now/i })

    // The code's spaces are the person's, not the API's.
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
      factorId: 'ckfactor0000000000000001',
      code: '123456',
    })
    // The secret has gone from the page, and so has the QR code carrying it.
    expect(container.textContent).not.toContain(SECRET.slice(0, 8))
    expect(screen.queryByRole('img', { name: /qr code/i })).toBeNull()
    expect(container.innerHTML).not.toContain('otpauth')
  })

  it('shows the recovery codes once, and forgets them when the person has saved them', async () => {
    apiFetch
      .mockResolvedValueOnce(
        json(200, { data: { factorId: 'ckfactor0000000000000001', secret: SECRET, uri: URI, digits: 6, periodSeconds: 30, algorithm: 'SHA1' } }),
      )
      .mockResolvedValueOnce(
        json(200, { data: { factorId: 'ckfactor0000000000000001', recoveryCodes: ['ABCD2345EF'] } }),
      )

    const { container } = render(<TwoStep required={false} factors={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))
    await screen.findByLabelText(/six-digit code/i)
    fireEvent.change(screen.getByLabelText(/six-digit code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('ABCD2345EF')
    fireEvent.click(screen.getByRole('button', { name: 'I have saved them' }))

    expect(container.textContent).not.toContain('ABCD2345EF')
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps neither secret in any browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValueOnce(
      json(200, { data: { factorId: 'ckfactor0000000000000001', secret: SECRET, uri: URI, digits: 6, periodSeconds: 30, algorithm: 'SHA1' } }),
    )

    render(<TwoStep required={false} factors={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))
    await screen.findByRole('img', { name: /qr code/i })

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('reports a code the API refused, and keeps the person on the step', async () => {
    apiFetch
      .mockResolvedValueOnce(
        json(200, { data: { factorId: 'ckfactor0000000000000001', secret: SECRET, uri: URI, digits: 6, periodSeconds: 30, algorithm: 'SHA1' } }),
      )
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'That code is not valid.' } }))

    render(<TwoStep required={false} factors={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))
    await screen.findByLabelText(/six-digit code/i)
    fireEvent.change(screen.getByLabelText(/six-digit code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('That code is not valid.')).toBeTruthy()
    expect(screen.getByRole('img', { name: /qr code/i })).toBeTruthy()
  })
})

describe('turning it off', () => {
  const ACTIVE = [
    {
      id: 'ckfactor0000000000000002',
      type: 'TOTP',
      confirmed: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      lastUsedAt: null,
    },
  ]

  it('asks for the current password, and reports a wrong one as a wrong password', async () => {
    apiFetch.mockResolvedValueOnce(
      json(401, { error: { code: 'UNAUTHORIZED', message: 'That is not your current password.' } }),
    )

    render(<TwoStep required={false} factors={ACTIVE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step sign-in' }))
    fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn it off' }))

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).toContain('That is not your current password.')
    // Not "your session has ended, sign in again": the person is still here.
    expect(alert.textContent).not.toMatch(/sign in again|session (has )?(ended|expired)/i)
    // The form stays, so the person can try the right password.
    expect(screen.getByLabelText('Your current password')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('warns, before anything is sent, when a role needs a second factor', () => {
    render(<TwoStep required factors={ACTIVE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step sign-in' }))

    expect(screen.getByText(/will refuse this unless you have another one/i)).toBeTruthy()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for a step-up when the API wants one, then finishes what was started', async () => {
    apiFetch
      .mockResolvedValueOnce(json(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm.' } }))
      .mockResolvedValueOnce(json(200, { ok: true }))
      .mockResolvedValueOnce(json(200, { ok: true }))

    render(<TwoStep required={false} factors={ACTIVE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step sign-in' }))
    fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn it off' }))

    expect(await screen.findByText(/confirm your identity to turn off two-step sign-in/i)).toBeTruthy()
  })

  it('says what else happened when it worked', async () => {
    apiFetch.mockResolvedValueOnce(json(200, { ok: true }))

    render(<TwoStep required={false} factors={ACTIVE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step sign-in' }))
    fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn it off' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.getByText(/every other session this account had was signed out/i)).toBeTruthy()
  })
})
