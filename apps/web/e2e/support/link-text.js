/**
 * Reading an event row's title the way a screen reader meets it.
 *
 * The event rows on the venue and organiser pages are one link each: a
 * calendar leaf, the title, then the date and a place. The leaf is
 * `aria-hidden` decoration, so the first thing the link says aloud is the
 * title. Reading "the first span" stopped meaning the title the day the leaf
 * was added in front of it; reading the first text that is not hidden from
 * assistive technology keeps meaning it however the row is decorated.
 *
 * @module e2e/support/link-text
 */

/**
 * The first non-empty text inside an element that assistive technology reads.
 *
 * @param {object} locator The link, or any element.
 * @returns {Promise<string|null>} The trimmed text, or `null` when there is none.
 */
export function firstSpokenText(locator) {
  return locator.evaluate((root) => {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('[aria-hidden="true"]')) continue

      const text = node.textContent.trim()
      if (text) return text
    }

    return null
  })
}
