import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { TicketPass, VenuePaymentNote } = await import('./ticket-pass.jsx')

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

describe('VenuePaymentNote (SPEC3 §12.7, SPEC3-XI §12.7)', () => {
  /**
   * A ticket of a booking paid at the venue.
   *
   * @param {object} [venue] Fields of `venuePayment` to change.
   * @param {object} [overrides] Fields of the ticket to change.
   * @returns {object} The ticket.
   */
  function venueTicket(venue = {}, overrides = {}) {
    return {
      id: 'ticket000000000000000001',
      status: 'VALID',
      venuePayment: {
        dueCents: 4_000,
        paid: false,
        currency: 'USD',
        cancelled: null,
        paidAtDoorByYou: false,
        ...venue,
      },
      ...overrides,
    }
  }

  it('shows what is owed at the door, as a word and a colour', () => {
    render(<VenuePaymentNote ticket={venueTicket()} />)

    expect(screen.getByText('Pay at the door: $40.00')).toHaveAttribute('data-tone', 'pending')
    expect(
      screen.getByText('Pay this at the door. The steward records it before letting you in.'),
    ).toBeInTheDocument()
  })

  it('shows a cancelled ticket as not paid, with who cancelled it and why', () => {
    render(
      <VenuePaymentNote
        ticket={venueTicket(
          {
            cancelled: {
              at: '2026-10-08T15:00:00.000Z',
              by: 'DESI_EVENT',
              reason: 'Not paid for at the door by the end of the night.',
            },
          },
          { status: 'REVOKED' },
        )}
        timeZone="UTC"
      />,
    )

    expect(screen.getByText('Cancelled — not paid')).toHaveAttribute('data-tone', 'neutral')
    expect(
      screen.getByText(
        'The Desi Events team cancelled this ticket on Thu, Oct 8, 2026 because it had not been paid for. You no longer owe $40.00 for it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Reason given: “Not paid for at the door by the end of the night.”'),
    ).toBeInTheDocument()
  })

  it('says where door money went once a ticket the holder paid for was refunded', () => {
    render(
      <VenuePaymentNote
        ticket={venueTicket({ paid: true, paidAtDoorByYou: true }, { status: 'REFUNDED' })}
      />,
    )

    expect(
      screen.getByText(
        'The $40.00 you paid at the door for this ticket is with the organiser, not with The Desi Events. Ask the organiser to return it.',
      ),
    ).toBeInTheDocument()
  })

  it('draws nothing for a ticket that owes nothing', () => {
    const { container } = render(
      <VenuePaymentNote ticket={{ id: 't', status: 'VALID', venuePayment: null }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
