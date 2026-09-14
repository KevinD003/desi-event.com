import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn.js'
import { focusElement, getTabbableElements } from './focus.js'

/** Tailwind width per modal size. */
const MODAL_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/**
 * @typedef {object} ModalProps
 * @property {boolean} open Whether the dialog is shown. The dialog is unmounted when false.
 * @property {Function} onClose Called when the user asks to close: Escape, the close button, or an overlay click.
 * @property {ReactNode} [title] Dialog title. Rendered as a heading and used as the accessible name.
 * @property {ReactNode} [description] Supporting text referenced by `aria-describedby`.
 * @property {ReactNode} [footer] Action row pinned to the bottom of the dialog.
 * @property {ReactNode} [children] Dialog body.
 * @property {object} [initialFocusRef] Ref to the element that should receive focus on open. Defaults to the dialog itself.
 * @property {boolean} [closeOnOverlayClick] Whether clicking the backdrop closes the dialog. Defaults to true.
 * @property {boolean} [closeOnEscape] Whether Escape closes the dialog. Defaults to true.
 * @property {boolean} [showCloseButton] Whether to render the close button. Defaults to true.
 * @property {string} [closeLabel] Accessible name of the close button. Defaults to `Close dialog`.
 * @property {'sm'|'md'|'lg'|'xl'} [size] Width token. Defaults to `md`.
 * @property {string} [ariaLabel] Accessible name for a dialog rendered without a visible `title`.
 * @property {Element} [container] Portal target. Defaults to `document.body`.
 * @property {string} [className] Extra classes merged onto the dialog panel.
 * @property {string} [overlayClassName] Extra classes merged onto the backdrop.
 */

/**
 * A modal dialog.
 *
 * Everything the WAI-ARIA dialog pattern asks for is implemented here rather
 * than left to the caller: the panel is `role="dialog"` with `aria-modal`, it
 * is named by its title, focus moves into it on open and back to the element
 * that opened it on close, Escape closes it, and Tab cycles inside it so the
 * page behind can never be reached with the keyboard while it is open. Page
 * scrolling is frozen while the dialog is up and restored on unmount, even if
 * the dialog is unmounted without closing first.
 *
 * @param {ModalProps} props Component props.
 * @returns {JSX.Element|null} A portal containing the dialog, or null while closed.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  initialFocusRef,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  closeLabel = 'Close dialog',
  size = 'md',
  ariaLabel,
  container,
  className,
  overlayClassName,
  ...rest
}) {
  const dialogRef = useRef(null)
  const overlayRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const [mounted, setMounted] = useState(false)

  const generatedId = useId()
  const titleId = `modal-${generatedId}-title`
  const descriptionId = `modal-${generatedId}-description`

  // Portals need a DOM: render nothing on the server, then mount on the client.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Remember what had focus before the dialog took it, and hand it back on
  // close. Without this a keyboard user is dumped at the top of the document.
  useEffect(() => {
    if (!open) return undefined

    previouslyFocusedRef.current = document.activeElement

    return () => {
      const previous = previouslyFocusedRef.current
      previouslyFocusedRef.current = null
      focusElement(previous)
    }
  }, [open])

  // Freeze the page behind the dialog; the cleanup runs on unmount too, so a
  // dialog torn down while open cannot leave the page unscrollable.
  useEffect(() => {
    if (!open) return undefined

    const { body } = document
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open || !mounted) return

    const dialog = dialogRef.current
    if (!dialog) return

    // Fall back to the dialog itself so the screen reader reads the title.
    if (!focusElement(initialFocusRef?.current)) focusElement(dialog)
  }, [open, mounted, initialFocusRef])

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation()
        onClose?.(event)
        return
      }

      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const tabbable = getTabbableElements(dialog)

      if (tabbable.length === 0) {
        event.preventDefault()
        focusElement(dialog)
        return
      }

      const first = tabbable[0]
      const last = tabbable[tabbable.length - 1]
      const active = document.activeElement
      const inside = dialog.contains(active)

      // The dialog container itself is focusable but not tabbable, so Tab from
      // it must be steered explicitly to the ends of the trapped range.
      if (event.shiftKey && (!inside || active === first || active === dialog)) {
        event.preventDefault()
        focusElement(last)
      } else if (!event.shiftKey && (!inside || active === last || active === dialog)) {
        event.preventDefault()
        focusElement(first)
      }
    },
    [closeOnEscape, onClose],
  )

  const handleOverlayMouseDown = useCallback(
    (event) => {
      if (!closeOnOverlayClick) return
      if (event.target !== overlayRef.current) return

      onClose?.(event)
    },
    [closeOnOverlayClick, onClose],
  )

  if (!open || !mounted) return null

  const labelledBy = title ? titleId : undefined

  const dialog = (
    <div
      ref={overlayRef}
      data-slot="modal-overlay"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-indigo-night-950/60 p-4',
        overlayClassName,
      )}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-slot="modal"
        className={cn(
          'flex w-full flex-col gap-4 rounded-card bg-white p-6 shadow-xl focus:outline-none',
          MODAL_SIZES[size] ?? MODAL_SIZES.md,
          className,
        )}
        {...rest}
      >
        {title || showCloseButton ? (
          <div className="flex items-start justify-between gap-4">
            {title ? (
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 -mt-1 rounded p-1 leading-none text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
              >
                <span aria-hidden="true">×</span>
                <span className="sr-only">{closeLabel}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {description ? (
          <p id={descriptionId} className="text-sm text-slate-600">
            {description}
          </p>
        ) : null}

        <div className="text-sm text-slate-700">{children}</div>

        {footer ? <div className="flex items-center justify-end gap-3">{footer}</div> : null}
      </div>
    </div>
  )

  return createPortal(dialog, container ?? document.body)
}

export default Modal
