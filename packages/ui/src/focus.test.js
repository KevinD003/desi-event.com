import { describe, it, expect, afterEach } from 'vitest'
import { getTabbableElements, focusElement } from './focus.js'

/**
 * Build a detached-then-attached container from an HTML string.
 *
 * @param {string} html Markup for the container's children.
 * @returns {HTMLElement} The mounted container.
 */
function mount(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('getTabbableElements', () => {
  it('returns focusable descendants in document order', () => {
    const container = mount(`
      <a href="#one">One</a>
      <button type="button">Two</button>
      <input />
      <select></select>
      <textarea></textarea>
    `)

    expect(getTabbableElements(container).map((element) => element.tagName)).toEqual([
      'A',
      'BUTTON',
      'INPUT',
      'SELECT',
      'TEXTAREA',
    ])
  })

  it('skips anchors without an href, which the platform does not focus', () => {
    const container = mount('<a>Not a link</a><a href="#x">A link</a>')

    expect(getTabbableElements(container)).toHaveLength(1)
  })

  it('skips disabled, hidden, aria-hidden and negatively-tabindexed elements', () => {
    const container = mount(`
      <button type="button" disabled>Disabled</button>
      <button type="button" hidden>Hidden</button>
      <button type="button" aria-hidden="true">Removed from the tree</button>
      <div tabindex="-1">Programmatic only</div>
      <button type="button" id="keep">Reachable</button>
    `)

    const tabbable = getTabbableElements(container)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0].id).toBe('keep')
  })

  it('keeps elements given an explicit positive tabindex', () => {
    const container = mount('<div tabindex="0">Custom widget</div>')

    expect(getTabbableElements(container)).toHaveLength(1)
  })

  it('tolerates a missing container', () => {
    expect(getTabbableElements(null)).toEqual([])
    expect(getTabbableElements(undefined)).toEqual([])
  })
})

describe('focusElement', () => {
  it('focuses a connected element and reports that it did', () => {
    const container = mount('<button type="button" id="target">Target</button>')
    const target = container.querySelector('#target')

    expect(focusElement(target)).toBe(true)
    expect(document.activeElement).toBe(target)
  })

  it('refuses a detached element, so a closing dialog cannot focus a removed trigger', () => {
    const detached = document.createElement('button')

    expect(focusElement(detached)).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('tolerates null and objects that cannot be focused', () => {
    expect(focusElement(null)).toBe(false)
    expect(focusElement({})).toBe(false)
  })
})
