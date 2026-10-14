import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  EventContact,
  EventDirections,
  EventDressCode,
  EventFaq,
  EventLineUp,
  EventRunningOrder,
  EventSocialLinks,
  EventSponsors,
} from './event-content.jsx'

describe('the line-up', () => {
  it('shows names alone as a row of names, each item exactly the name', () => {
    const { container } = render(<EventLineUp artists={['Nizami Bandhu', 'Warsi Brothers']} />)

    expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Nizami Bandhu',
      'Warsi Brothers',
    ])
  })

  it('shows roles and bios in billing order when the organiser gave them', () => {
    render(
      <EventLineUp
        performers={[
          { name: 'Falguni Pathak', role: 'Lead vocals', bio: 'Thirty years of garba.' },
          { name: 'Dhol Collective', role: null, bio: null },
        ]}
        artists={['Somebody else']}
      />,
    )

    const items = screen.getAllByRole('listitem')

    expect(items[0]).toHaveTextContent('Falguni Pathak — Lead vocals')
    expect(items[0]).toHaveTextContent('Thirty years of garba.')
    expect(items[1]).toHaveTextContent('Dhol Collective')
    expect(screen.queryByText('Somebody else')).not.toBeInTheDocument()
  })

  it('renders nothing without anybody on the bill', () => {
    const { container } = render(<EventLineUp performers={[]} artists={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('the running order', () => {
  it('reads local times in 12-hour form with the zone on the day, in order', () => {
    render(
      <EventRunningOrder
        timezone="America/New_York"
        startsAt="2027-10-04T23:00:00.000Z"
        items={[
          { time: '18:30', title: 'Doors', note: null },
          { time: '19:30', title: 'Aarti', note: 'Please stand.' },
        ]}
      />,
    )

    const section = screen.getByRole('region', { name: 'Running order' })
    const items = within(section).getAllByRole('listitem')

    expect(items[0]).toHaveTextContent('6:30 PM EDT')
    expect(items[1]).toHaveTextContent('7:30 PM EDT')
    expect(items[1]).toHaveTextContent('Please stand.')
    expect(items[1].querySelector('time')).toHaveAttribute('dateTime', '19:30')
  })

  it('renders nothing for an empty order', () => {
    const { container } = render(<EventRunningOrder items={[]} timezone="UTC" />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('questions people ask', () => {
  it('uses native disclosures, which a keyboard opens as well as a click', async () => {
    const user = userEvent.setup()

    render(<EventFaq items={[{ question: 'Is there parking?', answer: 'Yes, lot B.' }]} />)

    const summary = screen.getByText('Is there parking?')

    expect(summary.tagName).toBe('SUMMARY')

    await user.click(summary)

    expect(summary.closest('details')).toHaveAttribute('open')
  })
})

describe('contact and links', () => {
  it('links the public email and phone with visible text', () => {
    render(<EventContact email="hello@garba.example" phone="+1 (212) 555-0100" />)

    expect(screen.getByRole('link', { name: 'hello@garba.example' })).toHaveAttribute(
      'href',
      'mailto:hello@garba.example',
    )
    expect(screen.getByRole('link', { name: '+1 (212) 555-0100' })).toHaveAttribute(
      'href',
      'tel:+12125550100',
    )
  })

  it('renders no contact section when nothing was published', () => {
    const { container } = render(<EventContact email={null} phone={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names each network in text, and drops a link that is not https or not on that network', () => {
    render(
      <EventSocialLinks
        links={{
          website: 'https://garba.example',
          instagram: 'https://www.instagram.com/garba',
          facebook: 'https://facebook.com.evil.example/garba',
          youtube: 'http://youtube.com/garba',
          x: 'javascript:alert(1)',
        }}
      />,
    )

    const links = screen.getAllByRole('link')

    // A stored `website` key is never a link here: the website has its own
    // switched link, through The Desi Events' redirect.
    expect(links.map((link) => link.textContent)).toEqual(['Instagram'])
    expect(screen.queryByText('Website')).toBeNull()
    expect(screen.queryByText('(garba.example)')).toBeNull()
    expect(links[0]).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer')
    expect(screen.getByText('(instagram.com)')).toBeInTheDocument()
  })

  it('links a sponsor only to an https website', () => {
    render(
      <EventSponsors
        items={[
          { name: 'Patel Brothers', url: 'https://patel.example', level: 'Gold' },
          { name: 'Corner Sweets', url: 'javascript:alert(1)', level: null },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Patel Brothers' })).toHaveAttribute(
      'href',
      'https://patel.example',
    )
    expect(screen.queryByRole('link', { name: 'Corner Sweets' })).not.toBeInTheDocument()
    expect(screen.getByText('Corner Sweets')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
  })
})

describe('dress code and directions', () => {
  it('keeps the organiser’s line breaks, as text', () => {
    render(
      <>
        <EventDressCode text={'Traditional dress welcome.\nComfortable shoes.'} />
        <EventDirections text="<b>Park</b> at the school." />
      </>,
    )

    expect(screen.getByRole('region', { name: 'Dress code' })).toHaveTextContent(
      'Traditional dress welcome.',
    )
    // Text, never markup.
    expect(screen.getByText('<b>Park</b> at the school.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Getting there' })).toBeInTheDocument()
  })
})
