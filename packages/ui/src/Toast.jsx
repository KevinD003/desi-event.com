import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'

/**
 * The classes each toast wears. Sonner draws the stack, its timing and its
 * swipe; with `unstyled` it draws nothing else, and these supply the look: an
 * ink plate with white words, the floating shadow, the control radius.
 */
const TOAST_CLASSES = Object.freeze({
  toast:
    'flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-control bg-surface-inverse px-4 py-3 text-ink-inverse shadow-floating',
  title: 'text-label font-semibold',
  description: 'mt-0.5 text-caption text-ink-inverse-muted',
  closeButton: 'text-ink-inverse',
})

/**
 * Where toasts appear. Render it once, high in the app, outside any dialog.
 *
 * Sonner's region is `aria-live="polite"`: a toast is read after whatever the
 * reader is doing, never instead of it. It is not focusable by Tab and takes
 * focus only if the reader asks for it with its shortcut (Alt+T), so a toast
 * never moves anybody's place on the page.
 *
 * @param {{position?: string}} props Component props: where on screen. Defaults to bottom centre, clear of the thumb's primary actions on a phone.
 * @returns {JSX.Element} The region.
 */
export function Toaster({ position = 'bottom-center' }) {
  return (
    <SonnerToaster
      position={position}
      containerAriaLabel="Notifications"
      mobileOffset={16}
      offset={24}
      gap={8}
      visibleToasts={3}
      toastOptions={{ unstyled: true, classNames: TOAST_CLASSES, duration: 5000 }}
    />
  )
}

/**
 * Show a short, non-critical confirmation: "Copied", "Saved", "Link sent".
 *
 * Only for things the reader could miss without harm. Anything they must
 * know — a payment refused, a ticket that does not admit, an error to fix —
 * belongs in the page, beside what it is about, in an `Alert`; the door and
 * the checkout keep their outcomes in their own live regions. No exclamation
 * marks, and never a toast that carries a code, a token or a credential.
 *
 * @param {ReactNode} message What happened, in a few words.
 * @param {{description?: ReactNode, id?: string|number}} [options] A second line, and an id to replace an earlier toast with.
 * @returns {string|number} The toast's id.
 */
export function toast(message, options = {}) {
  return sonnerToast(message, { description: options.description, id: options.id })
}

export default Toaster
