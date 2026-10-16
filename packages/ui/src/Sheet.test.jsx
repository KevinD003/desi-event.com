import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Sheet } from './Sheet.jsx'

/**
 * A header with a menu button and its sheet, as the site's header uses one.
 *
 * @returns {JSX.Element} The banner.
 */
function Header() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)

  return (
    <header>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((value) => !value)}
      >
        Menu
      </button>
      <Sheet id="site-menu" open={open} onClose={() => setOpen(false)} returnFocusRef={triggerRef}>
        <nav aria-label="Primary">
          <a href="/events">Discover events</a>
        </nav>
      </Sheet>
    </header>
  )
}

describe('Sheet', () => {
  it('stays where it is written: inside the banner, not portalled to <body>', async () => {
    const user = userEvent.setup()
    render(<Header />)

    await user.click(screen.getByRole('button', { name: 'Menu' }))

    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('navigation', { name: 'Primary' }),
    )
  })

  it('takes focus when it opens, as the header contract requires', async () => {
    const user = userEvent.setup()
    const { container } = render(<Header />)

    await user.click(screen.getByRole('button', { name: 'Menu' }))

    expect(container.querySelector('#site-menu')).toHaveFocus()
  })

  it('closes on Escape and gives focus back to its trigger', async () => {
    const user = userEvent.setup()
    const { container } = render(<Header />)
    const trigger = screen.getByRole('button', { name: 'Menu' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('#site-menu')).not.toBeVisible()
  })

  it('stays in the DOM while closed, hidden, so aria-controls always points at something', () => {
    const { container } = render(<Header />)
    const sheet = container.querySelector('#site-menu')

    expect(sheet).toHaveAttribute('hidden')
    expect(sheet).toHaveAttribute('data-state', 'closed')
  })

  it('slides in by CSS from its edge over the sheet duration, on the drawer curve', () => {
    const { container } = render(
      <Sheet id="filters" open from="bottom" onClose={() => {}}>
        Filters
      </Sheet>,
    )

    expect(container.querySelector('#filters')).toHaveClass(
      'duration-(--duration-sheet)',
      'ease-drawer',
      'starting:opacity-0',
      'starting:translate-y-4',
    )
  })

  it('hands focus to the element it is told to', () => {
    /**
     * A sheet whose search field takes focus.
     *
     * @returns {JSX.Element} The sheet.
     */
    function Search() {
      const fieldRef = useRef(null)

      return (
        <Sheet id="search" open onClose={() => {}} initialFocusRef={fieldRef}>
          <label>
            Search events
            <input ref={fieldRef} />
          </label>
        </Sheet>
      )
    }

    render(<Search />)

    expect(screen.getByRole('textbox', { name: 'Search events' })).toHaveFocus()
  })
})
