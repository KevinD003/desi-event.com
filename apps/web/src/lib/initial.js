/**
 * The first letter of a name, for the round badges that stand beside one — the
 * account control's, and an organiser's on an event page.
 *
 * Decoration only: every badge that uses it is hidden from assistive
 * technology, and the name beside it is what is read. Kept out of any client
 * module so that a server component can call it; a function imported from a
 * `'use client'` file is a reference to the browser's copy, not something the
 * server can run.
 *
 * @module lib/initial
 */

/**
 * The first character of a name, upper-cased.
 *
 * @param {string|null|undefined} name The name.
 * @returns {string} One character, or an empty string for a blank name.
 */
export function initialOf(name) {
  const first = [...String(name ?? '').trim()][0] ?? ''

  return first.toLocaleUpperCase('en-US')
}
