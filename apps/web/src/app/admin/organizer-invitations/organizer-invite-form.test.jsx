/**
 * Inviting an organiser sends only what an administrator writes, asks for a
 * recent second factor when the API does, and shows a code once — with the
 * ready-to-send message — in nothing but the component's own state.
 *
 * @module app/admin/organizer-invitations/organizer-invite-form.test
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
// A form of its own, as the real prompt is (`components/step-up-prompt.jsx`),
// so a prompt drawn inside the invite form would be a form inside a form.
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <form aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
    </form>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { OrganizerInviteForm, composeLetter } = await import('./organizer-invite-form.jsx')
const { ORGANIZER_INVITATION_REFUSALS } = await import('./organizer-invitation-vocabulary.js')

const CODE = 'Qw3_rT6-yU9iO2pA5sD8fG1hJ4kL7zX0cV3bN6mQ9wE'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @param {object} [headers] Response headers.
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
 * What the API answers for a new invitation.
 *
 * @param {'MANUAL'|'EMAIL'} mode How the code went out.
 * @returns {object} The body.
 */
function issued(mode) {
  return {
    data: {
      id: 'inv00000000000000000001',
      email: 'priya@rangoli.example',
      organizationName: 'Rangoli Collective',
      organizationDescription: null,
      organizationWebsiteUrl: null,
      organization: null,
      note: 'Welcome aboard — we spoke on Tuesday.',
      status: 'PENDING',
      deliveryMode: mode,
      invitedByName: 'Anil Administrator',
      acceptedByName: null,
      revokedByName: null,
      supersedesId: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      expiresAt: '2026-10-15T10:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      delivery: { mode, invitationCode: mode === 'MANUAL' ? CODE : null },
    },
  }
}

/**
 * Fill in the two required fields.
 *
 * @param {object} user The user-event instance.
 * @returns {Promise<void>} Resolves once typed.
 */
async function fillRequired(user) {
  await user.type(screen.getByLabelText(/^Their email address/u), ' priya@rangoli.example ')
  await user.type(screen.getByLabelText(/^Organisation name/u), 'Rangoli Collective')
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the organiser invite form', () => {
  it('sends only what an administrator writes: never a role, a status or a kind', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, issued('MANUAL')))
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.type(
      screen.getByLabelText(/^Public description of the organisation/u),
      'Garba nights in Austin.',
    )
    await user.type(
      screen.getByLabelText(/^The organisation’s website/u),
      'https://rangoli.example/',
    )
    await user.type(screen.getByLabelText(/^A note for them/u), '  Welcome aboard. ')
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/platform/organizer-invitations')
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')

    const sent = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(sent).toEqual({
      email: 'priya@rangoli.example',
      organizationName: 'Rangoli Collective',
      organizationDescription: 'Garba nights in Austin.',
      organizationWebsiteUrl: 'https://rangoli.example/',
      note: 'Welcome aboard.',
    })

    for (const planted of ['role', 'status', 'kind', 'organizationId', 'tokenHash']) {
      expect(Object.keys(sent)).not.toContain(planted)
    }
  })

  it('leaves the optional fields out when they are empty', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, issued('MANUAL')))
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      email: 'priya@rangoli.example',
      organizationName: 'Rangoli Collective',
    })
  })

  it('waits for an address and a name of at least two characters', async () => {
    const user = userEvent.setup()

    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    const submit = screen.getByRole('button', { name: 'Create the invitation' })

    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/^Their email address/u), 'priya@rangoli.example')
    await user.type(screen.getByLabelText(/^Organisation name/u), 'R')
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/^Organisation name/u), 'a')
    expect(submit).toBeEnabled()
  })

  it('asks for a recent second factor when the API does, then sends the same request once more', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate.' } }),
      )
      .mockResolvedValueOnce(answer(201, issued('MANUAL')))
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm to invite this organiser' }),
    )

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(apiFetch.mock.calls[1][1].body).toBe(apiFetch.mock.calls[0][1].body)
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)
  })

  it('draws the second-factor prompt beside the invite form, never inside it', async () => {
    // The prompt is a form of its own. Inside the invite form it would be a
    // form within a form, which HTML does not allow: React reports it, and the
    // browser may send the outer form instead, so the prompt's "Confirm"
    // reloaded the page and no code was ever shown (found by the
    // accessibility sweep, where the administrator's second factor had aged).
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate.' } }),
    )
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    const prompt = await screen.findByRole('form', { name: 'Confirm it is you' })
    const invite = screen.getByRole('form', { name: 'Invite an organiser' })

    expect(invite).not.toContainElement(prompt)
    expect(invite.querySelector('form')).toBeNull()
    // Still held while the prompt is open, so the request is not sent twice.
    expect(screen.getByRole('button', { name: 'Create the invitation' })).toBeDisabled()
  })

  it('does not loop when the API asks again after the second factor', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate.' } }),
    )
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm to invite this organiser' }),
    )

    expect(await screen.findByText('Nobody was invited')).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('shows the code once with the message to send, and copies the whole message', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    apiFetch.mockResolvedValue(answer(201, issued('MANUAL')))
    render(<OrganizerInviteForm deliveryMode="MANUAL" inviterName="Anil Administrator" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Organiser invitation code for priya@rangoli.example',
      }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Invitation code')).toHaveValue(CODE)

    const message = screen.getByLabelText('Message to send them')

    expect(message.value).toContain(`    ${CODE}\n`)
    expect(message.value).toContain(`${window.location.origin}/account/organizations/new`)
    expect(message.value).toContain('"Rangoli Collective"')
    expect(message.value).toContain('A note from Anil Administrator of the Desi-Event team:')
    expect(message.value).toContain('> Welcome aboard — we spoke on Tuesday.')
    // The code is typed on the page, never carried in the address.
    expect(message.value).not.toMatch(new RegExp(`https?://\\S*${CODE}`, 'u'))

    await user.click(screen.getByRole('button', { name: 'Copy the message' }))

    expect(writeText).toHaveBeenCalledWith(message.value)

    const status = await screen.findByText('Copied the message to your clipboard.')

    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText(/Your account → Accept an organiser invitation/u)).toBeVisible()
  })

  it('writes the code to no storage and puts it in no link', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValue(answer(201, issued('MANUAL')))

    const { container } = render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))
    await screen.findByLabelText('Invitation code')

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.location.href).not.toContain(CODE)

    for (const element of container.querySelectorAll('[href], [src], [action]')) {
      for (const attribute of ['href', 'src', 'action']) {
        expect(element.getAttribute(attribute) ?? '').not.toContain(CODE)
      }
    }
  })

  it('drops the code and the message when they have been handed over, then reads the list again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, issued('MANUAL')))

    const { container } = render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))
    await screen.findByLabelText('Invitation code')

    expect(refresh).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(container.innerHTML).not.toContain(CODE)
    expect(screen.queryByLabelText('Message to send them')).toBeNull()
    expect(screen.getByRole('form', { name: 'Invite an organiser' })).toBeInTheDocument()
    // The fields were cleared: the next invitation starts empty.
    expect(screen.getByLabelText(/^Their email address/u)).toHaveValue('')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows no code when codes are emailed, and says where it went', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, issued('EMAIL')))

    const { container } = render(<OrganizerInviteForm deliveryMode="EMAIL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }))

    const notice = await screen.findByRole('status')

    expect(
      within(notice).getByText(
        /^The invitation was emailed to priya@rangoli\.example\. It works until October 15, 2026/u,
      ),
    ).toBeVisible()
    expect(screen.queryByLabelText('Invitation code')).toBeNull()
    expect(container.innerHTML).not.toContain(CODE)
    expect(refresh).toHaveBeenCalled()
  })

  it.each([
    [409, 'INVITATION_OUTSTANDING'],
    [422, 'STAFF_ACCOUNT'],
    [403, 'SELF_INVITATION'],
    [503, 'DELIVERY_FAILED'],
  ])('repeats the API’s sentence for a %i %s, and moves focus to it', async (status, code) => {
    const user = userEvent.setup()
    const sentence = ORGANIZER_INVITATION_REFUSALS[code]

    apiFetch.mockResolvedValue(answer(status, { error: { code, message: sentence } }))
    render(<OrganizerInviteForm deliveryMode="EMAIL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Send the invitation' }))

    const shown = await screen.findByText(sentence)

    expect(screen.getByText('Nobody was invited')).toBeInTheDocument()
    await waitFor(() => expect(shown.closest('[tabindex="-1"]')).toHaveFocus())
  })

  it('puts a refused field’s message under its box', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          issues: [
            {
              path: 'body.organizationWebsiteUrl',
              message: 'A website address must start with https://.',
            },
          ],
        },
      }),
    )
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.type(screen.getByLabelText(/^The organisation’s website/u), 'http://x.example')
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    const field = screen.getByLabelText(/^The organisation’s website/u)

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('A website address must start with https://.')).toBeVisible()
  })

  it('says how long to wait after the shared issuing limit', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '600' }),
    )
    render(<OrganizerInviteForm deliveryMode="MANUAL" />)

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create the invitation' }))

    expect(await screen.findByText(/Wait about 10 minutes, then try again/u)).toBeVisible()
  })
})

describe('composeLetter', () => {
  it('writes the message for a code, with this site’s join page and no code in it', () => {
    const letter = composeLetter({
      code: CODE,
      email: 'priya@rangoli.example',
      organizationName: 'રંગોળી Collective',
      expiresAt: '2026-10-15T10:00:00.000Z',
      note: null,
      inviterName: null,
    })

    expect(letter.subject).toBe('Your organiser invitation from Desi-Event')
    expect(letter.text).toContain('"રંગોળી Collective"')
    expect(letter.text).toContain(`1. Open ${window.location.origin}/account/organizations/new\n`)
  })

  it('gives no message rather than one with a hole in it', () => {
    expect(composeLetter({ code: CODE, email: 'priya@rangoli.example' })).toBeNull()
    expect(
      composeLetter({
        code: 'short',
        email: 'priya@rangoli.example',
        organizationName: 'Rangoli',
        expiresAt: '2026-10-15T10:00:00.000Z',
      }),
    ).toBeNull()
  })
})
