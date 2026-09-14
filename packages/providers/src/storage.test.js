import { describe, it, expect } from 'vitest'

import {
  createInMemoryStorageProvider,
  DEFAULT_STORAGE_BASE_URL,
  DEFAULT_STORAGE_BUCKET,
  DEFAULT_CONTENT_TYPE,
} from './storage.js'
import { assertStorageProvider } from './interfaces.js'

const NOW = '2026-09-14T10:00:00.000Z'
const KEY = 'events/evt_1/cover.jpg'

/**
 * A provider with a frozen clock.
 *
 * @param {object} [options] Extra construction options.
 * @returns {object} A fresh in-memory storage provider.
 */
function makeProvider(options = {}) {
  return createInMemoryStorageProvider({ now: NOW, ...options })
}

describe('createInMemoryStorageProvider', () => {
  it('satisfies the storage provider interface', () => {
    const provider = makeProvider()

    expect(() => assertStorageProvider(provider)).not.toThrow()
    expect(provider.name).toBe('in-memory-storage')
    expect(provider.baseUrl).toBe(DEFAULT_STORAGE_BASE_URL)
    expect(provider.bucket).toBe(DEFAULT_STORAGE_BUCKET)
  })

  it('rejects a base URL that is not absolute http(s)', () => {
    expect(() => createInMemoryStorageProvider({ baseUrl: '/uploads' })).toThrowError(
      /absolute http or https URL/,
    )
    expect(() => createInMemoryStorageProvider({ baseUrl: 'ftp://files.test' })).toThrowError(
      /absolute http or https URL/,
    )
    expect(() => createInMemoryStorageProvider({ baseUrl: 42 })).toThrowError(
      /absolute http or https URL/,
    )
  })

  it('trims trailing slashes off the base URL', () => {
    const provider = makeProvider({ baseUrl: 'https://cdn.example.com///', bucket: 'media' })

    expect(provider.put({ key: 'a.txt', body: 'x' }).url).toBe(
      'https://cdn.example.com/media/a.txt',
    )
  })

  it('rejects an unusable bucket name', () => {
    expect(() => createInMemoryStorageProvider({ bucket: '' })).toThrowError(/Invalid object key/)
    expect(() => createInMemoryStorageProvider({ bucket: '../escape' })).toThrowError(
      /Invalid object key/,
    )
  })
})

describe('put', () => {
  it('stores bytes and returns a stable URL', () => {
    const provider = makeProvider()
    const stored = provider.put({ key: KEY, body: 'jpeg-bytes', contentType: 'image/jpeg' })

    expect(stored).toMatchObject({
      key: KEY,
      url: `${DEFAULT_STORAGE_BASE_URL}/${DEFAULT_STORAGE_BUCKET}/${KEY}`,
      size: 10,
      contentType: 'image/jpeg',
      uploadedAt: NOW,
    })
    expect(Object.isFrozen(stored)).toBe(true)
  })

  it('never returns the body from put', () => {
    expect(makeProvider().put({ key: KEY, body: 'bytes' })).not.toHaveProperty('body')
  })

  it('produces the same URL for the same key every time', () => {
    const provider = makeProvider()
    const first = provider.put({ key: KEY, body: 'one' })
    const second = provider.put({ key: KEY, body: 'two-longer' })

    expect(second.url).toBe(first.url)
    expect(provider.getUrl(KEY)).toBe(first.url)
    expect(second.id).toBe(first.id)
    expect(second.size).toBe(10)
    expect(provider.list()).toHaveLength(1)
  })

  it('appends URL-safe keys verbatim, separators and all', () => {
    const provider = makeProvider()
    const stored = provider.put({ key: "events/evt_1/cover-(1)'s.jpg", body: 'x' })

    expect(stored.url).toBe(
      `${DEFAULT_STORAGE_BASE_URL}/${DEFAULT_STORAGE_BUCKET}/events/evt_1/cover-(1)'s.jpg`,
    )
    expect(new URL(stored.url).pathname).toContain("cover-(1)'s.jpg")
  })

  it('defaults the content type', () => {
    expect(makeProvider().put({ key: KEY, body: 'x' }).contentType).toBe(DEFAULT_CONTENT_TYPE)
    expect(makeProvider().put({ key: KEY, body: 'x', contentType: '  ' }).contentType).toBe(
      DEFAULT_CONTENT_TYPE,
    )
  })

  it('measures strings in bytes, not characters', () => {
    const provider = makeProvider()

    expect(provider.put({ key: 'a.txt', body: 'गरबा' }).size).toBe(12)
  })

  it('accepts Uint8Array and ArrayBuffer bodies', () => {
    const provider = makeProvider()
    const bytes = new Uint8Array([1, 2, 3, 4])

    expect(provider.put({ key: 'a.bin', body: bytes }).size).toBe(4)
    expect(provider.put({ key: 'b.bin', body: bytes.buffer }).size).toBe(4)
    expect(provider.get('b.bin').body).toBeInstanceOf(Uint8Array)
  })

  it('rejects a non-object input', () => {
    const provider = makeProvider()

    expect(() => provider.put()).toThrowError(/put expects an object/)
    expect(() => provider.put(null)).toThrowError(/put expects an object/)
    expect(() => provider.put('bytes')).toThrowError(/put expects an object/)
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['absent', undefined],
    ['absolute', '/events/a.jpg'],
    ['trailing-slash', 'events/'],
    ['double-slash', 'events//a.jpg'],
    ['traversing', 'events/../../etc/passwd'],
    ['dot-segment', 'events/./a.jpg'],
    ['space-free but unsafe', 'events/a b.jpg'],
    ['question-marked', 'events/a.jpg?raw=1'],
  ])('rejects a %s key', (_label, key) => {
    const provider = makeProvider()

    try {
      provider.put({ key, body: 'x' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_OBJECT_KEY')
      expect(error.statusCode).toBe(400)
      expect(typeof error.details.reason).toBe('string')
    }
  })

  it('caps the key length', () => {
    const provider = makeProvider()

    expect(() => provider.put({ key: 'x'.repeat(1025), body: 'x' })).toThrowError(
      /at most 1024 characters/,
    )
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
  ])('rejects a body that is %s', (_label, body) => {
    const provider = makeProvider()

    try {
      provider.put({ key: KEY, body })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('INVALID_OBJECT_BODY')
    }
  })

  it('stores an empty string body', () => {
    expect(makeProvider().put({ key: KEY, body: '' }).size).toBe(0)
  })

  it('rejects non-object metadata', () => {
    expect(() => makeProvider().put({ key: KEY, body: 'x', metadata: 'no' })).toThrowError(
      /plain object/,
    )
  })
})

describe('getUrl', () => {
  it('returns the URL of a stored object', () => {
    const provider = makeProvider()
    const stored = provider.put({ key: KEY, body: 'x' })

    expect(provider.getUrl(KEY)).toBe(stored.url)
    expect(provider.getUrl(`  ${KEY}  `)).toBe(stored.url)
  })

  it('throws OBJECT_NOT_FOUND for an unknown key', () => {
    const provider = makeProvider()

    try {
      provider.getUrl('events/missing.jpg')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('OBJECT_NOT_FOUND')
      expect(error.statusCode).toBe(404)
      expect(error.details.key).toBe('events/missing.jpg')
    }
  })

  it('validates the key before looking it up', () => {
    expect(() => makeProvider().getUrl('/leading-slash')).toThrowError(/Invalid object key/)
  })
})

describe('delete', () => {
  it('removes an object and reports whether one was there', () => {
    const provider = makeProvider()
    provider.put({ key: KEY, body: 'x' })

    expect(provider.delete(KEY)).toBe(true)
    expect(provider.delete(KEY)).toBe(false)
    expect(provider.has(KEY)).toBe(false)
    expect(() => provider.getUrl(KEY)).toThrowError(/No object stored/)
  })

  it('validates the key', () => {
    expect(() => makeProvider().delete('')).toThrowError(/Invalid object key/)
  })
})

describe('get, has, list and reset', () => {
  it('reads an object back with its body', () => {
    const provider = makeProvider()
    provider.put({ key: KEY, body: 'bytes', metadata: { eventId: 'evt_1' } })
    const object = provider.get(KEY)

    expect(object).toMatchObject({ key: KEY, body: 'bytes', metadata: { eventId: 'evt_1' } })
    expect(Object.isFrozen(object)).toBe(true)
  })

  it('throws OBJECT_NOT_FOUND from get for an unknown key', () => {
    try {
      makeProvider().get('nope.txt')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('OBJECT_NOT_FOUND')
    }
  })

  it('reports existence without throwing', () => {
    const provider = makeProvider()

    expect(provider.has(KEY)).toBe(false)
    provider.put({ key: KEY, body: 'x' })
    expect(provider.has(KEY)).toBe(true)
  })

  it('lists objects in insertion order, filtered by prefix', () => {
    const provider = makeProvider()
    provider.put({ key: 'events/a.jpg', body: 'x' })
    provider.put({ key: 'tickets/b.pdf', body: 'x' })
    provider.put({ key: 'events/c.jpg', body: 'x' })

    expect(provider.list().map((object) => object.key)).toEqual([
      'events/a.jpg',
      'tickets/b.pdf',
      'events/c.jpg',
    ])
    expect(provider.list('events/').map((object) => object.key)).toEqual([
      'events/a.jpg',
      'events/c.jpg',
    ])
    expect(provider.list('')).toHaveLength(3)
    expect(provider.list(null)).toHaveLength(3)
    expect(provider.list('nothing/')).toEqual([])
  })

  it('never exposes bodies through list', () => {
    const provider = makeProvider()
    provider.put({ key: KEY, body: 'secret' })

    expect(provider.list()[0]).not.toHaveProperty('body')
  })

  it('forgets everything on reset', () => {
    const provider = makeProvider()
    provider.put({ key: KEY, body: 'x' })
    provider.reset()

    expect(provider.list()).toEqual([])
    expect(provider.has(KEY)).toBe(false)
  })
})

describe('an advancing clock', () => {
  it('stamps each upload with its own instant', () => {
    let minute = 0
    const provider = createInMemoryStorageProvider({
      now: () => new Date(Date.UTC(2026, 8, 14, 10, minute++)),
    })

    expect(provider.put({ key: 'a.txt', body: 'x' }).uploadedAt).toBe('2026-09-14T10:00:00.000Z')
    expect(provider.put({ key: 'b.txt', body: 'x' }).uploadedAt).toBe('2026-09-14T10:01:00.000Z')
  })
})
