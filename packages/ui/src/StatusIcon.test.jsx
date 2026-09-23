import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Alert } from './Alert.jsx'
import { STATUS_TONES, StatusIcon } from './StatusIcon.jsx'

describe('StatusIcon', () => {
  it('is hidden from assistive technology, because the word beside it is the status', () => {
    const { container } = render(<StatusIcon tone="success" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('draws a different shape for every tone, so no two statuses differ only by colour', () => {
    const shapes = STATUS_TONES.map((tone) => {
      const { container } = render(<StatusIcon tone={tone} />)

      return container.querySelector('svg').innerHTML
    })

    expect(new Set(shapes).size).toBe(STATUS_TONES.length)
  })

  it('does not reuse the danger glyph for a refusal', () => {
    const { container: refusal } = render(<StatusIcon tone="refusal" />)
    const { container: danger } = render(<StatusIcon tone="danger" />)

    expect(refusal.querySelector('svg').innerHTML).not.toBe(danger.querySelector('svg').innerHTML)
  })

  it('falls back to the neutral ring for a tone it does not know', () => {
    const { container } = render(<StatusIcon tone="celebration" />)

    expect(container.querySelector('svg')).toHaveAttribute('data-tone', 'neutral')
  })

  it('takes its colour from the text around it rather than a token of its own', () => {
    const { container } = render(<StatusIcon tone="warning" />)

    expect(container.querySelector('svg').innerHTML).toContain('currentColor')
    expect(container.querySelector('svg').innerHTML).not.toMatch(/#[0-9a-f]{3,6}|oklch|rgb/i)
  })
})

describe('Alert carries its status in shape and words, not colour alone', () => {
  it.each([
    ['info', 'info'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['error', 'danger'],
  ])('a %s alert draws the %s glyph beside its title', (variant, tone) => {
    const { container } = render(
      <Alert variant={variant} title="Heads up">
        Body
      </Alert>,
    )

    expect(container.querySelector('[data-slot="status-icon"]')).toHaveAttribute('data-tone', tone)
  })

  it('keeps body copy in ink, and only the title in the status colour', () => {
    const { container, getByText } = render(
      <Alert variant="error" title="Could not save">
        Try again in a minute.
      </Alert>,
    )

    expect(container.firstChild.className).toContain('text-ink')
    expect(getByText('Could not save').className).toContain('text-status-danger')
    expect(getByText('Try again in a minute.').className).not.toContain('text-status-danger')
  })
})
