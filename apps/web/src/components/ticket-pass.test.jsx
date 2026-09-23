import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { TicketPass } = await import('./ticket-pass.jsx')

/** A pass-shaped credential, as the endpoint returns one. */
const CREDENTIAL = 'Zx9-kQ4_wL2mN7pR1sT5vY8aB3cD6eF0gH2jK4lM6nP'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} [body] The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const PASS = {
  data: {
    ticketId: 'ticket0000000000000000001',
    credential: CREDENTIAL,
    credentialVersion: 2,
    issuedAt: null,
  },
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('TicketPass', () => {
  it('fetches nothing until the holder asks', () => {
    render(<TicketPass ticketId="ticket0000000000000000001" />)

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('draws the pass as a QR code without the credential anywhere in the page', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValue(answer(200, PASS))
    render(<TicketPass ticketId="ticket0000000000000000001" />)

    await user.click(screen.getByRole('button', { name: /show my entry pass/iu }))

    const drawing = await screen.findByRole('img', { name: /entry pass, as a qr code/iu })

    expect(drawing.querySelector('path').getAttribute('d')).toMatch(/^M\d+ \d+h/u)
    expect(document.documentElement.outerHTML).not.toContain(CREDENTIAL)
    expect(setItem).not.toHaveBeenCalled()
    // Asked for with no-store, through the holder-only endpoint.
    expect(apiFetch).toHaveBeenCalledWith('/v1/tickets/ticket0000000000000000001/pass', {
      cache: 'no-store',
    })
    // And the honest sentence about screenshots, next to it.
    expect(screen.getByText(/as a screenshot — can use it to get in once/iu)).toBeTruthy()
    expect(screen.getByRole('button', { name: /hide pass/iu })).toBe(document.activeElement)

    // A valid figure: the code and its caption, the caption last, and the
    // control that takes the pass away outside it rather than inside.
    const figure = drawing.closest('figure')

    expect(figure.lastElementChild.tagName).toBe('FIGCAPTION')
    expect(figure.contains(screen.getByRole('button', { name: /hide pass/iu }))).toBe(false)

    setItem.mockRestore()
  })

  it('takes the pass away when hidden, and puts focus back on the button that showed it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, PASS))
    render(<TicketPass ticketId="ticket0000000000000000001" />)

    await user.click(screen.getByRole('button', { name: /show my entry pass/iu }))
    await user.click(await screen.findByRole('button', { name: /hide pass/iu }))

    expect(screen.queryByRole('img')).toBeNull()
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /show my entry pass/iu }),
      ),
    )
  })

  it('takes the pass away when the page is hidden', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, PASS))
    render(<TicketPass ticketId="ticket0000000000000000001" />)

    await user.click(screen.getByRole('button', { name: /show my entry pass/iu }))
    await screen.findByRole('img')

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.queryByRole('img')).toBeNull()

    visibility.mockRestore()
  })

  it.each([
    [403, /only available to the person holding/iu],
    [409, /no longer admits anybody/iu],
    [429, /wait a minute/iu],
  ])('explains a %i without drawing anything', async (status, message) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(status, { error: { message: 'x' } }))
    render(<TicketPass ticketId="ticket0000000000000000001" />)

    await user.click(screen.getByRole('button', { name: /show my entry pass/iu }))

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    // Not an interruption: the holder asked, and the answer is polite.
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
