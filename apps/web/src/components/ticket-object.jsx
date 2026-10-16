/**
 * A ticket drawn as a ticket: a face and a stub on card stock, joined at a
 * perforated tear line.
 *
 * The wallet lists tickets this way and a ticket's own page is one, so the
 * thing somebody holds looks the same wherever they meet it. The face carries
 * what the ticket is (the event, when, where, who it is for and which tier);
 * the stub carries what to do with it (the pass, or the date and a way to
 * the pass). Both are printed on `ticket-paper` in `ticket-ink`.
 *
 * The notches at the tear are cut by a mask on each piece (`commerce.css`),
 * so they show whatever lies under the ticket. Below `md` the stub sits under
 * the face; from `md`, beside it.
 *
 * On the day the ticket is for, a gold keyline is drawn once around the face
 * (decoration: the face says "Today" in words as well). Under reduced motion
 * the line is simply there.
 *
 * No hooks, so a Server Component can draw one.
 *
 * @module components/ticket-object
 */

import './commerce.css'

import { cn } from '@desi-event/ui/classes'

/**
 * The gold keyline of the day the ticket is for. Decoration only.
 *
 * @returns {JSX.Element} The line.
 */
function EventDayKeyline() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="ticket-keyline"
      className="ticket-keyline pointer-events-none absolute inset-2.5 h-[calc(100%-1.25rem)] w-[calc(100%-1.25rem)] text-highlight"
    >
      <rect
        x="1"
        y="1"
        rx="8"
        pathLength="100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}
      />
    </svg>
  )
}

/**
 * @typedef {object} TicketObjectProps
 * @property {'article'|'li'|'div'} [as] The element the ticket is.
 * @property {boolean} [eventDay] Whether today is the day it is for.
 * @property {boolean} [muted] Whether it no longer admits (drawn quieter).
 * @property {string} [stubClassName] Classes for the stub (its width from `md`, its padding).
 * @property {string} [faceClassName] Classes for the face.
 * @property {string} [className] Classes for the ticket.
 * @property {ReactNode} face What the ticket is.
 * @property {ReactNode} stub What to do with it.
 */

/**
 * The ticket.
 *
 * @param {TicketObjectProps} props Component props; any others go on the element.
 * @returns {JSX.Element} The ticket.
 */
export function TicketObject({
  as: Tag = 'article',
  eventDay = false,
  muted = false,
  stubClassName,
  faceClassName,
  className,
  face,
  stub,
  ...rest
}) {
  return (
    <Tag
      data-slot="ticket"
      data-layout="row"
      data-event-day={eventDay ? '' : undefined}
      className={cn('ticket-object relative flex min-w-0 flex-col md:flex-row', className)}
      {...rest}
    >
      <div
        className={cn(
          'ticket-face relative min-w-0 flex-1 rounded-t-card border border-b-0 border-line-strong bg-ticket-paper p-5 text-ticket-ink sm:p-7 md:rounded-tr-none md:rounded-bl-card md:border-r-0 md:border-b',
          muted && 'text-ink-muted',
          faceClassName,
        )}
      >
        {eventDay ? <EventDayKeyline /> : null}
        <div className="relative">{face}</div>
      </div>
      <div
        className={cn(
          'ticket-stub relative flex min-w-0 flex-col rounded-b-card border border-t-0 border-line-strong bg-ticket-paper p-5 text-ticket-ink sm:p-7 md:w-72 md:shrink-0 md:rounded-tr-card md:rounded-bl-none md:border-t md:border-l-0',
          stubClassName,
        )}
      >
        {/* The perforation: a dashed tear line, kept clear of the notches. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-5 top-0 border-t-2 border-dashed border-line-strong md:inset-x-auto md:inset-y-5 md:left-0 md:border-t-0 md:border-l-2"
        />
        {stub}
      </div>
    </Tag>
  )
}
