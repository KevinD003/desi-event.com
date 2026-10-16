/**
 * The library's pure class helpers, for Server Components.
 *
 * `@desi-event/ui` itself is a barrel that includes client components with
 * hooks, which a Server Component may not import. These are plain functions
 * with no React in them, served at `@desi-event/ui/classes`.
 *
 * @module @desi-event/ui/classes
 */

export { cn } from './cn.js'
export { buttonClasses, textLinkClasses } from './buttonClasses.js'
