/**
 * `@desi-event/ui` — the accessible React primitives shared by the web
 * application of The Desi Events.
 *
 * Every component here is plain JSX styled with Tailwind utility classes and
 * accepts a `className` that is merged last, so a consumer can restyle a
 * primitive without reimplementing its behaviour. Accessibility is part of the
 * component contract rather than something applications bolt on: labels are
 * tied to controls, errors are announced, and the dialog and tab patterns
 * implement their full keyboard behaviour.
 *
 * @module @desi-event/ui
 */

export { cn } from './cn.js'

export { Button, ButtonLink } from './Button.jsx'
export { buttonClasses, textLinkClasses } from './buttonClasses.js'
export { TextLink } from './TextLink.jsx'
export { Badge } from './Badge.jsx'
export { Card, CardHeader, CardBody, CardFooter } from './Card.jsx'
export { Input } from './Input.jsx'
export { Textarea } from './Textarea.jsx'
export { Select } from './Select.jsx'
export { Label } from './Label.jsx'
export { FormField } from './FormField.jsx'
export { Alert } from './Alert.jsx'
export { StatusIcon } from './StatusIcon.jsx'
export { Spinner } from './Spinner.jsx'
export { Skeleton } from './Skeleton.jsx'
export { EmptyState } from './EmptyState.jsx'
export { VisuallyHidden } from './VisuallyHidden.jsx'
export { Modal } from './Modal.jsx'
export { Tabs } from './Tabs.jsx'
export { Sheet } from './Sheet.jsx'
export { Popover } from './Popover.jsx'
export { Menu } from './Menu.jsx'
export { Tooltip } from './Tooltip.jsx'
export { Toaster, toast } from './Toast.jsx'
export { Stat } from './Stat.jsx'
export { Kbd } from './Kbd.jsx'
export { SegmentedControl } from './SegmentedControl.jsx'
export { Icon } from './icons/Icon.jsx'
