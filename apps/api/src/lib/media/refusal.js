/**
 * Why an uploaded picture was refused.
 *
 * One error class for every refusal the picture pipeline makes, each with its
 * own status and a sentence an organiser can act on. It is a plain `Error`
 * carrying `statusCode` and `code`, which is the shape the error handler
 * already renders, so a refusal leaves as the API's usual envelope and never as
 * a 500.
 *
 * @module @desi-event/api/lib/media/refusal
 */

/**
 * Every refusal code, its status, and the sentence used when a caller gives
 * none.
 *
 * @type {Readonly<Record<string, {status: number, message: string}>>}
 */
export const MEDIA_REFUSALS = Object.freeze({
  EMPTY_UPLOAD: Object.freeze({
    status: 400,
    message: 'The upload was empty. Choose a JPEG, PNG or WebP picture and try again.',
  }),
  PAYLOAD_TOO_LARGE: Object.freeze({
    status: 413,
    message: 'The picture is larger than 10 MB. Save a smaller copy and try again.',
  }),
  UNSUPPORTED_MEDIA_TYPE: Object.freeze({
    status: 415,
    message: 'This file is not a JPEG, PNG or WebP picture.',
  }),
  MALFORMED_IMAGE: Object.freeze({
    status: 422,
    message: 'This picture is damaged or incomplete, so it cannot be used.',
  }),
  ANIMATED_IMAGE: Object.freeze({
    status: 422,
    message: 'Animated pictures are not accepted. Upload a still picture.',
  }),
  IMAGE_TOO_SMALL: Object.freeze({
    status: 422,
    message: 'This picture is too small.',
  }),
  IMAGE_TOO_LARGE: Object.freeze({
    status: 422,
    message: 'This picture has too many pixels.',
  }),
})

/** A picture refused by the upload pipeline. */
export class MediaRefusal extends Error {
  /**
   * @param {string} code A key of {@link MEDIA_REFUSALS}.
   * @param {string} [message] A more specific sentence than the default.
   */
  constructor(code, message) {
    const known = MEDIA_REFUSALS[code] ?? MEDIA_REFUSALS.MALFORMED_IMAGE

    super(message ?? known.message)

    this.name = 'MediaRefusal'
    this.code = MEDIA_REFUSALS[code] ? code : 'MALFORMED_IMAGE'
    this.statusCode = known.status
  }
}

/**
 * Shorthand for a damaged or unsupported structure.
 *
 * @param {string} message What is wrong, in a sentence.
 * @returns {MediaRefusal} The refusal.
 */
export function malformed(message) {
  return new MediaRefusal('MALFORMED_IMAGE', message)
}
