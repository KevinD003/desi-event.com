/**
 * The courtyard's shared page furniture.
 *
 * What these pin is structure, not looks: one `h1` per header and the eyebrow
 * never a heading, a section named by its own heading, a count that is a term
 * and its value, a poster that assistive technology does not hear, and
 * controls that meet the 44px touch target.
 *
 * @module components/workspace-kit.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Badge } from './ui.jsx'
import {
  CountTile,
  CountTiles,
  LINK_PANEL,
  PageHeader,
  PosterThumb,
  PRIMARY_LINK,
  SECONDARY_LINK,
  Section,
  TABLE_FRAME,
} from './workspace-kit.jsx'

afterEach(cleanup)

describe('PageHeader', () => {
  it('draws one level-one heading, with the eyebrow as a paragraph above it', () => {
    render(
      <PageHeader
        eyebrow="Workspace · Money"
        title="Finance"
        description="Derived from the ledger."
        actions={<a href="/export">Download</a>}
      />,
    )

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeTruthy()

    // The eyebrow is wayfinding, not part of the outline.
    const eyebrow = screen.getByText('Workspace · Money')

    expect(eyebrow.tagName).toBe('P')
    expect(screen.getByText('Derived from the ledger.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy()
  })

  it('draws no eyebrow and no empty description when none is given', () => {
    const { container } = render(<PageHeader title="Your account" />)

    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})

describe('Section', () => {
  it('is a region named by its own second-level heading', () => {
    render(
      <Section id="money-heading" title="Money" description="From the ledger.">
        <p>Figures</p>
      </Section>,
    )

    const region = screen.getByRole('region', { name: 'Money' })

    expect(within(region).getByRole('heading', { level: 2, name: 'Money' }).id).toBe(
      'money-heading',
    )
    expect(within(region).getByText('Figures')).toBeTruthy()
  })
})

describe('CountTiles', () => {
  it('pairs each count with what it counts, as a description list', () => {
    render(
      <CountTiles>
        <CountTile label="Waiting on you" value={3} hint="Of the events listed." />
        <CountTile label="On sale" value={0} />
      </CountTiles>,
    )

    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    const values = screen.getAllByRole('definition').map((value) => value.textContent)

    expect(terms).toEqual(['Waiting on you', 'On sale'])
    expect(values).toEqual(['3Of the events listed.', '0'])
  })
})

describe('PosterThumb', () => {
  it('draws the event’s poster and hides it from assistive technology', () => {
    const { container } = render(
      <PosterThumb
        event={{ slug: 'navratri-night-one-edison', title: 'Navratri Night One' }}
        className="w-36"
      />,
    )

    const thumb = container.querySelector('[data-slot="poster-thumb"]')

    expect(thumb.getAttribute('aria-hidden')).toBe('true')
    expect(thumb.querySelector('svg[data-slot="poster"]')).not.toBeNull()
    // Hidden, so it is not announced as an image before the card's heading.
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('draws the approved cover instead when there is one, still unheard', () => {
    const { container } = render(
      <PosterThumb
        event={{
          slug: 'navratri-night-one-edison',
          title: 'Navratri Night One',
          coverImage: {
            id: 'cmedia0000000000000000001',
            url: '/v1/media/cmedia0000000000000000001',
            altText: 'Dancers circling a lit garbo',
            width: 1200,
            height: 800,
            contentType: 'image/jpeg',
          },
        }}
        className="w-36"
      />,
    )

    const thumb = container.querySelector('[data-slot="poster-thumb"]')

    expect(thumb.querySelector('svg[data-slot="poster"]')).toBeNull()
    expect(thumb.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('class sets', () => {
  it.each([
    ['PRIMARY_LINK', PRIMARY_LINK],
    ['SECONDARY_LINK', SECONDARY_LINK],
  ])('%s is a 44px target with a visible focus ring', (_name, classes) => {
    expect(classes).toContain('min-h-11')
    // An outline, which forced-colours mode keeps; a box-shadow ring it drops.
    expect(classes).toContain('focus-visible:outline-2')
    expect(classes).toContain('focus-visible:outline-focus')
    expect(classes).not.toMatch(/focus-visible:(ring-|outline-none)/)
  })

  it('draws a focus outline round a destination card', () => {
    expect(LINK_PANEL).toContain('focus-visible:outline-2')
    expect(LINK_PANEL).toContain('focus-visible:outline-focus')
    expect(LINK_PANEL).not.toMatch(/focus-visible:(ring-|outline-none)/)
  })

  it('lets a framed table scroll inside itself rather than widen the page', () => {
    expect(TABLE_FRAME).toContain('overflow-x-auto')
  })

  it('is the containing block of the screen-reader-only words in its table, so they scroll with it', () => {
    // A badge's "Status:" is `sr-only`, which is `position: absolute`. A scroll
    // box clips an absolutely positioned descendant only when it is that
    // descendant's containing block; without `relative` the words past the
    // edge of a narrow screen widened the page instead (found by the
    // accessibility sweep on /admin/organizer-invitations at 320 px).
    const classes = TABLE_FRAME.split(/\s+/u)

    expect(classes).toContain('relative')
    expect(classes).toContain('overflow-x-auto')

    render(
      <div data-testid="frame" className={TABLE_FRAME}>
        <table>
          <tbody>
            <tr>
              <td>
                <Badge variant="neutral" srLabel="Status:">
                  Waiting
                </Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>,
    )

    const frame = screen.getByTestId('frame')
    const label = screen.getByText('Status:')

    expect(label).toHaveClass('sr-only')
    expect(frame).toContainElement(label)
    expect(frame).toHaveClass('relative')
  })
})
