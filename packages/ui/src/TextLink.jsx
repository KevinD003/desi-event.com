import { textLinkClasses } from './buttonClasses.js'

/**
 * @typedef {object} TextLinkProps
 * @property {ElementType} [as] What renders the link: `a` by default, or the app's router link.
 * @property {string} href Where it goes.
 * @property {'accent'|'ink'|'inverse'} [tone] `accent` on public pages (the default), `ink` in a signed-in area, `inverse` on the purple plate.
 * @property {string} [className] Extra classes merged after the defaults.
 * @property {ReactNode} [children] The words.
 */

/**
 * A link in running text: underlined, so it is never told by colour alone,
 * with the one focus outline.
 *
 * @param {TextLinkProps} props Component props, forwarded to the link.
 * @returns {JSX.Element} The link.
 */
export function TextLink({ as: Component = 'a', tone = 'accent', className, children, ...rest }) {
  return (
    <Component data-slot="text-link" className={textLinkClasses({ tone, className })} {...rest}>
      {children}
    </Component>
  )
}

export default TextLink
