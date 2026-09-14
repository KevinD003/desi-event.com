/**
 * An in-memory file storage provider.
 *
 * Event cover images and ticket PDFs are addressed by URL all over the system,
 * so the property that matters most here is that a URL is a pure function of
 * the key: uploading the same key twice yields the same URL, and `getUrl(key)`
 * returns what `put()` returned. Tests can therefore assert on a literal URL
 * without reaching into the store.
 *
 * Keys are validated like paths, not like opaque strings: a key containing
 * `..` or a leading slash would, against a real object store behind a CDN,
 * resolve somewhere the caller did not intend.
 *
 * @module @desi-event/providers/storage
 */

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'
import {
  createClock,
  createIdFactory,
  freezeRecord,
  isPlainObject,
  normaliseMetadata,
} from './internal.js'

/** Default origin the fake addresses objects under. */
export const DEFAULT_STORAGE_BASE_URL = 'https://files.desi-event.test'

/** Default bucket name. */
export const DEFAULT_STORAGE_BUCKET = 'desi-event-uploads'

/** Content type assumed when a caller does not declare one. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/** Longest accepted object key. */
const MAX_KEY_LENGTH = 1024

/** Keys are restricted to characters that survive a URL path untouched. */
const KEY_PATTERN = /^[A-Za-z0-9!_.*'()/-]+$/

const encoder = new TextEncoder()

/**
 * Validate an object key.
 *
 * @param {unknown} value Candidate key.
 * @param {string} provider Provider name attached to any error raised.
 * @returns {string} The trimmed key.
 * @throws {ProviderError} `INVALID_OBJECT_KEY` when the key is empty, too long, absolute, traversing, or contains characters outside the safe set.
 */
function parseKey(value, provider) {
  const key = typeof value === 'string' ? value.trim() : ''

  /**
   * Raise a key error with a consistent shape.
   *
   * @param {string} reason Why the key was rejected.
   * @returns {ProviderError} The error to throw.
   */
  const reject = (reason) =>
    new ProviderError(PROVIDER_ERROR_CODES.INVALID_OBJECT_KEY, `Invalid object key: ${reason}`, {
      provider,
      details: { key: typeof value === 'string' ? value : null, reason },
    })

  if (key === '') throw reject('expected a non-empty string')
  if (key.length > MAX_KEY_LENGTH) throw reject(`must be at most ${MAX_KEY_LENGTH} characters`)
  if (key.startsWith('/')) throw reject('must not start with "/"')
  if (key.endsWith('/')) throw reject('must not end with "/"')
  if (key.includes('//')) throw reject('must not contain an empty path segment')
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw reject('must not contain "." or ".." path segments')
  }
  if (!KEY_PATTERN.test(key)) throw reject('contains characters that are unsafe in a URL path')

  return key
}

/**
 * Measure a body and reject anything that is not bytes or text.
 *
 * @param {unknown} body Candidate body.
 * @param {string} provider Provider name attached to any error raised.
 * @returns {{size: number, body: (string|Uint8Array)}} Byte length and the stored body.
 * @throws {ProviderError} `INVALID_OBJECT_BODY` when the body is not a string, `Uint8Array` or `ArrayBuffer`.
 */
function parseBody(body, provider) {
  if (typeof body === 'string') return { size: encoder.encode(body).byteLength, body }
  if (body instanceof Uint8Array) return { size: body.byteLength, body }
  if (body instanceof ArrayBuffer) {
    const view = new Uint8Array(body)
    return { size: view.byteLength, body: view }
  }

  throw new ProviderError(
    PROVIDER_ERROR_CODES.INVALID_OBJECT_BODY,
    'Expected `body` to be a string, Uint8Array or ArrayBuffer',
    { provider, details: { received: body === null ? 'null' : typeof body } },
  )
}

/**
 * @typedef {object} InMemoryStorageProviderOptions
 * @property {string} [name] Adapter name.
 * @property {string} [baseUrl] Origin objects are addressed under; a trailing slash is ignored.
 * @property {string} [bucket] Bucket segment in the generated URL.
 * @property {(Date|number|string|function(): (Date|number|string))} [now] Fixed instant or clock function.
 */

/**
 * Create an in-memory {@link StorageProvider}.
 *
 * @param {InMemoryStorageProviderOptions} [options] Construction options.
 * @returns {StorageProvider} A provider with `put`, `getUrl`, `delete`, plus `get()`, `has()`, `list()` and `reset()` for tests.
 * @throws {ProviderError} `INVALID_OPTIONS` when `baseUrl` is not an absolute http(s) URL or `now` is not a usable instant.
 */
export function createInMemoryStorageProvider(options = {}) {
  const {
    name = 'in-memory-storage',
    baseUrl = DEFAULT_STORAGE_BASE_URL,
    bucket = DEFAULT_STORAGE_BUCKET,
    now,
  } = options

  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'Expected `baseUrl` to be an absolute http or https URL',
      { provider: name, details: { received: baseUrl } },
    )
  }
  const origin = baseUrl.replace(/\/+$/, '')
  const bucketSegment = parseKey(bucket, name)
  const clock = createClock(now)
  const nextId = createIdFactory('obj')

  /** @type {Map<string, Record<string, unknown>>} */
  const objects = new Map()

  /**
   * The stable URL for a key. Pure: it does not consult the store, so two
   * uploads of the same key always produce the same address, and a test can
   * assert on a literal URL. No escaping is needed because `parseKey` has
   * already restricted keys to characters that survive a URL path untouched.
   *
   * @param {string} key A validated object key.
   * @returns {string} An absolute URL.
   */
  function urlForKey(key) {
    return `${origin}/${bucketSegment}/${key}`
  }

  /**
   * Project a stored record into the public {@link StoredObject} shape.
   *
   * @param {Record<string, unknown>} record Internal record.
   * @returns {StoredObject} A frozen snapshot without the body.
   */
  function toStoredObject(record) {
    return /** @type {StoredObject} */ (
      freezeRecord({
        id: record.id,
        key: record.key,
        url: record.url,
        size: record.size,
        contentType: record.contentType,
        metadata: record.metadata,
        uploadedAt: record.uploadedAt,
      })
    )
  }

  /**
   * Store bytes under a key, replacing anything already there.
   *
   * @param {object} input The upload.
   * @param {string} input.key Object key, e.g. `events/abc/cover.jpg`.
   * @param {(string|Uint8Array|ArrayBuffer)} input.body The bytes to store.
   * @param {string} [input.contentType] MIME type; defaults to {@link DEFAULT_CONTENT_TYPE}.
   * @param {Record<string, unknown>} [input.metadata] Free-form bag stored alongside the object.
   * @returns {StoredObject} The stored object, including its stable `url`.
   * @throws {ProviderError} `INVALID_OPTIONS` when `input` is not an object; `INVALID_OBJECT_KEY`; `INVALID_OBJECT_BODY`.
   */
  function put(input) {
    if (!isPlainObject(input)) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_OPTIONS,
        'put expects an object with `key` and `body`',
        { provider: name, details: { received: input === null ? 'null' : typeof input } },
      )
    }

    const key = parseKey(input.key, name)
    const { size, body } = parseBody(input.body, name)
    const contentType =
      typeof input.contentType === 'string' && input.contentType.trim() !== ''
        ? input.contentType.trim()
        : DEFAULT_CONTENT_TYPE
    const metadata = normaliseMetadata(input.metadata, PROVIDER_ERROR_CODES.INVALID_OPTIONS, name)

    const previous = objects.get(key)
    /** @type {Record<string, unknown>} */
    const record = {
      // An overwrite keeps the original id: it is the same object, new bytes.
      id: previous ? previous.id : nextId(),
      key,
      url: urlForKey(key),
      size,
      body,
      contentType,
      metadata,
      uploadedAt: clock().toISOString(),
    }
    objects.set(key, record)

    return toStoredObject(record)
  }

  /**
   * Resolve a key to its stable URL.
   *
   * @param {string} key The object key.
   * @returns {string} The absolute URL of the stored object.
   * @throws {ProviderError} `INVALID_OBJECT_KEY` for a malformed key; `OBJECT_NOT_FOUND` when nothing is stored under it.
   */
  function getUrl(key) {
    const parsed = parseKey(key, name)
    const record = objects.get(parsed)
    if (!record) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.OBJECT_NOT_FOUND,
        `No object stored under key "${parsed}"`,
        { provider: name, details: { key: parsed } },
      )
    }
    return /** @type {string} */ (record.url)
  }

  /**
   * Remove an object. Idempotent, like every object store worth using.
   *
   * @param {string} key The object key.
   * @returns {boolean} `true` when an object was removed, `false` when the key was already absent.
   * @throws {ProviderError} `INVALID_OBJECT_KEY` for a malformed key.
   */
  function remove(key) {
    return objects.delete(parseKey(key, name))
  }

  /**
   * Read an object back, body included.
   *
   * @param {string} key The object key.
   * @returns {object} The stored record, including `body`.
   * @throws {ProviderError} `INVALID_OBJECT_KEY` for a malformed key; `OBJECT_NOT_FOUND` when nothing is stored under it.
   */
  function get(key) {
    const parsed = parseKey(key, name)
    const record = objects.get(parsed)
    if (!record) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.OBJECT_NOT_FOUND,
        `No object stored under key "${parsed}"`,
        { provider: name, details: { key: parsed } },
      )
    }
    return freezeRecord({ ...toStoredObject(record), body: record.body })
  }

  /**
   * Whether an object exists.
   *
   * @param {string} key The object key.
   * @returns {boolean} True when an object is stored under `key`.
   * @throws {ProviderError} `INVALID_OBJECT_KEY` for a malformed key.
   */
  function has(key) {
    return objects.has(parseKey(key, name))
  }

  /**
   * List stored objects, optionally filtered by key prefix.
   *
   * @param {string} [prefix] Key prefix to filter by; omit for everything.
   * @returns {StoredObject[]} Frozen snapshots, in insertion order, without bodies.
   */
  function list(prefix) {
    const records = [...objects.values()].map(toStoredObject)
    if (prefix === undefined || prefix === null || prefix === '') return records
    const text = String(prefix)
    return records.filter((record) => String(record.key).startsWith(text))
  }

  /**
   * Forget every object.
   *
   * @returns {void}
   */
  function reset() {
    objects.clear()
  }

  return /** @type {StorageProvider} */ ({
    name,
    baseUrl: origin,
    bucket: bucketSegment,
    put,
    getUrl,
    delete: remove,
    get,
    has,
    list,
    reset,
  })
}
