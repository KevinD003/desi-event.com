/**
 * The export register.
 *
 * Which exports this organisation has produced, who asked, and whether any of
 * them is known to contain a person. It answers the two questions an incident
 * asks that nothing in this system could previously answer.
 *
 * ## What it deliberately cannot do
 *
 * There is no download link, and no route that would provide one. Every export
 * is streamed to whoever asked at the time and nothing is stored, so there are
 * no bytes to re-serve — and a register that could hand out a second copy of an
 * export would have become the thing it exists to keep track of.
 *
 * ## Why every row says "nobody"
 *
 * Because it is true. Both export routes emit aggregate figures under explicit
 * column allow lists with no name, address, e-mail, card or provider reference,
 * so no artefact links a subject. The screen states it per row rather than once
 * at the top, because the answer would change per row the day a personal export
 * is added, and a page that had assumed otherwise would keep saying "nobody"
 * after it stopped being true.
 *
 * ## Why there is a "Requested by" column and no detail screen
 *
 * The register's whole claim is that it can answer *who pulled an export, and
 * when*. It could not: `requestedById` was in the payload and on no screen, so
 * the first half of the claim was true of the API and false of the thing an
 * operator actually looks at.
 *
 * A column rather than a detail screen, because a detail screen would have one
 * more field than this table and a URL that reads like a handle on an artefact
 * nobody can fetch. Everything the register knows about a row now fits in the
 * row.
 *
 * ## An unproven claim, stated as unproven
 *
 * The sixth column raised the table's minimum width from `46rem` to `54rem`,
 * and **nothing in this repository would notice if that were wrong**:
 * `accessibility-sweep.spec.js` covers neither `/privacy` nor
 * `/privacy/exports`, and `page.test.jsx` asserts text, not layout. Browser and
 * accessibility coverage for these screens is a separate, still-open piece of
 * work. The value is named here rather than left as a judgement so that the
 * work which does prove it has something specific to check.
 *
 * @module app/privacy/exports/page
 */

import { EXPORT_ARTIFACT_STATES } from '@desi-event/schemas'

import { AsOf, Empty, Forbidden } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { TABLE_FRAME } from '../../../components/workspace-kit.jsx'
import { listExportArtifacts } from '../../../lib/privacy-api.js'
import { privacyOrganizations, readSession } from '../../../lib/session.js'
import { OrganizationPicker } from '../organization-picker.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Export register',
  robots: { index: false, follow: false },
}

/**
 * What an artefact's state means to somebody reading the register.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATE_LABELS = Object.freeze({
  AVAILABLE: 'Recorded',
  INVALIDATED: 'Invalidated by an erasure',
  DELETED: 'Deleted',
  DELETION_FAILED: 'Deletion failed',
})

/**
 * One state, in words, falling back to the raw value.
 *
 * A function rather than the map, because that is the shape the filter form
 * takes from both of its callers. The fallback is not defensive padding: the
 * database enum is the authority, so a state added there and not worded here
 * must still render as something an operator can read and quote.
 *
 * @param {string} member A member of `EXPORT_ARTIFACT_STATES`.
 * @returns {string} Its label.
 */
function stateLabel(member) {
  return STATE_LABELS[member] ?? member
}

/**
 * Render a timestamp as a plain ISO day, or a dash.
 *
 * @param {string|null} value An ISO timestamp.
 * @returns {string} The day, or an em dash.
 */
function day(value) {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : '—'
}

/**
 * How many people an artefact is known to contain, in words.
 *
 * @param {number} count The subject count.
 * @returns {string} The sentence for the cell.
 */
function contains(count) {
  if (count === 0) return 'Nobody — aggregate figures only'

  return count === 1 ? '1 person' : `${count} people`
}

/**
 * Who asked for an export, as an account id.
 *
 * An id and not a name, deliberately. Resolving it would mean this screen read
 * a `User` row to render a staff member's name, which would make the export
 * register hold personal data about staff in order to record that it holds none
 * about anybody else. The id is what the audit trail carries and what a ticket
 * can be raised against, and it is sufficient to answer the question the
 * register exists for: *who pulled this export.*
 *
 * Null when the row predates the column or the export was taken by something
 * that is not a person. Said as "Not recorded" rather than shown as a blank,
 * because a blank cell in this column reads as "nobody", which is a different
 * and much more reassuring claim.
 *
 * @param {string|null} requestedById The account id on the row.
 * @returns {string} The cell.
 */
function requestedBy(requestedById) {
  return typeof requestedById === 'string' && requestedById !== '' ? requestedById : 'Not recorded'
}

/**
 * @typedef {object} ExportRegisterPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The register.
 *
 * @param {ExportRegisterPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ExportRegisterPage({ searchParams }) {
  const session = await readSession()
  const organizations = privacyOrganizations(session)
  const params = (await searchParams) ?? {}

  if (organizations.length === 0) {
    return <Forbidden area="The export register" backHref="/" />
  }

  const selected =
    organizations.find((organization) => organization.organizationId === params.organizationId) ??
    organizations[0]

  let artifacts = null
  let pagination = null
  let failure = null

  try {
    const answer = await listExportArtifacts(selected.organizationId, {
      kind: params.kind,
      state: params.state,
      page: params.page,
    })

    artifacts = answer.data ?? []
    pagination = answer.pagination ?? null
  } catch (error) {
    failure = error
  }

  const readAt = new Date().toISOString()

  return (
    <>
      <header>
        <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
          Workspace · Trust and safety
        </p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">Export register</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          Which exports this organisation has produced, and whether any of them is known to contain
          a person. It records that an export happened — never what was in it — and there is nothing
          to download here: every export is streamed to whoever asked and nothing is kept.
        </p>
      </header>

      <OrganizationPicker
        organizations={organizations}
        selectedId={selected.organizationId}
        state={params.state ?? ''}
        action="/privacy/exports"
        states={EXPORT_ARTIFACT_STATES}
        stateLabel={stateLabel}
        // `kind` has no control on this form and is read below. Without this it
        // would be dropped the moment somebody pressed Apply.
        extra={{ kind: params.kind }}
      />

      {failure ? (
        <ReadRefusal error={failure} what="The export register" action="see the export register" />
      ) : null}

      {artifacts && artifacts.length === 0 ? (
        <Empty
          title="No exports recorded"
          description="Nothing has been exported from this organisation since the register began. A platform-wide finance export is not recorded here at all — it belongs to no organisation, and the register is organisation-scoped."
        />
      ) : null}

      {artifacts && artifacts.length > 0 ? (
        <>
          <AsOf asOf={readAt} />
          <div className={`mt-4 ${TABLE_FRAME}`}>
            <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Exports produced by {selected.organizationName ?? 'this organisation'}, newest first
              </caption>
              <thead>
                <tr className="border-b border-line-strong text-ink-muted">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Kind
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Contains
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Stored
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Requested by
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Produced
                  </th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact) => (
                  <tr key={artifact.id} className="border-b border-line align-top">
                    <th scope="row" className="py-3 pr-4 font-medium text-ink">
                      {artifact.kind}
                    </th>
                    <td className="py-3 pr-4">{stateLabel(artifact.state)}</td>
                    <td className="py-3 pr-4">{contains(artifact.subjectCount)}</td>
                    <td className="py-3 pr-4">
                      {artifact.stored ? 'Yes' : 'No — streamed and not kept'}
                    </td>
                    <td className="py-3 pr-4 break-all">{requestedBy(artifact.requestedById)}</td>
                    <td className="py-3 pr-4 tabular-nums">{day(artifact.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing {artifacts.length} of {pagination.total ?? artifacts.length}.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}
