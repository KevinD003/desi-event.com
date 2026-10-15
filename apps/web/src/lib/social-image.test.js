// @vitest-environment node

/**
 * The social card's rules, and one real render through `next/og`.
 *
 * Node rather than jsdom (the directive above): the renderer hands Resvg a
 * `Uint8Array`, and jsdom's encoder makes one from another realm that Resvg
 * does not recognise.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  SOCIAL_IMAGE_CACHE_CONTROL,
  SOCIAL_IMAGE_SIZE,
  coverIsEmbeddable,
  fetchPublicCover,
  posterDataUri,
  publicEventForCard,
  renderSocialImage,
  socialImageFor,
  socialImagePlan,
} from './social-image.js'

const EVENT = {
  slug: 'garba-night',
  title: 'Garba Night',
  category: 'GARBA_DANDIYA',
  status: 'ON_SALE',
}

/**
 * A cover payload.
 *
 * @param {object} [overrides] Field overrides.
 * @returns {object} The payload.
 */
function cover(overrides = {}) {
  return {
    id: 'cmedia0000000000000000001',
    url: '/v1/media/cmedia0000000000000000001',
    altText: 'Dancers circling a lit garbo',
    width: 1200,
    height: 630,
    contentType: 'image/png',
    ...overrides,
  }
}

/** The first bytes of a PNG, which is all the plan reads of one. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])

/**
 * A JPEG with an EXIF orientation, or none.
 *
 * @param {number|null} orientation The orientation.
 * @returns {Uint8Array} The bytes.
 */
function jpeg(orientation) {
  const head = [0xff, 0xd8]

  if (orientation !== null) {
    const payload = [
      ...Buffer.from('Exif\0\0', 'latin1'),
      0x4d,
      0x4d,
      0,
      0x2a,
      0,
      0,
      0,
      8,
      0,
      1,
      0x01,
      0x12,
      0,
      3,
      0,
      0,
      0,
      1,
      0,
      orientation,
      0,
      0,
      0,
      0,
      0,
      0,
    ]
    head.push(0xff, 0xe1, 0, payload.length + 2, ...payload)
  }

  return new Uint8Array([...head, 0xff, 0xda, 0, 2, 0xff, 0xd9])
}

describe('socialImageFor', () => {
  it('names the cover, so the address changes when the cover does', () => {
    expect(socialImageFor({ ...EVENT, coverImage: cover() })).toEqual({
      id: 'cover-cmedia0000000000000000001',
      alt: 'Dancers circling a lit garbo',
    })
  })

  it('names the poster by category, with a description of it, when there is no cover', () => {
    const { id, alt } = socialImageFor({ ...EVENT, coverImage: null })

    expect(id).toBe('poster-garba-dandiya')
    expect(alt).toMatch(/ for Garba Night$/u)
  })

  it('ignores a cover whose address is not this site’s', () => {
    expect(
      socialImageFor({ ...EVENT, coverImage: cover({ url: 'https://x.example/a.png' }) }).id,
    ).toBe('poster-garba-dandiya')
  })
})

describe('socialImagePlan', () => {
  it('embeds a PNG cover', () => {
    const plan = socialImagePlan({ event: { ...EVENT, coverImage: cover() }, bytes: PNG })

    expect(plan.kind).toBe('cover')
    expect(plan.src.startsWith('data:image/png;base64,')).toBe(true)
  })

  it.each([
    ['no orientation', null, 'cover'],
    ['orientation 1', 1, 'cover'],
    ['orientation 6', 6, 'poster'],
    ['orientation 3', 3, 'poster'],
  ])('handles a JPEG with %s', (_name, orientation, kind) => {
    const plan = socialImagePlan({
      event: { ...EVENT, coverImage: cover({ contentType: 'image/jpeg' }) },
      bytes: jpeg(orientation),
    })

    expect(plan.kind).toBe(kind)
  })

  it('draws the poster for a WebP cover, which the renderer cannot decode', () => {
    const plan = socialImagePlan({
      event: { ...EVENT, coverImage: cover({ contentType: 'image/webp' }) },
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    })

    expect(plan).toMatchObject({ kind: 'poster', reason: 'the renderer cannot decode this type' })
    expect(plan.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('draws the poster for a cover over 12 megapixels', () => {
    const plan = socialImagePlan({
      event: { ...EVENT, coverImage: cover({ width: 5000, height: 4000 }) },
      bytes: PNG,
    })

    expect(plan).toMatchObject({ kind: 'poster', reason: 'too large' })
    expect(coverIsEmbeddable(cover({ width: 5000, height: 4000 }))).toBe(false)
    expect(coverIsEmbeddable(cover())).toBe(true)
  })

  it('draws the poster with no cover, no bytes, or bytes that are not what was promised', () => {
    expect(socialImagePlan({ event: EVENT }).reason).toBe('no cover')
    expect(socialImagePlan({ event: { ...EVENT, coverImage: cover() }, bytes: null }).reason).toBe(
      'the cover could not be fetched',
    )
    expect(
      socialImagePlan({ event: { ...EVENT, coverImage: cover() }, bytes: jpeg(null) }).reason,
    ).toBe('the bytes are not what the payload said')
  })
})

describe('posterDataUri', () => {
  it('crops the poster to the card and titles it', () => {
    const svg = Buffer.from(posterDataUri(EVENT).split(',')[1], 'base64').toString('utf8')

    expect(svg).toContain('width="1200" height="630" preserveAspectRatio="xMidYMid slice"')
    expect(svg).toContain('for Garba Night</title>')
  })
})

describe('publicEventForCard', () => {
  it.each([
    ['ON_SALE', true],
    ['CANCELLED', true],
    ['DRAFT', false],
    ['REVIEW_PENDING', false],
    ['ARCHIVED', false],
    // Off every public surface without a filter of its own (SPEC2-XI X-8).
    ['DELETED', false],
  ])('%s → card: %s', async (status, shown) => {
    const load = vi.fn(async () => ({ event: { ...EVENT, status } }))
    const event = await publicEventForCard(Promise.resolve({ slug: 'garba-night' }), { load })

    expect(load).toHaveBeenCalledWith('garba-night')
    expect(Boolean(event)).toBe(shown)
  })

  it('answers null for an event nobody has', async () => {
    expect(
      await publicEventForCard({ slug: 'x' }, { load: async () => ({ event: null }) }),
    ).toBeNull()
  })
})

describe('fetchPublicCover', () => {
  it('fetches the bytes anonymously from the API', async () => {
    const fetchMock = vi.fn(async () => new Response(PNG, { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    try {
      const bytes = await fetchPublicCover(cover())
      const [url, init] = fetchMock.mock.calls[0]

      expect([...bytes]).toEqual([...PNG])
      expect(url).toMatch(/\/v1\/media\/cmedia0000000000000000001$/u)
      expect(init?.headers).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('answers null for a refusal, a failure or an address that is not this site’s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    )

    try {
      expect(await fetchPublicCover(cover())).toBeNull()
      expect(await fetchPublicCover(cover({ url: 'https://x.example/a.png' }))).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )

    try {
      expect(await fetchPublicCover(cover())).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('renderSocialImage', () => {
  /** Records what the renderer was handed, standing in for `next/og`. */
  class FakeImageResponse {
    /**
     * @param {object} element The React element.
     * @param {object} options The options.
     */
    constructor(element, options) {
      this.element = element
      this.options = options
    }
  }

  it('draws the cover at the card size, cacheable for a day', async () => {
    const fetchCover = vi.fn(async () => PNG)
    const response = await renderSocialImage({
      event: { ...EVENT, coverImage: cover() },
      fetchCover,
      ImageResponse: FakeImageResponse,
    })
    const img = response.element.props.children

    expect(fetchCover).toHaveBeenCalledTimes(1)
    expect(img.type).toBe('img')
    expect(img.props.src.startsWith('data:image/png;base64,')).toBe(true)
    expect(response.options).toMatchObject({
      ...SOCIAL_IMAGE_SIZE,
      headers: { 'cache-control': SOCIAL_IMAGE_CACHE_CONTROL },
    })
    expect(SOCIAL_IMAGE_CACHE_CONTROL).toBe('public, max-age=86400')
  })

  it('does not fetch a cover it could not draw', async () => {
    const fetchCover = vi.fn()
    const response = await renderSocialImage({
      event: { ...EVENT, coverImage: cover({ contentType: 'image/webp' }) },
      fetchCover,
      ImageResponse: FakeImageResponse,
    })

    expect(fetchCover).not.toHaveBeenCalled()
    expect(response.element.props.children.props.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('renders a real PNG of the poster through next/og', async () => {
    const { ImageResponse } = await import('next/og')
    const response = await renderSocialImage({
      event: { ...EVENT, coverImage: null },
      ImageResponse,
    })

    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')

    const bytes = new Uint8Array(await response.arrayBuffer())

    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  }, 30_000)
  it('renders a real PNG of an embedded PNG cover through next/og', async () => {
    const { ImageResponse } = await import('next/og')
    const { crc32, deflateSync } = await import('node:zlib')
    const chunk = (type, data) => {
      const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
      const length = Buffer.alloc(4)
      const crc = Buffer.alloc(4)

      length.writeUInt32BE(data.length)
      crc.writeUInt32BE(crc32(typed))

      return Buffer.concat([length, typed, crc])
    }
    const header = Buffer.alloc(13)

    header.writeUInt32BE(64, 0)
    header.writeUInt32BE(34, 4)
    header.set([8, 2, 0, 0, 0], 8)

    const row = Buffer.alloc(1 + 64 * 3, 0x40)

    row[0] = 0

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 34 }, () => row)))),
      chunk('IEND', Buffer.alloc(0)),
    ])

    const response = await renderSocialImage({
      event: { ...EVENT, coverImage: cover({ width: 64, height: 34 }) },
      fetchCover: async () => new Uint8Array(png),
      ImageResponse,
    })
    const bytes = new Uint8Array(await response.arrayBuffer())

    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  }, 30_000)
})
