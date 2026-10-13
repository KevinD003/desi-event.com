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

describe('DoorWorkspace: a group pass', () => {
  const GROUP_CODE = 'DEG-ABCDEFGH2345'
  const GROUP_CREDENTIAL = `G1.${'Q'.repeat(43)}`
  const IDS = [
    'ticketaaaaaaaaaaaaaaaaaaa',
    'ticketbbbbbbbbbbbbbbbbbbb',
    'ticketccccccccccccccccccc',
  ]

  /**
   * One ticket of a group preview.
   *
   * @param {number} index Which.
   * @param {object} [overrides] Fields to change.
   * @returns {object} The ticket.
   */
  function groupTicket(index, overrides = {}) {
    return {
      ticketId: IDS[index],
      outcome: 'ADMISSIBLE',
      refusal: null,
      tier: { name: 'General Admission' },
      seat: null,
      attendeeName: `Guest ${index + 1}`,
      checkedInAt: null,
      ...overrides,
    }
  }

  const GROUP_PREVIEW = {
    data: {
      outcome: 'ADMISSIBLE',
      refusal: null,
      method: 'MANUAL_CODE',
      event: EVENT,
      tickets: [groupTicket(0), groupTicket(1), groupTicket(2)],
      counts: { admissible: 3, alreadyIn: 0, refused: 0 },
      handedOn: 1,
      previewReference: REFERENCE,
      previewExpiresAt: '2026-10-01T13:02:00.000Z',
    },
  }

  it('sends a typed group code to the group lookup, and lists a checkbox per admissible ticket', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, GROUP_PREVIEW))
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE.toLowerCase())

    expect(apiFetch.mock.calls[0][0]).toBe('/v1/tickets/admission/group/preview')
    expect(sent(0)).toEqual({ code: GROUP_CODE, expectedEventId: EVENT.id })

    const heading = await screen.findByRole('heading', { name: 'Check the group, then admit' })

    await waitFor(() => expect(document.activeElement).toBe(heading))

    const group = screen.getByRole('group', { name: 'Who is at the door now' })
    const boxes = within(group).getAllByRole('checkbox')

    expect(boxes).toHaveLength(3)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect(within(group).getByLabelText(/Guest 1 · General Admission/u)).toBeTruthy()
    // Said once on the card: the summary line carries it, and nothing repeats it.
    expect(
      within(heading.closest('section')).getAllByText(
        /handed to somebody else; they have their own pass/u,
      ),
    ).toHaveLength(1)
    expect(
      heading
        .closest('section')
        .textContent.split('1 ticket from this order was handed to somebody else').length - 1,
    ).toBe(1)
    expect(screen.getByRole('button', { name: 'Admit 3' })).toBeTruthy()
  })

  it('admits only the ticked tickets, and says what it did', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, GROUP_PREVIEW)).mockResolvedValueOnce(
      answer(200, {
        data: {
          outcome: 'ADMITTED',
          admitted: 2,
          alreadyIn: 0,
          method: 'MANUAL_CODE',
          event: EVENT,
          tickets: [0, 2].map((index) => ({
            ticketId: IDS[index],
            outcome: 'ADMITTED',
            checkedInAt: '2026-10-01T13:31:00.000Z',
            checkedInByYou: true,
            tier: { name: 'General Admission' },
            seat: null,
            attendeeName: `Guest ${index + 1}`,
          })),
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await user.click(await screen.findByLabelText(/Guest 2/u))

    expect(screen.getByRole('button', { name: 'Admit 2' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Admit 2' }))

    expect(apiFetch.mock.calls[1][0]).toBe('/v1/tickets/admission/group/check-in')
    expect(sent(1)).toEqual({
      code: GROUP_CODE,
      previewReference: REFERENCE,
      expectedEventId: EVENT.id,
      ticketIds: [IDS[0], IDS[2]],
    })

    const done = await screen.findByRole('heading', { name: 'Admitted 2' })

    expect(within(done.closest('section')).getByText('Admitted 2.')).toBeTruthy()
    expect(screen.getByText(/Group: 2 admitted/u)).toBeTruthy()

    // The session list names the people admitted, not a ticket with no name.
    const [row] = within(screen.getByRole('region', { name: 'This session' })).getAllByRole(
      'listitem',
    )

    expect(row.textContent).toMatch(/^Guest 1 and 1 more/u)
    expect(row.textContent).toMatch(/Group: 2 admitted/u)
    expect(row.textContent).not.toMatch(/No name on the ticket/u)
  })

  it('names a refused group in the session list by the tickets that were ticked', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, GROUP_PREVIEW))
      .mockResolvedValueOnce(
        answer(409, { error: { code: 'CONFLICT', reason: 'REFUNDED', message: 'x' } }),
      )
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await user.click(await screen.findByLabelText(/Guest 1/u))
    await user.click(screen.getByRole('button', { name: 'Admit 2' }))

    await screen.findByText(/This ticket was refunded/u)

    const [row] = within(screen.getByRole('region', { name: 'This session' })).getAllByRole(
      'listitem',
    )

    expect(row.textContent).toMatch(/^Guest 2 and 1 more/u)
    expect(row.textContent).toMatch(/Group: refused/u)
  })

  it('names a group with nobody left to admit by its people, or as a group pass when unnamed', async () => {
    const user = userEvent.setup()
    const allIn = (attendeeName) => ({
      data: {
        ...GROUP_PREVIEW.data,
        outcome: 'ALREADY_CHECKED_IN',
        tickets: [0, 1].map((index) =>
          groupTicket(index, {
            outcome: 'ALREADY_CHECKED_IN',
            checkedInAt: '2026-10-01T13:32:00.000Z',
            attendeeName,
          }),
        ),
        counts: { admissible: 0, alreadyIn: 2, refused: 0 },
        handedOn: 0,
        previewReference: null,
        previewExpiresAt: null,
      },
    })

    apiFetch
      .mockResolvedValueOnce(answer(200, allIn('Guest 1')))
      .mockResolvedValueOnce(answer(200, allIn(null)))
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await screen.findByRole('heading', { name: 'Nobody in this group can be admitted' })
    await user.click(screen.getByRole('button', { name: 'Next ticket' }))
    await lookUp(user, GROUP_CODE)

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'This session' })).getAllByRole('listitem'),
      ).toHaveLength(2),
    )

    const [latest, first] = within(
      screen.getByRole('region', { name: 'This session' }),
    ).getAllByRole('listitem')

    expect(first.textContent).toMatch(/^Guest 1 and 1 more/u)
    expect(first.textContent).toMatch(/Group: already in/u)
    expect(latest.textContent).toMatch(/^Group pass/u)
    expect(latest.textContent).not.toMatch(/No name on the ticket/u)
  })

  it('lists already-in and refused tickets as text, with why, and offers no box for them', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...GROUP_PREVIEW.data,
          tickets: [
            groupTicket(0),
            groupTicket(1, {
              outcome: 'ALREADY_CHECKED_IN',
              checkedInAt: '2026-10-01T13:32:00.000Z',
            }),
            groupTicket(2, { outcome: 'REFUSED', refusal: 'REFUNDED' }),
          ],
          counts: { admissible: 1, alreadyIn: 1, refused: 1 },
          handedOn: 0,
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)

    const group = await screen.findByRole('group', { name: 'Who is at the door now' })

    expect(within(group).getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText(/Guest 2 · General Admission — already in at/u)).toBeTruthy()
    expect(screen.getByText(/Guest 3 · General Admission — This ticket was refunded/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Admit 1' })).toBeTruthy()
  })

  it('refuses a changed group, offers a fresh lookup, and admits nobody', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, GROUP_PREVIEW))
      .mockResolvedValueOnce(
        answer(409, { error: { code: 'CONFLICT', reason: 'GROUP_CHANGED', message: 'x' } }),
      )
      .mockResolvedValueOnce(answer(200, GROUP_PREVIEW))
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await user.click(await screen.findByRole('button', { name: 'Admit 3' }))

    expect(await screen.findByText(/changed after it was looked up/u)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Look it up again' }))

    expect(apiFetch.mock.calls[2][0]).toBe('/v1/tickets/admission/group/preview')
    expect(sent(2)).toEqual({ code: GROUP_CODE, expectedEventId: EVENT.id })
  })

  it('does not admit with nobody ticked', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...GROUP_PREVIEW.data,
          tickets: [groupTicket(0)],
          counts: { admissible: 1, alreadyIn: 0, refused: 0 },
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await user.click(await screen.findByLabelText(/Guest 1/u))

    expect(screen.getByRole('button', { name: 'Admit 0' })).toBeDisabled()
  })

  it('keeps no group code or pass in the page once cleared', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, GROUP_PREVIEW))
    render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user, GROUP_CODE)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(document.body.innerHTML).not.toContain(GROUP_CODE)
    expect(document.body.innerHTML).not.toContain(GROUP_CREDENTIAL)
    expect(document.body.innerHTML).not.toContain(REFERENCE)
  })
})

describe('DoorWorkspace: a platform administrator', () => {
  const PLATFORM_ENTRIES = [
    {
      event: EVENT,
      organization: { id: 'orgaaaaaaaaaaaaaaaaaaaaaa', name: 'Rangoli' },
      authority: 'PLATFORM_ROLE',
      role: 'SUPER_ADMIN',
    },
    {
      event: { ...EVENT, id: 'eventbbbbbbbbbbbbbbbbbbbb', title: 'Dhol Night' },
      organization: { id: 'orgbbbbbbbbbbbbbbbbbbbbbb', name: 'Dhol Nation' },
      authority: 'PLATFORM_ROLE',
      role: 'SUPER_ADMIN',
    },
  ]

  it('says, persistently, that it admits on platform authority and is recorded', () => {
    render(<DoorWorkspace events={PLATFORM_ENTRIES} platform />)

    expect(
      screen.getByText(
        /You are admitting with platform administrator authority\. Every lookup and admission is recorded against your account on the event.s record\./u,
      ),
    ).toBeTruthy()
  })

  it('names the organisation beside each event when the list spans more than one', async () => {
    const user = userEvent.setup()

    render(<DoorWorkspace events={PLATFORM_ENTRIES} platform />)

    const options = within(screen.getByLabelText(/event you are admitting to/iu))
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options[1]).toMatch(/^Navratri Garba Night — Rangoli — /u)
    expect(options[2]).toMatch(/^Dhol Night — Dhol Nation — /u)

    await user.selectOptions(
      screen.getByLabelText(/event you are admitting to/iu),
      'eventbbbbbbbbbbbbbbbbbbbb',
    )

    expect(screen.getByText('Any event on the platform (platform administrator)')).toBeTruthy()
  })

  it('shows no platform notice to a member', () => {
    render(<DoorWorkspace events={[ENTRY]} />)

    expect(screen.queryByText(/platform administrator authority/u)).toBeNull()
  })
})

describe('DoorWorkspace: a group pass by camera', () => {
  const original = navigator.mediaDevices

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true })
  })

  it('sends a scanned group QR to the group lookup, as a QR scan', async () => {
    const user = userEvent.setup()
    const credential = `G1.${'Q'.repeat(43)}`

    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
      configurable: true,
    })
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      clearRect: vi.fn(),
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    decodeFrame.mockResolvedValue({ groupPass: credential })
    apiFetch.mockResolvedValue(
      answer(200, {
        data: {
          outcome: 'ADMISSIBLE',
          refusal: null,
          method: 'QR_SCAN',
          event: EVENT,
          tickets: [],
          counts: { admissible: 0, alreadyIn: 0, refused: 0 },
          handedOn: 0,
          previewReference: null,
          previewExpiresAt: null,
        },
      }),
    )

    render(<DoorWorkspace events={[ENTRY]} />)
    await user.click(screen.getByRole('button', { name: /scan the qr pass/iu }))
    await user.click(screen.getByRole('button', { name: /start camera/iu }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled(), { timeout: 2_000 })

    expect(apiFetch.mock.calls[0][0]).toBe('/v1/tickets/admission/group/preview')
    expect(sent(0)).toEqual({ credential, expectedEventId: EVENT.id })
    expect(document.body.innerHTML).not.toContain(credential)
  })
})

describe('DoorWorkspace: the night a ticket is for', () => {
  const NIGHT = {
    id: 'snnighttwoxxx',
    label: 'Night 2',
    startsAt: '2026-10-02T13:30:00.000Z',
    endsAt: '2026-10-02T18:30:00.000Z',
    doorsOpenAt: null,
    timezone: 'Asia/Kolkata',
  }

  it('names the night in words in the preview and in the result', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...ADMISSIBLE.data, session: NIGHT } }))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    await screen.findByRole('heading', { name: /check the ticket, then admit/iu })

    expect(screen.getByText('Night')).toBeTruthy()
    expect(screen.getByText('Night 2 · Fri, Oct 2 · 7:00 PM')).toBeTruthy()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...ADMITTED.data, session: NIGHT } }))
    await user.click(screen.getByRole('button', { name: /^admit$/iu }))

    expect(
      await screen.findByText('General Admission · Night 2 · Fri, Oct 2 · 7:00 PM'),
    ).toBeTruthy()
  })

  it('says nothing about a night on an event of one night', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...ADMISSIBLE.data, session: null } }))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    await screen.findByRole('heading', { name: /check the ticket, then admit/iu })

    expect(screen.queryByText('Night')).toBeNull()
  })
})

describe('DoorWorkspace: an event of more than one night', () => {
  const NIGHTS = [
    {
      id: 'nightoneaaaaaaaaaaaaaaaaa',
      label: 'Night 1',
      startsAt: '2026-10-01T13:30:00.000Z',
      endsAt: '2026-10-01T18:30:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'ON_SALE',
    },
    {
      id: 'nighttwoaaaaaaaaaaaaaaaaa',
      label: 'Night 2',
      startsAt: '2026-10-02T13:30:00.000Z',
      endsAt: '2026-10-02T18:30:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'ON_SALE',
    },
  ]
  const MULTI = { ...ENTRY, sessions: NIGHTS }

  beforeEach(() => {
    // Between the two nights' ends: Night 2 is tonight.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T12:00:00.000Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks which night, starts on tonight’s, and sends it with the lookup and the admission', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: { ...ADMISSIBLE.data, session: null } }))
      .mockResolvedValueOnce(answer(200, { data: { ...ADMITTED.data, session: null } }))
    render(<DoorWorkspace events={[MULTI]} />)

    const picker = screen.getByLabelText('Night you are admitting to')

    expect(picker.value).toBe(NIGHTS[1].id)

    await lookUp(user)

    expect(sent(0)).toEqual({
      code: 'DET-ABC123XYZ',
      expectedEventId: EVENT.id,
      eventSessionId: NIGHTS[1].id,
    })

    await screen.findByRole('heading', { name: /check the ticket, then admit/iu })
    // A ticket with no night of its own, on an event of several, is good for
    // every night and says so.
    expect(screen.getByText('Every night')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^admit$/iu }))

    expect(sent(1)).toMatchObject({ eventSessionId: NIGHTS[1].id })
    expect(await screen.findByText('General Admission · Every night')).toBeTruthy()
  })

  it('looks nothing up until a night is chosen, and forgets the ticket in hand when it changes', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ADMISSIBLE))
    render(<DoorWorkspace events={[MULTI]} />)

    const picker = screen.getByLabelText('Night you are admitting to')

    await user.selectOptions(picker, '')

    expect(screen.getByText('Choose the night you are admitting to first.')).toBeTruthy()
    expect(screen.queryByLabelText(/printed ticket code/iu)).toBeNull()

    await user.selectOptions(picker, NIGHTS[0].id)
    await lookUp(user)
    await screen.findByRole('heading', { name: /check the ticket, then admit/iu })

    await user.selectOptions(picker, NIGHTS[1].id)

    expect(screen.queryByRole('heading', { name: /check the ticket, then admit/iu })).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('says a ticket for another night is for that night, and never offers Admit', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMISSIBLE.data,
          outcome: 'REFUSED',
          refusal: 'WRONG_NIGHT',
          previewReference: null,
          previewExpiresAt: null,
          session: NIGHTS[0],
        },
      }),
    )
    render(<DoorWorkspace events={[MULTI]} />)
    await lookUp(user)

    await screen.findByRole('heading', { name: 'Do not admit' })

    expect(
      screen.getByText(
        'This ticket is for a different night. Do not admit. It is for Night 1 · Thu, Oct 1 · 7:00 PM.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^admit$/iu })).toBeNull()
  })

  it('tells a steward a season pass is already in tonight, and that it admits once each night', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMISSIBLE.data,
          outcome: 'ALREADY_CHECKED_IN',
          previewReference: null,
          previewExpiresAt: null,
          session: null,
          checkedInAt: '2026-10-02T13:40:00.000Z',
        },
      }),
    )
    render(<DoorWorkspace events={[MULTI]} />)
    await lookUp(user)

    await screen.findByRole('heading', { name: /already admitted/iu })

    expect(
      screen.getByText(
        /already admitted on Night 2 · Fri, Oct 2 · 7:00 PM at .*A ticket for every night admits once each night\./u,
      ),
    ).toBeTruthy()
  })

  it('names each group ticket’s night, and every night for a season pass', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          outcome: 'ADMISSIBLE',
          refusal: null,
          method: 'MANUAL_CODE',
          event: EVENT,
          tickets: [
            {
              ticketId: 'ticketaaaaaaaaaaaaaaaaaaa',
              outcome: 'ADMISSIBLE',
              refusal: null,
              tier: { name: 'Season' },
              seat: null,
              session: null,
              attendeeName: 'Guest 1',
              checkedInAt: null,
            },
            {
              ticketId: 'ticketbbbbbbbbbbbbbbbbbbb',
              outcome: 'REFUSED',
              refusal: 'WRONG_NIGHT',
              tier: { name: 'Night 1 only' },
              seat: null,
              session: NIGHTS[0],
              attendeeName: 'Guest 2',
              checkedInAt: null,
            },
          ],
          counts: { admissible: 1, alreadyIn: 0, refused: 1 },
          handedOn: 0,
          previewReference: REFERENCE,
          previewExpiresAt: '2026-10-02T12:02:00.000Z',
        },
      }),
    )
    render(<DoorWorkspace events={[MULTI]} />)
    await lookUp(user, 'deg-abcdefgh2345')

    await screen.findByRole('heading', { name: 'Check the group, then admit' })

    expect(sent(0)).toMatchObject({ eventSessionId: NIGHTS[1].id })
    expect(screen.getByLabelText('Guest 1 · Season · Every night')).toBeTruthy()
    expect(
      screen.getByText(
        'Guest 2 · Night 1 only · Night 1 · Thu, Oct 1 · 7:00 PM — This ticket is for a different night. Do not admit.',
      ),
    ).toBeTruthy()
  })
})

describe('DoorWorkspace: taking a payment at the door (SPEC3 §12.8, SPEC3-XI §12.8)', () => {
  const OWED = {
    data: {
      ...ADMISSIBLE.data,
      payment: {
        dueCents: 4000,
        currency: 'USD',
        paid: false,
        booking: { otherUnpaidTickets: 2, otherUnpaidCents: 8000, groupPass: true },
      },
    },
  }

  const PAID_ADMISSION = {
    data: {
      ...ADMITTED.data,
      payment: {
        recordedCents: 4000,
        venuePaymentId: 'paymentaaaaaaaaaaaaaaaaaa',
        byThisRequest: true,
      },
    },
  }

  /**
   * The polite region the workspace says things in.
   *
   * @param {HTMLElement} container The render container.
   * @returns {HTMLElement} The region.
   */
  function politeRegion(container) {
    return container.querySelector('p[role="status"][aria-live="polite"]')
  }

  it('says what to take and what else the same holder owes, then takes it and admits in one step', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, OWED))
    const { container } = render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user)

    const card = (
      await screen.findByRole('heading', { name: 'Check the ticket, then admit' })
    ).closest('section')

    expect(within(card).getByRole('heading', { name: 'Payment to take' })).toBeTruthy()
    expect(
      within(card).getByText('Take $40.00 for this ticket before letting them in.'),
    ).toBeTruthy()
    expect(
      within(card).getByText(
        'This booking has 2 more tickets to pay at the door ($80.00). Use the group pass to take payment for several at once.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /^admit$/iu })).toBeNull()
    expect(politeRegion(container).textContent).toBe('Found: Asha Door. Payment to take: $40.00.')

    apiFetch.mockResolvedValueOnce(answer(200, PAID_ADMISSION))
    await user.click(within(card).getByRole('button', { name: 'Payment taken: $40.00 — admit' }))

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/tickets/check-in')
    expect(sent(1)).toEqual({
      code: 'DET-ABC123XYZ',
      previewReference: REFERENCE,
      expectedEventId: EVENT.id,
      payment: { amountCents: 4000 },
    })

    const done = await screen.findByRole('heading', { name: 'Admitted' })

    await waitFor(() => expect(document.activeElement).toBe(done))
    expect(
      within(done.closest('section')).getByText('Admitted. Payment recorded: $40.00.'),
    ).toBeTruthy()
    // Said once, in the polite region, not repeated there twice.
    expect(politeRegion(container).textContent).toBe(
      'Admitted: Asha Door. Payment recorded: $40.00.',
    )
    expect(screen.getByText(/Admitted, payment taken/u)).toBeTruthy()
  })

  it('counts only the holder’s own tickets, and offers the group pass only when it covers them', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...OWED.data,
          payment: {
            ...OWED.data.payment,
            booking: { otherUnpaidTickets: 1, otherUnpaidCents: 4000, groupPass: false },
          },
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    expect(
      await screen.findByText('This booking has 1 more ticket to pay at the door ($40.00).'),
    ).toBeTruthy()
    expect(screen.queryByText(/Use the group pass/u)).toBeNull()
  })

  it('says nothing about the booking when the holder owes nothing else', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...OWED.data,
          payment: {
            ...OWED.data.payment,
            booking: { otherUnpaidTickets: 0, otherUnpaidCents: 0, groupPass: false },
          },
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    expect(
      await screen.findByText('Take $40.00 for this ticket before letting them in.'),
    ).toBeTruthy()
    expect(screen.queryByText(/This booking has/u)).toBeNull()
  })

  it('admits a ticket paid at the door on an earlier night as usual, taking nothing and saying none was taken', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: { ...ADMISSIBLE.data, payment: { dueCents: 4000, currency: 'CAD', paid: true } },
      }),
    )
    const { container } = render(<DoorWorkspace events={[ENTRY]} />)

    await lookUp(user)

    expect(await screen.findByText(/Paid at the door earlier/u)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Payment to take' })).toBeNull()

    // The API's answer for such a ticket carries the payment recorded on the
    // earlier night, not one made now (`recordedPaymentOf`, admission.js).
    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMITTED.data,
          payment: {
            recordedCents: 4000,
            venuePaymentId: 'paymentaaaaaaaaaaaaaaaaaa',
            byThisRequest: false,
          },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: /^admit$/iu }))

    expect(sent(1).payment).toBeUndefined()

    const card = (await screen.findByRole('heading', { name: 'Admitted' })).closest('section')

    expect(card.textContent).not.toMatch(/Payment recorded/u)
    expect(card.textContent).not.toMatch(/\$40\.00/u)
    expect(within(card).getByText('Paid at the door earlier')).toBeTruthy()
    expect(politeRegion(container).textContent).not.toMatch(/Payment recorded/u)
  })

  it('says an unanswered payment may or may not be recorded, and the retry cannot record it twice', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, OWED))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(await screen.findByRole('button', { name: 'Payment taken: $40.00 — admit' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No answer from the server. The payment may or may not have been recorded, and the ticket may or may not be in. Keep the money in hand and press Retry: it cannot record the payment twice.',
    )

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...PAID_ADMISSION.data,
          outcome: 'ALREADY_CHECKED_IN',
          checkedInByYou: true,
          payment: { ...PAID_ADMISSION.data.payment, byThisRequest: false },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Retry: payment taken $40.00 — admit' }))

    // The identical request: the same pass, reference and amount.
    expect(sent(2)).toEqual(sent(1))
    expect(sent(2).payment).toEqual({ amountCents: 4000 })

    const done = await screen.findByRole('heading', { name: 'Admitted' })

    expect(
      within(done.closest('section')).getByText(
        'Admitted (confirmed on retry). Payment recorded: $40.00.',
      ),
    ).toBeTruthy()
  })

  it('tells the steward another steward’s payment covers a ticket somebody else admitted', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, OWED))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMITTED.data,
          outcome: 'ALREADY_CHECKED_IN',
          checkedInByYou: false,
          payment: {
            recordedCents: 4000,
            venuePaymentId: 'paymentaaaaaaaaaaaaaaaaaa',
            byThisRequest: false,
          },
        },
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Payment taken: $40.00 — admit' }))

    expect(
      await screen.findByRole('heading', { name: 'Already admitted by another steward' }),
    ).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(
      /Already admitted by another steward\. Their payment record covers this ticket; do not take the money again\./u,
    )
    expect(screen.queryByText(/Payment recorded/u)).toBeNull()
  })

  it.each([
    [409, 'PAYMENT_DUE', 'Take $40.00 for this ticket before letting it in.'],
    [
      422,
      'PAYMENT_AMOUNT_MISMATCH',
      "The amount doesn't match what this ticket owes ($40.00). Look the ticket up again.",
    ],
    [
      409,
      'PAYMENT_NOT_RECORDED',
      'The payment was not recorded because the booking changed at the same moment. Look the ticket up again; nothing was recorded and nobody was let in.',
    ],
  ])(
    'says the API’s %s %s sentence, admits nobody, and offers a fresh lookup',
    async (status, code, message) => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValueOnce(answer(200, OWED))
      render(<DoorWorkspace events={[ENTRY]} />)
      await lookUp(user)

      apiFetch.mockResolvedValueOnce(answer(status, { error: { code, message } }))
      await user.click(await screen.findByRole('button', { name: 'Payment taken: $40.00 — admit' }))

      expect((await screen.findByRole('alert')).textContent).toBe(message)
      expect(screen.queryByRole('heading', { name: 'Admitted' })).toBeNull()

      apiFetch.mockResolvedValueOnce(answer(200, OWED))
      await user.click(screen.getByRole('button', { name: /look it up again/iu }))

      expect(apiFetch.mock.calls[2][0]).toBe('/v1/tickets/admission/preview')
    },
  )

  it('heads a ticket cancelled unpaid with its own words at lookup, and offers no admission', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          ...ADMISSIBLE.data,
          outcome: 'REFUSED',
          refusal: 'UNPAID_CANCELLED',
          previewReference: null,
        },
      }),
    )
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    const heading = await screen.findByRole('heading', { name: 'Cancelled — not paid' })

    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByRole('alert').textContent).toBe(
      "This ticket was cancelled because it had not been paid for. Don't let it in.",
    )
    expect(screen.queryByRole('button', { name: /admit/iu })).toBeNull()
  })

  it('heads a ticket cancelled after its lookup the same way when the admission is refused', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, OWED))
    render(<DoorWorkspace events={[ENTRY]} />)
    await lookUp(user)

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'CONFLICT',
          message: 'This ticket was cancelled because it was not paid for.',
          reason: 'UNPAID_CANCELLED',
        },
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Payment taken: $40.00 — admit' }))

    expect(await screen.findByRole('heading', { name: 'Cancelled — not paid' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(
      /had not been paid for\. Don't let it in\./u,
    )
    expect(screen.queryByRole('button', { name: /admit/iu })).toBeNull()
  })

  describe('a group pass', () => {
    const IDS = [
      'ticketaaaaaaaaaaaaaaaaaaa',
      'ticketbbbbbbbbbbbbbbbbbbb',
      'ticketccccccccccccccccccc',
    ]

    /**
     * One ticket of a group preview that owes at the door.
     *
     * @param {number} index Which.
     * @param {object} [overrides] Fields to change.
     * @returns {object} The ticket.
     */
    function owing(index, overrides = {}) {
      return {
        ticketId: IDS[index],
        outcome: 'ADMISSIBLE',
        refusal: null,
        tier: { name: 'General Admission' },
        seat: null,
        attendeeName: `Guest ${index + 1}`,
        checkedInAt: null,
        dueCents: 4000,
        paid: false,
        ...overrides,
      }
    }

    const GROUP_OWES = {
      data: {
        outcome: 'ADMISSIBLE',
        refusal: null,
        method: 'MANUAL_CODE',
        event: EVENT,
        tickets: [owing(0), owing(1), owing(2, { paid: true })],
        counts: { admissible: 3, alreadyIn: 0, refused: 0 },
        handedOn: 2,
        previewReference: REFERENCE,
        previewExpiresAt: '2026-10-01T13:02:00.000Z',
        payment: { dueCents: 8000, currency: 'USD', handedOnUnpaidTickets: 2 },
      },
    }

    it('sums what the ticked tickets owe as the boxes change, and sends that sum with the admission', async () => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValueOnce(answer(200, GROUP_OWES))
      const { container } = render(<DoorWorkspace events={[ENTRY]} />)

      await lookUp(user, 'DEG-ABCDEFGH2345')

      const card = (
        await screen.findByRole('heading', { name: 'Check the group, then admit' })
      ).closest('section')

      expect(within(card).getByText('Payment to take for the ticked tickets: $80.00')).toBeTruthy()
      expect(within(card).getAllByText('Pay $40.00 at the door')).toHaveLength(2)
      expect(within(card).getByText('Paid at the door earlier')).toBeTruthy()
      expect(
        within(card).getByText(
          '2 more tickets of this booking were passed on to other people, who pay at the door with their own tickets.',
        ),
      ).toBeTruthy()

      await user.click(within(card).getByLabelText(/Guest 2/u))

      expect(within(card).getByText('Payment to take for the ticked tickets: $40.00')).toBeTruthy()
      expect(politeRegion(container).textContent).toBe(
        'Payment to take for the ticked tickets: $40.00.',
      )

      apiFetch.mockResolvedValueOnce(
        answer(200, {
          data: {
            outcome: 'ADMITTED',
            admitted: 2,
            alreadyIn: 0,
            method: 'MANUAL_CODE',
            event: EVENT,
            tickets: [0, 2].map((index) => ({
              ticketId: IDS[index],
              outcome: 'ADMITTED',
              checkedInAt: '2026-10-01T13:31:00.000Z',
              checkedInByYou: true,
              tier: { name: 'General Admission' },
              seat: null,
              attendeeName: `Guest ${index + 1}`,
            })),
            payment: {
              recordedCents: 4000,
              venuePaymentId: 'paymentaaaaaaaaaaaaaaaaaa',
              byThisRequest: true,
            },
          },
        }),
      )
      await user.click(
        within(card).getByRole('button', { name: 'Payment taken: $40.00 — admit 2' }),
      )

      expect(sent(1)).toEqual({
        code: 'DEG-ABCDEFGH2345',
        previewReference: REFERENCE,
        expectedEventId: EVENT.id,
        ticketIds: [IDS[0], IDS[2]],
        paymentCents: 4000,
      })

      const done = await screen.findByRole('heading', { name: 'Admitted 2' })

      expect(within(done.closest('section')).getByText('Payment recorded: $40.00.')).toBeTruthy()
      expect(politeRegion(container).textContent).toBe('Admitted 2. Payment recorded: $40.00.')
    })

    it('sends no payment when none of the ticked tickets owes one', async () => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValueOnce(answer(200, GROUP_OWES))
      render(<DoorWorkspace events={[ENTRY]} />)

      await lookUp(user, 'DEG-ABCDEFGH2345')
      await user.click(await screen.findByLabelText(/Guest 1/u))
      await user.click(screen.getByLabelText(/Guest 2/u))

      expect(screen.getByText('Payment to take for the ticked tickets: $0.00')).toBeTruthy()

      apiFetch.mockResolvedValueOnce(
        answer(409, { error: { code: 'CONFLICT', message: 'x', reason: 'GROUP_CHANGED' } }),
      )
      await user.click(screen.getByRole('button', { name: 'Admit 1' }))

      expect(sent(1)).toEqual({
        code: 'DEG-ABCDEFGH2345',
        previewReference: REFERENCE,
        expectedEventId: EVENT.id,
        ticketIds: [IDS[2]],
      })
    })

    it('says an unanswered group payment as money, and retries the identical request', async () => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValueOnce(answer(200, GROUP_OWES))
      render(<DoorWorkspace events={[ENTRY]} />)

      await lookUp(user, 'DEG-ABCDEFGH2345')

      apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      await user.click(
        await screen.findByRole('button', { name: 'Payment taken: $80.00 — admit 3' }),
      )

      expect((await screen.findByRole('alert')).textContent).toMatch(/Keep the money in hand/u)

      apiFetch.mockResolvedValueOnce(
        answer(409, { error: { code: 'CONFLICT', message: 'x', reason: 'GROUP_CHANGED' } }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Retry: payment taken $80.00 — admit 3' }),
      )

      expect(sent(2)).toEqual(sent(1))
      expect(sent(2).paymentCents).toBe(8000)
    })
  })
})
