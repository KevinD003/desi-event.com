import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { TicketTransferActions, TicketTransferResponse } =
  await import('./ticket-transfer-actions.jsx')

/** A token long enough for the schema's sixteen-character minimum. */
const TOKEN = 'abcdefghijklmnopqrstuvwx'

/** A one-time transfer code as the API mints one: 43 url-safe characters. */
const CODE = 'Q29kZS1zaG93bi1vbmNlLXRvLXRoZS1zZW5kZXItMDA'

/**
 * A ticket in a given state.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A ticket payload.
 */
function ticket(overrides = {}) {
  return { id: 'ticket000000000000000001', code: 'DE-TKT-1', status: 'VALID', ...overrides }
}

/**
 * A pending transfer on that ticket.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A transfer payload.
 */
function transfer(overrides = {}) {
  return {
    id: 'trans0000000000000000001',
    ticketId: 'ticket000000000000000001',
    status: 'PENDING',
    toEmailMasked: '••••@dhol.example',
    expiresAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * A response the mocked `apiFetch` will resolve with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('what a holder is offered', () => {
  it('offers a reserved-seat ticket like any other', () => {
    // Seated transfer used to be refused on the server (ADR 0005); since ADR
    // 0006 the seat goes with the ticket, and the screen offers it.
    render(
      <TicketTransferActions
        ticket={ticket({ eventSeatId: 'eventseat000000000000001' })}
        transfers={[]}
        holder
        mayRevoke={false}
      />,
    )

    expect(screen.getByRole('button', { name: /offer this ticket/i })).toBeInTheDocument()
    expect(screen.queryByText(/cannot be handed on/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /seated tickets/i })).toBeNull()
  })

  it('lets the holder withdraw an outstanding offer on a seated ticket', () => {
    render(
      <TicketTransferActions
        ticket={ticket({ status: 'TRANSFER_PENDING', eventSeatId: 'eventseat000000000000001' })}
        transfers={[transfer()]}
        holder
        mayRevoke={false}
      />,
    )

    expect(screen.getByRole('button', { name: /withdraw the offer/i })).toBeTruthy()
  })

  it('offers a transfer on a ticket that still admits them', () => {
    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    expect(screen.getByRole('button', { name: /offer this ticket/i })).toBeInTheDocument()
  })

  it('will not offer a revoked ticket', () => {
    render(
      <TicketTransferActions
        ticket={ticket({ status: 'REVOKED' })}
        transfers={[]}
        holder
        mayRevoke={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /offer this ticket/i })).not.toBeInTheDocument()
    expect(screen.getByText(/nothing to do with this ticket/i)).toBeInTheDocument()
  })

  it('will not offer a ticket that has already been through the door', () => {
    render(
      <TicketTransferActions
        ticket={ticket({ status: 'CHECKED_IN' })}
        transfers={[]}
        holder
        mayRevoke={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /offer this ticket/i })).not.toBeInTheDocument()
  })

  it('offers withdrawal, not a second offer, while one is outstanding', () => {
    render(
      <TicketTransferActions
        ticket={ticket({ status: 'TRANSFER_PENDING' })}
        transfers={[transfer()]}
        holder
        mayRevoke={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /offer this ticket/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /withdraw the offer/i })).toBeInTheDocument()
  })

  it('offers nothing to somebody who is not the holder and cannot revoke', () => {
    render(
      <TicketTransferActions ticket={ticket()} transfers={[]} holder={false} mayRevoke={false} />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers withdrawal to an organiser who is not the holder', () => {
    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder={false} mayRevoke />)

    expect(screen.getByRole('button', { name: /withdraw this ticket/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /offer this ticket/i })).not.toBeInTheDocument()
  })
})

describe('offering a ticket', () => {
  it('sends the address and nothing that could name another ticket', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, {
        data: { ...transfer(), delivery: { mode: 'MANUAL', invitationCode: CODE } },
      }),
    )

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(
      screen.getByRole('textbox', { name: /their email address/i }),
      'rival@dhol.example',
    )
    await user.click(screen.getByRole('button', { name: /send the offer/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/tickets/ticket000000000000000001/transfers')
    expect(JSON.parse(options.body)).toEqual({ toEmail: 'rival@dhol.example' })

    // A MANUAL answer: the confirmation must not claim a send.
    expect(
      await screen.findByText(/give them the code shown below; it is shown only once/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/have been sent|has been sent/i)).toBeNull()
  })

  it('says, when codes are not emailed, that the sender is shown the code to give them', async () => {
    const user = userEvent.setup()

    render(
      <TicketTransferActions
        ticket={ticket()}
        transfers={[]}
        holder
        mayRevoke={false}
        deliveryMode="MANUAL"
      />,
    )

    expect(screen.getByText(/You are shown a one-time code to give them yourself/u)).toBeVisible()

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))

    const field = screen.getByRole('textbox', { name: /their email address/i })
    const described = document.getElementById(field.getAttribute('aria-describedby').split(' ')[0])

    expect(described.textContent).toMatch(/must be signed in with this address/i)
    expect(described.textContent).toMatch(/codes are not emailed from this site/i)
    expect(described.textContent).toMatch(/one-time code to give them yourself/i)
    expect(described.textContent).not.toMatch(/sends no email/i)
  })

  it('says, when codes are emailed, that the code goes to the address and the sender will not see it', async () => {
    const user = userEvent.setup()

    render(
      <TicketTransferActions
        ticket={ticket()}
        transfers={[]}
        holder
        mayRevoke={false}
        deliveryMode="EMAIL"
      />,
    )

    expect(screen.getByText(/A one-time code is emailed to the address you name/u)).toBeVisible()

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))

    const field = screen.getByRole('textbox', { name: /their email address/i })
    const described = document.getElementById(field.getAttribute('aria-describedby').split(' ')[0])

    expect(described.textContent).toBe(
      'They must be signed in with this address to accept. The code is emailed to that address. You will not see it.',
    )
    expect(described.textContent).not.toMatch(/give them yourself/i)
  })

  it('says only what holds in every mode when the mode is not known', async () => {
    const user = userEvent.setup()

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))

    const field = screen.getByRole('textbox', { name: /their email address/i })
    const described = document.getElementById(field.getAttribute('aria-describedby').split(' ')[0])

    expect(described.textContent).toBe('They must be signed in with this address to accept.')
  })

  it('shows the API’s sentence when the address has had its codes for the day', async () => {
    const user = userEvent.setup()
    const sentence =
      'This address has already been sent three codes from Desi-Event today. Try again tomorrow.'

    apiFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'RECIPIENT_DAILY_LIMIT', message: sentence } }),
    })
    render(
      <TicketTransferActions
        ticket={ticket()}
        transfers={[]}
        holder
        mayRevoke={false}
        deliveryMode="EMAIL"
      />,
    )

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(screen.getByRole('textbox', { name: /their email address/i }), 'a@b.example')
    await user.click(screen.getByRole('button', { name: /send the offer/i }))

    expect(await screen.findByText(sentence)).toBeVisible()
  })

  it('shows the one-time code after a MANUAL offer, focuses it, and forgets it on Done', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, {
        data: { ...transfer(), delivery: { mode: 'MANUAL', invitationCode: CODE } },
      }),
    )

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(
      screen.getByRole('textbox', { name: /their email address/i }),
      'rival@dhol.example',
    )
    await user.click(screen.getByRole('button', { name: /send the offer/i }))

    const heading = await screen.findByRole('heading', { name: 'Give them this code' })

    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByRole('textbox', { name: 'Ticket transfer code' })).toHaveValue(CODE)
    expect(document.body.textContent).toMatch(/••••@dhol\.example/u)
    expect(document.body.textContent).toMatch(/withdraw the offer and make a new one/i)

    // Nothing of it in storage or the address bar.
    expect(window.location.href).not.toContain(CODE)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(CODE)
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(CODE)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(screen.queryByRole('heading', { name: 'Give them this code' })).toBeNull()
    expect(document.body.innerHTML).not.toContain(CODE)
  })

  it('forgets the code when the page is left', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, {
        data: { ...transfer(), delivery: { mode: 'MANUAL', invitationCode: CODE } },
      }),
    )

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(
      screen.getByRole('textbox', { name: /their email address/i }),
      'rival@dhol.example',
    )
    await user.click(screen.getByRole('button', { name: /send the offer/i }))
    await screen.findByRole('heading', { name: 'Give them this code' })

    // Hiding the tab keeps it: the sender switches apps to paste it.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(document.body.innerHTML).toContain(CODE)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(document.body.innerHTML).not.toContain(CODE)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('shows no code when a delivery provider sent it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, { data: { ...transfer(), delivery: { mode: 'EMAIL', invitationCode: null } } }),
    )

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(
      screen.getByRole('textbox', { name: /their email address/i }),
      'rival@dhol.example',
    )
    await user.click(screen.getByRole('button', { name: /send the offer/i }))

    expect(await screen.findByText('Offered. The invitation has been sent.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Give them this code' })).toBeNull()
  })

  it('repeats a refusal rather than retrying it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, { error: { code: 'CONFLICT', message: 'That ticket is already out on offer.' } }),
    )

    render(<TicketTransferActions ticket={ticket()} transfers={[]} holder mayRevoke={false} />)

    await user.click(screen.getByRole('button', { name: /offer this ticket/i }))
    await user.type(
      screen.getByRole('textbox', { name: /their email address/i }),
      'rival@dhol.example',
    )
    await user.click(screen.getByRole('button', { name: /send the offer/i }))

    expect(await screen.findByText(/already out on offer/i)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})

describe('answering an invitation', () => {
  it('takes the code in a field, never from the address bar', () => {
    render(<TicketTransferResponse />)

    const field = screen.getByLabelText(/invitation code/i)

    // A password input, because this screen gets used on a train — and because
    // the value must not end up in the browser's ordinary autofill store.
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
  })

  it('will not send something too short to be an invitation', async () => {
    const user = userEvent.setup()

    render(<TicketTransferResponse />)

    await user.type(screen.getByLabelText(/invitation code/i), 'short')

    expect(screen.getByRole('button', { name: /accept the ticket/i })).toBeDisabled()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('posts the code in the body', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, { data: { ticket: ticket(), credential: 'never-shown' } }),
    )

    render(<TicketTransferResponse />)

    await user.type(screen.getByLabelText(/invitation code/i), TOKEN)
    await user.click(screen.getByRole('button', { name: /accept the ticket/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/ticket-transfers/accept')
    expect(JSON.parse(options.body)).toEqual({ token: TOKEN })
  })

  it('never shows the credential the server handed back', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, { data: { ticket: ticket(), credential: 'pass-v1.secret-material' } }),
    )

    render(<TicketTransferResponse />)

    await user.type(screen.getByLabelText(/invitation code/i), TOKEN)
    await user.click(screen.getByRole('button', { name: /accept the ticket/i }))

    expect(await screen.findByText(/it is yours/i)).toBeInTheDocument()
    // A pass on a page is a pass in a screenshot, and a screenshot of one is a
    // ticket.
    expect(document.body.textContent).not.toContain('secret-material')
  })

  it('clears the code once it has been spent', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: null }))

    render(<TicketTransferResponse />)

    const field = screen.getByLabelText(/invitation code/i)

    await user.type(field, TOKEN)
    await user.click(screen.getByRole('button', { name: /decline it/i }))

    await waitFor(() => expect(field).toHaveValue(''))
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('refuses every bad invitation in the same words', async () => {
    const user = userEvent.setup()

    for (const body of [
      { error: { code: 'NOT_FOUND', message: 'No such transfer.' } },
      { error: { code: 'CONFLICT', message: 'That transfer has expired.' } },
      { error: { code: 'CONFLICT', message: 'That transfer was cancelled.' } },
    ]) {
      apiFetch.mockResolvedValue(answer(404, body))

      const view = render(<TicketTransferResponse />)

      await user.type(screen.getByLabelText(/invitation code/i), TOKEN)
      await user.click(screen.getByRole('button', { name: /accept the ticket/i }))

      // One message for all of them. Telling them apart would tell somebody
      // feeding in guesses which of their guesses was a real invitation.
      expect(
        await screen.findByText(/may have expired, been withdrawn, or been used already/i),
      ).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/No such transfer|was cancelled/u)

      view.unmount()
    }
  })
})
