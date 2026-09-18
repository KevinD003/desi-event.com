/**
 * The export register must record every export, hold none of its contents, and
 * be honest about what it cannot record.
 *
 * Four properties:
 *
 *   - **No export escapes the register.** Registration is written before the
 *     body and a failure fails the request, because a best-effort register is
 *     empty exactly when somebody needs it.
 *   - **The register holds no exported data.** Not a row, not a name, not a
 *     storage key — `storageKey` is reduced to a boolean on the way out.
 *   - **Nothing links a subject.** Every export this system produces is an
 *     aggregate. The invariant is asserted rather than assumed, so the first
 *     export that does carry a person fails this suite instead of slipping past
 *     the redaction path.
 *   - **What cannot be recorded is stated.** A platform-wide finance export has
 *     no organisation and `ExportArtifact.organizationId` is NOT NULL, so it is
 *     not recorded. Pinned here so the gap is a decision rather than a surprise.
 *
 * @module @desi-event/api/tests/export-register.test
 */

import { describe, expect, it } from 'vitest'

import {
  EXPORT_KINDS,
  countExportsContaining,
  invalidateExportsForSubject,
  recordExport,
  toExportArtifact,
} from '../src/lib/export-register.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

const ORG = cuid()
const OTHER_ORG = cuid()
const SUBJECT = cuid()
const ACTOR = cuid()

/**
 * A store with two organisations.
 *
 * @param {object} [extra] Rows to add.
 * @returns {object} A stub client.
 */
function world(extra = {}) {
  return createPrismaStub({
    organization: [
      { id: ORG, name: 'Rangoli', slug: 'rangoli', contactEmail: 'hello@rangoli.example' },
      { id: OTHER_ORG, name: 'Dhol', slug: 'dhol', contactEmail: 'hello@dhol.example' },
    ],
    ...extra,
  })
}

describe('recordExport', () => {
  it('records an export as ephemeral with nothing stored', async () => {
    // Both stated rather than left to a default, so a future stored export has
    // to say so instead of inheriting a claim that is no longer true.
    const prisma = world()

    const row = await recordExport(prisma, {
      organizationId: ORG,
      kind: EXPORT_KINDS.ANALYTICS,
      requestedById: ACTOR,
    })

    expect(row.ephemeral).toBe(true)
    expect(row.storageKey).toBeNull()
    expect(row.state).toBe('AVAILABLE')
    expect(row.kind).toBe('analytics')
    expect(row.requestedById).toBe(ACTOR)
  })

  it('records nothing for a platform-wide export, rather than attributing it to a tenant', async () => {
    // A stated limitation: the column is NOT NULL, and inventing an
    // organisation would make the register actively wrong — worse than
    // visibly incomplete.
    const prisma = world()

    expect(
      await recordExport(prisma, { organizationId: null, kind: EXPORT_KINDS.FINANCE }),
    ).toBeNull()
    expect(prisma._store.exportArtifact ?? []).toHaveLength(0)
  })

  it('never writes a subject link', async () => {
    // The invariant this whole suite exists for. Every export in this system
    // is an aggregate; the day one carries a person, this fails.
    const prisma = world()

    await recordExport(prisma, { organizationId: ORG, kind: EXPORT_KINDS.ANALYTICS })
    await recordExport(prisma, { organizationId: ORG, kind: EXPORT_KINDS.FINANCE })

    expect(prisma._store.exportArtifactSubject ?? []).toHaveLength(0)
  })
})

describe('toExportArtifact', () => {
  it('reduces the storage key to a boolean and never emits it', async () => {
    // A storage key in a payload is a storage key in somebody's log file.
    const presented = toExportArtifact({
      id: 'exp1',
      kind: 'finance',
      state: 'AVAILABLE',
      ephemeral: false,
      storageKey: 's3://exports/secret-path/abc.csv',
      requestedById: ACTOR,
      generatedAt: new Date(),
      invalidatedAt: null,
      deletedAt: null,
      failureCode: null,
      _count: { subjects: 0 },
    })

    expect(presented.stored).toBe(true)
    expect(presented.storageKey).toBeUndefined()
    expect(JSON.stringify(presented)).not.toMatch(/secret-path/u)
  })

  it('reports no storage when there is none', () => {
    const presented = toExportArtifact({
      id: 'exp2',
      kind: 'analytics',
      state: 'AVAILABLE',
      ephemeral: true,
      storageKey: null,
      generatedAt: new Date(),
      _count: { subjects: 0 },
    })

    expect(presented.stored).toBe(false)
    expect(presented.subjectCount).toBe(0)
    expect(presented.requestedById).toBeNull()
  })

  it('survives a row loaded without the subject count', () => {
    // A caller that forgot the `_count` include gets 0 rather than a crash —
    // but 0 is also the honest answer for every artefact in this system.
    expect(
      toExportArtifact({ id: 'e', kind: 'finance', state: 'AVAILABLE', ephemeral: true })
        .subjectCount,
    ).toBe(0)
  })
})

describe('reaching an artefact that contains somebody', () => {
  it('counts and invalidates within one organisation only', async () => {
    const artefact = cuid()
    const foreign = cuid()
    const prisma = world({
      exportArtifact: [
        {
          id: artefact,
          organizationId: ORG,
          kind: 'analytics',
          ephemeral: true,
          state: 'AVAILABLE',
        },
        {
          id: foreign,
          organizationId: OTHER_ORG,
          kind: 'analytics',
          ephemeral: true,
          state: 'AVAILABLE',
        },
      ],
      exportArtifactSubject: [
        { id: cuid(), exportArtifactId: artefact, subjectUserId: SUBJECT },
        { id: cuid(), exportArtifactId: foreign, subjectUserId: SUBJECT },
      ],
    })

    expect(
      await countExportsContaining(prisma, { organizationId: ORG, subjectUserId: SUBJECT }),
    ).toBe(1)

    const invalidated = await invalidateExportsForSubject(prisma, {
      organizationId: ORG,
      subjectUserId: SUBJECT,
      now: new Date(),
    })

    expect(invalidated).toBe(1)

    const rows = prisma._store.exportArtifact
    expect(rows.find((row) => row.id === artefact).state).toBe('INVALIDATED')
    // A redaction is scoped to one organisation. Reaching into another's
    // register would be acting outside the authority it asserted.
    expect(rows.find((row) => row.id === foreign).state).toBe('AVAILABLE')
  })

  it('leaves an already-invalidated artefact alone', async () => {
    const artefact = cuid()
    const prisma = world({
      exportArtifact: [
        {
          id: artefact,
          organizationId: ORG,
          kind: 'analytics',
          ephemeral: true,
          state: 'INVALIDATED',
        },
      ],
      exportArtifactSubject: [{ id: cuid(), exportArtifactId: artefact, subjectUserId: SUBJECT }],
    })

    expect(
      await invalidateExportsForSubject(prisma, {
        organizationId: ORG,
        subjectUserId: SUBJECT,
        now: new Date(),
      }),
    ).toBe(0)
  })
})

describe('the export routes register what they produce', () => {
  it('records an analytics export before returning the body', async () => {
    const harness = await createTestApp()
    const token = await signIn(harness.app, 'ops@desi-event.example')
    const organizationId = harness.ids.organization.id

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${organizationId}`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const recorded = harness.prisma._store.exportArtifact ?? []

    expect(recorded).toHaveLength(1)
    expect(recorded[0].kind).toBe('analytics')
    expect(recorded[0].organizationId).toBe(organizationId)
    expect(recorded[0].ephemeral).toBe(true)
    // The register records that an export happened, never what was in it.
    expect(harness.prisma._store.exportArtifactSubject ?? []).toHaveLength(0)
  })
})

describe('reading the register', () => {
  it('shows an organisation its own exports and no other', async () => {
    const harness = await createTestApp()
    const organizationId = harness.ids.organization.id

    harness.prisma._store.exportArtifact = [
      {
        id: cuid(),
        organizationId,
        kind: 'analytics',
        ephemeral: true,
        storageKey: null,
        state: 'AVAILABLE',
        requestedById: null,
        generatedAt: new Date('2026-09-18T00:00:00.000Z'),
        invalidatedAt: null,
        deletedAt: null,
        failureCode: null,
      },
      {
        id: cuid(),
        organizationId: OTHER_ORG,
        kind: 'finance',
        ephemeral: true,
        storageKey: null,
        state: 'AVAILABLE',
        requestedById: null,
        generatedAt: new Date('2026-09-18T00:00:00.000Z'),
        invalidatedAt: null,
        deletedAt: null,
        failureCode: null,
      },
    ]

    const token = await signIn(harness.app, 'owner@rangoli.example')
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/privacy/exports`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const body = response.json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].kind).toBe('analytics')
    expect(body.data[0].subjectCount).toBe(0)
  })

  it('refuses a caller without privacy:redact in that organisation', async () => {
    const harness = await createTestApp()
    const organizationId = harness.ids.organization.id
    const token = await signIn(harness.app, 'arun@rangoli.example')

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/privacy/exports`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)
  })
})
