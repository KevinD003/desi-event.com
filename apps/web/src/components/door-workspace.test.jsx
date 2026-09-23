import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../lib/qr-decode.js', () => ({ decodeFrame: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { decodeFrame } = await import('../lib/qr-decode.js')
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

/**
 * What React said while a case ran. React prints a switch between a
 * controlled and an uncontrolled input once per module load, so a check made
 * only by the cases that hydrate would miss it whenever an earlier case
 * printed it first: the whole file is watched instead, and whichever case
 * provokes a complaint is the one that fails. jsdom's own "not implemented"
 * notices (the older camera cases do not stub `play()`) are the only lines
 * let through, by name.
 */
const complaints = []

/**
 * Mismatches React recovered from while hydrating. React reports those to
 * `onRecoverableError`, not to the console, so every hydration here goes
 * through {@link hydrate} and hands them to this list.
 */
const recovered = []

/**
 * Hydrate server-drawn markup, keeping whatever React had to recover from.
 *
 * @param {HTMLElement} container The server-drawn markup.
 * @param {JSX.Element} tree What the client renders into it.
 * @returns {object} The root.
 */
function hydrate(container, tree) {
  return hydrateRoot(container, tree, { onRecoverableError: (error) => recovered.push(error) })
}

/**
 * Record a console line unless it is jsdom saying it cannot play media.
 *
 * @param {...unknown} parts The arguments the console was given.
 * @returns {void}
 */
function complain(...parts) {
  const text = parts.map(String).join(' ')

  if (!/Not implemented: HTMLMediaElement/u.test(text)) complaints.push(text)
}

beforeEach(() => {
  complaints.length = 0
  recovered.length = 0
  vi.spyOn(console, 'error').mockImplementation(complain)
  vi.spyOn(console, 'warn').mockImplementation(complain)
})

afterEach(() => {
  expect(complaints, 'React or the page complained on the console').toEqual([])
  expect(recovered, 'hydration had to recover from a mismatch').toEqual([])
})

beforeEach(() => {
  apiFetch.mockReset()
  decodeFrame.mockReset()
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

  it('keeps a code typed into the server-drawn field before the script arrived', async () => {
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY]} />)
    document.body.append(container)

    try {
      // Typed while the page was only HTML: nothing was listening, no event
      // reached React, and the browser kept the text anyway.
      const field = within(container).getByLabelText(/printed ticket code/iu)

      field.value = 'det-abc123xyz'

      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY]} />)
      })

      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('det-abc123xyz')
      expect(button.disabled).toBe(false)

      apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
      await userEvent.setup().click(button)

      expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps an event chosen in the server-drawn list before the script arrived', async () => {
    const other = {
      ...ENTRY,
      event: { ...EVENT, id: 'eventbbbbbbbbbbbbbbbbbbbb', title: 'Diwali Mela' },
    }
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY, other]} />)
    document.body.append(container)

    try {
      within(container).getByLabelText(/event you are admitting to/iu).value = other.event.id

      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY, other]} />)
      })

      expect(within(container).getByLabelText(/event you are admitting to/iu).value).toBe(
        other.event.id,
      )
      expect(within(container).getByLabelText(/printed ticket code/iu)).toBeTruthy()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('offers no lookup for a server-drawn field left empty, and sends nothing', async () => {
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY]} />)
    document.body.append(container)

    try {
      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY]} />)
      })

      const user = userEvent.setup()
      const field = within(container).getByLabelText(/printed ticket code/iu)
      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('')
      expect(button.disabled).toBe(true)

      await user.click(button)
      await user.type(field, '{Enter}')

      expect(apiFetch).not.toHaveBeenCalled()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps the start of a code typed before the script arrived, and takes the rest after', async () => {
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY]} />)
    document.body.append(container)

    try {
      const field = within(container).getByLabelText(/printed ticket code/iu)

      field.value = 'det-abc'

      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY]} />)
      })

      const user = userEvent.setup()
      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('det-abc')
      expect(button.disabled).toBe(false)

      await user.type(field, '123xyz')

      expect(field.value).toBe('det-abc123xyz')

      apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
      await user.click(button)

      expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps a code pasted into the server-drawn field before the script arrived', async () => {
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY]} />)
    document.body.append(container)

    try {
      // A paste sets the value and fires `input`; with no script yet, nothing
      // hears it.
      const field = within(container).getByLabelText(/printed ticket code/iu)

      field.value = 'det-abc123xyz'
      field.dispatchEvent(new Event('input', { bubbles: true }))

      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY]} />)
      })

      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('det-abc123xyz')
      expect(button.disabled).toBe(false)

      apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
      await userEvent.setup().click(button)

      expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps a code the browser filled in before the script arrived', async () => {
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(<DoorWorkspace events={[ENTRY]} />)
    document.body.append(container)

    try {
      // Autofill sets the value and fires both `input` and `change`.
      const field = within(container).getByLabelText(/printed ticket code/iu)

      field.value = 'det-abc123xyz'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))

      await act(async () => {
        root = hydrate(container, <DoorWorkspace events={[ENTRY]} />)
      })

      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('det-abc123xyz')
      expect(button.disabled).toBe(false)

      apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
      await userEvent.setup().click(button)

      expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps a code typed before the script arrived under StrictMode', async () => {
    const tree = (
      <StrictMode>
        <DoorWorkspace events={[ENTRY]} />
      </StrictMode>
    )
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(tree)
    document.body.append(container)

    try {
      // StrictMode mounts, unmounts and mounts again. The unmount clears the
      // ticket in hand; the typed code must survive it.
      const field = within(container).getByLabelText(/printed ticket code/iu)

      field.value = 'det-abc123xyz'

      await act(async () => {
        root = hydrate(container, tree)
      })

      const button = within(container).getByRole('button', { name: /look up/iu })

      expect(field.value).toBe('det-abc123xyz')
      expect(button.disabled).toBe(false)

      apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
      await userEvent.setup().click(button)

      expect(sent(0)).toEqual({ code: 'DET-ABC123XYZ', expectedEventId: EVENT.id })
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('keeps an event chosen before the script arrived under StrictMode', async () => {
    const other = {
      ...ENTRY,
      event: { ...EVENT, id: 'eventbbbbbbbbbbbbbbbbbbbb', title: 'Diwali Mela' },
    }
    const tree = (
      <StrictMode>
        <DoorWorkspace events={[ENTRY, other]} />
      </StrictMode>
    )
    const container = document.createElement('div')
    let root

    container.innerHTML = renderToString(tree)
    document.body.append(container)

    try {
      within(container).getByLabelText(/event you are admitting to/iu).value = other.event.id

      await act(async () => {
        root = hydrate(container, tree)
      })

      expect(within(container).getByLabelText(/event you are admitting to/iu).value).toBe(
        other.event.id,
      )
      expect(within(container).getByLabelText(/printed ticket code/iu)).toBeTruthy()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
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

  /**
   * Install a camera the browser has not handed over yet, as while the
   * permission prompt is open.
   *
   * @returns {{tracks: object[], stream: object, grant: function(): Promise<void>}} Its tracks, its stream, and a way to hand it over.
   */
  function slowCamera() {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const stream = { getTracks: () => tracks }
    let resolve

    camera(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )

    return { tracks, stream, grant: () => act(async () => resolve(stream)) }
  }

  /**
   * Make the preview look as if frames were arriving, so that a decode loop,
   * if one ran, would reach the decoder.
   *
   * @returns {{play: object, context: object, getContext: object}} The spies, and the drawing context the camera is given.
   */
  function framesArrive() {
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      clearRect: vi.fn(),
    }

    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720)

    return {
      context,
      getContext: vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context),
      play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined),
    }
  }

  /**
   * Let a few frame intervals pass. The camera reads a frame every 200 ms, so
   * a decode loop that had started would have reached the decoder by then.
   *
   * @returns {Promise<void>}
   */
  function afterAFewFrames() {
    return act(() => new Promise((done) => setTimeout(done, 500)))
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

  it('turns off a camera that arrives after the steward switched to typing a code', async () => {
    const user = userEvent.setup()
    const { play } = framesArrive()
    const { tracks, grant } = slowCamera()

    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(screen.getByText('Starting the camera…')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /type the printed code/iu }))
    await grant()
    await afterAFewFrames()

    for (const track of tracks) expect(track.stop).toHaveBeenCalled()
    expect(screen.queryByLabelText(/camera preview/iu)).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(decodeFrame).not.toHaveBeenCalled()
  })

  it('turns off a camera that arrives after the page was hidden', async () => {
    const user = userEvent.setup()
    const { play } = framesArrive()
    const { tracks, stream, grant } = slowCamera()

    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(screen.getByText('Starting the camera…')).toBeTruthy()

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await grant()
      await afterAFewFrames()

      for (const track of tracks) expect(track.stop).toHaveBeenCalled()
      expect(screen.getByLabelText(/camera preview/iu).srcObject).not.toBe(stream)
      expect(play).not.toHaveBeenCalled()
      expect(decodeFrame).not.toHaveBeenCalled()
      expect(screen.getByText('The camera is off.')).toBeTruthy()
    } finally {
      delete document.hidden
      delete document.visibilityState
    }
  })

  it('turns off a camera that arrives after the door screen was left', async () => {
    const user = userEvent.setup()
    const { play } = framesArrive()
    const { tracks, grant } = slowCamera()
    const { unmount } = render(<DoorWorkspace events={[ENTRY]} />)

    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    expect(screen.getByText('Starting the camera…')).toBeTruthy()

    unmount()
    await grant()
    await afterAFewFrames()

    for (const track of tracks) expect(track.stop).toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    expect(decodeFrame).not.toHaveBeenCalled()
  })

  it('does not say the camera is on when it was stopped while the preview was starting', async () => {
    const user = userEvent.setup()
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const { play } = framesArrive()
    let playing

    play.mockImplementation(
      () =>
        new Promise((done) => {
          playing = done
        }),
    )
    camera(async () => ({ getTracks: () => tracks }))
    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))
    await waitFor(() => expect(play).toHaveBeenCalled())

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => playing())
      await afterAFewFrames()

      for (const track of tracks) expect(track.stop).toHaveBeenCalled()
      expect(screen.getByText('The camera is off.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /stop camera/iu })).toBeNull()
      expect(decodeFrame).not.toHaveBeenCalled()
    } finally {
      delete document.hidden
      delete document.visibilityState
    }
  })

  it('forgets the last pass and frame when stopped, so the same pass is looked up after a restart', async () => {
    const user = userEvent.setup()
    const pass = `pass_${'x'.repeat(40)}`
    const { context, getContext } = framesArrive()

    decodeFrame.mockResolvedValue({ pass })
    camera(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    apiFetch.mockResolvedValue(answer(200, { data: { ...ADMISSIBLE.data, method: 'QR_SCAN' } }))

    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))
    await user.click(await screen.findByRole('button', { name: /^cancel$/iu }))

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(sent(0)).toEqual({ credential: pass, expectedEventId: EVENT.id })

    // The same pass, still in front of the camera, is not looked up twice.
    await afterAFewFrames()

    expect(apiFetch).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /stop camera/iu }))

    // Nothing of the last frame survives the camera.
    const drawnOn = getContext.mock.contexts[0]

    expect(context.clearRect).toHaveBeenCalled()
    expect([drawnOn.width, drawnOn.height]).toEqual([0, 0])

    // Stopping forgot the pass, so shown again it is a new lookup.
    await user.click(screen.getByRole('button', { name: /start camera/iu }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))

    expect(sent(1)).toEqual({ credential: pass, expectedEventId: EVENT.id })
  })
})
