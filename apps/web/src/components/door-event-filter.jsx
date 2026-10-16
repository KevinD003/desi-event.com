'use client'

/**
 * Narrowing a platform administrator's door list: one organisation, a search.
 *
 * A plain `GET` form, so it works before any script arrives and the filter is
 * a web address a steward can bookmark. Neither value is a secret — an
 * organisation id and a few words of a title — so both belong in the query
 * string. Shown only when the list is the platform's; a member's list is
 * already just their own doors.
 *
 * A client module, though it keeps no state: `FormField` clones the control
 * it is given, and a control handed to it by a Server Component can arrive as
 * a lazy reference rather than an element, which it cannot clone. Rendered
 * from the server, the door page failed with "FormField expects a single
 * control element" — on a client-side navigation back to the unfiltered door
 * (the form's own Clear link) it showed the error page instead of the door.
 * Built here, the controls are ordinary elements. `form-field-boundary.test.js`
 * holds every `FormField` to the same rule.
 *
 * @module components/door-event-filter
 */

import Link from 'next/link'

import { Button, FormField, Input, Select } from './ui.jsx'

/**
 * @typedef {object} DoorEventFilterProps
 * @property {Array<{id: string, name: string}>} organizations The organisations with a door open now.
 * @property {string} [organizationId] The organisation chosen, if any.
 * @property {string} [q] The search typed, if any.
 */

/**
 * The filter form.
 *
 * @param {DoorEventFilterProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function DoorEventFilter({ organizations, organizationId = '', q = '' }) {
  return (
    <form
      method="get"
      action="/organizer/check-in"
      role="search"
      aria-label="Find an event"
      className="mt-6 flex max-w-3xl flex-wrap items-end gap-3 rounded-card border border-line bg-surface-raised p-4 shadow-card"
    >
      <FormField label="Organisation" className="min-w-0 flex-1 basis-56">
        <Select name="organizationId" defaultValue={organizationId}>
          <option value="">All organisations</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Event or organisation name" className="min-w-0 flex-1 basis-56">
        <Input type="search" name="q" defaultValue={q} maxLength={100} autoComplete="off" />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">Show events</Button>
        <Link
          href="/organizer/check-in"
          className="inline-flex min-h-11 items-center rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
        >
          Clear
        </Link>
      </div>
    </form>
  )
}
