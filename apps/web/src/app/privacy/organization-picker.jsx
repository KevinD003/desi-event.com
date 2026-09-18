/**
 * Which organisation's queue, and which states.
 *
 * A plain `GET` form rather than a client component that pushes history. Two
 * reasons, and the second is the real one:
 *
 *   - it works before JavaScript arrives, and an operator who has come here to
 *     stop something does not want to wait for a bundle;
 *   - the organisation id ends up in the query string, which is where the page
 *     reads it from and where a bookmark can carry it. The **API** reads the
 *     organisation from the path, not from here, so nothing the browser puts in
 *     this field can widen what the server will answer.
 *
 * The submit button is not hidden behind an onChange. A select that navigates
 * the moment it changes is a trap for anybody using a keyboard, who has to move
 * through the options to reach the one they want and would fire a navigation on
 * each one.
 *
 * @module app/privacy/organization-picker
 */

import { PRIVACY_REQUEST_STATES } from '@desi-event/schemas'

import { requestStateLabel } from '../../lib/privacy-vocabulary.js'

/**
 * @typedef {object} OrganizationPickerProps
 * @property {Array<{organizationId: string, organizationName: string|null}>} organizations What this operator may see.
 * @property {string} selectedId The organisation currently shown.
 * @property {string} state The state filter currently applied, or the empty string.
 */

/**
 * The queue filters.
 *
 * @param {OrganizationPickerProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function OrganizationPicker({ organizations, selectedId, state }) {
  const single = organizations.length === 1

  return (
    <form
      method="get"
      action="/privacy"
      className="mt-6 flex flex-wrap items-end gap-4 rounded-card border border-slate-200 bg-slate-50 p-4"
    >
      {single ? (
        <input type="hidden" name="organizationId" value={selectedId} />
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="organizationId" className="text-sm font-medium text-indigo-night-900">
            Organisation
          </label>
          <select
            id="organizationId"
            name="organizationId"
            defaultValue={selectedId}
            className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
          >
            {organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>
                {organization.organizationName ?? organization.organizationId}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="state" className="text-sm font-medium text-indigo-night-900">
          State
        </label>
        <select
          id="state"
          name="state"
          defaultValue={state}
          className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
        >
          <option value="">Every state</option>
          {PRIVACY_REQUEST_STATES.map((member) => (
            <option key={member} value={member}>
              {requestStateLabel(member)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="rounded-sm bg-indigo-night-900 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-night-800 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Apply
      </button>
    </form>
  )
}
