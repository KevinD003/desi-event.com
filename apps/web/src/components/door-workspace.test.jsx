import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { DoorWorkspace } = await import('./door-workspace.jsx')

const EVENT = {
  id: 'eventaaaaaaaaaaaaaaaaaaaa',
  title: 'Navratri Garba Night',
  startsAt: '2026-10-01T13:30:00.000Z',
  endsAt: '2026-10-01T18:30:00.000Z',
  timezone: 'Asia/Kolkata',
  status: 'ON_SALE',
}

const ENTRY = {
  event: EVENT,
  organization: { id: 'orgaaaaaaaaaaaaaaaaaaaaaa', name: 'Rangoli' },
  authority: 'EVENT_SCOPE',
  role: 'SCANNER',
}

const REFERENCE = `${'a'.repeat(40)}.${'b'.repeat(43)}`

const ADMISSIBLE = {
  data: {
    outcome: 'ADMISSIBLE',
    refusal: null,
    method: 'MANUAL_CODE',
    event: EVENT,
    tier: { name: 'General Admission' },
    seat: null,
    attendeeName: 'Asha Door',
    checkedInAt: null,
    previewReference: REFERENCE,
    previewExpiresAt: '2026-10-01T13:02:00.000Z',
  },
}

const ADMITTED = {
  data: {
    outcome: 'ADMITTED',
    checkedInAt: '2026-10-01T13:31:00.000Z',
    method: 'MANUAL_CODE',
    checkedInByYou: true,
    event: EVENT,
    tier: { name: 'General Admission' },
    seat: null,
    attendeeName: 'Asha Door',
  },
}

/**
 * A Response-shaped stub.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {object} The stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * The JSON body of the nth call.
 *
 * @param {number} index Which call.
 * @returns {object} The parsed body.
 */
function sent(index) {
  return JSON.parse(apiFetch.mock.calls[index][1].body)
}

/**
 * Type a code and look it up.
 *
 * @param {object} user A userEvent instance.
 * @param {string} [code] The code.
 * @returns {Promise<void>}
 */
async function lookUp(user, code = 'det-abc123xyz') {
  await user.type(screen.getByLabelText(/printed ticket code/iu), code)
  await user.click(screen.getByRole('button', { name: /look up/iu }))
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('DoorWorkspace: looking up, then admitting', () => {
  it('shows the event and the authority the door rests on', () => {
    render(<DoorWorkspace events={[ENTRY]} />)

    expect(screen.getByText(EVENT.title)).toBeTruthy()
    expect(screen.getByText('Assigned to this event (scanner)')).toBeTruthy()
  })

  it('looks a ticket up without admitting it, and names who it is', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user)

    const heading = await screen.findByRole('heading', { name: /check the ticket, then admit/iu })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/tickets/admission/preview')
    expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    expect(screen.getByText('Asha Door')).toBeTruthy()
    expect(document.activeElement).toBe(heading)
  })

  it('admits only when Admit is pressed, with the same code and the reference, once', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    let resolve
    apiFetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )

    const admit = await screen.findByRole('button', { name: /^admit$/iu })

    await user.click(admit)
    // A second press while the first is in flight sends nothing.
    await user.click(admit)

    await act(async () => resolve(answer(200, ADMITTED)))

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/tickets/check-in')
    expect(sent(1)).toEqual({
      code: 'DET-ABC123XYZ',
      previewReference: REFERENCE,
      expectedEventId: EVENT.id,
    })
    expect(await screen.findByRole('heading', { name: /^admitted$/iu })).toBe(
      document.activeElement,
    )
    // The recent list has the name and the outcome, and the code is gone.
    expect(within(screen.getByRole('list')).getByText(/admitted/iu)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/DET-ABC123XYZ/u)
  })

  it('never offers Admit for a ticket that is already in', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMISSIBLE.data,
          outcome: 'ALREADY_CHECKED_IN',
          previewReference: null,
          previewExpiresAt: null,
          checkedInAt: '2026-10-01T13:10:00.000Z',
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    expect(await screen.findByRole('heading', { name: /already admitted/iu })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^admit$/iu })).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/already admitted/iu)
  })

  it('says a refusal plainly and offers no way to admit', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMISSIBLE.data,
          outcome: 'REFUSED',
          refusal: 'REFUNDED',
          previewReference: null,
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    expect(await screen.findByRole('heading', { name: /do not admit/iu })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/refunded/iu)
    expect(screen.queryByRole('button', { name: /^admit$/iu })).toBeNull()
  })

  it('answers a lookup that found nothing without saying why it found nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(404, { error: { code: 'NOT_FOUND', message: 'x' } }))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/no ticket matches/iu)
    expect(screen.queryByRole('button', { name: /^admit$/iu })).toBeNull()
  })

  it('reports an unanswered admission as uncertain, and retries the identical request', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(await screen.findByRole('button', { name: /^admit$/iu }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/may or may not/iu)

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: { ...ADMITTED.data, outcome: 'ALREADY_CHECKED_IN', checkedInByYou: true },
      }),
    )
    await user.click(screen.getByRole('button', { name: /retry admission/iu }))

    expect(sent(2)).toEqual(sent(1))
    expect(await screen.findByRole('heading', { name: /^admitted$/iu })).toBeTruthy()
    expect(screen.getByText(/the retry changed nothing/iu)).toBeTruthy()
  })

  it('looks the ticket up again when the lookup has expired', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    apiFetch.mockResolvedValueOnce(
      answer(409, { error: { code: 'CONFLICT', message: 'x', reason: 'PREVIEW_EXPIRED' } }),
    )
    await user.click(await screen.findByRole('button', { name: /^admit$/iu }))

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    await user.click(await screen.findByRole('button', { name: /look it up again/iu }))

    expect(apiFetch.mock.calls[2][0]).toBe('/v1/tickets/admission/preview')
    expect(sent(2)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
  })

  it('admits nobody while offline, and says there is no offline admission', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    render(<DoorWorkspace events={[ENTRY]} />)

    expect(await screen.findByText(/there is no offline admission/iu)).toBeTruthy()
    expect(screen.getByRole('button', { name: /look up/iu }).disabled).toBe(true)

    online.mockRestore()
  })

  it('asks which event first when there is more than one', () => {
    render(
      <DoorWorkspace
        events={[
          ENTRY,
          { ...ENTRY, event: { ...EVENT, id: 'eventbbbbbbbbbbbbbbbbbbbb', title: 'Diwali Mela' } },
        ]}
      />,
    )

    expect(screen.getByLabelText(/event you are admitting to/iu)).toBeTruthy()
    expect(screen.queryByLabelText(/printed ticket code/iu)).toBeNull()
  })
})

describe('DoorWorkspace: the camera', () => {
  const original = navigator.mediaDevices

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true })
  })

  /**
   * Install a fake camera.
   *
   * @param {function(): Promise<object>} getUserMedia The implementation.
   * @returns {object} The mock.
   */
  function camera(getUserMedia) {
    const mock = vi.fn(getUserMedia)

    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mock },
      configurable: true,
    })

    return mock
  }

  it('asks for the camera only when the steward presses Start camera', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    const getUserMedia = camera(async () => ({ getTracks: () => [{ stop }] }))

    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))

    expect(getUserMedia).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false })

    await user.click(await screen.findByRole('button', { name: /stop camera/iu }))

    expect(stop).toHaveBeenCalled()
  })

  it('stops every track when the steward switches to typing a code', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()

    camera(async () => ({ getTracks: () => [{ stop }] }))
    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))
    await screen.findByRole('button', { name: /stop camera/iu })
    await user.click(screen.getByRole('button', { name: /type the printed code/iu }))

    expect(stop).toHaveBeenCalled()
  })

  it('explains a refused permission and offers the printed code', async () => {
    const user = userEvent.setup()

    camera(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    })
    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(await screen.findByText(/camera permission was refused/iu)).toBeTruthy()
  })

  it('explains a device with no usable camera', async () => {
    const user = userEvent.setup()

    camera(async () => {
      throw Object.assign(new Error('none'), { name: 'NotFoundError' })
    })
    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(await screen.findByText(/no camera could be started/iu)).toBeTruthy()
  })

  it('explains a browser with no camera API, and does not offer to start one', async () => {
    const user = userEvent.setup()

    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))

    expect(await screen.findByText(/cannot use a camera here/iu)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start camera/iu })).toBeNull()
  })
})
