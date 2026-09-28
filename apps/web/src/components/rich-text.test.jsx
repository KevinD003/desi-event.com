import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { RichText } from './rich-text.jsx'

describe('RichText', () => {
  it('renders paragraphs, line breaks, lists, bold and italics as elements', () => {
    const { container } = render(
      <RichText text={'**Live** dhol,\n*all* night.\n\n- garba\n- dandiya'} />,
    )

    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.querySelector('strong')).toHaveTextContent('Live')
    expect(container.querySelector('em')).toHaveTextContent('all')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'garba',
      'dandiya',
    ])
  })

  it('links https with the exact relation, and shows anything else as text', () => {
    const { container } = render(
      <RichText text="[site](https://example.com) [bad](javascript:alert(1)) <img src=x onerror=alert(1)>" />,
    )

    const links = container.querySelectorAll('a')

    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://example.com')
    expect(links[0]).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer')
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('[bad](javascript:alert(1))')
    expect(container.querySelector('[href^="javascript"]')).toBeNull()
  })

  it('writes each link’s address after its label only when a reviewer asks', () => {
    const text = '**[Tickets](https://phish.example/buy)** and https://example.com/faq'
    const { container, rerender } = render(<RichText text={text} />)

    expect(container).not.toHaveTextContent('(https://phish.example/buy)')

    rerender(<RichText text={text} showDestinations />)

    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'href',
      'https://phish.example/buy',
    )
    expect(screen.getByText('(https://phish.example/buy)')).toBeInTheDocument()
    // Inside bold as well as at the top level.
    expect(container.querySelector('strong')).toHaveTextContent(
      'Tickets (https://phish.example/buy)',
    )
    // A bare address already says where it goes.
    expect(container).not.toHaveTextContent('(https://example.com/faq)')
  })

  it('renders nothing for an empty description', () => {
    const { container } = render(<RichText text="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('never injects raw HTML', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, 'rich-text.jsx'), 'utf8')

    expect(source).not.toMatch(/dangerouslySetInnerHTML/)
  })
})
