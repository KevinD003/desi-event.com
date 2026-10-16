'use client'

/**
 * The header's search trigger: a button that opens a small search form.
 *
 * The listing's own search (`/events`, "Find events") is the real one, with
 * the city, date and category filters beside it; this is the way to it from
 * any page, without first going there. The form is a GET to `/events` with
 * the words as `q`, the same parameter the listing reads, submitted through
 * `next/form` so the listing opens as a client navigation. With no
 * JavaScript the button does nothing and "Discover events" is the way in.
 *
 * The form exists only while the popover is open, so a page never carries a
 * second search box, and the header's tab order is unchanged until somebody
 * asks for it. Drawn from 1024px; below that the row has no room, and the
 * Menu sheet leads to the listing.
 *
 * @module components/header-search
 */

import Form from 'next/form'
import { useId, useState } from 'react'
import { Icon } from '@desi-event/ui/icons'

import { Button, Input, Popover } from './ui.jsx'

/** The longest search the listing reads; more is cut there anyway. */
const MAX_QUERY_LENGTH = 100

/**
 * The search trigger and its form.
 *
 * @returns {JSX.Element} The trigger, with the form in its popover.
 */
export function HeaderSearch() {
  const [open, setOpen] = useState(false)
  const inputId = useId()

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(26rem,calc(100vw-2rem))]"
      trigger={
        <button
          type="button"
          className="hidden min-h-11 items-center gap-2 rounded-control px-3 text-label font-semibold text-ink transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-subtle hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:inline-flex"
        >
          <Icon name="search" className="h-5 w-5" />
          Search
        </button>
      }
    >
      <Form
        action="/events"
        role="search"
        aria-label="Search events"
        onSubmit={() => setOpen(false)}
        className="flex flex-col gap-3"
      >
        <label htmlFor={inputId} className="text-label font-semibold text-ink">
          Search events, venues, cities and organisers
        </label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            name="q"
            type="search"
            maxLength={MAX_QUERY_LENGTH}
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button type="submit">Search</Button>
        </div>
      </Form>
    </Popover>
  )
}
