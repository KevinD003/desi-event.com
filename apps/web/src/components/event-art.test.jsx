import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EventArt } from './event-art.jsx'

const COVER = {
  id: 'cmedia0000000000000000001',
  url: '/v1/media/cmedia0000000000000000001',
  altText: 'Dancers circling a lit garbo under string lights',
  width: 1200,
  height: 630,
  contentType: 'image/png',
}

const EVENT = { slug: 'garba-night', title: 'Garba Night', category: 'GARBA_DANDIYA' }

describe('EventArt', () => {
  it('draws the approved cover through the image optimiser, with the organiser’s description', () => {
    const { container } = render(<EventArt event={{ ...EVENT, coverImage: COVER }} />)
    const image = screen.getByRole('img', { name: COVER.altText })

    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toContain(
      '/_next/image?url=%2Fapi%2Fv1%2Fmedia%2Fcmedia0000000000000000001',
    )
    expect(image.getAttribute('srcset')).toContain('%2Fapi%2Fv1%2Fmedia%2F')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-slot="event-art"]')).toHaveClass('aspect-[3/2]')
  })

  it('says nothing when it is decoration beside a title', () => {
    const { container } = render(<EventArt event={{ ...EVENT, coverImage: COVER }} decorative />)
    const image = container.querySelector('img')

    expect(image).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img', { name: COVER.altText })).toBeNull()
  })

  it('falls back to the generated poster with no cover', () => {
    const { container } = render(<EventArt event={{ ...EVENT, coverImage: null }} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg[data-slot="poster"]')).not.toBeNull()
    expect(screen.getByRole('img', { name: /for Garba Night$/u })).toBeInTheDocument()
  })

  it.each([
    ['a third-party address', 'https://tracker.example/pixel.png'],
    ['a path with a query', '/v1/media/cmedia0000000000000000001?x=1'],
    ['a relative escape', '/v1/media/../auth/me'],
  ])('refuses a cover URL that is %s and draws the poster', (_name, url) => {
    const { container } = render(<EventArt event={{ ...EVENT, coverImage: { ...COVER, url } }} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg[data-slot="poster"]')).not.toBeNull()
  })

  it('uses the hero frame for the event page', () => {
    const { container } = render(
      <EventArt
        event={{ ...EVENT, coverImage: COVER }}
        variant="hero"
        priority
        className="lg:h-full"
      />,
    )
    const frame = container.querySelector('[data-slot="event-art"]')

    expect(frame.className).toContain('lg:aspect-[16/7]')
    expect(frame.className).toContain('lg:h-full')
    expect(container.querySelector('img')).toHaveAttribute('sizes', '100vw')
  })
})
