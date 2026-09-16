import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './Tabs.jsx'

const ITEMS = [
  { id: 'about', label: 'About', content: 'Garba night at the town hall.' },
  { id: 'lineup', label: 'Line-up', content: 'DJ Meera, Dhol Collective.' },
  { id: 'venue', label: 'Venue', content: '12 Broad Street, Leicester.' },
]

/**
 * Focus the first tab the way a keyboard user arrives at the tab list.
 *
 * @param {object} user A user-event session.
 * @returns {Promise<void>} Resolves once the tab list has focus.
 */
async function tabIntoList(user) {
  await user.tab()
}

describe('Tabs', () => {
  it('wires tabs and panels together', () => {
    render(<Tabs items={ITEMS} label="Event sections" />)

    const tabs = screen.getAllByRole('tab')
    const panel = screen.getByRole('tabpanel')

    expect(screen.getByRole('tablist')).toHaveAccessibleName('Event sections')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id)
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveTextContent('Garba night at the town hall.')
  })

  it('shows only the selected panel', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" />)

    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: 'Venue' }))

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('12 Broad Street, Leicester.')
    expect(screen.queryByText('Garba night at the town hall.')).not.toBeVisible()
  })

  it('is a single tab stop: Tab enters the list and then leaves it for the panel', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" />)

    await tabIntoList(user)
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })

  it('moves and activates with the arrow keys, wrapping at both ends', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" />)

    await tabIntoList(user)

    await user.keyboard('{ArrowRight}')
    const lineup = screen.getByRole('tab', { name: 'Line-up' })
    expect(lineup).toHaveFocus()
    expect(lineup).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('DJ Meera, Dhol Collective.')

    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Venue' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('12 Broad Street, Leicester.')
  })

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" />)

    await tabIntoList(user)

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Venue' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('12 Broad Street, Leicester.')

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus()
  })

  it('moves the roving tabindex with the selection', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" />)

    await tabIntoList(user)
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Line-up' })).toHaveAttribute('tabindex', '0')
  })

  it('skips disabled tabs when arrowing', async () => {
    const user = userEvent.setup()
    const items = [ITEMS[0], { ...ITEMS[1], disabled: true }, ITEMS[2]]

    render(<Tabs items={items} label="Event sections" />)

    await tabIntoList(user)
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Venue' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Line-up' })).toHaveAttribute('aria-selected', 'false')
  })

  it('reports every change once, and only on a real change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Tabs items={ITEMS} label="Event sections" onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: 'Line-up' }))
    expect(onChange).toHaveBeenCalledWith('lineup')

    await user.click(screen.getByRole('tab', { name: 'Line-up' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('starts on defaultTabId when given one', () => {
    render(<Tabs items={ITEMS} label="Event sections" defaultTabId="venue" />)

    expect(screen.getByRole('tab', { name: 'Venue' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('12 Broad Street, Leicester.')
  })

  it('obeys the parent when controlled', async () => {
    const user = userEvent.setup()

    function Controlled() {
      const [active, setActive] = useState('about')

      return (
        <>
          <button type="button" onClick={() => setActive('venue')}>
            Show venue
          </button>
          <Tabs items={ITEMS} label="Event sections" activeTabId={active} onChange={setActive} />
        </>
      )
    }

    render(<Controlled />)

    await user.click(screen.getByRole('button', { name: 'Show venue' }))
    expect(screen.getByRole('tab', { name: 'Venue' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Line-up' }))
    expect(screen.getByRole('tab', { name: 'Line-up' })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves focus without selecting when activation is manual', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" activation="manual" />)

    await tabIntoList(user)
    await user.keyboard('{ArrowRight}')

    const lineup = screen.getByRole('tab', { name: 'Line-up' })
    expect(lineup).toHaveFocus()
    expect(lineup).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Garba night at the town hall.')

    await user.keyboard('{Enter}')
    expect(lineup).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('DJ Meera, Dhol Collective.')
  })

  it('uses the vertical axis when asked to', async () => {
    const user = userEvent.setup()
    render(<Tabs items={ITEMS} label="Event sections" orientation="vertical" />)

    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')

    await tabIntoList(user)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: 'Line-up' })).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus()
  })
})
