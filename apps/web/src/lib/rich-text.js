/**
 * A small, safe formatting language for event descriptions.
 *
 * Organisers write plain text with a handful of marks, and the page renders
 * them. Nothing here produces HTML: the parser returns a tree of plain objects,
 * and `components/rich-text.jsx` turns that tree into React elements, so a
 * description can never inject markup, a script or an event handler however it
 * is written. Anything the parser does not recognise is shown as the text it is.
 *
 * What it understands:
 *
 *   - A blank line starts a new paragraph; a single line break is kept.
 *   - Lines beginning `- ` or `* ` are a bulleted list.
 *   - `**bold**`, and `*italic*` or `_italic_`.
 *   - `[label](https://…)` and bare `https://…` addresses become links, but
 *     only `https:` ones. `javascript:`, `data:`, `http:` and `mailto:` stay as
 *     the literal text somebody typed.
 *
 * @module lib/rich-text
 */

/** The link relation every organiser-written link carries. */
export const LINK_REL = 'nofollow ugc noopener noreferrer'

/** A bulleted-list line: `- ` or `* ` at the start. */
const LIST_LINE = /^\s*[-*]\s+(.*)$/

/**
 * The inline marks, in the order they are tried at each position.
 *
 * Named groups keep the branches readable. Italic needs a non-space next to
 * each marker, so `2 * 3 * 4` stays arithmetic.
 */
const INLINE = new RegExp(
  [
    String.raw`\[(?<label>[^\]\n]{1,200})\]\((?<href>[^)\s]{1,2048})\)`,
    String.raw`\*\*(?<bold>[^*\n]+?)\*\*`,
    String.raw`(?<![\w*])\*(?=\S)(?<star>[^*\n]*?\S)\*(?!\*)`,
    String.raw`(?<![\w_])_(?=\S)(?<under>[^_\n]*?\S)_(?![\w_])`,
    String.raw`(?<bare>https:\/\/[^\s<>()\[\]"']+)`,
  ].join('|'),
  'gu',
)

/** Punctuation that ends a sentence rather than an address. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u

/**
 * Whether an address may become a link.
 *
 * `new URL()` decides, not a pattern, and only `https:` with a host passes:
 * a `javascript:` address is a script, a `data:` one is a document, `http:` is
 * a downgrade, and `mailto:` has its own contact field.
 *
 * @param {string} href The candidate.
 * @returns {boolean} True when it is a safe https link.
 */
export function isSafeHref(href) {
  if (typeof href !== 'string' || !/^https:\/\//iu.test(href.trim())) return false

  try {
    const url = new URL(href.trim())

    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * Parse one line of text into inline nodes.
 *
 * @param {string} line The line.
 * @returns {object[]} Nodes: `{type:'text', value}`, `{type:'strong'|'em', children}` or `{type:'link', href, children}`.
 */
export function parseInline(line) {
  /** @type {object[]} */
  const nodes = []
  let last = 0

  /**
   * Add literal text, merging it into a preceding text node.
   *
   * @param {string} value The text.
   * @returns {void}
   */
  const text = (value) => {
    if (!value) return

    const previous = nodes.at(-1)

    if (previous?.type === 'text') previous.value += value
    else nodes.push({ type: 'text', value })
  }

  for (const match of line.matchAll(INLINE)) {
    const { label, href, bold, star, under, bare } = match.groups ?? {}
    let consumed = match[0]

    text(line.slice(last, match.index))

    if (label !== undefined) {
      if (isSafeHref(href)) {
        nodes.push({ type: 'link', href: href.trim(), children: [{ type: 'text', value: label }] })
      } else {
        text(match[0])
      }
    } else if (bold !== undefined) {
      nodes.push({ type: 'strong', children: parseInline(bold) })
    } else if (star !== undefined || under !== undefined) {
      nodes.push({ type: 'em', children: [{ type: 'text', value: star ?? under }] })
    } else if (bare !== undefined) {
      const trailing = bare.match(TRAILING_PUNCTUATION)?.[0] ?? ''
      const address = trailing ? bare.slice(0, -trailing.length) : bare

      consumed = address

      if (isSafeHref(address)) {
        nodes.push({ type: 'link', href: address, children: [{ type: 'text', value: address }] })
      } else {
        text(address)
      }
    }

    last = match.index + consumed.length
  }

  text(line.slice(last))

  return nodes
}

/**
 * Parse a description into blocks.
 *
 * @param {string|null|undefined} source What the organiser wrote.
 * @returns {object[]} Blocks: `{type:'paragraph', lines}` where each line is inline nodes, or `{type:'list', items}` where each item is inline nodes.
 */
export function parseRichText(source) {
  if (typeof source !== 'string' || source.trim().length === 0) return []

  /** @type {object[]} */
  const blocks = []
  const chunks = source.replace(/\r\n?/gu, '\n').split(/\n[ \t]*\n+/u)

  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter((line) => line.trim().length > 0)
    /** @type {object|null} */
    let current = null

    for (const line of lines) {
      const item = line.match(LIST_LINE)

      if (item) {
        if (current?.type !== 'list') {
          current = { type: 'list', items: [] }
          blocks.push(current)
        }

        current.items.push(parseInline(item[1]))
      } else {
        if (current?.type !== 'paragraph') {
          current = { type: 'paragraph', lines: [] }
          blocks.push(current)
        }

        current.lines.push(parseInline(line.trim()))
      }
    }
  }

  return blocks
}

/**
 * The text of some inline nodes, marks removed.
 *
 * @param {object[]} nodes Inline nodes.
 * @returns {string} Their text.
 */
function inlineText(nodes) {
  return nodes
    .map((node) => (node.type === 'text' ? node.value : inlineText(node.children ?? [])))
    .join('')
}

/**
 * A description as plain text, for a meta description or structured data.
 *
 * @param {string|null|undefined} source What the organiser wrote.
 * @returns {string} The words, marks removed, paragraphs joined by a space.
 */
export function plainText(source) {
  return parseRichText(source)
    .map((block) =>
      block.type === 'list'
        ? block.items.map(inlineText).join('; ')
        : block.lines.map(inlineText).join(' '),
    )
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}
