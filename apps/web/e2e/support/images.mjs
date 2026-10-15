/**
 * Pictures made in the test, byte by byte, rather than committed as fixtures.
 *
 * A committed image is a file nobody reads: whether it carries metadata, how
 * big it is, and what it really is are invisible in a diff. These are built
 * from their own description, so the spec that uploads one says exactly what
 * it holds — a PNG of a given size, with or without a text chunk, or a drawing
 * that only calls itself a PNG.
 *
 * `node:zlib` supplies both the compression and the chunk checksum; nothing
 * else is needed to write a valid PNG.
 *
 * @module e2e/support/images
 */

import { crc32, deflateSync } from 'node:zlib'

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * One PNG chunk: its length, type, data and the checksum over type and data.
 *
 * @param {string} type The four-letter chunk type.
 * @param {Buffer} data The chunk's data.
 * @returns {Buffer} The chunk.
 */
function chunk(type, data) {
  const length = Buffer.alloc(4)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const checksum = Buffer.alloc(4)

  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(typed) >>> 0)

  return Buffer.concat([length, typed, checksum])
}

/**
 * A PNG of one colour, with an optional `tEXt` chunk.
 *
 * Eight-bit RGB, no interlacing. The text chunk is the kind of thing a camera
 * or an editor leaves in a file — an author, a location — and the upload
 * pipeline rebuilds a picture from its pixels without it.
 *
 * @param {number} width Pixels across.
 * @param {number} height Pixels down.
 * @param {object} [options] Options.
 * @param {Array<number>} [options.rgb] The colour, as red, green and blue from 0 to 255.
 * @param {{keyword: string, text: string}} [options.textChunk] A text chunk to include.
 * @returns {Buffer} The file.
 */
export function solidPng(width, height, { rgb = [214, 88, 43], textChunk = null } = {}) {
  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // no interlace

  // Each row is a filter byte (0, none) and then its pixels.
  const row = Buffer.alloc(1 + width * 3)

  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3)

  const pixels = Buffer.concat(Array.from({ length: height }, () => row))

  const chunks = [chunk('IHDR', header)]

  if (textChunk) {
    chunks.push(
      chunk(
        'tEXt',
        Buffer.concat([
          Buffer.from(textChunk.keyword, 'latin1'),
          Buffer.from([0]),
          Buffer.from(textChunk.text, 'latin1'),
        ]),
      ),
    )
  }

  chunks.push(chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)))

  return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

/**
 * A drawing with a script in it, to be offered under a PNG's name.
 *
 * What an upload form must never store: a browser that opened it from this
 * site's origin would run the script.
 *
 * @returns {Buffer} The file.
 */
export function svgAsPng() {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">' +
      '<script>alert(document.cookie)</script>' +
      '<rect width="1200" height="630" fill="#d6582b"/></svg>',
    'utf8',
  )
}

/**
 * A file larger than the ten-megabyte limit that starts like a PNG.
 *
 * Only its size matters: it is refused before its contents are looked at.
 *
 * @param {number} [megabytes] How big, in mebibytes.
 * @returns {Buffer} The file.
 */
export function oversizedPng(megabytes = 11) {
  const bytes = Buffer.alloc(megabytes * 1024 * 1024)

  PNG_SIGNATURE.copy(bytes, 0)

  return bytes
}
