/**
 * The furniture every signed-in page is built from, in the Quiet Courtyard
 * register.
 *
 * ## Why one module
 *
 * Forty-odd pages sit behind the account and workspace shells. Each used to
 * set its own title size, its own card border and its own table rules, so the
 * wallet, the refund queue and the privacy register read as three products.
 * These are the pieces they now share: a page header, a section, a panel, a
 * row of counts, the frame a table sits in, and the classes for a link that
 * looks like a button. Change one here and every signed-in page follows.
 *
 * ## What they do not do
 *
 * Decide anything. None of these reads a session, fetches, or knows which
 * register it is in — the register redefines the tokens underneath them
 * (`[data-register='courtyard']` in the theme), so `bg-action-primary` is plum
 * here and rani pink on a public page without a component asking which.
 *
 * Plain server-renderable components with no hooks, so a page can use them
 * without becoming a client component.
 *
 * @module components/workspace-kit
 */

import { EventPoster } from './poster.jsx'

/**
 * @typedef {object} PageHeaderProps
 * @property {string} [eyebrow] A few words above the title naming where this is, such as "Workspace · Money".
 * @property {ReactNode} title The page's one `h1`.
 * @property {ReactNode} [description] One or two sentences under it.
 * @property {ReactNode} [actions] Links or buttons that act on the whole page, drawn beside the title on a wide screen.
 * @property {string} [titleClassName] Extra classes for the `h1`, e.g. `font-mono break-all` for a reference.
 * @property {ReactNode} [children] Anything else that belongs to the title block, after the description.
 */

/**
 * A page's title block: eyebrow, title, description and page-level actions.
 *
 * The title is the page's only `h1`, set in the display face at the `h2` step
 * of the scale — a working screen wants a clear title, not a poster headline.
 * The eyebrow is a paragraph, not a heading, so the outline a screen reader
 * lists starts with the title.
 *
 * @param {PageHeaderProps} props Component props.
 * @returns {JSX.Element} The header block.
 */
export function PageHeader({ eyebrow, title, description, actions, titleClassName, children }) {
  return (
    <div
      data-slot="page-header"
      className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
    >
      <div className="max-w-3xl min-w-0">
        {eyebrow ? (
          <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={`text-h2 font-semibold text-ink ${eyebrow ? 'mt-2' : ''} ${titleClassName ?? ''}`}
        >
          {title}
        </h1>
        {description ? <p className="mt-2 text-ink-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  )
}

/**
 * @typedef {object} SectionProps
 * @property {string} id The heading's id; the section is labelled by it.
 * @property {ReactNode} title The section's `h2`.
 * @property {ReactNode} [description] A sentence under the heading.
 * @property {ReactNode} [actions] Controls for the section, beside its heading.
 * @property {string} [className] Extra classes for the section, e.g. a different top margin.
 * @property {ReactNode} [children] The section's content.
 */

/**
 * A titled part of a page.
 *
 * A real `section` labelled by its own heading, so it is a region a screen
 * reader can jump to by name, and the heading is an `h2` in the display face.
 *
 * @param {SectionProps} props Component props.
 * @returns {JSX.Element} The section.
 */
export function Section({ id, title, description, actions, className = 'mt-10', children }) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * The classes for a white panel on the courtyard ground.
 *
 * The card radius and the card shadow, with a hairline for high-contrast and
 * forced-colours modes, where the shadow disappears and the line is what is
 * left of the edge.
 *
 * @type {string}
 */
export const PANEL = 'rounded-card border border-line bg-surface-raised shadow-card'

/**
 * The classes for a panel that is itself one link: a destination card.
 *
 * The shadow deepens on hover rather than the ground changing, and the ring
 * is drawn outside the card on keyboard focus.
 *
 * @type {string}
 */
export const LINK_PANEL = `${PANEL} block h-full p-5 transition-shadow duration-(--duration-base) ease-standard hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2`

/**
 * The classes for a link drawn as the page's primary button.
 *
 * For navigation that should look like an action — "Create an event" — where
 * a `<button>` would be the wrong element. At least 44px tall.
 *
 * @type {string}
 */
export const PRIMARY_LINK =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action-primary px-4 text-sm font-semibold text-action-primary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * The classes for a link drawn as a secondary button.
 *
 * @type {string}
 */
export const SECONDARY_LINK =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action-secondary-line bg-action-secondary px-4 text-sm font-semibold text-action-secondary-ink shadow-control transition-colors duration-(--duration-fast) hover:bg-action-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * The classes for a link in running text or a list.
 *
 * Underlined — a link is never told apart by colour alone — in the ink, with
 * the accent on hover.
 *
 * @type {string}
 */
export const TEXT_LINK =
  'rounded-sm font-medium text-ink underline decoration-accent-line decoration-2 underline-offset-4 transition-colors duration-(--duration-fast) hover:text-accent-strong hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/**
 * The classes for the panel a data table sits in.
 *
 * The workspace's tables were written one at a time, each with its own cell
 * padding and rules, and several with none at the start of a row, which in a
 * panel would put text against the edge. Rather than rewrite forty tables'
 * cells, the frame sets what a table inside it needs: a tinted header row,
 * the same vertical rhythm in every cell, room at both ends of a row, and no
 * rule under the last row where the panel's own edge already is one. It
 * scrolls sideways inside itself on a narrow screen rather than widening the
 * page.
 *
 * @type {string}
 */
export const TABLE_FRAME =
  'overflow-x-auto rounded-card border border-line bg-surface-raised shadow-card [&_thead]:bg-surface-subtle [&_th]:py-3 [&_td]:py-3 [&_tr>:first-child]:pl-4 [&_tr>:last-child]:pr-4 [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:last-child>*]:border-b-0'

/**
 * @typedef {object} CountTileProps
 * @property {ReactNode} label What is counted.
 * @property {ReactNode} value The count, as the API or the page's own rows gave it.
 * @property {ReactNode} [hint] A sentence under the number.
 */

/**
 * One count, as a tile in a {@link CountTiles} list.
 *
 * Only for a number the page already holds — the length of a list it read, a
 * figure the API sent. There is no tile for a number nobody measured.
 *
 * @param {CountTileProps} props Component props.
 * @returns {JSX.Element} The tile, a `dt`/`dd` pair.
 */
export function CountTile({ label, value, hint }) {
  return (
    <div className={`${PANEL} p-4 sm:p-5`}>
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1">
        <span className="block font-display text-h2 font-semibold text-ink tabular-nums">
          {value}
        </span>
        {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
      </dd>
    </div>
  )
}

/**
 * A row of {@link CountTile}s.
 *
 * A description list, because each tile is a term and its value, which is
 * exactly what a screen reader should announce.
 *
 * @param {object} props Component props.
 * @param {string} [props.className] Extra classes, e.g. a top margin.
 * @param {ReactNode} props.children The tiles.
 * @returns {JSX.Element} The list.
 */
export function CountTiles({ className = 'mt-6', children }) {
  return (
    <dl className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`}>
      {children}
    </dl>
  )
}

/**
 * @typedef {object} PosterThumbProps
 * @property {{slug?: string, id?: string, title?: string, category?: string}} event What the poster is drawn from; the slug seeds it.
 * @property {string} [className] Size and placement, e.g. `h-28 sm:h-auto sm:w-44`.
 */

/**
 * An event's poster as a thumbnail at the edge of a card.
 *
 * The same drawing the event wears on its public page, cropped to whatever
 * box the card gives it, so a wallet, an order and an organiser's list can be
 * scanned by picture before they are read.
 *
 * Hidden from assistive technology. On a card the event's title is already
 * the heading beside it, and announcing the illustration before every title
 * would put a sentence of scenery in front of each row of a list.
 *
 * @param {PosterThumbProps} props Component props.
 * @returns {JSX.Element} The thumbnail.
 */
export function PosterThumb({ event, className = '' }) {
  return (
    <div
      aria-hidden="true"
      data-slot="poster-thumb"
      className={`shrink-0 overflow-hidden bg-surface-subtle ${className}`}
    >
      <EventPoster event={event} className="h-full" />
    </div>
  )
}
