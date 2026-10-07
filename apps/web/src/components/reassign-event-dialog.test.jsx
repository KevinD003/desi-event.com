import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
  usePathname: () => '/admin/events/cevent0000000000000000001',
}))
// A form of its own, as the real prompt is (`step-up-prompt.jsx`), so a
// prompt drawn inside the move form would be a form inside a form.
vi.mock('./step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <form aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
    </form>
  ),
}))

const { apiFetch } = await import('../lib/api-fetch.js')
const { NOT_ASKED_SENTENCE, ReassignEventDialog } = await import('./reassign-event-dialog.jsx')

const EVENT = { id: 'cevent0000000000000000001', title: 'Raga Night', revision: 4 }
const TARGET = {
  id: 'corg00000000000000000001',
  name: 'Raga Nights Houston',
  slug: 'raga-nights-houston',
  verificationStatus: 'VERIFIED',
}

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
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
 * Open the dialog and find the organisation.
 *
 * @param {object} user The user-event instance.
 * @returns {Promise<void>} Resolves once the result is drawn.
 */
async function openAndFind(user) {
  render(<ReassignEventDialog event={EVENT} />)
  await user.click(screen.getByRole('button', { name: 'Move to an organisation…' }))
  await user.type(screen.getByLabelText('Find the organisation'), 'raga')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('radio', { name: /Raga Nights Houston/u })
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
  replace.mockReset()
})

describe('moving an imported event to an organisation', () => {
  it('says the organisation is not asked first, and asks for a reason in the usual words', async () => {
    const user = userEvent.setup()

    render(<ReassignEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Move to an organisation…' }))

    expect(screen.getByText(NOT_ASKED_SENTENCE)).toBeInTheDocument()
    expect(NOT_ASKED_SENTENCE).toBe(
      'The organisation is not asked before the event moves. Agree it with them first.',
    )
    expect(screen.getByLabelText(/Why it moves/u)).toHaveAccessibleDescription(
      expect.stringContaining(
        "Shown with the event's history. Do not include anybody's personal details.",
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Move “Raga Night” to an organisation' }),
      ).toHaveFocus(),
    )
  })

  it('finds organisations by name and moves the event with the reason and the revision read', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: [TARGET] }))
      .mockResolvedValueOnce(answer(200, { data: { id: EVENT.id } }))
    await openAndFind(user)

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/v1/platform/import-targets', {
      query: { q: 'raga' },
    })

    await user.click(screen.getByRole('radio', { name: /Raga Nights Houston/u }))
    await user.type(
      screen.getByLabelText(/Why it moves/u),
      'The organiser joined and asked for it.',
    )
    await user.click(screen.getByRole('button', { name: 'Move the event' }))

    expect(
      await screen.findByText('The event now belongs to Raga Nights Houston.'),
    ).toBeInTheDocument()
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      `/v1/platform/imports/events/${EVENT.id}/reassign`,
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: TARGET.id,
          reason: 'The organiser joined and asked for it.',
          revision: 4,
        }),
      },
    )
    // The page is drawn again with the flag that makes it say so: a moved
    // event is no longer offered this dialog, so a bare refresh would take
    // the outcome away before anybody read it.
    expect(replace).toHaveBeenCalledWith(`/admin/events/${EVENT.id}?moved=1`)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('names what is missing in a summary linked to each field, and sends nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: [TARGET] }))
    await openAndFind(user)
    await user.click(screen.getByRole('button', { name: 'Move the event' }))

    expect(
      await screen.findByRole('link', { name: 'Choose the organisation to move it to.' }),
    ).toHaveAttribute('href', expect.stringMatching(/-target$/u))
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('links the missing organisation to the search box before anything was searched', async () => {
    const user = userEvent.setup()

    render(<ReassignEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Move to an organisation…' }))
    await user.click(screen.getByRole('button', { name: 'Move the event' }))

    const link = await screen.findByRole('link', {
      name: 'Search for the organisation to move it to, then choose it.',
    })
    const search = screen.getByLabelText('Find the organisation')

    // The link goes somewhere that exists: the search box, which says why too.
    expect(link).toHaveAttribute('href', `#${search.id}`)
    expect(document.getElementById(link.getAttribute('href').slice(1))).toBe(search)
    expect(search).toHaveAttribute('aria-invalid', 'true')
    expect(search).toHaveAccessibleDescription(
      expect.stringContaining('Search for the organisation to move it to, then choose it.'),
    )
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for a second factor when the API does, then sends the same move once more', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: [TARGET] }))
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { id: EVENT.id } }))
    await openAndFind(user)
    await user.click(screen.getByRole('radio', { name: /Raga Nights Houston/u }))
    await user.type(
      screen.getByLabelText(/Why it moves/u),
      'The organiser joined and asked for it.',
    )
    await user.click(screen.getByRole('button', { name: 'Move the event' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm to move this event' }))

    expect(
      await screen.findByText('The event now belongs to Raga Nights Houston.'),
    ).toBeInTheDocument()
    expect(apiFetch.mock.calls[2][1].body).toBe(apiFetch.mock.calls[1][1].body)
  })

  it('draws the second-factor prompt beside the move form, never inside it', async () => {
    // A form within a form is not HTML: React reports it, and the browser may
    // send the outer form when the prompt's button is pressed.
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: [TARGET] }))
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
    await openAndFind(user)
    await user.click(screen.getByRole('radio', { name: /Raga Nights Houston/u }))
    await user.type(
      screen.getByLabelText(/Why it moves/u),
      'The organiser joined and asked for it.',
    )
    await user.click(screen.getByRole('button', { name: 'Move the event' }))

    const prompt = await screen.findByRole('form', { name: 'Confirm it is you' })
    const move = screen.getByRole('form', { name: 'Move this event' })

    expect(move).not.toContainElement(prompt)
    expect(move.querySelector('form')).toBeNull()
    expect(screen.getByRole('button', { name: 'Move the event' })).toBeDisabled()
  })

  it('says the API’s refusal in its own words', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: [TARGET] })).mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'TARGET_NOT_ELIGIBLE',
          message: 'That organisation cannot take this event.',
        },
      }),
    )
    await openAndFind(user)
    await user.click(screen.getByRole('radio', { name: /Raga Nights Houston/u }))
    await user.type(
      screen.getByLabelText(/Why it moves/u),
      'The organiser joined and asked for it.',
    )
    await user.click(screen.getByRole('button', { name: 'Move the event' }))

    expect(await screen.findByText('That organisation cannot take this event.')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})
