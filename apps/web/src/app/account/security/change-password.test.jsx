/**
 * Changing the password.
 *
 * The properties that matter: the form refuses what the API would refuse
 * before anything is sent; it sends the current password as well as the new
 * one; a wrong current password is reported in the API's own words rather than
 * as a lost session; success says the other sessions were signed out; and no
 * password, old or new, is kept anywhere once the form is done with it.
 *
 * @module app/account/security/change-password.test
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

const { ChangePassword, PASSWORD_RULE } = await import('./change-password.jsx')

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

/**
 * Fill the three fields.
 *
 * @param {string} current The current password.
 * @param {string} next The new password.
 * @param {string} [repeat] The new password again.
 * @returns {void}
 */
function fill(current, next, repeat = next) {
  fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: current } })
  fireEvent.change(screen.getByLabelText(/^New password(?! again)/), { target: { value: next } })
  fireEvent.change(screen.getByLabelText(/^New password again/), { target: { value: repeat } })
}

beforeEach(() => {
  apiFetch.mockReset()
})

afterEach(cleanup)

describe('ChangePassword', () => {
  it('matches the API’s own rule for a password', async () => {
    const { passwordSchema } = await import('@desi-event/schemas')

    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_RULE.min)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_RULE.min - 1)).success).toBe(false)
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_RULE.max)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_RULE.max + 1)).success).toBe(false)
  })

  it('refuses two different new passwords before sending anything', () => {
    render(<ChangePassword />)
    fill('old-password', 'new-password-1', 'new-password-2')

    expect(screen.getByText('The two new passwords are different.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change password' }).disabled).toBe(true)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('refuses a new password shorter than the API accepts', () => {
    render(<ChangePassword />)
    fill('old-password', 'short')

    expect(screen.getByText(`Use at least ${PASSWORD_RULE.min} characters.`)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change password' }).disabled).toBe(true)
  })

  it('sends the current password with the new one, and says what else happened', async () => {
    apiFetch.mockResolvedValueOnce(json(200, { ok: true }))

    render(<ChangePassword />)
    fill('old-password', 'new-password-long')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(
      await screen.findByText(/every other session this account had was signed out/i),
    ).toBeTruthy()

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/auth/change-password')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      currentPassword: 'old-password',
      password: 'new-password-long',
    })
    // Nothing typed survives the change on the page.
    for (const field of screen.getAllByLabelText(/password/i)) expect(field.value).toBe('')
  })

  it('reports a wrong current password in the API’s words, not as a lost session', async () => {
    apiFetch.mockResolvedValueOnce(
      json(401, { error: { code: 'UNAUTHORIZED', message: 'That is not your current password.' } }),
    )

    render(<ChangePassword />)
    fill('wrong-password', 'new-password-long')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    const alert = await screen.findByRole('status')

    expect(alert.textContent).toContain('That is not your current password.')
    expect(alert.textContent).not.toMatch(/sign in again|session (has )?(ended|expired)/i)
    expect(screen.queryByText(/password changed/i)).toBeNull()
  })

  it('says nothing changed when the service does not answer', async () => {
    apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<ChangePassword />)
    fill('old-password', 'new-password-long')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect((await screen.findByRole('status')).textContent).toMatch(/was not changed/i)
  })

  it('keeps no password in any browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValueOnce(json(200, { ok: true }))

    render(<ChangePassword />)
    fill('old-password', 'new-password-long')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})
