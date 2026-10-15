/**
 * The group pass panel: a bearer credential for a whole party, so it is held
 * to the same rules as a ticket's own pass — nothing until asked, the QR
 * content never in the page, the printed code only while shown, gone when the
 * page is hidden, and replaceable.
 */

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { GroupPass } = await import('./group-pass.jsx')

/** Group-pass-shaped QR content and printed codes, as the endpoint returns them. */
const CREDENTIAL = 'G1.Zx9-kQ4_wL2mN7pR1sT5vY8aB3cD6eF0gH2jK4lM6nP'
const NEXT_CREDENTIAL = 'G1.Aa1-bB2_cC3dD4eE5fF6gG7hH8jJ9kK0mM1nN2pP3q'
const CODE = 'DEG-7KQ2M9XH4TPR'
const NEXT_CODE = 'DEG-3NW8CJ5YF2LB'
const REFERENCE = 'DE-8F3K2Q'

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

/**
 * The pass as `GET /v1/orders/:reference/group-pass` returns it.
 *
 * @param {object} [overrides] Fields to replace.
 * @returns {object} The body.
 */
function pass(overrides = {}) {
  return {
    data: {
      orderReference: REFERENCE,
      credential: CREDENTIAL,
      groupCode: CODE,
      credentialVersion: 1,
      issuedAt: '2026-09-01T10:00:00.000Z',
      admits: 3,
      tickets: [
        {
          id: 'ticket0000000000000000001',
          status: 'VALID',
          tier: { name: 'General' },
          seat: null,
          offered: false,
        },
        {
          id: 'ticket0000000000000000002',
          status: 'VALID',
          tier: { name: 'Reserved' },
          seat: { section: 'Stalls', row: 'C', label: '12' },
          offered: false,
        },
        {
          id: 'ticket0000000000000000003',
          status: 'TRANSFER_PENDING',
          tier: { name: 'General' },
          seat: null,
          offered: true,
        },
      ],
      ...overrides,
    },
  }
}

/**
 * Every attribute value in the document, to prove a secret is in none of them.
 *
 * @returns {string[]} The values.
 */
function attributeValues() {
  return [...document.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes].map((attribute) => attribute.value),
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('GroupPass', () => {
  it('fetches nothing and draws nothing until the buyer asks', () => {
    render(<GroupPass reference={REFERENCE} admits={3} />)

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.body.textContent).not.toContain('DEG-')
    expect(
      screen.getByText(/shown only on this device, only while this page is open/iu),
    ).toBeTruthy()
  })

  it('draws the QR without its content anywhere, and prints the group code only inside the shown pass', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValue(answer(200, pass()))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))

    const drawing = await screen.findByRole('img', {
      name: /group entry pass for 3 people, as a qr code/iu,
    })

    // Asked for with no-store, through the buyer-only endpoint.
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith(`/v1/orders/${REFERENCE}/group-pass`, {
      cache: 'no-store',
    })
    expect(drawing.querySelector('path').getAttribute('d')).toMatch(/^M\d+ \d+h/u)

    // The QR content is nowhere in the page: not as text, not in an attribute.
    expect(document.documentElement.outerHTML).not.toContain(CREDENTIAL)
    expect(document.documentElement.outerHTML).not.toContain(CREDENTIAL.slice(3))

    // The printed code is text inside the pass, and in no attribute, title or label.
    const figure = drawing.closest('figure')

    expect(within(figure).getByText(CODE)).toBeTruthy()
    expect(attributeValues().some((value) => value.includes(CODE))).toBe(false)
    expect(drawing.querySelector('title').textContent).not.toContain(CODE)
    expect(setItem).not.toHaveBeenCalled()

    // What it admits, including the ticket that is on offer.
    expect(within(figure).getByText(/admits 3\./iu)).toBeTruthy()
    expect(within(figure).getByText('Reserved · Stalls, row C, seat 12')).toBeTruthy()
    expect(within(figure).getByText(/offered to somebody; admits until they accept/iu)).toBeTruthy()
    expect(within(figure).getByText(/anybody holding this code or a screenshot/iu)).toBeTruthy()

    // Focus moves to the control that takes it away, which is outside the figure.
    const hide = screen.getByRole('button', { name: /hide group pass/iu })

    expect(document.activeElement).toBe(hide)
    expect(figure.contains(hide)).toBe(false)
    expect(figure.lastElementChild.tagName).toBe('FIGCAPTION')

    setItem.mockRestore()
  })

  it('takes the pass and its code away when hidden, and puts focus back on the button', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, pass()))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await user.click(await screen.findByRole('button', { name: /hide group pass/iu }))

    expect(screen.queryByRole('img')).toBeNull()
    expect(document.body.textContent).not.toContain(CODE)
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /show group pass/iu }),
      ),
    )
  })

  it('takes the pass away when the page is hidden', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, pass()))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await screen.findByRole('img')

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.queryByRole('img')).toBeNull()
    expect(document.body.textContent).not.toContain(CODE)

    visibility.mockRestore()
  })

  it('takes the pass away when the page is left for the back-forward cache', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, pass()))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await screen.findByRole('img')

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(screen.queryByRole('img')).toBeNull()
    expect(document.body.textContent).not.toContain(CODE)
  })

  it.each([
    [
      409,
      'TOO_FEW_TICKETS',
      /Too few tickets on this order still admit: a new group pass needs two, and one already taken out needs one/iu,
    ],
    [409, 'TOO_MANY_TICKETS', /more than 50 tickets; use each ticket’s own pass/iu],
    [409, 'ORDER_NOT_PAID', /this order is not paid, so it has no group pass/iu],
    [409, 'EVENT_CANCELLED', /this event was cancelled, so nobody is admitted/iu],
    [409, 'SOMETHING_ELSE', /cannot be shown right now/iu],
    [404, null, /this group pass is not available/iu],
    [429, null, /wait a minute/iu],
    [500, null, /could not be loaded/iu],
  ])('explains a %i %s without drawing anything', async (status, reason, message) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(status, { error: { message: 'x', ...(reason ? { reason } : {}) } }),
    )
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    // Not an interruption: the buyer asked, and the answer is polite.
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull()
  })

  it('says so when the network fails', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('offline'))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))

    expect(await screen.findByText(/check your connection and try again/iu)).toBeTruthy()
  })

  it('asks before replacing, and keeping it sends nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, pass()))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await user.click(await screen.findByRole('button', { name: /replace group pass/iu }))

    const heading = screen.getByRole('heading', { name: /replace the group pass\?/iu })
    const panel = screen.getByRole('group', { name: /replace the group pass\?/iu })

    expect(document.activeElement).toBe(heading)
    expect(
      within(panel).getByText(
        'The current group QR and code stop working. Each ticket’s own pass keeps working.',
      ),
    ).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: /keep it/iu }))

    expect(screen.queryByRole('group', { name: /replace the group pass\?/iu })).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText(CODE)).toBeTruthy()
    // "Keep it" went with the question; focus goes back to the button that
    // asked it, never to the page.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /replace group pass/iu }),
    )
  })

  it('replaces the pass, says the old one stopped working, and shows the new one', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, pass()))
      .mockResolvedValueOnce(
        answer(200, { data: { credentialVersion: 2, rotatedAt: '2026-09-02T10:00:00.000Z' } }),
      )
      .mockResolvedValueOnce(
        answer(
          200,
          pass({ credential: NEXT_CREDENTIAL, groupCode: NEXT_CODE, credentialVersion: 2 }),
        ),
      )
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await user.click(await screen.findByRole('button', { name: /replace group pass/iu }))
    await user.click(screen.getByRole('button', { name: /replace it/iu }))

    expect(await screen.findByText(NEXT_CODE)).toBeTruthy()
    expect(document.body.textContent).not.toContain(CODE)
    expect(document.documentElement.outerHTML).not.toContain(NEXT_CREDENTIAL)
    expect(apiFetch.mock.calls).toEqual([
      [`/v1/orders/${REFERENCE}/group-pass`, { cache: 'no-store' }],
      [`/v1/orders/${REFERENCE}/group-pass/rotate`, { method: 'POST' }],
      [`/v1/orders/${REFERENCE}/group-pass`, { cache: 'no-store' }],
    ])
    expect(
      screen
        .getByText('Replaced. The old group QR and code no longer work.')
        .getAttribute('aria-live'),
    ).toBe('polite')
  })

  it('keeps the pass it has when replacing is refused, and says why', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, pass()))
      .mockResolvedValueOnce(answer(429, { error: { message: 'x' } }))
    render(<GroupPass reference={REFERENCE} admits={3} />)

    await user.click(screen.getByRole('button', { name: /show group pass/iu }))
    await user.click(await screen.findByRole('button', { name: /replace group pass/iu }))
    await user.click(screen.getByRole('button', { name: /replace it/iu }))

    expect(await screen.findByText(/wait a minute/iu)).toBeTruthy()
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/no longer work/iu)).toBeNull()
  })
})
