import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EventGallery } from './event-gallery.jsx'

/**
 * A gallery picture.
 *
 * @param {number} n Distinguishes it.
 * @returns {object} The payload.
 */
function picture(n) {
  const id = `cmedia000000000000000000${n}`

  return {
    id,
    url: `/v1/media/${id}`,
    altText: `The stage from row ${n}`,
    width: 800,
    height: 800,
    contentType: 'image/jpeg',
  }
}

describe('EventGallery', () => {
  it('lists each approved picture with its description, linking to the full size', () => {
    render(<EventGallery images={[picture(1), picture(2), picture(3)]} />)

    const section = screen.getByRole('region', { name: 'Pictures' })
    const items = within(section).getAllByRole('listitem')

    expect(items).toHaveLength(3)

    const link = within(items[1]).getByRole('link', {
      name: /^The stage from row 2\s*\(opens the full-size picture\)$/u,
    })

    expect(link).toHaveAttribute('href', '/api/v1/media/cmedia0000000000000000002')
    expect(
      within(items[1]).getByRole('img', { name: 'The stage from row 2' }).getAttribute('src'),
    ).toContain('/_next/image?url=%2Fapi%2Fv1%2Fmedia%2Fcmedia0000000000000000002')
  })

  it('renders nothing at all for an empty gallery', () => {
    const { container } = render(<EventGallery images={[]} />)

    expect(container).toBeEmptyDOMElement()
    expect(render(<EventGallery />).container).toBeEmptyDOMElement()
  })

  it('drops a picture whose address is not this site’s', () => {
    render(
      <EventGallery
        images={[picture(1), { ...picture(2), url: 'https://elsewhere.example/a.jpg' }]}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})
