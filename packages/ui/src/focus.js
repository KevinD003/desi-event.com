/**
 * Focus helpers shared by the components that manage focus themselves.
 *
 * The queries here are always rooted at an element obtained from a React ref;
 * nothing in this library reaches into the document to find its own markup.
 *
 * @module @desi-event/ui/focus
 */

/** Selector covering everything the platform makes focusable by default. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

/**
 * Collect the tabbable descendants of a container, in tab order.
 *
 * Elements that are disabled, removed from the accessibility tree with
 * `aria-hidden`, hidden with the `hidden` attribute, or explicitly taken out of
 * the tab sequence with a negative `tabindex` are excluded — they can still be
 * focused programmatically but Tab never reaches them.
 *
 * @param {Element|null|undefined} container Root element to search within.
 * @returns {HTMLElement[]} Tabbable elements in document order.
 */
export function getTabbableElements(container) {
  if (!container) return []

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) return false
    if (element.hasAttribute('hidden')) return false
    if (element.getAttribute('aria-hidden') === 'true') return false

    const tabIndex = element.getAttribute('tabindex')
    if (tabIndex !== null && Number(tabIndex) < 0) return false

    return true
  })
}

/**
 * Focus an element if it is still connected to the document.
 *
 * @param {Element|null|undefined} element Element to focus.
 * @returns {boolean} True when focus was moved.
 */
export function focusElement(element) {
  if (!element || typeof element.focus !== 'function') return false
  if (!element.isConnected) return false

  element.focus()
  return true
}
