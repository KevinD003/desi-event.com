/**
 * The primitives wear the theme: its shape, depth, focus ring, press and touch
 * targets — and only tokens the theme actually declares.
 *
 * Tailwind v4 emits a utility only for a token it knows. `bg-accent-secondry`
 * or `shadow-crad` is not an error anywhere: it is a class that quietly
 * generates nothing, and the control renders unstyled. So besides pinning the
 * Garba Nights contract — 12px controls, 20px cards, the card shadow, one
 * outline focus ring, a 0.98 press that only runs where motion is welcome,
 * 44px targets — this file renders every primitive in every variant and checks
 * each colour, shadow and radius class it emits against the theme's own
 * declarations.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Alert } from './Alert.jsx'
import { Badge } from './Badge.jsx'
import { Button } from './Button.jsx'
import { Card, CardBody, CardFooter, CardHeader } from './Card.jsx'
import { EmptyState } from './EmptyState.jsx'
import { FormField } from './FormField.jsx'
import { Input } from './Input.jsx'
import { Label } from './Label.jsx'
import { Modal } from './Modal.jsx'
import { Select } from './Select.jsx'
import { Skeleton } from './Skeleton.jsx'
import { Spinner } from './Spinner.jsx'
import { StatusIcon } from './StatusIcon.jsx'
import { Tabs } from './Tabs.jsx'
import { Textarea } from './Textarea.jsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const theme = readFileSync(path.join(here, '..', '..', 'config', 'src', 'tailwind.css'), 'utf8')

/**
 * The names the theme declares in one namespace, e.g. every `--color-*`.
 *
 * @param {string} namespace `color`, `shadow` or `radius`.
 * @returns {Set<string>} The names after the namespace.
 */
function declared(namespace) {
  const pattern = new RegExp(`--${namespace}-([a-z0-9-]+):`, 'g')

  return new Set([...theme.matchAll(pattern)].map(([, name]) => name))
}

const COLOURS = declared('color')
const SHADOWS = declared('shadow')
const RADII = declared('radius')

/** Tailwind's own sizes and keywords, which are not tokens and need no declaration. */
const BUILT_IN =
  /^(\d+(\.\d+)?|[trblxyse]|xs|sm|md|lg|xl|\dxl|base|left|center|right|dashed|solid|inset|none|hidden|transparent|current|inherit|full|offset-\d+)$/

/**
 * Every token a class list names, with where it must be declared.
 *
 * Variants (`hover:`, `focus-visible:` …), opacity suffixes (`/25`) and the
 * side of a radius or border (`rounded-t-`, `border-b-`) are stripped first;
 * Tailwind's own sizes and keywords are skipped.
 *
 * @param {string} classes A `className`.
 * @returns {Array<{cls: string, set: Set<string>, name: string}>} The tokens to check.
 */
function tokensNamed(classes) {
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((cls) => {
      const utility = cls
        .split(':')
        .at(-1)
        .replace(/\/\d+$/, '')
      const radius = /^rounded(?:-[trblse]{1,2})?-(.+)$/.exec(utility)
      const shadow = /^shadow-(.+)$/.exec(utility)
      const colour =
        /^(?:bg|text|border(?:-[trblxyse])?|ring|outline|fill|stroke|placeholder)-(.+)$/.exec(
          utility,
        )

      if (radius && !BUILT_IN.test(radius[1])) return [{ cls, set: RADII, name: radius[1] }]
      if (shadow && !BUILT_IN.test(shadow[1])) return [{ cls, set: SHADOWS, name: shadow[1] }]
      if (colour && !BUILT_IN.test(colour[1])) return [{ cls, set: COLOURS, name: colour[1] }]

      return []
    })
}

/**
 * Every primitive, in every variant and state that changes its classes.
 *
 * @returns {JSX.Element} All of them at once.
 */
function Everything() {
  return (
    <>
      {['primary', 'secondary', 'outline', 'ghost', 'danger'].flatMap((variant) =>
        ['sm', 'md', 'lg'].map((size) => (
          <Button key={`${variant}-${size}`} variant={variant} size={size}>
            {variant}
          </Button>
        )),
      )}
      <Button loading>Paying</Button>
      {['neutral', 'brand', 'secondary', 'highlight', 'success', 'warning', 'danger', 'info'].map(
        (variant) => (
          <Badge key={variant} variant={variant} srLabel="Status:">
            {variant}
          </Badge>
        ),
      )}
      <Card interactive>
        <CardHeader>Header</CardHeader>
        <CardBody>Body</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>
      {['info', 'success', 'warning', 'error'].map((variant) => (
        <Alert key={variant} variant={variant} title="Title" onDismiss={() => {}}>
          Body
        </Alert>
      ))}
      <Input aria-label="Valid" />
      <Input aria-label="Invalid" invalid />
      <Select aria-label="Select" options={[{ value: 'a', label: 'A' }]} invalid />
      <Textarea aria-label="Notes" />
      <Label htmlFor="x" required>
        Label
      </Label>
      <FormField label="Field" description="Help" error="Wrong">
        <Input />
      </FormField>
      <EmptyState title="Nothing yet" description="Try later" icon="*" />
      <Skeleton lines={2} />
      <Spinner />
      {['success', 'warning', 'danger', 'info', 'neutral'].map((tone) => (
        <StatusIcon key={tone} tone={tone} />
      ))}
      <Tabs
        label="Sections"
        items={[
          { id: 'one', label: 'One', content: 'First' },
          { id: 'two', label: 'Two', content: 'Second', disabled: true },
        ]}
      />
      <Modal open onClose={() => {}} title="Dialog" description="About" footer="Footer">
        Body
      </Modal>
    </>
  )
}

describe('every primitive names only tokens the theme declares', () => {
  it('finds the theme’s namespaces, so the check below is not vacuous', () => {
    expect(COLOURS.has('action-primary')).toBe(true)
    expect(SHADOWS).toEqual(new Set(['card', 'card-hover', 'control', 'dialog']))
    expect(RADII).toEqual(new Set(['card', 'control']))
  })

  it('renders no colour, shadow or radius class without a declaration behind it', () => {
    render(<Everything />)

    const named = [...document.body.querySelectorAll('[class]')].flatMap((element) =>
      tokensNamed(element.getAttribute('class')),
    )

    // Enough to mean the whole library was seen, not one stray element.
    expect(new Set(named.map(({ name }) => name)).size).toBeGreaterThan(40)
    expect(named.filter(({ set, name }) => !set.has(name)).map(({ cls }) => cls)).toEqual([])
  })

  it('would catch a misspelt token', () => {
    const [typo] = tokensNamed('hover:bg-accent-secondry/25')

    expect(typo.set.has(typo.name)).toBe(false)
    expect(tokensNamed('text-sm rounded-full ring-1 outline-offset-2 border-b-2 border-t')).toEqual(
      [],
    )
    expect(tokensNamed('border-b-accent-strng')[0].name).toBe('accent-strng')
  })
})

describe('Button', () => {
  it('rounds at the control radius and presses to 98%, only where motion is welcome', () => {
    render(<Button>Find events</Button>)

    const button = screen.getByRole('button', { name: 'Find events' })

    expect(button).toHaveClass('rounded-control', 'motion-safe:enabled:active:scale-[0.98]')
    // A press that is not gated on motion-safe would run under reduced motion.
    expect([...button.classList].filter((cls) => /scale-/.test(cls))).toEqual([
      'motion-safe:enabled:active:scale-[0.98]',
    ])
  })

  it('draws the one focus colour as an outline, which forced-colours mode keeps', () => {
    render(<Button variant="secondary">Cancel</Button>)

    const button = screen.getByRole('button', { name: 'Cancel' })

    expect(button).toHaveClass(
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-focus',
    )
    expect(button.className).not.toMatch(/focus-visible:outline-none|focus-visible:ring-/)
  })

  it('is at least 44px tall at the default and large sizes, and grows to 44px under a finger when small', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button>Medium</Button>
        <Button size="lg">Large</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass(
      'min-h-9',
      'pointer-coarse:min-h-11',
    )
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('min-h-12')
  })

  it('times its transitions with the theme’s fast duration and easing', () => {
    render(<Button>Timed</Button>)

    expect(screen.getByRole('button', { name: 'Timed' })).toHaveClass(
      'duration-(--duration-fast)',
      'ease-standard',
    )
  })
})

describe('form controls', () => {
  it.each([
    ['Input', <Input key="i" aria-label="Control" />],
    ['Select', <Select key="s" aria-label="Control" options={[{ value: 'a', label: 'A' }]} />],
    ['Textarea', <Textarea key="t" aria-label="Control" />],
  ])('%s is a 44px, 12px-round control with the outline focus ring', (_name, control) => {
    render(control)

    const element = screen.getByLabelText('Control')

    expect(element).toHaveClass(
      'min-h-11',
      'rounded-control',
      'shadow-control',
      'focus:outline-2',
      'focus:outline-focus',
    )
    // 16px on a phone, so iOS does not zoom the page into the field.
    expect(element).toHaveClass('text-base', 'sm:text-sm')
  })

  it('rings an invalid control in the danger colour instead', () => {
    render(<Input aria-label="Email" invalid />)

    const input = screen.getByRole('textbox', { name: 'Email' })

    expect(input).toHaveClass('focus:outline-status-danger')
    expect(input).not.toHaveClass('focus:outline-focus')
  })
})

describe('Card', () => {
  it('rounds at the card radius and sits on the page with the card shadow', () => {
    render(<Card data-testid="card">Content</Card>)

    expect(screen.getByTestId('card')).toHaveClass('rounded-card', 'shadow-card')
  })

  it('deepens its shadow when interactive and hovered, over the theme’s base duration', () => {
    render(
      <Card interactive data-testid="card">
        Content
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass(
      'hover:shadow-card-hover',
      'duration-(--duration-base)',
    )
  })
})

describe('Badge', () => {
  it.each([
    ['secondary', ['bg-accent-secondary-soft', 'text-accent-secondary']],
    ['highlight', ['bg-highlight', 'text-highlight-ink']],
  ])('%s wears its own measured pair', (variant, classes) => {
    render(
      <Badge variant={variant} data-testid="badge">
        Garba & dandiya
      </Badge>,
    )

    expect(screen.getByTestId('badge')).toHaveClass('rounded-full', ...classes)
  })
})

describe('headings the primitives render', () => {
  it('set an empty state’s title in the display face', () => {
    render(<EmptyState title="No events in Edison yet" />)

    expect(screen.getByRole('heading', { name: 'No events in Edison yet' })).toHaveClass(
      'font-display',
    )
  })

  it('set a dialog’s title in the display face', () => {
    render(
      <Modal open onClose={vi.fn()} title="Reserve tickets">
        Body
      </Modal>,
    )

    expect(screen.getByRole('heading', { name: 'Reserve tickets' })).toHaveClass('font-display')
  })
})

describe('small icon buttons', () => {
  it('grow to 44px under a finger: the alert’s dismiss and the dialog’s close', () => {
    render(
      <>
        <Alert title="Saved" onDismiss={vi.fn()} dismissLabel="Dismiss message">
          Done
        </Alert>
        <Modal open onClose={vi.fn()} title="Dialog">
          Body
        </Modal>
      </>,
    )

    for (const name of ['Dismiss message', 'Close dialog']) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'pointer-coarse:h-11',
        'pointer-coarse:w-11',
      )
    }
  })
})
