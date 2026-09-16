/**
 * Helpers shared by the in-memory providers. Nothing here is exported from the
 * package entry point.
 *
 * The in-memory fakes are the substrate the API and worker test suites run on,
 * so two properties matter more than realism: they are **deterministic** (ids
 * come from a per-instance counter, the clock is injectable) and they **never
 * leak mutable state** (everything handed back is a frozen copy, so a caller
 * cannot reach into the store and rewrite history).
 *
 * @module @desi-event/providers/internal
 */

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

/**
 * True for a directly-constructed object literal (or a null-prototype object).
 *
 * Arrays, class instances, functions and `null` are rejected, which is what
 * every "did the caller pass an options bag?" check in this package wants.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether `value` is a plain object.
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Build a monotonic id factory.
 *
 * Ids are sequential rather than random so a failing test prints the same id
 * on every run and snapshot-style assertions stay stable.
 *
 * @param {string} prefix Short prefix identifying the record kind, e.g. `pi`.
 * @returns {function(): string} A function returning the next id, e.g. `pi_000001`.
 */
export function createIdFactory(prefix) {
  let sequence = 0
  return function nextId() {
    sequence += 1
    return `${prefix}_${String(sequence).padStart(6, '0')}`
  }
}

/**
 * Coerce a `Date`, epoch-milliseconds number or ISO string into a `Date`.
 *
 * @param {Date|number|string} value The instant to coerce.
 * @returns {Date} A valid `Date`.
 * @throws {ProviderError} When `value` is not a usable instant.
 */
function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'Expected `now` to be a Date, epoch milliseconds, an ISO string, or a function returning one',
      { details: { received: typeof value } },
    )
  }
  return date
}

/**
 * Turn the `now` option accepted by every factory into a clock function.
 *
 * Passing a fixed instant freezes time, which is what a test asserting on
 * `sentAt` or `expiresAt` needs; passing a function lets a test advance it.
 *
 * @param {Date|number|string|function(): (Date|number|string)} [now] Fixed instant or clock function.
 * @returns {function(): Date} A function returning the current instant.
 * @throws {ProviderError} When `now` is present but not a usable instant.
 */
export function createClock(now) {
  if (now === undefined || now === null) return () => new Date()
  if (typeof now === 'function') return () => toDate(now())
  const fixed = toDate(now)
  return () => new Date(fixed.getTime())
}

/**
 * Freeze an object and any plain-object or array values one level deep.
 *
 * One level is enough: every record this package hands out is flat apart from
 * its `metadata` bag.
 *
 * @param {object} value The object to freeze.
 * @returns {object} The same object, now frozen.
 */
export function freezeRecord(value) {
  for (const key of Object.keys(value)) {
    const child = value[key]
    if (Array.isArray(child)) Object.freeze(child)
    else if (isPlainObject(child)) Object.freeze(child)
  }
  return Object.freeze(value)
}

/**
 * Validate an optional free-form metadata bag.
 *
 * @param {unknown} metadata Candidate metadata.
 * @param {string} errorCode Code to raise when `metadata` is not a plain object.
 * @param {string} provider Provider name, attached to any error raised.
 * @returns {Record<string, unknown>} A frozen copy; `{}` when `metadata` is absent.
 * @throws {ProviderError} When `metadata` is present but not a plain object.
 */
export function normaliseMetadata(metadata, errorCode, provider) {
  if (metadata === undefined || metadata === null) return Object.freeze({})
  if (!isPlainObject(metadata)) {
    throw new ProviderError(errorCode, 'Expected `metadata` to be a plain object', {
      provider,
      details: { received: Array.isArray(metadata) ? 'array' : typeof metadata },
    })
  }
  return Object.freeze({ ...metadata })
}

/**
 * Require that `value` is a non-empty string, returning it trimmed.
 *
 * @param {unknown} value Candidate string.
 * @param {string} field Field name used in the error message.
 * @param {object} options Error shaping.
 * @param {string} options.code Provider error code to raise.
 * @param {string} [options.provider] Provider name attached to the error.
 * @param {number} [options.maxLength] Maximum accepted length.
 * @returns {string} The trimmed string.
 * @throws {ProviderError} When `value` is not a non-empty string of acceptable length.
 */
export function requireText(value, field, options) {
  const { code, provider, maxLength = 1000 } = options
  const text = typeof value === 'string' ? value.trim() : ''

  if (text === '') {
    throw new ProviderError(code, `Expected \`${field}\` to be a non-empty string`, {
      provider,
      details: { field, received: value === undefined ? 'undefined' : typeof value },
    })
  }
  if (text.length > maxLength) {
    throw new ProviderError(code, `\`${field}\` must be at most ${maxLength} characters`, {
      provider,
      details: { field, length: text.length, maxLength },
    })
  }
  return text
}
