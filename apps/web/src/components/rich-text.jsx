/**
 * An organiser's formatted text, rendered from a parsed tree.
 *
 * Every element here is a React element built from `lib/rich-text.js`'s tree.
 * There is no raw HTML anywhere on this path, so a description cannot carry a
 * script, a style or an event handler whatever it says, and a link is only a
 * link when its address is `https:`. Server-safe: no hooks, no browser APIs.
 *
 * @module components/rich-text
 */

import { LINK_REL, parseRichText } from '../lib/rich-text.js'

/**
 * Whether a link's label already is its address, as a bare `https://…` is.
 *
 * @param {object} node A link node.
 * @returns {boolean} True when writing the address out again would repeat it.
 */
function labelIsAddress(node) {
  return (
    node.children.length === 1 &&
    node.children[0].type === 'text' &&
    node.children[0].value === node.href
  )
}

/**
 * Render inline nodes.
 *
 * @param {object[]} nodes Inline nodes.
 * @param {object} [options] Options.
 * @param {boolean} [options.showDestinations] Write each link's address out after its label.
 * @returns {Array<*>} Elements.
 */
function renderInline(nodes, options = {}) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value
    if (node.type === 'strong') {
      return <strong key={index}>{renderInline(node.children, options)}</strong>
    }
    if (node.type === 'em') return <em key={index}>{renderInline(node.children, options)}</em>

    const anchor = (
      <a
        key={index}
        href={node.href}
        rel={LINK_REL}
        className="rounded-sm font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        {renderInline(node.children, options)}
      </a>
    )

    if (!options.showDestinations || labelIsAddress(node)) return anchor

    // A label can say "Official tickets" and point anywhere. Whoever is
    // deciding whether this text may be published reads where it goes, in
    // full, without hovering.
    return (
      <span key={index}>
        {anchor}{' '}
        <span className="break-all text-ink" data-link-destination="">
          ({node.href})
        </span>
      </span>
    )
  })
}

/**
 * Formatted text.
 *
 * @param {object} props Props.
 * @param {string|null|undefined} props.text What the organiser wrote.
 * @param {string} [props.className] Classes for the wrapper.
 * @param {boolean} [props.showDestinations] Write every link's full address after its label, for a reviewer.
 * @returns {JSX.Element|null} The text, or nothing when there is none.
 */
export function RichText({ text, className = '', showDestinations = false }) {
  const blocks = parseRichText(text)
  const options = { showDestinations }

  if (blocks.length === 0) return null

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      {blocks.map((block, index) =>
        block.type === 'list' ? (
          <ul key={index} className="list-disc space-y-1 ps-6">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item, options)}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, options)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  )
}
