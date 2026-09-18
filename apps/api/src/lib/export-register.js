/**
 * The export register: a record that an export happened, and nothing about what
 * was in it.
 *
 * ## What this is for
 *
 * Two questions an incident asks that nothing in this system could previously
 * answer: *who pulled an export, and when?* and *does an export exist that
 * contains this person?* The first is answered by an `ExportArtifact` row. The
 * second is answered by `ExportArtifactSubject`, and the honest answer today is
 * "no export contains anybody" — see below.
 *
 * ## Why no export links a subject, and why that is a finding rather than a gap
 *
 * Both CSV routes emit aggregate figures under an explicit column allow list.
 * `analytics.EXPORT_COLUMNS` is section, item, code, quantity, amount, currency
 * and note; finance's is section, item, code, debits, credits, balance, count
 * and currency. Neither carries a name, an address, an e-mail, a card, a
 * provider reference or a row belonging to one person. So there is nobody to
 * link, `ExportArtifactSubject` stays empty, and a redaction finds no artefact
 * to invalidate — not because the search is unimplemented, but because the
 * exports genuinely do not contain anybody.
 *
 * A test asserts that nothing here ever writes an `ExportArtifactSubject` row.
 * The moment an export is added that *does* carry a person, that test fails,
 * which is the point: the link is what makes a redaction able to reach it, and
 * adding a personal export without adding the link would be the silent version
 * of this gap.
 *
 * ## Why registration can fail an export
 *
 * It is written before the body is returned, and a failure to write it fails
 * the request. An export that happened with no record of it is precisely what
 * this register exists to prevent, and a register that is best-effort is a
 * register that is empty exactly when somebody needs it.
 *
 * ## What is not registered, and why
 *
 * A platform-wide finance export — one with no `organizationId` — is not
 * recorded, because `ExportArtifact.organizationId` is NOT NULL and making it
 * nullable is a migration. That is a stated limitation rather than a silent
 * one: {@link recordExport} returns `null` and the caller logs it, the
 * documentation says so, and a test pins the behaviour. Whether to widen the
 * column is an owner decision.
 *
 * @module @desi-event/api/lib/export-register
 */

/**
 * The kinds of export this system produces.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EXPORT_KINDS = Object.freeze({
  ANALYTICS: 'analytics',
  FINANCE: 'finance',
})

/**
 * Register that an export was produced.
 *
 * Writes an `ExportArtifact` row and deliberately no `ExportArtifactSubject`
 * rows. `ephemeral` is `true` and `storageKey` is `null` because the bytes are
 * streamed to the caller and nothing is kept — recorded explicitly rather than
 * left to a default, so that a future stored export has to say so rather than
 * inheriting a claim that is no longer true.
 *
 * @param {object} prisma A Prisma client or transaction.
 * @param {object} params Parameters.
 * @param {string|null} params.organizationId Whose export, or `null` for a platform-wide one.
 * @param {string} params.kind One of {@link EXPORT_KINDS}.
 * @param {string|null} [params.requestedById] Who asked.
 * @returns {Promise<object|null>} The row, or `null` when there is no organisation to attribute it to.
 */
export async function recordExport(prisma, { organizationId, kind, requestedById = null }) {
  // A platform-wide export has no organisation and the column is NOT NULL.
  // Returning null rather than inventing an organisation: attributing an
  // everybody-export to one tenant would make the register actively wrong,
  // which is worse than making it visibly incomplete.
  if (!organizationId) return null

  return prisma.exportArtifact.create({
    data: {
      organizationId,
      kind,
      storageKey: null,
      ephemeral: true,
      requestedById,
      state: 'AVAILABLE',
    },
  })
}

/**
 * Present one register entry.
 *
 * Field by field rather than by spreading the row, so a column added to
 * `ExportArtifact` later has to be named here before it can reach a reader.
 * `storageKey` never leaves: it is reduced to the boolean `stored`, because a
 * storage key in a payload is a storage key in somebody's log file.
 *
 * @param {object} row An `ExportArtifact` row, optionally with `_count.subjects`.
 * @returns {object} The payload shape.
 */
export function toExportArtifact(row) {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    ephemeral: row.ephemeral,
    stored: typeof row.storageKey === 'string' && row.storageKey !== '',
    requestedById: row.requestedById ?? null,
    subjectCount: row._count?.subjects ?? 0,
    generatedAt: row.generatedAt,
    invalidatedAt: row.invalidatedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    failureCode: row.failureCode ?? null,
  }
}

/**
 * How many live artefacts an organisation holds that are known to contain one
 * person.
 *
 * Counted rather than listed, and counted through the join rather than by
 * reading an artefact. Nothing here opens an export.
 *
 * @param {object} prisma A Prisma client or transaction.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<number>} How many artefacts would be invalidated.
 */
export async function countExportsContaining(prisma, { organizationId, subjectUserId }) {
  return prisma.exportArtifact.count({
    where: {
      organizationId,
      state: 'AVAILABLE',
      subjects: { some: { subjectUserId } },
    },
  })
}

/**
 * Invalidate every live artefact known to contain one person.
 *
 * Invalidated, not deleted. The bytes are already gone — every export is
 * streamed and nothing is stored — so there is nothing to erase; what changes
 * is the register's claim that the artefact is still good. A row that recorded
 * an export as `AVAILABLE` after its subject was redacted would be the register
 * telling a later reader that a copy of that person still exists somewhere.
 *
 * Returns zero for every organisation in this system today, because no export
 * links a subject. The code is here so that the first export which does is
 * reachable by a redaction on the day it is added, rather than on the day
 * somebody notices.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the request.
 * @param {string} params.subjectUserId The data subject.
 * @param {Date} params.now The instant.
 * @returns {Promise<number>} How many artefacts were invalidated.
 */
export async function invalidateExportsForSubject(tx, { organizationId, subjectUserId, now }) {
  const { count } = await tx.exportArtifact.updateMany({
    where: {
      organizationId,
      state: 'AVAILABLE',
      subjects: { some: { subjectUserId } },
    },
    data: { state: 'INVALIDATED', invalidatedAt: now },
  })

  return count
}
