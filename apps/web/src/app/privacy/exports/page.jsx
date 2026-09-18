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
 * @module app/privacy/exports/page
 */

import { AsOf, Empty, Failure, Forbidden } from '../../../components/page-state.jsx'
import { listExportArtifacts } from '../../../lib/privacy-api.js'
import { privacyOrganizations, readSession } from '../../../lib/session.js'
import { describeRefusal } from '../../../lib/privacy-vocabulary.js'
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
    failure = describeRefusal(error)
  }

  const readAt = new Date().toISOString()

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold text-indigo-night-900">Export register</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          Which exports this organisation has produced, and whether any of them is known to contain
          a person. It records that an export happened — never what was in it — and there is nothing
          to download here: every export is streamed to whoever asked and nothing is kept.
        </p>
      </header>

      <OrganizationPicker
        organizations={organizations}
        selectedId={selected.organizationId}
        state={params.state ?? ''}
      />

      {failure ? <Failure what={failure.title} detail={failure.detail} /> : null}

      {artifacts && artifacts.length === 0 ? (
        <Empty
          title="No exports recorded"
          description="Nothing has been exported from this organisation since the register began. A platform-wide finance export is not recorded here at all — it belongs to no organisation, and the register is organisation-scoped."
        />
      ) : null}

      {artifacts && artifacts.length > 0 ? (
        <>
          <AsOf asOf={readAt} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Exports produced by {selected.organizationName ?? 'this organisation'}, newest first
              </caption>
              <thead>
                <tr className="border-b border-slate-300 text-slate-700">
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
                    Produced
                  </th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact) => (
                  <tr key={artifact.id} className="border-b border-slate-200 align-top">
                    <th scope="row" className="py-3 pr-4 font-medium text-indigo-night-900">
                      {artifact.kind}
                    </th>
                    <td className="py-3 pr-4">{STATE_LABELS[artifact.state] ?? artifact.state}</td>
                    <td className="py-3 pr-4">{contains(artifact.subjectCount)}</td>
                    <td className="py-3 pr-4">
                      {artifact.stored ? 'Yes' : 'No — streamed and not kept'}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{day(artifact.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination ? (
            <p className="mt-4 text-sm text-slate-600">
              Showing {artifacts.length} of {pagination.total ?? artifacts.length}.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}
