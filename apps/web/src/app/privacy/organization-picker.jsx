/**
 * Which organisation, and which states — for whichever list is showing.
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
 * ## Why it takes an action and a vocabulary
 *
 * It did not, and that was a defect rather than a simplification. The form was
 * written for the privacy request queue and hard-coded `action="/privacy"` and
 * the `PRIVACY_REQUEST_STATES` list. The export register then reused it, which
 * meant pressing **Apply** on `/privacy/exports` navigated the operator to a
 * different screen, and the states it offered — `RECEIVED`, `VERIFYING` — are
 * states no export artefact can ever be in. Both filters were unusable and
 * neither failed loudly.
 *
 * So the page that renders the form says where it submits and what its states
 * are. Defaults are the queue's, so the original caller is unchanged and a
 * future third caller has to think about it rather than inherit the queue's
 * answers by silence.
 *
 * ## Why it carries unknown filters through
 *
 * `extra` exists because fixing the action exposed a second bug behind the
 * first. The register also filters by `kind`, which this form has no control
 * for; with the action broken, pressing Apply navigated away and nobody noticed
 * that `kind` was not in the submitted query. Fixed in isolation, Apply would
 * have silently dropped the operator's `kind` filter while appearing to refine
 * the view — the same "the screen and the list disagree" failure, inverted.
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
 * @property {string} [action] Where Apply submits. Defaults to the request queue.
 * @property {ReadonlyArray<string>} [states] The state vocabulary to offer. Defaults to the request states.
 * @property {Function} [stateLabel] How to word one state, taking the member and returning its label. A function, not a map, so both callers pass the same shape.
 * @property {Readonly<Record<string, string|undefined>>} [extra] Filters this form has no control for and must not drop.
 */

/**
 * The list filters.
 *
 * @param {OrganizationPickerProps} props Component props.
 * @returns {JSX.Element} The form.
 */
export function OrganizationPicker({
  organizations,
  selectedId,
  state,
  action = '/privacy',
  states = PRIVACY_REQUEST_STATES,
  stateLabel = requestStateLabel,
  extra = {},
}) {
  const single = organizations.length === 1

  return (
    <form
      method="get"
      action={action}
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

      {/*
        Filters with no control here, resubmitted rather than dropped. Only the
        ones that are actually set: an empty hidden input would put `kind=` in
        the query string, and the reader would have to know to ignore it.
      */}
      {Object.entries(extra)
        .filter(([, value]) => typeof value === 'string' && value !== '')
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

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
          {states.map((member) => (
            <option key={member} value={member}>
              {stateLabel(member)}
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
