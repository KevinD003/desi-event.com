/**
 * A JSON-LD block, inlined so an organiser's words cannot close it.
 *
 * The one place in the web app that writes raw markup into the page. The
 * markup is `serializeJsonLd`'s output, which has no `<`, `>` or `&` in it, so
 * nothing a title, a performer's name or a venue's name holds can end the
 * element or start another one.
 *
 * @module components/json-ld
 */

import { serializeJsonLd } from '../lib/json-ld.js'

/**
 * @typedef {object} JsonLdProps
 * @property {object|null} data The structured data, or null for none.
 */

/**
 * Render structured data as an `application/ld+json` script.
 *
 * @param {JsonLdProps} props Component props.
 * @returns {JSX.Element|null} The script element, or nothing.
 */
export function JsonLd({ data }) {
  if (!data) return null

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
