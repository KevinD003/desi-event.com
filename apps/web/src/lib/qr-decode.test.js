/**
 * Decoding a frame: what the door is handed, by shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const jsQR = vi.fn()

vi.mock('jsqr', () => ({ default: jsQR }))

const { decodeFrame } = await import('./qr-decode.js')

const FRAME = { data: new Uint8ClampedArray(4), width: 1, height: 1 }

beforeEach(() => {
  jsQR.mockReset()
})

describe('decodeFrame', () => {
  it('hands a ticket pass on as a pass', async () => {
    jsQR.mockReturnValue({ data: 'a'.repeat(43) })

    expect(await decodeFrame(FRAME)).toEqual({ pass: 'a'.repeat(43) })
  })

  it('hands a group pass on as a group pass, never as a ticket pass', async () => {
    const group = `G1.${'Q'.repeat(43)}`

    jsQR.mockReturnValue({ data: group })

    expect(await decodeFrame(FRAME)).toEqual({ groupPass: group })
  })

  it('reports anything else as not a pass, without its text', async () => {
    jsQR.mockReturnValue({ data: 'https://menu.example/today' })

    expect(await decodeFrame(FRAME)).toEqual({ other: true })
  })

  it('reports nothing when no code was found', async () => {
    jsQR.mockReturnValue(null)

    expect(await decodeFrame(FRAME)).toBeNull()
  })
})
