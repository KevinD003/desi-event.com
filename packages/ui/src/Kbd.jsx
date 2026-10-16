import { cn } from './cn.js'

/**
 * @typedef {object} KbdProps
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} children The key, as printed on it: `Esc`, `Enter`, `/`.
 */

/**
 * A key on the keyboard, named in running text — "press <Kbd>Esc</Kbd> to
 * close". The native `<kbd>` element, so a screen reader can announce it as
 * keyboard input, drawn as a small key cap: a hairline, a sunken face and a
 * heavier bottom edge, in the text face rather than a monospace costume.
 *
 * @param {KbdProps} props Component props, forwarded to the `kbd` element.
 * @returns {JSX.Element} The key.
 */
export function Kbd({ className, children, ...rest }) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-plate border border-line-strong border-b-2 bg-surface-subtle px-1.5 font-sans text-caption font-semibold text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  )
}

export default Kbd
