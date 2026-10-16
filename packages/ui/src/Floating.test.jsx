import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from './Button.jsx'
import { Menu } from './Menu.jsx'
import { Popover } from './Popover.jsx'
import { TOOLTIP_DELAY_MS, Tooltip } from './Tooltip.jsx'
import { Icon } from './icons/Icon.jsx'

describe('Popover', () => {
  it('opens from its trigger as a named, non-modal panel and closes on Escape, handing focus back', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button variant="secondary">Filters</Button>} title="Filter events">
        <label>
          City
          <input />
        </label>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Filters' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    const panel = await screen.findByRole('dialog', { name: 'Filter events' })

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveAttribute('aria-modal', 'true')
    // The trigger keeps the Button's own look.
    expect(trigger).toHaveClass('rounded-control', 'focus-visible:outline-focus')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(trigger).toHaveFocus()
  })

  it('floats with the theme’s floating shadow and grows from its trigger, not from nothing', async () => {
    render(
      <Popover open trigger={<button type="button">Open</button>} title="Details">
        Body
      </Popover>,
    )

    const panel = await screen.findByRole('dialog', { name: 'Details' })

    expect(panel).toHaveClass(
      'shadow-floating',
      'origin-(--transform-origin)',
      'data-[starting-style]:scale-95',
      'data-[starting-style]:opacity-0',
    )
    expect(panel.className).not.toMatch(/scale-0\b/)
  })
})

describe('Menu', () => {
  it('is a menu button: arrow keys move, Enter chooses, focus returns to the button', async () => {
    const user = userEvent.setup()
    const edit = vi.fn()
    const remove = vi.fn()

    render(
      <Menu
        trigger={<Button variant="secondary">More</Button>}
        items={[
          { label: 'Edit event', onSelect: edit },
          { separator: true },
          { label: 'Delete event', tone: 'danger', onSelect: remove },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'More' })

    await user.click(trigger)

    const menu = await screen.findByRole('menu')
    const items = screen.getAllByRole('menuitem')

    expect(menu).toBeInTheDocument()
    expect(items.map((item) => item.textContent)).toEqual(['Edit event', 'Delete event'])
    expect(items[1]).toHaveClass('text-status-danger')

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    expect(remove).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  })

  it('renders a destination as a real link through the router link it is given', async () => {
    /**
     * A stand-in for Next's Link.
     *
     * @param {object} props Component props.
     * @returns {JSX.Element} An anchor marked as routed.
     */
    function RouterLink(props) {
      return <a data-routed="" {...props} />
    }

    render(
      <Menu
        open
        linkAs={RouterLink}
        trigger={<button type="button">Account</button>}
        items={[{ label: 'My tickets', href: '/tickets' }]}
      />,
    )

    const entry = await screen.findByRole('menuitem', { name: 'My tickets' })

    expect(entry.tagName).toBe('A')
    expect(entry).toHaveAttribute('href', '/tickets')
    expect(entry).toHaveAttribute('data-routed')
    // 44px rows.
    expect(entry).toHaveClass('min-h-11')
  })
})

describe('Tooltip', () => {
  it('repeats an icon button’s name for sighted readers, after a short rest', async () => {
    render(
      <Tooltip open content="Copy order number">
        <button type="button" aria-label="Copy order number">
          <Icon name="copy" />
        </button>
      </Tooltip>,
    )

    // The control is named by itself; the tip adds nothing a screen reader lacks.
    expect(screen.getByRole('button', { name: 'Copy order number' })).toBeInTheDocument()
    expect(
      await screen.findByText('Copy order number', { selector: '[data-slot="tooltip"]' }),
    ).toHaveClass('bg-surface-inverse', 'text-ink-inverse')
    expect(TOOLTIP_DELAY_MS).toBeGreaterThanOrEqual(400)
    expect(TOOLTIP_DELAY_MS).toBeLessThanOrEqual(600)
  })
})
