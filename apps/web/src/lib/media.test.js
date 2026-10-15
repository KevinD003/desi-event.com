import { describe, expect, it } from 'vitest'

import {
  absoluteMediaUrl,
  mediaReadFailure,
  mediaSrc,
  precheckImageFile,
  uploadPath,
} from './media.js'

const IMAGE = { id: 'cmedia0000000000000000001', url: '/v1/media/cmedia0000000000000000001' }

describe('mediaSrc', () => {
  it('turns an API media URL into its same-origin address', () => {
    expect(mediaSrc(IMAGE)).toBe('/api/v1/media/cmedia0000000000000000001')
  })

  it.each([
    [null],
    [undefined],
    [{}],
    [{ url: 'https://tracker.example/pixel.png' }],
    [{ url: '//tracker.example/pixel.png' }],
    [{ url: '/v1/media/cmedia0000000000000000001?w=1' }],
    [{ url: '/v1/media/../auth/me' }],
    [{ url: '/v1/events/x' }],
  ])('refuses %j', (image) => {
    expect(mediaSrc(image)).toBeNull()
  })
})

describe('absoluteMediaUrl', () => {
  it('joins the site origin once', () => {
    expect(absoluteMediaUrl(IMAGE, 'https://desi-event.example/')).toBe(
      'https://desi-event.example/api/v1/media/cmedia0000000000000000001',
    )
  })

  it('answers null for no image or no origin', () => {
    expect(absoluteMediaUrl(null, 'https://desi-event.example')).toBeNull()
    expect(absoluteMediaUrl(IMAGE, '')).toBeNull()
  })
})

describe('uploadPath', () => {
  it('puts what the picture is in the query, encoded', () => {
    const path = uploadPath('cevent0000000000000000001', {
      kind: 'EVENT_GALLERY',
      altText: 'Dancers & drummers: 100% joy',
      revision: 4,
    })
    const url = new URL(path, 'https://x.test')

    expect(url.pathname).toBe('/v1/events/cevent0000000000000000001/media')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'EVENT_GALLERY',
      altText: 'Dancers & drummers: 100% joy',
      revision: '4',
    })
  })
})

describe('precheckImageFile', () => {
  const png = () =>
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], {
      type: 'image/png',
    })

  it('passes a PNG', async () => {
    expect(await precheckImageFile(png())).toBeNull()
  })

  it('asks for a file when there is none, and refuses an empty one', async () => {
    expect(await precheckImageFile(null)).toMatch(/Choose a picture/)
    expect(await precheckImageFile(new Blob([]))).toMatch(/empty/)
  })

  it('refuses a file over 10 MB without reading it', async () => {
    const big = {
      size: 11 * 1024 * 1024,
      slice: () => {
        throw new Error('read')
      },
    }

    expect(await precheckImageFile(big)).toMatch(/11\.0 MB; pictures can be at most 10 MB/)
  })

  it('names an SVG that calls itself a PNG', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'], {
      type: 'image/png',
    })

    expect(await precheckImageFile(svg)).toBe(
      'That file is an SVG drawing, not a JPEG, PNG or WebP picture.',
    )
  })

  it('suggests JPEG for a phone’s HEIC photo, and says plainly when it cannot tell', async () => {
    const heic = new Blob([
      new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    ])

    expect(await precheckImageFile(heic)).toMatch(/HEIC photo.*save or share a photo as JPEG/)
    expect(await precheckImageFile(new Blob(['plain words']))).toBe(
      'That file is not a JPEG, PNG or WebP picture.',
    )
  })
})

describe('mediaReadFailure', () => {
  it('keeps the facts a refusal is drawn from, and never the message', () => {
    const error = Object.assign(new Error('Internal detail: pg/abc'), {
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    })

    expect(mediaReadFailure(error)).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    })
  })

  it('reads anything else as a failure with no response', () => {
    expect(mediaReadFailure(undefined)).toEqual({ status: 0, code: null, retryAfterSeconds: null })
    expect(mediaReadFailure(new TypeError('fetch failed'))).toEqual({
      status: 0,
      code: null,
      retryAfterSeconds: null,
    })
  })
})
