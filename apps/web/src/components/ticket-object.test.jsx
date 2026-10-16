/**
 * The ticket object: a face and a stub joined at a tear line, a gold keyline
 * only on the day, and nothing for assistive technology to read twice.
 *
 * @module components/ticket-object.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TicketObject } from './ticket-object.jsx'

describe('TicketObject', () => {
  it('is an article with a face and a stub on ticket paper, in that order', () => {
    const { container } = render(
      <TicketObject face={<h2>Holi in the Park</h2>} stub={<p>Show my entry pass</p>} />,
    )

    const ticket = container.querySelector('[data-slot="ticket"]')

    expect(ticket.tagName).toBe('ARTICLE')
    expect([...ticket.children].map((piece) => piece.className.split(' ')[0])).toEqual([
      'ticket-face',
      'ticket-stub',
    ])
    for (const piece of ticket.children) {
      expect(piece.className).toContain('bg-ticket-paper')
      expect(piece.className).toContain('text-ticket-ink')
    }
    expect(screen.getByRole('heading', { name: 'Holi in the Park' })).toBeInTheDocument()
  })

  it('draws the perforation as decoration, kept clear of the notches', () => {
    const { container } = render(<TicketObject face="Face" stub="Stub" />)

    const tear = container.querySelector('.ticket-stub > span[aria-hidden="true"]')

    expect(tear.className).toContain('border-dashed')
    expect(tear.className).toMatch(/inset-x-5/u)
    expect(tear.className).toMatch(/md:inset-y-5/u)
  })

  it('draws the gold keyline only on the day, hidden from assistive technology', () => {
    const { container, rerender } = render(<TicketObject face="Face" stub="Stub" />)

    expect(container.querySelector('[data-slot="ticket-keyline"]')).toBeNull()
    expect(container.querySelector('[data-event-day]')).toBeNull()

    rerender(<TicketObject eventDay face="Face" stub="Stub" />)

    const keyline = container.querySelector('[data-slot="ticket-keyline"]')

    expect(keyline).toHaveAttribute('aria-hidden', 'true')
    expect(keyline.getAttribute('class')).toContain('text-highlight')
    expect(keyline.querySelector('rect')).toHaveAttribute('pathLength', '100')
    expect(container.querySelector('[data-event-day]')).not.toBeNull()
  })

  it('can be a list item’s child, or a list item itself', () => {
    const { container } = render(
      <ul>
        <TicketObject as="li" face="Face" stub="Stub" />
      </ul>,
    )

    expect(container.querySelector('li[data-slot="ticket"]')).not.toBeNull()
  })

  it('draws a ticket that no longer admits quieter, and says nothing about it itself', () => {
    const { container } = render(<TicketObject muted face="Face" stub="Stub" />)

    expect(container.querySelector('.ticket-face').className).toContain('text-ink-muted')
    expect(container.textContent).toBe('FaceStub')
  })
})
