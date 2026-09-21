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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  EXPORT_KINDS,
  countExportsContaining,
  invalidateExportsForSubject,
  recordExport,
  toExportArtifact,
} from '../src/lib/export-register.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

const ORG = cuid()
const OTHER_ORG = cuid()
const SUBJECT = cuid()
const ACTOR = cuid()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(HERE, '..', '..', '..')

/**
 * Where shipped code lives: every workspace's `src`, plus the database scripts,
 * which run against a real database and are the one place outside `src` that
 * could write a row.
 *
 * Listed rather than globbed, so that the failure when a workspace is added is
 * "this list is out of date" rather than nothing at all. `covers every
 * workspace on disk` below is what turns that from a hope into a test: a new
 * package with a `src` directory fails this suite until it is named here, which
 * is the only thing standing between this scan and the quiet version of itself
 * that walks four directories and reports the repository clean.
 *
 * @type {ReadonlyArray<string>}
 */
const SHIPPED_ROOTS = Object.freeze([
  'apps/api/src',
  'apps/web/src',
  'apps/worker/src',
  'packages/api-contract/src',
  'packages/auth/src',
  'packages/config/src',
  'packages/db/src',
  'packages/db/scripts',
  'packages/inventory/src',
  'packages/ledger/src',
  'packages/logger/src',
  'packages/notifications/src',
  'packages/permissions/src',
  'packages/pricing/src',
  'packages/providers/src',
  'packages/schemas/src',
  'packages/ui/src',
])

/**
 * Every shipped source file under a directory.
 *
 * Tests are excluded deliberately. A fixture that writes an
 * `ExportArtifactSubject` row is how {@link invalidateExportsForSubject} is
 * exercised at all — the claim being policed is about code that runs in
 * production, not about what a test may construct.
 *
 * @param {string} dir Where to start.
 * @returns {string[]} Absolute paths.
 */
function shippedFiles(dir) {
  const found = []

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue

    const full = path.join(dir, entry)

    if (statSync(full).isDirectory()) {
      found.push(...shippedFiles(full))
      continue
    }
    if (/\.(?:js|jsx|mjs)$/u.test(entry) && !/\.test\.(?:js|jsx)$/u.test(entry)) found.push(full)
  }

  return found
}

/**
 * The same file with its comments blanked out.
 *
 * The scans below are about what the code does, and this repository explains
 * itself at length: `export-register.js` and `packages/schemas/src/privacy.js`
 * both discuss `ExportArtifactSubject` in prose precisely because the invariant
 * matters. A scan that could not tell an explanation from a write would force
 * the next person to choose between documenting the rule and passing it.
 *
 * Comments are blanked rather than removed so that every offence the scans do
 * report still has its original line and column.
 *
 * A `//` preceded by a colon is left alone: that is the scheme separator in a
 * URL, and truncating the rest of the line there could hide real code behind a
 * link in a string.
 *
 * @param {string} source The file.
 * @returns {string} The same length, with comment bodies replaced by spaces.
 */
function withoutComments(source) {
  const blank = (match) => match.replaceAll(/[^\n]/gu, ' ')

  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, blank)
    .replaceAll(
      /(^|[^:])\/\/[^\n]*/gu,
      (match, before) => before + blank(match.slice(before.length)),
    )
}

/**
 * Every shipped source file in the repository, with its code.
 *
 * `source` has had its comments blanked; `prose` is the file as written, for
 * the one assertion that is about what the documentation says.
 *
 * @returns {Array<{file: string, source: string, prose: string}>} Path relative to the repository root, and contents.
 */
function shippedSources() {
  return SHIPPED_ROOTS.flatMap((root) =>
    shippedFiles(path.join(REPOSITORY_ROOT, root)).map((file) => {
      const prose = readFileSync(file, 'utf8')

      return {
        file: path.relative(REPOSITORY_ROOT, file),
        source: withoutComments(prose),
        prose,
      }
    }),
  )
}

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

  it('records a finance export before returning the body', async () => {
    // The mirror of the case above, and it has to be written carefully rather
    // than copied. Two things separate the finance export from the analytics
    // one, and both of them can turn this test into one that proves nothing:
    //
    //   1. `organizationId` is what makes the export recordable at all.
    //      Without it `recordExport` returns null by design, no
    //      `ExportArtifact` row is written, and "no subject links exist" would
    //      then be true of a register nothing had been written to. That test
    //      would stay green with a subject-linking writer in place.
    //   2. The route carries `stepUp: 'FINANCE_VIEW'`. It is satisfied here by
    //      actually stepping up, not by reaching for a session that skips it.
    //
    // So the artefact is asserted to exist first, and its emptiness of subjects
    // is a statement about an export that happened.
    const harness = await createTestApp()
    const organizationId = harness.ids.organization.id
    const email = 'owner@rangoli.example'
    const headers = bearer(await signIn(harness.app, email))

    await stepUp(harness.app, email, headers)

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/finance/export.csv?organizationId=${organizationId}`,
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)

    const recorded = harness.prisma._store.exportArtifact ?? []

    expect(recorded).toHaveLength(1)
    expect(recorded[0].kind).toBe('finance')
    expect(recorded[0].organizationId).toBe(organizationId)
    expect(recorded[0].ephemeral).toBe(true)
    expect(recorded[0].storageKey).toBeNull()

    expect(harness.prisma._store.exportArtifactSubject ?? []).toHaveLength(0)
  })

  it('records nothing for the platform-wide finance export, and still serves it', async () => {
    // The stated limitation, exercised end to end rather than only at the unit
    // boundary. `ExportArtifact.organizationId` is NOT NULL, so an export that
    // belongs to everybody cannot be attributed to anyone — and the decision
    // taken was to serve the export and record nothing, rather than to refuse
    // the export or to pin it on one tenant.
    //
    // Pinned here because it is the register's one hole, and a hole that no
    // test describes is a hole somebody closes by accident and nobody notices.
    const harness = await createTestApp()
    const email = 'ops@desi-event.example'
    const headers = bearer(await signIn(harness.app, email))

    await stepUp(harness.app, email, headers)

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/finance/export.csv',
      headers,
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(harness.prisma._store.exportArtifact ?? []).toHaveLength(0)
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

describe('nothing links a subject, as a property of the repository', () => {
  // `recordExport` not writing a link is one call site behaving. The claim the
  // documentation makes — and the claim a redaction depends on — is bigger than
  // that: *nothing* writes one, so `ExportArtifactSubject` is empty, so
  // `invalidateExportsForSubject` matching zero rows means "no export contains
  // this person" rather than "the link was never populated".
  //
  // A behavioural test cannot say that. It can only speak for the call sites it
  // makes. A route added next month that wrote a link would leave every
  // behavioural test in this suite green while quietly falsifying the sentence
  // the register screen prints in every row.
  //
  // So this is a source scan, following `audit.test.js`. It is allowed to be
  // blunt: the correct number of shipped files mentioning this model is zero,
  // and the day that stops being true the change should have to argue with a
  // test rather than slip past one.

  it('scans a tree big enough to be worth scanning', () => {
    // A guard on the guard. If a refactor moved the source out from under
    // `SHIPPED_ROOTS`, every assertion below would pass over an empty list and
    // report the invariant holding when nothing had been read.
    const sources = shippedSources()

    expect(sources.length).toBeGreaterThan(200)
    expect(sources.some(({ file }) => file === 'apps/api/src/lib/export-register.js')).toBe(true)
  })

  it('covers every workspace on disk, so a new package cannot arrive unscanned', () => {
    // The failure mode this exists for: somebody adds `packages/exports/` with
    // a Prisma client in it, and every scan below keeps passing because none of
    // them ever looks there. A list of roots is only as good as the thing that
    // notices when it stops being the whole list.
    const onDisk = ['apps', 'packages'].flatMap((group) =>
      readdirSync(path.join(REPOSITORY_ROOT, group))
        .map((workspace) => `${group}/${workspace}/src`)
        .filter((candidate) => {
          try {
            return statSync(path.join(REPOSITORY_ROOT, candidate)).isDirectory()
          } catch {
            return false
          }
        }),
    )

    const unscanned = onDisk.filter((root) => !SHIPPED_ROOTS.includes(root)).sort()

    expect(unscanned, `add these to SHIPPED_ROOTS: ${unscanned.join(', ')}`).toEqual([])
  })

  it('blanks comments without blanking code, so the scans are not vacuous', () => {
    // The scans below run against `withoutComments`. A stripper that returned
    // an empty string would make every one of them pass while reading nothing,
    // which is the failure mode that turns a guard into decoration.
    const stripped = withoutComments(
      ['/** names exportArtifactSubject in prose */', 'const kept = 1 // and here', ''].join('\n'),
    )

    expect(stripped).not.toMatch(/exportArtifactSubject/u)
    expect(stripped).not.toMatch(/and here/u)
    expect(stripped).toContain('const kept = 1')
    // A URL is not a comment.
    expect(withoutComments("const u = 'https://example.test/x' // gone")).toContain(
      "'https://example.test/x'",
    )
    // And the real tree still has code in it after stripping.
    expect(
      shippedSources().filter(({ source }) => source.includes('export')).length,
    ).toBeGreaterThan(200)
  })

  it('has no shipped code that so much as names ExportArtifactSubject', () => {
    const offenders = shippedSources()
      .filter(({ source }) => /exportArtifactSubject/iu.test(source))
      .map(({ file }) => file)

    expect(offenders, `these ship and reference the subject link: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  it('keeps explaining the invariant in prose, which the scan must tolerate', () => {
    // Stated as a test because it is the reason `withoutComments` exists. If a
    // later change made the scan literal again, this is what would argue the
    // case: the modules that carry the rule also have to be able to say what it
    // is.
    //
    // A floor, deliberately, not an exact list. An exact list would fail the
    // day somebody documented the rule in a third place, which would make this
    // an invariant that punishes explaining things — and a reader who hit that
    // failure would rationally delete the explanation rather than the test.
    const explaining = shippedSources()
      .filter(({ prose }) => /ExportArtifactSubject/u.test(prose))
      .map(({ file }) => file)

    expect(explaining).toContain('apps/api/src/lib/export-register.js')
    expect(explaining).toContain('packages/schemas/src/privacy.js')
  })

  it('reads the subject relation and never writes through it', () => {
    // The other door. Prisma can write a join row without naming the model, as
    // a nested `subjects: { create: … }` on an `exportArtifact` write. Reads
    // through the same relation are expected and wanted — `countExportsContaining`
    // and the register's `_count` both go through it — so the check is on the
    // operator, not on the relation.
    const writes = []

    for (const { file, source } of shippedSources()) {
      for (const match of source.matchAll(/subjects\s*:\s*\{\s*([A-Za-z]+)/gu)) {
        const operator = match[1]

        if (['some', 'none', 'every'].includes(operator)) continue

        writes.push(`${file}: subjects: { ${operator}`)
      }
    }

    expect(writes, `nested writes through the subject relation: ${writes.join(', ')}`).toEqual([])
  })

  it('has no shipped code that reaches the table through raw SQL', () => {
    // The door a Prisma-shaped scan does not watch. `$executeRawUnsafe` with an
    // INSERT would write a subject link without the model accessor and without
    // the relation field, and both assertions above would stay green.
    //
    // Bounded patterns rather than an open `[^;]*`: this codebase has no
    // semicolons, so an unbounded run swallows the rest of the file and the
    // failure message stops naming anything useful.
    const offenders = []

    for (const { file, source } of shippedSources()) {
      for (const pattern of [
        /\$(?:execute|query)Raw(?:Unsafe)?[^\n]{0,200}ExportArtifactSubject/giu,
        /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?ExportArtifactSubject"?/giu,
      ]) {
        for (const match of source.matchAll(pattern)) offenders.push(`${file}: ${match[0].trim()}`)
      }
    }

    expect(offenders, `raw SQL against the subject link: ${offenders.join(', ')}`).toEqual([])
  })

  it('still finds the reads, so the scan is looking at the right relation', () => {
    // Without this, the test above would pass just as happily against a tree
    // where the relation had been renamed and the regex matched nothing.
    const reads = shippedSources().filter(({ source }) => /subjects\s*:\s*\{\s*some/u.test(source))

    expect(reads.map(({ file }) => file)).toContain('apps/api/src/lib/export-register.js')
  })
})
